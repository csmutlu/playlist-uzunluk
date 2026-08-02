import type {
  ExtensionSettings,
  ShortcutAction,
  ShortcutBinding,
  UniversalControllerSettings,
  UniversalSiteData,
} from './types';
import { UNIVERSAL_SETTINGS_VERSION } from './types';

export const SPEED_PRESETS = [1, 1.25, 1.5, 1.75, 2] as const;
export const MIN_SPEED = 0.25;
export const MAX_SPEED = 4;
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const STORAGE_FLUSH_MS = 15_000;
export const MUTATION_BATCH_MS = 150;
export const INITIAL_SCAN_CHUNK = 100;
export const PLAYLIST_HISTORY_LIMIT = 20;
export const UNIVERSAL_MIN_SPEED = 0.07;
export const UNIVERSAL_MAX_SPEED = 16;
export const UNIVERSAL_SITE_HISTORY_LIMIT = 200;
export const UNIVERSAL_HOST_ORIGINS = ['http://*/*', 'https://*/*'] as const;
export const DEFAULT_FRAME_RATE = 30;
export const UNIVERSAL_FILE_ORIGIN = 'file:///*' as const;

const shortcut = (
  code: string,
  modifiers: Partial<Omit<ShortcutBinding, 'code'>> = {},
): ShortcutBinding => ({
  code,
  alt: false,
  ctrl: false,
  meta: false,
  shift: false,
  ...modifiers,
});

export const DEFAULT_SHORTCUTS: Record<ShortcutAction, ShortcutBinding> = {
  slower: shortcut('KeyS'),
  faster: shortcut('KeyD'),
  reset: shortcut('KeyR'),
  preferred: shortcut('KeyG'),
  rewind: shortcut('KeyZ'),
  advance: shortcut('KeyX'),
  mark: shortcut('KeyM'),
  jump: shortcut('KeyJ'),
  theater: shortcut('KeyT'),
  toggleIndicator: shortcut('KeyV'),
};

export const DEFAULT_UNIVERSAL_SETTINGS: UniversalControllerSettings = {
  schemaVersion: UNIVERSAL_SETTINGS_VERSION,
  enabled: false,
  speedStep: 0.1,
  rewindSeconds: 10,
  advanceSeconds: 10,
  rememberPerSite: true,
  indicatorMode: 'flash',
  fightbackDefault: false,
  audioEnabled: true,
  exclusiveKeys: true,
  wheelEnabled: true,
  preservePitch: true,
  controllerOpacity: 0.92,
  controllerSize: 13,
  customCss: '',
  shortcuts: DEFAULT_SHORTCUTS,
  customShortcuts: [],
};

export const EMPTY_UNIVERSAL_SITE_DATA: UniversalSiteData = {
  schemaVersion: UNIVERSAL_SETTINGS_VERSION,
  rules: {},
  patternRules: [],
  playback: {},
};

export const DEFAULT_UNIVERSAL_SITE_DATA: UniversalSiteData = {
  ...EMPTY_UNIVERSAL_SITE_DATA,
  patternRules: [
    { id: 'default-meet', pattern: 'meet.google.com', enabled: false, updatedAt: 0 },
    { id: 'default-teams', pattern: 'teams.microsoft.com', enabled: false, updatedAt: 0 },
    { id: 'default-hangouts', pattern: 'hangouts.google.com', enabled: false, updatedAt: 0 },
  ],
};

export const DEFAULT_SETTINGS: ExtensionSettings = {
  schemaVersion: 1,
  locale: 'auto',
  defaultSpeed: 1,
  customSpeed: 1.1,
  showSeconds: true,
  completionThreshold: 0.9,
  theme: 'auto',
};
