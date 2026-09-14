import test from 'node:test';
import assert from 'node:assert/strict';
import {AtlasView} from '../assets/world-lab/atlas-view.mjs';
import {WorldView} from '../assets/world-lab/world-view.mjs';
import {indexMesh} from '../assets/world-lab/world-mesh.mjs';

// Exercise real prototype methods without a browser/GPU constructor.
test('small-window camera targets the actual high-altitude surface, not a hardcoded 650 m',()=>{
 const old=globalThis.innerWidth;globalThis.innerWidth=1000;
 try{const v=Object.create(AtlasView.prototype);Object.assign(v,{size:.41,exag:1,map:false,surface:Float32Array.from([2800,2820,2840])});v.reset();assert.ok(v.target[1]>=2.8&&v.target[1]<=2.84);assert.ok(v.distance<1);}
 finally{if(old===undefined)delete globalThis.innerWidth;else globalThis.innerWidth=old;}
});
test('2D picking preserves the exact hit, not only a distant coarse node',()=>{
 const mesh={n:3,sizeKm:10,x:Float64Array.from([0,10,10,0]),z:Float64Array.from([0,0,10,10]),triangles:Uint32Array.from([0,1,2,0,2,3])};
 let node=-1;const v=Object.create(WorldView.prototype);Object.assign(v,{surface:new Float32Array(4),gl:null,size:10,spatial:indexMesh(mesh),canvas:{getBoundingClientRect:()=>({left:0,top:0})},fallbackFrame:{x:0,y:0,size:100},onPick:id=>{node=id;}});
 v.pick(37,43);assert.ok(node>=0);assert.deepEqual(v.lastPick,{x:3.7,z:4.3});
});
test('picking outside the visible 2D mesh does not retain a stale valid hit',()=>{
 const mesh={n:3,sizeKm:10,x:Float64Array.from([0,10,10,0]),z:Float64Array.from([0,0,10,10]),triangles:Uint32Array.from([0,1,2,0,2,3])};
 const v=Object.create(WorldView.prototype);Object.assign(v,{surface:new Float32Array(4),gl:null,size:10,spatial:indexMesh(mesh),canvas:{getBoundingClientRect:()=>({left:0,top:0})},fallbackFrame:{x:0,y:0,size:100},onPick:()=>{throw Error('outside pick');},lastPick:{x:5,z:5}});
 v.pick(140,80);assert.equal(v.lastPick,null);
});
test('3D ray picking retains precise coordinates on an elevated local surface',()=>{
 const mesh={n:3,sizeKm:1.2,x:Float64Array.from([0,1.2,1.2,0]),z:Float64Array.from([0,0,1.2,1.2]),triangles:Uint32Array.from([0,1,2,0,2,3])};
 let selected=-1;const v=Object.create(WorldView.prototype);Object.assign(v,{surface:new Float32Array(4).fill(3000),displayH:new Float32Array(4).fill(3),gl:{},size:1.2,spatial:indexMesh(mesh),canvas:{getBoundingClientRect:()=>({left:0,top:0})},width:400,height:400,yaw:0,pitch:1.565,distance:2,target:[0,3,0],onPick:id=>{selected=id;}});
 v.pick(200,200);assert.ok(selected>=0);assert.ok(Math.abs(v.lastPick.x-.6)<1e-5);assert.ok(Math.abs(v.lastPick.z-.6)<1e-5);
});
