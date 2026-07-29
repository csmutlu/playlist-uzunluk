import { browser } from 'wxt/browser';
import { UNIVERSAL_FILE_ORIGIN, UNIVERSAL_HOST_ORIGINS } from './constants';

const UNIVERSAL_SCRIPT_ID = 'playlist-zamani-universal';
const UNIVERSAL_SCRIPT_FILE = 'universal.js' as const;

function isFirefoxBuild(): boolean {
  return browser.runtime.getManifest().manifest_version === 2;
}

export async function hasUniversalHostPermission(): Promise<boolean> {
  return browser.permissions.contains({ origins: [...UNIVERSAL_HOST_ORIGINS] });
}

export async function isUniversalScriptRegistered(): Promise<boolean> {
  const scripts = await browser.scripting.getRegisteredContentScripts({
    ids: [UNIVERSAL_SCRIPT_ID],
  });
  return scripts.length > 0;
}

export async function registerUniversalScript(tabId?: number): Promise<void> {
  const hasFilePermission = await browser.permissions.contains({
    origins: [UNIVERSAL_FILE_ORIGIN],
  }).catch(() => false);
  const definition: Browser.scripting.RegisteredContentScript = {
    id: UNIVERSAL_SCRIPT_ID,
    matches: [
      ...UNIVERSAL_HOST_ORIGINS,
      ...(hasFilePermission ? [UNIVERSAL_FILE_ORIGIN] : []),
    ],
    js: [UNIVERSAL_SCRIPT_FILE],
    runAt: 'document_start',
    allFrames: true,
    ...(
      isFirefoxBuild()
        ? {}
        : {
            matchOriginAsFallback: true,
            persistAcrossSessions: true,
          }
    ),
  };
  const existing = await browser.scripting.getRegisteredContentScripts({
    ids: [UNIVERSAL_SCRIPT_ID],
  });
  if (existing.length > 0) {
    await browser.scripting.updateContentScripts([definition]);
  } else {
    await browser.scripting.registerContentScripts([definition]);
  }

  if (tabId !== undefined) {
    await browser.scripting.executeScript({
      target: { tabId, allFrames: true },
      // Firefox requires a path relative to the extension root here.
      files: [UNIVERSAL_SCRIPT_FILE as unknown as '/universal.js'],
      ...(isFirefoxBuild() ? {} : { injectImmediately: true }),
    }).catch(() => undefined);
  }
}

export async function unregisterUniversalScript(): Promise<void> {
  const registered = await isUniversalScriptRegistered();
  if (!registered) return;
  const tabs = await browser.tabs.query({});
  await Promise.allSettled(
    tabs.flatMap((tab) => (
      tab.id === undefined
        ? []
        : [browser.tabs.sendMessage(tab.id, { type: 'universal:disable' })]
    )),
  );
  await browser.scripting.unregisterContentScripts({ ids: [UNIVERSAL_SCRIPT_ID] });
}
