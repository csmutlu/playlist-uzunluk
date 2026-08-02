import {
  normalizeTabAudioSettings,
  tabAudioNodeValues,
} from '../../lib/tab-audio';
import type {
  OffscreenAudioMessage,
  TabAudioSettings,
  TabAudioState,
} from '../../lib/types';

interface AudioSession {
  tabId: number;
  stream: MediaStream;
  context: AudioContext;
  source: MediaStreamAudioSourceNode;
  bass: BiquadFilterNode;
  voice: BiquadFilterNode;
  gain: GainNode;
  settings: TabAudioSettings;
}

const sessions = new Map<number, AudioSession>();

function stateFor(tabId: number, error?: string): TabAudioState {
  const session = sessions.get(tabId);
  return {
    tabId,
    active: Boolean(session),
    supported: true,
    ...(session?.settings ?? { percent: 100, bass: 0, voice: 0 }),
    ...(error ? { error } : {}),
  };
}

function applySettings(session: AudioSession, settings: TabAudioSettings): TabAudioState {
  const normalized = normalizeTabAudioSettings(settings);
  const values = tabAudioNodeValues(normalized);
  const now = session.context.currentTime;
  session.gain.gain.setTargetAtTime(values.gain, now, 0.015);
  session.bass.gain.setTargetAtTime(values.bassDb, now, 0.025);
  session.voice.gain.setTargetAtTime(values.voiceDb, now, 0.025);
  session.settings = normalized;
  if (session.context.state === 'suspended') void session.context.resume();
  return stateFor(session.tabId);
}

async function stopSession(tabId: number, stopTracks = true): Promise<TabAudioState> {
  const session = sessions.get(tabId);
  if (!session) return stateFor(tabId);
  sessions.delete(tabId);
  if (stopTracks) {
    for (const track of session.stream.getTracks()) track.stop();
  }
  await session.context.close().catch(() => undefined);
  return stateFor(tabId);
}

async function startSession(
  tabId: number,
  streamId: string,
  settings: TabAudioSettings,
): Promise<TabAudioState> {
  const existing = sessions.get(tabId);
  if (existing) return applySettings(existing, settings);
  let stream: MediaStream | null = null;
  let context: AudioContext | null = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId,
        },
      } as MediaTrackConstraints,
      video: false,
    });
    if (stream.getAudioTracks().length === 0) {
      for (const track of stream.getTracks()) track.stop();
      throw new Error('The tab did not provide an audio track.');
    }
    context = new AudioContext({ latencyHint: 'interactive' });
    const source = context.createMediaStreamSource(stream);
    const bass = context.createBiquadFilter();
    bass.type = 'lowshelf';
    bass.frequency.value = 180;
    const voice = context.createBiquadFilter();
    voice.type = 'peaking';
    voice.frequency.value = 2_500;
    voice.Q.value = 0.9;
    const gain = context.createGain();
    source.connect(bass).connect(voice).connect(gain).connect(context.destination);
    const session: AudioSession = {
      tabId,
      stream,
      context,
      source,
      bass,
      voice,
      gain,
      settings: normalizeTabAudioSettings(settings),
    };
    sessions.set(tabId, session);
    for (const track of stream.getTracks()) {
      track.addEventListener('ended', () => void stopSession(tabId, false), { once: true });
    }
    await context.resume();
    return applySettings(session, settings);
  } catch (error) {
    if (sessions.has(tabId)) await stopSession(tabId);
    else {
      for (const track of stream?.getTracks() ?? []) track.stop();
      if (context && context.state !== 'closed') await context.close().catch(() => undefined);
    }
    return stateFor(
      tabId,
      error instanceof Error ? error.message : 'Tab audio capture failed.',
    );
  }
}

chrome.runtime.onMessage.addListener(
  (
    message: OffscreenAudioMessage,
    _sender,
    sendResponse: (response: TabAudioState | TabAudioState[]) => void,
  ) => {
    if (message?.target !== 'offscreen-audio') return;
    if (message.type === 'audio-engine:list-states') {
      sendResponse([...sessions.keys()].map((tabId) => stateFor(tabId)));
      return;
    }
    if (message.type === 'audio-engine:get-state') {
      sendResponse(stateFor(message.tabId));
      return;
    }
    if (message.type === 'audio-engine:update') {
      const session = sessions.get(message.tabId);
      sendResponse(session
        ? applySettings(session, message.settings)
        : stateFor(message.tabId, 'Tab audio is not active.'));
      return;
    }
    if (message.type === 'audio-engine:start') {
      void startSession(message.tabId, message.streamId, message.settings).then(sendResponse);
      return true;
    }
    if (message.type === 'audio-engine:stop') {
      void stopSession(message.tabId).then(sendResponse);
      return true;
    }
  },
);
