import test from 'node:test';
import assert from 'node:assert/strict';
import {generateWorld,generateTerrain,generateHydrology,generateEcology,drainageTrace,cellArea,normalizeConfig,BIOMES,summary} from '../assets/world-lab/world-core.mjs';
const config={seed:431970387,n:65,sizeKm:1200};
const w=generateWorld(config),N=w.n*w.n;
const close=(a,b,tol=1e-6)=>assert.ok(Math.abs(a-b)<tol,`${a} vs ${b}`);
function checkFlow(world){
 const {n,receiver:r,filled:f,rank,area,ocean,basin}=world;
 for(let i=0;i<r.length;i++){
  assert.ok(Number.isFinite(f[i]));
  if(ocean[i])continue;
  assert.ok(f[i]>=world.height[i]);assert.ok(basin[i]>=0);assert.ok(area[i]>0);
  if(r[i]>=0){assert.ok(rank[r[i]]<rank[i]);assert.ok(f[r[i]]<=f[i]+1e-8);assert.ok(Math.abs(i%n-r[i]%n)<=1&&Math.abs((i/n|0)-(r[i]/n|0))<=1);if(!ocean[r[i]])assert.ok(area[r[i]]>=area[i]);}
  else assert.ok(i<n||i>=n*(n-1)||i%n===0||i%n===n-1);
 }
 const land=summary(world).landKm2;close(world.outlets.reduce((s,o)=>s+o.areaKm2,0),land,1e-4);
}
test('seed, config and regional scale are deterministic',()=>{
 const b=generateWorld(config);for(const key of ['height','filled','receiver','basin','biome','rainfall'])assert.deepEqual(w[key],b[key]);
 assert.notDeepEqual(w.height,generateTerrain({...config,seed:42}).height);
 close(w.stepKm,1200/64);assert.equal(w.height.length,N);
});
test('bounds and invalid configuration are rejected',()=>{
 for(const bad of [{n:1},{n:999},{sizeKm:0},{relief:Infinity},{rain:0},{wind:'south'},{seed:'hello'}])assert.throws(()=>normalizeConfig(bad));
});
test('terrain, hydrology and ecology preserve immutable earlier-stage snapshots',()=>{
 const t=generateTerrain(config),before=t.height.slice(),hydro=generateHydrology(t),eco=generateEcology(hydro);
 assert.deepEqual(t.height,before);assert.equal(t.stage,1);assert.equal(t.receiver,undefined);assert.equal(hydro.stage,2);assert.equal(hydro.biome,undefined);assert.equal(eco.stage,3);assert.deepEqual(hydro.filled,eco.filled);
});
test('ocean is edge connected, and mountain frontiers coexist with dry interior',()=>{
 const reached=new Set(),q=[];for(let i=0;i<N;i++)if(w.ocean[i]&&(i<w.n||i>=w.n*(w.n-1)||i%w.n===0||i%w.n===w.n-1)){q.push(i);reached.add(i);}
 for(let k=0;k<q.length;k++){const i=q[k],x=i%w.n,z=i/w.n|0;for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++){const xx=x+dx,zz=z+dz,j=zz*w.n+xx;if(xx>=0&&xx<w.n&&zz>=0&&zz<w.n&&w.ocean[j]&&!reached.has(j)){reached.add(j);q.push(j);}}}
 assert.equal(reached.size,[...w.ocean].reduce((a,b)=>a+b,0));assert.ok(summary(w).landPercent>60);assert.ok(summary(w).peakM>3000);
});
test('routing is downhill on spill surface, acyclic and accumulates without losing land area',()=>checkFlow(w));
test('flow traces terminate at sea or an open regional edge',()=>{
 for(let i=0;i<N;i+=11){const path=drainageTrace(w,i),end=path.at(-1);assert.equal(new Set(path).size,path.length);assert.ok(w.ocean[end]||w.receiver[end]===-1);}
 assert.deepEqual(drainageTrace(w,-1),[]);
});
test('flat bowl fills to its spill level, not arbitrary pond elevations',()=>{
 const n=17,h=new Float32Array(n*n).fill(10),ocean=new Uint8Array(n*n),slope=new Float32Array(n*n);
 for(let z=3;z<=13;z++)for(let x=3;x<=13;x++)h[z*n+x]=2;
 for(let z=0;z<3;z++)h[z*n+8]=7;
 const a=generateHydrology({n,height:h,ocean,slope,config:{...config,n},stage:1});
 close(a.filled[8*n+8],7);assert.equal(a.lake[8*n+8],1);close(h[8*n+8],2);checkFlow(a);
});
test('completely flat terrain still drains without cycles',()=>{
 const n=17,a=generateHydrology({n,height:new Float32Array(n*n).fill(5),ocean:new Uint8Array(n*n),slope:new Float32Array(n*n),config:{...config,n},stage:1});
 checkFlow(a);assert.equal([...a.lake].reduce((x,y)=>x+y,0),0);
});
test('rivers continue downstream and confluences represent tributaries',()=>{
 const donors=new Uint8Array(N);for(let i=0;i<N;i++)if(w.river[i]){const r=w.receiver[i];if(r>=0){donors[r]++;if(!w.ocean[r]&&w.receiver[r]>=0)assert.equal(w.river[r],1);}}
 for(const i of w.confluences)assert.ok(donors[i]>=2);assert.ok(w.confluences.length>5);
});
test('ecology respects ocean/lakes, gives varied environments, and rainfall changes vegetation not terrain',()=>{
 for(let i=0;i<N;i++){assert.ok(w.biome[i]<BIOMES.length);if(w.ocean[i])assert.equal(w.biome[i],0);else if(w.lake[i])assert.equal(w.biome[i],1);assert.ok(w.rainfall[i]>0);assert.ok(Number.isFinite(w.temperature[i]));}
 assert.ok(new Set(w.biome).size>=8);
 const dry=generateWorld({...config,rain:.45});assert.deepEqual(w.height,dry.height);assert.deepEqual(w.receiver,dry.receiver);assert.notDeepEqual(w.biome,dry.biome);
 const east=generateWorld({...config,wind:'east'});assert.deepEqual(w.height,east.height);assert.notDeepEqual(w.rainfall,east.rainfall);
});
test('node area weights sum to the real map area including half-cells on borders',()=>{
 let sum=0;for(let i=0;i<N;i++)sum+=cellArea(i,w.n,w.config.sizeKm);close(sum,1200**2);
 close([...w.biomeAreas].reduce((a,b)=>a+b,0),1200**2);
});
test('runoff accumulates monotonically and no visual exaggeration is stored in model config',()=>{
 for(let i=0;i<N;i++){assert.ok(Number.isFinite(w.runoff[i])&&w.runoff[i]>=0);const r=w.receiver[i];if(r>=0&&!w.ocean[r])assert.ok(w.runoff[r]>=w.runoff[i]);}
 assert.equal(w.config.exaggeration,undefined);
});
test('multi-seed and parameter extremes maintain drainage invariants',()=>{
 for(let i=0;i<14;i++)checkFlow(generateWorld({seed:i*7411,n:65,relief:i%2?.5:1.6,rain:i%2?.4:1.8,wind:i%3?'west':'east',sizeKm:[600,1200,2400][i%3]}));
});
test('standard and fine regional grids complete with bounded output sizes',()=>{
 for(const n of [193,241]){const a=generateWorld({n,seed:42});checkFlow(a);assert.equal(a.height.length,n*n);assert.ok(a.outlets.length<n*n);}
});
