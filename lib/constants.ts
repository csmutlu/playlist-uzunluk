import type { ExtensionSettings } from './types';

export const SPEED_PRESETS = [1, 1.25, 1.5, 1.75, 2] as const;
export const MIN_SPEED = 0.25;
export const MAX_SPEED = 4;
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const STORAGE_FLUSH_MS = 15_000;
export const MUTATION_BATCH_MS = 150;
export const INITIAL_SCAN_CHUNK = 100;

export const DEFAULT_SETTINGS: ExtensionSettings = {
  schemaVersion: 1,
  locale: 'auto',
  defaultSpeed: 1,
  customSpeed: 1.1,
  showSeconds: true,
  completionThreshold: 0.9,
  theme: 'auto',
};
