import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';

const targetUrl = 'https://www.tabii.com/tr/watch/live/trt1?trackId=150002';
const projectRoot = path.resolve(import.meta.dirname, '..');
const builtExtensionPath = path.join(projectRoot, '.output', 'chrome-mv3');
const bravePath =
  globalThis.process?.env?.BRAVE_PATH ??
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';
const profilePath = await fs.mkdtemp(path.join(os.tmpdir(), 'playlist-zamani-tabii-'));
const extensionPath = await fs.mkdtemp(path.join(os.tmpdir(), 'playlist-zamani-extension-'));
await fs.cp(builtExtensionPath, extensionPath, { recursive: true });

const manifestPath = path.join(extensionPath, 'manifest.json');
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
manifest.host_permissions = ['http://*/*', 'https://*/*'];
await fs.writeFile(manifestPath, JSON.stringify(manifest));

let context;
try {
  context = await chromium.launchPersistentContext(profilePath, {
    executablePath: bravePath,
    headless: globalThis.process?.env?.BRAVE_HEADLESS === 'true',
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--autoplay-policy=no-user-gesture-required',
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
  await worker.evaluate(async () => {
    await chrome.storage.sync.set({
      'universalSettings:v1': {
        schemaVersion: 1,
        enabled: true,
        fightbackDefault: false,
        indicatorMode: 'hidden',
      },
      settings: {
        schemaVersion: 1,
        locale: 'tr',
        defaultSpeed: 1,
        customSpeed: 1.1,
        showSeconds: true,
        completionThreshold: 0.9,
        theme: 'auto',
      },
    });
    const registered = await chrome.scripting.getRegisteredContentScripts({
      ids: ['playlist-zamani-universal'],
    });
    const definition = {
      id: 'playlist-zamani-universal',
      matches: ['http://*/*', 'https://*/*'],
      js: ['/universal.js'],
      runAt: 'document_start',
      allFrames: true,
      matchOriginAsFallback: true,
      persistAcrossSessions: true,
    };
    if (registered.length > 0) {
      await chrome.scripting.updateContentScripts([definition]);
    } else {
      await chrome.scripting.registerContentScripts([definition]);
    }
  });

  const page = await context.newPage();
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });

  let mediaFrame;
  const deadline = Date.now() + 30_000;
  while (!mediaFrame && Date.now() < deadline) {
    for (const frame of page.frames()) {
      const count = await frame.locator('video').count().catch(() => 0);
      if (count > 0) {
        mediaFrame = frame;
        break;
      }
    }
    if (!mediaFrame) await page.waitForTimeout(500);
  }
  assert(mediaFrame, 'Tabii canlı sayfasında HTML5 video bulunamadı');

  const video = mediaFrame.locator('video').first();
  await video.waitFor({ state: 'attached', timeout: 10_000 });
  await video.evaluate((item) => {
    item.muted = true;
    void item.play().catch(() => undefined);
  });
  await page.waitForTimeout(1_000);
  await page.keyboard.press('r');
  await page.waitForTimeout(500);
  assert(
    Math.abs(await video.evaluate((item) => item.playbackRate) - 1) < 0.001,
    'Tabii testi R sonrasında 1x hızına sabitlenemedi',
  );

  const rateEvents = await video.evaluate((item) => {
    globalThis.__playlistZamaniRateEvents = [];
    item.addEventListener('ratechange', () => {
      globalThis.__playlistZamaniRateEvents.push({
        rate: item.playbackRate,
        time: performance.now(),
      });
    });
    return globalThis.__playlistZamaniRateEvents;
  });
  assert(Array.isArray(rateEvents));

  for (let index = 0; index < 5; index += 1) {
    await page.keyboard.press('d');
    await page.waitForTimeout(1_200);
  }
  await page.waitForTimeout(4_000);
  const result = await video.evaluate((item) => ({
    rate: item.playbackRate,
    paused: item.paused,
    readyState: item.readyState,
    events: globalThis.__playlistZamaniRateEvents,
  }));

  assert(
    Math.abs(result.rate - 1.5) < 0.001,
    `Tabii oynatıcısı hız kilidine rağmen ${result.rate}× hızına döndü`,
  );
  console.log(JSON.stringify({
    browser: 'Brave',
    url: targetUrl,
    expectedRate: 1.5,
    finalRate: result.rate,
    paused: result.paused,
    readyState: result.readyState,
    rateChanges: result.events,
  }, null, 2));
} finally {
  await context?.close();
  await fs.rm(profilePath, { recursive: true, force: true });
  await fs.rm(extensionPath, { recursive: true, force: true });
}
