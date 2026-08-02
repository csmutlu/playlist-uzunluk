import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getSiteMediaState,
  getUniversalSettings,
  getUniversalSiteData,
  saveSiteMediaRule,
  saveSitePatternRules,
  saveSitePlaybackSpeed,
  saveUniversalSettings,
} from '../lib/storage';
import { DEFAULT_UNIVERSAL_SETTINGS, UNIVERSAL_SITE_HISTORY_LIMIT } from '../lib/constants';

const localValues: Record<string, unknown> = {};
const syncValues: Record<string, unknown> = {};

function area(values: Record<string, unknown>) {
  return {
    get: vi.fn(async (keys: string | string[] | null) => {
      if (keys === null) return { ...values };
      const list = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.map((key) => [key, values[key]]));
    }),
    set: vi.fn(async (items: Record<string, unknown>) => Object.assign(values, items)),
    remove: vi.fn(async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key];
    }),
  };
}

beforeEach(() => {
  for (const key of Object.keys(localValues)) delete localValues[key];
  for (const key of Object.keys(syncValues)) delete syncValues[key];
  vi.stubGlobal('chrome', {
    storage: {
      local: area(localValues),
      sync: area(syncValues),
    },
  });
});

describe('universal settings storage', () => {
  it('seeds conferencing exclusions only when site storage is empty', async () => {
    const fresh = await getUniversalSiteData();
    expect(fresh.patternRules.map((rule) => rule.pattern)).toEqual([
      'meet.google.com',
      'teams.microsoft.com',
      'hangouts.google.com',
    ]);

    localValues['universalSiteData:v1'] = {
      schemaVersion: 1,
      rules: {},
      patternRules: [],
      playback: {},
    };
    expect((await getUniversalSiteData()).patternRules).toEqual([]);
  });

  it('truncates custom CSS before the storage.sync per-item limit', async () => {
    const result = await saveUniversalSettings({
      ...DEFAULT_UNIVERSAL_SETTINGS,
      customCss: 'ğ'.repeat(8_000),
    });
    const bytes = new TextEncoder().encode(JSON.stringify({
      'universalSettings:v1': syncValues['universalSettings:v1'],
    })).byteLength;
    expect(result.customCssTruncated).toBe(true);
    expect(result.settings.customCss.length).toBeLessThan(8_000);
    expect(bytes).toBeLessThanOrEqual(8_000);
  });

  it('keeps the playlist schema separate and normalizes universal settings', async () => {
    await saveUniversalSettings({
      ...DEFAULT_UNIVERSAL_SETTINGS,
      enabled: true,
      speedStep: 8,
      rewindSeconds: -10,
    });

    expect(await getUniversalSettings()).toMatchObject({
      schemaVersion: 1,
      enabled: true,
      speedStep: 2,
      rewindSeconds: 1,
    });
    expect(syncValues.settings).toBeUndefined();
  });

  it('stores normalized hostname rules and playback speed', async () => {
    await saveSiteMediaRule('.Example.COM.', {
      enabled: false,
      defaultSpeed: 1.75,
      fightback: true,
    });
    await saveSitePlaybackSpeed('EXAMPLE.com', 30);

    expect(await getSiteMediaState('example.com')).toMatchObject({
      rule: {
        enabled: false,
        defaultSpeed: 1.75,
        fightback: true,
      },
      playbackSpeed: 16,
    });
  });

  it('keeps only the 200 most recently updated site speeds', async () => {
    for (let index = 0; index < UNIVERSAL_SITE_HISTORY_LIMIT + 5; index += 1) {
      vi.setSystemTime(index + 1);
      await saveSitePlaybackSpeed(`site-${index}.example`, 1 + index / 100);
    }
    const data = await getUniversalSiteData();
    expect(Object.keys(data.playback)).toHaveLength(UNIVERSAL_SITE_HISTORY_LIMIT);
    expect(data.playback['site-0.example']).toBeUndefined();
    expect(data.playback['site-204.example']).toBeDefined();
  });

  it('applies exact rules before wildcard and regular-expression rules', async () => {
    await saveSitePatternRules([
      {
        id: 'wildcard',
        pattern: '*.example.com',
        enabled: true,
        defaultSpeed: 1.5,
        updatedAt: 1,
      },
      {
        id: 'regex',
        pattern: '/^media\\d+\\.test$/i',
        enabled: false,
        updatedAt: 2,
      },
    ]);
    await saveSiteMediaRule('video.example.com', {
      enabled: true,
      defaultSpeed: 2,
    });

    expect((await getSiteMediaState('learn.example.com')).rule?.defaultSpeed).toBe(1.5);
    expect((await getSiteMediaState('video.example.com')).rule?.defaultSpeed).toBe(2);
    expect((await getSiteMediaState('media12.test')).rule?.enabled).toBe(false);
  });
});
