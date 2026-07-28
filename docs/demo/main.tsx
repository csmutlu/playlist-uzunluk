import { render } from 'preact';
import type { ContentController, ControllerSnapshot } from '../../lib/content-controller';
import { SCHEMA_VERSION, type PlaylistVideo } from '../../lib/types';
import { Panel } from '../../entrypoints/playlist.content/Panel';
import panelStyles from '../../entrypoints/playlist.content/style.css?raw';
import './style.css';

if (new URLSearchParams(location.search).has('focus')) {
  document.body.classList.add('focus-mode');
}

const durations = Array.from({ length: 46 }, (_, index) => 1_860 + ((index * 317) % 1_940));
durations[45] =
  (durations[45] ?? 0) + 127_132 - durations.reduce((sum, duration) => sum + duration, 0);

const videos: PlaylistVideo[] = durations.map((durationSeconds, index) => ({
  videoId: `video-${index + 1}`,
  index: index + 1,
  title: `${index + 1}. Ders`,
  durationSeconds,
  availability: 'available',
  source: 'dom',
}));

const prefixSeconds = [0];
for (const video of videos) {
  prefixSeconds.push(prefixSeconds.at(-1)! + (video.durationSeconds ?? 0));
}

const snapshot: ControllerSnapshot = {
  playlistId: 'PL5kIOunpmSBMBPYmrPkd0JikOPIfQW-Sn',
  analysis: {
    playlistId: 'PL5kIOunpmSBMBPYmrPkd0JikOPIfQW-Sn',
    expectedCount: 46,
    countedCount: 46,
    listComplete: true,
    unknownDurationCount: 0,
    unavailableCount: 0,
    totalSeconds: 127_132,
    videos,
    prefixSeconds,
    updatedAt: Date.now(),
  },
  progress: {
    schemaVersion: SCHEMA_VERSION,
    playlistId: 'PL5kIOunpmSBMBPYmrPkd0JikOPIfQW-Sn',
    videos: Object.fromEntries(
      videos.slice(0, 12).map((video) => [
        video.videoId,
        {
          watched: true,
          source: 'auto' as const,
          positionSeconds: video.durationSeconds ?? 0,
          updatedAt: Date.now(),
        },
      ]),
    ),
    lastVideoId: 'video-12',
    updatedAt: Date.now(),
  },
  settings: {
    schemaVersion: SCHEMA_VERSION,
    locale: 'tr',
    defaultSpeed: 1.5,
    customSpeed: 1.35,
    showSeconds: false,
    completionThreshold: 0.9,
    theme: 'dark',
  },
  locale: 'tr',
  speed: 1.5,
  currentVideo: {
    videoId: 'video-13',
    index: 13,
    positionSeconds: 1_240,
  },
  busy: null,
  error: null,
};

const subscribers = new Set<(value: ControllerSnapshot) => void>();
const controller = {
  snapshot: () => snapshot,
  subscribe: (subscriber: (value: ControllerSnapshot) => void) => {
    subscribers.add(subscriber);
    subscriber(snapshot);
    return () => subscribers.delete(subscriber);
  },
  setSpeed: async (speed: number) => {
    snapshot.speed = speed;
    for (const subscriber of subscribers) subscriber({ ...snapshot });
  },
  loadAllVideos: async () => undefined,
  completeWithApi: async () => undefined,
} as unknown as ContentController;

function VideoRow({ index, title, duration }: { index: number; title: string; duration: string }) {
  return (
    <article class="video-row">
      <span class="video-index">{index}</span>
      <span class={`thumbnail tone-${(index % 4) + 1}`}>
        <span class="play">▶</span>
        <small>{duration}</small>
      </span>
      <span class="video-copy">
        <strong>{title}</strong>
        <small>Kod Atölyesi · TypeScript</small>
      </span>
    </article>
  );
}

function Demo() {
  return (
    <main class="youtube-shell">
      <header>
        <span class="menu">☰</span>
        <span class="youtube-logo"><b>▶</b> YouTube</span>
        <span class="search">Ara</span>
        <span class="profile">C</span>
      </header>

      <section class="playlist-layout">
        <aside class="playlist-card">
          <div class="cover">
            <span>TS</span>
            <small>WEB GELİŞTİRME</small>
          </div>
          <h1>Modern Web Geliştirme: TypeScript</h1>
          <p><strong>Kod Atölyesi</strong> · Eğitim</p>
          <p class="muted">46 video · Son güncelleme 18 Tem 2026</p>
          <div class="card-actions">
            <button>▶ Oynat</button>
            <button>☷ Karıştır</button>
          </div>
          <div
            class="extension-host"
            ref={(element) => {
              if (!element || element.shadowRoot) return;
              const shadow = element.attachShadow({ mode: 'open' });
              shadow.host.setAttribute('data-theme', 'dark');
              const style = document.createElement('style');
              style.textContent = panelStyles;
              shadow.append(style);
              const mount = document.createElement('div');
              shadow.append(mount);
              render(<Panel controller={controller} />, mount);
            }}
          />
        </aside>

        <section class="playlist-videos">
          <div class="list-heading">
            <span>Sıralama</span>
            <small>46 video</small>
          </div>
          <VideoRow index={1} title="TypeScript’e Giriş ve Kurulum" duration="42:18" />
          <VideoRow index={2} title="Tipler, Interface ve Type Alias" duration="51:04" />
          <VideoRow index={3} title="Fonksiyonlar ve Generic Yapılar" duration="47:32" />
          <VideoRow index={4} title="Modern DOM ve Event Yönetimi" duration="38:46" />
          <VideoRow index={5} title="Async/Await ve Fetch API" duration="44:09" />
          <VideoRow index={6} title="Modüler Proje Mimarisi" duration="53:21" />
          <VideoRow index={7} title="Test, Build ve Deployment" duration="40:15" />
        </section>
      </section>
    </main>
  );
}

render(<Demo />, document.getElementById('app')!);
