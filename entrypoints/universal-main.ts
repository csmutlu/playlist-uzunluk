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

  const report = (
    target: EventTarget,
    detail: Record<string, unknown>,
  ) => {
    if (disposed) return false;
    return target.dispatchEvent(new CustomEvent(stateEvent, {
      detail,
      bubbles: true,
      composed: true,
    }));
  };

  const canSeek = (item: HTMLMediaElement) =>
    Number.isFinite(item.duration) && item.duration > 0 && item.seekable.length > 0;

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
    if (item instanceof HTMLMediaElement) active = item;
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

  const track = (item: HTMLMediaElement) => {
    if (media.has(item)) return;
    media.add(item);
    item.addEventListener('play', handlePlay, { passive: true });
    item.addEventListener('pointerdown', handlePointer, { passive: true });
    item.addEventListener('ratechange', handleRateChange, { passive: true });
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
      item.removeEventListener('ratechange', handleRateChange);
    }
    media.clear();
    if (theater) theater.item.style.cssText = theater.css;
    theater = null;
    if (Element.prototype.attachShadow === wrappedAttachShadow) {
      Element.prototype.attachShadow = originalAttachShadow;
    }
  };

  const selected = (event: Event, allowAudio: boolean): HTMLMediaElement | null => {
    const allowed = (item: HTMLMediaElement) =>
      allowAudio || !(item instanceof HTMLAudioElement);
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
    const custom = event as CustomEvent<Record<string, unknown>>;
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
        item.muted = !item.muted;
        return;
      }
      if (action === 'volume' && Number.isFinite(custom.detail.delta)) {
        item.volume = Math.min(1, Math.max(0, item.volume + Number(custom.detail.delta)));
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

  document.addEventListener(controlEvent, handleControl, true);

  window.addEventListener('pagehide', cleanup, { once: true });
});
