// Sweep the reference-match pitch and report silhouette IoU against the star-free
// reference, so the review camera is solved from evidence instead of guessed.
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': MIME[path.extname(p)] ?? 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(8713, '127.0.0.1', r));

const outDir = path.join(here, 'renders', 'sweep');
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 800 } });

for (const pitch of (process.argv[2] ?? '3,7,11,15,19').split(',')) {
  for (const yaw of (process.argv[3] ?? '4').split(',')) {
    const url = `http://127.0.0.1:8713/recon/harness/index.html?view=reference-match&w=1600&h=800&stripped=1&matchframe=1&pitch=${pitch}&yaw=${yaw}`;
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction('window.__READY__ !== undefined', null, { timeout: 30000 });
    await page.locator('canvas').screenshot({ path: path.join(outDir, `p${pitch}_y${yaw}.png`) });
    console.log(`rendered pitch=${pitch} yaw=${yaw}`);
  }
}
await browser.close();
server.close();
