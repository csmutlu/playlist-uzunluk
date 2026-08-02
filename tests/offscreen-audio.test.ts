import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OffscreenAudioMessage, TabAudioState } from '../lib/types';

interface FakeParam {
  value: number;
  setTargetAtTime: ReturnType<typeof vi.fn>;
}

interface FakeNode {
  connect: ReturnType<typeof vi.fn>;
  gain?: FakeParam;
  frequency?: { value: number };
  Q?: { value: number };
  type?: string;
}

describe('offscreen tab-audio engine', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('starts, tunes, updates, and fully stops a captured tab stream', async () => {
    let listener: (
      message: OffscreenAudioMessage,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response: TabAudioState | TabAudioState[]) => void,
    ) => boolean | void = () => undefined;
    const stopTrack = vi.fn();
    const track = {
      stop: stopTrack,
      addEventListener: vi.fn(),
    };
    const stream = {
      getAudioTracks: () => [track],
      getTracks: () => [track],
    };
    const gainNodes: FakeNode[] = [];
    const filterNodes: FakeNode[] = [];
    const closeContext = vi.fn(async () => undefined);
    const node = (): FakeNode => {
      const next: FakeNode = { connect: vi.fn() };
      next.connect.mockReturnValue(next);
      return next;
    };
    class FakeAudioContext {
      currentTime = 4;
      state: AudioContextState = 'running';
      destination = node();
      createMediaStreamSource = () => node();
      createBiquadFilter = () => {
        const next = node();
        next.gain = { value: 0, setTargetAtTime: vi.fn() };
        next.frequency = { value: 0 };
        next.Q = { value: 0 };
        filterNodes.push(next);
        return next;
      };
      createGain = () => {
        const next = node();
        next.gain = { value: 1, setTargetAtTime: vi.fn() };
        gainNodes.push(next);
        return next;
      };
      resume = vi.fn(async () => undefined);
      close = closeContext;
    }

    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: {
        runtime: {
          onMessage: {
            addListener: (next: typeof listener) => { listener = next; },
          },
        },
      },
    });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => stream) },
    });
    Object.defineProperty(globalThis, 'AudioContext', {
      configurable: true,
      value: FakeAudioContext,
    });

    await import('../entrypoints/offscreen/main');
    const send = (message: OffscreenAudioMessage) => new Promise<TabAudioState | TabAudioState[]>(
      (resolve) => listener(message, {} as chrome.runtime.MessageSender, resolve),
    );

    await expect(send({
      target: 'offscreen-audio',
      type: 'audio-engine:start',
      tabId: 17,
      streamId: 'stream-id',
      settings: { percent: 240, bass: 70, voice: 45 },
    })).resolves.toEqual({
      tabId: 17,
      active: true,
      supported: true,
      percent: 240,
      bass: 70,
      voice: 45,
    });
    expect(gainNodes[0]!.gain?.setTargetAtTime).toHaveBeenLastCalledWith(2.4, 4, 0.015);
    expect(filterNodes[0]!.gain?.setTargetAtTime).toHaveBeenLastCalledWith(10.5, 4, 0.025);
    const voiceStartCall = filterNodes[1]!.gain?.setTargetAtTime.mock.lastCall;
    expect(voiceStartCall?.[0]).toBeCloseTo(5.4);
    expect(voiceStartCall?.slice(1)).toEqual([4, 0.025]);

    await expect(send({
      target: 'offscreen-audio',
      type: 'audio-engine:update',
      tabId: 17,
      settings: { percent: 300, bass: 100, voice: 0 },
    })).resolves.toMatchObject({ percent: 300, bass: 100, voice: 0 });
    expect(gainNodes[0]!.gain?.setTargetAtTime).toHaveBeenLastCalledWith(3, 4, 0.015);
    expect(filterNodes[0]!.gain?.setTargetAtTime).toHaveBeenLastCalledWith(15, 4, 0.025);
    expect(filterNodes[1]!.gain?.setTargetAtTime).toHaveBeenLastCalledWith(0, 4, 0.025);

    await expect(send({
      target: 'offscreen-audio',
      type: 'audio-engine:stop',
      tabId: 17,
    })).resolves.toEqual({
      tabId: 17,
      active: false,
      supported: true,
      percent: 100,
      bass: 0,
      voice: 0,
    });
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(closeContext).toHaveBeenCalledOnce();
  });
});
