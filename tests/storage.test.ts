import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PLAYLIST_HISTORY_LIMIT } from '../lib/constants';
import {
  clearAllProgress,
  getPlaylistHistory,
  getSettings,
  getSitePatternRules,
  getUniversalSettings,
  importUniversalConfiguration,
  saveUniversalSettings,
  savePlaylistHistoryEntry,
} from '../lib/storage';
import { DEFAULT_UNIVERSAL_SETTINGS } from '../lib/constants';
import type { PlaylistHistoryEntry } from '../lib/types';

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

function historyEntry(index: number, openedAt = index): PlaylistHistoryEntry {
  return {
    schemaVersion: 1,
    playlistId: `PL-${index}`,
    title: `Playlist ${index}`,
    videoCount: 10,
    totalSeconds: 1_000,
    remainingSeconds: 500,
    progressPercent: 50,
    lastVideoId: `video-${index}`,
    lastVideoIndex: 5,
    lastOpenedAt: openedAt,
    updatedAt: openedAt,
  };
}

describe('playlist history storage', () => {
  it('keeps a deduplicated, newest-first bounded history', async () => {
    for (let index = 0; index < PLAYLIST_HISTORY_LIMIT + 5; index += 1) {
      await savePlaylistHistoryEntry(historyEntry(index));
    }
    await savePlaylistHistoryEntry({
      ...historyEntry(10, 10_000),
      title: 'Updated title',
    });

    const history = await getPlaylistHistory();
    expect(history).toHaveLength(PLAYLIST_HISTORY_LIMIT);
    expect(history[0]).toMatchObject({
      playlistId: 'PL-10',
      title: 'Updated title',
    });
    expect(new Set(history.map((entry) => entry.playlistId)).size).toBe(history.length);
  });

  it('clears history together with playlist progress', async () => {
    await savePlaylistHistoryEntry(historyEntry(1));
    localValues['progress:PL-1'] = { schemaVersion: 1, playlistId: 'PL-1' };

    await clearAllProgress();

    expect(await getPlaylistHistory()).toEqual([]);
    expect(localValues['progress:PL-1']).toBeUndefined();
  });
});

describe('controller settings import', () => {
  it('detects a Video Speed Controller export and persists the conversion', async () => {
    // The user already granted all-site access here; importing must not undo it.
    await saveUniversalSettings({ ...DEFAULT_UNIVERSAL_SETTINGS, enabled: true });

    const source = await importUniversalConfiguration(JSON.stringify({
      schemaVersion: 1,
      rememberSpeed: true,
      audioBoolean: false,
      controllerButtonSize: 17,
      keyBindings: [
        { action: 'slower', code: 'KeyS', keyCode: 83, value: 0.25 },
        { action: 'advance', code: 'KeyX', keyCode: 88, value: 20 },
        { action: 'fast', code: 'KeyG', keyCode: 71, value: 2.5 },
      ],
      siteRules: [{ pattern: 'udemy.com', enabled: true, speed: 1.75 }],
      blacklist: 'imgur.com',
    }));

    expect(source).toBe('videospeed');
    const settings = await getUniversalSettings();
    expect(settings.speedStep).toBe(0.25);
    expect(settings.advanceSeconds).toBe(20);
    expect(settings.audioEnabled).toBe(false);
    expect(settings.controllerSize).toBe(17);
    expect(settings.rememberPerSite).toBe(true);
    expect(settings.enabled).toBe(true);

    // Their `fast` value becomes our preferred speed.
    expect((await getSettings()).defaultSpeed).toBe(2.5);

    const rules = await getSitePatternRules();
    expect(rules.find((rule) => rule.pattern === 'udemy.com')?.defaultSpeed).toBe(1.75);
    expect(rules.find((rule) => rule.pattern === 'imgur.com')?.enabled).toBe(false);
  });

  it('still accepts our own export format', async () => {
    const source = await importUniversalConfiguration(JSON.stringify({
      kind: 'playlist-zamani-universal',
      settings: { ...DEFAULT_UNIVERSAL_SETTINGS, speedStep: 0.5 },
      patternRules: [],
    }));

    expect(source).toBe('playlist-zamani');
    expect((await getUniversalSettings()).speedStep).toBe(0.5);
  });

  it('rejects an unrelated JSON file', async () => {
    await expect(
      importUniversalConfiguration(JSON.stringify({ hello: 'world' })),
    ).rejects.toThrow();
  });
});
