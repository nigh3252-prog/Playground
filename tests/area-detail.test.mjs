import test from 'node:test';
import assert from 'node:assert/strict';

import * as module from '../assets/world-lab/area-detail.mjs';
const site=(id,x,z,radiusKm=2)=>({id,point:{x,z},radiusKm});

test('area requests include city edges outside the camera and use portrait height',()=>{
 assert.equal(typeof module.planAreaDetail,'function','area request planner exists');
 const viewport={center:{x:500,z:500},kmAcross:30,kmHigh:60};
 const request=module.planAreaDetail([site(0,500,500),site(1,521,500,4),site(2,500,527),site(3,650,500)],viewport,'streets');
 assert.equal(request.allowed,true);
 assert.deepEqual(request.siteIds,[0,1,2]);
 assert.deepEqual(viewport,{center:{x:500,z:500},kmAcross:30,kmHigh:60});
});

test('broad and dense detail requests are bounded before any geometry work',()=>{
 assert.equal(typeof module.planAreaDetail,'function','area request planner exists');
 const broad=module.planAreaDetail([], {center:{x:0,z:0},kmAcross:4800,kmHigh:4800},'metro');
 assert.equal(broad.allowed,false);assert.match(broad.reason,/zoom/i);assert.deepEqual(broad.siteIds,[]);
 const dense=module.planAreaDetail(Array.from({length:20},(_,i)=>site(i,i/10,0)),{center:{x:0,z:0},kmAcross:20,kmHigh:20},'streets');
 assert.equal(dense.allowed,false);assert.deepEqual(dense.siteIds,[]);
 assert.equal(module.planAreaDetail([],{center:{x:200,z:300},kmAcross:20,kmHigh:40},'streets').allowed,true,'empty countryside is a valid area');
});

test('overlapping requests keep stable site identity and reject nonfinite viewports',()=>{
 assert.equal(typeof module.planAreaDetail,'function','area request planner exists');
 const sites=[site(12,500,500),site(4,505,500)];
 const a=module.planAreaDetail(sites,{center:{x:500,z:500},kmAcross:50,kmHigh:60},'metro');
 const b=module.planAreaDetail([...sites].reverse(),{center:{x:503,z:500},kmAcross:50,kmHigh:60},'metro');
 assert.deepEqual(a.siteIds,b.siteIds);
 assert.equal(module.planAreaDetail(sites,{center:{x:NaN,z:0},kmAcross:1},'streets').allowed,false);
});
