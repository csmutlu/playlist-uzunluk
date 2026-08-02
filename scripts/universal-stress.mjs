import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';

const projectRoot = path.resolve(import.meta.dirname, '..');
const builtExtensionPath = path.join(projectRoot, '.output', 'chrome-mv3');
const bravePath =
  globalThis.process?.env?.BRAVE_PATH ??
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';
const profilePath = await fs.mkdtemp(path.join(os.tmpdir(), 'playlist-zamani-stress-'));
const extensionPath = await fs.mkdtemp(path.join(os.tmpdir(), 'playlist-zamani-extension-'));
await fs.cp(builtExtensionPath, extensionPath, { recursive: true });

const manifestPath = path.join(extensionPath, 'manifest.json');
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
manifest.host_permissions = ['https://stress.example/*'];
await fs.writeFile(manifestPath, JSON.stringify(manifest));

const metric = (entries, name) =>
  entries.find((entry) => entry.name === name)?.value ?? 0;

let context;
try {
  context = await chromium.launchPersistentContext(profilePath, {
    executablePath: bravePath,
    headless: globalThis.process?.env?.BRAVE_HEADLESS === 'true',
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--disable-default-apps',
      '--disable-sync',
      '--no-first-run',
    ],
  });
  let workers = context.serviceWorkers();
  if (workers.length === 0) {
    workers = [await context.waitForEvent('serviceworker', { timeout: 15_000 })];
  }
  const worker = workers[0];
  const page = await context.newPage();
  await page.route('https://stress.example/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><meta charset="utf-8"><title>Media stress</title><body></body>',
    }),
  );
  await page.goto('https://stress.example/');
  await worker.evaluate(async () => {
    await chrome.storage.sync.set({
      'universalSettings:v1': {
        schemaVersion: 1,
        enabled: true,
        indicatorMode: 'hidden',
      },
    });
  });

  const appendMs = await page.evaluate(() => {
    const started = performance.now();
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < 1_000; index += 1) {
      const video = document.createElement('video');
      video.id = `stress-video-${index}`;
      video.style.cssText = index === 0
        ? 'display:block;width:640px;height:360px'
        : 'display:none';
      fragment.append(video);
    }
    document.body.append(fragment);
    return performance.now() - started;
  });
  await page.evaluate(() => {
    globalThis.__pzLongTasks = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        globalThis.__pzLongTasks.push(entry.duration);
      }
    }).observe({ type: 'longtask' });
  });
  const client = await context.newCDPSession(page);
  await client.send('Performance.enable');
  await page.waitForTimeout(200);
  const beforeBaseline = await client.send('Performance.getMetrics');
  await page.waitForTimeout(2_000);
  const afterBaseline = await client.send('Performance.getMetrics');
  const baselineTaskMs =
    (metric(afterBaseline.metrics, 'TaskDuration') -
      metric(beforeBaseline.metrics, 'TaskDuration')) *
    1_000;
  await page.evaluate(() => {
    globalThis.__pzLongTasks = [];
  });
  await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined) throw new Error('Stress tab was not found');
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['/universal.js'],
      injectImmediately: true,
    });
  });

  const scanStarted = Date.now();
  let tracked = false;
  while (!tracked && Date.now() - scanStarted < 8_000) {
    await page.locator('#stress-video-999').evaluate((video) => {
      video.playbackRate = 1.37;
      video.dispatchEvent(new Event('ratechange'));
    });
    const info = await worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return tab?.id === undefined
        ? null
        : chrome.tabs.sendMessage(tab.id, { type: 'universal:site-info' });
    });
    tracked = Math.abs((info?.speed ?? 0) - 1.37) < 0.001;
    if (!tracked) await page.waitForTimeout(100);
  }
  assert(tracked, 'The 1000th media element was not discovered incrementally');
  const scanReadyMs = Date.now() - scanStarted;

  await page.keyboard.press('r');
  await page.keyboard.down('d');
  await page.waitForTimeout(700);
  await page.keyboard.up('d');
  const heldRate = await page.locator('#stress-video-999').evaluate(
    (video) => video.playbackRate,
  );
  assert(heldRate > 1.1, 'Held D did not advance the selected media under load');

  const beforeIdle = await client.send('Performance.getMetrics');
  await page.waitForTimeout(2_000);
  const afterIdle = await client.send('Performance.getMetrics');
  const idleTaskMs =
    (metric(afterIdle.metrics, 'TaskDuration') - metric(beforeIdle.metrics, 'TaskDuration')) *
    1_000;
  const idleOverheadMs = Math.max(0, idleTaskMs - baselineTaskMs);
  const longTasks = await page.evaluate(() => globalThis.__pzLongTasks);
  const maxLongTaskMs = Math.max(0, ...longTasks);

  assert(maxLongTaskMs < 50, `A ${maxLongTaskMs.toFixed(1)} ms long task was observed`);
  assert(
    idleOverheadMs < 10,
    `Idle CPU overhead was ${idleOverheadMs.toFixed(1)} ms over 2 seconds`,
  );

  // Real playback on a healthy buffer: a fast rate must actually play fast and
  // must not freeze or pause. This does not exercise buffer recovery -- the
  // routed clip is served instantly, so the browser never emits `waiting`. The
  // recovery tuning itself is guarded by the unit tests in
  // tests/universal-controller.test.ts.
  const speedClip = await fs.readFile(
    path.join(projectRoot, 'scripts', 'fixtures', 'speed-clip.webm'),
  );
  const clipPage = await context.newPage();
  await clipPage.route('https://stress.example/speed-clip.webm', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'video/webm',
      headers: { 'accept-ranges': 'bytes' },
      body: speedClip,
    }),
  );
  await clipPage.route('https://stress.example/clip', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><meta charset="utf-8"><title>Speed</title><body><video id="clip" src="https://stress.example/speed-clip.webm" style="width:640px;height:360px" muted></video></body>',
    }),
  );
  await clipPage.goto('https://stress.example/clip');
  await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined) throw new Error('Clip tab was not found');
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['/universal.js'],
      injectImmediately: true,
    });
  });
  await clipPage.waitForFunction(
    () => {
      const video = document.querySelector('#clip');
      return video && Number.isFinite(video.duration) && video.duration > 0;
    },
    undefined,
    { timeout: 20_000 },
  );
  await clipPage.locator('#clip').dispatchEvent('pointerdown');
  await clipPage.evaluate(() => document.querySelector('#clip').play());
  await clipPage.keyboard.press('r');
  for (let index = 0; index < 30; index += 1) await clipPage.keyboard.press('d');

  const rateStart = await clipPage.evaluate(() => document.querySelector('#clip').currentTime);
  const rateWall = Date.now();
  await clipPage.waitForTimeout(3_000);
  const played = await clipPage.evaluate(() => ({
    currentTime: document.querySelector('#clip').currentTime,
    paused: document.querySelector('#clip').paused,
  }));
  const effectiveRate =
    (played.currentTime - rateStart) / ((Date.now() - rateWall) / 1_000);

  assert(!played.paused, 'A fast playback rate must not pause the media');
  assert(
    played.currentTime - rateStart > 0.5,
    'Playback froze while the media was sped up',
  );
  assert(
    effectiveRate > 3.5,
    `4x playback only advanced at ${effectiveRate.toFixed(2)}x on a fully buffered clip`,
  );

  const universalBytes = (await fs.stat(
    path.join(builtExtensionPath, 'universal.js'),
  )).size;
  console.log(JSON.stringify({
    browser: 'Brave',
    mediaElements: 1_000,
    appendMs: Number(appendMs.toFixed(2)),
    scanReadyMs,
    heldRate,
    maxLongTaskMs: Number(maxLongTaskMs.toFixed(2)),
    baselineTaskMsOver2s: Number(baselineTaskMs.toFixed(2)),
    idleTaskMsOver2s: Number(idleTaskMs.toFixed(2)),
    idleOverheadMsOver2s: Number(idleOverheadMs.toFixed(2)),
    effectiveRateAt4x: Number(effectiveRate.toFixed(2)),
    universalBytes,
  }, null, 2));
} finally {
  await context?.close();
  await fs.rm(profilePath, { recursive: true, force: true });
  await fs.rm(extensionPath, { recursive: true, force: true });
}
