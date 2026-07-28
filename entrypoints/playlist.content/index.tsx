import { render } from 'preact';
import styleText from './style.css?inline';
import { ContentController } from '../../lib/content-controller';
import { findPanelAnchor, getPlaylistId } from '../../lib/youtube-dom';
import { getSettings } from '../../lib/storage';
import { Panel } from './Panel';

function resolvedTheme(theme: 'auto' | 'light' | 'dark'): 'light' | 'dark' {
  if (theme !== 'auto') return theme;
  return document.documentElement.hasAttribute('dark') ||
    document.documentElement.classList.contains('dark')
    ? 'dark'
    : 'light';
}

function waitForAnchor(signal: AbortSignal): Promise<HTMLElement | null> {
  const existing = findPanelAnchor();
  if (existing) return Promise.resolve(existing);

  return new Promise((resolve) => {
    const root = document.querySelector('ytd-app') ?? document.documentElement;
    const observer = new MutationObserver(() => {
      const anchor = findPanelAnchor();
      if (!anchor) return;
      observer.disconnect();
      window.clearTimeout(timeout);
      resolve(anchor);
    });
    const timeout = window.setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, 10_000);
    signal.addEventListener(
      'abort',
      () => {
        observer.disconnect();
        window.clearTimeout(timeout);
        resolve(null);
      },
      { once: true },
    );
    observer.observe(root, { childList: true, subtree: true });
  });
}

export default defineContentScript({
  matches: ['https://www.youtube.com/*'],
  runAt: 'document_idle',
  async main() {
    const controller = await ContentController.create();
    let host: HTMLElement | null = null;
    let mountAbort = new AbortController();
    let navigationToken = 0;
    let navigationTimer: number | null = null;
    let lastRouteKey = '';

    const themeObserver = new MutationObserver(() => {
      if (host) host.dataset.theme = resolvedTheme(controller.snapshot().settings.theme);
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['dark', 'class'],
    });

    const removeHost = () => {
      if (!host) return;
      render(null, host.shadowRoot?.querySelector('.mount') ?? host);
      host.remove();
      host = null;
    };

    const mountPanel = async (token: number) => {
      mountAbort.abort();
      mountAbort = new AbortController();
      removeHost();
      if (!getPlaylistId()) return;
      const anchor = await waitForAnchor(mountAbort.signal);
      if (!anchor || token !== navigationToken) return;

      host = document.createElement('playlist-zamani-root');
      host.id = 'playlist-zamani-root';
      host.dataset.theme = resolvedTheme(controller.snapshot().settings.theme);
      const shadow = host.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = styleText;
      const mount = document.createElement('div');
      mount.className = 'mount';
      shadow.append(style, mount);
      anchor.append(host);
      render(<Panel controller={controller} />, mount);
    };

    const navigate = async () => {
      navigationTimer = null;
      const url = new URL(location.href);
      const routeKey = [
        url.pathname,
        url.searchParams.get('list') ?? '',
        url.searchParams.get('v') ?? '',
        url.searchParams.get('index') ?? '',
      ].join(':');
      if (routeKey === lastRouteKey) {
        await controller.refreshDom();
        if (!host && getPlaylistId()) await mountPanel(navigationToken);
        return;
      }
      lastRouteKey = routeKey;
      const token = ++navigationToken;
      await controller.navigate();
      if (token !== navigationToken) return;
      await mountPanel(token);
    };

    const scheduleNavigation = () => {
      if (navigationTimer !== null) window.clearTimeout(navigationTimer);
      navigationTimer = window.setTimeout(() => void navigate(), 50);
    };

    document.addEventListener('yt-navigate-finish', scheduleNavigation, { passive: true });
    document.addEventListener('yt-page-data-updated', scheduleNavigation, { passive: true });
    window.addEventListener('popstate', scheduleNavigation, { passive: true });

    const handleStorageChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) => {
      if (areaName !== 'sync' || !changes.settings) return;
      void getSettings().then((settings) => {
        void controller.updateSettings(settings);
        if (host) host.dataset.theme = resolvedTheme(settings.theme);
      });
    };
    chrome.storage.onChanged.addListener(handleStorageChange);

    void navigate();

    window.addEventListener(
      'pagehide',
      () => {
        mountAbort.abort();
        if (navigationTimer !== null) window.clearTimeout(navigationTimer);
        themeObserver.disconnect();
        document.removeEventListener('yt-navigate-finish', scheduleNavigation);
        document.removeEventListener('yt-page-data-updated', scheduleNavigation);
        window.removeEventListener('popstate', scheduleNavigation);
        chrome.storage.onChanged.removeListener(handleStorageChange);
        controller.dispose();
        removeHost();
      },
      { once: true },
    );
  },
});
