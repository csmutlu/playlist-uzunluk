import { describe, expect, it } from 'vitest';
import {
  PlaylistAnalyzer,
  rangeSeconds,
  setProgressStatus,
  watchedAndRemainingSeconds,
} from '../lib/analysis';
import { emptyProgress } from '../lib/storage';
import type { PlaylistVideo } from '../lib/types';

const fixtureDurations = [
  '27:17', '1:01:46', '1:06:35', '39:02', '26:56', '1:04:03', '20:55',
  '39:51', '41:25', '39:21', '39:59', '37:47', '47:56', '1:03:03',
  '57:35', '36:23', '35:42', '55:35', '1:01:28', '40:01', '52:00',
  '43:42', '34:14', '42:20', '46:21', '1:11:51', '43:25', '47:59',
  '31:21', '1:38:08', '44:33', '33:32', '39:12', '26:36', '49:05',
  '43:31', '1:00:50', '53:10', '33:24', '28:51', '57:38', '1:07:23',
  '1:01:35', '35:42', '34:36', '35:13',
];

function seconds(value: string): number {
  return value.split(':').map(Number).reduce((total, part) => total * 60 + part, 0);
}

function video(index: number, durationSeconds: number): PlaylistVideo {
  return {
    videoId: `video-${index}`,
    index,
    title: `Video ${index}`,
    durationSeconds,
    availability: 'available',
    source: 'dom',
  };
}

describe('PlaylistAnalyzer', () => {
  it('matches the supplied 46-video playlist fixture', () => {
    const analyzer = new PlaylistAnalyzer('PL-fixture');
    analyzer.setExpectedCount(46);
    analyzer.upsertMany(
      fixtureDurations.map((duration, index) => video(index + 1, seconds(duration))),
    );
    const result = analyzer.snapshot();

    expect(result.countedCount).toBe(46);
    expect(result.totalSeconds).toBe(127_132);
    expect(result.listComplete).toBe(true);
    expect(result.prefixSeconds).toHaveLength(47);
  });

  it('updates counters without double counting duplicate rows', () => {
    const analyzer = new PlaylistAnalyzer('PL-test');
    expect(analyzer.upsert(video(1, 60))).toBe(true);
    expect(analyzer.upsert(video(1, 60))).toBe(false);
    expect(analyzer.snapshot().totalSeconds).toBe(60);

    analyzer.upsert(video(1, 90));
    expect(analyzer.snapshot().totalSeconds).toBe(90);
  });

  it('keeps one canonical video when a playlist is reordered', () => {
    const analyzer = new PlaylistAnalyzer('PL-test');
    analyzer.upsertMany([video(1, 60), video(2, 90)]);

    analyzer.upsert({ ...video(1, 60), index: 2 });
    analyzer.upsert({ ...video(2, 90), index: 1 });

    const result = analyzer.snapshot();
    expect(result.countedCount).toBe(2);
    expect(result.totalSeconds).toBe(150);
    expect(result.videos.map(({ videoId, index }) => [videoId, index])).toEqual([
      ['video-2', 1],
      ['video-1', 2],
    ]);
  });

  it('removes videos and preserves known API data during partial DOM updates', () => {
    const analyzer = new PlaylistAnalyzer('PL-test');
    analyzer.upsert({
      ...video(1, 120),
      title: 'API title',
      source: 'api',
    });
    analyzer.upsert({
      ...video(1, 0),
      title: '',
      durationSeconds: null,
      availability: 'unknown',
      source: 'dom',
      index: 2,
    });

    expect(analyzer.snapshot().videos[0]).toMatchObject({
      index: 2,
      title: 'API title',
      durationSeconds: 120,
      availability: 'available',
      source: 'api',
    });
    expect(analyzer.remove('video-1')).toBe(true);
    expect(analyzer.snapshot()).toMatchObject({
      countedCount: 0,
      totalSeconds: 0,
      unknownDurationCount: 0,
    });
  });

  it('uses prefix sums for range calculations', () => {
    const analyzer = new PlaylistAnalyzer('PL-test');
    analyzer.upsertMany([video(1, 10), video(2, 20), video(3, 30), video(4, 40)]);
    const result = analyzer.snapshot();
    expect(rangeSeconds(result, 2, 3)).toBe(50);
    expect(rangeSeconds(result, 8, 9)).toBe(0);
  });

  it('combines manual progress and current playback position', () => {
    const analyzer = new PlaylistAnalyzer('PL-test');
    analyzer.upsertMany([video(1, 100), video(2, 200), video(3, 300)]);
    let progress = emptyProgress('PL-test');
    progress = setProgressStatus(progress, 'video-1', true, 'manual');

    expect(
      watchedAndRemainingSeconds(analyzer.snapshot(), progress, {
        videoId: 'video-2',
        positionSeconds: 50,
      }),
    ).toEqual({
      watchedSeconds: 150,
      remainingSeconds: 450,
      selectedTotalSeconds: 600,
    });

    const unchanged = setProgressStatus(progress, 'video-1', false, 'auto');
    expect(unchanged.videos['video-1']?.watched).toBe(true);
  });
});
