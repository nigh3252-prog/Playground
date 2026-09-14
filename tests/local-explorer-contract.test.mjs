import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url);
test('existing Watershed app owns local windows and keeps its normal stage renderer',async()=>{
 const app=await readFile(new URL('assets/world-lab/world-app-v6.mjs',root),'utf8');
 assert.match(app,/installLocalExplorer/);assert.match(app,/function setWindow\(/);
 assert.match(app,/get localWindow\(\)/);assert.match(app,/function currentBox\(\)\{if\(localWindow/);
 assert.match(app,/view\.setWorld\(world,box\)/);assert.match(app,/generateStagesV6/);
 assert.doesNotMatch(app,/generateLocalTerrain|local-terrain\.html|routeLocalDrainage/);
});
test('local explorer navigates the existing app, exposes resolution limits, and does not generate worlds',async()=>{
 const ui=await readFile(new URL('assets/world-lab/local-explorer.mjs',root),'utf8');
 assert.match(ui,/lab\.setWindow/);assert.match(ui,/source spacing/i);assert.match(ui,/localContext/);
 assert.doesNotMatch(ui,/generateParentTerrain|generateSolvedParent|generateLocalTerrain|valueNoise|routeLocalDrainage/);
});
