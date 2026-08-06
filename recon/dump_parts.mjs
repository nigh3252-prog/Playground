// Dump the live runtime part tree from the shipped page for the part-coverage gate.
import { chromium } from 'playwright';
import fs from 'node:fs';
const b = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const p = await b.newPage();
await p.goto('file:///home/user/Playground/manta-delta-star-freighter.html', { waitUntil: 'load' });
await p.waitForFunction('window.__READY__ !== undefined', null, { timeout: 30000 });
const manifest = await p.evaluate(() => {
  const root = document.querySelector('canvas');
  // reach the model through the renderer's scene graph via the exposed runtime
  const scene = (window).__SCENE__;
  const parts = [];
  let unnamed = 0, integral = 0;
  scene.traverse((o) => {
    if (!(o.isMesh || o.isInstancedMesh)) return;
    if (o.userData.isInk) { integral++; return; }
    const c = o.userData.sculptComponent ?? o.parent?.userData?.sculptComponent;
    const tri = (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
    if (c?.id) parts.push({ name: c.id, kind: 'part', module: c.level, triangles: Math.round(tri) });
    else unnamed++;
  });
  return { model: 'manta-delta-star-freighter', parts, unnamedMeshes: unnamed, integralMeshes: integral };
});
fs.writeFileSync('/home/user/Playground/recon/parts.json', JSON.stringify(manifest, null, 2));
console.log('parts:', manifest.parts.length, 'unnamed:', manifest.unnamedMeshes, 'ink:', manifest.integralMeshes);
await b.close();
