import { describe, expect, it } from 'vitest';
import { DEFAULT_SHORTCUTS } from '../lib/constants';
import { SUPPORTED_LOCALES, type SiteMediaRule, type SitePlaybackState } from '../lib/types';
import {
  actionForKeyboardEvent,
  clampUniversalSpeed,
  commandForKeyboardEvent,
  isEditableTarget,
  mediaDownloadInfo,
  resolveSiteSpeed,
  roundSpeed,
  selectMedia,
  shortcutLabel,
  sanitizeDownloadFilename,
} from '../lib/universal';
import { ut } from '../lib/universal-i18n';

describe('universal speed helpers', () => {
  it('rounds by the configured step and clamps the supported range', () => {
    expect(roundSpeed(1.56, 0.1)).toBe(1.6);
    expect(roundSpeed(1.54, 0.05)).toBe(1.55);
    expect(clampUniversalSpeed(0)).toBe(0.07);
    expect(clampUniversalSpeed(30)).toBe(16);
  });

  it('matches physical-key shortcuts including modifiers', () => {
    expect(actionForKeyboardEvent(
      { code: 'KeyD', altKey: false, ctrlKey: false, metaKey: false, shiftKey: false },
      DEFAULT_SHORTCUTS,
    )).toBe('faster');
    expect(actionForKeyboardEvent(
      { code: 'KeyD', altKey: false, ctrlKey: true, metaKey: false, shiftKey: false },
      DEFAULT_SHORTCUTS,
    )).toBeNull();
    expect(shortcutLabel({ ...DEFAULT_SHORTCUTS.faster, shift: true })).toBe('Shift+D');
    expect(actionForKeyboardEvent(
      { code: 'KeyT', altKey: false, ctrlKey: false, metaKey: false, shiftKey: false },
      DEFAULT_SHORTCUTS,
    )).toBe('theater');
  });

  it('lets custom commands override defaults and carry a per-key value', () => {
    expect(commandForKeyboardEvent(
      { code: 'KeyD', altKey: false, ctrlKey: false, metaKey: false, shiftKey: false },
      {
        shortcuts: DEFAULT_SHORTCUTS,
        customShortcuts: [{
          id: 'preferred-two',
          action: 'preferred',
          enabled: true,
          code: 'KeyD',
          alt: false,
          ctrl: false,
          meta: false,
          shift: false,
          value: 2,
        }],
      },
    )).toEqual({ action: 'preferred', value: 2 });
  });

  it('ignores editable controls and contenteditable descendants', () => {
    const input = document.createElement('input');
    const editor = document.createElement('div');
    editor.setAttribute('contenteditable', 'true');
    const child = document.createElement('span');
    editor.append(child);
    document.body.append(input, editor);

    expect(isEditableTarget(input)).toBe(true);
    expect(isEditableTarget(child)).toBe(true);
    expect(isEditableTarget(document.body)).toBe(false);
  });

  it('uses site rule, then remembered speed, then preferred speed', () => {
    const rule: SiteMediaRule = {
      enabled: true,
      defaultSpeed: 1.75,
      updatedAt: 1,
    };
    const remembered: SitePlaybackState = { speed: 1.4, updatedAt: 2 };
    expect(resolveSiteSpeed(1.25, rule, remembered, true)).toBe(1.75);
    expect(resolveSiteSpeed(1.25, null, remembered, true)).toBe(1.4);
    expect(resolveSiteSpeed(1.25, null, remembered, false)).toBe(1.25);
  });

  it('prefers playing media, then the last interacted media', () => {
    const first = document.createElement('video');
    const second = document.createElement('video');
    document.body.append(first, second);
    Object.defineProperties(first, {
      paused: { configurable: true, value: true },
      ended: { configurable: true, value: false },
      readyState: { configurable: true, value: 1 },
    });
    Object.defineProperties(second, {
      paused: { configurable: true, value: false },
      ended: { configurable: true, value: false },
      readyState: { configurable: true, value: 1 },
    });

    expect(selectMedia([first, second], first)).toBe(second);
    Object.defineProperty(second, 'paused', { configurable: true, value: true });
    expect(selectMedia([first, second], first)).toBe(first);
  });

  it('ships universal controller copy for every supported locale', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(ut(locale, 'title').trim()).not.toBe('');
      expect(ut(locale, 'enable').trim()).not.toBe('');
      expect(ut(locale, 'faster').trim()).not.toBe('');
      expect(ut(locale, 'advanced').trim()).not.toBe('');
      expect(ut(locale, 'exportSettings').trim()).not.toBe('');
      expect(ut(locale, 'downloadMedia').trim()).not.toBe('');
    }
  });

  it('offers only direct non-DRM media URLs for download', () => {
    const direct = document.createElement('video');
    direct.src = 'https://cdn.example.test/video/final.mp4?token=local';
    expect(mediaDownloadInfo(direct, 'Lesson: 1 / Intro')).toEqual({
      available: true,
      url: 'https://cdn.example.test/video/final.mp4?token=local',
      filename: 'Lesson 1 Intro.mp4',
    });

    const blob = document.createElement('video');
    blob.src = 'blob:https://example.test/media-id';
    expect(mediaDownloadInfo(blob).reason).toBe('blobMedia');

    const adaptive = document.createElement('video');
    adaptive.src = 'https://cdn.example.test/live/master.m3u8';
    expect(mediaDownloadInfo(adaptive).reason).toBe('adaptiveStream');

    Object.defineProperty(direct, 'mediaKeys', {
      configurable: true,
      value: {},
    });
    expect(mediaDownloadInfo(direct).reason).toBe('drmProtected');
    expect(sanitizeDownloadFilename('../bad:name?.mp4')).toBe('bad name .mp4');
  });
});
