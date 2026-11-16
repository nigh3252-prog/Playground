import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const hub = path.resolve('hub');
const data = JSON.parse(fs.readFileSync(path.join(hub, 'catalog.json'), 'utf8'));
const ids = new Set();
for (const item of data.entries) {
  assert.match(item.id, /^[a-z0-9-]+$/);
  assert(!ids.has(item.id), 'duplicate ID: ' + item.id);
  ids.add(item.id);
  assert(item.title && item.summary && Array.isArray(item.tags), 'metadata missing for ' + item.id);
  assert(!/^https?:/i.test(item.path), 'external previews not in initial catalog');
  assert(fs.existsSync(path.resolve(hub, item.path)), 'missing experiment: ' + item.path);
}
const html = fs.readFileSync(path.join(hub,'index.html'),'utf8');
const js = fs.readFileSync(path.join(hub,'hub.js'),'utf8');
for (const id of ['catalog','player','playerFrame','playerToggle','playerMenu','noteInput','saveNote','surprise','exportData']) {
  assert(html.includes('id="' + id + '"'), 'missing UI element: ' + id);
}
for (const event of ['playground:metric', 'visibilitychange', 'pagehide', 'localStorage', 'requestFullscreen']) {
  assert(js.includes(event), 'missing behavior: ' + event);
}
console.log('Playground Hub smoke check passed: ' + data.entries.length + ' valid entries');
