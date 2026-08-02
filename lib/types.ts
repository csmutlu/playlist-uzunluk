export const SCHEMA_VERSION = 1 as const;

export const SUPPORTED_LOCALES = [
  'tr',
  'en',
  'es',
  'fr',
  'ar',
  'de',
  'pt-BR',
  'ru',
  'hi',
  'id',
  'ja',
  'ko',
  'zh-CN',
] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];
export type Theme = 'auto' | 'light' | 'dark';
export type VideoSource = 'dom' | 'api';
export type VideoAvailability = 'available' | 'unavailable' | 'live' | 'unknown';
export type ProgressSource = 'auto' | 'manual';

export interface PlaylistVideo {
  videoId: string;
  index: number;
  title: string;
  durationSeconds: number | null;
  availability: VideoAvailability;
  source: VideoSource;
}

export interface PlaylistAnalysis {
  playlistId: string;
  expectedCount: number | null;
  countedCount: number;
  listComplete: boolean;
  unknownDurationCount: number;
  unavailableCount: number;
  totalSeconds: number;
  videos: PlaylistVideo[];
  prefixSeconds: number[];
  updatedAt: number;
}

export interface VideoProgress {
  watched: boolean;
  source: ProgressSource;
  positionSeconds: number;
  updatedAt: number;
}

export interface PlaylistProgress {
  schemaVersion: typeof SCHEMA_VERSION;
  playlistId: string;
  videos: Record<string, VideoProgress>;
  lastVideoId?: string;
  updatedAt: number;
}

export interface PlaylistHistoryEntry {
  schemaVersion: typeof SCHEMA_VERSION;
  playlistId: string;
  title: string;
  videoCount: number;
  totalSeconds: number;
  remainingSeconds: number;
  progressPercent: number;
  lastVideoId?: string;
  lastVideoIndex?: number;
  lastOpenedAt: number;
  updatedAt: number;
}

export interface ExtensionSettings {
  schemaVersion: typeof SCHEMA_VERSION;
  locale: Locale | 'auto';
  defaultSpeed: number;
  customSpeed: number;
  showSeconds: boolean;
  completionThreshold: number;
  theme: Theme;
}

export interface DailyPlanInput {
  remainingSeconds: number;
  speed: number;
  dailyMinutes: number;
  activeWeekdays: number[];
  startDate: Date;
}

export interface DailyPlanSession {
  date: Date;
  seconds: number;
}

export interface DailyPlanResult {
  sessions: DailyPlanSession[];
  finishDate: Date | null;
  activeDayCount: number;
}

export const UNIVERSAL_SETTINGS_VERSION = 1 as const;

export type ShortcutAction =
  | 'slower'
  | 'faster'
  | 'reset'
  | 'preferred'
  | 'rewind'
  | 'advance'
  | 'mark'
  | 'jump'
  | 'theater'
  | 'toggleIndicator';

export type CustomShortcutAction =
  | ShortcutAction
  | 'pause'
  | 'toggleMute'
  | 'volumeDown'
  | 'volumeUp'
  | 'pictureInPicture'
  | 'frameBack'
  | 'frameForward'
  | 'loop'
  | 'flashIndicator';

export interface ShortcutBinding {
  code: string;
  alt: boolean;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
}

export interface CustomShortcutBinding extends ShortcutBinding {
  id: string;
  action: CustomShortcutAction;
  enabled: boolean;
  value?: number;
}

export type IndicatorMode = 'flash' | 'always' | 'hidden';

export interface UniversalControllerSettings {
  schemaVersion: typeof UNIVERSAL_SETTINGS_VERSION;
  enabled: boolean;
  speedStep: number;
  rewindSeconds: number;
  advanceSeconds: number;
  rememberPerSite: boolean;
  indicatorMode: IndicatorMode;
  fightbackDefault: boolean;
  audioEnabled: boolean;
  exclusiveKeys: boolean;
  wheelEnabled: boolean;
  preservePitch: boolean;
  controllerOpacity: number;
  controllerSize: number;
  customCss: string;
  shortcuts: Record<ShortcutAction, ShortcutBinding>;
  customShortcuts: CustomShortcutBinding[];
}

export interface SiteMediaRule {
  enabled: boolean;
  defaultSpeed?: number;
  fightback?: boolean;
  updatedAt: number;
}

export interface SitePlaybackState {
  speed: number;
  updatedAt: number;
}

export interface SitePatternRule extends SiteMediaRule {
  id: string;
  pattern: string;
}

export interface UniversalSiteData {
  schemaVersion: typeof UNIVERSAL_SETTINGS_VERSION;
  rules: Record<string, SiteMediaRule>;
  patternRules: SitePatternRule[];
  playback: Record<string, SitePlaybackState>;
}

export interface UniversalSiteInfo {
  hostname: string;
  enabled: boolean;
  speed: number | null;
  rule: SiteMediaRule | null;
}

export interface MasterVolumeInfo {
  mediaFound: boolean;
  percent: number;
  muted: boolean;
  boosted: boolean;
  boostSupported: boolean;
  bass?: number;
  voice?: number;
}

export interface TabAudioSettings {
  percent: number;
  bass: number;
  voice: number;
}

export interface TabAudioState extends TabAudioSettings {
  tabId: number;
  active: boolean;
  supported: boolean;
  error?: string;
}

export interface AudibleTabInfo {
  tabId: number;
  title: string;
  url: string;
  favIconUrl?: string;
  audible: boolean;
  active: boolean;
  controlled: boolean;
}

export type MediaDownloadBlockReason =
  | 'noMedia'
  | 'blobMedia'
  | 'adaptiveStream'
  | 'drmProtected'
  | 'unsupportedMedia';

export interface MediaDownloadInfo {
  available: boolean;
  url?: string;
  filename?: string;
  reason?: MediaDownloadBlockReason;
}

export interface PlaylistCacheEntry {
  schemaVersion: typeof SCHEMA_VERSION;
  playlistId: string;
  videos: PlaylistVideo[];
  expectedCount: number;
  fetchedAt: number;
}

export interface ApiPlaylistResponse {
  ok: boolean;
  playlistId: string;
  expectedCount?: number;
  videos?: PlaylistVideo[];
  fromCache?: boolean;
  error?: string;
  errorCode?: 'missing_key' | 'missing_permission' | 'quota' | 'private' | 'network' | 'unknown';
}

export type BackgroundMessage =
  | { type: 'playlist-api:fetch'; playlistId: string; force?: boolean }
  | { type: 'playlist-api:cancel'; playlistId: string }
  | { type: 'playlist-cache:clear' }
  | { type: 'universal:register'; tabId?: number }
  | { type: 'universal:unregister' }
  | { type: 'universal:registration-status' }
  | { type: 'universal:download'; url: string; filename?: string }
  | { type: 'audio:list-tabs' }
  | { type: 'audio:get-state'; tabId: number }
  | { type: 'audio:set'; tabId: number; settings: TabAudioSettings }
  | { type: 'audio:stop'; tabId: number }
  | { type: 'audio:activate-tab'; tabId: number };

export type OffscreenAudioMessage =
  | { target: 'offscreen-audio'; type: 'audio-engine:start'; tabId: number; streamId: string; settings: TabAudioSettings }
  | { target: 'offscreen-audio'; type: 'audio-engine:update'; tabId: number; settings: TabAudioSettings }
  | { target: 'offscreen-audio'; type: 'audio-engine:stop'; tabId: number }
  | { target: 'offscreen-audio'; type: 'audio-engine:get-state'; tabId: number }
  | { target: 'offscreen-audio'; type: 'audio-engine:list-states' };

export type UniversalContentMessage =
  | { type: 'universal:disable' }
  | { type: 'universal:site-info' }
  | { type: 'universal:set-speed'; speed: number }
  | { type: 'universal:adjust-speed'; delta: number }
  | { type: 'universal:toggle-playback' }
  | { type: 'universal:volume-info' }
  | { type: 'universal:set-volume'; percent: number }
  | { type: 'universal:set-audio-profile'; settings: TabAudioSettings }
  | { type: 'universal:toggle-mute' }
  | { type: 'universal:download-info' };
