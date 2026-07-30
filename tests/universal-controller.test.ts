import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SETTINGS,
  DEFAULT_UNIVERSAL_SETTINGS,
} from '../lib/constants';
import { UniversalMediaController } from '../lib/universal-controller';

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

});
