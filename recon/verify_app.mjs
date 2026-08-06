// Load the shipped standalone HTML in a real browser, exercise its controls, and screenshot.
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';

const file = path.resolve('/home/user/Playground/manta-delta-star-freighter.html');
const out = path.resolve('/home/user/Playground/recon/renders/app');
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 810 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });

await page.goto(`file://${file}`, { waitUntil: 'load' });
await page.waitForFunction('window.__READY__ !== undefined', null, { timeout: 30000 });
const ready = await page.evaluate('window.__READY__');
console.log('runtime:', JSON.stringify(ready));

// stop the auto-orbit so shots are deterministic
await page.click('#settingsBtn');
await page.click('#spinBtn');

for (const [name, sel] of [['reference', '[data-view="6,16"]'], ['three-quarter', '[data-view="42,30"]'], ['planform', '[data-view="0,88"]']]) {
  await page.click(sel);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(out, `${name}.png`) });
}

// exercise the mechanisms and the assembly gate
await page.click('[data-view="42,30"]');
await page.locator('#fold').fill('100');
await page.locator('#jettison').fill('60');
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(out, 'mechanisms.png') });

await page.locator('#fold').fill('0');
await page.locator('#jettison').fill('0');
await page.locator('#explode').fill('75');
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(out, 'exploded.png') });

// part picking
await page.locator('#explode').fill('0');
await page.click('#closeBtn');
await page.waitForTimeout(300);
await page.mouse.click(720, 420);
await page.waitForTimeout(250);
const labelVisible = await page.locator('#label').isVisible();
const labelText = labelVisible ? (await page.locator('#label').innerText()).replace(/\n/g, ' | ') : '(no hit)';
console.log('part pick:', labelText);
await page.screenshot({ path: path.join(out, 'picked.png') });

console.log(errs.length ? 'PAGE ERRORS:\n' + errs.slice(0, 6).join('\n') : 'no page errors');
await browser.close();
