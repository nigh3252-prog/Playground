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

test('split GLB loads selected same-origin parts in order and verifies them before use', async () => {
  const {fetchSplitGLB} = await import('../asset-paths.mjs');
  const {createHash} = await import('node:crypto');
  const hash = value => createHash('sha256').update(value).digest('hex');
  const bytes = ['abc', 'def', 'ghi'].map(v => Buffer.from(v));
  const expected = Buffer.concat(bytes);
  const entry = {...output, id:'split-test', asset:null, originalFile:'Original_Test.glb',
    bytes:expected.length, sha256:hash(expected),
    parts:bytes.map((value,i) => ({asset:`assets/split-test-v1.glb.part${i+1}`, bytes:value.length, sha256:hash(value)}))};
  const calls = [];
  const controller = new AbortController();
  const stub = async (url, opts) => {
    assert.equal(url.origin, 'https://preview.example');
    assert.equal(opts.signal, controller.signal);
    assert.equal(opts.redirect, 'error');
    return new Response(bytes[calls.push(url.pathname)-1]);
  };
  assert.deepEqual(Buffer.from(await fetchSplitGLB(entry,page,controller.signal,stub)),expected);
  assert.deepEqual(calls,entry.parts.map(part => '/models/'+part.asset));
  for (const invalid of [
    {...entry, asset:'assets/split-test-v1.glb'},
    {...entry, parts:[entry.parts[1], entry.parts[0], entry.parts[2]]},
    {...entry, parts:entry.parts.map(part => ({...part,asset:'../outside.glb'}))},
    {...entry, originalFile:'../evil.glb'},
  ]) await assert.rejects(fetchSplitGLB(invalid,page,controller.signal,()=>assert.fail('invalid path fetched')), /Invalid split asset/);
  await assert.rejects(fetchSplitGLB(entry,page,controller.signal,async()=>new Response('bad')), /Part integrity/);
  await assert.rejects(fetchSplitGLB(entry,page,controller.signal,async()=>new Response('bad length')), /Part integrity/);
  calls.length = 0;
  await assert.rejects(fetchSplitGLB({...entry,sha256:hash('123456789')},page,controller.signal,stub), /GLB integrity/);
  calls.length = 0;
  await assert.rejects(fetchSplitGLB(entry,page,controller.signal,async (...args) => {
    const response = await stub(...args);
    controller.abort();
    return response;
  }), {name:'AbortError'});
  assert.equal(calls.length,1);
});

test('the staged Iguana + Crab parts reconstruct the locked original and its native animation rig', async () => {
  const {fetchSplitGLB} = await import('../asset-paths.mjs');
  const {readFile} = await import('node:fs/promises');
  const catalog = JSON.parse(await readFile(new URL('../catalog.json',import.meta.url)));
  const entry = catalog.models.find(m => m.id === 'warden-iguana-crab');
  assert.equal(catalog.models[0].id,'dot');
  assert.equal(entry.originalFile, 'Warden_Iguana_Crab.glb');
  assert.equal(entry.sha256, '4cad87c308f4ee2aaa45c58bad017865e0c568715b3582baaf818e451533cb5d');
  const buffer = await fetchSplitGLB(entry,page,new AbortController().signal,async url => {
    return new Response(await readFile(new URL('..'+url.pathname.slice('/models'.length),import.meta.url)));
  });
  const data = Buffer.from(buffer);
  assert.equal(data.length,16_509_180);
  const gltf = JSON.parse(data.toString('utf8',20,20+data.readUInt32LE(12)));
  assert.equal(gltf.skins.length,1);
  assert.equal(gltf.skins[0].joints.length,35);
  assert.deepEqual(gltf.nodes.filter(n=>n.skin===0).map(n=>n.name),['Iguana_Body','Iguana_Crab']);
  assert.deepEqual(gltf.animations.map(a=>a.name),['Reference_Pose','Idle_Breathe','Crawl_Preview','Crab_Settle']);
});
