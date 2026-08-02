import { injectScript } from 'wxt/utils/inject-script';
import {
  getSettings,
  getSiteMediaState,
  getUniversalSettings,
  saveSitePlaybackSpeed,
} from '../lib/storage';
import type { UniversalContentMessage } from '../lib/types';
import { UniversalMediaController } from '../lib/universal-controller';

interface UniversalRuntimeGuard {
  dispose(): void;
}

function siteHostname(): string {
  if (location.protocol === 'file:') return 'local-files';
  try {
    return top?.location.hostname || location.hostname;
  } catch {
    try {
      const referrer = new URL(document.referrer);
      if (referrer.hostname) return referrer.hostname;
    } catch {
      // Use the frame hostname below.
    }
  }
  return location.hostname;
}

export default defineUnlistedScript(async () => {
  const guardedDocument = document as typeof document & {
    __playlistZamaniUniversal?: UniversalRuntimeGuard;
  };
  if (guardedDocument.__playlistZamaniUniversal) return;

  const hostname = siteHostname();
  const channel = crypto.randomUUID();
  const [settings, extensionSettings, siteState] = await Promise.all([
    getUniversalSettings(),
    getSettings(),
    getSiteMediaState(hostname),
  ]);
  if (!settings.enabled) return;
  let bridgeInjected = false;
  const injectBridge = async () => {
    if (bridgeInjected) return;
    try {
      await injectScript('/universal-main.js', {
        keepInDom: false,
        modifyScript(script) {
          script.dataset.pzChannel = channel;
        },
      });
      bridgeInjected = true;
    } catch {
      // Some protected players reject MAIN-world injection.
    }
  };
  const disposeBridge = () => {
    if (!bridgeInjected) return;
    bridgeInjected = false;
    document.dispatchEvent(new CustomEvent(
      `playlist-zamani:control:${channel}`,
      {
        detail: JSON.stringify({ x: true }),
      },
    ));
  };
  if (settings.enabled && siteState.rule?.enabled !== false) void injectBridge();

  const controller = new UniversalMediaController({
    channel,
    hostname,
    settings,
    extensionSettings,
    rule: siteState.rule,
    rememberedSpeed: siteState.playbackSpeed,
    saveSpeed: (speed) => saveSitePlaybackSpeed(hostname, speed),
  });
  controller.start();

  let disposed = false;
  let reloadQueued = false;
  const reload = () => {
    if (disposed || reloadQueued) return;
    reloadQueued = true;
    queueMicrotask(async () => {
      reloadQueued = false;
      if (disposed) return;
      const [nextSettings, nextExtensionSettings, nextSiteState] = await Promise.all([
        getUniversalSettings(),
        getSettings(),
        getSiteMediaState(hostname),
      ]);
      if (nextSettings.enabled && nextSiteState.rule?.enabled !== false) {
        void injectBridge();
      } else {
        disposeBridge();
      }
      controller.update(
        nextSettings,
        nextExtensionSettings,
        nextSiteState.rule,
        nextSiteState.playbackSpeed,
      );
    });
  };

  const handleStorageChange = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string,
  ) => {
    if (
      (areaName === 'sync' && (changes.settings || changes['universalSettings:v1'])) ||
      (areaName === 'local' && changes['universalSiteData:v1'])
    ) {
      void reload();
    }
  };

  const handleMessage = (
    message: UniversalContentMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void,
  ): true | void => {
    if (message.type === 'universal:site-info') {
      sendResponse(controller.siteInfo());
      return;
    }
    if (message.type === 'universal:set-speed') {
      controller.setSpeed(message.speed);
      sendResponse(controller.siteInfo());
      return;
    }
    if (message.type === 'universal:adjust-speed') {
      controller.adjustSpeed(message.delta);
      sendResponse(controller.siteInfo());
      return;
    }
    if (message.type === 'universal:toggle-playback') {
      controller.togglePlayback();
      sendResponse(controller.siteInfo());
      return;
    }
    if (message.type === 'universal:volume-info') {
      sendResponse(controller.requestVolumeInfo());
      return;
    }
    if (message.type === 'universal:set-volume') {
      void controller.setMasterVolume(message.percent).then(sendResponse);
      return true;
    }
    if (message.type === 'universal:set-audio-profile') {
      void controller.setMediaAudioProfile(message.settings).then(sendResponse);
      return true;
    }
    if (message.type === 'universal:toggle-mute') {
      void controller.toggleMasterMute().then(sendResponse);
      return true;
    }
    if (message.type === 'universal:download-info') {
      sendResponse(controller.downloadInfo());
      return;
    }
    if (message.type === 'universal:disable') {
      dispose();
      sendResponse({ ok: true });
    }
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    controller.dispose();
    disposeBridge();
    chrome.storage.onChanged.removeListener(handleStorageChange);
    chrome.runtime.onMessage.removeListener(handleMessage);
    guardedDocument.__playlistZamaniUniversal = undefined;
  };

  guardedDocument.__playlistZamaniUniversal = { dispose };
  chrome.storage.onChanged.addListener(handleStorageChange);
  chrome.runtime.onMessage.addListener(handleMessage);
  window.addEventListener('pagehide', dispose, { once: true });
});
