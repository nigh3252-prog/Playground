// Smoke test: node arcade/smoke.mjs [game.html ...]
// Loads each game at phone-landscape size, drives a stubbed gamepad, checks no errors,
// checks title → play → game-over → retry loop, and writes screenshots to $SHOTS (default /tmp).
import { createRequire } from 'module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
const dir = path.dirname(fileURLToPath(import.meta.url));
const reg = readFileSync(path.join(dir, 'games.js'), 'utf8');
let files = [...reg.matchAll(/file:\s*'([^']+)'/g)].map(m => m[1]);
if (process.argv.length > 2) files = process.argv.slice(2);
const shots = process.env.SHOTS || '/tmp';
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
let fails = 0;
for (const f of ['index.html', ...files]) {
  const page = await browser.newPage({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 1 });
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await page.addInitScript(() => {
    const pad = { id: 'stub', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
    window.__pad = pad;
    navigator.getGamepads = () => [null, pad];
    window.__press = (i, v) => { pad.buttons[i].pressed = v; pad.buttons[i].value = v ? 1 : 0; };
  });
  await page.goto('file://' + path.join(dir, f));
  await page.waitForTimeout(500);
  if (f !== 'index.html') {
    const st = () => page.evaluate(() => ARC.current && ARC.current.state);
    const tap = async i => { await page.evaluate(i => __press(i, true), i); await page.waitForTimeout(60); await page.evaluate(i => __press(i, false), i); await page.waitForTimeout(60); };
    await page.waitForTimeout(400);
    await tap(0);
    if (await st() === 'title') { await page.waitForTimeout(400); await tap(0); }
    if (await st() !== 'play') errs.push('did not start, state=' + await st());
    // random play for ~4s
    for (let k = 0; k < 40; k++) {
      await page.evaluate(() => { const p = __pad; p.axes[0] = Math.random() * 2 - 1; p.axes[1] = Math.random() * 2 - 1; p.axes[2] = Math.random() * 2 - 1; p.axes[3] = Math.random() * 2 - 1; for (const i of [0, 1, 2, 3, 5, 7]) __press(i, Math.random() < 0.4); });
      await page.waitForTimeout(100);
    }
    await page.evaluate(() => { for (const i of [0, 1, 2, 3, 5, 7]) __press(i, false); __pad.axes.fill(0); });
    const aud = await page.evaluate(() => ARC.audio.ctx ? ARC.audio.ctx.state : 'none');
    if (aud !== 'running') errs.push('audio not running: ' + aud);
    await page.screenshot({ path: path.join(shots, 'arc-' + f.replace('.html', '') + '-play.png') });
    // pause works
    if (await st() === 'over') await tap(0); // random play can legitimately die; retry
    await tap(9);
    if (await st() !== 'pause') errs.push('pause failed, state=' + await st());
    await tap(9);
    // force game over and retry
    await page.evaluate(() => ARC.current.gameOver('smoke'));
    await page.waitForTimeout(800);
    if (await st() !== 'over') errs.push('gameOver failed');
    await page.screenshot({ path: path.join(shots, 'arc-' + f.replace('.html', '') + '-over.png') });
    await tap(0);
    if (await st() !== 'play') errs.push('retry failed, state=' + await st());
    await page.waitForTimeout(500);
  } else {
    await page.screenshot({ path: path.join(shots, 'arc-index.png') });
  }
  console.log((errs.length ? 'FAIL ' : 'ok   ') + f + (errs.length ? '\n   ' + errs.slice(0, 5).join('\n   ') : ''));
  if (errs.length) fails++;
  await page.close();
}
await browser.close();
process.exit(fails ? 1 : 0);
