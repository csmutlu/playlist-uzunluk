import type { TabAudioSettings } from './types';

export const DEFAULT_TAB_AUDIO_SETTINGS: Readonly<TabAudioSettings> = {
  percent: 100,
  bass: 0,
  voice: 0,
};

export function normalizeTabAudioSettings(
  settings: Partial<TabAudioSettings> | null | undefined,
): TabAudioSettings {
  const finite = (value: unknown, fallback: number) =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return {
    percent: Math.round(Math.min(600, Math.max(0, finite(settings?.percent, 100)))),
    bass: Math.round(Math.min(100, Math.max(0, finite(settings?.bass, 0)))),
    voice: Math.round(Math.min(100, Math.max(0, finite(settings?.voice, 0)))),
  };
}

export function tabAudioNodeValues(settings: TabAudioSettings): {
  gain: number;
  bassDb: number;
  voiceDb: number;
} {
  const normalized = normalizeTabAudioSettings(settings);
  return {
    gain: normalized.percent / 100,
    bassDb: normalized.bass * 0.15,
    voiceDb: normalized.voice * 0.12,
  };
}

export function isNeutralTabAudio(settings: TabAudioSettings): boolean {
  const normalized = normalizeTabAudioSettings(settings);
  return normalized.percent === 100 && normalized.bass === 0 && normalized.voice === 0;
}
