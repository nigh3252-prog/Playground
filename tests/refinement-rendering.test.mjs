import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {refinementColors} from '../assets/world-lab/refinement-rendering.mjs';

test('refined colors retain parent diagnostics and distinguish physical water and incised banks',()=>{
 const d={heightM:new Float32Array(3),sourceWeights:[[[0,1]],[[0,1]],[[0,1]]],slope:Float32Array.of(0,.7,.1),incisionM:Float32Array.of(0,0,3),bank:Float32Array.of(0,0,1),waterMask:Uint8Array.of(1,0,0),oceanWeight:new Float32Array(3),lakeWeight:new Float32Array(3)};
 const p=Uint8ClampedArray.of(100,140,90,255),c=refinementColors(d,p,{kind:'natural',stage:3});
 assert.ok(c[3]<150,'water is shaded as a flat surface');assert.notDeepEqual([...c.slice(4,8)],[...c.slice(8,12)]);
 const diagnostic=refinementColors(d,p,{kind:'tectonics',stage:3});
 for(let i=0;i<3;i++)assert.deepEqual([...diagnostic.slice(i*4,i*4+4)],[...p]);
});
test('the existing app integrates refinement and an explicit before/after comparison',async()=>{
 const app=await readFile(new URL('../assets/world-lab/world-app-v6.mjs',import.meta.url),'utf8'),ui=await readFile(new URL('../assets/world-lab/local-explorer.mjs',import.meta.url),'utf8');
 assert.match(app,/createRefinedWindow/);assert.match(app,/setLocalSurface/);assert.match(app,/get detailEnabled/);
 assert.match(ui,/localDetail/);assert.match(ui,/lab\.setDetail/);assert.match(ui,/localRiverSpot/);
});
