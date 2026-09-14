import test from 'node:test';
import assert from 'node:assert/strict';
import {createTerrainMesh} from '../assets/world-lab/world-mesh.mjs';
import {chooseLocalSite} from '../assets/local-terrain/local-site.mjs';

function fixtureParent({oceanEverywhere=false}={}){
  const n=17,sizeKm=100,mesh=createTerrainMesh(n,sizeKm,87),count=n*n;
  const height=new Float32Array(count),ocean=new Uint8Array(count),uplift=new Float32Array(count),subsidence=new Float32Array(count),tectonicAge=new Float32Array(count);
  for(let i=0;i<count;i++){
    height[i]=180+mesh.x[i]*1.7-mesh.z[i]*.65+32*Math.sin(mesh.x[i]/13)*Math.cos(mesh.z[i]/17);
    ocean[i]=oceanEverywhere?1:0;
    uplift[i]=.35+.2*Math.sin(mesh.x[i]/19);
    subsidence[i]=.08;
    tectonicAge[i]=.4+.2*Math.cos(mesh.z[i]/21);
  }
  return{
    version:'regional-world-v6',n,mesh,height,ocean,
    config:{seed:123456,n,sizeKm,continentCount:3,crustScale:1.15,relief:1,rain:1,wind:'west',source:'generated'},
    parentDomain:{sizeKm,windowKm:70,seed:123456},
    geology:{tectonics:{history:{uplift,subsidence,tectonicAge}}}
  };
}

test('site selection is deterministic and keeps the 410 m focus on land',()=>{
  const parent=fixtureParent();
  const a=chooseLocalSite(parent,{windowIndex:0,siteIndex:0});
  const b=chooseLocalSite(parent,{windowIndex:0,siteIndex:0});
  assert.deepEqual(a,b);
  assert.equal(a.ocean,false);
  assert.equal(a.parentSeed,123456);
  assert.ok(a.centerXKm>=.205&&a.centerXKm<=99.795);
  assert.ok(a.centerZKm>=.205&&a.centerZKm<=99.795);
  assert.ok(Number.isFinite(a.elevationM));
  assert.ok(Number.isFinite(a.downslopeBearingRad));
});

test('site index cycles reproducibly through distinct ranked candidates',()=>{
  const parent=fixtureParent();
  const first=chooseLocalSite(parent,{windowIndex:0,siteIndex:0});
  const second=chooseLocalSite(parent,{windowIndex:0,siteIndex:1});
  assert.notDeepEqual([first.centerXKm,first.centerZKm],[second.centerXKm,second.centerZKm]);
  assert.deepEqual(second,chooseLocalSite(parent,{windowIndex:0,siteIndex:1}));
});

test('site selection rejects parents without a usable terrestrial candidate',()=>{
  assert.throws(()=>chooseLocalSite(fixtureParent({oceanEverywhere:true})),/No usable local terrain site/);
});

test('site selection rejects malformed parent inputs explicitly',()=>{
  assert.throws(()=>chooseLocalSite({}),/valid solved parent world/);
});
