import {
  DEFAULT_FRAME_RATE,
  DEFAULT_SHORTCUTS,
  UNIVERSAL_MAX_SPEED,
  UNIVERSAL_MIN_SPEED,
} from './constants';
import type {
  CustomShortcutAction,
  CustomShortcutBinding,
  MediaDownloadInfo,
  ShortcutAction,
  ShortcutBinding,
  SiteMediaRule,
  SitePlaybackState,
  UniversalControllerSettings,
} from './types';

export const SHORTCUT_ACTIONS: readonly ShortcutAction[] = [
  'slower',
  'faster',
  'reset',
  'preferred',
  'rewind',
  'advance',
  'mark',
  'jump',
  'theater',
  'toggleIndicator',
] as const;

/** Legacy keyCode fallback for keyboards that cannot expose KeyboardEvent.code. */
export const LEGACY_KEY_CODES: Readonly<Record<number, string>> = {
  83: 'KeyS',
  68: 'KeyD',
  90: 'KeyZ',
  88: 'KeyX',
  82: 'KeyR',
  71: 'KeyG',
  86: 'KeyV',
  77: 'KeyM',
  74: 'KeyJ',
  84: 'KeyT',
};

const KEY_CODES_BY_CODE = Object.fromEntries(
  Object.entries(LEGACY_KEY_CODES).map(([keyCode, code]) => [code, Number(keyCode)]),
) as Readonly<Record<string, number>>;

type ShortcutKeyboardEvent = Pick<
  KeyboardEvent,
  'altKey' | 'code' | 'ctrlKey' | 'metaKey' | 'shiftKey'
> & { keyCode?: number };

export function clampUniversalSpeed(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(UNIVERSAL_MAX_SPEED, Math.max(UNIVERSAL_MIN_SPEED, value));
}

export function roundSpeed(value: number, step = 0.1): number {
  const safeStep = Number.isFinite(step) && step > 0 ? step : 0.1;
  const rounded = Math.round(value / safeStep) * safeStep;
  return Number(clampUniversalSpeed(rounded).toFixed(3));
}

export function stepUniversalSpeed(current: number, delta: number, step: number): number {
  const target = roundSpeed(current + delta, step);
  if ((current < 1 && target > 1) || (current > 1 && target < 1)) return 1;
  return target;
}

export function isWheelSpeedGesture(
  event: Pick<WheelEvent, 'ctrlKey' | 'deltaMode' | 'deltaY'>,
): boolean {
  if (event.ctrlKey) return false;
  return event.deltaMode !== WheelEvent.DOM_DELTA_PIXEL || Math.abs(event.deltaY) >= 50;
}

export function normalizeHostname(value: string): string {
  return value.trim().toLowerCase().replace(/^\.+|\.+$/g, '');
}

export function normalizeShortcut(binding: Partial<ShortcutBinding> | undefined, fallback: ShortcutBinding): ShortcutBinding {
  const code = typeof binding?.code === 'string' && binding.code.trim()
    ? binding.code.trim()
    : fallback.code;
  return {
    code,
    alt: Boolean(binding?.alt),
    ctrl: Boolean(binding?.ctrl),
    meta: Boolean(binding?.meta),
    shift: Boolean(binding?.shift),
  };
}

export function normalizeShortcuts(
  value: Partial<Record<ShortcutAction, Partial<ShortcutBinding>>> | undefined,
): Record<ShortcutAction, ShortcutBinding> {
  return Object.fromEntries(
    SHORTCUT_ACTIONS.map((action) => [
      action,
      normalizeShortcut(value?.[action], DEFAULT_SHORTCUTS[action]),
    ]),
  ) as Record<ShortcutAction, ShortcutBinding>;
}

export function shortcutMatches(
  event: ShortcutKeyboardEvent,
  binding: ShortcutBinding,
): boolean {
  const codeMatches = event.code && event.code !== 'Unidentified'
    ? event.code === binding.code
    : KEY_CODES_BY_CODE[binding.code] === event.keyCode;
  return (
    codeMatches &&
    event.altKey === binding.alt &&
    event.ctrlKey === binding.ctrl &&
    event.metaKey === binding.meta &&
    event.shiftKey === binding.shift
  );
}

export function actionForKeyboardEvent(
  event: ShortcutKeyboardEvent,
  shortcuts: Record<ShortcutAction, ShortcutBinding>,
): ShortcutAction | null {
  return SHORTCUT_ACTIONS.find((action) => shortcutMatches(event, shortcuts[action])) ?? null;
}

export interface MatchedShortcut {
  action: CustomShortcutAction;
  value?: number;
}

export function commandForKeyboardEvent(
  event: ShortcutKeyboardEvent,
  settings: Pick<UniversalControllerSettings, 'customShortcuts' | 'shortcuts'>,
): MatchedShortcut | null {
  const custom = settings.customShortcuts.find(
    (binding) => binding.enabled && shortcutMatches(event, binding),
  );
  if (custom) return {
    action: custom.action,
    ...(Number.isFinite(custom.value) ? { value: custom.value } : {}),
  };
  const action = actionForKeyboardEvent(event, settings.shortcuts);
  return action ? { action } : null;
}

export function normalizeCustomShortcut(
  binding: CustomShortcutBinding,
): CustomShortcutBinding {
  return {
    ...binding,
    id: binding.id || crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`,
    enabled: binding.enabled !== false,
    value: Number.isFinite(binding.value)
      ? Math.min(600, Math.max(0.01, binding.value!))
      : undefined,
  };
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) {
    return true;
  }
  return Boolean(target instanceof HTMLElement && target.isContentEditable);
}

export interface LoopMark {
  start: number;
  end?: number;
}

/**
 * A→B loop state machine. The first press marks A, the second marks B and the
 * third clears the loop. Marking a point before A re-arms A instead of creating
 * an inverted range.
 */
export function advanceLoop(current: LoopMark | null, time: number): LoopMark | null {
  if (!Number.isFinite(time) || time < 0) return current;
  if (!current) return { start: time };
  if (current.end !== undefined) return null;
  if (time - current.start < 0.05) return { start: time };
  return { start: current.start, end: time };
}

/** Position to seek back to, or null when playback is still inside the loop. */
export function loopSeekTarget(loop: LoopMark | null, currentTime: number): number | null {
  if (loop?.end === undefined) return null;
  if (currentTime < loop.end && currentTime >= loop.start - 0.5) return null;
  return loop.start;
}

export function frameStepSeconds(framesPerSecond: number): number {
  const fps = Number.isFinite(framesPerSecond) && framesPerSecond > 0
    ? Math.min(240, Math.max(1, framesPerSecond))
    : DEFAULT_FRAME_RATE;
  return 1 / fps;
}

export function isSeekable(media: HTMLMediaElement): boolean {
  return (
    Number.isFinite(media.duration) &&
    media.duration > 0 &&
    media.seekable.length > 0
  );
}

export function isDecorativeMedia(media: HTMLMediaElement): boolean {
  return media instanceof HTMLVideoElement && media.loop && media.muted && !media.controls;
}

function visibleArea(media: HTMLMediaElement): number {
  if (media instanceof HTMLAudioElement) return 0;
  const rect = media.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return 0;
  const width = Math.max(0, Math.min(rect.right, innerWidth) - Math.max(rect.left, 0));
  const height = Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0));
  return width * height;
}

export function selectMedia(
  media: Iterable<HTMLMediaElement>,
  lastInteracted: HTMLMediaElement | null = null,
  areaFor: (media: HTMLMediaElement) => number = visibleArea,
  shouldIgnore: (media: HTMLMediaElement) => boolean = isDecorativeMedia,
): HTMLMediaElement | null {
  if (
    lastInteracted?.isConnected &&
    !shouldIgnore(lastInteracted) &&
    !lastInteracted.paused &&
    !lastInteracted.ended &&
    lastInteracted.readyState > 0
  ) {
    return lastInteracted;
  }
  let lastIsCandidate = false;
  let bestPlaying: HTMLMediaElement | null = null;
  let bestPlayingArea = -1;
  let bestFallback: HTMLMediaElement | null = null;
  let bestFallbackArea = -1;
  for (const item of media) {
    if (!item.isConnected || shouldIgnore(item)) continue;
    if (item === lastInteracted) lastIsCandidate = true;
    const area = areaFor(item);
    if (!item.paused && !item.ended && item.readyState > 0) {
      if (area > bestPlayingArea) {
        bestPlaying = item;
        bestPlayingArea = area;
      }
    } else if (area > bestFallbackArea) {
      bestFallback = item;
      bestFallbackArea = area;
    }
  }
  if (bestPlaying) return bestPlaying;
  if (lastIsCandidate) return lastInteracted;
  return bestFallback;
}

export function resolveSiteSpeed(
  preferredSpeed: number,
  rule: SiteMediaRule | null | undefined,
  remembered: SitePlaybackState | null | undefined,
  rememberPerSite: boolean,
): number {
  if (rule?.defaultSpeed !== undefined) return clampUniversalSpeed(rule.defaultSpeed);
  if (rememberPerSite && remembered) return clampUniversalSpeed(remembered.speed);
  return clampUniversalSpeed(preferredSpeed);
}

export function effectiveFightback(
  settings: UniversalControllerSettings,
  rule: SiteMediaRule | null | undefined,
): boolean {
  return rule?.fightback ?? settings.fightbackDefault;
}

export type RateVerdict = 'intent' | 'temporary' | 'autonomous';

export interface RateEvidence {
  now: number;
  lastKeyIntentAt: number;
  lastClickAt: number;
  prevClickAt: number;
  lastPointerEndAt: number;
  pressStartedAt: number | null;
  pressSteady: boolean;
}

export const GESTURE_WINDOW_MS = 300;
export const KEY_INTENT_MS = 1_000;
export const CLICK_SEQUENCE_MS = 5_000;
export const HOLD_INTENT_MS = 300;
export const NORMAL_EPSILON = 0.005;
export const PRESS_SLOP_PX = 10;

/** Classifies a site's rate write without depending on a browser or media node. */
export function classifyExternalRate(rate: number, evidence: RateEvidence): RateVerdict {
  const fresh = (timestamp: number) => {
    const age = evidence.now - timestamp;
    return age >= 0 && age < GESTURE_WINDOW_MS;
  };
  const keyAge = evidence.now - evidence.lastKeyIntentAt;
  const keyIntent = keyAge >= 0 && keyAge < KEY_INTENT_MS;
  const clickSequence = fresh(evidence.lastClickAt) &&
    Number.isFinite(evidence.prevClickAt) &&
    evidence.lastClickAt - evidence.prevClickAt <= CLICK_SEQUENCE_MS;

  if (keyIntent || clickSequence) return 'intent';
  if (
    evidence.pressStartedAt !== null &&
    evidence.pressSteady &&
    evidence.now - evidence.pressStartedAt >= HOLD_INTENT_MS
  ) return 'temporary';
  if (
    (evidence.pressStartedAt !== null || fresh(evidence.lastPointerEndAt)) &&
    Math.abs(rate - 1) >= NORMAL_EPSILON
  ) return 'intent';
  return 'autonomous';
}

export function shortcutLabel(binding: ShortcutBinding): string {
  const modifiers = [
    binding.ctrl ? 'Ctrl' : '',
    binding.alt ? 'Alt' : '',
    binding.shift ? 'Shift' : '',
    binding.meta ? 'Meta' : '',
  ].filter(Boolean);
  const key = binding.code
    .replace(/^Key/, '')
    .replace(/^Digit/, '')
    .replace(/^Arrow/, 'Arrow ');
  return [...modifiers, key].join('+');
}

const DIRECT_MEDIA_EXTENSIONS = new Set([
  'mp4',
  'm4v',
  'webm',
  'mov',
  'ogv',
  'mp3',
  'm4a',
  'ogg',
  'opus',
  'wav',
  'flac',
]);

export function sanitizeDownloadFilename(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^\.+|\.+$/g, '')
    .trim()
    .slice(0, 180);
}

export function mediaDownloadInfo(
  media: HTMLMediaElement | null,
  pageTitle = '',
): MediaDownloadInfo {
  if (!media) return { available: false, reason: 'noMedia' };
  if (media.mediaKeys) return { available: false, reason: 'drmProtected' };
  const source = media.currentSrc || media.src;
  if (!source) return { available: false, reason: 'unsupportedMedia' };
  if (source.startsWith('blob:') || source.startsWith('mediasource:')) {
    return { available: false, reason: 'blobMedia' };
  }
  let url: URL;
  try {
    url = new URL(source, location.href);
  } catch {
    return { available: false, reason: 'unsupportedMedia' };
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    return { available: false, reason: 'unsupportedMedia' };
  }
  const extension = url.pathname.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase();
  if (extension === 'm3u8' || extension === 'mpd') {
    return { available: false, reason: 'adaptiveStream' };
  }
  const cleanTitle = sanitizeDownloadFilename(pageTitle);
  const filename = cleanTitle && extension && DIRECT_MEDIA_EXTENSIONS.has(extension)
    ? `${cleanTitle}.${extension}`
    : undefined;
  return {
    available: true,
    url: url.href,
    ...(filename ? { filename } : {}),
  };
}
