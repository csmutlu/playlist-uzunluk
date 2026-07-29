import { browser } from 'wxt/browser';
import { CACHE_TTL_MS } from '../lib/constants';
import {
  clearPlaylistCaches,
  getApiKey,
  getPlaylistCache,
  getUniversalSettings,
  savePlaylistCache,
} from '../lib/storage';
import {
  SCHEMA_VERSION,
  type ApiPlaylistResponse,
  type BackgroundMessage,
} from '../lib/types';
import { fetchPublicPlaylist, YouTubeApiError } from '../lib/youtube-api';
import {
  hasUniversalHostPermission,
  isUniversalScriptRegistered,
  registerUniversalScript,
  unregisterUniversalScript,
} from '../lib/universal-registration';
import { sanitizeDownloadFilename } from '../lib/universal';

const inFlight = new Map<string, Promise<ApiPlaylistResponse>>();
const inFlightControllers = new Map<string, AbortController>();
let universalRegistrationQueue: Promise<void> = Promise.resolve();

function queueUniversalRegistration<T>(operation: () => Promise<T>): Promise<T> {
  const result = universalRegistrationQueue.then(operation, operation);
  universalRegistrationQueue = result.then(() => undefined, () => undefined);
  return result;
}

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

type BackgroundResponse =
  | ApiPlaylistResponse
  | { ok: true; registered?: boolean; downloadId?: number }
  | { ok: false; error: string; registered?: boolean };

async function handleMessage(message: BackgroundMessage): Promise<BackgroundResponse> {
  if (message.type === 'universal:download') {
    const hasPermission = await browser.permissions.contains({
      permissions: ['downloads'],
    });
    if (!hasPermission) return { ok: false, error: 'Downloads permission missing' };
    let url: URL;
    try {
      url = new URL(message.url);
    } catch {
      return { ok: false, error: 'Invalid media URL' };
    }
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      /\.(?:m3u8|mpd)$/i.test(url.pathname) ||
      url.username ||
      url.password
    ) {
      return { ok: false, error: 'Unsupported media URL' };
    }
    const filename = message.filename
      ? sanitizeDownloadFilename(message.filename)
      : '';
    const downloadId = await browser.downloads.download({
      url: url.href,
      saveAs: true,
      conflictAction: 'uniquify',
      ...(filename ? { filename } : {}),
    });
    return { ok: true, downloadId };
  }
  if (message.type === 'universal:register') {
    if (!(await hasUniversalHostPermission())) {
      return { ok: false, error: 'Host permission missing', registered: false };
    }
    await queueUniversalRegistration(() => registerUniversalScript(message.tabId));
    return { ok: true, registered: true };
  }
  if (message.type === 'universal:unregister') {
    await queueUniversalRegistration(unregisterUniversalScript);
    return { ok: true, registered: false };
  }
  if (message.type === 'universal:registration-status') {
    return { ok: true, registered: await isUniversalScriptRegistered() };
  }
  if (message.type === 'playlist-cache:clear') {
    await clearPlaylistCaches();
    return { ok: true };
  }
  if (message.type === 'playlist-api:cancel') {
    inFlightControllers.get(message.playlistId)?.abort();
    return { ok: true };
  }

  const { playlistId, force = false } = message;
  const hasPermission = await browser.permissions.contains({
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
  const syncUniversalRegistration = async () => {
    await queueUniversalRegistration(async () => {
      const [settings, hasPermission] = await Promise.all([
        getUniversalSettings(),
        hasUniversalHostPermission(),
      ]);
      if (settings.enabled && hasPermission) await registerUniversalScript();
      else await unregisterUniversalScript();
    });
  };

  void syncUniversalRegistration();
  chrome.runtime.onInstalled.addListener(() => void syncUniversalRegistration());
  chrome.runtime.onStartup.addListener(() => void syncUniversalRegistration());
  chrome.permissions.onAdded.addListener(() => void syncUniversalRegistration());
  chrome.permissions.onRemoved.addListener(() => void syncUniversalRegistration());

  chrome.runtime.onMessage.addListener(
    (
      rawMessage: BackgroundMessage,
      _sender,
      sendResponse: (response: BackgroundResponse) => void,
    ) => {
      handleMessage(rawMessage).then(sendResponse).catch((error: unknown) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          ...(
            rawMessage.type === 'playlist-api:fetch' ||
            rawMessage.type === 'playlist-api:cancel'
              ? { playlistId: rawMessage.playlistId, errorCode: 'unknown' as const }
              : {}
          ),
        });
      });
      return true;
    },
  );
});
