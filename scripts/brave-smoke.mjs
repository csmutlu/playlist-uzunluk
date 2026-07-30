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
const profilePath = await fs.mkdtemp(path.join(os.tmpdir(), 'playlist-zamani-brave-'));
const extensionPath = await fs.mkdtemp(path.join(os.tmpdir(), 'playlist-zamani-extension-'));
await fs.cp(builtExtensionPath, extensionPath, { recursive: true });
const smokeManifestPath = path.join(extensionPath, 'manifest.json');
const smokeManifest = JSON.parse(await fs.readFile(smokeManifestPath, 'utf8'));
smokeManifest.host_permissions = [
  'https://www.youtube.com/*',
  'https://player.example.test/*',
];
await fs.writeFile(smokeManifestPath, JSON.stringify(smokeManifest));
const playlistId = 'PL-playlist-zamani-smoke';

const fixture = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Modern Web Development - YouTube</title>
  </head>
  <body>
    <ytd-playlist-header-renderer>
      <h1>Modern Web Development</h1>
      <span id="playlist-count">2 videos</span>
    </ytd-playlist-header-renderer>
    <ytd-two-column-browse-results-renderer>
      <div id="contents">
        <ytd-playlist-video-renderer data-video="video-one">
          <a id="video-title"
             href="/watch?v=video-one&list=${playlistId}&index=1">HTML fundamentals</a>
          <ytd-thumbnail-overlay-time-status-renderer>
            <span id="text">1:00</span>
          </ytd-thumbnail-overlay-time-status-renderer>
        </ytd-playlist-video-renderer>
        <ytd-playlist-video-renderer data-video="video-two">
          <a id="video-title"
             href="/watch?v=video-two&list=${playlistId}&index=2">Modern CSS</a>
          <ytd-thumbnail-overlay-time-status-renderer>
            <span id="text">2:00</span>
          </ytd-thumbnail-overlay-time-status-renderer>
        </ytd-playlist-video-renderer>
      </div>
    </ytd-two-column-browse-results-renderer>
  </body>
</html>`;

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
  const extensionId = new URL(worker.url()).host;
  const page = await context.newPage();
  await page.route('https://www.youtube.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: fixture }),
  );
  await page.goto(`https://www.youtube.com/playlist?list=${playlistId}`);

  const panel = page.locator('playlist-zamani-root');
  await panel.waitFor({ state: 'attached', timeout: 10_000 });
  assert.equal(await panel.count(), 1, 'The playlist panel must mount exactly once');
  let panelText = await panel.evaluate(
    (element) =>
      element.shadowRoot?.querySelector('.mount')?.textContent?.replace(/\s+/g, ' ').trim() ??
      '',
  );
  assert.match(panelText, /2\/2/);

  await page.route('https://player.example.test/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><video id="frame-video" tabindex="0" style="display:block;width:100%;height:100%"></video>',
    }),
  );
  await page.evaluate(() => {
    document.querySelector('#playlist-count').textContent = '1 video';
    document.querySelector('[data-video="video-two"]').remove();
    document.querySelector('[data-video="video-one"] #text').textContent = '1:30';
  });
  await page.waitForTimeout(400);
  panelText = await panel.evaluate(
    (element) =>
      element.shadowRoot?.querySelector('.mount')?.textContent?.replace(/\s+/g, ' ').trim() ??
      '',
  );
  assert.match(panelText, /1\/1/);

  await page.evaluate(() => {
    const video = document.createElement('video');
    video.id = 'universal-speed-fixture';
    video.src = 'https://cdn.example.test/media/lesson.mp4';
    video.style.cssText = 'display:block;width:100%;height:100%;object-fit:cover';
    const player = document.createElement('div');
    player.id = 'universal-player-fixture';
    player.className = 'video-player';
    player.style.cssText = 'position:relative;width:640px;height:360px';
    player.append(video);
    const frame = document.createElement('iframe');
    frame.id = 'cross-origin-player';
    frame.src = 'https://player.example.test/embed';
    frame.style.cssText = 'display:block;width:560px;height:315px;border:0';
    document.body.style.overflow = 'auto';
    document.body.append(player, frame);
  });
  await page.locator('#cross-origin-player').waitFor({ state: 'attached' });
  await page.frameLocator('#cross-origin-player').locator('#frame-video').waitFor({
    state: 'visible',
    timeout: 5_000,
  });
  await worker.evaluate(async () => {
    await chrome.storage.sync.set({
      'universalSettings:v1': { schemaVersion: 1, enabled: true },
    });
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined) throw new Error('Fixture tab was not found');
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      files: ['/universal.js'],
      injectImmediately: true,
    });
  });
  await page.waitForTimeout(250);
  await page.keyboard.press('d');
  await page.waitForFunction(
    () => document.querySelector('#universal-speed-fixture').playbackRate === 1.1,
  );
  assert.equal(
    await page.locator('playlist-zamani-speed').count(),
    1,
    'The universal speed indicator should mount once',
  );
  assert.equal(
    await page.frameLocator('#cross-origin-player').locator('playlist-zamani-speed').count(),
    0,
    'An inactive nested player must not mount a second speed indicator',
  );
  await page.waitForTimeout(150);
  const speedIndicator = page.locator('playlist-zamani-speed');
  const [videoBox, indicatorBox] = await Promise.all([
    page.locator('#universal-speed-fixture').boundingBox(),
    speedIndicator.boundingBox(),
  ]);
  assert(videoBox && indicatorBox, 'Video and speed indicator must have visible bounds');
  assert(
    Math.abs(indicatorBox.x - (videoBox.x + 10)) <= 2 &&
      Math.abs(indicatorBox.y - (videoBox.y + 10)) <= 2,
    `The speed indicator must stay at the video top-left by default: ${JSON.stringify({
      videoBox,
      indicatorBox,
    })}`,
  );
  await page.waitForTimeout(1_300);
  const idleOpacity = Number(await speedIndicator.evaluate((element) => element.style.opacity));
  assert(
    idleOpacity > 0 && idleOpacity < 1,
    'The speed indicator must remain dimmed instead of disappearing',
  );
  await speedIndicator.hover();
  await page.waitForTimeout(1_400);
  assert.equal(
    await speedIndicator.evaluate((element) => element.style.opacity),
    '1',
    'The speed indicator must stay fully visible while hovered',
  );
  await page.mouse.move(900, 700);
  await page.waitForTimeout(600);
  assert(
    Number(await speedIndicator.evaluate((element) => element.style.opacity)) > 0,
    'The speed indicator must return to a dimmed state after hover',
  );
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.id = 'shortcut-guard';
    document.body.append(input);
    input.focus();
  });
  await page.keyboard.press('d');
  assert.equal(
    await page.locator('#universal-speed-fixture').evaluate((video) => video.playbackRate),
    1.1,
    'Shortcuts must be ignored in editable controls',
  );
  await page.locator('#shortcut-guard').evaluate((input) => input.blur());
  await page.keyboard.down('d');
  await page.waitForTimeout(650);
  await page.keyboard.up('d');
  assert(
    await page.locator('#universal-speed-fixture').evaluate((video) => video.playbackRate) > 1.1,
    'Holding D must repeatedly increase speed',
  );
  for (let index = 0; index < 200; index += 1) await page.keyboard.press('d');
  await page.waitForFunction(
    () => document.querySelector('#universal-speed-fixture').playbackRate === 16,
  );
  await page.keyboard.press('r');
  await page.keyboard.press('d');
  await page.keyboard.down('s');
  await page.waitForTimeout(650);
  await page.keyboard.up('s');
  assert(
    await page.locator('#universal-speed-fixture').evaluate((video) => video.playbackRate) < 1,
    'Holding S must repeatedly decrease speed',
  );
  await page.keyboard.press('r');
  await page.keyboard.press('d');
  await page.keyboard.press('s');
  assert.equal(
    await page.locator('#universal-speed-fixture').evaluate((video) => video.playbackRate),
    1,
    'S from 1.1x must return to 1x, not 0.9x',
  );
  const downloadInfo = await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined) throw new Error('Fixture tab was not found');
    return chrome.tabs.sendMessage(
      tab.id,
      { type: 'universal:download-info' },
      { frameId: 0 },
    );
  });
  assert.deepEqual(
    {
      available: downloadInfo.available,
      url: downloadInfo.url,
    },
    {
      available: true,
      url: 'https://cdn.example.test/media/lesson.mp4',
    },
    'Direct HTML5 media must be exposed to the popup download action',
  );

  await page.keyboard.press('t');
  const theaterBox = await page.locator('#universal-player-fixture').boundingBox();
  const viewport = page.viewportSize();
  assert(theaterBox && viewport, 'Theater player and viewport must have visible bounds');
  assert(
    Math.abs(theaterBox.x) <= 1 &&
      Math.abs(theaterBox.y) <= 1 &&
      Math.abs(theaterBox.width - viewport.width) <= 2 &&
      Math.abs(theaterBox.height - viewport.height) <= 2,
    'T must fill the Brave tab viewport without browser fullscreen',
  );
  assert.equal(
    await page.evaluate(() => document.fullscreenElement),
    null,
    'Window theater must not use the Fullscreen API',
  );
  await page.keyboard.press('t');
  assert.equal(
    await page.locator('#universal-player-fixture').evaluate((player) => player.style.position),
    'relative',
    'Second T must restore the original player style',
  );

  const frameVideo = page.frameLocator('#cross-origin-player').locator('#frame-video');
  await frameVideo.focus();
  await frameVideo.press('t');
  const frameTheaterBox = await page.locator('#cross-origin-player').boundingBox();
  const [parentIndicatorCount, frameIndicatorOpacity] = await Promise.all([
    page.locator('playlist-zamani-speed').count(),
    page.frameLocator('#cross-origin-player').locator('playlist-zamani-speed')
      .evaluate((indicator) => Number(indicator.style.opacity)),
  ]);
  assert(frameTheaterBox && viewport, 'Cross-origin frame must have visible bounds');
  assert(
    Math.abs(frameTheaterBox.x) <= 1 &&
      Math.abs(frameTheaterBox.y) <= 1 &&
      Math.abs(frameTheaterBox.width - viewport.width) <= 2 &&
      Math.abs(frameTheaterBox.height - viewport.height) <= 2,
    'T inside a cross-origin player must promote its iframe to the tab viewport',
  );
  assert.equal(
    parentIndicatorCount,
    0,
    'The parent-frame indicator must be removed while the nested player owns the overlay',
  );
  assert(
    frameIndicatorOpacity > 0,
    'Only the active nested player indicator should remain visible',
  );
  await frameVideo.press('t');
  assert.equal(
    await page.locator('#cross-origin-player').evaluate((frame) => frame.style.width),
    '560px',
    'Cross-origin theater exit must restore the iframe size',
  );
  await page.evaluate(() => {
    document.querySelector('#universal-player-fixture').remove();
    document.querySelector('#cross-origin-player').remove();
    const host = document.createElement('div');
    const root = host.attachShadow({ mode: 'closed' });
    const video = document.createElement('video');
    video.style.cssText = 'display:block;width:320px;height:180px';
    root.append(video);
    document.body.append(host);
    globalThis.__closedTheaterVideo = video;
  });
  await page.waitForTimeout(150);
  await page.keyboard.press('t');
  const closedTheater = await page.evaluate(() => {
    const video = globalThis.__closedTheaterVideo;
    const rect = video.getBoundingClientRect();
    return {
      width: rect.width,
      height: rect.height,
      fullscreen: Boolean(document.fullscreenElement),
    };
  });
  assert(
    Math.abs(closedTheater.width - viewport.width) <= 2 &&
      Math.abs(closedTheater.height - viewport.height) <= 2 &&
      !closedTheater.fullscreen,
    'T must support media created inside a closed Shadow DOM',
  );
  await page.keyboard.press('t');
  assert.equal(
    await page.evaluate(() => globalThis.__closedTheaterVideo.style.width),
    '320px',
    'Closed Shadow DOM theater exit must restore the original style',
  );

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.locator('.playlist-item').waitFor({ state: 'visible', timeout: 5_000 });
  assert.match(await popup.locator('.playlist-item').innerText(), /Modern Web Development/);
  assert.equal(await popup.locator('.playlist-item .continue').count(), 1);

  console.log(
    'Brave smoke test passed: single cross-frame indicator, held D/S, 16x clamp, window/iframe/closed-shadow theater mode, direct-media detection, input guard and Playlistlerim.',
  );
} finally {
  await context?.close();
  await fs.rm(profilePath, { recursive: true, force: true });
  await fs.rm(extensionPath, { recursive: true, force: true });
}
