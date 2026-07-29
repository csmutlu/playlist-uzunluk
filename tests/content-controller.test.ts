import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../lib/constants';
import { newControllerForTests } from '../lib/content-controller';

const playlistId = 'PL-regression';
const localValues: Record<string, unknown> = {};
const syncValues: Record<string, unknown> = {};

function storageArea(values: Record<string, unknown>) {
  return {
    get: vi.fn(async (key: string | null) =>
      key === null ? { ...values } : { [key]: values[key] },
    ),
    set: vi.fn(async (items: Record<string, unknown>) => Object.assign(values, items)),
    remove: vi.fn(async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key];
    }),
  };
}

function row(videoId: string, index: number, duration: string): string {
  return `
    <ytd-playlist-video-renderer data-video="${videoId}">
      <a id="video-title"
         href="/watch?v=${videoId}&list=${playlistId}&index=${index}">${videoId}</a>
      <ytd-thumbnail-overlay-time-status-renderer>
        <span id="text">${duration}</span>
      </ytd-thumbnail-overlay-time-status-renderer>
    </ytd-playlist-video-renderer>
  `;
}

beforeEach(() => {
  vi.useFakeTimers();
  for (const key of Object.keys(localValues)) delete localValues[key];
  for (const key of Object.keys(syncValues)) delete syncValues[key];
  vi.stubGlobal('chrome', {
    storage: {
      local: storageArea(localValues),
      sync: storageArea(syncValues),
    },
    runtime: {
      sendMessage: vi.fn(async () => ({ ok: true })),
    },
  });
  window.history.replaceState({}, '', `/playlist?list=${playlistId}`);
  document.body.innerHTML = `
    <yt-page-header-renderer>
      <yt-page-header-view-model>
        <div class="ytPageHeaderViewModelHeadlineInfo">
          <h1>Regression playlist</h1><span id="count">2 videos</span>
        </div>
      </yt-page-header-view-model>
    </yt-page-header-renderer>
    <ytd-two-column-browse-results-renderer>
      <div id="contents">${row('video-one', 1, '1:00')}${row('video-two', 2, '2:00')}</div>
    </ytd-two-column-browse-results-renderer>
  `;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

async function flushMutation(): Promise<void> {
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(400);
}

describe('content controller DOM regression handling', () => {
  it('updates reordered indices without duplicates', async () => {
    const controller = newControllerForTests(DEFAULT_SETTINGS);
    await controller.navigate();

    const one = document.querySelector<HTMLAnchorElement>('[data-video="video-one"] a')!;
    const two = document.querySelector<HTMLAnchorElement>('[data-video="video-two"] a')!;
    one.href = `/watch?v=video-one&list=${playlistId}&index=2`;
    two.href = `/watch?v=video-two&list=${playlistId}&index=1`;
    await flushMutation();

    expect(controller.snapshot().analysis?.videos.map(({ videoId, index }) => [
      videoId,
      index,
    ])).toEqual([
      ['video-two', 1],
      ['video-one', 2],
    ]);
    expect(controller.snapshot().analysis).toMatchObject({
      countedCount: 2,
      totalSeconds: 180,
    });
    const diagnostic = controller.diagnosticReport();
    expect(diagnostic).not.toContain(playlistId);
    expect(diagnostic).not.toContain('Regression playlist');
    expect(diagnostic).not.toContain('video-one');
    controller.dispose();
  });

  it('removes a confirmed deleted row and updates a changed duration', async () => {
    const controller = newControllerForTests(DEFAULT_SETTINGS);
    await controller.navigate();

    const count = document.querySelector('#count')!;
    count.textContent = '1 video';
    document.querySelector('[data-video="video-two"]')?.remove();
    const duration = document.querySelector('[data-video="video-one"] #text')!;
    duration.textContent = '1:30';
    await flushMutation();

    expect(controller.snapshot().analysis).toMatchObject({
      expectedCount: 1,
      countedCount: 1,
      totalSeconds: 90,
      listComplete: true,
    });
    controller.dispose();
  });

  it('reacts to a delayed header count without polling', async () => {
    document.querySelector('#count')!.textContent = '0 videos';
    const controller = newControllerForTests(DEFAULT_SETTINGS);
    await controller.navigate();
    expect(controller.snapshot().analysis?.expectedCount).toBeNull();

    document.querySelector('#count')!.textContent = '2 videos';
    await flushMutation();

    expect(controller.snapshot().analysis).toMatchObject({
      expectedCount: 2,
      countedCount: 2,
      listComplete: true,
    });
    controller.dispose();
  });

  it('retargets observation when YouTube replaces the playlist header', async () => {
    const controller = newControllerForTests(DEFAULT_SETTINGS);
    await controller.navigate();

    document.querySelector('yt-page-header-renderer')?.remove();
    document.body.insertAdjacentHTML(
      'afterbegin',
      `
        <ytd-playlist-header-renderer>
          <h1>Replacement header</h1><span>3 videos</span>
        </ytd-playlist-header-renderer>
      `,
    );
    await flushMutation();

    expect(controller.snapshot().analysis?.expectedCount).toBe(3);
    controller.dispose();
  });

  it('updates row accessibility labels when the language changes', async () => {
    const controller = newControllerForTests({ ...DEFAULT_SETTINGS, locale: 'tr' });
    await controller.navigate();
    expect(document.querySelector<HTMLButtonElement>('.pz-row-toggle')?.title).toBe(
      'İzlendi olarak işaretle',
    );

    await controller.updateSettings({ ...DEFAULT_SETTINGS, locale: 'en' });
    expect(document.querySelector<HTMLButtonElement>('.pz-row-toggle')?.title).toBe(
      'Mark as watched',
    );
    controller.dispose();
  });

  it('mirrors universal playback speeds above the playlist preset range', async () => {
    const video = document.createElement('video');
    document.body.append(video);
    const controller = newControllerForTests(DEFAULT_SETTINGS);
    await controller.navigate();

    video.playbackRate = 8;
    video.dispatchEvent(new Event('ratechange'));

    expect(controller.snapshot().speed).toBe(8);
    controller.dispose();
  });
});
