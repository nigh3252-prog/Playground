import test from 'node:test';
import assert from 'node:assert/strict';
import {createTerrainMesh} from '../assets/world-lab/world-mesh.mjs';
import {generateLocalTerrain} from '../assets/local-terrain/local-terrain.mjs';

function fixtureParent(){
 const n=17,sizeKm=100,mesh=createTerrainMesh(n,sizeKm,87),count=n*n;
 const height=new Float32Array(count),ocean=new Uint8Array(count),lake=new Uint8Array(count),waterSurface=new Float32Array(count),rainfall=new Float32Array(count),uplift=new Float32Array(count),subsidence=new Float32Array(count),tectonicAge=new Float32Array(count);
 for(let i=0;i<count;i++){
  height[i]=240+mesh.x[i]*1.4-mesh.z[i]*.85+42*Math.sin(mesh.x[i]/14)*Math.cos(mesh.z[i]/18);
  waterSurface[i]=height[i];rainfall[i]=780+180*Math.sin(mesh.z[i]/20);uplift[i]=.35+.2*Math.sin(mesh.x[i]/19);subsidence[i]=.08;tectonicAge[i]=.4+.2*Math.cos(mesh.z[i]/21);
 }
 return{version:'regional-world-v6',n,mesh,height,ocean,lake,waterSurface,rainfall,config:{seed:123456,n,sizeKm,continentCount:3,crustScale:1.15,relief:1,rain:1,wind:'west',source:'generated'},parentDomain:{sizeKm,windowKm:70,seed:123456},geology:{tectonics:{history:{uplift,subsidence,tectonicAge}}}};
}

test('local terrain has the fixed physical grid and centered focus contract',()=>{
 const tile=generateLocalTerrain(fixtureParent(),{siteIndex:0});
 assert.deepEqual(tile.grid,{width:257,height:257,sizeM:1200,spacingM:4.6875,minXM:-600,maxXM:600,minZM:-600,maxZM:600});
 assert.deepEqual(tile.focus,{centerXM:0,centerZM:0,sizeM:410});
 assert.equal(tile.heightM.length,257*257);
 assert.equal(tile.version,'local-terrain-v1');
});

test('terrain is deterministic, finite, parent anchored, and does not mutate its parent',()=>{
 const parent=fixtureParent(),before=Array.from(parent.height);
 const a=generateLocalTerrain(parent,{siteIndex:0}),b=generateLocalTerrain(parent,{siteIndex:0});
 assert.deepEqual(Array.from(a.heightM),Array.from(b.heightM));
 assert.ok(a.heightM.every(Number.isFinite));
 assert.ok(Math.abs(a.heightM[128*257+128]-a.anchor.elevationM)<35);
 assert.deepEqual(Array.from(parent.height),before);
});

test('every sampled receiver path terminates at a boundary outlet without climbing',()=>{
 const tile=generateLocalTerrain(fixtureParent(),{siteIndex:0});
 for(let start=0;start<tile.receiver.length;start+=977){
  let node=start;
  for(let hops=0;hops<tile.receiver.length;hops++){
   const next=tile.receiver[node];
   if(next<0){const row=Math.floor(node/257),col=node%257;assert.ok(row===0||row===256||col===0||col===256);break;}
   assert.ok(tile.conditionedHeightM[next]<=tile.conditionedHeightM[node]+1e-3);
   node=next;if(hops===tile.receiver.length-1)assert.fail('receiver cycle');
  }
 }
 assert.ok(tile.drainage.outlets.length>0);
});

test('derived arrays use physical masks consistently',()=>{
 const tile=generateLocalTerrain(fixtureParent(),{siteIndex:0}),count=257*257;
 for(const key of ['conditionedHeightM','slope','ruggedness','waterMask','surfaceClass','walkability','receiver','flowAccumulation'])assert.equal(tile[key].length,count,key);
 assert.ok(tile.flowAccumulation.every(value=>Number.isFinite(value)&&value>=0));
 for(let i=0;i<count;i++)if(tile.waterMask[i])assert.equal(tile.walkability[i],0);
 assert.ok(tile.metrics.walkableFraction>0&&tile.metrics.walkableFraction<=1);
 assert.ok(tile.metrics.maxElevationM>tile.metrics.minElevationM);
});

test('different site indices produce distinct local terrain',()=>{
 const parent=fixtureParent(),a=generateLocalTerrain(parent,{siteIndex:0}),b=generateLocalTerrain(parent,{siteIndex:1});
 assert.notDeepEqual([a.anchor.centerXKm,a.anchor.centerZKm],[b.anchor.centerXKm,b.anchor.centerZKm]);
 assert.notEqual(a.heightM[128*257+128],b.heightM[128*257+128]);
});

test('terrain generation rejects malformed parent inputs',()=>{
 assert.throws(()=>generateLocalTerrain({}),/valid solved parent world/);
});
