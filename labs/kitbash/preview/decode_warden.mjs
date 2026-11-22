// Decode the original Warden's compressed buffer views for Blender review.
// No geometry, materials, skinning, or animation changes are made.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MeshoptDecoder } from '../../../models/vendor/meshoptimizer/meshopt_decoder.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const source=path.resolve(here,'../../../models/assets/warden-v1.glb');
const output=path.join(here,'warden-v1-decoded.glb');
const blob=fs.readFileSync(source);
const jsonLength=blob.readUInt32LE(12);
const doc=JSON.parse(blob.subarray(20,20+jsonLength).toString('utf8'));
const binary=blob.subarray(28+jsonLength);
await MeshoptDecoder.ready;
let cursor=0;const chunks=[];
for (const view of doc.bufferViews) {
 const ext=view.extensions?.EXT_meshopt_compression;
 let decoded;
 if (ext) {
  if(ext.buffer!==0)throw new Error('Unexpected compressed source buffer');
  decoded=Buffer.alloc(ext.count*ext.byteStride);
  MeshoptDecoder.decodeGltfBuffer(decoded,ext.count,ext.byteStride,binary.subarray(ext.byteOffset||0,(ext.byteOffset||0)+ext.byteLength),ext.mode,ext.filter||'NONE');
  delete view.extensions.EXT_meshopt_compression;
  if(Object.keys(view.extensions).length===0)delete view.extensions;
 } else {
  if(view.buffer!==0)throw new Error('Unexpected virtual fallback buffer view');
  decoded=Buffer.from(binary.subarray(view.byteOffset||0,(view.byteOffset||0)+view.byteLength));
 }
 const padded=Buffer.alloc(Math.ceil(decoded.length/4)*4);decoded.copy(padded);
 view.buffer=0;view.byteOffset=cursor;view.byteLength=decoded.length;
 chunks.push(padded);cursor+=padded.length;
}
doc.buffers=[{byteLength:cursor}];
for(const field of ['extensionsUsed','extensionsRequired']) {
 doc[field]=(doc[field]||[]).filter(v=>v!=='EXT_meshopt_compression');
 if(doc[field].length===0)delete doc[field];
}
doc.asset.extras={...(doc.asset.extras||{}),reviewConversion:'Lossless EXT_meshopt_compression decode for Blender import; original source unchanged.'};
const j=Buffer.from(JSON.stringify(doc));const jp=Buffer.alloc(Math.ceil(j.length/4)*4,0x20);j.copy(jp);
const h=Buffer.alloc(20);h.writeUInt32LE(0x46546c67,0);h.writeUInt32LE(2,4);h.writeUInt32LE(28+jp.length+cursor,8);h.writeUInt32LE(jp.length,12);h.writeUInt32LE(0x4e4f534a,16);
const bh=Buffer.alloc(8);bh.writeUInt32LE(cursor,0);bh.writeUInt32LE(0x004e4942,4);
fs.writeFileSync(output,Buffer.concat([h,jp,bh,...chunks]));
console.log(JSON.stringify({source,output,decodedBytes:cursor,bufferViews:doc.bufferViews.length}));
