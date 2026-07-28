import { CACHE_TTL_MS } from '../lib/constants';
import {
  clearPlaylistCaches,
  getApiKey,
  getPlaylistCache,
  savePlaylistCache,
} from '../lib/storage';
import {
  SCHEMA_VERSION,
  type ApiPlaylistResponse,
  type BackgroundMessage,
} from '../lib/types';
import { fetchPublicPlaylist, YouTubeApiError } from '../lib/youtube-api';

const inFlight = new Map<string, Promise<ApiPlaylistResponse>>();
const inFlightControllers = new Map<string, AbortController>();

function apiError(error: unknown, playlistId: string): ApiPlaylistResponse {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return { ok: false, playlistId, error: 'Request cancelled', errorCode: 'network' };
  }

  const data = error instanceof YouTubeApiError ? error.data : undefined;
  const reason = data?.error?.errors?.[0]?.reason ?? '';
  const message =
    data?.error?.message ?? (error instanceof Error ? error.message : 'Unknown API error');
  if (reason.includes('quota')) {
    return { ok: false, playlistId, error: message, errorCode: 'quota' };
  }
  if (
    reason.includes('forbidden') ||
    reason.includes('playlistItemsNotAccessible') ||
    data?.error?.code === 403
  ) {
    return { ok: false, playlistId, error: message, errorCode: 'private' };
  }
  return { ok: false, playlistId, error: message, errorCode: 'network' };
}

async function fetchPlaylist(
  playlistId: string,
  apiKey: string,
  force: boolean,
  signal: AbortSignal,
): Promise<ApiPlaylistResponse> {
  if (!force) {
    const cached = await getPlaylistCache(playlistId);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return {
        ok: true,
        playlistId,
        expectedCount: cached.expectedCount,
        videos: cached.videos,
        fromCache: true,
      };
    }
  }

  try {
    const { videos, expectedCount } = await fetchPublicPlaylist(playlistId, apiKey, {
      signal,
    });

    await savePlaylistCache({
      schemaVersion: SCHEMA_VERSION,
      playlistId,
      videos,
      expectedCount,
      fetchedAt: Date.now(),
    });
    return {
      ok: true,
      playlistId,
      expectedCount,
      videos,
      fromCache: false,
    };
  } catch (error) {
    return apiError(error, playlistId);
  }
}

async function handleMessage(message: BackgroundMessage): Promise<ApiPlaylistResponse | { ok: true }> {
  if (message.type === 'playlist-cache:clear') {
    await clearPlaylistCaches();
    return { ok: true };
  }
  if (message.type === 'playlist-api:cancel') {
    inFlightControllers.get(message.playlistId)?.abort();
    return { ok: true };
  }

  const { playlistId, force = false } = message;
  const hasPermission = await chrome.permissions.contains({
    origins: ['https://www.googleapis.com/*'],
  });
  if (!hasPermission) {
    return { ok: false, playlistId, errorCode: 'missing_permission', error: 'Permission missing' };
  }
  const apiKey = await getApiKey();
  if (!apiKey) {
    return { ok: false, playlistId, errorCode: 'missing_key', error: 'API key missing' };
  }

  const inFlightKey = `${playlistId}:${force ? 'force' : 'cached'}`;
  const existing = inFlight.get(inFlightKey);
  if (existing) return existing;

  const controller = new AbortController();
  inFlightControllers.set(playlistId, controller);
  const request = fetchPlaylist(playlistId, apiKey, force, controller.signal).finally(() => {
    inFlight.delete(inFlightKey);
    if (inFlightControllers.get(playlistId) === controller) {
      inFlightControllers.delete(playlistId);
    }
  });
  inFlight.set(inFlightKey, request);
  return request;
}

export default defineBackground(() => {
  chrome.runtime.onMessage.addListener(
    (
      rawMessage: BackgroundMessage,
      _sender,
      sendResponse: (response: ApiPlaylistResponse | { ok: true }) => void,
    ) => {
      handleMessage(rawMessage).then(sendResponse).catch((error: unknown) => {
        sendResponse({
          ok: false,
          playlistId:
            rawMessage.type === 'playlist-api:fetch' || rawMessage.type === 'playlist-api:cancel'
              ? rawMessage.playlistId
              : 'unknown',
          error: error instanceof Error ? error.message : 'Unknown error',
          errorCode: 'unknown',
        });
      });
      return true;
    },
  );
});
