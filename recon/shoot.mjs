// Render each review viewpoint headlessly and write a PNG + a stats JSON.
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
await new Promise((r) => server.listen(8712, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:8712';
const passId = process.argv[2] ?? 'blockout';
const views = (process.argv[3] ?? 'reference-match,three-quarter-high,planform-top,bow-low').split(',');
const stripped = process.argv[4] === 'stripped';
const outDir = path.join(here, 'renders', passId);
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 800 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });

const stats = {};
for (const view of views) {
  const url = `${BASE}/recon/harness/index.html?view=${view}&w=1600&h=800${stripped ? '&stripped=1' : ''}${process.env.GIZMO ? '&gizmo=1' : ''}${view === 'reference-match' ? '&matchframe=1' : ''}`;
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction('window.__READY__ !== undefined', null, { timeout: 30000 });
  const s = await page.evaluate('window.__READY__');
  stats[view] = s;
  const file = path.join(outDir, `${view}${stripped ? '-stripped' : ''}.png`);
  await page.locator('canvas').screenshot({ path: file });
  console.log(`${view}: ${s.meshes} meshes, ${s.drawCalls} draws, ${s.triangles} tris -> ${file}`);
}
if (errs.length) console.log('PAGE ERRORS:\n' + errs.slice(0, 8).join('\n'));
fs.writeFileSync(path.join(outDir, 'stats.json'), JSON.stringify(stats, null, 2));
await browser.close();
server.close();
