import { useEffect, useState } from 'preact/hooks';
import { DEFAULT_SETTINGS, MAX_SPEED, MIN_SPEED } from '../../lib/constants';
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

  useEffect(() => {
    Promise.all([getSettings(), getApiKey()]).then(([nextSettings, key]) => {
      setSettings(nextSettings);
      setApiKey(key);
      setLoaded(true);
    });
  }, []);

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
        setStatus('Google API izni verilmedi; DOM hesaplama çalışmaya devam eder.');
      }
    }
    await Promise.all([saveSettings(settings), saveApiKey(apiKey)]);
    setStatus((current) => current || 'Ayarlar kaydedildi.');
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
      setStatus(`${count} playlist ilerlemesi içe aktarıldı.`);
    } catch {
      setStatus('Geçersiz veya desteklenmeyen ilerleme dosyası.');
    }
  };

  if (!loaded) return <main class="loading">Yükleniyor…</main>;

  return (
    <main>
      <header>
        <span class="logo">◷</span>
        <div>
          <h1>Playlist Zamanı</h1>
          <p>Hızlı, yerel ve gizlilik odaklı.</p>
        </div>
      </header>

      <section>
        <h2>Görünüm ve hesaplama</h2>
        <div class="grid two">
          <label>
            <span>Dil</span>
            <select
              value={settings.locale}
              onChange={(event) =>
                update('locale', event.currentTarget.value as ExtensionSettings['locale'])
              }
            >
              <option value="auto">Otomatik</option>
              <option value="tr">Türkçe</option>
              <option value="en">English</option>
            </select>
          </label>
          <label>
            <span>Tema</span>
            <select
              value={settings.theme}
              onChange={(event) =>
                update('theme', event.currentTarget.value as ExtensionSettings['theme'])
              }
            >
              <option value="auto">YouTube ile aynı</option>
              <option value="light">Açık</option>
              <option value="dark">Koyu</option>
            </select>
          </label>
          <label>
            <span>Varsayılan hız</span>
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
            <span>Özel hız</span>
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
          <span>Saniyeleri göster</span>
        </label>
        <label>
          <span>
            Otomatik izlendi eşiği: %{Math.round(settings.completionThreshold * 100)}
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
        <h2>Büyük playlistler için API</h2>
        <p class="hint">
          İsteğe bağlıdır. Anahtar yalnızca bu cihazda saklanır ve doğrudan Google API’ye
          gönderilir.
        </p>
        <label>
          <span>YouTube Data API anahtarı</span>
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
        <h2>İlerleme verisi</h2>
        <div class="actions">
          <button type="button" class="secondary" onClick={() => void downloadProgress()}>
            Dışa aktar
          </button>
          <label class="file-button">
            İçe aktar
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
              if (!window.confirm('Tüm playlist ilerlemesi silinsin mi?')) return;
              void clearAllProgress().then(() => setStatus('Tüm ilerleme verisi silindi.'));
            }}
          >
            İlerlemeyi sil
          </button>
        </div>
      </section>

      {status && <div class="status" role="status">{status}</div>}
      <button type="button" class="save" onClick={() => void save()}>
        Ayarları kaydet
      </button>
      <footer>v1.0.0 · Analitik ve telemetri içermez</footer>
    </main>
  );
}
