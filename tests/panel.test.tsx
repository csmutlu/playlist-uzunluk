import { render } from 'preact';
import { afterEach, describe, expect, it } from 'vitest';
import { PlaylistAnalyzer } from '../lib/analysis';
import type {
  ContentController,
  ControllerSnapshot,
} from '../lib/content-controller';
import { DEFAULT_SETTINGS } from '../lib/constants';
import { emptyProgress } from '../lib/storage';
import { Panel } from '../entrypoints/playlist.content/Panel';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('playlist panel', () => {
  it('renders compact metrics and opens the detailed calculator', async () => {
    const analyzer = new PlaylistAnalyzer('PL-ui');
    analyzer.setExpectedCount(2);
    analyzer.upsertMany([
      {
        videoId: 'one',
        index: 1,
        title: 'One',
        durationSeconds: 3_600,
        availability: 'available',
        source: 'dom',
      },
      {
        videoId: 'two',
        index: 2,
        title: 'Two',
        durationSeconds: 1_800,
        availability: 'available',
        source: 'dom',
      },
    ]);
    const snapshot: ControllerSnapshot = {
      playlistId: 'PL-ui',
      analysis: analyzer.snapshot(),
      progress: emptyProgress('PL-ui'),
      settings: DEFAULT_SETTINGS,
      locale: 'tr',
      speed: 1.5,
      currentVideo: null,
      busy: null,
      error: null,
    };
    const controller = {
      snapshot: () => snapshot,
      subscribe: (subscriber: (value: ControllerSnapshot) => void) => {
        subscriber(snapshot);
        return () => undefined;
      },
      setSpeed: async () => undefined,
      loadAllVideos: async () => undefined,
      completeWithApi: async () => undefined,
    } as unknown as ContentController;

    const root = document.createElement('div');
    document.body.append(root);
    render(<Panel controller={controller} />, root);

    expect(root.textContent).toContain('VideoExpert');
    expect(root.textContent).toContain('1 saat 30 dakika');
    expect(root.querySelectorAll('.summary-speed-row')).toHaveLength(5);
    expect(root.textContent).not.toContain('Kalan:');
    const summary = root.querySelector<HTMLButtonElement>('.summary')!;
    summary.click();
    await Promise.resolve();

    expect(root.textContent).toContain('Hızlara göre süre');
    expect(root.textContent).toContain('Çalışma planı');
    expect(root.querySelectorAll('.speed-grid button')).toHaveLength(5);
    expect(root.querySelectorAll('.explorer-selects select')).toHaveLength(2);
    expect(root.querySelectorAll('.video-result')).toHaveLength(2);

    const search = root.querySelector<HTMLInputElement>('.video-search input')!;
    search.value = 'two';
    search.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await Promise.resolve();
    expect(root.querySelectorAll('.video-result')).toHaveLength(1);
    expect(root.querySelector('.video-result')?.textContent).toContain('Two');
  });
});
