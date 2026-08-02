import { DEFAULT_FRAME_RATE } from './constants';
import { resolveLocale } from './i18n';
import { handlerFor, type SiteHandler } from './site-handlers';
import type {
  CustomShortcutAction,
  ExtensionSettings,
  MasterVolumeInfo,
  SiteMediaRule,
  UniversalControllerSettings,
} from './types';
import {
  advanceLoop,
  classifyExternalRate,
  clampUniversalSpeed,
  commandForKeyboardEvent,
  effectiveFightback,
  frameStepSeconds,
  HOLD_INTENT_MS,
  isEditableTarget,
  isDecorativeMedia,
  isSeekable,
  isWheelSpeedGesture,
  loopSeekTarget,
  mediaDownloadInfo,
  PRESS_SLOP_PX,
  selectMedia,
  stepUniversalSpeed,
  type LoopMark,
  type MatchedShortcut,
} from './universal';
import { ut } from './universal-i18n';

interface BridgeState {
  kind: 'media' | 'rejected' | 'shadow' | 'theater' | 'volume';
  rate?: number;
  seekable?: boolean;
  mediaType?: 'audio' | 'video';
  active?: boolean;
  percent?: number;
  muted?: boolean;
  boosted?: boolean;
  boostSupported?: boolean;
  bass?: number;
  voice?: number;
}

interface UniversalControllerOptions {
  channel: string;
  hostname: string;
  settings: UniversalControllerSettings;
  extensionSettings: ExtensionSettings;
  rule: SiteMediaRule | null;
  rememberedSpeed: number | null;
  saveSpeed: (speed: number) => Promise<void>;
}

interface IdleDeadlineLike {
  didTimeout: boolean;
  timeRemaining(): number;
}

type IdleCallback = (deadline: IdleDeadlineLike) => void;

const OVERLAY_TAG = 'playlist-zamani-speed';
const OVERLAY_MESSAGE = 'pz:o';
const THEATER_MESSAGE = 'pz:t';
const SCAN_CHUNK_SIZE = 250;
const KEY_HOLD_DELAY_MS = 450;
const KEY_HOLD_REPEAT_MS = 120;
const BUFFER_RECOVERY_RATE = 1;
const BUFFER_RECOVERY_MIN_SPEED = 1.25;
const REPEATABLE_ACTIONS = new Set<CustomShortcutAction>([
  'slower',
  'faster',
  'rewind',
  'advance',
  'volumeDown',
  'volumeUp',
  'frameBack',
  'frameForward',
]);

type StyleRule = readonly [property: string, value: string];

interface StyleRestore {
  element: HTMLElement;
  properties: Array<{
    property: string;
    value: string;
    priority: string;
  }>;
}

interface TheaterState {
  target: HTMLElement;
  media: HTMLVideoElement | null;
  source: WindowProxy | null;
  styles: StyleRestore[];
}

const THEATER_TARGET_STYLES: readonly StyleRule[] = [
  ['position', 'fixed'],
  ['inset', '0'],
  ['width', '100vw'],
  ['height', '100vh'],
  ['max-width', 'none'],
  ['max-height', 'none'],
  ['margin', '0'],
  ['transform', 'none'],
  ['z-index', '2147483646'],
  ['background', '#000'],
] as const;

const THEATER_MEDIA_STYLES: readonly StyleRule[] = [
  ['width', '100%'],
  ['height', '100%'],
  ['max-width', 'none'],
  ['max-height', 'none'],
  ['object-fit', 'contain'],
] as const;

const THEATER_SCROLL_STYLES: readonly StyleRule[] = [
  ['overflow', 'hidden'],
  ['overscroll-behavior', 'none'],
] as const;

function styleWithPriority(element: HTMLElement, rules: readonly StyleRule[]): StyleRestore {
  const properties = rules.map(([property]) => ({
    property,
    value: element.style.getPropertyValue(property),
    priority: element.style.getPropertyPriority(property),
  }));
  for (const [property, value] of rules) {
    element.style.setProperty(property, value, 'important');
  }
  return { element, properties };
}

function restoreStyle(snapshot: StyleRestore): void {
  for (const { property, value, priority } of snapshot.properties) {
    if (value) snapshot.element.style.setProperty(property, value, priority);
    else snapshot.element.style.removeProperty(property);
  }
}

function comparablePlayerRect(media: DOMRect, candidate: DOMRect): boolean {
  const mediaArea = media.width * media.height;
  const candidateArea = candidate.width * candidate.height;
  if (mediaArea <= 0 || candidateArea <= 0) return false;
  return (
    candidate.width >= media.width * 0.75 &&
    candidate.height >= media.height * 0.75 &&
    candidateArea <= mediaArea * 4
  );
}

export function theaterTargetFor(media: HTMLVideoElement): HTMLElement {
  const mediaRect = media.getBoundingClientRect();
  let candidate: HTMLElement = media;
  let ancestor = media.parentElement;
  for (let depth = 0; ancestor && depth < 8; depth += 1) {
    if (ancestor === document.body || ancestor === document.documentElement) break;
    if (!comparablePlayerRect(mediaRect, ancestor.getBoundingClientRect())) break;
    candidate = ancestor;
    ancestor = ancestor.parentElement;
  }
  return candidate;
}

function idleRequest(callback: IdleCallback): number {
  if (typeof window.requestIdleCallback === 'function') {
    return window.requestIdleCallback(callback, { timeout: 200 });
  }
  return window.setTimeout(
    () => callback({ didTimeout: true, timeRemaining: () => 4 }),
    0,
  );
}

function idleCancel(id: number): void {
  if (typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(id);
  else window.clearTimeout(id);
}

function mediaFromTarget(target: EventTarget | null): HTMLMediaElement | null {
  return target instanceof HTMLMediaElement ? target : null;
}

/**
 * Keeps voices natural at high speeds. Sites sometimes clear the flag on their
 * own players, so it is reapplied with every rate change. The vendor-prefixed
 * names cover older WebKit and Gecko builds.
 */
function applyPreservesPitch(media: HTMLMediaElement, preserve: boolean): void {
  const target = media as HTMLMediaElement & {
    mozPreservesPitch?: boolean;
    webkitPreservesPitch?: boolean;
  };
  try {
    if ('preservesPitch' in target) target.preservesPitch = preserve;
    if ('mozPreservesPitch' in target) target.mozPreservesPitch = preserve;
    if ('webkitPreservesPitch' in target) target.webkitPreservesPitch = preserve;
  } catch {
    /* Some players expose read-only shims. */
  }
}

function overlayText(rate: number): string {
  return `${Number(rate.toFixed(2))}×`;
}

function bufferedSecondsAhead(media: HTMLMediaElement): number {
  const currentTime = media.currentTime;
  for (let index = media.buffered.length - 1; index >= 0; index -= 1) {
    const start = media.buffered.start(index);
    const end = media.buffered.end(index);
    if (start <= currentTime + 0.25 && end >= currentTime) {
      return Math.max(0, end - currentTime);
    }
  }
  return 0;
}

function recoveryBufferGoal(media: HTMLMediaElement, rate: number): number {
  const normalGoal = Math.min(12, Math.max(5, rate * 4));
  const remaining = media.duration - media.currentTime;
  return Number.isFinite(remaining)
    ? Math.min(normalGoal, Math.max(0, remaining))
    : normalGoal;
}

export class UniversalMediaController {
  private readonly channel: string;
  private readonly hostname: string;
  private readonly saveSpeed: (speed: number) => Promise<void>;
  private readonly controlEvent: string;
  private readonly stateEvent: string;
  private readonly siteHandler: SiteHandler | null;
  private settings: UniversalControllerSettings;
  private extensionSettings: ExtensionSettings;
  private rule: SiteMediaRule | null;
  private rememberedSpeed: number | null;
  private desiredSpeed: number;
  private media = new Set<HTMLMediaElement>();
  private lastInteracted: HTMLMediaElement | null = null;
  private markedPositions = new WeakMap<HTMLMediaElement, number>();
  private positionsBeforeJump = new WeakMap<HTMLMediaElement, number>();
  private speedsBeforeToggle = new WeakMap<HTMLMediaElement, number>();
  private appliedRates = new WeakMap<HTMLMediaElement, number>();
  private settingRate = new WeakSet<HTMLMediaElement>();
  private recoveringMedia = new WeakSet<HTMLMediaElement>();
  private visibleAreas = new WeakMap<HTMLMediaElement, number>();
  private visibilityObserver: IntersectionObserver | null = null;
  private observedRoots = new Map<Node, MutationObserver>();
  private pendingRoots = new Set<Node>();
  private walkers: TreeWalker[] = [];
  private idleId: number | null = null;
  private mutationTimer: number | null = null;
  private saveTimer: number | null = null;
  private overlayTimer: number | null = null;
  private overlayHoverTimer: number | null = null;
  private overlayHovered = false;
  private overlayHost: HTMLElement | null = null;
  private overlayValue: HTMLElement | null = null;
  private overlayStyle: HTMLStyleElement | null = null;
  private overlayVisibilityOverride: boolean | null = null;
  private overlaySuppressed = false;
  private overlayDragged = false;
  private overlayAnchor: HTMLMediaElement | null = null;
  private overlayPositionDirty = true;
  private heldShortcut: {
    code: string;
    command: MatchedShortcut;
    media: HTMLMediaElement | null;
    timer: number;
  } | null = null;
  private theaterState: TheaterState | null = null;
  private loopMedia: HTMLMediaElement | null = null;
  private loopRange: LoopMark | null = null;
  private active = false;
  private disposed = false;
  private lastKeyIntentAt = Number.NEGATIVE_INFINITY;
  private lastClickAt = Number.NEGATIVE_INFINITY;
  private prevClickAt = Number.NEGATIVE_INFINITY;
  private lastPointerEndAt = Number.NEGATIVE_INFINITY;
  private pressStartedAt: number | null = null;
  private pressOrigin: { x: number; y: number } | null = null;
  private pressSteady = true;
  private overrideMedia: HTMLMediaElement | null = null;
  private overrideActive = false;
  private overrideRate = 0;
  private overrideTimer: number | null = null;
  private protectRateUntil = 0;
  private volumeStates = new WeakMap<HTMLMediaElement, MasterVolumeInfo>();
  private bridgeVolumeState: MasterVolumeInfo | null = null;
  private volumeRevision = 0;
  private pendingVolumeResolvers = new Set<(info: MasterVolumeInfo) => void>();

  constructor(options: UniversalControllerOptions) {
    this.channel = options.channel;
    this.hostname = options.hostname;
    this.settings = options.settings;
    this.extensionSettings = options.extensionSettings;
    this.rule = options.rule;
    this.rememberedSpeed = options.rememberedSpeed;
    this.saveSpeed = options.saveSpeed;
    this.controlEvent = `playlist-zamani:control:${this.channel}`;
    this.stateEvent = `playlist-zamani:state:${this.channel}`;
    this.siteHandler = handlerFor(this.hostname);
    this.desiredSpeed = this.resolveInitialSpeed();
  }

  start(): void {
    if (this.disposed || this.active || !this.shouldRun()) return;
    this.active = true;
    window.addEventListener('keydown', this.handleKeydown, true);
    window.addEventListener('keyup', this.handleKeyup, true);
    window.addEventListener('blur', this.handleWindowBlur);
    window.addEventListener('message', this.handleTheaterMessage, true);
    document.addEventListener('play', this.handleMediaActivity, true);
    document.addEventListener('pointerdown', this.handlePagePointer, true);
    document.addEventListener('pointerup', this.handlePagePointerEnd, true);
    document.addEventListener('pointercancel', this.handlePagePointerEnd, true);
    document.addEventListener(this.stateEvent, this.handleBridgeState as EventListener);
    document.addEventListener('visibilitychange', this.handleVisibility);
    window.addEventListener('scroll', this.handleViewportChange, { passive: true });
    window.addEventListener('resize', this.handleViewportChange, { passive: true });
    if (document.visibilityState !== 'hidden') {
      this.startVisibilityTracking();
      this.resumeDiscovery();
    }
  }

  update(
    settings: UniversalControllerSettings,
    extensionSettings: ExtensionSettings,
    rule: SiteMediaRule | null,
    rememberedSpeed: number | null,
  ): void {
    const overlayChanged =
      settings.controllerOpacity !== this.settings.controllerOpacity ||
      settings.controllerSize !== this.settings.controllerSize ||
      settings.customCss !== this.settings.customCss;
    const indicatorModeChanged = settings.indicatorMode !== this.settings.indicatorMode;
    this.settings = settings;
    this.extensionSettings = extensionSettings;
    this.rule = rule;
    this.rememberedSpeed = rememberedSpeed;
    if (indicatorModeChanged) this.overlayVisibilityOverride = null;
    if (!this.shouldRun()) {
      this.pause();
      return;
    }
    const nextSpeed = this.resolveInitialSpeed();
    if (!this.active) {
      this.desiredSpeed = nextSpeed;
      this.start();
      return;
    }
    this.desiredSpeed = nextSpeed;
    if (overlayChanged) this.removeOverlay();
    if (!settings.audioEnabled) {
      for (const item of this.media) {
        if (item instanceof HTMLAudioElement) {
          this.untrackMedia(item);
          this.media.delete(item);
        }
      }
    }
    const selected = this.selectedMedia();
    if (selected) this.applyRate(selected, nextSpeed, false);
    this.refreshOverlayVisibility();
  }

  siteInfo(): { hostname: string; enabled: boolean; speed: number; rule: SiteMediaRule | null } {
    return {
      hostname: this.hostname,
      enabled: this.shouldRun(),
      speed: this.desiredSpeed,
      rule: this.rule,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.pause();
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
      void this.saveSpeed(this.desiredSpeed);
    }
  }

  private shouldRun(): boolean {
    return this.settings.enabled && this.rule?.enabled !== false;
  }

  private resolveInitialSpeed(): number {
    if (this.rule?.defaultSpeed !== undefined) {
      return clampUniversalSpeed(this.rule.defaultSpeed);
    }
    if (this.settings.rememberPerSite && this.rememberedSpeed !== null) {
      return clampUniversalSpeed(this.rememberedSpeed);
    }
    return clampUniversalSpeed(this.extensionSettings.defaultSpeed);
  }

  private pause(): void {
    if (!this.active) return;
    this.active = false;
    window.removeEventListener('keydown', this.handleKeydown, true);
    window.removeEventListener('keyup', this.handleKeyup, true);
    window.removeEventListener('blur', this.handleWindowBlur);
    window.removeEventListener('message', this.handleTheaterMessage, true);
    document.removeEventListener('play', this.handleMediaActivity, true);
    document.removeEventListener('pointerdown', this.handlePagePointer, true);
    document.removeEventListener('pointermove', this.handlePressMove, true);
    document.removeEventListener('pointerup', this.handlePagePointerEnd, true);
    document.removeEventListener('pointercancel', this.handlePagePointerEnd, true);
    document.removeEventListener(this.stateEvent, this.handleBridgeState as EventListener);
    document.removeEventListener('visibilitychange', this.handleVisibility);
    window.removeEventListener('scroll', this.handleViewportChange);
    window.removeEventListener('resize', this.handleViewportChange);
    this.clearHeldShortcut();
    this.releaseOverride(false);
    this.resetPressEvidence();
    this.clearLoop();
    this.exitTheater(true);
    this.stopVisibilityTracking();
    this.stopDiscovery();
    for (const item of this.media) this.untrackMedia(item);
    this.media.clear();
    this.lastInteracted = null;
    this.removeOverlay();
  }

  private handleVisibility = (): void => {
    if (document.visibilityState === 'hidden') {
      this.clearHeldShortcut();
      this.releaseOverride(true);
      this.resetPressEvidence();
      this.stopVisibilityTracking();
      this.stopDiscovery();
      this.hideOverlay();
      return;
    }
    this.startVisibilityTracking();
    this.resumeDiscovery();
    this.refreshOverlayVisibility();
  };

  private handleViewportChange = (): void => {
    this.overlayPositionDirty = true;
    if (this.overlayHost?.style.pointerEvents !== 'none') this.positionOverlay();
  };

  private startVisibilityTracking(): void {
    if (this.visibilityObserver || typeof IntersectionObserver !== 'function') return;
    this.visibilityObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const target = entry.target;
        if (!(target instanceof HTMLMediaElement)) continue;
        this.visibleAreas.set(
          target,
          entry.isIntersecting
            ? entry.intersectionRect.width * entry.intersectionRect.height
            : 0,
        );
      }
    });
    for (const item of this.media) {
      if (!(item instanceof HTMLAudioElement)) this.visibilityObserver.observe(item);
    }
  }

  private stopVisibilityTracking(): void {
    this.visibilityObserver?.disconnect();
    this.visibilityObserver = null;
  }

  private resumeDiscovery(): void {
    this.observeRoot(document);
    this.enqueueRoot(document);
  }

  private stopDiscovery(): void {
    for (const observer of this.observedRoots.values()) observer.disconnect();
    this.observedRoots.clear();
    this.pendingRoots.clear();
    this.walkers = [];
    if (this.idleId !== null) idleCancel(this.idleId);
    if (this.mutationTimer !== null) window.clearTimeout(this.mutationTimer);
    this.idleId = null;
    this.mutationTimer = null;
  }

  private observeRoot(root: Document | ShadowRoot): void {
    if (this.observedRoots.has(root)) return;
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) this.pendingRoots.add(node);
      }
      if (this.pendingRoots.size === 0 || this.mutationTimer !== null) return;
      this.mutationTimer = window.setTimeout(() => {
        this.mutationTimer = null;
        for (const node of this.pendingRoots) this.enqueueRoot(node);
        this.pendingRoots.clear();
      }, 100);
    });
    const target = root instanceof Document ? root.documentElement : root;
    if (!target) {
      document.addEventListener('DOMContentLoaded', () => this.resumeDiscovery(), { once: true });
      return;
    }
    observer.observe(target, { childList: true, subtree: true });
    this.observedRoots.set(root, observer);
  }

  private enqueueRoot(root: Node): void {
    if (root instanceof HTMLMediaElement) this.trackMedia(root);
    if (root instanceof Element && root.shadowRoot) {
      this.observeRoot(root.shadowRoot);
      this.enqueueRoot(root.shadowRoot);
    }
    this.walkers.push(document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT));
    this.scheduleScan();
  }

  private scheduleScan(): void {
    if (this.idleId !== null || this.walkers.length === 0 || !this.active) return;
    this.idleId = idleRequest(this.scanChunk);
  }

  private scanChunk = (deadline: IdleDeadlineLike): void => {
    this.idleId = null;
    let processed = 0;
    while (this.walkers.length > 0 && processed < SCAN_CHUNK_SIZE) {
      if (!deadline.didTimeout && deadline.timeRemaining() < 2) break;
      const walker = this.walkers[0]!;
      const node = walker.nextNode();
      if (!node) {
        this.walkers.shift();
        continue;
      }
      processed += 1;
      if (node instanceof HTMLMediaElement) this.trackMedia(node);
      if (node instanceof Element && node.shadowRoot) {
        this.observeRoot(node.shadowRoot);
        this.enqueueRoot(node.shadowRoot);
      }
    }
    if (this.walkers.length > 0) {
      this.scheduleScan();
      return;
    }
    const selected = this.selectedMedia();
    if (selected && !this.recoveringMedia.has(selected)) {
      this.applyRate(selected, this.desiredSpeed, false);
      this.refreshOverlayVisibility();
    }
  };

  private trackMedia(media: HTMLMediaElement): void {
    if (media instanceof HTMLAudioElement && !this.settings.audioEnabled) return;
    if (this.media.has(media)) return;
    this.media.add(media);
    if (!(media instanceof HTMLAudioElement)) this.visibilityObserver?.observe(media);
    media.addEventListener('play', this.handleDirectMediaActivity, { passive: true });
    media.addEventListener('pointerdown', this.handleDirectMediaActivity, { passive: true });
    media.addEventListener('ratechange', this.handleRateChange, { passive: true });
    media.addEventListener('loadedmetadata', this.handleLoadedMetadata, { passive: true });
    media.addEventListener('waiting', this.handleBuffering, { passive: true });
    media.addEventListener('stalled', this.handleBuffering, { passive: true });
    media.addEventListener('canplay', this.handleBufferReady, { passive: true });
    media.addEventListener('playing', this.handleBufferReady, { passive: true });
    media.addEventListener('progress', this.handleBufferReady, { passive: true });
    media.addEventListener('timeupdate', this.handleBufferReady, { passive: true });
    if (
      media.readyState > 0 &&
      this.selectedMedia() === media &&
      !this.recoveringMedia.has(media)
    ) {
      this.applyRate(media, this.desiredSpeed, false);
      this.refreshOverlayVisibility();
    }
  }

  private untrackMedia(media: HTMLMediaElement): void {
    if (this.overrideActive && this.overrideMedia === media) this.releaseOverride(false);
    this.visibilityObserver?.unobserve(media);
    if (this.loopMedia === media) this.clearLoop();
    if (this.overlayAnchor === media) {
      this.overlayAnchor = null;
      this.overlayPositionDirty = true;
    }
    media.removeEventListener('play', this.handleDirectMediaActivity);
    media.removeEventListener('pointerdown', this.handleDirectMediaActivity);
    media.removeEventListener('ratechange', this.handleRateChange);
    media.removeEventListener('loadedmetadata', this.handleLoadedMetadata);
    media.removeEventListener('waiting', this.handleBuffering);
    media.removeEventListener('stalled', this.handleBuffering);
    media.removeEventListener('canplay', this.handleBufferReady);
    media.removeEventListener('playing', this.handleBufferReady);
    media.removeEventListener('progress', this.handleBufferReady);
    media.removeEventListener('timeupdate', this.handleBufferReady);
  }

  private handleMediaActivity = (event: Event): void => {
    const media = mediaFromTarget(event.target);
    if (!media) return;
    const mediaChanged = this.lastInteracted !== media;
    if (mediaChanged) this.overlayPositionDirty = true;
    this.lastInteracted = media;
    this.trackMedia(media);
    if (event.type === 'play' && !this.recoveringMedia.has(media)) {
      this.applyRate(media, this.desiredSpeed, false);
    }
    if (mediaChanged) this.refreshOverlayVisibility();
  };

  private handlePagePointer = (event: PointerEvent): void => {
    if (event.target === this.overlayHost || event.isPrimary === false) return;
    this.pressStartedAt = performance.now();
    this.pressSteady = true;
    this.pressOrigin = {
      x: Number.isFinite(event.clientX) ? event.clientX : 0,
      y: Number.isFinite(event.clientY) ? event.clientY : 0,
    };
    document.removeEventListener('pointermove', this.handlePressMove, true);
    document.addEventListener('pointermove', this.handlePressMove, true);
    const media = mediaFromTarget(event.target);
    if (!media) return;
    if (this.lastInteracted !== media) this.overlayPositionDirty = true;
    this.lastInteracted = media;
    this.trackMedia(media);
  };

  private handlePressMove = (event: PointerEvent): void => {
    if (!this.pressOrigin || event.isPrimary === false) return;
    const x = Number.isFinite(event.clientX) ? event.clientX : this.pressOrigin.x;
    const y = Number.isFinite(event.clientY) ? event.clientY : this.pressOrigin.y;
    const distance = Math.abs(x - this.pressOrigin.x) + Math.abs(y - this.pressOrigin.y);
    if (distance <= PRESS_SLOP_PX) return;
    this.pressSteady = false;
    document.removeEventListener('pointermove', this.handlePressMove, true);
  };

  private handlePagePointerEnd = (event: PointerEvent): void => {
    if (event.isPrimary === false || this.pressStartedAt === null) return;
    const now = performance.now();
    if (now - this.pressStartedAt < HOLD_INTENT_MS) {
      this.prevClickAt = this.lastClickAt;
      this.lastClickAt = now;
    }
    this.lastPointerEndAt = now;
    this.resetPressEvidence();
    this.releaseOverride(true);
  };

  private resetPressEvidence(): void {
    document.removeEventListener('pointermove', this.handlePressMove, true);
    this.pressStartedAt = null;
    this.pressOrigin = null;
    this.pressSteady = true;
  }

  private handleWindowBlur = (): void => {
    this.clearHeldShortcut();
    this.releaseOverride(true);
    this.resetPressEvidence();
  };

  private handleDirectMediaActivity = (event: Event): void => {
    const media = mediaFromTarget(event.currentTarget);
    if (!media) return;
    const mediaChanged = this.lastInteracted !== media;
    if (mediaChanged) this.overlayPositionDirty = true;
    this.lastInteracted = media;
    if (event.type === 'play' && !this.recoveringMedia.has(media)) {
      this.applyRate(media, this.desiredSpeed, false);
    }
    if (mediaChanged) this.refreshOverlayVisibility();
  };

  private handleLoadedMetadata = (event: Event): void => {
    const media = mediaFromTarget(event.currentTarget);
    if (
      media &&
      this.selectedMedia() === media &&
      !this.recoveringMedia.has(media)
    ) {
      this.applyRate(media, this.desiredSpeed, false);
    }
  };

  private handleBuffering = (event: Event): void => {
    const media = mediaFromTarget(event.currentTarget);
    if (
      !media ||
      (this.overrideActive && this.overrideMedia === media) ||
      media.ended ||
      this.selectedMedia() !== media ||
      media.duration === Number.POSITIVE_INFINITY ||
      this.desiredSpeed < BUFFER_RECOVERY_MIN_SPEED
    ) return;
    const goal = recoveryBufferGoal(media, this.desiredSpeed);
    // A full buffer means the decoder, not the network, is behind. Dropping to
    // 1x cannot refill what is already there, and at high rates the browser
    // stalls often enough that doing so would pin playback near 1x.
    if (bufferedSecondsAhead(media) >= goal) return;
    if (this.recoveringMedia.has(media)) return;
    this.recoveringMedia.add(media);
    this.applyRate(media, BUFFER_RECOVERY_RATE, false);
    this.showOverlay(this.desiredSpeed, '⏳');
  };

  private handleBufferReady = (event: Event): void => {
    const media = mediaFromTarget(event.currentTarget);
    if (
      !media ||
      !this.recoveringMedia.has(media) ||
      media.paused ||
      media.ended ||
      media.readyState < HTMLMediaElement.HAVE_FUTURE_DATA
    ) return;
    const goal = recoveryBufferGoal(media, this.desiredSpeed);
    if (bufferedSecondsAhead(media) + 0.25 < goal) return;
    this.recoveringMedia.delete(media);
    this.applyRate(media, this.desiredSpeed, false);
    this.showOverlay(this.desiredSpeed);
  };

  private handleRateChange = (event: Event): void => {
    const media = mediaFromTarget(event.currentTarget);
    if (!media || this.settingRate.has(media)) return;
    this.recoveringMedia.delete(media);
    this.reconcileExternalRate(media.playbackRate, media, media);
  };

  private reconcileExternalRate(
    rate: number,
    media: HTMLMediaElement | null,
    bridgeTarget: EventTarget,
  ): void {
    const actual = clampUniversalSpeed(rate);
    const now = performance.now();
    if (this.overrideActive && Math.abs(actual - this.overrideRate) < 0.001) return;
    const expected = media
      ? this.appliedRates.get(media) ?? this.desiredSpeed
      : this.desiredSpeed;
    if (Math.abs(actual - expected) <= 0.001) return;
    const verdict = classifyExternalRate(actual, {
      now,
      lastKeyIntentAt: this.lastKeyIntentAt,
      lastClickAt: this.lastClickAt,
      prevClickAt: this.prevClickAt,
      lastPointerEndAt: this.lastPointerEndAt,
      pressStartedAt: this.pressStartedAt,
      pressSteady: this.pressSteady,
    });
    if (verdict === 'temporary') {
      this.enterOverride(actual, media);
      return;
    }
    const shouldProtect =
      effectiveFightback(this.settings, this.rule) ||
      now < this.protectRateUntil;
    if (verdict === 'autonomous' && shouldProtect) {
      this.protectRateUntil = Math.max(this.protectRateUntil, now + 5_000);
      if (media) this.applyRate(media, expected, false);
      else this.dispatchBridge({ action: 'rate', rate: expected }, bridgeTarget);
      return;
    }
    if (media) {
      this.lastInteracted = media;
      this.appliedRates.set(media, actual);
    }
    this.acceptSpeed(actual);
    this.showOverlay(actual);
  }

  private selectedMedia(): HTMLMediaElement | null {
    for (const item of this.media) {
      if (!item.isConnected) {
        this.untrackMedia(item);
        this.media.delete(item);
      }
    }
    return selectMedia(
      this.media,
      this.lastInteracted,
      (item) => this.visibleAreas.get(item) ?? 0,
      (item) => isDecorativeMedia(item) || Boolean(this.siteHandler?.shouldIgnoreMedia?.(item)),
    );
  }

  private handleKeydown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || isEditableTarget(event.target)) return;
    if (
      event.isComposing ||
      event.keyCode === 229 ||
      event.key === 'Process' ||
      event.key === 'Dead'
    ) return;
    const command = commandForKeyboardEvent(event, this.settings);
    // A key we do not consume is still the user acting on the page. Sites change
    // speed from their own shortcuts -- YouTube's < and > among them -- and that
    // must not be mistaken for a silent reset and undone.
    if (!command) {
      // Any unconsumed site shortcut is strong intent, including a change to
      // 1x. Pointer evidence is deliberately stricter because a single click
      // often resets players as a side effect.
      this.lastKeyIntentAt = performance.now();
      return;
    }
    if (
      command.action === 'theater' &&
      event.code === 'KeyT' &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey &&
      (
        this.siteHandler?.ownsPlainTheaterKey
      )
    ) {
      // Handed back to YouTube, so it counts as the user acting on the page.
      this.lastKeyIntentAt = performance.now();
      return;
    }
    if (this.settings.exclusiveKeys) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (event.repeat) return;
    this.clearHeldShortcut();
    const media = this.selectedMedia();
    this.performAction(command.action, media, command.value);
    if (REPEATABLE_ACTIONS.has(command.action)) {
      this.startHeldShortcut(event.code, command, media);
    }
  };

  private handleKeyup = (event: KeyboardEvent): void => {
    if (this.heldShortcut?.code === event.code) this.clearHeldShortcut();
  };

  private startHeldShortcut(
    code: string,
    command: MatchedShortcut,
    media: HTMLMediaElement | null,
  ): void {
    this.clearHeldShortcut();
    const repeat = () => {
      if (!this.active || document.visibilityState === 'hidden') {
        this.clearHeldShortcut();
        return;
      }
      const target = media?.isConnected ? media : this.selectedMedia();
      this.performAction(command.action, target, command.value);
      if (!this.heldShortcut || this.heldShortcut.code !== code) return;
      this.heldShortcut.timer = window.setTimeout(repeat, KEY_HOLD_REPEAT_MS);
    };
    this.heldShortcut = {
      code,
      command,
      media,
      timer: window.setTimeout(repeat, KEY_HOLD_DELAY_MS),
    };
  }

  private clearHeldShortcut = (): void => {
    if (!this.heldShortcut) return;
    window.clearTimeout(this.heldShortcut.timer);
    this.heldShortcut = null;
  };

  private performAction(
    action: CustomShortcutAction,
    media: HTMLMediaElement | null,
    value?: number,
  ): void {
    if (action === 'toggleIndicator') {
      const currentlyVisible = this.overlayHost?.style.pointerEvents === 'auto';
      this.overlayVisibilityOverride = !currentlyVisible;
      if (this.overlayVisibilityOverride) this.claimOverlay();
      this.refreshOverlayVisibility();
      return;
    }
    if (action === 'flashIndicator') {
      this.flashOverlay();
      return;
    }
    if (action === 'theater') {
      this.toggleTheater(media);
      return;
    }
    if (action === 'pictureInPicture') {
      void this.togglePictureInPicture(media);
      return;
    }
    if (action === 'loop') {
      this.toggleLoop(media);
      return;
    }
    if (action === 'frameBack' || action === 'frameForward') {
      const step = frameStepSeconds(value ?? DEFAULT_FRAME_RATE);
      const seconds = action === 'frameBack' ? -step : step;
      if (media && isSeekable(media)) {
        if (!media.paused) media.pause();
        media.currentTime = Math.min(media.duration, Math.max(0, media.currentTime + seconds));
        this.showOverlay(this.desiredSpeed, action === 'frameBack' ? '◀|' : '|▶');
      } else {
        this.dispatchBridge({ action: 'frame', seconds });
      }
      return;
    }
    if (action === 'slower') {
      const step = value ?? this.settings.speedStep;
      this.changeRate(media, stepUniversalSpeed(this.desiredSpeed, -step, step));
      return;
    }
    if (action === 'faster') {
      const step = value ?? this.settings.speedStep;
      this.changeRate(media, stepUniversalSpeed(this.desiredSpeed, step, step));
      return;
    }
    if (action === 'reset') {
      this.toggleRate(media, value ?? 1);
      return;
    }
    if (action === 'preferred') {
      this.toggleRate(media, value ?? this.extensionSettings.defaultSpeed);
      return;
    }
    if (action === 'rewind' || action === 'advance') {
      const seconds = action === 'rewind'
        ? -(value ?? this.settings.rewindSeconds)
        : (value ?? this.settings.advanceSeconds);
      if (media && isSeekable(media)) {
        if (this.siteHandler?.seek?.(
          media,
          seconds,
          (detail) => this.dispatchBridge(detail, media),
        )) {
          this.showOverlay(this.desiredSpeed, `${seconds > 0 ? '+' : ''}${seconds}s`);
          return;
        }
        media.currentTime = Math.min(media.duration, Math.max(0, media.currentTime + seconds));
        this.showOverlay(this.desiredSpeed, `${seconds > 0 ? '+' : ''}${seconds}s`);
      } else {
        this.dispatchBridge({ action: 'seek', seconds });
      }
      return;
    }
    if (action === 'mark') {
      if (media && isSeekable(media)) {
        this.markedPositions.set(media, media.currentTime);
        this.showOverlay(this.desiredSpeed, '◆');
      } else {
        this.dispatchBridge({ action: 'mark' });
      }
      return;
    }
    if (action === 'jump') {
      if (media && this.markedPositions.has(media) && isSeekable(media)) {
        const destination = this.markedPositions.get(media)!;
        const previous = this.positionsBeforeJump.get(media);
        this.positionsBeforeJump.set(media, media.currentTime);
        media.currentTime = previous ?? destination;
        if (previous !== undefined) this.positionsBeforeJump.delete(media);
        this.showOverlay(this.desiredSpeed, '↩');
      } else {
        this.dispatchBridge({ action: 'jump' });
      }
      return;
    }
    if (action === 'pause') {
      if (media) {
        if (media.paused) void media.play().catch(() => {
          this.dispatchBridge({ action: 'pause' }, media);
        });
        else media.pause();
      } else {
        this.dispatchBridge({ action: 'pause' });
      }
      this.showOverlay(this.desiredSpeed, media?.paused ? '▶' : 'Ⅱ');
      return;
    }
    if (action === 'toggleMute') {
      void this.toggleMasterMute();
      return;
    }
    if (action === 'volumeDown' || action === 'volumeUp') {
      const amount = Math.min(1, Math.max(0.01, value ?? 0.1));
      const delta = (action === 'volumeDown' ? -amount : amount) * 100;
      void this.setMasterVolume(this.volumeInfo().percent + delta);
      return;
    }
  }

  setSpeed(rate: number): void {
    this.changeRate(this.selectedMedia(), rate);
  }

  adjustSpeed(delta: number): void {
    const step = Math.abs(delta);
    const direction = delta < 0 ? -1 : 1;
    this.changeRate(
      this.selectedMedia(),
      stepUniversalSpeed(this.desiredSpeed, direction * step, step),
    );
  }

  togglePlayback(): void {
    this.performAction('pause', this.selectedMedia());
  }

  volumeInfo(): MasterVolumeInfo {
    const media = this.selectedMedia();
    if (media) {
      return this.volumeStates.get(media) ?? {
        mediaFound: true,
        percent: Math.round(media.volume * 100),
        muted: media.muted,
        boosted: false,
        boostSupported: true,
      };
    }
    return this.bridgeVolumeState ?? {
      mediaFound: false,
      percent: 100,
      muted: false,
      boosted: false,
      boostSupported: false,
    };
  }

  requestVolumeInfo(): MasterVolumeInfo {
    this.dispatchBridge({ action: 'volumeInfo' }, this.selectedMedia() ?? document);
    return this.volumeInfo();
  }

  setMasterVolume(percent: number): Promise<MasterVolumeInfo> {
    return this.requestVolumeChange({
      action: 'setVolume',
      percent: Math.round(Math.min(600, Math.max(0, Number.isFinite(percent) ? percent : 100))),
    });
  }

  setMediaAudioProfile(settings: {
    percent: number;
    bass: number;
    voice: number;
  }): Promise<MasterVolumeInfo> {
    return this.requestVolumeChange({ action: 'setAudioProfile', settings });
  }

  toggleMasterMute(): Promise<MasterVolumeInfo> {
    return this.requestVolumeChange({ action: 'toggleMasterMute' });
  }

  private requestVolumeChange(detail: Record<string, unknown>): Promise<MasterVolumeInfo> {
    const media = this.selectedMedia();
    const revision = this.volumeRevision;
    this.dispatchBridge(detail, media ?? document);
    if (this.volumeRevision !== revision) return Promise.resolve(this.volumeInfo());

    if (media && detail.action === 'setVolume' && Number(detail.percent) <= 100) {
      const percent = Number(detail.percent);
      media.volume = percent / 100;
      if (percent > 0) media.muted = false;
      const info: MasterVolumeInfo = {
        mediaFound: true,
        percent,
        muted: media.muted,
        boosted: false,
        boostSupported: true,
      };
      this.recordVolumeState(info, media);
      return Promise.resolve(info);
    }
    if (media && detail.action === 'toggleMasterMute') {
      media.muted = !media.muted;
      const info = { ...this.volumeInfo(), muted: media.muted };
      this.recordVolumeState(info, media);
      return Promise.resolve(info);
    }

    return new Promise((resolve) => {
      const finish = (info: MasterVolumeInfo) => {
        window.clearTimeout(timer);
        this.pendingVolumeResolvers.delete(finish);
        resolve(info);
      };
      const timer = window.setTimeout(() => finish({
        ...this.volumeInfo(),
        boostSupported: false,
      }), 1_000);
      this.pendingVolumeResolvers.add(finish);
    });
  }

  private recordVolumeState(info: MasterVolumeInfo, media: HTMLMediaElement | null): void {
    this.volumeRevision += 1;
    if (media) this.volumeStates.set(media, info);
    else this.bridgeVolumeState = info;
    const nextResolver = this.pendingVolumeResolvers.values().next().value;
    if (nextResolver) nextResolver(info);
  }

  private async togglePictureInPicture(media: HTMLMediaElement | null): Promise<void> {
    if (
      !(media instanceof HTMLVideoElement) ||
      typeof media.requestPictureInPicture !== 'function'
    ) {
      this.dispatchBridge({ action: 'pip' }, media ?? document);
      return;
    }
    try {
      if (document.pictureInPictureElement === media) await document.exitPictureInPicture();
      else await media.requestPictureInPicture();
      this.showOverlay(this.desiredSpeed, '⧉');
    } catch {
      this.showOverlay(this.desiredSpeed, '!');
    }
  }

  /** Cycles the A→B loop: mark A, mark B and start looping, then clear. */
  private toggleLoop(media: HTMLMediaElement | null): void {
    if (!media || !isSeekable(media)) {
      this.dispatchBridge({ action: 'loop' });
      return;
    }
    const current = this.loopMedia === media ? this.loopRange : null;
    const next = advanceLoop(current, media.currentTime);
    this.clearLoop();
    if (!next) {
      this.showOverlay(this.desiredSpeed, '⟲✕');
      return;
    }
    this.loopMedia = media;
    this.loopRange = next;
    if (next.end !== undefined) {
      media.addEventListener('timeupdate', this.handleLoopTick, { passive: true });
      media.addEventListener('seeked', this.handleLoopTick, { passive: true });
      this.showOverlay(this.desiredSpeed, '⟲ A-B');
      return;
    }
    this.showOverlay(this.desiredSpeed, '⟲ A');
  }

  private clearLoop(): void {
    if (this.loopMedia) {
      this.loopMedia.removeEventListener('timeupdate', this.handleLoopTick);
      this.loopMedia.removeEventListener('seeked', this.handleLoopTick);
    }
    this.loopMedia = null;
    this.loopRange = null;
  }

  private handleLoopTick = (event: Event): void => {
    const media = mediaFromTarget(event.currentTarget);
    if (!media || media !== this.loopMedia) return;
    const target = loopSeekTarget(this.loopRange, media.currentTime);
    if (target === null) return;
    media.currentTime = target;
  };

  private toggleTheater(media: HTMLMediaElement | null): void {
    if (this.theaterState) {
      this.exitTheater(true);
      return;
    }
    if (!(media instanceof HTMLVideoElement)) {
      this.dispatchBridge({ action: 'theater' });
      return;
    }
    this.enterTheater(theaterTargetFor(media), media, null, true);
  }

  private enterTheater(
    target: HTMLElement,
    media: HTMLVideoElement | null,
    source: WindowProxy | null,
    relay: boolean,
  ): void {
    if (this.theaterState) this.exitTheater(false);
    const targetRules = media === target
      ? [...THEATER_TARGET_STYLES, ...THEATER_MEDIA_STYLES]
      : THEATER_TARGET_STYLES;
    const styles = [styleWithPriority(target, targetRules)];
    if (media && media !== target) {
      styles.push(styleWithPriority(media, THEATER_MEDIA_STYLES));
    }
    styles.push(styleWithPriority(document.documentElement, THEATER_SCROLL_STYLES));
    if (document.body) styles.push(styleWithPriority(document.body, THEATER_SCROLL_STYLES));

    this.theaterState = {
      target,
      media,
      source,
      styles,
    };
    window.dispatchEvent(new Event('resize'));
    if (media) this.showOverlay(this.desiredSpeed, '▣');
    else this.hideOverlay();
    if (relay) this.relayTheater('enter');
  }

  private exitTheater(relay: boolean): void {
    const state = this.theaterState;
    if (!state) return;
    this.theaterState = null;
    for (const snapshot of [...state.styles].reverse()) restoreStyle(snapshot);
    window.dispatchEvent(new Event('resize'));
    if (state.media) this.showOverlay(this.desiredSpeed, '▢');
    if (relay) this.relayTheater('exit');
  }

  private relayTheater(action: 'enter' | 'exit'): void {
    if (window.parent === window) return;
    window.parent.postMessage({
      type: THEATER_MESSAGE,
      action,
    }, '*');
  }

  private handleTheaterMessage = (event: MessageEvent): void => {
    if (event.data === OVERLAY_MESSAGE) {
      this.overlaySuppressed = true;
      this.removeOverlay();
      if (this.relayOverlay(event.source) && window.parent !== window) {
        window.parent.postMessage(OVERLAY_MESSAGE, '*');
      }
      return;
    }
    const data = event.data as { type?: unknown; action?: unknown } | null;
    if (
      !data ||
      data.type !== THEATER_MESSAGE ||
      (data.action !== 'enter' && data.action !== 'exit') ||
      !event.source
    ) return;

    let frame: HTMLIFrameElement | HTMLFrameElement | null = null;
    for (const item of document.querySelectorAll('iframe, frame')) {
      if (
        (item instanceof HTMLIFrameElement || item instanceof HTMLFrameElement) &&
        item.contentWindow === event.source
      ) {
        frame = item;
        break;
      }
    }
    if (!frame) return;

    if (data.action === 'enter') {
      if (document.activeElement !== frame && this.theaterState?.source !== event.source) return;
      this.enterTheater(frame, null, frame.contentWindow, true);
      return;
    }
    if (this.theaterState?.source !== event.source) return;
    this.exitTheater(true);
  };

  private relayOverlay(except: MessageEventSource | null = null): boolean {
    let found = false;
    for (let index = 0; index < window.frames.length; index += 1) {
      const child = window.frames[index];
      if (child === except) found = true;
      else child?.postMessage(OVERLAY_MESSAGE, '*');
    }
    return found;
  }

  private claimOverlay(): void {
    this.overlaySuppressed = false;
    this.relayOverlay();
    if (window.parent !== window) window.parent.postMessage(OVERLAY_MESSAGE, '*');
  }

  downloadInfo() {
    return mediaDownloadInfo(this.selectedMedia(), document.title);
  }

  private toggleRate(media: HTMLMediaElement | null, targetRate: number): void {
    const target = clampUniversalSpeed(targetRate);
    if (!media) {
      this.changeRate(null, Math.abs(this.desiredSpeed - target) < 0.001 ? 1 : target);
      return;
    }
    const remembered = this.speedsBeforeToggle.get(media);
    if (Math.abs(this.desiredSpeed - target) < 0.001 && remembered !== undefined) {
      this.speedsBeforeToggle.delete(media);
      this.changeRate(media, remembered);
      return;
    }
    if (Math.abs(this.desiredSpeed - target) < 0.001) {
      this.speedsBeforeToggle.set(media, this.desiredSpeed);
      this.changeRate(media, target === 1
        ? clampUniversalSpeed(this.extensionSettings.defaultSpeed)
        : 1);
      return;
    }
    this.speedsBeforeToggle.set(media, this.desiredSpeed);
    this.changeRate(media, target);
  }

  private changeRate(media: HTMLMediaElement | null, rate: number): void {
    this.releaseOverride(false);
    const next = clampUniversalSpeed(rate);
    this.protectRateUntil = performance.now() + 8_000;
    this.acceptSpeed(next);
    if (media) {
      this.recoveringMedia.delete(media);
      this.applyRate(media, next, true);
    }
    else this.dispatchBridge({ action: 'rate', rate: next });
    this.showOverlay(next);
  }

  private applyRate(media: HTMLMediaElement, rate: number, show: boolean): void {
    if (this.overrideActive && this.overrideMedia === media) return;
    const next = clampUniversalSpeed(rate);
    applyPreservesPitch(media, this.settings.preservePitch);
    if (Math.abs(media.playbackRate - next) < 0.001) {
      this.appliedRates.set(media, next);
      if (show) this.showOverlay(next);
      return;
    }
    this.protectRateUntil = Math.max(this.protectRateUntil, performance.now() + 3_000);
    this.settingRate.add(media);
    this.appliedRates.set(media, next);
    try {
      media.playbackRate = next;
    } catch {
      this.dispatchBridge({ action: 'rate', rate: next }, media);
    }
    queueMicrotask(() => {
      this.settingRate.delete(media);
      if (Math.abs(media.playbackRate - next) > 0.001) {
        this.dispatchBridge({ action: 'rate', rate: next }, media);
      }
    });
    if (show) this.showOverlay(next);
  }

  private acceptSpeed(rate: number): void {
    this.desiredSpeed = clampUniversalSpeed(rate);
    if (!this.settings.rememberPerSite || !this.hostname) return;
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.saveSpeed(this.desiredSpeed);
    }, 750);
  }

  private enterOverride(rate: number, media: HTMLMediaElement | null): void {
    if (this.overrideTimer !== null) window.clearTimeout(this.overrideTimer);
    this.overrideActive = true;
    this.overrideMedia = media;
    this.overrideRate = rate;
    if (media) this.appliedRates.set(media, rate);
    this.showOverlay(rate, '⏩');
    this.overrideTimer = window.setTimeout(() => this.releaseOverride(true), 10_000);
  }

  private releaseOverride(restore: boolean): void {
    if (!this.overrideActive) return;
    if (this.overrideTimer !== null) window.clearTimeout(this.overrideTimer);
    this.overrideTimer = null;
    const media = this.overrideMedia;
    this.overrideActive = false;
    this.overrideMedia = null;
    if (!restore) return;
    this.protectRateUntil = Math.max(this.protectRateUntil, performance.now() + 2_000);
    if (media) this.applyRate(media, this.desiredSpeed, false);
    else this.dispatchBridge({ action: 'rate', rate: this.desiredSpeed });
    this.showOverlay(this.desiredSpeed);
  }

  private displaySpeed(): number {
    return this.overrideActive ? this.overrideRate : this.desiredSpeed;
  }

  private dispatchBridge(
    detail: Record<string, unknown>,
    target: EventTarget = document,
  ): void {
    const payload = { ...detail, allowAudio: this.settings.audioEnabled };
    const isGecko = /(?:Firefox|Waterfox|Zen)\//i.test(navigator.userAgent);
    target.dispatchEvent(new CustomEvent(this.controlEvent, {
      detail: isGecko ? JSON.stringify(payload) : payload,
      bubbles: true,
      composed: true,
    }));
  }

  private handleBridgeState = (event: CustomEvent<BridgeState | string>): void => {
    let detail: BridgeState;
    try {
      detail = typeof event.detail === 'string'
        ? JSON.parse(event.detail) as BridgeState
        : event.detail;
    } catch {
      return;
    }
    if (!detail || typeof detail !== 'object') return;
    if (detail.mediaType === 'audio' && !this.settings.audioEnabled) return;
    if (detail.kind === 'shadow') {
      const target = event.target;
      if (target instanceof Element && target.shadowRoot) {
        this.observeRoot(target.shadowRoot);
        this.enqueueRoot(target.shadowRoot);
      }
      return;
    }
    if (detail.kind === 'rejected') {
      this.showOverlay(this.desiredSpeed, '!');
      return;
    }
    if (detail.kind === 'theater') {
      this.relayTheater(detail.active ? 'enter' : 'exit');
      return;
    }
    if (
      detail.kind === 'volume' &&
      Number.isFinite(detail.percent) &&
      typeof detail.muted === 'boolean' &&
      typeof detail.boosted === 'boolean' &&
      typeof detail.boostSupported === 'boolean'
    ) {
      const media = event.target instanceof HTMLMediaElement ? event.target : null;
      this.recordVolumeState({
        mediaFound: true,
        percent: Math.round(detail.percent!),
        muted: detail.muted,
        boosted: detail.boosted,
        boostSupported: detail.boostSupported,
        ...(Number.isFinite(detail.bass) ? { bass: Math.round(detail.bass!) } : {}),
        ...(Number.isFinite(detail.voice) ? { voice: Math.round(detail.voice!) } : {}),
      }, media);
      this.showOverlay(this.displaySpeed(), detail.muted ? '🔇' : `${Math.round(detail.percent!)}%`);
      return;
    }
    if (
      detail.kind === 'media' &&
      Number.isFinite(detail.rate)
    ) {
      const media = event.target instanceof HTMLMediaElement
        ? event.target
        : null;
      this.reconcileExternalRate(detail.rate!, media, event.target ?? document);
    }
  };

  private ensureOverlay(): void {
    if (this.overlayHost) return;
    const host = document.createElement(OVERLAY_TAG);
    host.style.cssText = [
      'position:fixed',
      'z-index:2147483647',
      'left:12px',
      'top:12px',
      'opacity:0',
      'transform:translateY(-4px)',
      'transition:opacity 120ms ease,transform 120ms ease',
      'pointer-events:none',
    ].join(';');
    const shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    const safeCustomCss = /@import|url\s*\(/i.test(this.settings.customCss)
      ? ''
      : this.settings.customCss;
    style.textContent = `
      :host { all: initial; }
      .controller {
        display: inline-flex;
        align-items: stretch;
        overflow: hidden;
        border: 1px solid rgba(255,255,255,.22);
        border-radius: 8px;
        background: rgba(18,18,18,${this.settings.controllerOpacity});
        box-shadow: 0 2px 8px rgba(0,0,0,.3);
        color: #fff;
        font: 700 ${this.settings.controllerSize}px/1 system-ui, sans-serif;
        user-select: none;
      }
      button {
        appearance: none;
        border: 0;
        background: transparent;
        color: #fff;
        cursor: pointer;
        font: inherit;
        min-width: 28px;
        padding: 7px 8px;
        user-select: none;
      }
      button:hover, button:focus-visible { background: rgba(255,255,255,.16); outline: 0; }
      .badge { cursor: grab; min-width: 48px; }
      .badge:active { cursor: grabbing; }
      .controls {
        display: inline-flex;
        max-width: 0;
        opacity: 0;
        overflow: hidden;
        transition: max-width 120ms ease, opacity 120ms ease;
      }
      .controller:hover .controls, .controller:focus-within .controls {
        max-width: 132px;
        opacity: 1;
      }
      small { margin-inline-start: 5px; color: #ffb4b4; font: inherit; }
      ${safeCustomCss}
    `;
    const controller = document.createElement('div');
    controller.className = 'controller';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'badge';
    const locale = resolveLocale(
      this.extensionSettings.locale,
      document.documentElement.lang,
      navigator.languages,
    );
    button.setAttribute('aria-label', ut(locale, 'title'));
    const value = document.createElement('span');
    button.append(value);
    const controls = document.createElement('span');
    controls.className = 'controls';
    const controlButtons: Array<[string, string, () => void]> = [
      ['«', ut(locale, 'rewind'), () => this.performAction('rewind', this.selectedMedia())],
      ['−', ut(locale, 'slower'), () => this.performAction('slower', this.selectedMedia())],
      ['+', ut(locale, 'faster'), () => this.performAction('faster', this.selectedMedia())],
      ['»', ut(locale, 'advance'), () => this.performAction('advance', this.selectedMedia())],
    ];
    for (const [text, label, action] of controlButtons) {
      const control = document.createElement('button');
      control.type = 'button';
      control.textContent = text;
      control.setAttribute('aria-label', label);
      control.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        action();
      });
      controls.append(control);
    }
    controller.append(button, controls);
    shadow.append(style, controller);
    button.addEventListener('pointerdown', this.startOverlayDrag);
    button.addEventListener('dblclick', (event) => {
      event.preventDefault();
      this.performAction('reset', this.selectedMedia());
    });
    controller.addEventListener('pointerenter', () => {
      this.overlayHovered = true;
      if (this.overlayTimer !== null) {
        window.clearTimeout(this.overlayTimer);
        this.overlayTimer = null;
      }
      if (this.overlayHoverTimer !== null) window.clearTimeout(this.overlayHoverTimer);
      if (this.overlayHost) {
        this.overlayHost.style.opacity = '1';
        this.overlayHost.style.transform = 'translateY(0)';
        this.overlayHost.style.pointerEvents = 'auto';
      }
      this.overlayHoverTimer = window.setTimeout(() => {
        this.overlayHoverTimer = null;
      }, 300);
    });
    controller.addEventListener('pointerleave', () => {
      this.overlayHovered = false;
      if (this.overlayHoverTimer !== null) window.clearTimeout(this.overlayHoverTimer);
      this.overlayHoverTimer = null;
      if (this.settings.indicatorMode === 'flash') {
        this.overlayTimer = window.setTimeout(() => this.settleOverlay(), 500);
      }
    });
    host.addEventListener('wheel', (event) => {
      if (
        !this.settings.wheelEnabled ||
        this.overlayHoverTimer !== null ||
        !isWheelSpeedGesture(event)
      ) return;
      event.preventDefault();
      event.stopPropagation();
      this.adjustSpeed(event.deltaY > 0 ? -this.settings.speedStep : this.settings.speedStep);
    }, { passive: false });
    document.documentElement.append(host);
    this.overlayHost = host;
    this.overlayValue = value;
    this.overlayStyle = style;
  }

  private startOverlayDrag = (event: PointerEvent): void => {
    if (!this.overlayHost) return;
    event.preventDefault();
    const rect = this.overlayHost.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;
    const move = (moveEvent: PointerEvent) => {
      if (!this.overlayHost) return;
      this.overlayDragged = true;
      this.overlayHost.style.left = `${Math.max(0, moveEvent.clientX - offsetX)}px`;
      this.overlayHost.style.top = `${Math.max(0, moveEvent.clientY - offsetY)}px`;
    };
    const stop = () => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', stop, true);
    };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', stop, true);
  };

  private positionOverlay(): void {
    if (!this.overlayHost || this.overlayDragged) return;
    const media = this.selectedMedia();
    if (!media || media instanceof HTMLAudioElement) return;
    if (media === this.overlayAnchor && !this.overlayPositionDirty) return;
    const rect = media.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    this.overlayHost.style.left = `${Math.max(8, rect.left + 10)}px`;
    this.overlayHost.style.top = `${Math.max(8, rect.top + 10)}px`;
    this.overlayAnchor = media;
    this.overlayPositionDirty = false;
  }

  private showOverlay(rate: number, suffix = ''): void {
    if (
      this.theaterState?.source ||
      this.overlayVisibilityOverride === false ||
      (
        this.settings.indicatorMode === 'hidden' &&
        this.overlayVisibilityOverride !== true
      )
    ) return;
    this.claimOverlay();
    this.ensureOverlay();
    if (!this.overlayHost || !this.overlayValue) return;
    this.positionOverlay();
    this.overlayValue.textContent = suffix ? `${overlayText(rate)} ${suffix}` : overlayText(rate);
    this.overlayHost.style.opacity = '1';
    this.overlayHost.style.transform = 'translateY(0)';
    this.overlayHost.style.pointerEvents = 'auto';
    if (this.overlayTimer !== null) {
      window.clearTimeout(this.overlayTimer);
      this.overlayTimer = null;
    }
    if (this.settings.indicatorMode === 'flash') {
      this.overlayTimer = window.setTimeout(() => this.settleOverlay(), 1_250);
    }
  }

  private flashOverlay(): void {
    const previousOverride = this.overlayVisibilityOverride;
    this.overlayVisibilityOverride = true;
    this.showOverlay(this.displaySpeed());
    if (this.overlayTimer !== null) window.clearTimeout(this.overlayTimer);
    this.overlayTimer = window.setTimeout(() => {
      this.overlayTimer = null;
      this.overlayVisibilityOverride = previousOverride;
      this.refreshOverlayVisibility();
    }, 1_250);
  }

  private refreshOverlayVisibility(): void {
    if (
      this.theaterState?.source ||
      this.overlayVisibilityOverride === false ||
      (
        this.settings.indicatorMode === 'hidden' &&
        this.overlayVisibilityOverride !== true
      ) ||
      this.overlaySuppressed ||
      document.visibilityState === 'hidden'
    ) {
      this.hideOverlay();
      return;
    }
    if (!this.overlayHost) {
      if (
        (window.parent !== window && this.overlayVisibilityOverride !== true) ||
        !this.selectedMedia()
      ) return;
      this.claimOverlay();
    }
    this.ensureOverlay();
    if (!this.overlayHost || !this.overlayValue) return;
    this.positionOverlay();
    this.overlayValue.textContent = overlayText(this.displaySpeed());
    if (
      this.settings.indicatorMode === 'always' ||
      this.overlayVisibilityOverride === true
    ) {
      this.overlayHost.style.opacity = '1';
      this.overlayHost.style.transform = 'translateY(0)';
      this.overlayHost.style.pointerEvents = 'auto';
      return;
    }
    this.dimOverlay();
  }

  private settleOverlay(): void {
    this.overlayTimer = null;
    if (this.overlayValue) this.overlayValue.textContent = overlayText(this.displaySpeed());
    if (
      this.settings.indicatorMode === 'always' ||
      this.overlayVisibilityOverride === true
    ) return;
    this.dimOverlay();
  }

  private dimOverlay(): void {
    // A background scan or a settle timer must never dim the controls out from
    // under a pointer that is still on them.
    if (!this.overlayHost || this.overlayHovered) return;
    const idleOpacity = Math.min(
      0.55,
      Math.max(0.24, this.settings.controllerOpacity * 0.42),
    );
    this.overlayHost.style.opacity = String(Number(idleOpacity.toFixed(2)));
    this.overlayHost.style.transform = 'translateY(0)';
    this.overlayHost.style.pointerEvents = 'auto';
  }

  private hideOverlay(): void {
    if (!this.overlayHost) return;
    this.overlayHost.style.opacity = '0';
    this.overlayHost.style.transform = 'translateY(-4px)';
    this.overlayHost.style.pointerEvents = 'none';
  }

  private removeOverlay(): void {
    if (this.overlayTimer !== null) window.clearTimeout(this.overlayTimer);
    if (this.overlayHoverTimer !== null) window.clearTimeout(this.overlayHoverTimer);
    this.overlayTimer = null;
    this.overlayHoverTimer = null;
    this.overlayHovered = false;
    this.overlayHost?.remove();
    this.overlayHost = null;
    this.overlayValue = null;
    this.overlayStyle = null;
    this.overlayAnchor = null;
    this.overlayPositionDirty = true;
  }
}
