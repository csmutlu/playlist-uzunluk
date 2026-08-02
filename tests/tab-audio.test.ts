import { describe, expect, it } from 'vitest';
import {
  isNeutralTabAudio,
  normalizeTabAudioSettings,
  tabAudioNodeValues,
} from '../lib/tab-audio';

describe('tab audio settings', () => {
  it('clamps and rounds popup values', () => {
    expect(normalizeTabAudioSettings({ percent: 700, bass: -4, voice: 42.4 })).toEqual({
      percent: 600,
      bass: 0,
      voice: 42,
    });
  });

  it('maps controls to Web Audio gain values', () => {
    expect(tabAudioNodeValues({ percent: 250, bass: 80, voice: 50 })).toEqual({
      gain: 2.5,
      bassDb: 12,
      voiceDb: 6,
    });
  });

  it('recognizes the native pass-through profile', () => {
    expect(isNeutralTabAudio({ percent: 100, bass: 0, voice: 0 })).toBe(true);
    expect(isNeutralTabAudio({ percent: 100, bass: 1, voice: 0 })).toBe(false);
  });
});
