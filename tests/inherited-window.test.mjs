import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeWindow,windowAround,clipRiverEdges,createInheritedWindow} from '../assets/world-lab/inherited-window.mjs';

function parent(){
 const mesh={n:3,sizeKm:100,stepKm:50,x:Float64Array.from([0,100,100,0,37]),z:Float64Array.from([0,0,100,100,43]),triangles:Uint32Array.from([0,1,4,1,2,4,2,3,4,3,0,4])};
 return {version:'fixture-parent',stage:4,config:{seed:17,sizeKm:100},parentDomain:{windowKm:60},stepKm:50,mesh,
 height:Float32Array.from(mesh.x,(x,i)=>700+2*x+3*mesh.z[i]),ocean:new Uint8Array(5),lake:new Uint8Array(5),waterSurface:Float32Array.from(mesh.x,(x,i)=>700+2*x+3*mesh.z[i]),
 river:Uint8Array.from([0,0,1,0,1]),receiver:Int32Array.from([-1,-1,4,-1,0]),area:Float64Array.from([19000,0,12345,0,15000])};
}
const close=(a,b,eps=2e-4)=>assert.ok(Math.abs(a-b)<=eps,`${a} != ${b}`);
test('coordinate windows clamp within parent without moving the selected center unnecessarily',()=>{
 assert.deepEqual(windowAround(100,37,43,1.2),{x:36.4,z:42.4,size:1.2});
 assert.deepEqual(windowAround(100,0,100,.41),{x:0,z:99.59,size:.41});
 assert.throws(()=>normalizeWindow(100,{x:NaN,z:2,size:1.2}),/finite|invalid/i);
 assert.throws(()=>normalizeWindow(100,{x:0,z:0,size:0}),/size|width|invalid/i);
 assert.throws(()=>windowAround(100,Infinity,3,1.2),/finite|invalid/i);
});
test('local heights inherit exact parent triangles, not one height/slope summary',()=>{
 const w=parent(),out=createInheritedWindow(w,{x:30,z:40,size:12});
 for(let i=0;i<out.mesh.x.length;i++){
  const x=out.mesh.x[i]+out.window.x,z=out.mesh.z[i]+out.window.z;
  close(out.heightM[i],700+2*x+3*z);
  close(out.sourceWeights[i].reduce((n,[id,weight])=>n+w.height[id]*weight,0),out.heightM[i]);
 }
 assert.equal(out.source.seed,17);assert.equal(out.source.spacingKm,50);
 assert.equal(out.source.routing,'inherited-parent-edges');
});
test('410 m windows inside a parent face still render and disclose the source limit',()=>{
 const w=parent(),out=createInheritedWindow(w,windowAround(100,50,50,.41));
 assert.ok(out.mesh.triangles.length>=3);assert.ok(out.metrics.reliefM>0);
 assert.ok(out.warnings.some(s=>/resolution|spacing|detail/i.test(s)));
 assert.ok(out.heightM.every(Number.isFinite));
});
test('rivers crossing a window with both original endpoints outside retain direction and upstream area',()=>{
 const w=parent(),box={x:62,z:67,size:10},edges=clipRiverEdges(w,box);
 assert.equal(edges.length,1);const e=edges[0];
 assert.equal(e.from,2);assert.equal(e.to,4);assert.equal(e.upstreamAreaKm2,12345);
 assert.ok(e.t0>0&&e.t1<1);assert.equal(e.enters,true);assert.equal(e.exits,true);
 const [a,b]=e.points;close((b[1]-a[1])/(b[0]-a[0]),57/63,1e-9);
 for(const [x,z] of e.points){assert.ok(x>=62-1e-8&&x<=72+1e-8);assert.ok(z>=67-1e-8&&z<=77+1e-8);}
});
test('overlapping views share coordinates, elevations, and the same source river edge',()=>{
 const w=parent(),a=createInheritedWindow(w,{x:30,z:30,size:20}),b=createInheritedWindow(w,{x:35,z:35,size:20});
 assert.ok(a.rivers.some(e=>e.from===4&&e.to===0));assert.ok(b.rivers.some(e=>e.from===4&&e.to===0));
 for(const out of [a,b])for(let i=0;i<out.heightM.length;i++)close(out.heightM[i],700+2*(out.mesh.x[i]+out.window.x)+3*(out.mesh.z[i]+out.window.z));
});
test('window export leaves every parent field and graph byte-for-byte unchanged',()=>{
 const w=parent(),before=structuredClone(w);
 for(const size of [60,12,1.2,.41])createInheritedWindow(w,windowAround(100,37,43,size));
 assert.deepEqual(w,before);
});
test('lake and ocean coverage retain interpolated source masks rather than a center-node decision',()=>{
 const w=parent();w.lake[4]=1;const out=createInheritedWindow(w,{x:30,z:40,size:12});
 assert.ok(out.lakeWeight.some(v=>v>0&&v<1));
 for(let i=0;i<out.lakeWeight.length;i++)close(out.lakeWeight[i],out.sourceWeights[i].reduce((a,[id,v])=>a+w.lake[id]*v,0),1e-6);
});
test('stage-one export has no fabricated water network',()=>{
 const w=parent();w.stage=1;delete w.receiver;delete w.river;delete w.area;
 assert.deepEqual(createInheritedWindow(w,{x:30,z:40,size:12}).rivers,[]);
});
test('non-planar parent ridges survive the local window rather than collapsing to a sampled plane',()=>{
 const w=parent();w.height[4]=1800;w.waterSurface[4]=1800;
 const out=createInheritedWindow(w,{x:20,z:20,size:50});
 const center=Array.from(out.mesh.x).findIndex((x,i)=>Math.abs(x+20-37)<1e-7&&Math.abs(out.mesh.z[i]+20-43)<1e-7);
 assert.ok(center>=0);assert.equal(out.heightM[center],1800);
 assert.ok(out.heightM.every((v,i)=>i===center||v<1800));
 for(let i=0;i<out.heightM.length;i++)close(out.heightM[i],out.sourceWeights[i].reduce((h,[id,v])=>h+w.height[id]*v,0));
});
