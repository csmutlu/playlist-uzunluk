import type {
  PlaylistAnalysis,
  PlaylistProgress,
  PlaylistVideo,
  VideoProgress,
} from './types';

function videoKey(video: PlaylistVideo): string {
  return `${video.index}:${video.videoId}`;
}

export class PlaylistAnalyzer {
  readonly playlistId: string;
  private readonly videos = new Map<string, PlaylistVideo>();
  private totalSeconds = 0;
  private unknownDurationCount = 0;
  private unavailableCount = 0;
  private expectedCount: number | null = null;
  private updatedAt = Date.now();

  constructor(playlistId: string) {
    this.playlistId = playlistId;
  }

  setExpectedCount(value: number | null): void {
    if (value !== null && Number.isInteger(value) && value >= 0) this.expectedCount = value;
  }

  upsert(video: PlaylistVideo): boolean {
    const key = videoKey(video);
    const previous = this.videos.get(key);
    if (
      previous &&
      previous.durationSeconds === video.durationSeconds &&
      previous.title === video.title &&
      previous.availability === video.availability &&
      previous.source === video.source
    ) {
      return false;
    }

    if (previous) this.removeFromCounters(previous);
    this.videos.set(key, video);
    this.addToCounters(video);
    this.updatedAt = Date.now();
    return true;
  }

  upsertMany(videos: Iterable<PlaylistVideo>): number {
    let changed = 0;
    for (const video of videos) {
      if (this.upsert(video)) changed += 1;
    }
    return changed;
  }

  get count(): number {
    return this.videos.size;
  }

  snapshot(): PlaylistAnalysis {
    const videos = [...this.videos.values()].sort(
      (a, b) => a.index - b.index || a.videoId.localeCompare(b.videoId),
    );
    const prefixSeconds = new Array<number>(videos.length + 1).fill(0);
    for (let index = 0; index < videos.length; index += 1) {
      prefixSeconds[index + 1] =
        (prefixSeconds[index] ?? 0) + (videos[index]?.durationSeconds ?? 0);
    }

    return {
      playlistId: this.playlistId,
      expectedCount: this.expectedCount,
      countedCount: videos.length,
      listComplete: this.expectedCount !== null && videos.length >= this.expectedCount,
      unknownDurationCount: this.unknownDurationCount,
      unavailableCount: this.unavailableCount,
      totalSeconds: this.totalSeconds,
      videos,
      prefixSeconds,
      updatedAt: this.updatedAt,
    };
  }

  private addToCounters(video: PlaylistVideo): void {
    if (video.durationSeconds === null) this.unknownDurationCount += 1;
    else this.totalSeconds += video.durationSeconds;
    if (video.availability === 'unavailable') this.unavailableCount += 1;
  }

  private removeFromCounters(video: PlaylistVideo): void {
    if (video.durationSeconds === null) this.unknownDurationCount -= 1;
    else this.totalSeconds -= video.durationSeconds;
    if (video.availability === 'unavailable') this.unavailableCount -= 1;
  }
}

export function rangeSeconds(
  analysis: PlaylistAnalysis,
  startIndex: number,
  endIndex: number,
): number {
  if (analysis.videos.length === 0) return 0;
  const startPosition = analysis.videos.findIndex((video) => video.index >= startIndex);
  if (startPosition < 0) return 0;

  let endPosition = analysis.videos.length - 1;
  for (let index = startPosition; index < analysis.videos.length; index += 1) {
    if ((analysis.videos[index]?.index ?? 0) > endIndex) {
      endPosition = index - 1;
      break;
    }
  }
  if (endPosition < startPosition) return 0;
  return (
    (analysis.prefixSeconds[endPosition + 1] ?? 0) -
    (analysis.prefixSeconds[startPosition] ?? 0)
  );
}

export function watchedAndRemainingSeconds(
  analysis: PlaylistAnalysis,
  progress: PlaylistProgress | null,
  current?: { videoId: string; positionSeconds: number },
  range?: { start: number; end: number },
): { watchedSeconds: number; remainingSeconds: number; selectedTotalSeconds: number } {
  let selectedTotalSeconds = 0;
  let watchedSeconds = 0;

  for (const video of analysis.videos) {
    if (range && (video.index < range.start || video.index > range.end)) continue;
    const duration = video.durationSeconds ?? 0;
    selectedTotalSeconds += duration;
    const saved = progress?.videos[video.videoId];

    if (saved?.watched) {
      watchedSeconds += duration;
      continue;
    }

    const position =
      current?.videoId === video.videoId
        ? current.positionSeconds
        : Math.min(saved?.positionSeconds ?? 0, duration);
    watchedSeconds += Math.min(Math.max(position, 0), duration);
  }

  return {
    watchedSeconds,
    remainingSeconds: Math.max(0, selectedTotalSeconds - watchedSeconds),
    selectedTotalSeconds,
  };
}

export function setProgressStatus(
  progress: PlaylistProgress,
  videoId: string,
  watched: boolean,
  source: VideoProgress['source'],
  positionSeconds = 0,
  now = Date.now(),
): PlaylistProgress {
  const current = progress.videos[videoId];
  if (current?.source === 'manual' && source === 'auto') return progress;

  return {
    ...progress,
    videos: {
      ...progress.videos,
      [videoId]: {
        watched,
        source,
        positionSeconds: Math.max(current?.positionSeconds ?? 0, positionSeconds),
        updatedAt: now,
      },
    },
    lastVideoId: videoId,
    updatedAt: now,
  };
}
