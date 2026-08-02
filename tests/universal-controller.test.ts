import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SETTINGS,
  DEFAULT_UNIVERSAL_SETTINGS,
} from '../lib/constants';
import { UniversalMediaController } from '../lib/universal-controller';
import type { CustomShortcutAction, CustomShortcutBinding } from '../lib/types';

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

async function settleDiscovery(): Promise<void> {
  await vi.runOnlyPendingTimersAsync();
  await Promise.resolve();
}

function seekableVideo(duration: number): HTMLVideoElement {
  const video = document.createElement('video');
  Object.defineProperties(video, {
    currentTime: { configurable: true, writable: true, value: 0 },
    duration: { configurable: true, value: duration },
    seekable: { configurable: true, value: { length: 1, start: () => 0, end: () => duration } },
    readyState: { configurable: true, value: HTMLMediaElement.HAVE_ENOUGH_DATA },
  });
  return video;
}

function customShortcut(
  action: CustomShortcutAction,
  code: string,
  value?: number,
): CustomShortcutBinding {
  return {
    id: `${action}-${code}`,
    action,
    enabled: true,
    code,
    alt: false,
    ctrl: false,
    meta: false,
    shift: false,
    ...(value === undefined ? {} : { value }),
  };
}

function pointer(target: EventTarget, type: 'pointerdown' | 'pointermove' | 'pointerup'): void {
  target.dispatchEvent(new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: type === 'pointermove' ? 30 : 5,
    clientY: 5,
  }));
}

describe('UniversalMediaController', () => {
  it('applies the preferred speed and handles S/D/R without polling', async () => {
    const video = document.createElement('video');
    document.body.append(video);
    const saveSpeed = vi.fn(async () => undefined);
    const controller = new UniversalMediaController({
      channel: 'test',
      hostname: 'example.com',
      settings: { ...DEFAULT_UNIVERSAL_SETTINGS, enabled: true },
      extensionSettings: { ...DEFAULT_SETTINGS, defaultSpeed: 1.5 },
      rule: null,
      rememberedSpeed: null,
      saveSpeed,
    });

    controller.start();
    await settleDiscovery();
    expect(video.playbackRate).toBe(1.5);

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD' }));
    expect(video.playbackRate).toBe(1.6);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyS' }));
    expect(video.playbackRate).toBe(1.5);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyR' }));
    expect(video.playbackRate).toBe(1);

    await vi.advanceTimersByTimeAsync(800);
    expect(saveSpeed).toHaveBeenLastCalledWith(1);
    controller.dispose();
  });

  it('does not consume shortcuts while an input is focused', async () => {
    const video = document.createElement('video');
    const input = document.createElement('input');
    document.body.append(video, input);
    const controller = new UniversalMediaController({
      channel: 'editing',
      hostname: 'example.com',
      settings: { ...DEFAULT_UNIVERSAL_SETTINGS, enabled: true },
      extensionSettings: DEFAULT_SETTINGS,
      rule: null,
      rememberedSpeed: null,
      saveSpeed: async () => undefined,
    });
    controller.start();
    await settleDiscovery();

    input.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD', bubbles: true }));
    expect(video.playbackRate).toBe(1);
    controller.dispose();
  });

  it('discovers dynamically added media from mutation batches', async () => {
    const controller = new UniversalMediaController({
      channel: 'dynamic',
      hostname: 'example.com',
      settings: { ...DEFAULT_UNIVERSAL_SETTINGS, enabled: true },
      extensionSettings: { ...DEFAULT_SETTINGS, defaultSpeed: 1.75 },
      rule: null,
      rememberedSpeed: null,
      saveSpeed: async () => undefined,
    });
    controller.start();
    await settleDiscovery();

    const video = document.createElement('video');
    document.body.append(video);
    await vi.advanceTimersByTimeAsync(150);
    await settleDiscovery();
    expect(video.playbackRate).toBe(1.75);
    controller.dispose();
  });

  it('does not let bridge reset reports corrupt consecutive D/S calculations', async () => {
    const video = document.createElement('video');
    document.body.append(video);
    const controller = new UniversalMediaController({
      channel: 'bridge-sync',
      hostname: 'tabii.com',
      settings: { ...DEFAULT_UNIVERSAL_SETTINGS, enabled: true },
      extensionSettings: DEFAULT_SETTINGS,
      rule: null,
      rememberedSpeed: null,
      saveSpeed: async () => undefined,
    });
    controller.start();
    await settleDiscovery();

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD' }));
    document.dispatchEvent(new CustomEvent('playlist-zamani:state:bridge-sync', {
      detail: { kind: 'media', rate: 1, mediaType: 'video' },
    }));
    expect(controller.siteInfo().speed).toBe(1.1);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD' }));
    expect(video.playbackRate).toBe(1.2);

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyS' }));
    expect(video.playbackRate).toBe(1.1);
    controller.dispose();
  });

  it('repeats D/S while held, stops on keyup and clamps at 16x and 0.07x', async () => {
    const video = document.createElement('video');
    document.body.append(video);
    const controller = new UniversalMediaController({
      channel: 'held-keys',
      hostname: 'example.com',
      settings: { ...DEFAULT_UNIVERSAL_SETTINGS, enabled: true },
      extensionSettings: DEFAULT_SETTINGS,
      rule: null,
      rememberedSpeed: null,
      saveSpeed: async () => undefined,
    });
    controller.start();
    await settleDiscovery();

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD' }));
    await vi.advanceTimersByTimeAsync(500);
    const heldSpeed = video.playbackRate;
    expect(heldSpeed).toBeGreaterThan(1.1);
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyD' }));
    await vi.advanceTimersByTimeAsync(500);
    expect(video.playbackRate).toBe(heldSpeed);

    for (let index = 0; index < 200; index += 1) {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD' }));
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyD' }));
    }
    expect(video.playbackRate).toBe(16);

    for (let index = 0; index < 200; index += 1) {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyS' }));
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyS' }));
    }
    expect(video.playbackRate).toBe(0.07);
    controller.dispose();
  });

  it('temporarily uses 1x to rebuild a VOD buffer without changing currentTime', async () => {
    const video = document.createElement('video');
    let bufferedEnd = 31;
    Object.defineProperties(video, {
      currentTime: { configurable: true, writable: true, value: 30 },
      duration: { configurable: true, value: 120 },
      paused: { configurable: true, value: false },
      readyState: {
        configurable: true,
        value: HTMLMediaElement.HAVE_ENOUGH_DATA,
      },
      buffered: {
        configurable: true,
        value: {
          get length() {
            return 1;
          },
          start: () => 0,
          end: () => bufferedEnd,
        },
      },
    });
    document.body.append(video);
    const controller = new UniversalMediaController({
      channel: 'buffer-recovery',
      hostname: 'example.com',
      settings: { ...DEFAULT_UNIVERSAL_SETTINGS, enabled: true },
      extensionSettings: { ...DEFAULT_SETTINGS, defaultSpeed: 1.5 },
      rule: null,
      rememberedSpeed: null,
      saveSpeed: async () => undefined,
    });
    controller.start();
    await settleDiscovery();
    expect(video.playbackRate).toBe(1.5);

    video.dispatchEvent(new Event('waiting'));
    expect(video.playbackRate).toBe(1);
    expect(video.currentTime).toBe(30);
    expect(controller.siteInfo().speed).toBe(1.5);

    bufferedEnd = 40;
    video.dispatchEvent(new Event('progress'));
    expect(video.playbackRate).toBe(1.5);
    expect(video.currentTime).toBe(30);
    controller.dispose();
  });

  it('does not drop to 1x when the decoder stalls on a full buffer', async () => {
    const video = document.createElement('video');
    Object.defineProperties(video, {
      currentTime: { configurable: true, writable: true, value: 10 },
      duration: { configurable: true, value: 600 },
      paused: { configurable: true, value: false },
      readyState: { configurable: true, value: HTMLMediaElement.HAVE_ENOUGH_DATA },
      buffered: {
        configurable: true,
        // 90 seconds are ready ahead: the network is not the bottleneck.
        value: { length: 1, start: () => 0, end: () => 100 },
      },
    });
    document.body.append(video);
    const controller = new UniversalMediaController({
      channel: 'decoder-stall',
      hostname: 'example.com',
      settings: { ...DEFAULT_UNIVERSAL_SETTINGS, enabled: true },
      extensionSettings: { ...DEFAULT_SETTINGS, defaultSpeed: 16 },
      rule: null,
      rememberedSpeed: null,
      saveSpeed: async () => undefined,
    });
    controller.start();
    await settleDiscovery();
    expect(video.playbackRate).toBe(16);

    video.dispatchEvent(new Event('waiting'));
    expect(video.playbackRate).toBe(16);
    video.dispatchEvent(new Event('stalled'));
    expect(video.playbackRate).toBe(16);
    controller.dispose();
  });

  it('does not apply VOD buffer recovery to live streams', async () => {
    const video = document.createElement('video');
    Object.defineProperties(video, {
      duration: { configurable: true, value: Number.POSITIVE_INFINITY },
      paused: { configurable: true, value: false },
    });
    document.body.append(video);
    const controller = new UniversalMediaController({
      channel: 'live-buffer',
      hostname: 'example.com',
      settings: { ...DEFAULT_UNIVERSAL_SETTINGS, enabled: true },
      extensionSettings: { ...DEFAULT_SETTINGS, defaultSpeed: 1.5 },
      rule: null,
      rememberedSpeed: null,
      saveSpeed: async () => undefined,
    });
    controller.start();
    await settleDiscovery();

    video.dispatchEvent(new Event('waiting'));
    expect(video.playbackRate).toBe(1.5);
    controller.dispose();
  });

  it('keeps flash mode dimmed and interactive instead of removing the overlay', async () => {
    const video = document.createElement('video');
    video.style.cssText = 'display:block;width:640px;height:360px';
    document.body.append(video);
    const controller = new UniversalMediaController({
      channel: 'dim-overlay',
      hostname: 'example.com',
      settings: { ...DEFAULT_UNIVERSAL_SETTINGS, enabled: true },
      extensionSettings: DEFAULT_SETTINGS,
      rule: null,
      rememberedSpeed: null,
      saveSpeed: async () => undefined,
    });
    controller.start();
    await settleDiscovery();

    const overlay = document.querySelector('playlist-zamani-speed') as HTMLElement;
    expect(overlay).toBeTruthy();
    expect(Number(overlay.style.opacity)).toBeGreaterThan(0);
    expect(Number(overlay.style.opacity)).toBeLessThan(1);
    expect(overlay.style.pointerEvents).toBe('auto');

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD' }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyD' }));
    expect(overlay.style.opacity).toBe('1');
    await vi.advanceTimersByTimeAsync(1_300);
    expect(Number(overlay.style.opacity)).toBeGreaterThan(0);
    expect(Number(overlay.style.opacity)).toBeLessThan(1);
    expect(overlay.style.pointerEvents).toBe('auto');
    controller.dispose();
  });

  it('toggles window theater mode with T and restores page styles exactly', async () => {
    const player = document.createElement('div');
    player.className = 'video-player';
    player.style.position = 'relative';
    player.style.width = '640px';
    const video = document.createElement('video');
    video.style.objectFit = 'cover';
    player.append(video);
    const videoRect = {
      width: 640,
      height: 360,
    } as DOMRect;
    vi.spyOn(video, 'getBoundingClientRect').mockReturnValue(videoRect);
    vi.spyOn(player, 'getBoundingClientRect').mockReturnValue(videoRect);
    document.body.style.overflow = 'auto';
    document.body.append(player);
    const controller = new UniversalMediaController({
      channel: 'theater',
      hostname: 'example.com',
      settings: { ...DEFAULT_UNIVERSAL_SETTINGS, enabled: true },
      extensionSettings: DEFAULT_SETTINGS,
      rule: null,
      rememberedSpeed: null,
      saveSpeed: async () => undefined,
    });
    controller.start();
    await settleDiscovery();

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyT' }));
    expect(player.style.getPropertyValue('position')).toBe('fixed');
    expect(player.style.getPropertyPriority('position')).toBe('important');
    expect(player.style.getPropertyValue('width')).toBe('100vw');
    expect(video.style.getPropertyValue('object-fit')).toBe('contain');
    expect(document.body.style.getPropertyValue('overflow')).toBe('hidden');

    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyT' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyT' }));
    expect(player.style.position).toBe('relative');
    expect(player.style.width).toBe('640px');
    expect(video.style.objectFit).toBe('cover');
    expect(document.body.style.overflow).toBe('auto');
    controller.dispose();
  });

  it('leaves plain T to YouTube and allows a rebound extension theater key', async () => {
    const player = document.createElement('div');
    player.style.position = 'relative';
    const video = document.createElement('video');
    player.append(video);
    const videoRect = { width: 640, height: 360 } as DOMRect;
    vi.spyOn(video, 'getBoundingClientRect').mockReturnValue(videoRect);
    vi.spyOn(player, 'getBoundingClientRect').mockReturnValue(videoRect);
    document.body.append(player);
    const controller = new UniversalMediaController({
      channel: 'youtube-theater',
      hostname: 'www.youtube.com',
      settings: { ...DEFAULT_UNIVERSAL_SETTINGS, enabled: true },
      extensionSettings: DEFAULT_SETTINGS,
      rule: null,
      rememberedSpeed: null,
      saveSpeed: async () => undefined,
    });
    controller.start();
    await settleDiscovery();

    const nativeEvent = new KeyboardEvent('keydown', {
      code: 'KeyT',
      cancelable: true,
    });
    window.dispatchEvent(nativeEvent);
    expect(nativeEvent.defaultPrevented).toBe(false);
    expect(player.style.position).toBe('relative');

    controller.update(
      {
        ...DEFAULT_UNIVERSAL_SETTINGS,
        enabled: true,
        shortcuts: {
          ...DEFAULT_UNIVERSAL_SETTINGS.shortcuts,
          theater: {
            ...DEFAULT_UNIVERSAL_SETTINGS.shortcuts.theater,
            code: 'KeyY',
          },
        },
      },
      DEFAULT_SETTINGS,
      null,
      null,
    );
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyY' }));
    expect(player.style.getPropertyValue('position')).toBe('fixed');
    controller.dispose();
  });

  it('leaves plain T to youtube-nocookie embeds', async () => {
    const video = document.createElement('video');
    document.body.append(video);
    const controller = new UniversalMediaController({
      channel: 'youtube-nocookie-theater',
      hostname: 'www.youtube-nocookie.com',
      settings: { ...DEFAULT_UNIVERSAL_SETTINGS, enabled: true },
      extensionSettings: DEFAULT_SETTINGS,
      rule: null,
      rememberedSpeed: null,
      saveSpeed: async () => undefined,
    });
    controller.start();
    await settleDiscovery();

    const event = new KeyboardEvent('keydown', { code: 'KeyT', cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    controller.dispose();
  });

  it('promotes a focused cross-frame player and restores it on the relayed exit', async () => {
    const backgroundVideo = document.createElement('video');
    const frame = document.createElement('iframe');
    frame.style.width = '560px';
    document.body.append(backgroundVideo, frame);
    frame.focus();
    const controller = new UniversalMediaController({
      channel: 'frame-theater',
      hostname: 'example.com',
      settings: { ...DEFAULT_UNIVERSAL_SETTINGS, enabled: true },
      extensionSettings: DEFAULT_SETTINGS,
      rule: null,
      rememberedSpeed: null,
      saveSpeed: async () => undefined,
    });
    controller.start();
    await settleDiscovery();

    window.dispatchEvent(new MessageEvent('message', {
      source: frame.contentWindow,
      data: { type: 'pz:t', action: 'enter' },
    }));
    expect(frame.style.getPropertyValue('position')).toBe('fixed');
    expect(frame.style.getPropertyValue('width')).toBe('100vw');
    const parentIndicator = document.querySelector('playlist-zamani-speed') as HTMLElement;
    expect(parentIndicator.style.opacity).toBe('0');
    controller.adjustSpeed(0.1);
    expect(parentIndicator.style.opacity).toBe('0');

    window.dispatchEvent(new MessageEvent('message', {
      source: frame.contentWindow,
      data: { type: 'pz:t', action: 'exit' },
    }));
    expect(frame.style.position).toBe('');
    expect(frame.style.width).toBe('560px');
    controller.dispose();
  });

  it('keeps a speed the site changed from its own keyboard shortcut', async () => {
    const video = document.createElement('video');
    document.body.append(video);
    const controller = new UniversalMediaController({
      channel: 'site-keys',
      hostname: 'example.com',
      settings: { ...DEFAULT_UNIVERSAL_SETTINGS, enabled: true, exclusiveKeys: false },
      extensionSettings: DEFAULT_SETTINGS,
      rule: null,
      rememberedSpeed: null,
      saveSpeed: async () => undefined,
    });
    controller.start();
    await settleDiscovery();

    // Our own change opens the protection window.
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD' }));
    // Let applyRate's microtask clear its re-entrancy guard before the site acts.
    await Promise.resolve();
    expect(video.playbackRate).toBe(1.1);

    // The user presses a key we do not own, and the site raises the speed --
    // exactly YouTube's `>` path. It must survive.
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Period', shiftKey: true }));
    video.playbackRate = 1.35;
    video.dispatchEvent(new Event('ratechange'));
    expect(video.playbackRate).toBe(1.35);
    expect(controller.siteInfo().speed).toBe(1.35);
    controller.dispose();
  });

  it('ignores IME composition keystrokes', async () => {
    const video = document.createElement('video');
    document.body.append(video);
    const controller = new UniversalMediaController({
      channel: 'ime',
      hostname: 'example.com',
      settings: { ...DEFAULT_UNIVERSAL_SETTINGS, enabled: true },
      extensionSettings: DEFAULT_SETTINGS,
      rule: null,
      rememberedSpeed: null,
      saveSpeed: async () => undefined,
    });
    controller.start();
    await settleDiscovery();

    window.dispatchEvent(new KeyboardEvent('keydown', {
      code: 'KeyD',
      key: 'Process',
      isComposing: true,
    }));
    expect(video.playbackRate).toBe(1);
    controller.dispose();
  });

  it('routes Netflix seek shortcuts through the MAIN-world bridge', async () => {
    const video = seekableVideo(120);
    document.body.append(video);
    const controls: Array<Record<string, unknown>> = [];
    video.addEventListener('playlist-zamani:control:netflix-seek', (event) => {
      controls.push((event as CustomEvent<Record<string, unknown>>).detail);
    });
    const controller = new UniversalMediaController({
      channel: 'netflix-seek',
      hostname: 'www.netflix.com',
      settings: { ...DEFAULT_UNIVERSAL_SETTINGS, enabled: true },
      extensionSettings: DEFAULT_SETTINGS,
      rule: null,
      rememberedSpeed: null,
      saveSpeed: async () => undefined,
    });
    controller.start();
    await settleDiscovery();

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyZ' }));
    expect(controls).toContainEqual(expect.objectContaining({
      action: 'netflixSeek',
      seconds: -10,
    }));
    expect(video.currentTime).toBe(0);
    controller.dispose();
  });

  it('ignores YouTube thumbnail and ad-layer videos when selecting a player', async () => {
    const ad = document.createElement('div');
    ad.className = 'ytp-ad-player-overlay';
    const adVideo = document.createElement('video');
    ad.append(adVideo);
    const thumbnail = document.createElement('video');
    thumbnail.className = 'video-thumbnail';
    const player = document.createElement('video');
    document.body.append(ad, thumbnail, player);
    const controller = new UniversalMediaController({
      channel: 'youtube-media-filter',
      hostname: 'www.youtube.com',
      settings: { ...DEFAULT_UNIVERSAL_SETTINGS, enabled: true },
      extensionSettings: { ...DEFAULT_SETTINGS, defaultSpeed: 1.5 },
      rule: null,
      rememberedSpeed: null,
      saveSpeed: async () => undefined,
    });
    controller.start();
    await settleDiscovery();

    expect(player.playbackRate).toBe(1.5);
    expect(adVideo.playbackRate).toBe(1);
    expect(thumbnail.playbackRate).toBe(1);
    controller.dispose();
  });

  it('flashes the indicator even when its normal mode is hidden', async () => {
    const video = document.createElement('video');
    document.body.append(video);
    const controller = new UniversalMediaController({
      channel: 'flash-indicator',
      hostname: 'example.com',
      settings: {
        ...DEFAULT_UNIVERSAL_SETTINGS,
        enabled: true,
        indicatorMode: 'hidden',
        customShortcuts: [customShortcut('flashIndicator', 'KeyB')],
      },
      extensionSettings: DEFAULT_SETTINGS,
      rule: null,
      rememberedSpeed: null,
      saveSpeed: async () => undefined,
    });
    controller.start();
    await settleDiscovery();
    expect(document.querySelector('playlist-zamani-speed')).toBeNull();

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyB' }));
    const overlay = document.querySelector('playlist-zamani-speed') as HTMLElement;
    expect(overlay.style.opacity).toBe('1');
    await vi.advanceTimersByTimeAsync(1_300);
    expect(overlay.style.opacity).toBe('0');
    controller.dispose();
  });

  it('rejects a single-click 1x side effect while speed lock is enabled', async () => {
    const video = document.createElement('video');
    document.body.append(video);
    const controller = new UniversalMediaController({
      channel: 'click-reset',
      hostname: 'example.com',
      settings: { ...DEFAULT_UNIVERSAL_SETTINGS, enabled: true, fightbackDefault: true },
      extensionSettings: { ...DEFAULT_SETTINGS, defaultSpeed: 1.5 },
      rule: null,
      rememberedSpeed: null,
      saveSpeed: async () => undefined,
    });
    controller.start();
    await settleDiscovery();

    pointer(video, 'pointerdown');
    pointer(video, 'pointerup');
    video.playbackRate = 1;
    video.dispatchEvent(new Event('ratechange'));

    expect(video.playbackRate).toBe(1.5);
    expect(controller.siteInfo().speed).toBe(1.5);
    controller.dispose();
  });

  it('accepts Normal from a two-click menu and non-normal from one click', async () => {
    const video = document.createElement('video');
    document.body.append(video);
    const controller = new UniversalMediaController({
      channel: 'menu-intent',
      hostname: 'example.com',
      settings: { ...DEFAULT_UNIVERSAL_SETTINGS, enabled: true, fightbackDefault: true },
      extensionSettings: { ...DEFAULT_SETTINGS, defaultSpeed: 1.5 },
      rule: null,
      rememberedSpeed: null,
      saveSpeed: async () => undefined,
    });
    controller.start();
    await settleDiscovery();

    pointer(document.body, 'pointerdown');
    pointer(document.body, 'pointerup');
    await vi.advanceTimersByTimeAsync(1_200);
    pointer(video, 'pointerdown');
    pointer(video, 'pointerup');
    video.playbackRate = 1;
    video.dispatchEvent(new Event('ratechange'));
    expect(controller.siteInfo().speed).toBe(1);

    pointer(video, 'pointerdown');
    pointer(video, 'pointerup');
    video.playbackRate = 1.75;
    video.dispatchEvent(new Event('ratechange'));
    expect(controller.siteInfo().speed).toBe(1.75);
    controller.dispose();
  });

  it('honors a held-pointer boost temporarily and restores without saving it', async () => {
    const video = document.createElement('video');
    document.body.append(video);
    const saveSpeed = vi.fn(async () => undefined);
    const controller = new UniversalMediaController({
      channel: 'hold-boost',
      hostname: 'example.com',
      settings: {
        ...DEFAULT_UNIVERSAL_SETTINGS,
        enabled: true,
        fightbackDefault: true,
        rememberPerSite: true,
      },
      extensionSettings: { ...DEFAULT_SETTINGS, defaultSpeed: 1.5 },
      rule: null,
      rememberedSpeed: null,
      saveSpeed,
    });
    controller.start();
    await settleDiscovery();

    pointer(video, 'pointerdown');
    await vi.advanceTimersByTimeAsync(500);
    video.playbackRate = 2;
    video.dispatchEvent(new Event('ratechange'));
    expect(video.playbackRate).toBe(2);
    expect(controller.siteInfo().speed).toBe(1.5);

    pointer(video, 'pointerup');
    expect(video.playbackRate).toBe(1.5);
    await Promise.resolve();
    video.playbackRate = 1;
    video.dispatchEvent(new Event('ratechange'));
    expect(video.playbackRate).toBe(1.5);
    await vi.advanceTimersByTimeAsync(800);
    expect(saveSpeed).not.toHaveBeenCalledWith(2);
    controller.dispose();
  });

  it('restores a bridge-scoped hold boost on pointer release', async () => {
    const controls: Array<Record<string, unknown>> = [];
    document.addEventListener('playlist-zamani:control:bridge-boost', (event) => {
      controls.push((event as CustomEvent<Record<string, unknown>>).detail);
    });
    const controller = new UniversalMediaController({
      channel: 'bridge-boost',
      hostname: 'example.com',
      settings: { ...DEFAULT_UNIVERSAL_SETTINGS, enabled: true },
      extensionSettings: { ...DEFAULT_SETTINGS, defaultSpeed: 1.5 },
      rule: null,
      rememberedSpeed: null,
      saveSpeed: async () => undefined,
    });
    controller.start();
    await settleDiscovery();

    pointer(document.body, 'pointerdown');
    await vi.advanceTimersByTimeAsync(500);
    document.dispatchEvent(new CustomEvent('playlist-zamani:state:bridge-boost', {
      detail: { kind: 'media', rate: 2, mediaType: 'video' },
    }));
    expect(controller.siteInfo().speed).toBe(1.5);
    pointer(document.body, 'pointerup');

    expect(controls).toContainEqual(expect.objectContaining({ action: 'rate', rate: 1.5 }));
    controller.dispose();
  });

  it('treats a dragged speed slider as lasting intent and ignores overlay gestures', async () => {
    const video = document.createElement('video');
    document.body.append(video);
    const controller = new UniversalMediaController({
      channel: 'slider-intent',
      hostname: 'example.com',
      settings: { ...DEFAULT_UNIVERSAL_SETTINGS, enabled: true, fightbackDefault: true },
      extensionSettings: { ...DEFAULT_SETTINGS, defaultSpeed: 1.5 },
      rule: null,
      rememberedSpeed: null,
      saveSpeed: async () => undefined,
    });
    controller.start();
    await settleDiscovery();

    pointer(video, 'pointerdown');
    await vi.advanceTimersByTimeAsync(500);
    pointer(video, 'pointermove');
    video.playbackRate = 2;
    video.dispatchEvent(new Event('ratechange'));
    expect(controller.siteInfo().speed).toBe(2);
    pointer(video, 'pointerup');

    controller.setSpeed(1.5);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(301);
    const overlay = document.querySelector('playlist-zamani-speed')!;
    pointer(overlay, 'pointerdown');
    video.playbackRate = 1.75;
    video.dispatchEvent(new Event('ratechange'));
    expect(video.playbackRate).toBe(1.5);
    controller.dispose();
  });

  it('leaves a site shortcut alone when only the modifier differs from ours', async () => {
    const video = seekableVideo(120);
    document.body.append(video);
    const controller = new UniversalMediaController({
      channel: 'modifier-split',
      hostname: 'youtube.com',
      settings: {
        ...DEFAULT_UNIVERSAL_SETTINGS,
        enabled: true,
        exclusiveKeys: true,
        // The worst case: our frame stepping sits on the very keys YouTube uses
        // for speed, which are Comma/Period on every layout including Turkish.
        customShortcuts: [
          customShortcut('frameForward', 'Period', 25),
          customShortcut('frameBack', 'Comma', 25),
        ],
      },
      extensionSettings: DEFAULT_SETTINGS,
      rule: null,
      rememberedSpeed: null,
      saveSpeed: async () => undefined,
    });
    controller.start();
    await settleDiscovery();

    // Plain Period is ours: consumed, and the site must not see it.
    video.currentTime = 10;
    const plain = new KeyboardEvent('keydown', { code: 'Period', cancelable: true });
    window.dispatchEvent(plain);
    expect(video.currentTime).toBeCloseTo(10.04, 5);
    expect(plain.defaultPrevented).toBe(true);

    // Shift+Period is YouTube's: never consumed, so it reaches the page.
    const shifted = new KeyboardEvent('keydown', {
      code: 'Period',
      shiftKey: true,
      cancelable: true,
    });
    window.dispatchEvent(shifted);
    expect(shifted.defaultPrevented).toBe(false);
    expect(video.currentTime).toBeCloseTo(10.04, 5);
    controller.dispose();
  });

  it('still undoes a silent reset that no key or pointer preceded', async () => {
    const video = document.createElement('video');
    document.body.append(video);
    const controller = new UniversalMediaController({
      channel: 'silent-reset',
      hostname: 'example.com',
      settings: { ...DEFAULT_UNIVERSAL_SETTINGS, enabled: true, fightbackDefault: true },
      extensionSettings: DEFAULT_SETTINGS,
      rule: null,
      rememberedSpeed: null,
      saveSpeed: async () => undefined,
    });
    controller.start();
    await settleDiscovery();

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD' }));
    await Promise.resolve();
    expect(video.playbackRate).toBe(1.1);

    // The player resets itself with no user input at all.
    video.playbackRate = 1;
    video.dispatchEvent(new Event('ratechange'));
    expect(video.playbackRate).toBe(1.1);
    controller.dispose();
  });

  it('loops between A and B and releases the media when cleared', async () => {
    const video = seekableVideo(120);
    document.body.append(video);
    const controller = new UniversalMediaController({
      channel: 'loop',
      hostname: 'example.com',
      settings: {
        ...DEFAULT_UNIVERSAL_SETTINGS,
        enabled: true,
        customShortcuts: [customShortcut('loop', 'KeyL')],
      },
      extensionSettings: DEFAULT_SETTINGS,
      rule: null,
      rememberedSpeed: null,
      saveSpeed: async () => undefined,
    });
    controller.start();
    await settleDiscovery();

    video.currentTime = 10;
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyL' }));
    video.currentTime = 25;
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyL' }));

    video.currentTime = 20;
    video.dispatchEvent(new Event('timeupdate'));
    expect(video.currentTime).toBe(20);

    video.currentTime = 26;
    video.dispatchEvent(new Event('timeupdate'));
    expect(video.currentTime).toBe(10);

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyL' }));
    video.currentTime = 40;
    video.dispatchEvent(new Event('timeupdate'));
    expect(video.currentTime).toBe(40);
    controller.dispose();
  });

  it('steps frames on a paused video and keeps playback stopped', async () => {
    const video = seekableVideo(120);
    document.body.append(video);
    const pause = vi.fn(() => {
      Object.defineProperty(video, 'paused', { configurable: true, value: true });
    });
    video.pause = pause;
    Object.defineProperty(video, 'paused', { configurable: true, value: false });
    const controller = new UniversalMediaController({
      channel: 'frames',
      hostname: 'example.com',
      settings: {
        ...DEFAULT_UNIVERSAL_SETTINGS,
        enabled: true,
        customShortcuts: [
          customShortcut('frameForward', 'Period', 25),
          customShortcut('frameBack', 'Comma', 25),
        ],
      },
      extensionSettings: DEFAULT_SETTINGS,
      rule: null,
      rememberedSpeed: null,
      saveSpeed: async () => undefined,
    });
    controller.start();
    await settleDiscovery();

    video.currentTime = 10;
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Period' }));
    expect(pause).toHaveBeenCalledTimes(1);
    expect(video.currentTime).toBeCloseTo(10.04, 5);

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Comma' }));
    expect(video.currentTime).toBeCloseTo(10, 5);
    controller.dispose();
  });

  it('keeps the original pitch unless the setting is turned off', async () => {
    const video = document.createElement('video');
    // jsdom omits preservesPitch, so mirror what every supported browser exposes.
    Object.defineProperty(video, 'preservesPitch', {
      configurable: true,
      writable: true,
      value: false,
    });
    document.body.append(video);
    const controller = new UniversalMediaController({
      channel: 'pitch',
      hostname: 'example.com',
      settings: { ...DEFAULT_UNIVERSAL_SETTINGS, enabled: true },
      extensionSettings: { ...DEFAULT_SETTINGS, defaultSpeed: 2 },
      rule: null,
      rememberedSpeed: null,
      saveSpeed: async () => undefined,
    });
    controller.start();
    await settleDiscovery();
    expect(video.preservesPitch).toBe(true);

    controller.update(
      { ...DEFAULT_UNIVERSAL_SETTINGS, enabled: true, preservePitch: false },
      { ...DEFAULT_SETTINGS, defaultSpeed: 1.5 },
      null,
      null,
    );
    expect(video.preservesPitch).toBe(false);
    controller.dispose();
  });

  it('controls native master volume and mute without a page bridge', async () => {
    const video = document.createElement('video');
    document.body.append(video);
    const controller = new UniversalMediaController({
      channel: 'native-volume',
      hostname: 'example.com',
      settings: { ...DEFAULT_UNIVERSAL_SETTINGS, enabled: true },
      extensionSettings: DEFAULT_SETTINGS,
      rule: null,
      rememberedSpeed: null,
      saveSpeed: async () => undefined,
    });
    controller.start();
    await settleDiscovery();

    await expect(controller.setMasterVolume(40)).resolves.toMatchObject({
      mediaFound: true,
      percent: 40,
      muted: false,
    });
    expect(video.volume).toBe(0.4);
    await expect(controller.toggleMasterMute()).resolves.toMatchObject({ muted: true });
    expect(video.muted).toBe(true);
    controller.dispose();
  });

  it('accepts a 600% MAIN-world volume boost report', async () => {
    const video = document.createElement('video');
    document.body.append(video);
    video.addEventListener('playlist-zamani:control:boost-volume', (event) => {
      const detail = (event as CustomEvent<Record<string, unknown>>).detail;
      if (detail.action !== 'setVolume') return;
      video.dispatchEvent(new CustomEvent('playlist-zamani:state:boost-volume', {
        bubbles: true,
        detail: {
          kind: 'volume',
          percent: detail.percent,
          muted: false,
          boosted: true,
          boostSupported: true,
        },
      }));
    });
    const controller = new UniversalMediaController({
      channel: 'boost-volume',
      hostname: 'example.com',
      settings: { ...DEFAULT_UNIVERSAL_SETTINGS, enabled: true },
      extensionSettings: DEFAULT_SETTINGS,
      rule: null,
      rememberedSpeed: null,
      saveSpeed: async () => undefined,
    });
    controller.start();
    await settleDiscovery();

    await expect(controller.setMasterVolume(600)).resolves.toEqual({
      mediaFound: true,
      percent: 600,
      muted: false,
      boosted: true,
      boostSupported: true,
    });
    expect(controller.volumeInfo().percent).toBe(600);
    controller.dispose();
  });

  it('applies bass boost and voice clarity through the MAIN-world audio graph', async () => {
    const video = document.createElement('video');
    document.body.append(video);
    video.addEventListener('playlist-zamani:control:audio-profile', (event) => {
      const detail = (event as CustomEvent<Record<string, unknown>>).detail;
      if (detail.action !== 'setAudioProfile') return;
      const settings = detail.settings as { percent: number; bass: number; voice: number };
      queueMicrotask(() => video.dispatchEvent(new CustomEvent(
        'playlist-zamani:state:audio-profile',
        {
          bubbles: true,
          detail: {
            kind: 'volume',
            percent: settings.percent,
            bass: settings.bass,
            voice: settings.voice,
            muted: false,
            boosted: settings.percent > 100,
            boostSupported: true,
          },
        },
      )));
    });
    const controller = new UniversalMediaController({
      channel: 'audio-profile',
      hostname: 'example.com',
      settings: { ...DEFAULT_UNIVERSAL_SETTINGS, enabled: true },
      extensionSettings: DEFAULT_SETTINGS,
      rule: null,
      rememberedSpeed: null,
      saveSpeed: async () => undefined,
    });
    controller.start();
    await settleDiscovery();

    await expect(controller.setMediaAudioProfile({
      percent: 225,
      bass: 80,
      voice: 50,
    })).resolves.toMatchObject({
      percent: 225,
      bass: 80,
      voice: 50,
      boosted: true,
      boostSupported: true,
    });
    controller.dispose();
  });

  it('matches rapid asynchronous boost replies to their original commands', async () => {
    const video = document.createElement('video');
    document.body.append(video);
    video.addEventListener('playlist-zamani:control:rapid-volume', (event) => {
      const detail = (event as CustomEvent<Record<string, unknown>>).detail;
      if (detail.action !== 'setVolume') return;
      window.setTimeout(() => {
        video.dispatchEvent(new CustomEvent('playlist-zamani:state:rapid-volume', {
          bubbles: true,
          detail: {
            kind: 'volume',
            percent: detail.percent,
            muted: false,
            boosted: true,
            boostSupported: true,
          },
        }));
      }, 10);
    });
    const controller = new UniversalMediaController({
      channel: 'rapid-volume',
      hostname: 'example.com',
      settings: { ...DEFAULT_UNIVERSAL_SETTINGS, enabled: true },
      extensionSettings: DEFAULT_SETTINGS,
      rule: null,
      rememberedSpeed: null,
      saveSpeed: async () => undefined,
    });
    controller.start();
    await settleDiscovery();

    const first = controller.setMasterVolume(200);
    const second = controller.setMasterVolume(300);
    await vi.advanceTimersByTimeAsync(10);
    await expect(first).resolves.toMatchObject({ percent: 200 });
    await expect(second).resolves.toMatchObject({ percent: 300 });
    controller.dispose();
  });

  it('reports unsupported boost without changing native volume when no bridge handles it', async () => {
    const video = document.createElement('video');
    video.volume = 0.8;
    document.body.append(video);
    const controller = new UniversalMediaController({
      channel: 'unsupported-volume',
      hostname: 'example.com',
      settings: { ...DEFAULT_UNIVERSAL_SETTINGS, enabled: true },
      extensionSettings: DEFAULT_SETTINGS,
      rule: null,
      rememberedSpeed: null,
      saveSpeed: async () => undefined,
    });
    controller.start();
    await settleDiscovery();

    const result = controller.setMasterVolume(200);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(result).resolves.toMatchObject({
      percent: 80,
      boostSupported: false,
    });
    expect(video.volume).toBe(0.8);
    controller.dispose();
  });

});
