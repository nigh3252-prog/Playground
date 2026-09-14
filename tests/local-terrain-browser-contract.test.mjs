import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createTerrainMesh} from '../assets/world-lab/world-mesh.mjs';
import {generateLocalTerrain,serializeLocalTerrain} from '../assets/local-terrain/local-terrain.mjs';
import {generateSolvedParent} from '../assets/local-terrain/local-parent.mjs';

function fixtureParent(){
 const n=17,sizeKm=100,mesh=createTerrainMesh(n,sizeKm,19),count=n*n,height=new Float32Array(count),ocean=new Uint8Array(count);
 for(let i=0;i<count;i++)height[i]=300+mesh.x[i]*1.2-mesh.z[i]*.5+25*Math.sin(mesh.x[i]/16);
 return{version:'regional-world-v6',n,mesh,height,ocean,config:{seed:9981,n,sizeKm,continentCount:3,crustScale:1.15,relief:1,rain:1,wind:'west',source:'generated'},parentDomain:{sizeKm,windowKm:70,seed:9981},geology:{tectonics:{history:{}}}};
}

test('serialized terrain retains physical dimensions, arrays, and provenance',()=>{
 const parent=fixtureParent(),payload=serializeLocalTerrain(generateLocalTerrain(parent)),parsed=JSON.parse(JSON.stringify(payload));
 assert.equal(parsed.version,'local-terrain-v1');
 assert.equal(parsed.grid.sizeM,1200);
 assert.equal(parsed.grid.spacingM,4.6875);
 assert.equal(parsed.heightM.length,257*257);
 assert.equal(parsed.anchor.parentSeed,parent.config.seed);
 assert.ok(Array.isArray(parsed.drainage.outlets));
});

test('the local lab exposes accessible generation and diagnosis controls',async()=>{
 const html=await readFile('local-terrain.html','utf8');
 for(const id of ['terrain','seed','continentCount','crustScale','windowIndex','siteIndex','mapMode','nextSite','copyLink','exportTerrain'])assert.match(html,new RegExp(`id=["']${id}["']`),id);
 assert.match(html,/aria-label="Local terrain/);
 assert.match(html,/assets\/local-terrain\/local-terrain-app\.mjs/);
});

test('the offline browser module graph includes the local terrain app',()=>{
 const output=execFileSync(process.execPath,['--experimental-vm-modules','scripts/check-browser-module-graph.mjs'],{encoding:'utf8'});
 assert.match(output,/Linked browser module graph: assets[\\/]local-terrain[\\/]local-terrain-app\.mjs/);
});

test('the local browser source includes solved parent water and ecology fields',()=>{
 const parent=generateSolvedParent({seed:9981,sizeKm:1200,n:129,continentCount:3,crustScale:1.15});
 assert.equal(parent.stage,4);
 assert.equal(parent.lake.length,parent.height.length);
 assert.equal(parent.rainfall.length,parent.height.length);
 assert.equal(parent.humanPotential.length,parent.height.length);
});
