import { browser } from 'wxt/browser';
import {
  INITIAL_SCAN_CHUNK,
  MUTATION_BATCH_MS,
  STORAGE_FLUSH_MS,
} from './constants';
import {
  PlaylistAnalyzer,
  setProgressStatus,
  watchedAndRemainingSeconds,
} from './analysis';
import { clampSpeed } from './duration';
import { resolveLocale, t } from './i18n';
import { clampUniversalSpeed } from './universal';
import {
  emptyProgress,
  getPlaylistProgress,
  getSettings,
  savePlaylistHistoryEntry,
  savePlaylistProgress,
  saveSettings,
} from './storage';
import type {
  ApiPlaylistResponse,
  ExtensionSettings,
  Locale,
  PlaylistAnalysis,
  PlaylistHistoryEntry,
  PlaylistProgress,
} from './types';
import {
  ROW_SELECTOR,
  expectedVideoCount,
  findPlaylistMetadataContainer,
  findVideoListContainer,
  getCurrentVideo,
  getPlaylistId,
  playlistTitle,
  rowsWithin,
} from './youtube-dom';

type BusyState = null | 'scroll' | 'api';

export interface ControllerSnapshot {
  playlistId: string | null;
  analysis: PlaylistAnalysis | null;
  progress: PlaylistProgress | null;
  settings: ExtensionSettings;
  locale: Locale;
  speed: number;
  currentVideo: { videoId: string; index: number; positionSeconds: number } | null;
  busy: BusyState;
  error: string | null;
}

type Subscriber = (snapshot: ControllerSnapshot) => void;

function runWhenIdle(callback: () => void): number {
  if (typeof window.requestIdleCallback === 'function') {
    return window.requestIdleCallback(callback, { timeout: 250 });
  }
  return globalThis.setTimeout(callback, 0) as unknown as number;
}

function cancelIdle(handle: number): void {
  if (typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(handle);
  else globalThis.clearTimeout(handle);
}

export class ContentController {
  private analyzer: PlaylistAnalyzer | null = null;
  private apiExpectedCount: number | null = null;
  private analysis: PlaylistAnalysis | null = null;
  private progress: PlaylistProgress | null = null;
  private settings: ExtensionSettings;
  private playlistId: string | null = null;
  private locale: Locale = 'en';
  private speed = 1;
  private currentVideo: ControllerSnapshot['currentVideo'] = null;
  private busy: BusyState = null;
  private error: string | null = null;
  private subscribers = new Set<Subscriber>();
  private listObserver: MutationObserver | null = null;
  private metadataObserver: MutationObserver | null = null;
  private metadataContainer: HTMLElement | null = null;
  private listContainer: HTMLElement | null = null;
  private pendingRoots = new Set<ParentNode>();
  private pendingRemovedRows = new Set<HTMLElement>();
  private readonly rowVideoByElement = new WeakMap<HTMLElement, string>();
  private readonly rowElementsByVideo = new Map<string, Set<HTMLElement>>();
  private readonly staleVideoIds = new Set<string>();
  private mutationTimer: number | null = null;
  private metadataTimer: number | null = null;
  private idleHandle: number | null = null;
  private flushTimer: number | null = null;
  private progressDirty = false;
  private historyDirty = false;
  private routeOpenedAt = Date.now();
  private currentMedia: HTMLVideoElement | null = null;
  private lastVisualUpdate = 0;
  private scrollCancelled = false;
  private routeToken = 0;

  constructor(initialSettings: ExtensionSettings) {
    this.settings = initialSettings;
    this.speed = initialSettings.defaultSpeed;
    this.locale = resolveLocale(
      initialSettings.locale,
      document.documentElement.lang,
      navigator.languages,
    );
    document.addEventListener('visibilitychange', this.handleVisibility, { passive: true });
    window.addEventListener('pagehide', this.handlePageHide, { passive: true });
  }

  static async create(): Promise<ContentController> {
    return new ContentController(await getSettings());
  }

  subscribe(subscriber: Subscriber): () => void {
    this.subscribers.add(subscriber);
    subscriber(this.snapshot());
    return () => this.subscribers.delete(subscriber);
  }

  snapshot(): ControllerSnapshot {
    return {
      playlistId: this.playlistId,
      analysis: this.analysis,
      progress: this.progress,
      settings: this.settings,
      locale: this.locale,
      speed: this.speed,
      currentVideo: this.currentVideo,
      busy: this.busy,
      error: this.error,
    };
  }

  diagnosticReport(): string {
    const analysis = this.analysis;
    const adapter =
      this.listContainer?.querySelector(ROW_SELECTOR)?.tagName.toLocaleLowerCase() ?? 'none';
    const version =
      typeof chrome !== 'undefined' && chrome.runtime?.getManifest
        ? chrome.runtime.getManifest().version
        : 'development';
    return JSON.stringify(
      {
        extension: 'Playlist Zamanı',
        version,
        page: location.pathname === '/watch' ? 'watch' : 'playlist',
        locale: this.locale,
        adapter,
        expectedVideos: analysis?.expectedCount ?? null,
        countedVideos: analysis?.countedCount ?? 0,
        complete: analysis?.listComplete ?? false,
        unknownDurations: analysis?.unknownDurationCount ?? 0,
        unavailableVideos: analysis?.unavailableCount ?? 0,
        busy: this.busy,
        error: this.error,
        generatedAt: new Date().toISOString(),
      },
      null,
      2,
    );
  }

  async navigate(): Promise<void> {
    const token = ++this.routeToken;
    const previousPlaylistId = this.playlistId;
    const nextPlaylistId = getPlaylistId();
    if (previousPlaylistId && previousPlaylistId !== nextPlaylistId) {
      void browser.runtime.sendMessage({
        type: 'playlist-api:cancel',
        playlistId: previousPlaylistId,
      });
    }
    await this.flushProgress();
    this.disconnectPage();

    const playlistId = nextPlaylistId;
    this.playlistId = playlistId;
    this.routeOpenedAt = Date.now();
    this.analysis = null;
    this.analyzer = playlistId ? new PlaylistAnalyzer(playlistId) : null;
    this.apiExpectedCount = null;
    this.progress = playlistId ? await getPlaylistProgress(playlistId) : null;
    if (token !== this.routeToken) return;
    this.error = null;
    this.currentVideo = null;

    if (!playlistId || !this.analyzer) {
      this.emit();
      return;
    }

    this.analyzer.setExpectedCount(expectedVideoCount());
    this.listContainer = findVideoListContainer();
    if (this.listContainer) {
      await this.initialScan(this.listContainer, token);
      if (token !== this.routeToken) return;
      this.observeList(this.listContainer);
      this.listContainer.addEventListener('click', this.handleDelegatedClick);
    }
    this.observeMetadata();
    this.attachMedia();
    this.refreshAnalysis();
    await this.flushProgress();
  }

  async refreshDom(): Promise<void> {
    if (!this.playlistId || !this.analyzer) return;
    this.analyzer.setExpectedCount(expectedVideoCount());
    const container = findVideoListContainer();
    if (container && container !== this.listContainer) {
      this.listObserver?.disconnect();
      this.listContainer?.removeEventListener('click', this.handleDelegatedClick);
      this.listContainer = container;
      this.resetRowRegistry();
      const rows = rowsWithin(container, this.playlistId);
      this.analyzer.upsertMany(rows.map((item) => item.video));
      this.decorateRows(rows);
      this.observeList(container);
      container.addEventListener('click', this.handleDelegatedClick);
    }
    this.observeMetadata();
    this.attachMedia();
    this.refreshAnalysis();
  }

  async setSpeed(value: number): Promise<void> {
    this.speed = clampSpeed(value);
    this.settings = { ...this.settings, defaultSpeed: this.speed };
    if (this.currentMedia && this.currentMedia.playbackRate !== this.speed) {
      this.currentMedia.playbackRate = this.speed;
    }
    this.emit();
    await saveSettings(this.settings);
  }

  async updateSettings(next: ExtensionSettings): Promise<void> {
    this.settings = next;
    this.locale = resolveLocale(next.locale, document.documentElement.lang, navigator.languages);
    this.syncAllRowButtons();
    await this.setSpeed(next.defaultSpeed);
  }

  toggleManual(videoId: string): void {
    if (!this.progress) return;
    const current = this.progress.videos[videoId];
    this.progress = setProgressStatus(
      this.progress,
      videoId,
      !(current?.watched ?? false),
      'manual',
      current?.positionSeconds ?? 0,
    );
    this.markDirty();
    this.syncRowButtons(videoId);
    this.emit();
  }

  async completeWithApi(force = false): Promise<void> {
    if (!this.playlistId || !this.analyzer) return;
    this.busy = 'api';
    this.error = null;
    this.emit();
    try {
      const response = (await browser.runtime.sendMessage({
        type: 'playlist-api:fetch',
        playlistId: this.playlistId,
        force,
      })) as ApiPlaylistResponse;
      if (!response.ok) {
        this.error = response.errorCode ?? 'unknown';
        return;
      }
      if (response.playlistId !== this.playlistId) return;
      this.apiExpectedCount = response.expectedCount ?? null;
      this.analyzer.setExpectedCount(this.apiExpectedCount);
      this.analyzer.upsertMany(response.videos ?? []);
      this.refreshAnalysis();
      await this.flushProgress();
    } catch (error) {
      this.error = error instanceof DOMException && error.name === 'AbortError' ? 'network' : 'unknown';
    } finally {
      this.busy = null;
      this.emit();
    }
  }

  cancelLoadAll(): void {
    this.scrollCancelled = true;
  }

  async loadAllVideos(): Promise<void> {
    if (this.busy === 'scroll') {
      this.cancelLoadAll();
      return;
    }
    if (!this.playlistId) return;
    this.busy = 'scroll';
    this.error = null;
    this.scrollCancelled = false;
    this.emit();

    const originalY = window.scrollY;
    let stableRounds = 0;
    let previousCount = this.analyzer?.count ?? 0;
    try {
      for (let round = 0; round < 500 && !this.scrollCancelled; round += 1) {
        const expected = this.analysis?.expectedCount;
        if (expected !== null && expected !== undefined && previousCount >= expected) break;
        window.scrollBy({ top: Math.max(400, window.innerHeight * 0.85), behavior: 'auto' });
        await new Promise((resolve) => window.setTimeout(resolve, 350));
        await this.refreshDom();
        const count = this.analyzer?.count ?? 0;
        const atBottom =
          window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 8;
        if (count === previousCount && atBottom) stableRounds += 1;
        else stableRounds = 0;
        previousCount = count;
        if (stableRounds >= 3) break;
      }
    } finally {
      window.scrollTo({ top: originalY, behavior: 'auto' });
      this.busy = null;
      await this.flushProgress();
      this.emit();
    }
  }

  dispose(): void {
    this.routeToken += 1;
    this.disconnectPage();
    document.removeEventListener('visibilitychange', this.handleVisibility);
    window.removeEventListener('pagehide', this.handlePageHide);
    void this.flushProgress();
    this.subscribers.clear();
  }

  private async initialScan(container: HTMLElement, token: number): Promise<void> {
    const rows = rowsWithin(container, this.playlistId ?? '');
    let cursor = 0;
    await new Promise<void>((resolve) => {
      const processChunk = () => {
        if (token !== this.routeToken || !this.analyzer) {
          resolve();
          return;
        }
        const chunk = rows.slice(cursor, cursor + INITIAL_SCAN_CHUNK);
        this.analyzer.upsertMany(chunk.map((item) => item.video));
        this.decorateRows(chunk);
        cursor += chunk.length;
        if (cursor < rows.length) this.idleHandle = runWhenIdle(processChunk);
        else resolve();
      };
      processChunk();
    });
  }

  private observeList(container: HTMLElement): void {
    this.listObserver = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'childList') {
          for (const node of record.addedNodes) {
            if (node instanceof HTMLElement) {
              if (node.closest('.pz-row-toggle')) continue;
              this.pendingRoots.add(node);
              this.queueChangedRow(node);
            } else if (node.parentElement) this.queueChangedRow(node.parentElement);
          }
          for (const node of record.removedNodes) {
            if (!(node instanceof HTMLElement)) continue;
            if (node.matches(ROW_SELECTOR)) this.pendingRemovedRows.add(node);
            for (const row of node.querySelectorAll<HTMLElement>(ROW_SELECTOR)) {
              this.pendingRemovedRows.add(row);
            }
            this.queueChangedRow(record.target);
          }
        } else {
          const target =
            record.target instanceof HTMLElement ? record.target : record.target.parentElement;
          if (target && !target.closest('.pz-row-toggle')) this.queueChangedRow(target);
        }
      }
      if (
        (this.pendingRoots.size > 0 || this.pendingRemovedRows.size > 0) &&
        this.mutationTimer === null
      ) {
        this.scheduleMutationFlush();
      }
    });
    this.listObserver.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['href'],
    });
  }

  private scheduleMutationFlush(): void {
    this.mutationTimer = window.setTimeout(() => {
      this.mutationTimer = null;
      const roots = [...this.pendingRoots];
      const removedRows = [...this.pendingRemovedRows];
      this.pendingRoots.clear();
      this.pendingRemovedRows.clear();
      if (!this.analyzer || !this.playlistId) return;
      let changed = 0;
      for (const root of roots) {
        const rows = rowsWithin(root, this.playlistId);
        changed += this.analyzer.upsertMany(rows.map((item) => item.video));
        this.decorateRows(rows);
      }
      for (const row of removedRows) {
        if (row.isConnected && this.listContainer?.contains(row)) continue;
        const videoId = this.rowVideoByElement.get(row);
        if (videoId) this.unregisterRow(row, videoId);
      }
      if (changed > 0 || removedRows.length > 0) this.refreshAnalysis();
    }, MUTATION_BATCH_MS);
  }

  private queueChangedRow(node: Node): void {
    const element = node instanceof HTMLElement ? node : node.parentElement;
    if (element?.closest('.pz-row-toggle')) return;
    const row = element?.closest<HTMLElement>(ROW_SELECTOR);
    if (row) this.pendingRoots.add(row);
  }

  private refreshAnalysis(): void {
    if (!this.analyzer) return;
    const parsedExpected = expectedVideoCount();
    const expected =
      (parsedExpected === 0 && this.analyzer.count > 0 ? null : parsedExpected) ??
      this.apiExpectedCount;
    this.analyzer.setExpectedCount(expected);
    this.pruneConfirmedStaleVideos(expected);
    const previous = this.analysis;
    this.analysis = this.analyzer.snapshot();
    if (
      !previous ||
      previous.updatedAt !== this.analysis.updatedAt ||
      previous.expectedCount !== this.analysis.expectedCount
    ) {
      this.historyDirty = true;
      this.scheduleStorageFlush();
    }
    this.emit();
  }

  private decorateRows(rows: ReturnType<typeof rowsWithin>): void {
    for (const { element, video } of rows) {
      let button = element.querySelector<HTMLButtonElement>(':scope > .pz-row-toggle');
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.className = 'pz-row-toggle';
        button.dataset.videoId = video.videoId;
        Object.assign(button.style, {
          width: '28px',
          height: '28px',
          border: '1px solid rgba(128,128,128,.45)',
          borderRadius: '50%',
          background: 'transparent',
          color: 'currentColor',
          cursor: 'pointer',
          flex: '0 0 auto',
          margin: '8px',
          fontSize: '16px',
          lineHeight: '24px',
        });
        element.append(button);
      }
      button.dataset.videoId = video.videoId;
      this.registerRow(element, video.videoId);
      this.updateButton(button, video.videoId);
    }
  }

  private updateButton(button: HTMLButtonElement, videoId: string): void {
    const watched = this.progress?.videos[videoId]?.watched ?? false;
    button.textContent = watched ? '✓' : '○';
    button.title = t(this.locale, watched ? 'markUnwatched' : 'markWatched');
    button.setAttribute('aria-label', button.title);
    button.setAttribute('aria-pressed', String(watched));
  }

  private syncRowButtons(videoId: string): void {
    if (!this.listContainer) return;
    for (const button of this.listContainer.querySelectorAll<HTMLButtonElement>(
      '.pz-row-toggle',
    )) {
      if (button.dataset.videoId === videoId) this.updateButton(button, videoId);
    }
  }

  private syncAllRowButtons(): void {
    if (!this.listContainer) return;
    for (const button of this.listContainer.querySelectorAll<HTMLButtonElement>(
      '.pz-row-toggle',
    )) {
      const videoId = button.dataset.videoId;
      if (videoId) this.updateButton(button, videoId);
    }
  }

  private readonly handleDelegatedClick = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest<HTMLButtonElement>('.pz-row-toggle');
    const videoId = button?.dataset.videoId;
    if (!videoId) return;
    event.preventDefault();
    event.stopPropagation();
    this.toggleManual(videoId);
  };

  private attachMedia(): void {
    const media = document.querySelector<HTMLVideoElement>('video.html5-main-video, video');
    if (media === this.currentMedia) return;
    this.detachMedia();
    if (!media) return;
    this.currentMedia = media;
    media.addEventListener('timeupdate', this.handleTimeUpdate, { passive: true });
    media.addEventListener('ratechange', this.handleRateChange, { passive: true });
    media.addEventListener('pause', this.handlePersistEvent, { passive: true });
    media.addEventListener('ended', this.handlePersistEvent, { passive: true });
    const desiredSpeed = clampUniversalSpeed(this.speed || this.settings.defaultSpeed);
    if (media.playbackRate !== desiredSpeed) media.playbackRate = desiredSpeed;
    this.speed = desiredSpeed;
    this.updateCurrentVideo(true);
  }

  private detachMedia(): void {
    if (!this.currentMedia) return;
    this.currentMedia.removeEventListener('timeupdate', this.handleTimeUpdate);
    this.currentMedia.removeEventListener('ratechange', this.handleRateChange);
    this.currentMedia.removeEventListener('pause', this.handlePersistEvent);
    this.currentMedia.removeEventListener('ended', this.handlePersistEvent);
    this.currentMedia = null;
  }

  private readonly handleTimeUpdate = (): void => {
    const now = Date.now();
    if (now - this.lastVisualUpdate < 1_000 || document.hidden) return;
    this.lastVisualUpdate = now;
    this.updateCurrentVideo(false);
  };

  private updateCurrentVideo(force: boolean): void {
    const routeVideo = getCurrentVideo();
    const media = this.currentMedia;
    if (!routeVideo || !media || !this.progress) return;
    const positionSeconds = Math.max(0, media.currentTime || 0);
    this.currentVideo = { ...routeVideo, positionSeconds };

    const existing = this.progress.videos[routeVideo.videoId];
    const watched =
      media.duration > 0 && positionSeconds / media.duration >= this.settings.completionThreshold;
    let shouldPersist = false;
    if (watched && !existing?.watched) {
      const previous = this.progress;
      this.progress = setProgressStatus(
        this.progress,
        routeVideo.videoId,
        true,
        'auto',
        positionSeconds,
      );
      if (this.progress !== previous) {
        shouldPersist = true;
        this.syncRowButtons(routeVideo.videoId);
      }
    } else if (!existing?.watched || force) {
      this.progress.videos[routeVideo.videoId] = {
        watched: existing?.watched ?? false,
        source: existing?.source ?? 'auto',
        positionSeconds,
        updatedAt: Date.now(),
      };
      this.progress = {
        ...this.progress,
        lastVideoId: routeVideo.videoId,
        updatedAt: Date.now(),
      };
      shouldPersist = true;
    }
    if (shouldPersist) this.markDirty();
    this.emit();
  }

  private readonly handleRateChange = (): void => {
    if (!this.currentMedia) return;
    this.speed = clampUniversalSpeed(this.currentMedia.playbackRate);
    this.emit();
  };

  private readonly handlePersistEvent = (): void => {
    this.updateCurrentVideo(true);
    void this.flushProgress();
  };

  private readonly handleVisibility = (): void => {
    if (document.hidden) void this.flushProgress();
  };

  private readonly handlePageHide = (): void => {
    void this.flushProgress();
  };

  private markDirty(): void {
    this.progressDirty = true;
    this.historyDirty = true;
    this.scheduleStorageFlush();
  }

  private scheduleStorageFlush(): void {
    if (this.flushTimer !== null) return;
    this.flushTimer = window.setTimeout(() => {
      this.flushTimer = null;
      void this.flushProgress();
    }, STORAGE_FLUSH_MS);
  }

  private async flushProgress(): Promise<void> {
    if (this.flushTimer !== null) {
      window.clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    const writes: Promise<void>[] = [];
    if (this.progressDirty && this.progress) {
      this.progressDirty = false;
      writes.push(savePlaylistProgress(this.progress));
    }
    if (this.historyDirty) writes.push(this.flushHistory());
    if (writes.length > 0) await Promise.all(writes);
  }

  private disconnectPage(): void {
    this.listObserver?.disconnect();
    this.listObserver = null;
    this.metadataObserver?.disconnect();
    this.metadataObserver = null;
    this.metadataContainer = null;
    this.listContainer?.removeEventListener('click', this.handleDelegatedClick);
    this.listContainer = null;
    this.pendingRoots.clear();
    this.pendingRemovedRows.clear();
    this.rowElementsByVideo.clear();
    this.staleVideoIds.clear();
    if (this.mutationTimer !== null) window.clearTimeout(this.mutationTimer);
    this.mutationTimer = null;
    if (this.metadataTimer !== null) window.clearTimeout(this.metadataTimer);
    this.metadataTimer = null;
    if (this.idleHandle !== null) cancelIdle(this.idleHandle);
    this.idleHandle = null;
    this.detachMedia();
  }

  private observeMetadata(): void {
    const container = findPlaylistMetadataContainer();
    if (container === this.metadataContainer && this.metadataObserver) return;
    this.metadataObserver?.disconnect();
    this.metadataContainer = container;
    if (!container) return;
    this.metadataObserver = new MutationObserver(() => {
      if (this.metadataTimer !== null) return;
      this.metadataTimer = window.setTimeout(() => {
        this.metadataTimer = null;
        this.observeMetadata();
        this.refreshAnalysis();
      }, MUTATION_BATCH_MS);
    });
    this.metadataObserver.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    if (container.parentElement) {
      this.metadataObserver.observe(container.parentElement, {
        childList: true,
      });
    }
  }

  private registerRow(element: HTMLElement, videoId: string): void {
    const previousVideoId = this.rowVideoByElement.get(element);
    if (previousVideoId && previousVideoId !== videoId) {
      this.unregisterRow(element, previousVideoId);
    }
    this.rowVideoByElement.set(element, videoId);
    let elements = this.rowElementsByVideo.get(videoId);
    if (!elements) {
      elements = new Set();
      this.rowElementsByVideo.set(videoId, elements);
    }
    elements.add(element);
    this.staleVideoIds.delete(videoId);
  }

  private unregisterRow(element: HTMLElement, videoId: string): void {
    const elements = this.rowElementsByVideo.get(videoId);
    elements?.delete(element);
    if (elements && elements.size === 0) {
      this.rowElementsByVideo.delete(videoId);
      this.staleVideoIds.add(videoId);
    }
  }

  private resetRowRegistry(): void {
    for (const videoId of this.rowElementsByVideo.keys()) this.staleVideoIds.add(videoId);
    this.rowElementsByVideo.clear();
  }

  private pruneConfirmedStaleVideos(expected: number | null): void {
    if (!this.analyzer) return;
    if (expected === null || this.analyzer.count <= expected) return;
    for (const videoId of this.staleVideoIds) {
      if (this.rowElementsByVideo.has(videoId)) {
        this.staleVideoIds.delete(videoId);
        continue;
      }
      if (this.analyzer.remove(videoId)) this.staleVideoIds.delete(videoId);
      if (this.analyzer.count <= expected) break;
    }
  }

  private async flushHistory(): Promise<void> {
    if (!this.historyDirty || !this.playlistId || !this.analysis) return;
    this.historyDirty = false;
    const times = watchedAndRemainingSeconds(
      this.analysis,
      this.progress,
      this.currentVideo
        ? {
            videoId: this.currentVideo.videoId,
            positionSeconds: this.currentVideo.positionSeconds,
          }
        : undefined,
    );
    const lastVideoId = this.progress?.lastVideoId ?? this.currentVideo?.videoId;
    const lastVideoIndex = lastVideoId
      ? this.analysis.videos.find((video) => video.videoId === lastVideoId)?.index
      : undefined;
    const entry: PlaylistHistoryEntry = {
      schemaVersion: 1,
      playlistId: this.playlistId,
      title: playlistTitle() || this.playlistId,
      videoCount: this.analysis.countedCount,
      totalSeconds: times.selectedTotalSeconds,
      remainingSeconds: times.remainingSeconds,
      progressPercent:
        times.selectedTotalSeconds > 0
          ? Math.min(100, Math.max(0, (times.watchedSeconds / times.selectedTotalSeconds) * 100))
          : 0,
      lastVideoId,
      lastVideoIndex,
      lastOpenedAt: this.routeOpenedAt,
      updatedAt: Date.now(),
    };
    await savePlaylistHistoryEntry(entry);
  }

  private emit(): void {
    const snapshot = this.snapshot();
    for (const subscriber of this.subscribers) subscriber(snapshot);
  }
}

export function snapshotTimes(
  snapshot: ControllerSnapshot,
  range?: { start: number; end: number },
): ReturnType<typeof watchedAndRemainingSeconds> {
  if (!snapshot.analysis) {
    return { watchedSeconds: 0, remainingSeconds: 0, selectedTotalSeconds: 0 };
  }
  return watchedAndRemainingSeconds(
    snapshot.analysis,
    snapshot.progress,
    snapshot.currentVideo
      ? {
          videoId: snapshot.currentVideo.videoId,
          positionSeconds: snapshot.currentVideo.positionSeconds,
        }
      : undefined,
    range,
  );
}

export function newControllerForTests(settings: ExtensionSettings): ContentController {
  return new ContentController(settings);
}

export function progressForTests(playlistId: string): PlaylistProgress {
  return emptyProgress(playlistId);
}
