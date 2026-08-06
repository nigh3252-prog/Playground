import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1600, height: 800 } });
await p.goto('http://127.0.0.1:8799/recon/harness/index.html?view=reference-match&w=1600&h=800&matchframe=1', { waitUntil: 'load' }).catch(()=>{});
await b.close();
