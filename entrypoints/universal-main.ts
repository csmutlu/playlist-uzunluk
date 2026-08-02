interface PageVolumeGraph {
  context: AudioContext;
  source: MediaElementAudioSourceNode;
  bassFilter: BiquadFilterNode;
  voiceFilter: BiquadFilterNode;
  gain: GainNode;
  percent: number;
  muted: boolean;
  bass: number;
  voice: number;
}

interface PageVolumeRegistry {
  graphs: WeakMap<HTMLMediaElement, PageVolumeGraph>;
  pending: WeakMap<HTMLMediaElement, Promise<PageVolumeGraph | null>>;
  lastError?: string;
}

export default defineUnlistedScript(() => {
  const script = document.currentScript as HTMLScriptElement | null;
  const channel = script?.dataset.pzChannel;
  if (!channel) return;

  const controlEvent = `playlist-zamani:control:${channel}`;
  const stateEvent = `playlist-zamani:state:${channel}`;
  const media = new Set<HTMLMediaElement>();
  const observers = new Set<MutationObserver>();
  const watchedRoots = new WeakSet<Document | ShadowRoot>();
  const marks = new WeakMap<HTMLMediaElement, number>();
  const positionsBeforeJump = new WeakMap<HTMLMediaElement, number>();
  const nativeRateSetter = Object.getOwnPropertyDescriptor(
    HTMLMediaElement.prototype,
    'playbackRate',
  )?.set;
  let active: HTMLMediaElement | null = null;
  let theater: { item: HTMLVideoElement; css: string } | null = null;
  let disposed = false;
  const pageWindow = window as typeof window & {
    __playlistZamaniVolumeRegistry?: PageVolumeRegistry;
    webkitAudioContext?: typeof AudioContext;
  };
  const isGecko = /(?:Firefox|Waterfox|Zen)\//i.test(navigator.userAgent);
  const volumeRegistry = pageWindow.__playlistZamaniVolumeRegistry ?? {
    graphs: new WeakMap<HTMLMediaElement, PageVolumeGraph>(),
    pending: new WeakMap<HTMLMediaElement, Promise<PageVolumeGraph | null>>(),
  };
  pageWindow.__playlistZamaniVolumeRegistry = volumeRegistry;

  const report = (
    target: EventTarget,
    detail: Record<string, unknown>,
  ) => {
    if (disposed) return false;
    return target.dispatchEvent(new CustomEvent(stateEvent, {
      detail: isGecko ? JSON.stringify(detail) : detail,
      bubbles: true,
      composed: true,
    }));
  };

  const canSeek = (item: HTMLMediaElement) =>
    Number.isFinite(item.duration) && item.duration > 0 && item.seekable.length > 0;

  const canBoost = (item: HTMLMediaElement) => {
    const source = item.currentSrc || item.src;
    if (!source || source.startsWith('blob:') || source.startsWith('data:')) return true;
    try {
      return new URL(source, location.href).origin === location.origin || item.crossOrigin !== null;
    } catch {
      return false;
    }
  };

  const applyVolumeGraph = (item: HTMLMediaElement, graph: PageVolumeGraph) => {
    item.volume = 1;
    item.muted = graph.muted;
    graph.bassFilter.gain.value = graph.bass * 0.15;
    graph.voiceFilter.gain.value = graph.voice * 0.12;
    graph.gain.gain.value = graph.muted ? 0 : graph.percent / 100;
  };

  const volumeDetail = (item: HTMLMediaElement, boostSupported = true) => {
    const graph = volumeRegistry.graphs.get(item);
    return {
      kind: 'volume',
      percent: graph?.percent ?? Math.round(item.volume * 100),
      muted: graph?.muted ?? item.muted,
      boosted: Boolean(graph && graph.percent > 100),
      boostSupported,
      ...(graph?.bass ? { bass: graph.bass } : {}),
      ...(graph?.voice ? { voice: graph.voice } : {}),
    };
  };

  const reportVolume = (item: HTMLMediaElement, boostSupported = true) => {
    report(item, volumeDetail(item, boostSupported));
  };

  const ensureVolumeGraph = async (item: HTMLMediaElement): Promise<PageVolumeGraph | null> => {
    const existing = volumeRegistry.graphs.get(item);
    if (existing) return existing;
    const pending = volumeRegistry.pending.get(item);
    if (pending) return pending;
    const AudioContextConstructor = pageWindow.AudioContext ?? pageWindow.webkitAudioContext;
    if (!AudioContextConstructor || !canBoost(item)) {
      volumeRegistry.lastError = !AudioContextConstructor
        ? 'Web Audio is unavailable.'
        : 'The media source cannot be processed because of its origin.';
      return null;
    }
    const creation = (async () => {
      let context: AudioContext | null = null;
      try {
        context = new AudioContextConstructor();
        await context.resume();
        if (context.state !== 'running') {
          volumeRegistry.lastError = `AudioContext remained ${context.state}.`;
          await context.close();
          return null;
        }
        const source = context.createMediaElementSource(item);
        const bassFilter = context.createBiquadFilter();
        bassFilter.type = 'lowshelf';
        bassFilter.frequency.value = 180;
        const voiceFilter = context.createBiquadFilter();
        voiceFilter.type = 'peaking';
        voiceFilter.frequency.value = 2_500;
        voiceFilter.Q.value = 0.9;
        const gain = context.createGain();
        source.connect(bassFilter).connect(voiceFilter).connect(gain);
        gain.connect(context.destination);
        const graph: PageVolumeGraph = {
          context,
          source,
          bassFilter,
          voiceFilter,
          gain,
          percent: Math.round(item.volume * 100),
          muted: item.muted,
          bass: 0,
          voice: 0,
        };
        volumeRegistry.graphs.set(item, graph);
        item.addEventListener('volumechange', handleVolumeChange, { passive: true });
        return graph;
      } catch (error) {
        volumeRegistry.lastError = error instanceof Error ? error.message : String(error);
        if (context && context.state !== 'closed') void context.close();
        return null;
      }
    })();
    volumeRegistry.pending.set(item, creation);
    const graph = await creation;
    if (volumeRegistry.pending.get(item) === creation) volumeRegistry.pending.delete(item);
    return graph;
  };

  let loop: { item: HTMLMediaElement; start: number; end?: number } | null = null;

  const enforceLoop = (event: Event) => {
    const item = event.currentTarget;
    if (
      !(item instanceof HTMLMediaElement) ||
      loop?.item !== item ||
      loop.end === undefined ||
      (item.currentTime < loop.end && item.currentTime >= loop.start - 0.5)
    ) return;
    item.currentTime = loop.start;
  };

  const releaseLoop = () => {
    if (!loop) return;
    loop.item.removeEventListener('timeupdate', enforceLoop);
    loop.item.removeEventListener('seeked', enforceLoop);
    loop = null;
  };

  const toggleLoop = (item: HTMLMediaElement) => {
    const current = loop?.item === item ? loop : null;
    releaseLoop();
    if (current?.end !== undefined) return;
    if (current && item.currentTime - current.start >= 0.05) {
      loop = { item, start: current.start, end: item.currentTime };
      item.addEventListener('timeupdate', enforceLoop, { passive: true });
      item.addEventListener('seeked', enforceLoop, { passive: true });
      return;
    }
    loop = { item, start: item.currentTime };
  };

  const handlePlay = (event: Event) => {
    const item = event.currentTarget;
    if (!(item instanceof HTMLMediaElement)) return;
    active = item;
    report(item, {
      kind: 'media',
      rate: item.playbackRate,
      seekable: canSeek(item),
      mediaType: item instanceof HTMLAudioElement ? 'audio' : 'video',
    });
  };

  const handlePointer = (event: Event) => {
    const item = event.currentTarget;
    if (!(item instanceof HTMLMediaElement)) return;
    active = item;
    // Gecko does not propagate popup activation into the page. Create a neutral
    // graph during the user's trusted player interaction so later popup EQ
    // changes can reuse a running AudioContext without violating autoplay rules.
    if (isGecko && event.isTrusted && !volumeRegistry.graphs.has(item)) {
      void ensureVolumeGraph(item);
    }
  };

  const handleRateChange = (event: Event) => {
    const item = event.currentTarget;
    if (!(item instanceof HTMLMediaElement)) return;
    active = item;
    report(item, {
      kind: 'media',
      rate: item.playbackRate,
      seekable: canSeek(item),
      mediaType: item instanceof HTMLAudioElement ? 'audio' : 'video',
    });
  };

  const handleVolumeChange = (event: Event) => {
    const item = event.currentTarget;
    if (!(item instanceof HTMLMediaElement)) return;
    active = item;
    const graph = volumeRegistry.graphs.get(item);
    if (graph) {
      if (Math.abs(item.volume - 1) > 0.001) {
        graph.percent = Math.round(item.volume * 100);
        item.volume = 1;
      }
      graph.muted = item.muted;
      graph.gain.gain.value = graph.muted ? 0 : graph.percent / 100;
    }
    reportVolume(item);
  };

  const track = (item: HTMLMediaElement) => {
    if (media.has(item)) return;
    media.add(item);
    item.addEventListener('pointerdown', handlePointer, { passive: true });
    item.addEventListener('click', handlePointer, { passive: true });
    const root = item.getRootNode();
    if (root instanceof ShadowRoot && root.mode === 'closed') {
      item.addEventListener('play', handlePlay, { passive: true });
      item.addEventListener('ratechange', handleRateChange, { passive: true });
      item.addEventListener('volumechange', handleVolumeChange, { passive: true });
    }
  };

  const scan = (root: ParentNode) => {
    if (root instanceof HTMLMediaElement) track(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let node = walker.nextNode();
    while (node) {
      if (node instanceof HTMLMediaElement) track(node);
      if (node instanceof Element && node.shadowRoot) watchRoot(node.shadowRoot);
      node = walker.nextNode();
    }
  };

  const watchRoot = (root: Document | ShadowRoot) => {
    if (watchedRoots.has(root)) return;
    watchedRoots.add(root);
    scan(root);
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof HTMLMediaElement) track(node);
          if (node instanceof Element || node instanceof DocumentFragment) scan(node);
        }
      }
    });
    observer.observe(root, { childList: true, subtree: true });
    observers.add(observer);
  };

  const originalAttachShadow = Element.prototype.attachShadow;
  const wrappedAttachShadow: typeof Element.prototype.attachShadow = function (
    this: Element,
    init: ShadowRootInit,
  ) {
    const root = originalAttachShadow.call(this, init);
    watchRoot(root);
    report(this, { kind: 'shadow' });
    return root;
  };
  Element.prototype.attachShadow = wrappedAttachShadow;

  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    releaseLoop();
    document.removeEventListener(controlEvent, handleControl, true);
    for (const observer of observers) observer.disconnect();
    for (const item of media) {
      item.removeEventListener('play', handlePlay);
      item.removeEventListener('pointerdown', handlePointer);
      item.removeEventListener('click', handlePointer);
      item.removeEventListener('ratechange', handleRateChange);
      item.removeEventListener('volumechange', handleVolumeChange);
    }
    media.clear();
    if (theater) theater.item.style.cssText = theater.css;
    theater = null;
    if (Element.prototype.attachShadow === wrappedAttachShadow) {
      Element.prototype.attachShadow = originalAttachShadow;
    }
  };

  const selected = (event: Event, allowAudio: boolean): HTMLMediaElement | null => {
    const ignored = (item: HTMLMediaElement) => {
      if (item instanceof HTMLVideoElement && item.loop && item.muted && !item.controls) return true;
      if (
        location.hostname !== 'music.youtube.com' &&
        (
          location.hostname === 'youtube.com' ||
          location.hostname.endsWith('.youtube.com') ||
          location.hostname === 'youtube-nocookie.com' ||
          location.hostname.endsWith('.youtube-nocookie.com')
        )
      ) {
        return item.classList.contains('video-thumbnail') ||
          Boolean(item.closest('.ytp-ad-player-overlay'));
      }
      if (location.hostname === 'www.netflix.com') {
        return item.classList.contains('preview-video') || Boolean(item.closest('.billboard-row'));
      }
      return false;
    };
    const allowed = (item: HTMLMediaElement) =>
      !ignored(item) && (allowAudio || !(item instanceof HTMLAudioElement));
    if (event.target instanceof HTMLMediaElement && allowed(event.target)) return event.target;
    if (active?.isConnected && allowed(active)) return active;
    let fallback: HTMLMediaElement | null = null;
    for (const item of media) {
      if (!item.isConnected) {
        media.delete(item);
        continue;
      }
      if (allowed(item) && !item.paused && !item.ended) return item;
      if (!fallback && allowed(item)) fallback = item;
    }
    return fallback;
  };

  const handleControl = (event: Event) => {
    const rawDetail = (event as CustomEvent<unknown>).detail;
    let detail: Record<string, unknown>;
    try {
      detail = typeof rawDetail === 'string'
        ? JSON.parse(rawDetail) as Record<string, unknown>
        : rawDetail as Record<string, unknown>;
    } catch {
      return;
    }
    if (!detail || typeof detail !== 'object') return;
    const custom = { detail };
    if (custom.detail?.x) {
      cleanup();
      return;
    }
    const item = selected(event, custom.detail?.allowAudio !== false);
    if (!item) {
      report(document, { kind: 'rejected' });
      return;
    }
    const action = custom.detail?.action;
    try {
      if (action === 'volumeInfo') {
        reportVolume(item);
        return;
      }
      if (action === 'setVolume' && Number.isFinite(custom.detail.percent)) {
        const percent = Math.round(Math.min(600, Math.max(0, Number(custom.detail.percent))));
        const existing = volumeRegistry.graphs.get(item);
        if (percent <= 100 && !existing) {
          item.volume = percent / 100;
          if (percent > 0) item.muted = false;
          reportVolume(item);
          return;
        }
        if (existing) {
          existing.percent = percent;
          if (percent > 0) existing.muted = false;
          if (existing.context.state === 'suspended') void existing.context.resume();
          applyVolumeGraph(item, existing);
          reportVolume(item);
          return;
        }
        void ensureVolumeGraph(item).then((graph) => {
          if (!graph) {
            reportVolume(item, false);
            return;
          }
          graph.percent = percent;
          graph.muted = false;
          applyVolumeGraph(item, graph);
          reportVolume(item);
        });
        return;
      }
      if (action === 'setAudioProfile' && custom.detail.settings) {
        const requested = custom.detail.settings as Record<string, unknown>;
        const percent = Math.round(Math.min(600, Math.max(0, Number(requested.percent) || 0)));
        const bass = Math.round(Math.min(100, Math.max(0, Number(requested.bass) || 0)));
        const voice = Math.round(Math.min(100, Math.max(0, Number(requested.voice) || 0)));
        const existing = volumeRegistry.graphs.get(item);
        if (!existing && percent <= 100 && bass === 0 && voice === 0) {
          item.volume = percent / 100;
          if (percent > 0) item.muted = false;
          reportVolume(item);
          return;
        }
        void ensureVolumeGraph(item).then((graph) => {
          if (!graph) {
            reportVolume(item, false);
            return;
          }
          graph.percent = percent;
          graph.bass = bass;
          graph.voice = voice;
          if (percent > 0) graph.muted = false;
          applyVolumeGraph(item, graph);
          reportVolume(item);
        });
        return;
      }
      if (action === 'toggleMasterMute') {
        const graph = volumeRegistry.graphs.get(item);
        if (graph) {
          graph.muted = !graph.muted;
          applyVolumeGraph(item, graph);
        } else {
          item.muted = !item.muted;
        }
        reportVolume(item);
        return;
      }
      if (
        action === 'netflixSeek' &&
        location.hostname === 'www.netflix.com' &&
        Number.isFinite(custom.detail.seconds)
      ) {
        const netflixWindow = window as typeof window & {
          netflix?: {
            appContext?: {
              state?: {
                playerApp?: {
                  getAPI?: () => {
                    videoPlayer?: {
                      getAllPlayerSessionIds?: () => string[];
                      getVideoPlayerBySessionId?: (id: string) => {
                        getCurrentTime?: () => number;
                        seek?: (milliseconds: number) => void;
                      };
                    };
                  };
                };
              };
            };
          };
        };
        const api = netflixWindow.netflix?.appContext?.state?.playerApp?.getAPI?.().videoPlayer;
        const sessionId = api?.getAllPlayerSessionIds?.()[0];
        const player = sessionId ? api?.getVideoPlayerBySessionId?.(sessionId) : undefined;
        const currentTime = player?.getCurrentTime?.();
        if (!player?.seek || !Number.isFinite(currentTime)) {
          report(item, { kind: 'rejected' });
          return;
        }
        player.seek(currentTime! + Number(custom.detail.seconds) * 1_000);
        return;
      }
      if (action === 'rate' && Number.isFinite(custom.detail.rate)) {
        const rate = Number(custom.detail.rate);
        if (nativeRateSetter) nativeRateSetter.call(item, rate);
        else item.playbackRate = rate;
        active = item;
        queueMicrotask(() => {
          report(item, {
            kind: Math.abs(item.playbackRate - rate) < 0.001 ? 'media' : 'rejected',
            rate: item.playbackRate,
            seekable: canSeek(item),
            mediaType: item instanceof HTMLAudioElement ? 'audio' : 'video',
          });
        });
        return;
      }
      if (action === 'seek' && Number.isFinite(custom.detail.seconds) && canSeek(item)) {
        const seconds = Number(custom.detail.seconds);
        item.currentTime = Math.min(item.duration, Math.max(0, item.currentTime + seconds));
        return;
      }
      if (action === 'frame' && Number.isFinite(custom.detail.seconds) && canSeek(item)) {
        if (!item.paused) item.pause();
        const seconds = Number(custom.detail.seconds);
        item.currentTime = Math.min(item.duration, Math.max(0, item.currentTime + seconds));
        return;
      }
      if (action === 'pip') {
        if (!(item instanceof HTMLVideoElement)) {
          report(item, { kind: 'rejected' });
          return;
        }
        if (document.pictureInPictureElement === item) void document.exitPictureInPicture();
        else void item.requestPictureInPicture().catch(() => report(item, { kind: 'rejected' }));
        return;
      }
      if (action === 'loop' && canSeek(item)) {
        toggleLoop(item);
        return;
      }
      if (action === 'mark' && canSeek(item)) {
        marks.set(item, item.currentTime);
        return;
      }
      if (action === 'jump' && marks.has(item) && canSeek(item)) {
        const destination = marks.get(item)!;
        const previous = positionsBeforeJump.get(item);
        positionsBeforeJump.set(item, item.currentTime);
        item.currentTime = previous ?? destination;
        if (previous !== undefined) positionsBeforeJump.delete(item);
        return;
      }
      if (action === 'pause') {
        if (item.paused) void item.play();
        else item.pause();
        return;
      }
      if (action === 'mute') {
        const graph = volumeRegistry.graphs.get(item);
        if (graph) {
          graph.muted = !graph.muted;
          applyVolumeGraph(item, graph);
        } else item.muted = !item.muted;
        reportVolume(item);
        return;
      }
      if (action === 'volume' && Number.isFinite(custom.detail.delta)) {
        const graph = volumeRegistry.graphs.get(item);
        if (graph) {
          graph.percent = Math.min(600, Math.max(0, graph.percent + Number(custom.detail.delta) * 100));
          if (graph.percent > 0) graph.muted = false;
          applyVolumeGraph(item, graph);
        } else {
          item.volume = Math.min(1, Math.max(0, item.volume + Number(custom.detail.delta)));
        }
        reportVolume(item);
        return;
      }
      if (action === 'theater' && item instanceof HTMLVideoElement) {
        if (theater) {
          theater.item.style.cssText = theater.css;
          theater = null;
          report(item, { kind: 'theater', active: false });
          return;
        }
        theater = { item, css: item.style.cssText };
        item.style.cssText += ';position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;max-width:none!important;max-height:none!important;object-fit:contain!important;z-index:2147483646!important;background:#000!important';
        report(item, { kind: 'theater', active: true });
        return;
      }
      report(item, { kind: 'rejected' });
    } catch {
      report(item, { kind: 'rejected' });
    }
  };

  if (isGecko) watchRoot(document);
  document.addEventListener(controlEvent, handleControl, true);

  window.addEventListener('pagehide', cleanup, { once: true });
});
