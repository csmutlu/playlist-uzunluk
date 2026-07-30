import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { Builder, By, until } from 'selenium-webdriver';
import { Context, Options, ServiceBuilder } from 'selenium-webdriver/firefox.js';

const GECKO_NAME = process.env.GECKO_NAME || 'Zen';
const GECKO_BINARY =
  process.env.GECKO_BINARY || '/Applications/Zen.app/Contents/MacOS/zen';
const ADDON_ID = 'playlist-zamani@local';
const packageVersion = JSON.parse(readFileSync(resolve('package.json'), 'utf8')).version;
const ADDON_PATH = resolve(`.output/playlist-zamani-${packageVersion}-firefox.zip`);
const PLAYLIST_URL =
  'https://www.youtube.com/playlist?list=PL5kIOunpmSBMBPYmrPkd0JikOPIfQW-Sn';
const FIXTURE_MEDIA =
  '/System/Library/CoreServices/ControlCenter.app/Contents/Resources/'
  + 'BentoGalleryIntroduction.mov';

assert.ok(existsSync(GECKO_BINARY), `${GECKO_NAME} is not installed.`);
assert.ok(existsSync(ADDON_PATH), 'Build the Firefox ZIP before running this test.');
assert.ok(existsSync(FIXTURE_MEDIA), 'The local media fixture is unavailable.');
const fixtureMedia = readFileSync(FIXTURE_MEDIA);

const fixture = `<!doctype html>
<html>
  <body style="margin:0;background:#111">
    <video
      id="media"
      src="/fixture.mov"
      muted
      preload="auto"
      style="display:block;width:800px;height:450px;background:#222"
    ></video>
    <input id="guard" value="typing must not change speed">
    <iframe
      id="nested-player"
      src="/frame"
      style="display:block;width:480px;height:270px;border:0"
    ></iframe>
  </body>
</html>`;

const frameFixture = `<!doctype html>
<html>
  <body style="margin:0;background:#111">
    <video
      id="frame-media"
      src="/fixture.mov"
      muted
      preload="auto"
      style="display:block;width:100%;height:100%;background:#222"
    ></video>
  </body>
</html>`;

const server = createServer((request, response) => {
  if (request.url === '/fixture.mov') {
    response.writeHead(200, {
      'content-length': fixtureMedia.byteLength,
      'content-type': 'video/quicktime',
    });
    response.end(fixtureMedia);
    return;
  }
  if (request.url === '/frame') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(frameFixture);
    return;
  }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(fixture);
});
await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
const address = server.address();
assert.ok(address && typeof address === 'object');
const fixtureUrl = `http://127.0.0.1:${address.port}/`;

const options = new Options()
  .setBinary(GECKO_BINARY)
  .addArguments('-headless')
  .setPreference('browser.shell.checkDefaultBrowser', false)
  .setPreference('datareporting.policy.dataSubmissionEnabled', false)
  .setPreference('extensions.autoDisableScopes', 0)
  .setPreference('extensions.enabledScopes', 15);

const driver = await new Builder()
  .forBrowser('firefox')
  .setFirefoxOptions(options)
  .setFirefoxService(
    new ServiceBuilder('/opt/homebrew/bin/geckodriver')
      .addArguments('--allow-system-access'),
  )
  .build();

try {
  const installedId = await driver.installAddon(ADDON_PATH, true);
  assert.equal(installedId, ADDON_ID);

  await driver.setContext(Context.CHROME);
  const extensionUuid = await driver.executeScript(`
    const { ExtensionParent } = ChromeUtils.importESModule(
      "resource://gre/modules/ExtensionParent.sys.mjs"
    );
    return ExtensionParent.GlobalManager.getExtension("${ADDON_ID}")?.uuid ?? "";
  `);
  assert.ok(extensionUuid, 'Could not resolve the installed extension UUID.');

  await driver.setContext(Context.CONTENT);
  await driver.get(`moz-extension://${extensionUuid}/popup.html`);
  const toggle = await driver.wait(
    until.elementLocated(By.css('.universal-toggle input')),
    10_000,
  );
  await driver.wait(until.elementIsVisible(toggle), 10_000);
  await toggle.click();

  await driver.sleep(1_500);
  const enabledState = await driver.executeAsyncScript(`
    const done = arguments[arguments.length - 1];
    Promise.all([
      browser.storage.sync.get("universalSettings:v1"),
      browser.permissions.getAll(),
      browser.runtime.sendMessage({ type: "universal:registration-status" }),
    ]).then(([storage, permissions, registration]) => done({
      checked: document.querySelector(".universal-toggle input")?.checked ?? false,
      status: document.body.innerText,
      storage,
      permissions,
      registration,
    }));
  `);
  assert.equal(
    enabledState.storage['universalSettings:v1']?.enabled,
    true,
    `Universal setting was not saved: ${JSON.stringify(enabledState)}`,
  );
  assert.ok(
    enabledState.permissions.origins.includes('http://*/*')
      && enabledState.permissions.origins.includes('https://*/*'),
    `Universal host permissions are missing: ${JSON.stringify(enabledState.permissions)}`,
  );
  assert.equal(
    enabledState.registration.registered,
    true,
    `Universal script was not registered: ${JSON.stringify(enabledState)}`,
  );
  const popupControls = await driver.executeScript(`
    return {
      quickControls: document.querySelectorAll(".quick-controls").length,
      speedPresets: document.querySelectorAll(".speed-presets button").length,
      shortcutInputs: document.querySelectorAll(".shortcut-input").length,
      advancedSections: document.querySelectorAll("details.shortcut-settings").length,
      saveButtons: document.querySelectorAll("button.save").length,
    };
  `);
  assert.deepEqual(
    popupControls,
    {
      quickControls: 1,
      speedPresets: 8,
      shortcutInputs: 10,
      advancedSections: 3,
      saveButtons: 1,
    },
    `Popup controls are incomplete: ${JSON.stringify(popupControls)}`,
  );
  await driver.navigate().refresh();
  const persistedToggle = await driver.wait(
    until.elementLocated(By.css('.universal-toggle input')),
    10_000,
  );
  assert.equal(await persistedToggle.isSelected(), true, 'Universal toggle did not persist.');
  await persistedToggle.click();
  await driver.sleep(500);
  assert.equal(await persistedToggle.isSelected(), false, 'Universal toggle did not turn off.');
  await driver.navigate().refresh();
  const disabledToggle = await driver.wait(
    until.elementLocated(By.css('.universal-toggle input')),
    10_000,
  );
  assert.equal(
    await disabledToggle.isSelected(),
    false,
    'Disabled universal state did not persist.',
  );
  await disabledToggle.click();
  await driver.sleep(500);
  assert.equal(await disabledToggle.isSelected(), true, 'Universal toggle did not turn back on.');

  await driver.executeScript(`
    const input = document.querySelector(".grid.three input");
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(input, "0.2");
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
  `);
  await driver.sleep(100);
  await driver.executeScript('document.querySelector("button.save").click()');
  await driver.wait(
    async () => driver.executeAsyncScript(`
      const done = arguments[arguments.length - 1];
      browser.storage.sync.get("universalSettings:v1").then((storage) => {
        done(storage["universalSettings:v1"]?.speedStep === 0.2);
      });
    `),
    5_000,
  );
  await driver.navigate().refresh();
  const persistedSpeedStep = await driver.wait(
    until.elementLocated(By.css('.grid.three input')),
    10_000,
  );
  assert.equal(
    await persistedSpeedStep.getAttribute('value'),
    '0.2',
    'Popup speed-step setting did not persist after refresh.',
  );
  await driver.executeScript(`
    const input = document.querySelector(".grid.three input");
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(input, "0.1");
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
  `);
  await driver.sleep(100);
  await driver.executeScript('document.querySelector("button.save").click()');
  await driver.wait(
    async () => driver.executeAsyncScript(`
      const done = arguments[arguments.length - 1];
      browser.storage.sync.get("universalSettings:v1").then((storage) => {
        done(storage["universalSettings:v1"]?.speedStep === 0.1);
      });
    `),
    5_000,
  );

  await driver.get(fixtureUrl);
  const media = await driver.wait(until.elementLocated(By.id('media')), 10_000);
  await driver.wait(
    async () => driver.executeScript(
      'return document.querySelector("video").readyState > 0',
    ),
    10_000,
  );
  await driver.sleep(500);
  await media.click();
  await driver.executeScript(`
    window.__pzLastKey = null;
    addEventListener("keydown", (event) => {
      window.__pzLastKey = { key: event.key, code: event.code };
    }, { once: true });
  `);
  await driver.actions().sendKeys('d').perform();
  const fixtureState = await driver.executeScript(`
    return {
      rate: document.querySelector("video").playbackRate,
      overlay: Boolean(document.querySelector("playlist-zamani-speed")),
      key: window.__pzLastKey,
      url: location.href,
    };
  `);
  assert.equal(
    fixtureState.rate,
    1.1,
    `D shortcut did not increase playback speed: ${JSON.stringify({
      enabledState,
      fixtureState,
    })}`,
  );
  assert.equal(fixtureState.overlay, true, 'The active top player did not show its indicator.');
  const nestedPlayer = await driver.findElement(By.id('nested-player'));
  await driver.switchTo().frame(nestedPlayer);
  assert.equal(
    await driver.findElements(By.css('playlist-zamani-speed')).then((items) => items.length),
    0,
    'An inactive nested player showed a duplicate indicator.',
  );
  await driver.switchTo().defaultContent();

  await driver.sleep(900);
  await driver.navigate().refresh();
  await driver.wait(until.elementLocated(By.id('media')), 10_000);
  await driver.wait(
    async () => driver.executeScript(
      'return document.querySelector("video").readyState > 0',
    ),
    10_000,
  );
  let rememberedRate;
  try {
    rememberedRate = await driver.wait(
      async () => driver.executeScript(
        'return document.querySelector("video").playbackRate',
      ).then((value) => (value === 1.1 ? value : false)),
      5_000,
    );
  } catch {
    const refreshState = await driver.executeScript(`
      const overlay = document.querySelector("playlist-zamani-speed");
      return {
        rate: document.querySelector("video").playbackRate,
        readyState: document.querySelector("video").readyState,
        overlay: Boolean(overlay),
        overlayText: overlay?.shadowRoot?.textContent ?? "",
      };
    `);
    const refreshedMediaTab = await driver.getWindowHandle();
    await driver.switchTo().newWindow('tab');
    await driver.get(`moz-extension://${extensionUuid}/popup.html`);
    const refreshedExtensionState = await driver.executeAsyncScript(`
      const done = arguments[arguments.length - 1];
      Promise.all([
        browser.storage.local.get("universalSiteData:v1"),
        browser.storage.sync.get("universalSettings:v1"),
        browser.runtime.sendMessage({ type: "universal:registration-status" }),
        browser.scripting.getRegisteredContentScripts(),
      ]).then(([local, sync, registration, scripts]) => done({
        local,
        sync,
        registration,
        scripts,
      }));
    `);
    await driver.close();
    await driver.switchTo().window(refreshedMediaTab);
    assert.fail(`Remembered speed was not applied: ${JSON.stringify({
      refreshState,
      refreshedExtensionState,
    })}`);
  }
  assert.equal(rememberedRate, 1.1, 'Site speed did not persist after refresh.');

  const input = await driver.findElement(By.id('guard'));
  await input.click();
  await input.sendKeys('d');
  const guardedRate = await driver.executeScript(
    'return document.querySelector("video").playbackRate',
  );
  assert.equal(guardedRate, 1.1, 'Typing in an input changed playback speed.');

  const refreshedMedia = await driver.findElement(By.id('media'));
  await refreshedMedia.click();
  await driver.actions().sendKeys('d').perform();
  const refreshedFrame = await driver.findElement(By.id('nested-player'));
  await driver.switchTo().frame(refreshedFrame);
  const frameMedia = await driver.wait(until.elementLocated(By.id('frame-media')), 10_000);
  await frameMedia.click();
  await driver.actions().sendKeys('d').perform();
  assert.equal(
    await driver.findElements(By.css('playlist-zamani-speed')).then((items) => items.length),
    1,
    'The active nested player did not own exactly one indicator.',
  );
  await driver.switchTo().defaultContent();
  await driver.wait(
    async () => driver.findElements(By.css('playlist-zamani-speed'))
      .then((items) => items.length === 0),
    5_000,
  );

  await driver.get(PLAYLIST_URL);
  const playlist = await driver.wait(
    async () => driver.executeScript(`
      const shadow = document.querySelector("playlist-zamani-root")?.shadowRoot;
      const coverage = shadow?.querySelector(".coverage")?.textContent?.trim() ?? "";
      const total = shadow?.querySelector(".summary-value strong")?.textContent?.trim() ?? "";
      const counted = Number(coverage.split("/")[0]);
      return counted > 0 && total
        ? { coverage, total, title: document.title }
        : false;
    `),
    30_000,
  );
  assert.match(playlist.coverage, /^\d+\/(?:\d+|\?)$/);
  assert.doesNotMatch(playlist.total, /^0(?:\D|$)/);

  console.log(
    `${GECKO_NAME} smoke test passed: permission, popup controls and settings persisted; `
      + `one cross-frame indicator, D shortcut, speed memory and input guard worked; `
      + `YouTube playlist calculated `
      + `${playlist.coverage} videos as ${playlist.total}.`,
  );
} finally {
  await driver.quit().catch(() => undefined);
  await new Promise((resolveClose) => server.close(resolveClose));
}
