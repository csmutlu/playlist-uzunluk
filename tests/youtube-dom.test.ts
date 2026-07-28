import { beforeEach, describe, expect, it } from 'vitest';
import {
  expectedVideoCount,
  extractVideoFromRow,
  findPanelAnchor,
  rowsWithin,
} from '../lib/youtube-dom';

const playlistId = 'PL123';

describe('YouTube DOM adapters', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.history.replaceState({}, '', `/?list=${playlistId}`);
  });

  it('extracts the current lockup view model', () => {
    document.body.innerHTML = `
      <ytd-playlist-header-renderer><span>46 video</span></ytd-playlist-header-renderer>
      <div id="contents">
        <yt-lockup-view-model>
          <a class="ytLockupViewModelContentImage"
             href="/watch?v=abcdefghijk&list=${playlistId}&index=1">27:17</a>
          <h3><a class="ytLockupMetadataViewModelTitle"
             href="/watch?v=abcdefghijk&list=${playlistId}&index=1">Birinci video</a></h3>
        </yt-lockup-view-model>
      </div>
    `;
    const rows = rowsWithin(document, playlistId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.video).toMatchObject({
      videoId: 'abcdefghijk',
      index: 1,
      durationSeconds: 1_637,
      title: 'Birinci video',
      availability: 'available',
    });
    expect(expectedVideoCount()).toBe(46);
  });

  it('extracts the legacy playlist renderer', () => {
    document.body.innerHTML = `
      <ytd-playlist-video-renderer>
        <a id="thumbnail" href="/watch?v=lmnopqrstuv&list=${playlistId}&index=2"></a>
        <a id="video-title" href="/watch?v=lmnopqrstuv&list=${playlistId}&index=2">
          İkinci video
        </a>
        <ytd-thumbnail-overlay-time-status-renderer>
          <span id="text">1:01:46</span>
        </ytd-thumbnail-overlay-time-status-renderer>
      </ytd-playlist-video-renderer>
    `;
    const row = document.querySelector<HTMLElement>('ytd-playlist-video-renderer')!;
    expect(extractVideoFromRow(row, playlistId)).toMatchObject({
      videoId: 'lmnopqrstuv',
      index: 2,
      durationSeconds: 3_706,
      title: 'İkinci video',
    });
  });

  it('does not silently turn unavailable videos into zero seconds', () => {
    document.body.innerHTML = `
      <ytd-playlist-video-renderer>
        <a href="/watch?v=zzzzzzzzzzz&list=${playlistId}&index=3"></a>
        <span>Gizli video</span>
      </ytd-playlist-video-renderer>
    `;
    const row = document.querySelector<HTMLElement>('ytd-playlist-video-renderer')!;
    expect(extractVideoFromRow(row, playlistId)).toMatchObject({
      durationSeconds: null,
      availability: 'unavailable',
    });
  });

  it('uses the current page header model as the playlist panel anchor', () => {
    document.body.innerHTML = `
      <yt-page-header-renderer style="display: none">
        <yt-page-header-view-model>
          <div class="ytPageHeaderViewModelHeadlineInfo">
            <h1>Stale playlist header</h1>
            <span>46 video</span>
          </div>
        </yt-page-header-view-model>
      </yt-page-header-renderer>
      <yt-page-header-renderer data-current>
        <yt-page-header-view-model>
          <div class="ytPageHeaderViewModelHeadlineInfo">
            <h1>Modern Web Development</h1>
            <span>190 video</span>
          </div>
        </yt-page-header-view-model>
      </yt-page-header-renderer>
    `;

    const anchor = document.querySelector(
      'yt-page-header-renderer[data-current] .ytPageHeaderViewModelHeadlineInfo',
    );
    expect(findPanelAnchor()).toBe(anchor);
    expect(expectedVideoCount()).toBe(190);
  });
});
