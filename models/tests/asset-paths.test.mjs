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

test('Warden configures the real Meshopt decoder before parsing without affecting ordinary selections', async () => {
  const {parseSelectedGLB} = await import('../parse-selected-glb.mjs');
  const {readFile} = await import('node:fs/promises');
  const data = await readFile(new URL('../assets/warden-v1.glb', import.meta.url));
  const gltf = JSON.parse(data.toString('utf8',20,20+data.readUInt32LE(12)));
  assert(gltf.extensionsRequired.includes('EXT_meshopt_compression'));
  assert.equal(new Set(gltf.skins.flatMap(s=>s.joints)).size,50);
  const walk = gltf.animations.find(clip => clip.name === 'Walk_Loop');
  assert(walk?.channels.length > 0);
  const rotation = walk.channels.find(channel => channel.target.path === 'rotation'
    && gltf.accessors[walk.samplers[channel.sampler].output].count > 2);
  assert(rotation);
  const output = gltf.accessors[walk.samplers[rotation.sampler].output];
  const view = gltf.bufferViews[output.bufferView].extensions.EXT_meshopt_compression;
  const binStart=20+data.readUInt32LE(12)+8;
  const segment=data.subarray(binStart+view.byteOffset,binStart+view.byteOffset+view.byteLength);
  let decoder;
  const loader = {
    setMeshoptDecoder(value) {decoder = value;},
    async parseAsync() {
      assert(decoder?.supported);
      return decoder.decodeGltfBufferAsync(view.count,view.byteStride,segment,view.mode,view.filter);
    },
  };
  const decoded=await parseSelectedGLB(loader,data,'https://preview.example/models/assets/','meshopt');
  assert.equal(decoded.length,view.count*view.byteStride);
  const initial=decoded.subarray(0,view.byteStride);
  assert(decoded.some((byte,index)=>byte!==initial[index%view.byteStride]),'decoded walk rotation changes across frames');
  const plain = await parseSelectedGLB({parseAsync:value=>value},data,'https://preview.example/models/assets/');
  assert.equal(plain,data);
});
