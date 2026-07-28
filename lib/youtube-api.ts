import { parseIsoDuration } from './iso-duration';
import type { PlaylistVideo } from './types';

export interface ApiErrorBody {
  error?: { code?: number; message?: string; errors?: Array<{ reason?: string }> };
}

interface PlaylistItem {
  contentDetails?: { videoId?: string };
  snippet?: { title?: string; position?: number };
}

interface PlaylistItemsPage extends ApiErrorBody {
  nextPageToken?: string;
  pageInfo?: { totalResults?: number };
  items?: PlaylistItem[];
}

interface VideoDetailsItem {
  id?: string;
  contentDetails?: { duration?: string };
  snippet?: { title?: string; liveBroadcastContent?: string };
}

interface VideosPage extends ApiErrorBody {
  items?: VideoDetailsItem[];
}

export interface PublicPlaylistResult {
  videos: PlaylistVideo[];
  expectedCount: number;
}

export class YouTubeApiError extends Error {
  readonly data: ApiErrorBody;

  constructor(data: ApiErrorBody) {
    super(data.error?.message ?? 'YouTube API request failed');
    this.name = 'YouTubeApiError';
    this.data = data;
  }
}

function apiUrl(path: string, params: Record<string, string>): string {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

async function fetchJson<T extends ApiErrorBody>(
  fetcher: typeof fetch,
  url: string,
  signal: AbortSignal,
): Promise<T> {
  const response = await fetcher(url, { signal });
  const data = (await response.json()) as T;
  if (!response.ok) throw new YouTubeApiError(data);
  return data;
}

async function fetchVideoChunks(
  ids: string[],
  apiKey: string,
  signal: AbortSignal,
  fetcher: typeof fetch,
): Promise<Map<string, VideoDetailsItem>> {
  const chunks: string[][] = [];
  for (let index = 0; index < ids.length; index += 50) {
    chunks.push(ids.slice(index, index + 50));
  }

  const result = new Map<string, VideoDetailsItem>();
  let cursor = 0;
  const workerCount = Math.min(3, chunks.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (cursor < chunks.length) {
      const chunk = chunks[cursor];
      cursor += 1;
      if (!chunk) continue;
      const page = await fetchJson<VideosPage>(
        fetcher,
        apiUrl('videos', {
          part: 'contentDetails,snippet',
          id: chunk.join(','),
          key: apiKey,
          fields:
            'items(id,contentDetails/duration,snippet/title,snippet/liveBroadcastContent),error',
        }),
        signal,
      );
      for (const item of page.items ?? []) {
        if (item.id) result.set(item.id, item);
      }
    }
  });
  await Promise.all(workers);
  return result;
}

export async function fetchPublicPlaylist(
  playlistId: string,
  apiKey: string,
  options: { signal: AbortSignal; fetcher?: typeof fetch },
): Promise<PublicPlaylistResult> {
  const fetcher = options.fetcher ?? fetch;
  const items: PlaylistItem[] = [];
  let pageToken = '';
  let expectedCount = 0;

  do {
    const page = await fetchJson<PlaylistItemsPage>(
      fetcher,
      apiUrl('playlistItems', {
        part: 'contentDetails,snippet',
        playlistId,
        maxResults: '50',
        pageToken,
        key: apiKey,
        fields:
          'nextPageToken,pageInfo/totalResults,items(contentDetails/videoId,snippet/title,snippet/position),error',
      }),
      options.signal,
    );
    expectedCount = page.pageInfo?.totalResults ?? expectedCount;
    items.push(...(page.items ?? []));
    pageToken = page.nextPageToken ?? '';
  } while (pageToken);

  const ids = items
    .map((item) => item.contentDetails?.videoId)
    .filter((id): id is string => Boolean(id));
  const details = await fetchVideoChunks(ids, apiKey, options.signal, fetcher);
  const videos: PlaylistVideo[] = items.map((item, position) => {
    const videoId = item.contentDetails?.videoId ?? `unavailable-${position + 1}`;
    const detail = details.get(videoId);
    const isLive = detail?.snippet?.liveBroadcastContent === 'live';
    const duration = detail?.contentDetails?.duration
      ? parseIsoDuration(detail.contentDetails.duration)
      : null;
    return {
      videoId,
      index: (item.snippet?.position ?? position) + 1,
      title: detail?.snippet?.title ?? item.snippet?.title ?? '',
      durationSeconds: isLive ? null : duration,
      availability: isLive ? 'live' : detail ? 'available' : 'unavailable',
      source: 'api',
    };
  });

  return { videos, expectedCount: expectedCount || videos.length };
}
