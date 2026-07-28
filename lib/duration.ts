import type { Locale } from './types';

export function parseDurationText(value: string): number | null {
  const normalized = value.replace(/\s+/g, '').trim();
  if (!/^\d{1,4}:\d{2}(?::\d{2})?$/.test(normalized)) return null;

  const parts = normalized.split(':').map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return null;
  if (parts.length === 2) {
    const [minutes = 0, seconds = 0] = parts;
    if (seconds > 59) return null;
    return minutes * 60 + seconds;
  }

  const [hours = 0, minutes = 0, seconds = 0] = parts;
  if (minutes > 59 || seconds > 59) return null;
  return hours * 3600 + minutes * 60 + seconds;
}

export function speedAdjustedSeconds(seconds: number, speed: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  if (!Number.isFinite(speed) || speed <= 0) return Math.round(seconds);
  return Math.round(seconds / speed);
}

export function clampSpeed(speed: number): number {
  if (!Number.isFinite(speed)) return 1;
  return Math.min(4, Math.max(0.25, Math.round(speed * 100) / 100));
}

export function formatDuration(
  inputSeconds: number,
  locale: Locale,
  showSeconds = true,
): string {
  const total = Math.max(0, Math.round(inputSeconds));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const seconds = total % 60;

  const units =
    locale === 'tr'
      ? [
          [days, 'gün'],
          [hours, 'saat'],
          [minutes, 'dakika'],
          [seconds, 'saniye'],
        ]
      : [
          [days, days === 1 ? 'day' : 'days'],
          [hours, hours === 1 ? 'hour' : 'hours'],
          [minutes, minutes === 1 ? 'minute' : 'minutes'],
          [seconds, seconds === 1 ? 'second' : 'seconds'],
        ];

  const visible = units
    .filter(([value], index) => Number(value) > 0 && (showSeconds || index !== 3))
    .map(([value, label]) => `${value} ${label}`);

  if (visible.length > 0) return visible.join(' ');
  if (!showSeconds) return locale === 'tr' ? '0 dakika' : '0 minutes';
  return locale === 'tr' ? '0 saniye' : '0 seconds';
}

export function formatClock(date: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === 'tr' ? 'tr-TR' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}
