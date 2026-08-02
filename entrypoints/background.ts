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
  type AudibleTabInfo,
  type BackgroundMessage,
  type OffscreenAudioMessage,
  type TabAudioSettings,
  type TabAudioState,
} from '../lib/types';
import { fetchPublicPlaylist, YouTubeApiError } from '../lib/youtube-api';
import {
  hasUniversalHostPermission,
  isUniversalScriptRegistered,
  registerUniversalScript,
  unregisterUniversalScript,
} from '../lib/universal-registration';
import { sanitizeDownloadFilename } from '../lib/universal';
import {
  DEFAULT_TAB_AUDIO_SETTINGS,
  isNeutralTabAudio,
  normalizeTabAudioSettings,
} from '../lib/tab-audio';

const inFlight = new Map<string, Promise<ApiPlaylistResponse>>();
const inFlightControllers = new Map<string, AbortController>();
let universalRegistrationQueue: Promise<void> = Promise.resolve();
let creatingOffscreenDocument: Promise<void> | null = null;
const tabAudioQueues = new Map<number, Promise<TabAudioState>>();
const OFFSCREEN_AUDIO_URL = 'offscreen.html';

const ICON_PATHS = (enabled: boolean) => ({
  16: enabled ? 'icon-16.png' : 'icon-disabled-16.png',
  32: enabled ? 'icon-32.png' : 'icon-disabled-32.png',
  48: enabled ? 'icon-48.png' : 'icon-disabled-48.png',
  128: enabled ? 'icon-128.png' : 'icon-disabled-128.png',
});

async function setUniversalIcon(enabled: boolean): Promise<void> {
  await browser.action.setIcon({ path: ICON_PATHS(enabled) }).catch(() => undefined);
}

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
  | AudibleTabInfo[]
  | TabAudioState
  | { ok: true; registered?: boolean; downloadId?: number }
  | { ok: false; error: string; registered?: boolean };

function tabAudioSupported(): boolean {
  return typeof chrome.tabCapture?.getMediaStreamId === 'function' &&
    typeof chrome.offscreen?.createDocument === 'function';
}

function unsupportedAudioState(tabId: number, error?: string): TabAudioState {
  return {
    tabId,
    active: false,
    supported: false,
    ...DEFAULT_TAB_AUDIO_SETTINGS,
    ...(error ? { error } : {}),
  };
}

async function hasOffscreenAudioDocument(): Promise<boolean> {
  if (!tabAudioSupported()) return false;
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_AUDIO_URL)],
  });
  return contexts.length > 0;
}

async function ensureOffscreenAudioDocument(): Promise<void> {
  if (await hasOffscreenAudioDocument()) return;
  if (!creatingOffscreenDocument) {
    creatingOffscreenDocument = chrome.offscreen.createDocument({
      url: OFFSCREEN_AUDIO_URL,
      reasons: [
        chrome.offscreen.Reason.USER_MEDIA,
        chrome.offscreen.Reason.AUDIO_PLAYBACK,
      ],
      justification: 'Apply user-requested volume and equalizer settings to tab audio.',
    }).finally(() => {
      creatingOffscreenDocument = null;
    });
  }
  await creatingOffscreenDocument;
}

async function sendAudioEngine(
  message: OffscreenAudioMessage,
): Promise<TabAudioState | TabAudioState[]> {
  return chrome.runtime.sendMessage(message) as Promise<TabAudioState | TabAudioState[]>;
}

async function audioState(tabId: number): Promise<TabAudioState> {
  if (!tabAudioSupported()) return unsupportedAudioState(tabId);
  if (!(await hasOffscreenAudioDocument())) {
    return { tabId, active: false, supported: true, ...DEFAULT_TAB_AUDIO_SETTINGS };
  }
  return sendAudioEngine({
    target: 'offscreen-audio',
    type: 'audio-engine:get-state',
    tabId,
  }) as Promise<TabAudioState>;
}

async function setTabAudio(
  tabId: number,
  requested: TabAudioSettings,
): Promise<TabAudioState> {
  if (!tabAudioSupported()) return unsupportedAudioState(tabId);
  const settings = normalizeTabAudioSettings(requested);
  const current = await audioState(tabId);
  if (current.active) {
    if (isNeutralTabAudio(settings)) {
      return sendAudioEngine({
        target: 'offscreen-audio',
        type: 'audio-engine:stop',
        tabId,
      }) as Promise<TabAudioState>;
    }
    return sendAudioEngine({
      target: 'offscreen-audio',
      type: 'audio-engine:update',
      tabId,
      settings,
    }) as Promise<TabAudioState>;
  }
  if (isNeutralTabAudio(settings)) return current;
  const tab = await browser.tabs.get(tabId);
  if (!tab.active) {
    return { ...current, error: 'Open this tab before enabling tab audio.' };
  }
  try {
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
    await ensureOffscreenAudioDocument();
    return sendAudioEngine({
      target: 'offscreen-audio',
      type: 'audio-engine:start',
      tabId,
      streamId,
      settings,
    }) as Promise<TabAudioState>;
  } catch (error) {
    return {
      ...current,
      error: error instanceof Error ? error.message : 'Tab audio capture failed.',
    };
  }
}

function queueTabAudio(tabId: number, settings: TabAudioSettings): Promise<TabAudioState> {
  const previous = tabAudioQueues.get(tabId);
  const next = (previous ?? Promise.resolve(unsupportedAudioState(tabId)))
    .catch(() => unsupportedAudioState(tabId))
    .then(() => setTabAudio(tabId, settings))
    .catch(async (error: unknown) => {
      const message = error instanceof Error ? error.message : 'Tab audio capture failed.';
      try {
        return { ...await audioState(tabId), error: message };
      } catch {
        return {
          tabId,
          active: false,
          supported: tabAudioSupported(),
          ...normalizeTabAudioSettings(settings),
          error: message,
        };
      }
    })
    .finally(() => {
      if (tabAudioQueues.get(tabId) === next) tabAudioQueues.delete(tabId);
    });
  tabAudioQueues.set(tabId, next);
  return next;
}

async function listAudibleTabs(): Promise<AudibleTabInfo[]> {
  const states = tabAudioSupported() && await hasOffscreenAudioDocument()
    ? await sendAudioEngine({ target: 'offscreen-audio', type: 'audio-engine:list-states' })
    : [];
  const controlledIds = new Set(
    (Array.isArray(states) ? states : []).filter((state) => state.active).map((state) => state.tabId),
  );
  const tabs = await browser.tabs.query({});
  return tabs
    .filter((tab) => tab.id !== undefined && (tab.audible || controlledIds.has(tab.id)))
    .map((tab): AudibleTabInfo => ({
      tabId: tab.id!,
      title: tab.title || tab.url || `Tab ${tab.id}`,
      url: tab.url ?? '',
      ...(tab.favIconUrl ? { favIconUrl: tab.favIconUrl } : {}),
      audible: Boolean(tab.audible),
      active: Boolean(tab.active),
      controlled: controlledIds.has(tab.id!),
    }))
    .sort((left, right) => Number(right.active) - Number(left.active) || left.title.localeCompare(right.title));
}

async function handleMessage(message: BackgroundMessage): Promise<BackgroundResponse> {
  if (message.type === 'audio:list-tabs') return listAudibleTabs();
  if (message.type === 'audio:get-state') return audioState(message.tabId);
  if (message.type === 'audio:set') return queueTabAudio(message.tabId, message.settings);
  if (message.type === 'audio:stop') {
    if (!tabAudioSupported() || !(await hasOffscreenAudioDocument())) {
      return tabAudioSupported()
        ? { tabId: message.tabId, active: false, supported: true, ...DEFAULT_TAB_AUDIO_SETTINGS }
        : unsupportedAudioState(message.tabId);
    }
    return sendAudioEngine({
      target: 'offscreen-audio',
      type: 'audio-engine:stop',
      tabId: message.tabId,
    }) as Promise<TabAudioState>;
  }
  if (message.type === 'audio:activate-tab') {
    const tab = await browser.tabs.get(message.tabId);
    if (tab.windowId !== undefined) await browser.windows.update(tab.windowId, { focused: true });
    await browser.tabs.update(message.tabId, { active: true });
    return { ok: true };
  }
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
    await setUniversalIcon(true);
    return { ok: true, registered: true };
  }
  if (message.type === 'universal:unregister') {
    await queueUniversalRegistration(unregisterUniversalScript);
    await setUniversalIcon(false);
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
      const enabled = settings.enabled && hasPermission;
      if (enabled) await registerUniversalScript();
      else await unregisterUniversalScript();
      await setUniversalIcon(enabled);
    });
  };

  void syncUniversalRegistration();
  chrome.runtime.onInstalled.addListener(() => void syncUniversalRegistration());
  chrome.runtime.onStartup.addListener(() => void syncUniversalRegistration());
  chrome.permissions.onAdded.addListener(() => void syncUniversalRegistration());
  chrome.permissions.onRemoved.addListener(() => void syncUniversalRegistration());

  chrome.runtime.onMessage.addListener(
    (
      rawMessage: BackgroundMessage | OffscreenAudioMessage,
      _sender,
      sendResponse: (response: BackgroundResponse) => void,
    ) => {
      if ('target' in rawMessage) return false;
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
  browser.tabs.onRemoved.addListener((tabId) => {
    if (!tabAudioSupported()) return;
    void hasOffscreenAudioDocument().then((exists) => {
      if (!exists) return;
      void sendAudioEngine({
        target: 'offscreen-audio',
        type: 'audio-engine:stop',
        tabId,
      });
    });
  });
});
