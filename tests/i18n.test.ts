import { describe, expect, it } from 'vitest';
import {
  LOCALE_OPTIONS,
  localeDirection,
  localeTag,
  resolveLocale,
  t,
  weekdayLabels,
} from '../lib/i18n';
import { SUPPORTED_LOCALES } from '../lib/types';

describe('internationalization', () => {
  it('exposes every supported locale in the language selector', () => {
    expect(LOCALE_OPTIONS.map((option) => option.value)).toEqual(SUPPORTED_LOCALES);
  });

  it('detects regional browser and page languages', () => {
    expect(resolveLocale('auto', 'fr-CA')).toBe('fr');
    expect(resolveLocale('auto', '', ['pt-PT'])).toBe('pt-BR');
    expect(resolveLocale('auto', 'zh-Hant')).toBe('zh-CN');
    expect(resolveLocale('auto', 'unknown', ['ar-SA'])).toBe('ar');
    expect(resolveLocale('auto', 'unknown')).toBe('en');
    expect(resolveLocale('tr', 'fr-FR')).toBe('tr');
  });

  it('supports interpolation, locale metadata and RTL', () => {
    expect(t('es', 'completionThreshold', { percent: 90 })).toContain('90%');
    expect(t('ar', 'settings')).toBe('الإعدادات');
    expect(localeDirection('ar')).toBe('rtl');
    expect(localeDirection('fr')).toBe('ltr');
    expect(localeTag('pt-BR')).toBe('pt-BR');
    expect(weekdayLabels('ja')).toHaveLength(7);
  });
});
