import { useEffect, useState } from 'preact/hooks';
import { DEFAULT_SETTINGS, MAX_SPEED, MIN_SPEED } from '../../lib/constants';
import {
  LOCALE_OPTIONS,
  localeDirection,
  localeTag,
  resolveLocale,
  t,
} from '../../lib/i18n';
import {
  clearAllProgress,
  exportProgress,
  getApiKey,
  getSettings,
  importProgress,
  saveApiKey,
  saveSettings,
} from '../../lib/storage';
import type { ExtensionSettings } from '../../lib/types';

export function App() {
  const [settings, setSettings] = useState<ExtensionSettings>(DEFAULT_SETTINGS);
  const [apiKey, setApiKey] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState('');
  const locale = resolveLocale(settings.locale, navigator.language, navigator.languages);

  useEffect(() => {
    Promise.all([getSettings(), getApiKey()]).then(([nextSettings, key]) => {
      setSettings(nextSettings);
      setApiKey(key);
      setLoaded(true);
    });
  }, []);

  useEffect(() => {
    document.documentElement.lang = localeTag(locale);
    document.documentElement.dir = localeDirection(locale);
  }, [locale]);

  const update = <K extends keyof ExtensionSettings>(
    key: K,
    value: ExtensionSettings[K],
  ) => setSettings((current) => ({ ...current, [key]: value }));

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
    await Promise.all([saveSettings(settings), saveApiKey(apiKey)]);
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
              void clearAllProgress().then(() => setStatus(t(locale, 'progressDeleted')));
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
