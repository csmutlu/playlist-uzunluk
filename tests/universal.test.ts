import { describe, expect, it } from 'vitest';
import { DEFAULT_SHORTCUTS } from '../lib/constants';
import { handlerFor } from '../lib/site-handlers';
import { SUPPORTED_LOCALES, type SiteMediaRule, type SitePlaybackState } from '../lib/types';
import {
  actionForKeyboardEvent,
  advanceLoop,
  classifyExternalRate,
  clampUniversalSpeed,
  commandForKeyboardEvent,
  frameStepSeconds,
  isEditableTarget,
  isWheelSpeedGesture,
  loopSeekTarget,
  mediaDownloadInfo,
  resolveSiteSpeed,
  roundSpeed,
  selectMedia,
  shortcutLabel,
  sanitizeDownloadFilename,
  stepUniversalSpeed,
} from '../lib/universal';
import { ut } from '../lib/universal-i18n';

describe('universal speed helpers', () => {
  it.each([
    ['no evidence', 1, {}, 'autonomous'],
    ['fresh key', 1, { lastKeyIntentAt: 10_000 }, 'intent'],
    ['stale key', 1.5, { lastKeyIntentAt: 8_800 }, 'autonomous'],
    ['one click to normal', 1, { lastClickAt: 9_950 }, 'autonomous'],
    ['one click to non-normal', 1.75, { lastClickAt: 9_950, lastPointerEndAt: 9_950 }, 'intent'],
    ['click sequence to normal', 1, { prevClickAt: 8_750, lastClickAt: 9_950 }, 'intent'],
    ['stale click sequence', 1, { prevClickAt: 3_950, lastClickAt: 9_950 }, 'autonomous'],
    ['steady hold', 2, { pressStartedAt: 9_500 }, 'temporary'],
    ['short hold', 1, { pressStartedAt: 9_900 }, 'autonomous'],
    ['key beats hold', 2, { pressStartedAt: 9_500, lastKeyIntentAt: 10_000 }, 'intent'],
    ['moved hold', 2, { pressStartedAt: 9_500, pressSteady: false }, 'intent'],
    ['pointer end to normal', 1, { lastPointerEndAt: 9_800 }, 'autonomous'],
    ['pointer end to non-normal', 2, { lastPointerEndAt: 9_800 }, 'intent'],
    ['future click is stale', 1, { lastClickAt: 10_050 }, 'autonomous'],
  ] as const)('classifies %s rate changes', (_name, rate, partial, expected) => {
    expect(classifyExternalRate(rate, {
      now: 10_000,
      lastKeyIntentAt: Number.NEGATIVE_INFINITY,
      lastClickAt: Number.NEGATIVE_INFINITY,
      prevClickAt: Number.NEGATIVE_INFINITY,
      lastPointerEndAt: Number.NEGATIVE_INFINITY,
      pressStartedAt: null,
      pressSteady: true,
      ...partial,
    })).toBe(expected);
  });

  it('rounds by the configured step and clamps the supported range', () => {
    expect(roundSpeed(1.56, 0.1)).toBe(1.6);
    expect(roundSpeed(1.54, 0.05)).toBe(1.55);
    expect(clampUniversalSpeed(0)).toBe(0.07);
    expect(clampUniversalSpeed(30)).toBe(16);
    expect(stepUniversalSpeed(0.95, 0.1, 0.1)).toBe(1);
    expect(stepUniversalSpeed(1.05, -0.1, 0.1)).toBe(1);
  });

  it('filters small touchpad deltas but accepts Firefox line-mode wheel ticks', () => {
    expect(isWheelSpeedGesture({ deltaMode: 0, deltaY: 3, ctrlKey: false })).toBe(false);
    expect(isWheelSpeedGesture({ deltaMode: 0, deltaY: 60, ctrlKey: false })).toBe(true);
    expect(isWheelSpeedGesture({ deltaMode: 1, deltaY: 3, ctrlKey: false })).toBe(true);
    expect(isWheelSpeedGesture({ deltaMode: 2, deltaY: 1, ctrlKey: false })).toBe(true);
    expect(isWheelSpeedGesture({ deltaMode: 1, deltaY: 3, ctrlKey: true })).toBe(false);
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
    expect(actionForKeyboardEvent(
      {
        code: 'Unidentified',
        keyCode: 68,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
      },
      DEFAULT_SHORTCUTS,
    )).toBe('faster');
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

  it('ignores muted looping videos without controls when selecting media', () => {
    const decorative = document.createElement('video');
    decorative.loop = true;
    decorative.muted = true;
    decorative.controls = false;
    const normal = document.createElement('video');
    document.body.append(decorative, normal);

    expect(selectMedia([decorative, normal])).toBe(normal);
    expect(selectMedia([decorative])).toBeNull();
  });

  it('selects YouTube and Netflix handlers without leaking to unrelated hosts', () => {
    expect(handlerFor('www.youtube.com')?.ownsPlainTheaterKey).toBe(true);
    expect(handlerFor('www.youtube-nocookie.com')?.ownsPlainTheaterKey).toBe(true);
    expect(handlerFor('music.youtube.com')).toBeNull();
    expect(handlerFor('www.netflix.com')?.seek).toBeTypeOf('function');
    expect(handlerFor('example.com')).toBeNull();
  });

  it('ships universal controller copy for every supported locale', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(ut(locale, 'title').trim()).not.toBe('');
      expect(ut(locale, 'enable').trim()).not.toBe('');
      expect(ut(locale, 'faster').trim()).not.toBe('');
      expect(ut(locale, 'advanced').trim()).not.toBe('');
      expect(ut(locale, 'exportSettings').trim()).not.toBe('');
      expect(ut(locale, 'downloadMedia').trim()).not.toBe('');
      expect(ut(locale, 'flashIndicator').trim()).not.toBe('');
      expect(ut(locale, 'customCssTruncated').trim()).not.toBe('');
      expect(ut(locale, 'masterVolume').trim()).not.toBe('');
      expect(ut(locale, 'muted').trim()).not.toBe('');
      expect(ut(locale, 'volumeBoostUnavailable').trim()).not.toBe('');
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

  it('cycles the A→B loop through mark, range and clear', () => {
    const a = advanceLoop(null, 12);
    expect(a).toEqual({ start: 12 });

    const range = advanceLoop(a, 30);
    expect(range).toEqual({ start: 12, end: 30 });

    expect(advanceLoop(range, 45)).toBeNull();
  });

  it('re-arms the loop start instead of creating an inverted range', () => {
    expect(advanceLoop({ start: 40 }, 10)).toEqual({ start: 10 });
    expect(advanceLoop({ start: 40 }, 40.01)).toEqual({ start: 40.01 });
    expect(advanceLoop(null, Number.NaN)).toBeNull();
  });

  it('seeks back only once playback leaves an armed loop', () => {
    const range = { start: 12, end: 30 };
    expect(loopSeekTarget(range, 20)).toBeNull();
    expect(loopSeekTarget(range, 30.2)).toBe(12);
    expect(loopSeekTarget(range, 4)).toBe(12);
    expect(loopSeekTarget({ start: 12 }, 99)).toBeNull();
    expect(loopSeekTarget(null, 99)).toBeNull();
  });

  it('derives a frame step from the configured frame rate', () => {
    expect(frameStepSeconds(25)).toBeCloseTo(0.04, 5);
    expect(frameStepSeconds(60)).toBeCloseTo(1 / 60, 5);
    expect(frameStepSeconds(0)).toBeCloseTo(1 / 30, 5);
    expect(frameStepSeconds(Number.NaN)).toBeCloseTo(1 / 30, 5);
    expect(frameStepSeconds(10_000)).toBeCloseTo(1 / 240, 5);
  });
});
