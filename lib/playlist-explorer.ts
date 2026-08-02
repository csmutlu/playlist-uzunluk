import type { PlaylistProgress, PlaylistVideo } from './types';

export type PlaylistVideoFilter =
  | 'all'
  | 'unwatched'
  | 'watched'
  | 'short'
  | 'medium'
  | 'long'
  | 'unavailable';

export type PlaylistVideoSort =
  | 'playlist'
  | 'title'
  | 'shortest'
  | 'longest';

export interface PlaylistExploreOptions {
  query: string;
  filter: PlaylistVideoFilter;
  sort: PlaylistVideoSort;
  locale: string;
}

function searchable(value: string, locale: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase(locale)
    .trim();
}

function matchesFilter(
  video: PlaylistVideo,
  filter: PlaylistVideoFilter,
  progress: PlaylistProgress | null,
): boolean {
  const duration = video.durationSeconds;
  if (filter === 'all') return true;
  if (filter === 'watched') return progress?.videos[video.videoId]?.watched === true;
  if (filter === 'unwatched') return progress?.videos[video.videoId]?.watched !== true;
  if (filter === 'unavailable') return video.availability === 'unavailable';
  if (duration === null) return false;
  if (filter === 'short') return duration < 10 * 60;
  if (filter === 'medium') return duration >= 10 * 60 && duration < 30 * 60;
  return duration >= 30 * 60;
}

export function explorePlaylistVideos(
  videos: readonly PlaylistVideo[],
  progress: PlaylistProgress | null,
  options: PlaylistExploreOptions,
): PlaylistVideo[] {
  const query = searchable(options.query, options.locale);
  const selected = videos.filter((video) =>
    (!query || searchable(video.title, options.locale).includes(query)) &&
    matchesFilter(video, options.filter, progress));

  return selected.sort((left, right) => {
    if (options.sort === 'title') {
      return left.title.localeCompare(right.title, options.locale, { sensitivity: 'base' }) ||
        left.index - right.index;
    }
    if (options.sort === 'shortest' || options.sort === 'longest') {
      if (left.durationSeconds === null && right.durationSeconds !== null) return 1;
      if (right.durationSeconds === null && left.durationSeconds !== null) return -1;
      const direction = options.sort === 'shortest' ? 1 : -1;
      const leftDuration = left.durationSeconds ?? 0;
      const rightDuration = right.durationSeconds ?? 0;
      if (leftDuration !== rightDuration) return (leftDuration - rightDuration) * direction;
    }
    return left.index - right.index;
  });
}

export function playlistVideoTimes(
  videos: readonly PlaylistVideo[],
  progress: PlaylistProgress | null,
  current?: { videoId: string; positionSeconds: number },
): { watchedSeconds: number; remainingSeconds: number; selectedTotalSeconds: number } {
  let watchedSeconds = 0;
  let selectedTotalSeconds = 0;
  for (const video of videos) {
    const duration = video.durationSeconds ?? 0;
    selectedTotalSeconds += duration;
    const saved = progress?.videos[video.videoId];
    if (saved?.watched) {
      watchedSeconds += duration;
      continue;
    }
    const position = current?.videoId === video.videoId
      ? current.positionSeconds
      : saved?.positionSeconds ?? 0;
    watchedSeconds += Math.min(duration, Math.max(0, position));
  }
  return {
    watchedSeconds,
    remainingSeconds: Math.max(0, selectedTotalSeconds - watchedSeconds),
    selectedTotalSeconds,
  };
}
