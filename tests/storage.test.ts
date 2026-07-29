import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PLAYLIST_HISTORY_LIMIT } from '../lib/constants';
import {
  clearAllProgress,
  getPlaylistHistory,
  savePlaylistHistoryEntry,
} from '../lib/storage';
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
