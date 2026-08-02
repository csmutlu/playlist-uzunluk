import { DEFAULT_SHORTCUTS, DEFAULT_UNIVERSAL_SETTINGS } from './constants';
import { clampUniversalSpeed, normalizeHostname } from './universal';
import type {
  ShortcutAction,
  ShortcutBinding,
  SitePatternRule,
  UniversalControllerSettings,
} from './types';

/**
 * Import for settings exported by Video Speed Controller
 * (github.com/igrigorik/videospeed). Its options page writes
 * `videospeed-settings.json`, which is the file this reads.
 *
 * Shared defaults make most of the mapping direct: both extensions use the same
 * S/D/R/G/Z/X/M/J/V keys and the same 0.07–16 speed range.
 */

interface VscModifiers {
  ctrl?: unknown;
  alt?: unknown;
  shift?: unknown;
  meta?: unknown;
}

interface VscBinding {
  action?: unknown;
  code?: unknown;
  key?: unknown;
  keyCode?: unknown;
  value?: unknown;
  modifiers?: VscModifiers;
}

interface VscSiteRule {
  pattern?: unknown;
  enabled?: unknown;
  speed?: unknown;
}

interface VscSettings {
  enabled?: unknown;
  rememberSpeed?: unknown;
  exclusiveKeys?: unknown;
  audioBoolean?: unknown;
  startHidden?: unknown;
  controllerOpacity?: unknown;
  controllerButtonSize?: unknown;
  customCSS?: unknown;
  keyBindings?: unknown;
  siteRules?: unknown;
  blacklist?: unknown;
}

/** Video Speed Controller action name -> ours. `fast` is our `preferred`. */
const ACTION_MAP: Readonly<Record<string, ShortcutAction>> = {
  slower: 'slower',
  faster: 'faster',
  rewind: 'rewind',
  advance: 'advance',
  reset: 'reset',
  fast: 'preferred',
  display: 'toggleIndicator',
  mark: 'mark',
  jump: 'jump',
};

/**
 * Their older exports store only the legacy `keyCode`. These are the nine keys
 * the extension has always shipped, so a fixed table resolves them exactly.
 */
const LEGACY_KEY_CODES: Readonly<Record<number, string>> = {
  83: 'KeyS',
  68: 'KeyD',
  90: 'KeyZ',
  88: 'KeyX',
  82: 'KeyR',
  71: 'KeyG',
  86: 'KeyV',
  77: 'KeyM',
  74: 'KeyJ',
};

export interface VscImportResult {
  settings: UniversalControllerSettings;
  patternRules: SitePatternRule[];
  /** Their `fast` binding value, which is our preferred speed. */
  preferredSpeed: number | null;
  /** Keys we could not translate, so the popup can say what was skipped. */
  skippedActions: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function bindingCode(binding: VscBinding): string | null {
  if (typeof binding.code === 'string' && binding.code.trim()) return binding.code.trim();
  const legacy = finiteNumber(binding.keyCode) ?? finiteNumber(binding.key);
  return legacy === null ? null : LEGACY_KEY_CODES[legacy] ?? null;
}

function bindingFor(binding: VscBinding, code: string): ShortcutBinding {
  const modifiers = isRecord(binding.modifiers) ? binding.modifiers : {};
  return {
    code,
    alt: Boolean(modifiers.alt),
    ctrl: Boolean(modifiers.ctrl),
    meta: Boolean(modifiers.meta),
    shift: Boolean(modifiers.shift),
  };
}

/**
 * Recognises a Video Speed Controller export. Returns null when the file is
 * something else, so callers can fall back to our own import format.
 */
export function isVideoSpeedExport(parsed: unknown): boolean {
  if (!isRecord(parsed)) return false;
  // Our own exports carry `kind`, so never claim one of those.
  if (typeof parsed.kind === 'string') return false;
  return (
    Array.isArray(parsed.keyBindings) ||
    typeof parsed.blacklist === 'string' ||
    typeof parsed.audioBoolean === 'boolean' ||
    typeof parsed.controllerButtonSize === 'number'
  );
}

export function convertVideoSpeedSettings(parsed: unknown): VscImportResult {
  if (!isVideoSpeedExport(parsed)) {
    throw new Error('Not a Video Speed Controller export');
  }
  const source = parsed as VscSettings;

  const shortcuts: Record<ShortcutAction, ShortcutBinding> = {
    ...structuredClone(DEFAULT_SHORTCUTS),
  };
  const skippedActions: string[] = [];
  let speedStep: number | null = null;
  let rewindSeconds: number | null = null;
  let advanceSeconds: number | null = null;
  let preferredSpeed: number | null = null;

  const bindings = Array.isArray(source.keyBindings) ? source.keyBindings : [];
  for (const entry of bindings) {
    if (!isRecord(entry)) continue;
    const binding = entry as VscBinding;
    const rawAction = typeof binding.action === 'string' ? binding.action : '';
    const action = ACTION_MAP[rawAction];
    const value = finiteNumber(binding.value);
    if (!action) {
      if (rawAction) skippedActions.push(rawAction);
      continue;
    }
    const code = bindingCode(binding);
    if (code) shortcuts[action] = bindingFor(binding, code);
    else if (rawAction) skippedActions.push(rawAction);

    // Their per-binding values are our shared step/seek/preferred settings.
    if (value === null) continue;
    if (action === 'slower' || action === 'faster') speedStep = Math.abs(value);
    if (action === 'rewind') rewindSeconds = Math.abs(value);
    if (action === 'advance') advanceSeconds = Math.abs(value);
    if (action === 'preferred') preferredSpeed = clampUniversalSpeed(value);
  }

  const opacity = finiteNumber(source.controllerOpacity);
  const size = finiteNumber(source.controllerButtonSize);

  const settings: UniversalControllerSettings = {
    ...structuredClone(DEFAULT_UNIVERSAL_SETTINGS),
    // Enabling all-site access is a permission decision, so it is never
    // imported; the popup switch stays the single place that grants it.
    enabled: DEFAULT_UNIVERSAL_SETTINGS.enabled,
    rememberPerSite: Boolean(source.rememberSpeed),
    exclusiveKeys: Boolean(source.exclusiveKeys),
    audioEnabled: source.audioBoolean !== false,
    indicatorMode: source.startHidden === true ? 'hidden' : 'flash',
    ...(speedStep !== null && speedStep > 0
      ? { speedStep: Math.min(2, Math.max(0.01, speedStep)) }
      : {}),
    ...(rewindSeconds !== null && rewindSeconds > 0
      ? { rewindSeconds: Math.min(600, Math.max(1, rewindSeconds)) }
      : {}),
    ...(advanceSeconds !== null && advanceSeconds > 0
      ? { advanceSeconds: Math.min(600, Math.max(1, advanceSeconds)) }
      : {}),
    ...(opacity !== null ? { controllerOpacity: Math.min(1, Math.max(0.1, opacity)) } : {}),
    ...(size !== null
      ? { controllerSize: Math.round(Math.min(28, Math.max(10, size))) }
      : {}),
    ...(typeof source.customCSS === 'string'
      ? { customCss: source.customCSS.slice(0, 8_000) }
      : {}),
    shortcuts,
  };

  return {
    settings,
    patternRules: convertSiteRules(source),
    preferredSpeed,
    skippedActions: [...new Set(skippedActions)],
  };
}

/**
 * Their `siteRules` carry an optional speed; the older newline `blacklist` only
 * disables. Both land in our pattern rules, with siteRules taking precedence.
 */
function convertSiteRules(source: VscSettings): SitePatternRule[] {
  const byPattern = new Map<string, SitePatternRule>();
  const now = Date.now();

  const blacklist = typeof source.blacklist === 'string' ? source.blacklist : '';
  for (const line of blacklist.split('\n')) {
    const pattern = line.trim();
    if (!pattern || pattern.startsWith('#')) continue;
    const normalized = normalizePattern(pattern);
    if (!normalized) continue;
    byPattern.set(normalized, {
      id: `vsc-${normalized}`,
      pattern: normalized,
      enabled: false,
      updatedAt: now,
    });
  }

  const rules = Array.isArray(source.siteRules) ? source.siteRules : [];
  for (const entry of rules) {
    if (!isRecord(entry)) continue;
    const rule = entry as VscSiteRule;
    if (typeof rule.pattern !== 'string') continue;
    const normalized = normalizePattern(rule.pattern);
    if (!normalized) continue;
    const speed = finiteNumber(rule.speed);
    byPattern.set(normalized, {
      id: `vsc-${normalized}`,
      pattern: normalized,
      enabled: rule.enabled !== false,
      ...(speed !== null ? { defaultSpeed: clampUniversalSpeed(speed) } : {}),
      updatedAt: now,
    });
  }

  return [...byPattern.values()].slice(0, 100);
}

/** Their patterns are hostnames or `/regex/`; both are shapes our rules accept. */
function normalizePattern(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('/')) return trimmed.slice(0, 200);
  if (trimmed.includes('*')) return trimmed.toLowerCase().slice(0, 200);
  return normalizeHostname(trimmed).slice(0, 200);
}
