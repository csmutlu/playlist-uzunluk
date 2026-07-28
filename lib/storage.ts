import { DEFAULT_SETTINGS } from './constants';
import { clampSpeed } from './duration';
import {
  SCHEMA_VERSION,
  type ExtensionSettings,
  type PlaylistCacheEntry,
  type PlaylistProgress,
} from './types';

const SETTINGS_KEY = 'settings';
const API_KEY = 'youtubeApiKey';
const PROGRESS_PREFIX = 'progress:';
const CACHE_PREFIX = 'cache:';

function storageArea(area: 'local' | 'sync'): chrome.storage.StorageArea {
  return chrome.storage[area];
}

export async function getSettings(): Promise<ExtensionSettings> {
  const result = await storageArea('sync').get(SETTINGS_KEY);
  const stored = result[SETTINGS_KEY] as Partial<ExtensionSettings> | undefined;
  return normalizeSettings({
    ...DEFAULT_SETTINGS,
    ...stored,
    schemaVersion: SCHEMA_VERSION,
  });
}

export async function saveSettings(settings: ExtensionSettings): Promise<void> {
  await storageArea('sync').set({ [SETTINGS_KEY]: normalizeSettings(settings) });
}

function normalizeSettings(settings: ExtensionSettings): ExtensionSettings {
  return {
    schemaVersion: SCHEMA_VERSION,
    locale: ['auto', 'tr', 'en'].includes(settings.locale) ? settings.locale : 'auto',
    defaultSpeed: clampSpeed(settings.defaultSpeed),
    customSpeed: clampSpeed(settings.customSpeed),
    showSeconds: Boolean(settings.showSeconds),
    completionThreshold: Math.min(1, Math.max(0.5, settings.completionThreshold || 0.9)),
    theme: ['auto', 'light', 'dark'].includes(settings.theme) ? settings.theme : 'auto',
  };
}

export async function getApiKey(): Promise<string> {
  const result = await storageArea('local').get(API_KEY);
  return typeof result[API_KEY] === 'string' ? result[API_KEY].trim() : '';
}

export async function saveApiKey(value: string): Promise<void> {
  const key = value.trim();
  if (key) await storageArea('local').set({ [API_KEY]: key });
  else await storageArea('local').remove(API_KEY);
}

export function emptyProgress(playlistId: string): PlaylistProgress {
  return {
    schemaVersion: SCHEMA_VERSION,
    playlistId,
    videos: {},
    updatedAt: Date.now(),
  };
}

export async function getPlaylistProgress(playlistId: string): Promise<PlaylistProgress> {
  const key = `${PROGRESS_PREFIX}${playlistId}`;
  const result = await storageArea('local').get(key);
  const stored = result[key] as PlaylistProgress | undefined;
  if (!stored || stored.schemaVersion !== SCHEMA_VERSION) return emptyProgress(playlistId);
  return stored;
}

export async function savePlaylistProgress(progress: PlaylistProgress): Promise<void> {
  await storageArea('local').set({ [`${PROGRESS_PREFIX}${progress.playlistId}`]: progress });
}

export async function getPlaylistCache(playlistId: string): Promise<PlaylistCacheEntry | null> {
  const key = `${CACHE_PREFIX}${playlistId}`;
  const result = await storageArea('local').get(key);
  const value = result[key] as PlaylistCacheEntry | undefined;
  return value?.schemaVersion === SCHEMA_VERSION ? value : null;
}

export async function savePlaylistCache(entry: PlaylistCacheEntry): Promise<void> {
  await storageArea('local').set({ [`${CACHE_PREFIX}${entry.playlistId}`]: entry });
}

export async function clearPlaylistCaches(): Promise<void> {
  const values = await storageArea('local').get(null);
  const keys = Object.keys(values).filter((key) => key.startsWith(CACHE_PREFIX));
  if (keys.length > 0) await storageArea('local').remove(keys);
}

export async function clearAllProgress(): Promise<void> {
  const values = await storageArea('local').get(null);
  const keys = Object.keys(values).filter((key) => key.startsWith(PROGRESS_PREFIX));
  if (keys.length > 0) await storageArea('local').remove(keys);
}

export async function exportProgress(): Promise<string> {
  const values = await storageArea('local').get(null);
  const progress = Object.fromEntries(
    Object.entries(values).filter(([key]) => key.startsWith(PROGRESS_PREFIX)),
  );
  return JSON.stringify(
    { schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), progress },
    null,
    2,
  );
}

export async function importProgress(value: string): Promise<number> {
  const parsed = JSON.parse(value) as {
    schemaVersion?: number;
    progress?: Record<string, PlaylistProgress>;
  };
  if (parsed.schemaVersion !== SCHEMA_VERSION || !parsed.progress) {
    throw new Error('Unsupported progress export');
  }
  const valid = Object.fromEntries(
    Object.entries(parsed.progress).filter(
      ([key, entry]) =>
        key.startsWith(PROGRESS_PREFIX) &&
        entry.schemaVersion === SCHEMA_VERSION &&
        typeof entry.playlistId === 'string',
    ),
  );
  await storageArea('local').set(valid);
  return Object.keys(valid).length;
}
