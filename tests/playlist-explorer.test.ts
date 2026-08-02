import { describe, expect, it } from 'vitest';
import { emptyProgress } from '../lib/storage';
import {
  explorePlaylistVideos,
  playlistVideoTimes,
} from '../lib/playlist-explorer';
import type { PlaylistVideo } from '../lib/types';

const videos: PlaylistVideo[] = [
  { videoId: 'a', index: 1, title: 'React Giriş', durationSeconds: 300, availability: 'available', source: 'dom' },
  { videoId: 'b', index: 2, title: 'TypeScript İleri', durationSeconds: 1_200, availability: 'available', source: 'dom' },
  { videoId: 'c', index: 3, title: 'React Performans', durationSeconds: 2_400, availability: 'available', source: 'dom' },
  { videoId: 'd', index: 4, title: 'Silinen video', durationSeconds: null, availability: 'unavailable', source: 'dom' },
];

describe('playlist explorer', () => {
  it('searches titles without case or Turkish accents', () => {
    const result = explorePlaylistVideos(videos, null, {
      query: 'react giris', filter: 'all', sort: 'playlist', locale: 'tr',
    });
    expect(result.map((video) => video.videoId)).toEqual(['a']);
  });

  it('filters watched, duration buckets and unavailable entries', () => {
    const progress = emptyProgress('PL');
    progress.videos.b = { watched: true, source: 'manual', positionSeconds: 0, updatedAt: 1 };
    expect(explorePlaylistVideos(videos, progress, {
      query: '', filter: 'watched', sort: 'playlist', locale: 'en',
    }).map((video) => video.videoId)).toEqual(['b']);
    expect(explorePlaylistVideos(videos, progress, {
      query: '', filter: 'long', sort: 'playlist', locale: 'en',
    }).map((video) => video.videoId)).toEqual(['c']);
    expect(explorePlaylistVideos(videos, progress, {
      query: '', filter: 'unavailable', sort: 'playlist', locale: 'en',
    }).map((video) => video.videoId)).toEqual(['d']);
  });

  it('sorts without mutating the canonical playlist order', () => {
    const copy = [...videos];
    const result = explorePlaylistVideos(videos, null, {
      query: '', filter: 'all', sort: 'longest', locale: 'en',
    });
    expect(result.map((video) => video.videoId)).toEqual(['c', 'b', 'a', 'd']);
    expect(videos).toEqual(copy);
  });

  it('calculates progress for only the matched result set', () => {
    const progress = emptyProgress('PL');
    progress.videos.a = { watched: true, source: 'manual', positionSeconds: 0, updatedAt: 1 };
    expect(playlistVideoTimes(videos.slice(0, 3), progress, {
      videoId: 'b', positionSeconds: 200,
    })).toEqual({
      watchedSeconds: 500,
      remainingSeconds: 3_400,
      selectedTotalSeconds: 3_900,
    });
  });
});
