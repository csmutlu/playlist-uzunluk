import { describe, expect, it } from 'vitest';
import {
  clampSpeed,
  formatDuration,
  parseDurationText,
  speedAdjustedSeconds,
} from '../lib/duration';
import { parseIsoDuration } from '../lib/iso-duration';

describe('duration helpers', () => {
  it('parses thumbnail durations', () => {
    expect(parseDurationText('27:17')).toBe(1_637);
    expect(parseDurationText('1:01:46')).toBe(3_706);
    expect(parseDurationText(' 1:06:35 ')).toBe(3_995);
    expect(parseDurationText('12:61')).toBeNull();
    expect(parseDurationText('LIVE')).toBeNull();
  });

  it('parses ISO 8601 API durations', () => {
    expect(parseIsoDuration('PT1H1M46S')).toBe(3_706);
    expect(parseIsoDuration('P1DT2H3M4S')).toBe(93_784);
    expect(parseIsoDuration('invalid')).toBeNull();
  });

  it('formats Turkish and English natural time', () => {
    expect(formatDuration(127_132, 'tr')).toBe(
      '1 gün 11 saat 18 dakika 52 saniye',
    );
    expect(formatDuration(3_661, 'en')).toBe('1 hour 1 minute 1 second');
    expect(formatDuration(3_661, 'tr', false)).toBe('1 saat 1 dakika');
  });

  it('adjusts and clamps speed safely', () => {
    expect(speedAdjustedSeconds(127_132, 1.25)).toBe(101_706);
    expect(speedAdjustedSeconds(127_132, 1.5)).toBe(84_755);
    expect(speedAdjustedSeconds(127_132, 1.75)).toBe(72_647);
    expect(speedAdjustedSeconds(127_132, 2)).toBe(63_566);
    expect(clampSpeed(8)).toBe(4);
    expect(clampSpeed(0)).toBe(0.25);
  });
});
