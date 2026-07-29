import { browser } from 'wxt/browser';
import { UNIVERSAL_FILE_ORIGIN, UNIVERSAL_HOST_ORIGINS } from './constants';

const UNIVERSAL_SCRIPT_ID = 'playlist-zamani-universal';
const UNIVERSAL_SCRIPT_FILE = 'universal.js' as const;
const UNIVERSAL_SCRIPT_PUBLIC_PATH = '/universal.js' as const;
interface FirefoxRegisteredContentScript {
  unregister(): Promise<void>;
}

interface FirefoxContentScriptsApi {
  register(options: {
    matches: string[];
    js: Array<{ file: string }>;
    runAt: 'document_start';
    allFrames: boolean;
    matchAboutBlank: boolean;
  }): Promise<FirefoxRegisteredContentScript>;
}

const firefoxContentScripts = (
  browser as unknown as { contentScripts: FirefoxContentScriptsApi }
).contentScripts;
let firefoxRegisteredScript: FirefoxRegisteredContentScript | null = null;

function isFirefoxBuild(): boolean {
  return browser.runtime.getManifest().manifest_version === 2;
}

export async function hasUniversalHostPermission(): Promise<boolean> {
  return browser.permissions.contains({ origins: [...UNIVERSAL_HOST_ORIGINS] });
}

export async function isUniversalScriptRegistered(): Promise<boolean> {
  if (isFirefoxBuild()) return firefoxRegisteredScript !== null;
  const scripts = await browser.scripting.getRegisteredContentScripts({
    ids: [UNIVERSAL_SCRIPT_ID],
  });
  return scripts.length > 0;
}

export async function registerUniversalScript(tabId?: number): Promise<void> {
  const hasFilePermission = await browser.permissions.contains({
    origins: [UNIVERSAL_FILE_ORIGIN],
  }).catch(() => false);
  const matches = [
    ...UNIVERSAL_HOST_ORIGINS,
    ...(hasFilePermission ? [UNIVERSAL_FILE_ORIGIN] : []),
  ];
  if (isFirefoxBuild()) {
    if (!firefoxRegisteredScript) {
      firefoxRegisteredScript = await firefoxContentScripts.register({
        matches,
        js: [{ file: UNIVERSAL_SCRIPT_PUBLIC_PATH }],
        runAt: 'document_start',
        allFrames: true,
        matchAboutBlank: true,
      });
    }
    if (tabId !== undefined) {
      await browser.tabs.executeScript(tabId, {
        file: UNIVERSAL_SCRIPT_PUBLIC_PATH,
        allFrames: true,
        runAt: 'document_start',
        matchAboutBlank: true,
      }).catch(() => undefined);
    }
    return;
  }

  const definition: Browser.scripting.RegisteredContentScript = {
    id: UNIVERSAL_SCRIPT_ID,
    matches,
    js: [UNIVERSAL_SCRIPT_FILE],
    runAt: 'document_start',
    allFrames: true,
    matchOriginAsFallback: true,
    persistAcrossSessions: true,
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
      files: [UNIVERSAL_SCRIPT_PUBLIC_PATH],
      injectImmediately: true,
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
  if (isFirefoxBuild()) {
    await firefoxRegisteredScript?.unregister();
    firefoxRegisteredScript = null;
    return;
  }
  await browser.scripting.unregisterContentScripts({ ids: [UNIVERSAL_SCRIPT_ID] });
}
