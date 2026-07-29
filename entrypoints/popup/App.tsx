import { useEffect, useState } from 'preact/hooks';
import {
  DEFAULT_SETTINGS,
  DEFAULT_SHORTCUTS,
  DEFAULT_UNIVERSAL_SETTINGS,
  MAX_SPEED,
  MIN_SPEED,
  UNIVERSAL_HOST_ORIGINS,
  UNIVERSAL_MAX_SPEED,
  UNIVERSAL_MIN_SPEED,
} from '../../lib/constants';
import { formatDuration } from '../../lib/duration';
import {
  LOCALE_OPTIONS,
  localeDirection,
  localeTag,
  resolveLocale,
  t,
} from '../../lib/i18n';
import {
  clearAllProgress,
  exportUniversalConfiguration,
  exportProgress,
  getApiKey,
  getPlaylistHistory,
  getSettings,
  getSiteMediaState,
  getSitePatternRules,
  getUniversalSettings,
  importProgress,
  importUniversalConfiguration,
  forgetSitePlaybackSpeed,
  saveApiKey,
  saveSettings,
  saveSiteMediaRule,
  saveSitePatternRules,
  saveUniversalSettings,
} from '../../lib/storage';
import type {
  CustomShortcutAction,
  CustomShortcutBinding,
  ExtensionSettings,
  MediaDownloadInfo,
  PlaylistHistoryEntry,
  ShortcutAction,
  ShortcutBinding,
  SitePatternRule,
  UniversalControllerSettings,
  UniversalSiteInfo,
} from '../../lib/types';
import {
  SHORTCUT_ACTIONS,
  shortcutLabel,
} from '../../lib/universal';
import { ut } from '../../lib/universal-i18n';

function resumeUrl(entry: PlaylistHistoryEntry): string {
  const url = new URL(
    entry.lastVideoId
      ? `https://www.youtube.com/watch?v=${encodeURIComponent(entry.lastVideoId)}`
      : 'https://www.youtube.com/playlist',
  );
  url.searchParams.set('list', entry.playlistId);
  if (entry.lastVideoIndex) url.searchParams.set('index', String(entry.lastVideoIndex));
  return url.toString();
}

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

async function inspectCurrentSite(): Promise<{
  tabId?: number;
  info?: UniversalSiteInfo;
}> {
  const tab = await activeTab();
  if (tab?.id === undefined) return {};
  try {
    const response = await chrome.tabs.sendMessage(
      tab.id,
      { type: 'universal:site-info' },
    ) as UniversalSiteInfo | undefined;
    if (response?.hostname) return { tabId: tab.id, info: response };
  } catch {
    // The script may not be injected in this tab yet.
  }
  try {
    const url = new URL(tab.url ?? '');
    if (!['http:', 'https:'].includes(url.protocol)) return { tabId: tab.id };
    const state = await getSiteMediaState(url.hostname);
    return {
      tabId: tab.id,
      info: {
        hostname: url.hostname,
        enabled: state.rule?.enabled !== false,
        speed: state.playbackSpeed,
        rule: state.rule,
      },
    };
  } catch {
    return { tabId: tab.id };
  }
}

function shortcutFromEvent(event: KeyboardEvent): ShortcutBinding | null {
  if (['Escape', 'Tab'].includes(event.code)) return null;
  return {
    code: event.code,
    alt: event.altKey,
    ctrl: event.ctrlKey,
    meta: event.metaKey,
    shift: event.shiftKey,
  };
}

export function App() {
  const [settings, setSettings] = useState<ExtensionSettings>(DEFAULT_SETTINGS);
  const [universal, setUniversal] = useState<UniversalControllerSettings>(
    DEFAULT_UNIVERSAL_SETTINGS,
  );
  const [hasUniversalPermission, setHasUniversalPermission] = useState(false);
  const [activeTabId, setActiveTabId] = useState<number | undefined>();
  const [siteHostname, setSiteHostname] = useState('');
  const [currentSiteSpeed, setCurrentSiteSpeed] = useState<number | null>(null);
  const [siteDisabled, setSiteDisabled] = useState(false);
  const [siteDefaultSpeed, setSiteDefaultSpeed] = useState('');
  const [siteFightback, setSiteFightback] = useState(false);
  const [sitePatternRules, setSitePatternRules] = useState<SitePatternRule[]>([]);
  const [apiKey, setApiKey] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState('');
  const [history, setHistory] = useState<PlaylistHistoryEntry[]>([]);
  const locale = resolveLocale(settings.locale, navigator.language, navigator.languages);

  useEffect(() => {
    Promise.all([
      getSettings(),
      getUniversalSettings(),
      getApiKey(),
      getPlaylistHistory(),
      getSitePatternRules(),
      chrome.permissions.contains({ origins: [...UNIVERSAL_HOST_ORIGINS] }),
      inspectCurrentSite(),
    ]).then(
      ([nextSettings, nextUniversal, key, nextHistory, patternRules, hasPermission, site]) => {
        setSettings(nextSettings);
        setUniversal(nextUniversal);
        setApiKey(key);
        setHistory(nextHistory);
        setSitePatternRules(patternRules);
        setHasUniversalPermission(hasPermission);
        setActiveTabId(site.tabId);
        if (site.info) {
          setSiteHostname(site.info.hostname);
          setCurrentSiteSpeed(site.info.speed);
          setSiteDisabled(site.info.rule?.enabled === false);
          setSiteDefaultSpeed(
            site.info.rule?.defaultSpeed === undefined
              ? ''
              : String(site.info.rule.defaultSpeed),
          );
          setSiteFightback(
            site.info.rule?.fightback ?? nextUniversal.fightbackDefault,
          );
        }
        setLoaded(true);
      },
    );

    const handleStorageChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) => {
      if (areaName === 'local' && changes.playlistHistory) {
        void getPlaylistHistory().then(setHistory);
      }
    };
    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => chrome.storage.onChanged.removeListener(handleStorageChange);
  }, []);

  useEffect(() => {
    document.documentElement.lang = localeTag(locale);
    document.documentElement.dir = localeDirection(locale);
  }, [locale]);

  const update = <K extends keyof ExtensionSettings>(
    key: K,
    value: ExtensionSettings[K],
  ) => setSettings((current) => ({ ...current, [key]: value }));

  const updateUniversal = <K extends keyof UniversalControllerSettings>(
    key: K,
    value: UniversalControllerSettings[K],
  ) => setUniversal((current) => ({ ...current, [key]: value }));

  const applyInspectedSite = (site: Awaited<ReturnType<typeof inspectCurrentSite>>) => {
    setActiveTabId(site.tabId);
    if (!site.info) {
      setSiteHostname('');
      setCurrentSiteSpeed(null);
      return;
    }
    setSiteHostname(site.info.hostname);
    setCurrentSiteSpeed(site.info.speed);
    setSiteDisabled(site.info.rule?.enabled === false);
    setSiteDefaultSpeed(
      site.info.rule?.defaultSpeed === undefined
        ? ''
        : String(site.info.rule.defaultSpeed),
    );
    setSiteFightback(site.info.rule?.fightback ?? universal.fightbackDefault);
  };

  const toggleUniversal = async (enabled: boolean) => {
    setStatus('');
    if (enabled) {
      const next = { ...universal, enabled: true };
      await saveUniversalSettings(next);
      const granted = await chrome.permissions.request({
        origins: [...UNIVERSAL_HOST_ORIGINS],
      });
      if (!granted) {
        await saveUniversalSettings({ ...universal, enabled: false });
        setHasUniversalPermission(false);
        setStatus(ut(locale, 'permissionDenied'));
        return;
      }
      const tab = activeTabId === undefined ? await activeTab() : undefined;
      const tabId = activeTabId ?? tab?.id;
      let registered = false;
      try {
        const response = await chrome.runtime.sendMessage({
          type: 'universal:register',
          ...(tabId === undefined ? {} : { tabId }),
        }) as { ok: boolean };
        registered = response.ok;
      } catch {
        registered = false;
      }
      if (!registered) {
        await saveUniversalSettings({ ...universal, enabled: false });
        await chrome.permissions.remove({ origins: [...UNIVERSAL_HOST_ORIGINS] });
        setHasUniversalPermission(false);
        setStatus(ut(locale, 'permissionDenied'));
        return;
      }
      setUniversal(next);
      setHasUniversalPermission(true);
      applyInspectedSite(await inspectCurrentSite());
      setStatus(ut(locale, 'enabled'));
      return;
    }

    const next = { ...universal, enabled: false };
    await saveUniversalSettings(next);
    try {
      await chrome.runtime.sendMessage({ type: 'universal:unregister' });
    } finally {
      await chrome.permissions.remove({ origins: [...UNIVERSAL_HOST_ORIGINS] });
    }
    setUniversal(next);
    setHasUniversalPermission(false);
    setStatus(ut(locale, 'disabled'));
  };

  const updateShortcut = (action: ShortcutAction, binding: ShortcutBinding) => {
    setUniversal((current) => ({
      ...current,
      shortcuts: {
        ...current.shortcuts,
        [action]: binding,
      },
    }));
  };

  const sendUniversalCommand = async (message: {
    type: 'universal:set-speed' | 'universal:adjust-speed' | 'universal:toggle-playback';
    speed?: number;
    delta?: number;
  }) => {
    if (activeTabId === undefined) return;
    try {
      const info = await chrome.tabs.sendMessage(activeTabId, message) as UniversalSiteInfo;
      if (Number.isFinite(info?.speed)) {
        setCurrentSiteSpeed(info.speed);
        setStatus('');
      }
    } catch {
      setStatus(ut(locale, 'siteUnavailable'));
    }
  };

  const downloadCurrentMedia = async () => {
    if (activeTabId === undefined) {
      setStatus(ut(locale, 'noMedia'));
      return;
    }
    let info: MediaDownloadInfo;
    try {
      info = await chrome.tabs.sendMessage(
        activeTabId,
        { type: 'universal:download-info' },
      ) as MediaDownloadInfo;
    } catch {
      setStatus(ut(locale, 'noMedia'));
      return;
    }
    if (!info.available || !info.url) {
      setStatus(ut(locale, info.reason ?? 'unsupportedMedia'));
      return;
    }
    const granted = await chrome.permissions.request({
      permissions: ['downloads'],
    });
    if (!granted) {
      setStatus(ut(locale, 'downloadPermissionDenied'));
      return;
    }
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'universal:download',
        url: info.url,
        ...(info.filename ? { filename: info.filename } : {}),
      }) as { ok: boolean };
      setStatus(
        response.ok
          ? ut(locale, 'downloadStarted')
          : ut(locale, 'unsupportedMedia'),
      );
    } catch {
      setStatus(ut(locale, 'unsupportedMedia'));
    }
  };

  const updateCustomShortcut = (
    id: string,
    patch: Partial<CustomShortcutBinding>,
  ) => {
    updateUniversal(
      'customShortcuts',
      universal.customShortcuts.map((binding) =>
        binding.id === id ? { ...binding, ...patch } : binding,
      ),
    );
  };

  const addCustomShortcut = () => {
    const id = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    updateUniversal('customShortcuts', [
      ...universal.customShortcuts,
      {
        id,
        action: 'pause',
        enabled: true,
        code: 'KeyP',
        alt: false,
        ctrl: false,
        meta: false,
        shift: false,
        value: 0.1,
      },
    ]);
  };

  const save = async () => {
    setStatus('');
    if (apiKey.trim()) {
      const granted = await chrome.permissions.request({
        origins: ['https://www.googleapis.com/*'],
      });
      if (!granted) {
        setStatus(t(locale, 'apiPermissionDenied'));
      }
    }
    const defaultSiteSpeed = siteDefaultSpeed.trim() === ''
      ? undefined
      : Number(siteDefaultSpeed);
    await Promise.all([
      saveSettings(settings),
      saveUniversalSettings(universal),
      saveApiKey(apiKey),
      saveSitePatternRules(sitePatternRules),
      ...(siteHostname
        ? [saveSiteMediaRule(siteHostname, {
            enabled: !siteDisabled,
            ...(Number.isFinite(defaultSiteSpeed)
              ? { defaultSpeed: defaultSiteSpeed }
              : {}),
            fightback: siteFightback,
          })]
        : []),
    ]);
    setStatus((current) => current || t(locale, 'settingsSaved'));
  };

  const downloadProgress = async () => {
    const content = await exportProgress();
    const blobUrl = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = `playlist-zamani-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1_000);
  };

  const uploadProgress = async (file: File | undefined) => {
    if (!file) return;
    try {
      const count = await importProgress(await file.text());
      setStatus(t(locale, 'progressImported', { count }));
    } catch {
      setStatus(t(locale, 'invalidProgress'));
    }
  };

  const downloadUniversalSettings = async () => {
    const content = await exportUniversalConfiguration();
    const blobUrl = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = `playlist-zamani-controller-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1_000);
  };

  const uploadUniversalSettings = async (file: File | undefined) => {
    if (!file) return;
    try {
      await importUniversalConfiguration(await file.text());
      const [nextUniversal, nextRules] = await Promise.all([
        getUniversalSettings(),
        getSitePatternRules(),
      ]);
      setUniversal(nextUniversal);
      setSitePatternRules(nextRules);
      setStatus(ut(locale, 'settingsImported'));
    } catch {
      setStatus(ut(locale, 'invalidSettings'));
    }
  };

  const resetUniversalController = async () => {
    const next = {
      ...structuredClone(DEFAULT_UNIVERSAL_SETTINGS),
      enabled: universal.enabled,
    };
    await Promise.all([
      saveUniversalSettings(next),
      saveSitePatternRules([]),
    ]);
    setUniversal(next);
    setSitePatternRules([]);
    setStatus(ut(locale, 'controllerReset'));
  };

  if (!loaded) return <main class="loading">{t(locale, 'loading')}</main>;

  return (
    <main dir={localeDirection(locale)} lang={localeTag(locale)}>
      <header>
        <span class="logo">◷</span>
        <div>
          <h1>Playlist Zamanı</h1>
          <p>{t(locale, 'popupTagline')}</p>
        </div>
      </header>

      <section class="universal" aria-labelledby="universal-title">
        <div class="section-heading">
          <div>
            <h2 id="universal-title">{ut(locale, 'title')}</h2>
            <p class="hint">{ut(locale, 'description')}</p>
          </div>
          <span class={`permission-dot ${hasUniversalPermission ? 'active' : ''}`} />
        </div>
        <label class="check universal-toggle">
          <input
            type="checkbox"
            checked={universal.enabled && hasUniversalPermission}
            onChange={(event) => void toggleUniversal(event.currentTarget.checked)}
          />
          <span>{ut(locale, 'enable')}</span>
        </label>

        {universal.enabled && hasUniversalPermission && (
          <>
            <div class="quick-controls" aria-label={ut(locale, 'quickControls')}>
              <button
                type="button"
                class="quick-adjust"
                title={ut(locale, 'slower')}
                onClick={() => void sendUniversalCommand({
                  type: 'universal:adjust-speed',
                  delta: -universal.speedStep,
                })}
              >
                −
              </button>
              <div class="speed-readout" aria-live="polite">
                <strong>
                  {Number((currentSiteSpeed ?? settings.defaultSpeed).toFixed(2))}×
                </strong>
                <span title={siteHostname}>{siteHostname || ut(locale, 'siteUnavailable')}</span>
              </div>
              <button
                type="button"
                class="quick-adjust"
                title={ut(locale, 'faster')}
                onClick={() => void sendUniversalCommand({
                  type: 'universal:adjust-speed',
                  delta: universal.speedStep,
                })}
              >
                +
              </button>
            </div>
            <div class="speed-presets">
              {[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5].map((speed) => (
                <button
                  type="button"
                  key={speed}
                  class={
                    currentSiteSpeed !== null
                    && Math.abs(currentSiteSpeed - speed) < 0.005
                      ? 'active'
                      : ''
                  }
                  onClick={() => void sendUniversalCommand({
                    type: 'universal:set-speed',
                    speed,
                  })}
                >
                  {speed}×
                </button>
              ))}
            </div>
            <div class="media-actions">
              <button
                type="button"
                class="quick-play"
                onClick={() => void sendUniversalCommand({ type: 'universal:toggle-playback' })}
              >
                ▶Ⅱ <span>{ut(locale, 'playPause')}</span>
              </button>
              <button
                type="button"
                class="download-media"
                onClick={() => void downloadCurrentMedia()}
              >
                ↓ {ut(locale, 'downloadMedia')}
              </button>
            </div>
            <div class="grid three">
              <label>
                <span>{ut(locale, 'speedStep')}</span>
                <input
                  type="number"
                  min="0.01"
                  max="2"
                  step="0.05"
                  value={universal.speedStep}
                  onInput={(event) =>
                    updateUniversal('speedStep', Number(event.currentTarget.value))
                  }
                />
              </label>
              <label>
                <span>{ut(locale, 'rewindSeconds')}</span>
                <input
                  type="number"
                  min="1"
                  max="600"
                  value={universal.rewindSeconds}
                  onInput={(event) =>
                    updateUniversal('rewindSeconds', Number(event.currentTarget.value))
                  }
                />
              </label>
              <label>
                <span>{ut(locale, 'advanceSeconds')}</span>
                <input
                  type="number"
                  min="1"
                  max="600"
                  value={universal.advanceSeconds}
                  onInput={(event) =>
                    updateUniversal('advanceSeconds', Number(event.currentTarget.value))
                  }
                />
              </label>
            </div>

            <details class="shortcut-settings">
              <summary>{ut(locale, 'advanced')}</summary>
              <div class="advanced-settings">
                <label class="check">
                  <input
                    type="checkbox"
                    checked={universal.audioEnabled}
                    onChange={(event) =>
                      updateUniversal('audioEnabled', event.currentTarget.checked)
                    }
                  />
                  <span>{ut(locale, 'audioSupport')}</span>
                </label>
                <label class="check">
                  <input
                    type="checkbox"
                    checked={universal.exclusiveKeys}
                    onChange={(event) =>
                      updateUniversal('exclusiveKeys', event.currentTarget.checked)
                    }
                  />
                  <span>{ut(locale, 'exclusiveKeys')}</span>
                </label>
                <label class="check">
                  <input
                    type="checkbox"
                    checked={universal.wheelEnabled}
                    onChange={(event) =>
                      updateUniversal('wheelEnabled', event.currentTarget.checked)
                    }
                  />
                  <span>{ut(locale, 'wheelControl')}</span>
                </label>
                <div class="grid two">
                  <label>
                    <span>{ut(locale, 'controllerOpacity')}</span>
                    <input
                      type="range"
                      min="0.1"
                      max="1"
                      step="0.05"
                      value={universal.controllerOpacity}
                      onInput={(event) =>
                        updateUniversal('controllerOpacity', Number(event.currentTarget.value))
                      }
                    />
                  </label>
                  <label>
                    <span>{ut(locale, 'controllerSize')}</span>
                    <input
                      type="number"
                      min="10"
                      max="28"
                      value={universal.controllerSize}
                      onInput={(event) =>
                        updateUniversal('controllerSize', Number(event.currentTarget.value))
                      }
                    />
                  </label>
                </div>
                <label>
                  <span>{ut(locale, 'customCss')}</span>
                  <textarea
                    rows={3}
                    maxlength={8000}
                    value={universal.customCss}
                    placeholder=".controller { border-color: #ff0033; }"
                    onInput={(event) =>
                      updateUniversal('customCss', event.currentTarget.value)
                    }
                  />
                  <small class="hint">{ut(locale, 'customCssHint')}</small>
                </label>
              </div>
            </details>

            <details class="shortcut-settings">
              <summary>{ut(locale, 'siteRules')}</summary>
              <div class="site-rule-list">
                {sitePatternRules.map((rule) => (
                  <div class="site-rule-row" key={rule.id}>
                    <input
                      aria-label={ut(locale, 'patternHint')}
                      placeholder={ut(locale, 'patternHint')}
                      value={rule.pattern}
                      onInput={(event) =>
                        setSitePatternRules((current) => current.map((item) =>
                          item.id === rule.id
                            ? { ...item, pattern: event.currentTarget.value }
                            : item,
                        ))
                      }
                    />
                    <input
                      type="number"
                      min={UNIVERSAL_MIN_SPEED}
                      max={UNIVERSAL_MAX_SPEED}
                      step="0.05"
                      placeholder="—"
                      aria-label={ut(locale, 'siteDefaultSpeed')}
                      value={rule.defaultSpeed ?? ''}
                      onInput={(event) => {
                        const value = Number(event.currentTarget.value);
                        setSitePatternRules((current) => current.map((item) =>
                          item.id === rule.id
                            ? {
                                ...item,
                                ...(Number.isFinite(value) && event.currentTarget.value !== ''
                                  ? { defaultSpeed: value }
                                  : { defaultSpeed: undefined }),
                              }
                            : item,
                        ));
                      }}
                    />
                    <input
                      type="checkbox"
                      checked={rule.enabled}
                      title={ut(locale, 'enabledRule')}
                      aria-label={ut(locale, 'enabledRule')}
                      onChange={(event) =>
                        setSitePatternRules((current) => current.map((item) =>
                          item.id === rule.id
                            ? { ...item, enabled: event.currentTarget.checked }
                            : item,
                        ))
                      }
                    />
                    <button
                      type="button"
                      class="icon-button"
                      title={ut(locale, 'deleteRule')}
                      aria-label={ut(locale, 'deleteRule')}
                      onClick={() =>
                        setSitePatternRules((current) =>
                          current.filter((item) => item.id !== rule.id),
                        )
                      }
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                class="secondary compact"
                onClick={() =>
                  setSitePatternRules((current) => [
                    ...current,
                    {
                      id: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
                      pattern: '',
                      enabled: true,
                      updatedAt: Date.now(),
                    },
                  ])
                }
              >
                + {ut(locale, 'addSiteRule')}
              </button>
            </details>

            <div class="actions">
              <button
                type="button"
                class="secondary compact"
                onClick={() => void downloadUniversalSettings()}
              >
                {ut(locale, 'exportSettings')}
              </button>
              <label class="file-button secondary compact">
                {ut(locale, 'importSettings')}
                <input
                  type="file"
                  accept="application/json,.json"
                  onChange={(event) =>
                    void uploadUniversalSettings(event.currentTarget.files?.[0])
                  }
                />
              </label>
              <button
                type="button"
                class="secondary compact danger"
                onClick={() => void resetUniversalController()}
              >
                {ut(locale, 'resetController')}
              </button>
            </div>
            <div class="grid two">
              <label>
                <span>{ut(locale, 'indicator')}</span>
                <select
                  value={universal.indicatorMode}
                  onChange={(event) =>
                    updateUniversal(
                      'indicatorMode',
                      event.currentTarget.value as UniversalControllerSettings['indicatorMode'],
                    )
                  }
                >
                  <option value="flash">{ut(locale, 'flash')}</option>
                  <option value="always">{ut(locale, 'always')}</option>
                  <option value="hidden">{ut(locale, 'hidden')}</option>
                </select>
              </label>
              <label class="check inline-check">
                <input
                  type="checkbox"
                  checked={universal.rememberPerSite}
                  onChange={(event) =>
                    updateUniversal('rememberPerSite', event.currentTarget.checked)
                  }
                />
                <span>{ut(locale, 'rememberSiteSpeed')}</span>
              </label>
            </div>

            <div class="site-settings">
              <h3>{ut(locale, 'currentSite')}</h3>
              {siteHostname ? (
                <>
                  <strong class="hostname">{siteHostname}</strong>
                  <label class="check">
                    <input
                      type="checkbox"
                      checked={siteDisabled}
                      onChange={(event) => setSiteDisabled(event.currentTarget.checked)}
                    />
                    <span>{ut(locale, 'disableOnSite')}</span>
                  </label>
                  <div class="grid two">
                    <label>
                      <span>{ut(locale, 'siteDefaultSpeed')}</span>
                      <input
                        type="number"
                        min={UNIVERSAL_MIN_SPEED}
                        max={UNIVERSAL_MAX_SPEED}
                        step="0.05"
                        placeholder="—"
                        value={siteDefaultSpeed}
                        onInput={(event) => setSiteDefaultSpeed(event.currentTarget.value)}
                      />
                    </label>
                    <label class="check inline-check">
                      <input
                        type="checkbox"
                        checked={siteFightback}
                        onChange={(event) => setSiteFightback(event.currentTarget.checked)}
                      />
                      <span>{ut(locale, 'lockSpeed')}</span>
                    </label>
                  </div>
                  <button
                    type="button"
                    class="secondary compact"
                    onClick={() => {
                      void forgetSitePlaybackSpeed(siteHostname).then(() => {
                        setStatus(ut(locale, 'speedForgotten'));
                      });
                    }}
                  >
                    {ut(locale, 'forgetSiteSpeed')}
                  </button>
                </>
              ) : (
                <p class="hint">{ut(locale, 'siteUnavailable')}</p>
              )}
            </div>

            <details class="shortcut-settings">
              <summary>{ut(locale, 'shortcuts')}</summary>
              <div class="shortcut-list">
                {SHORTCUT_ACTIONS.map((action) => (
                  <label class="shortcut-row" key={action}>
                    <span>{ut(locale, action)}</span>
                    <input
                      class="shortcut-input"
                      value={shortcutLabel(universal.shortcuts[action])}
                      title={ut(locale, 'pressShortcut')}
                      readonly
                      onKeyDown={(event) => {
                        const binding = shortcutFromEvent(event);
                        if (!binding) return;
                        event.preventDefault();
                        updateShortcut(action, binding);
                        event.currentTarget.blur();
                      }}
                    />
                  </label>
                ))}
              </div>
              <button
                type="button"
                class="secondary compact"
                onClick={() =>
                  updateUniversal(
                    'shortcuts',
                    Object.fromEntries(
                      Object.entries(DEFAULT_SHORTCUTS).map(([action, binding]) => [
                        action,
                        { ...binding },
                      ]),
                    ) as UniversalControllerSettings['shortcuts'],
                  )
                }
              >
                {ut(locale, 'resetShortcuts')}
              </button>
              <div class="custom-shortcut-heading">
                <strong>{ut(locale, 'customShortcuts')}</strong>
                <button
                  type="button"
                  class="secondary compact"
                  onClick={addCustomShortcut}
                >
                  + {ut(locale, 'addShortcut')}
                </button>
              </div>
              <div class="custom-shortcuts">
                {universal.customShortcuts.map((binding) => (
                  <div class="custom-shortcut" key={binding.id}>
                    <select
                      aria-label={ut(locale, 'action')}
                      value={binding.action}
                      onChange={(event) =>
                        updateCustomShortcut(binding.id, {
                          action: event.currentTarget.value as CustomShortcutAction,
                        })
                      }
                    >
                      {([
                        'slower',
                        'faster',
                        'reset',
                        'preferred',
                        'rewind',
                        'advance',
                        'pause',
                        'toggleMute',
                        'volumeDown',
                        'volumeUp',
                        'mark',
                        'jump',
                        'theater',
                        'toggleIndicator',
                      ] as const).map((action) => (
                        <option value={action} key={action}>{ut(locale, action)}</option>
                      ))}
                    </select>
                    <input
                      class="shortcut-input"
                      value={shortcutLabel(binding)}
                      title={ut(locale, 'pressShortcut')}
                      readonly
                      onKeyDown={(event) => {
                        const next = shortcutFromEvent(event);
                        if (!next) return;
                        event.preventDefault();
                        updateCustomShortcut(binding.id, next);
                        event.currentTarget.blur();
                      }}
                    />
                    <input
                      type="number"
                      min="0.01"
                      max="600"
                      step="0.05"
                      aria-label={ut(locale, 'value')}
                      value={binding.value ?? 0.1}
                      onInput={(event) =>
                        updateCustomShortcut(binding.id, {
                          value: Number(event.currentTarget.value),
                        })
                      }
                    />
                    <button
                      type="button"
                      class="icon-button"
                      title={ut(locale, 'removeShortcut')}
                      aria-label={ut(locale, 'removeShortcut')}
                      onClick={() =>
                        updateUniversal(
                          'customShortcuts',
                          universal.customShortcuts.filter((item) => item.id !== binding.id),
                        )
                      }
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </details>
          </>
        )}
      </section>

      <section class="playlists" aria-labelledby="my-playlists-title">
        <h2 id="my-playlists-title">{t(locale, 'myPlaylists')}</h2>
        {history.length === 0 ? (
          <p class="empty">{t(locale, 'noRecentPlaylists')}</p>
        ) : (
          <div class="playlist-list">
            {history.map((entry) => {
              const percent = Math.round(entry.progressPercent);
              return (
                <article class="playlist-item" key={entry.playlistId}>
                  <div class="playlist-heading">
                    <div class="playlist-copy">
                      <strong title={entry.title}>{entry.title}</strong>
                      <span>
                        {entry.videoCount} {t(locale, 'videos')} · {percent}%
                      </span>
                    </div>
                    <a
                      class="continue"
                      href={resumeUrl(entry)}
                      target="_blank"
                      rel="noreferrer"
                      title={t(locale, 'continueWatching')}
                      aria-label={`${entry.title}: ${t(locale, 'continueWatching')}`}
                    >
                      ▶
                    </a>
                  </div>
                  <div
                    class="playlist-progress"
                    role="progressbar"
                    aria-label={t(locale, 'progress')}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={percent}
                  >
                    <span style={{ width: `${percent}%` }} />
                  </div>
                  <div class="playlist-meta">
                    <span>{t(locale, 'remaining')}</span>
                    <b>{formatDuration(entry.remainingSeconds, locale, settings.showSeconds)}</b>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <h2>{t(locale, 'appearanceCalculation')}</h2>
        <div class="grid two">
          <label>
            <span>{t(locale, 'language')}</span>
            <select
              value={settings.locale}
              onChange={(event) =>
                update('locale', event.currentTarget.value as ExtensionSettings['locale'])
              }
            >
              <option value="auto">{t(locale, 'automatic')}</option>
              {LOCALE_OPTIONS.map((option) => (
                <option value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label>
            <span>{t(locale, 'theme')}</span>
            <select
              value={settings.theme}
              onChange={(event) =>
                update('theme', event.currentTarget.value as ExtensionSettings['theme'])
              }
            >
              <option value="auto">{t(locale, 'followYouTube')}</option>
              <option value="light">{t(locale, 'light')}</option>
              <option value="dark">{t(locale, 'dark')}</option>
            </select>
          </label>
          <label>
            <span>{t(locale, 'defaultSpeed')}</span>
            <input
              type="number"
              min={MIN_SPEED}
              max={MAX_SPEED}
              step="0.05"
              value={settings.defaultSpeed}
              onInput={(event) => update('defaultSpeed', Number(event.currentTarget.value))}
            />
          </label>
          <label>
            <span>{t(locale, 'customSpeed')}</span>
            <input
              type="number"
              min={MIN_SPEED}
              max={MAX_SPEED}
              step="0.05"
              value={settings.customSpeed}
              onInput={(event) => update('customSpeed', Number(event.currentTarget.value))}
            />
          </label>
        </div>
        <label class="check">
          <input
            type="checkbox"
            checked={settings.showSeconds}
            onChange={(event) => update('showSeconds', event.currentTarget.checked)}
          />
          <span>{t(locale, 'showSeconds')}</span>
        </label>
        <label>
          <span>
            {t(locale, 'completionThreshold', {
              percent: Math.round(settings.completionThreshold * 100),
            })}
          </span>
          <input
            type="range"
            min="0.5"
            max="1"
            step="0.05"
            value={settings.completionThreshold}
            onInput={(event) =>
              update('completionThreshold', Number(event.currentTarget.value))
            }
          />
        </label>
      </section>

      <section>
        <h2>{t(locale, 'apiForLargePlaylists')}</h2>
        <p class="hint">{t(locale, 'apiHint')}</p>
        <label>
          <span>{t(locale, 'apiKey')}</span>
          <input
            type="password"
            autocomplete="off"
            placeholder="AIza…"
            value={apiKey}
            onInput={(event) => setApiKey(event.currentTarget.value)}
          />
        </label>
      </section>

      <section>
        <h2>{t(locale, 'progressData')}</h2>
        <div class="actions">
          <button type="button" class="secondary" onClick={() => void downloadProgress()}>
            {t(locale, 'export')}
          </button>
          <label class="file-button">
            {t(locale, 'import')}
            <input
              type="file"
              accept="application/json,.json"
              onChange={(event) => void uploadProgress(event.currentTarget.files?.[0])}
            />
          </label>
          <button
            type="button"
            class="danger"
            onClick={() => {
              if (!window.confirm(t(locale, 'confirmDelete'))) return;
              void clearAllProgress().then(() => {
                setHistory([]);
                setStatus(t(locale, 'progressDeleted'));
              });
            }}
          >
            {t(locale, 'deleteProgress')}
          </button>
        </div>
      </section>

      {status && <div class="status" role="status">{status}</div>}
      <button type="button" class="save" onClick={() => void save()}>
        {t(locale, 'saveSettings')}
      </button>
      <footer>
        v{chrome.runtime.getManifest().version} · {t(locale, 'noTelemetry')}
      </footer>
    </main>
  );
}
