import test from 'node:test';
import assert from 'node:assert/strict';
import {meshNormals} from '../assets/world-lab/world-view.mjs';
import {createLocalRenderMesh,localTextureSize} from '../assets/local-terrain/local-rendering.mjs';

test('local terrain texture supports WebGL1 mipmap sampling',()=>{
 const size=localTextureSize();
 assert.ok(size>=512,'texture retains enough diagnostic detail');
 assert.equal(size&(size-1),0,'texture dimensions must be powers of two');
});

test('local render triangles produce upward terrain normals',()=>{
 const mesh=createLocalRenderMesh(),normals=meshNormals(mesh,new Float32Array(mesh.x.length));
 assert.equal(mesh.n,257);
 assert.equal(mesh.sizeKm,1.2);
 for(let i=1;i<normals.length;i+=3)assert.ok(normals[i]>.99,`normal ${Math.floor(i/3)} pointed down`);
});
