import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
import {PIECES, STORAGE_KEY} from '../vr/layout.mjs';

const require = createRequire(import.meta.url);
const {chromium} = require(process.env.MODEL_BENCH_PLAYWRIGHT_MODULE || 'playwright');
const port = Number(process.env.VR_BENCH_TEST_PORT || 17862);
const origin = `http://127.0.0.1:${port}`;

test('VR room loads the three models and restores the tray, shelf placements, and facing', {timeout: 90000}, async () => {
  const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], {
    cwd: new URL('../../', import.meta.url),
    stdio: 'ignore',
  });
  let browser;
  try {
    for (let attempt = 0; attempt < 30; attempt++) {
      try { if ((await fetch(origin)).ok) break; } catch {}
      if (attempt === 29) throw Error('Local VR bench server unavailable');
      await delay(100);
    }
    browser = await chromium.launch({
      ...(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {}),
      args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    });
    const context = await browser.newContext({viewport: {width: 1280, height: 900}});
    let page = await context.newPage();
    const errors = [];
    const assets = new Set();
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      if (request.url().endsWith('.glb')) assets.add(new URL(request.url()).pathname.split('/').pop());
    });
    await page.goto(origin + '/models/');
    await page.getByRole('link', {name: 'VR Room'}).click();
    await page.getByText('Mike, Warden, and Keraunos are ready.').waitFor({timeout: 30000});
    assert.equal(await page.locator('#stage canvas').count(), 1);
    for (const piece of PIECES) assert(assets.has(`${piece.id}-${piece.version}.glb`));

    await page.getByText('Desktop controls').click();
    await page.getByRole('button', {name: 'Pull out tray'}).click();
    await page.getByLabel('Miniature', {exact: true}).selectOption(PIECES[0].id);
    await page.getByRole('button', {name: 'Turn 45°'}).click();
    await page.getByRole('button', {name: 'Place on shelf 1'}).click();
    await page.getByLabel('Miniature', {exact: true}).selectOption(PIECES[1].id);
    assert(await page.getByRole('button', {name: 'Place on shelf 1'}).isDisabled());
    await page.getByRole('button', {name: 'Place on shelf 2'}).click();
    assert.deepEqual(errors, []);
    await page.close();

    page = await context.newPage();
    await page.goto(origin + '/models/vr/');
    await page.getByText('Mike, Warden, and Keraunos are ready.').waitFor({timeout: 30000});
    await page.getByText('Desktop controls').click();
    assert.equal(await page.getByRole('button', {name: 'Close tray'}).getAttribute('aria-expanded'), 'true');
    const options = await page.getByLabel('Miniature', {exact: true}).locator('option').allTextContents();
    assert.deepEqual(options.slice(1), ['Mike · Shelf 1', 'Warden · Shelf 2', 'Keraunos · Tray 3']);
    const layout = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);
    assert.equal(layout.pieces[PIECES[0].id].yaw, Math.PI / 4);
  } finally {
    await browser?.close();
    server.kill();
  }
});
