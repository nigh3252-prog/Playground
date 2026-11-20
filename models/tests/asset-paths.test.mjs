import test from 'node:test';
import assert from 'node:assert/strict';
import {assetURL} from '../asset-paths.mjs';
const page = 'https://preview.example/models/?model=dot&v=v1';
const output = {id:'dot',version:'v1',asset:'assets/dot-v1.glb'};
const armory = {id:'armory-blasters-blaster-a', version:'v1', sourceCollection:'armory', sourceId:'blasters-blaster-a',asset:'../armory/models/blasters-blaster-a.glb'};
test('accepts the exact bench and recognized Armory asset paths on the same origin', () => {
  assert.equal(assetURL(output,page).href,'https://preview.example/models/assets/dot-v1.glb');
  assert.equal(assetURL(armory,page).href,'https://preview.example/armory/models/blasters-blaster-a.glb');
  assert.equal(assetURL(armory,'https://preview.example/sub/models/index.html').pathname,'/sub/armory/models/blasters-blaster-a.glb');
});
test('rejects unrecognized ids, injected traversal, escaping and mismatching source paths', () => {
  for (const entry of [
    {...output,asset:'https://preview.example/models/assets/dot-v1.glb'},
    {...output,asset:'//other.example/dot-v1.glb'},
    {...output,asset:'assets/%2e%2e/dot-v1.glb'},
    {...output,asset:'assets/dot-v1.glb?override=true'},
    {...output,asset:'../armory/models/blasters-blaster-a.glb'},
    {...armory,sourceId:'../outside',asset:'../armory/models/../outside.glb'},
    {...armory,id:'armory-blasters-blaster-b'},
    {...armory,asset:'../armory/models/blasters-blaster-b.glb'},
    {...armory,version:'v2',asset:'../armory/models/blasters-blaster-a.glb'},
  ]) assert.throws(()=>assetURL(entry,page), /Invalid asset location/);
});
