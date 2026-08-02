import { browser } from 'wxt/browser';
import {
  DEFAULT_SETTINGS,
  DEFAULT_UNIVERSAL_SETTINGS,
  EMPTY_UNIVERSAL_SITE_DATA,
  PLAYLIST_HISTORY_LIMIT,
  UNIVERSAL_SITE_HISTORY_LIMIT,
} from './constants';
import { clampSpeed } from './duration';
import {
  SCHEMA_VERSION,
  SUPPORTED_LOCALES,
  UNIVERSAL_SETTINGS_VERSION,
  type ExtensionSettings,
  type PlaylistCacheEntry,
  type PlaylistHistoryEntry,
  type PlaylistProgress,
  type SiteMediaRule,
  type SitePatternRule,
  type UniversalControllerSettings,
  type UniversalSiteData,
} from './types';
import {
  clampUniversalSpeed,
  normalizeHostname,
  normalizeShortcuts,
} from './universal';

const SETTINGS_KEY = 'settings';
const API_KEY = 'youtubeApiKey';
const PROGRESS_PREFIX = 'progress:';
const CACHE_PREFIX = 'cache:';
const HISTORY_KEY = 'playlistHistory';
const UNIVERSAL_SETTINGS_KEY = 'universalSettings:v1';
const UNIVERSAL_SITE_DATA_KEY = 'universalSiteData:v1';

function storageArea(area: 'local' | 'sync') {
  // The WXT wrapper normalizes Firefox's promise-based `browser` API. The
  // fallback keeps isolated unit tests and older Chromium test harnesses usable.
  return browser?.storage?.[area] ?? chrome.storage[area];
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
    locale:
      settings.locale === 'auto' ||
      SUPPORTED_LOCALES.includes(settings.locale as (typeof SUPPORTED_LOCALES)[number])
        ? settings.locale
        : 'auto',
    defaultSpeed: clampSpeed(settings.defaultSpeed),
    customSpeed: clampSpeed(settings.customSpeed),
    showSeconds: Boolean(settings.showSeconds),
    completionThreshold: Math.min(1, Math.max(0.5, settings.completionThreshold || 0.9)),
    theme: ['auto', 'light', 'dark'].includes(settings.theme) ? settings.theme : 'auto',
  };
}

export async function getUniversalSettings(): Promise<UniversalControllerSettings> {
  const result = await storageArea('sync').get(UNIVERSAL_SETTINGS_KEY);
  return normalizeUniversalSettings(
    result[UNIVERSAL_SETTINGS_KEY] as Partial<UniversalControllerSettings> | undefined,
  );
}

export async function saveUniversalSettings(
  settings: UniversalControllerSettings,
): Promise<void> {
  await storageArea('sync').set({
    [UNIVERSAL_SETTINGS_KEY]: normalizeUniversalSettings(settings),
  });
}

export function normalizeUniversalSettings(
  settings: Partial<UniversalControllerSettings> | undefined,
): UniversalControllerSettings {
  const indicatorMode = settings?.indicatorMode;
  return {
    schemaVersion: UNIVERSAL_SETTINGS_VERSION,
    enabled: Boolean(settings?.enabled),
    speedStep: Math.min(
      2,
      Math.max(0.01, Number.isFinite(settings?.speedStep) ? settings!.speedStep! : 0.1),
    ),
    rewindSeconds: Math.min(
      600,
      Math.max(1, Number.isFinite(settings?.rewindSeconds) ? settings!.rewindSeconds! : 10),
    ),
    advanceSeconds: Math.min(
      600,
      Math.max(1, Number.isFinite(settings?.advanceSeconds) ? settings!.advanceSeconds! : 10),
    ),
    rememberPerSite: settings?.rememberPerSite !== false,
    indicatorMode: ['flash', 'always', 'hidden'].includes(indicatorMode ?? '')
      ? indicatorMode!
      : DEFAULT_UNIVERSAL_SETTINGS.indicatorMode,
    fightbackDefault: Boolean(settings?.fightbackDefault),
    audioEnabled: settings?.audioEnabled !== false,
    exclusiveKeys: settings?.exclusiveKeys !== false,
    wheelEnabled: settings?.wheelEnabled !== false,
    preservePitch: settings?.preservePitch !== false,
    controllerOpacity: Math.min(
      1,
      Math.max(
        0.1,
        Number.isFinite(settings?.controllerOpacity)
          ? settings!.controllerOpacity!
          : DEFAULT_UNIVERSAL_SETTINGS.controllerOpacity,
      ),
    ),
    controllerSize: Math.round(Math.min(
      28,
      Math.max(
        10,
        Number.isFinite(settings?.controllerSize)
          ? settings!.controllerSize!
          : DEFAULT_UNIVERSAL_SETTINGS.controllerSize,
      ),
    )),
    customCss: typeof settings?.customCss === 'string'
      ? settings.customCss.slice(0, 8_000)
      : '',
    shortcuts: normalizeShortcuts(settings?.shortcuts),
    customShortcuts: Array.isArray(settings?.customShortcuts)
      ? settings.customShortcuts
        .filter((binding) =>
          binding &&
          typeof binding.id === 'string' &&
          typeof binding.action === 'string' &&
          typeof binding.code === 'string',
        )
        .slice(0, 24)
        .map((binding) => ({
          id: binding.id.slice(0, 80),
          action: binding.action,
          enabled: binding.enabled !== false,
          code: binding.code.slice(0, 40),
          alt: Boolean(binding.alt),
          ctrl: Boolean(binding.ctrl),
          meta: Boolean(binding.meta),
          shift: Boolean(binding.shift),
          ...(Number.isFinite(binding.value)
            ? { value: Math.min(600, Math.max(0.01, binding.value!)) }
            : {}),
        }))
      : [],
  };
}

function normalizeSiteRule(value: SiteMediaRule | undefined): SiteMediaRule | null {
  if (!value || typeof value.enabled !== 'boolean') return null;
  const defaultSpeed = Number.isFinite(value.defaultSpeed)
    ? clampUniversalSpeed(value.defaultSpeed!)
    : undefined;
  return {
    enabled: value.enabled,
    ...(defaultSpeed === undefined ? {} : { defaultSpeed }),
    ...(typeof value.fightback === 'boolean' ? { fightback: value.fightback } : {}),
    updatedAt: Number.isFinite(value.updatedAt) ? value.updatedAt : Date.now(),
  };
}

export async function getUniversalSiteData(): Promise<UniversalSiteData> {
  const result = await storageArea('local').get(UNIVERSAL_SITE_DATA_KEY);
  const stored = result[UNIVERSAL_SITE_DATA_KEY] as Partial<UniversalSiteData> | undefined;
  if (!stored || stored.schemaVersion !== UNIVERSAL_SETTINGS_VERSION) {
    return structuredClone(EMPTY_UNIVERSAL_SITE_DATA);
  }
  const rules = Object.fromEntries(
    Object.entries(stored.rules ?? {}).flatMap(([hostname, value]) => {
      const normalizedHost = normalizeHostname(hostname);
      const normalizedRule = normalizeSiteRule(value);
      return normalizedHost && normalizedRule ? [[normalizedHost, normalizedRule]] : [];
    }),
  );
  const playback = Object.fromEntries(
    Object.entries(stored.playback ?? {})
      .flatMap(([hostname, value]) => {
        const normalizedHost = normalizeHostname(hostname);
        if (
          !normalizedHost ||
          !value ||
          !Number.isFinite(value.speed) ||
          !Number.isFinite(value.updatedAt)
        ) {
          return [];
        }
        return [[
          normalizedHost,
          { speed: clampUniversalSpeed(value.speed), updatedAt: value.updatedAt },
        ]] as const;
      })
      .sort(([, a], [, b]) => b.updatedAt - a.updatedAt)
      .slice(0, UNIVERSAL_SITE_HISTORY_LIMIT),
  );
  const patternRules = Array.isArray(stored.patternRules)
    ? stored.patternRules
      .filter((value): value is SitePatternRule =>
        value &&
        typeof value.id === 'string' &&
        typeof value.pattern === 'string' &&
        Boolean(value.pattern.trim()),
      )
      .slice(0, 100)
      .flatMap((value) => {
        const rule = normalizeSiteRule(value);
        return rule
          ? [{
              ...rule,
              id: value.id.slice(0, 80),
              pattern: value.pattern.trim().slice(0, 300),
            }]
          : [];
      })
    : [];
  return {
    schemaVersion: UNIVERSAL_SETTINGS_VERSION,
    rules,
    patternRules,
    playback,
  };
}

async function saveUniversalSiteData(data: UniversalSiteData): Promise<void> {
  await storageArea('local').set({
    [UNIVERSAL_SITE_DATA_KEY]: {
      schemaVersion: UNIVERSAL_SETTINGS_VERSION,
      rules: data.rules,
      patternRules: data.patternRules,
      playback: Object.fromEntries(
        Object.entries(data.playback)
          .sort(([, a], [, b]) => b.updatedAt - a.updatedAt)
          .slice(0, UNIVERSAL_SITE_HISTORY_LIMIT),
      ),
    } satisfies UniversalSiteData,
  });
}

export async function saveSitePlaybackSpeed(
  hostname: string,
  speed: number,
): Promise<void> {
  const normalizedHost = normalizeHostname(hostname);
  if (!normalizedHost) return;
  const data = await getUniversalSiteData();
  data.playback[normalizedHost] = {
    speed: clampUniversalSpeed(speed),
    updatedAt: Date.now(),
  };
  await saveUniversalSiteData(data);
}

export async function forgetSitePlaybackSpeed(hostname: string): Promise<void> {
  const normalizedHost = normalizeHostname(hostname);
  if (!normalizedHost) return;
  const data = await getUniversalSiteData();
  delete data.playback[normalizedHost];
  await saveUniversalSiteData(data);
}

export async function saveSiteMediaRule(
  hostname: string,
  rule: Omit<SiteMediaRule, 'updatedAt'> | null,
): Promise<void> {
  const normalizedHost = normalizeHostname(hostname);
  if (!normalizedHost) return;
  const data = await getUniversalSiteData();
  if (rule === null) {
    delete data.rules[normalizedHost];
  } else {
    const normalized = normalizeSiteRule({ ...rule, updatedAt: Date.now() });
    if (normalized) data.rules[normalizedHost] = normalized;
  }
  await saveUniversalSiteData(data);
}

export async function getSiteMediaState(hostname: string): Promise<{
  rule: SiteMediaRule | null;
  playbackSpeed: number | null;
}> {
  const data = await getUniversalSiteData();
  const normalizedHost = normalizeHostname(hostname);
  const exactRule = data.rules[normalizedHost] ?? null;
  const patternRule = exactRule ? null : data.patternRules.find((candidate) => {
    try {
      if (candidate.pattern.startsWith('/')) {
        const lastSlash = candidate.pattern.lastIndexOf('/');
        if (lastSlash <= 0) return false;
        return new RegExp(
          candidate.pattern.slice(1, lastSlash),
          candidate.pattern.slice(lastSlash + 1),
        ).test(normalizedHost);
      }
      const pattern = candidate.pattern.toLowerCase().replace(/^\*\./, '');
      return normalizedHost === pattern || normalizedHost.endsWith(`.${pattern}`);
    } catch {
      return false;
    }
  });
  return {
    rule: exactRule ?? patternRule ?? null,
    playbackSpeed: data.playback[normalizedHost]?.speed ?? null,
  };
}

export async function getSitePatternRules(): Promise<SitePatternRule[]> {
  return (await getUniversalSiteData()).patternRules;
}

export async function saveSitePatternRules(rules: SitePatternRule[]): Promise<void> {
  const data = await getUniversalSiteData();
  data.patternRules = rules.slice(0, 100);
  await saveUniversalSiteData(data);
}

export async function exportUniversalConfiguration(): Promise<string> {
  const [settings, data] = await Promise.all([
    getUniversalSettings(),
    getUniversalSiteData(),
  ]);
  return JSON.stringify({
    kind: 'playlist-zamani-universal',
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: { ...settings, enabled: false },
    rules: data.rules,
    patternRules: data.patternRules,
  }, null, 2);
}

export async function importUniversalConfiguration(content: string): Promise<void> {
  const parsed = JSON.parse(content) as {
    kind?: string;
    settings?: Partial<UniversalControllerSettings>;
    rules?: Record<string, SiteMediaRule>;
    patternRules?: SitePatternRule[];
  };
  if (parsed.kind !== 'playlist-zamani-universal' || !parsed.settings) {
    throw new Error('Invalid universal controller configuration');
  }
  const current = await getUniversalSettings();
  await saveUniversalSettings(normalizeUniversalSettings({
    ...parsed.settings,
    enabled: current.enabled,
  }));
  const data = await getUniversalSiteData();
  data.rules = Object.fromEntries(
    Object.entries(parsed.rules ?? {}).flatMap(([hostname, rule]) => {
      const normalizedHost = normalizeHostname(hostname);
      const normalizedRule = normalizeSiteRule(rule);
      return normalizedHost && normalizedRule ? [[normalizedHost, normalizedRule]] : [];
    }),
  );
  data.patternRules = Array.isArray(parsed.patternRules)
    ? parsed.patternRules.slice(0, 100)
    : [];
  await saveUniversalSiteData(data);
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

export async function getPlaylistHistory(): Promise<PlaylistHistoryEntry[]> {
  const result = await storageArea('local').get(HISTORY_KEY);
  const stored = result[HISTORY_KEY];
  if (!Array.isArray(stored)) return [];
  return stored
    .filter(
      (entry): entry is PlaylistHistoryEntry =>
        entry?.schemaVersion === SCHEMA_VERSION &&
        typeof entry.playlistId === 'string' &&
        typeof entry.title === 'string' &&
        Number.isFinite(entry.remainingSeconds) &&
        Number.isFinite(entry.lastOpenedAt),
    )
    .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
    .slice(0, PLAYLIST_HISTORY_LIMIT);
}

export async function savePlaylistHistoryEntry(entry: PlaylistHistoryEntry): Promise<void> {
  const history = await getPlaylistHistory();
  const next = [
    entry,
    ...history.filter((item) => item.playlistId !== entry.playlistId),
  ]
    .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
    .slice(0, PLAYLIST_HISTORY_LIMIT);
  await storageArea('local').set({ [HISTORY_KEY]: next });
}

export async function clearPlaylistHistory(): Promise<void> {
  await storageArea('local').remove(HISTORY_KEY);
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
  await clearPlaylistHistory();
}

export async function exportProgress(): Promise<string> {
  const values = await storageArea('local').get(null);
  const progress = Object.fromEntries(
    Object.entries(values).filter(([key]) => key.startsWith(PROGRESS_PREFIX)),
  );
  const history = await getPlaylistHistory();
  return JSON.stringify(
    { schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), progress, history },
    null,
    2,
  );
}

export async function importProgress(value: string): Promise<number> {
  const parsed = JSON.parse(value) as {
    schemaVersion?: number;
    progress?: Record<string, PlaylistProgress>;
    history?: PlaylistHistoryEntry[];
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
  if (Array.isArray(parsed.history)) {
    const history = parsed.history
      .filter(
        (entry) =>
          entry?.schemaVersion === SCHEMA_VERSION &&
          typeof entry.playlistId === 'string' &&
          typeof entry.title === 'string',
      )
      .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
      .slice(0, PLAYLIST_HISTORY_LIMIT);
    await storageArea('local').set({ [HISTORY_KEY]: history });
  }
  return Object.keys(valid).length;
}
