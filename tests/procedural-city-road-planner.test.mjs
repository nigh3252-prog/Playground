// Run: node --test tests/procedural-city-road-planner.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {createAnyAnglePlanner} from '../assets/city-lab/road-planner.mjs';

test('flat terrain produces a direct arbitrary-angle route',()=>{
  const p=createAnyAnglePlanner({worldSize:410,cells:32,heightAt:()=>0,getWaterLevel:()=>-5});
  const path=p.plan({ix:0,iz:5},{ix:32,iz:21},{type:'arterial'});
  assert.equal(path.length,2);
  const dx=path[1].x-path[0].x,dz=path[1].z-path[0].z;
  const degrees=Math.atan2(dz,dx)*180/Math.PI;
  assert.ok(Math.abs(degrees-26.565)<0.2);
});

test('deep water causes a small number of meaningful bends, not grid-step chatter',()=>{
  const heightAt=(x,z)=>Math.abs(z)<35&&Math.abs(x)<95?-12:0;
  const p=createAnyAnglePlanner({worldSize:410,cells:32,heightAt,getWaterLevel:()=>-5});
  const path=p.plan({ix:2,iz:16},{ix:30,iz:16},{type:'arterial'});
  assert.ok(path.length>=3);
  assert.ok(path.length<10,`too many bends: ${path.length}`);
  assert.ok(path.some(q=>Math.abs(q.z)>35));
});

test('planner is deterministic and finite across varied terrain waves',()=>{
  for(let s=0;s<20;s++){
    const h=(x,z)=>Math.sin((x+s*7)/47)*5+Math.cos((z-s*3)/61)*3;
    const p=createAnyAnglePlanner({worldSize:410,cells:32,heightAt:h,getWaterLevel:()=>-5});
    const a=p.plan({ix:0,iz:4+s%8},{ix:32,iz:22-s%7},{type:'collector'});
    const b=p.plan({ix:0,iz:4+s%8},{ix:32,iz:22-s%7},{type:'collector'});
    assert.deepEqual(a,b);
    assert.ok(a.every(q=>Number.isFinite(q.x)&&Number.isFinite(q.z)));
    assert.ok(a.length<15);
  }
});
