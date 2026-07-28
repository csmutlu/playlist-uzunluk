import type { Locale } from './types';

const messages = {
  tr: {
    total: 'Toplam',
    remaining: 'Kalan',
    watched: 'İzlenen',
    videos: 'video',
    partial: 'Kısmi sonuç',
    complete: 'Tam',
    unknown: 'süresi bilinmiyor',
    expand: 'Ayrıntıları aç',
    collapse: 'Ayrıntıları kapat',
    speeds: 'Hızlara göre süre',
    range: 'Video aralığı',
    start: 'Başlangıç',
    end: 'Bitiş',
    fromCurrent: 'Bu videodan itibaren',
    allPlaylist: 'Tüm playlist',
    remainingMode: 'Kalan',
    selectedRange: 'Seçili aralık',
    progress: 'İlerleme',
    saved: 'Kazanılan zaman',
    finishAt: 'Tahmini bitiş',
    average: 'Ortalama',
    shortest: 'En kısa',
    longest: 'En uzun',
    planner: 'Çalışma planı',
    dailyMinutes: 'Günlük dakika',
    finishDate: 'Bitiş tarihi',
    activeDays: 'Aktif gün',
    loadAll: 'Tüm videoları yükle',
    cancel: 'İptal',
    useApi: 'API ile tamamla',
    loading: 'Hesaplanıyor…',
    noPlaylist: 'Playlist verisi bekleniyor…',
    unavailable: 'erişilemiyor',
    settings: 'Ayarlar',
  },
  en: {
    total: 'Total',
    remaining: 'Remaining',
    watched: 'Watched',
    videos: 'videos',
    partial: 'Partial result',
    complete: 'Complete',
    unknown: 'unknown duration',
    expand: 'Open details',
    collapse: 'Close details',
    speeds: 'Time by speed',
    range: 'Video range',
    start: 'Start',
    end: 'End',
    fromCurrent: 'From this video',
    allPlaylist: 'Full playlist',
    remainingMode: 'Remaining',
    selectedRange: 'Selected range',
    progress: 'Progress',
    saved: 'Time saved',
    finishAt: 'Estimated finish',
    average: 'Average',
    shortest: 'Shortest',
    longest: 'Longest',
    planner: 'Study plan',
    dailyMinutes: 'Daily minutes',
    finishDate: 'Finish date',
    activeDays: 'Active days',
    loadAll: 'Load all videos',
    cancel: 'Cancel',
    useApi: 'Complete with API',
    loading: 'Calculating…',
    noPlaylist: 'Waiting for playlist data…',
    unavailable: 'unavailable',
    settings: 'Settings',
  },
} as const;

export type MessageKey = keyof (typeof messages)['tr'];

export function t(locale: Locale, key: MessageKey): string {
  return messages[locale][key];
}

export function resolveLocale(
  setting: Locale | 'auto',
  documentLanguage = 'en',
): Locale {
  if (setting !== 'auto') return setting;
  return documentLanguage.toLowerCase().startsWith('tr') ? 'tr' : 'en';
}
