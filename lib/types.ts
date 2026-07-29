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
  | { type: 'playlist-cache:clear' };
