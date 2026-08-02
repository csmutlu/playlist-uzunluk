import { describe, expect, it } from 'vitest';
import { convertVideoSpeedSettings, isVideoSpeedExport } from '../lib/vsc-import';

/**
 * Shaped after a real `videospeed-settings.json`, whose fields come from
 * Video Speed Controller's DEFAULT_SETTINGS and DEFAULT_BINDINGS.
 */
const vscExport = {
  schemaVersion: 1,
  lastSpeed: 1.5,
  enabled: true,
  rememberSpeed: true,
  exclusiveKeys: true,
  audioBoolean: false,
  startHidden: true,
  controllerOpacity: 0.6,
  controllerButtonSize: 18,
  customCSS: '.vsc-controller { color: red; }',
  keyBindings: [
    { action: 'slower', code: 'KeyS', key: 83, keyCode: 83, value: 0.25, predefined: true },
    { action: 'faster', code: 'KeyD', key: 68, keyCode: 68, value: 0.25, predefined: true },
    { action: 'rewind', code: 'KeyZ', key: 90, keyCode: 90, value: 15, predefined: true },
    { action: 'advance', code: 'KeyX', key: 88, keyCode: 88, value: 20, predefined: true },
    { action: 'reset', code: 'KeyR', key: 82, keyCode: 82, value: 1, predefined: true },
    { action: 'fast', code: 'KeyG', key: 71, keyCode: 71, value: 2.5, predefined: true },
    { action: 'display', code: 'KeyV', key: 86, keyCode: 86, value: 0, predefined: true },
    { action: 'mark', code: 'KeyM', key: 77, keyCode: 77, value: 0, predefined: true },
    { action: 'jump', code: 'KeyJ', key: 74, keyCode: 74, value: 0, predefined: true },
  ],
  siteRules: [
    { pattern: 'imgur.com', enabled: false, speed: null },
    { pattern: 'udemy.com', enabled: true, speed: 1.75 },
  ],
  blacklist: 'imgur.com\nteams.microsoft.com\nmeet.google.com',
  logLevel: 3,
};

describe('Video Speed Controller import', () => {
  it('recognises their export and rejects ours', () => {
    expect(isVideoSpeedExport(vscExport)).toBe(true);
    expect(isVideoSpeedExport({ kind: 'playlist-zamani-universal', settings: {} })).toBe(false);
    expect(isVideoSpeedExport({ hello: 'world' })).toBe(false);
    expect(isVideoSpeedExport(null)).toBe(false);
    expect(isVideoSpeedExport([1, 2])).toBe(false);
  });

  it('maps their toggles, sizes and per-binding values onto ours', () => {
    const { settings, preferredSpeed } = convertVideoSpeedSettings(vscExport);

    expect(settings.rememberPerSite).toBe(true);
    expect(settings.exclusiveKeys).toBe(true);
    expect(settings.audioEnabled).toBe(false);
    expect(settings.indicatorMode).toBe('hidden');
    expect(settings.controllerOpacity).toBe(0.6);
    expect(settings.controllerSize).toBe(18);
    expect(settings.customCss).toBe('.vsc-controller { color: red; }');

    // Their per-binding values are our shared step and seek settings.
    expect(settings.speedStep).toBe(0.25);
    expect(settings.rewindSeconds).toBe(15);
    expect(settings.advanceSeconds).toBe(20);
    // Their `fast` value is our preferred speed.
    expect(preferredSpeed).toBe(2.5);
  });

  it('never imports the all-site permission switch', () => {
    const { settings } = convertVideoSpeedSettings({ ...vscExport, enabled: true });
    expect(settings.enabled).toBe(false);
  });

  it('translates their action names and modifier chords', () => {
    const { settings, skippedActions } = convertVideoSpeedSettings({
      ...vscExport,
      keyBindings: [
        { action: 'fast', code: 'KeyP', value: 3, modifiers: { ctrl: true, shift: true } },
        { action: 'display', code: 'KeyB' },
        { action: 'somethingNew', code: 'KeyQ' },
      ],
    });

    expect(settings.shortcuts.preferred).toEqual({
      code: 'KeyP',
      alt: false,
      ctrl: true,
      meta: false,
      shift: true,
    });
    expect(settings.shortcuts.toggleIndicator.code).toBe('KeyB');
    // Untranslatable actions are reported rather than silently dropped.
    expect(skippedActions).toEqual(['somethingNew']);
    // Actions absent from their file keep our defaults.
    expect(settings.shortcuts.mark.code).toBe('KeyM');
  });

  it('resolves legacy exports that only carry keyCode', () => {
    const { settings } = convertVideoSpeedSettings({
      blacklist: '',
      keyBindings: [
        { action: 'slower', keyCode: 90, value: 0.1 },
        { action: 'faster', key: 88, value: 0.1 },
      ],
    });
    expect(settings.shortcuts.slower.code).toBe('KeyZ');
    expect(settings.shortcuts.faster.code).toBe('KeyX');
  });

  it('merges blacklist entries and site rules into pattern rules', () => {
    const { patternRules } = convertVideoSpeedSettings(vscExport);
    const byPattern = Object.fromEntries(patternRules.map((rule) => [rule.pattern, rule]));

    // Blacklist-only entries become disabled rules.
    expect(byPattern['teams.microsoft.com']?.enabled).toBe(false);
    expect(byPattern['meet.google.com']?.enabled).toBe(false);
    // A siteRule wins over the same blacklist entry.
    expect(byPattern['imgur.com']?.enabled).toBe(false);
    expect(byPattern['udemy.com']).toEqual({
      id: 'vsc-udemy.com',
      pattern: 'udemy.com',
      enabled: true,
      defaultSpeed: 1.75,
      updatedAt: expect.any(Number),
    });
    expect(patternRules).toHaveLength(4);
  });

  it('keeps wildcard and regex patterns intact', () => {
    const { patternRules } = convertVideoSpeedSettings({
      blacklist: '*.example.com\n/^https:\\/\\/foo\\..*/\n# a comment\n\n  SPACED.COM  ',
    });
    expect(patternRules.map((rule) => rule.pattern)).toEqual([
      '*.example.com',
      '/^https:\\/\\/foo\\..*/',
      'spaced.com',
    ]);
  });

  it('clamps hostile values instead of trusting the file', () => {
    const { settings, preferredSpeed } = convertVideoSpeedSettings({
      controllerOpacity: 99,
      controllerButtonSize: -5,
      customCSS: 'a'.repeat(20_000),
      keyBindings: [
        { action: 'slower', code: 'KeyS', value: -400 },
        { action: 'rewind', code: 'KeyZ', value: 99_999 },
        { action: 'fast', code: 'KeyG', value: 500 },
      ],
    });
    expect(settings.controllerOpacity).toBe(1);
    expect(settings.controllerSize).toBe(10);
    expect(settings.customCss).toHaveLength(8_000);
    expect(settings.speedStep).toBe(2);
    expect(settings.rewindSeconds).toBe(600);
    expect(preferredSpeed).toBe(16);
  });

  it('refuses files that are not theirs', () => {
    expect(() => convertVideoSpeedSettings({ hello: 'world' })).toThrow();
  });
});
