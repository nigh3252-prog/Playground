import test from 'node:test';import assert from 'node:assert/strict';
import {solveBasin,retentionFor,resolveSurfaceWater,topologicalOrder} from '../assets/world-lab/water-balance.mjs';
const lowLeak={leakMYear:.05,headLeakPerM:.002,floorLeakFactor:.3},highLeak={leakMYear:12,headLeakPerM:.02,floorLeakFactor:.6};
const bowl=rain=>Array.from({length:12},(_,i)=>({height:i*6,area:1,rain,temp:14,cellRelief:2}));
const near=(a,b,tol=1e-4)=>assert.ok(Math.abs(a-b)<=tol,`${a} != ${b}`);
test('a dry, permeable caldera is not filled to its spill height',()=>{const b=solveBasin(bowl(150),85,0,highLeak);assert.equal(b.status,'dry');assert.equal(b.level,0);assert.equal(b.outflowM3Year,0);});
test('a wet tight basin can overflow and exports only its surplus',()=>{const b=solveBasin(bowl(1400),85,30e6,lowLeak);assert.equal(b.status,'overflowing');assert.equal(b.level,85);assert.ok(b.outflowM3Year>0);near(b.supplyM3Year-b.evaporationM3Year-b.seepageM3Year,b.outflowM3Year);});
test('a retained lake equilibrates below the outlet rim',()=>{const b=solveBasin(bowl(700),85,4e6,{leakMYear:.8,headLeakPerM:.025,floorLeakFactor:.1});assert.equal(b.status,'retained');assert.ok(b.level>0&&b.level<85);near(b.supplyM3Year,b.evaporationM3Year+b.seepageM3Year,.01);});
test('more inflow cannot reduce standing water in a fixed basin',()=>{const a=solveBasin(bowl(700),85,2e6,lowLeak),b=solveBasin(bowl(700),85,10e6,lowLeak);assert.ok(b.level>=a.level);});
test('no rainfall or upstream supply does not invent a lake',()=>{const b=solveBasin(bowl(0),85,0,lowLeak);assert.equal(b.status,'dry');});
test('geology leakage is deterministic and volcanic values are generally higher',()=>{assert.deepEqual(retentionFor(3,21),retentionFor(3,21));assert.ok(retentionFor(3,21).leakMYear>retentionFor(1,21).leakMYear);});
function fixture(){
 const edges=[[1],[0,2,4],[1,3],[2],[1,5],[4]],offsets=new Uint32Array(7),ns=[],ds=[];edges.forEach((e,i)=>{offsets[i]=ns.length;e.forEach(j=>{ns.push(j);ds.push(1);});});offsets[6]=ns.length;
 return{config:{seed:31,sizeKm:600},n:6,stepKm:1,stage:2,mesh:{x:Float64Array.from([0,1,2,3,1,1]),z:Float64Array.from([0,0,0,0,1,2]),nodeArea:new Float64Array(6).fill(1),offsets,neighbors:Uint32Array.from(ns),distances:Float64Array.from(ds),boundary:Uint8Array.from([1,0,0,0,0,1])},height:Float32Array.from([110,10,20,0,50,-1]),slope:new Float32Array(6).fill(.01),ocean:Uint8Array.from([0,0,0,0,0,1]),filled:Float64Array.from([110,100,100,100,50,0]),rank:Int32Array.from([5,2,3,4,1,0]),order:Int32Array.from([5,4,1,2,3,0]),receiver:Int32Array.from([1,4,1,2,5,-1]),lakeId:Int32Array.from([-1,0,0,0,-1,-1]),lake:Uint8Array.from([0,1,1,1,0,0]),lakeBodies:[{id:0,level:100,history:3}],riverThresholdKm2:.1,landHistory:new Uint8Array(6).fill(3)};
}
test('closed surface routing terminates inland, with no phantom downstream flow',()=>{
 const w=fixture(),before=w.receiver.slice(),out=resolveSurfaceWater(w,{rainfall:new Float32Array(6).fill(100),temperature:new Float32Array(6).fill(14)});
 assert.equal(out.basinWater[0].status,'dry');assert.equal(out.receiver[3],-1);assert.equal(out.lake[3],0);assert.equal(out.waterState[3],3);assert.equal(out.waterSurface[1],w.height[1]);assert.equal(out.runoff[3],0);assert.ok(out.area[4]<4);assert.deepEqual(w.receiver,before);topologicalOrder(out.receiver);
});
test('actual water retains hypothetical spill diagnostics separately',()=>{const w=fixture(),out=resolveSurfaceWater(w,{rainfall:new Float32Array(6).fill(100),temperature:new Float32Array(6).fill(14)});assert.equal(out.potentialSpill[3],100);assert.equal(out.filled[3],0);assert.equal(out.potentialBasinId[3],0);});
test('surface flow and area remain nonnegative with no cycles',()=>{for(const rain of [100,700,2000]){const out=resolveSurfaceWater(fixture(),{rainfall:new Float32Array(6).fill(rain),temperature:new Float32Array(6).fill(8)});assert.ok(out.runoff.every(v=>v>=0&&Number.isFinite(v)));assert.ok(out.area.every(v=>v>=0));topologicalOrder(out.receiver);}});
test('cycles are caught instead of silently being accumulated',()=>assert.throws(()=>topologicalOrder(Int32Array.from([1,0]))));
