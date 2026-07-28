import { describe, expect, it, vi } from 'vitest';
import { fetchPublicPlaylist, YouTubeApiError } from '../lib/youtube-api';

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('YouTube API client', () => {
  it('paginates playlist items, batches details and preserves unavailable entries', async () => {
    const items = Array.from({ length: 51 }, (_, index) => ({
      contentDetails: { videoId: `id-${index + 1}` },
      snippet: { title: `Item ${index + 1}`, position: index },
    }));
    const calls: string[] = [];
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      calls.push(url.toString());
      if (url.pathname.endsWith('/playlistItems')) {
        const second = url.searchParams.get('pageToken') === 'next';
        return jsonResponse({
          pageInfo: { totalResults: 51 },
          nextPageToken: second ? undefined : 'next',
          items: second ? items.slice(50) : items.slice(0, 50),
        });
      }
      const ids = (url.searchParams.get('id') ?? '').split(',');
      return jsonResponse({
        items: ids
          .filter((id) => id !== 'id-51')
          .map((id) => ({
            id,
            contentDetails: { duration: 'PT1M30S' },
            snippet: { title: `Title ${id}`, liveBroadcastContent: 'none' },
          })),
      });
    }) as unknown as typeof fetch;

    const result = await fetchPublicPlaylist('PL-test', 'key', {
      signal: new AbortController().signal,
      fetcher,
    });

    expect(result.expectedCount).toBe(51);
    expect(result.videos).toHaveLength(51);
    expect(result.videos[0]?.durationSeconds).toBe(90);
    expect(result.videos[50]).toMatchObject({
      availability: 'unavailable',
      durationSeconds: null,
    });
    expect(calls.filter((url) => url.includes('/playlistItems'))).toHaveLength(2);
    expect(calls.filter((url) => url.includes('/videos?'))).toHaveLength(2);
  });

  it('surfaces structured quota errors', async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse(
        {
          error: {
            code: 403,
            message: 'Quota exceeded',
            errors: [{ reason: 'quotaExceeded' }],
          },
        },
        403,
      ),
    ) as unknown as typeof fetch;

    await expect(
      fetchPublicPlaylist('PL-test', 'key', {
        signal: new AbortController().signal,
        fetcher,
      }),
    ).rejects.toBeInstanceOf(YouTubeApiError);
  });
});
