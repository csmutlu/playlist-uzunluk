import type { Locale } from './types';
import { localeTag } from './i18n';

const DECIMAL_DIGIT_RANGES = [
  [0x0660, 0x0669],
  [0x06f0, 0x06f9],
  [0x0966, 0x096f],
  [0xff10, 0xff19],
] as const;

export function normalizeLocalizedDigits(value: string): string {
  return value.replace(/\p{Nd}/gu, (digit) => {
    const codePoint = digit.codePointAt(0);
    if (codePoint === undefined || (codePoint >= 0x30 && codePoint <= 0x39)) return digit;
    for (const [start, end] of DECIMAL_DIGIT_RANGES) {
      if (codePoint >= start && codePoint <= end) return String(codePoint - start);
    }
    return digit;
  });
}

export function parseDurationText(value: string): number | null {
  const normalized = normalizeLocalizedDigits(value).replace(/\s+/g, '').trim();
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

  const units = [
    [days, 'day'],
    [hours, 'hour'],
    [minutes, 'minute'],
    [seconds, 'second'],
  ] as const;
  const numberFormat = (unit: Intl.NumberFormatOptions['unit']) =>
    new Intl.NumberFormat(localeTag(locale), {
      style: 'unit',
      unit,
      unitDisplay: 'long',
      maximumFractionDigits: 0,
    });

  const visible = units
    .filter(([value], index) => Number(value) > 0 && (showSeconds || index !== 3))
    .map(([value, unit]) => numberFormat(unit).format(value));

  if (visible.length > 0) return visible.join(' ');
  return numberFormat(showSeconds ? 'second' : 'minute').format(0);
}

export function formatClock(date: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(localeTag(locale), {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}
