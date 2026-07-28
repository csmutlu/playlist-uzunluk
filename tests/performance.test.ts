import { describe, expect, it } from 'vitest';
import { PlaylistAnalyzer, rangeSeconds } from '../lib/analysis';
import type { PlaylistVideo } from '../lib/types';

describe('performance budgets', () => {
  it('analyzes 1,000 videos without a long task in the domain layer', () => {
    const videos: PlaylistVideo[] = Array.from({ length: 1_000 }, (_, index) => ({
      videoId: `video-${index}`,
      index: index + 1,
      title: `Video ${index}`,
      durationSeconds: 60 + (index % 600),
      availability: 'available',
      source: 'dom',
    }));
    const analyzer = new PlaylistAnalyzer('PL-large');

    const startedAt = performance.now();
    analyzer.upsertMany(videos);
    analyzer.setExpectedCount(1_000);
    const result = analyzer.snapshot();
    const elapsed = performance.now() - startedAt;

    expect(result.countedCount).toBe(1_000);
    expect(result.listComplete).toBe(true);
    expect(rangeSeconds(result, 100, 900)).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(50);
  });
});
