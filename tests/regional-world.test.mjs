import test from 'node:test';
import assert from 'node:assert/strict';
import {generateWorld,generateTerrain,generateHydrology,generateEcology,drainageTrace,wetDistances,normalizeConfig,BIOMES,HISTORIES,summary,exportWorld} from '../assets/world-lab/world-core.mjs';
import {createTerrainMesh,indexMesh,locateTriangle,interpolateAt,rasterizeColors} from '../assets/world-lab/world-mesh.mjs';
import {meshNormals} from '../assets/world-lab/world-view.mjs';
const cfg={seed:431970387,n:65,sizeKm:1200},w=generateWorld(cfg);
const close=(a,b,tol=1e-5)=>assert.ok(Math.abs(a-b)<tol,`${a} != ${b}`);
const sum=a=>a.reduce((x,y)=>x+y,0);
function neighbors(mesh,i){return [...mesh.neighbors.slice(mesh.offsets[i],mesh.offsets[i+1])];}
function checkFlow(a){
 const {mesh,receiver:r,filled:f,rank,area,ocean,basin}=a,N=a.height.length;
 assert.equal(new Set(rank).size,N);
 for(let i=0;i<N;i++){
  assert.ok(Number.isFinite(f[i]));if(ocean[i])continue;
  assert.ok(f[i]>=a.height[i]);assert.ok(basin[i]>=0);assert.ok(area[i]>0);
  const j=r[i];if(j<0){assert.equal(mesh.boundary[i],1);continue;}
  assert.ok(neighbors(mesh,i).includes(j));assert.ok(rank[j]<rank[i]);assert.ok(f[j]<=f[i]+1e-9);
  close(a.flowAngle[i],Math.atan2(mesh.z[j]-mesh.z[i],mesh.x[j]-mesh.x[i]),1e-6);
  if(!ocean[j]){assert.ok(area[j]>=area[i]);assert.equal(basin[i],basin[j]);}
 }
 close(a.outlets.reduce((s,o)=>s+o.areaKm2,0),summary(a).landKm2,1e-4);
}
function customTerrain(heightFn,n=17,sizeKm=1200){
 const mesh=createTerrainMesh(n,sizeKm,17),height=Float32Array.from(mesh.x,(x,i)=>heightFn(x,mesh.z[i],i));
 return{mesh,n,height,config:normalizeConfig({n,sizeKm,seed:17}),stepKm:mesh.stepKm,ocean:new Uint8Array(n*n),slope:new Float32Array(n*n),landHistory:new Uint8Array(n*n),stage:1};
}

test('seed / history / configuration deterministically reproduce mesh and all physical fields',()=>{
 const b=generateWorld(cfg);for(const key of ['height','filled','receiver','basin','flowAngle','biome','rainfall','landHistory'])assert.deepEqual(w[key],b[key]);assert.deepEqual(w.mesh.x,b.mesh.x);assert.deepEqual(w.mesh.triangles,b.mesh.triangles);
 assert.notDeepEqual(w.height,generateTerrain({...cfg,seed:42}).height);
});
test('only model parameters enter config, and invalid values are rejected',()=>{
 for(const bad of [{n:1},{n:999},{sizeKm:0},{relief:Infinity},{rain:0},{wind:'south'},{seed:'hello'},{history:'banana'}])assert.throws(()=>normalizeConfig(bad));
 assert.equal(normalizeConfig({exaggeration:30,exag:1,random:99}).exaggeration,undefined);
 assert.deepEqual(normalizeConfig({exag:1}),normalizeConfig({exag:18}));
});
test('triangles are positive, conforming and partition the real region exactly',()=>{
 for(const seed of [0,1,42,999,431970387]){const m=createTerrainMesh(65,1200,seed);close(sum(m.nodeArea),1200**2,1e-4);assert.ok(m.nodeArea.every(a=>a>0));
  const edges=new Map();for(let k=0;k<m.triangles.length;k+=3){const t=m.triangles.slice(k,k+3);for(let j=0;j<3;j++){const a=t[j],b=t[(j+1)%3],key=a<b?`${a}:${b}`:`${b}:${a}`;edges.set(key,(edges.get(key)||0)+1);}}
  assert.ok([...edges.values()].every(n=>n===1||n===2));assert.equal([...edges.values()].filter(n=>n===1).length,4*(65-1));
 }
});
test('node areas are geometric, not inherited uniform square cell weights',()=>{
 const interior=w.mesh.nodeArea.filter((_,i)=>!w.mesh.boundary[i]);assert.ok(Math.max(...interior)/Math.min(...interior)>1.4);
 const i=1000;assert.notEqual(w.mesh.x[i],i%w.n*w.stepKm);assert.notEqual(w.mesh.z[i],Math.floor(i/w.n)*w.stepKm);
});
test('routing is downhill on spill surface, cycle-free, conservative and actual mesh-linked',()=>checkFlow(w));
test('river headings are not compass-locked in the numerical model',()=>{
 let offGrid=0,total=0;const bins=new Set();
 for(let i=0;i<w.height.length;i++){const r=w.receiver[i];if(!w.river[i]||r<0||w.lake[i]||w.mesh.boundary[i]||w.mesh.boundary[r])continue;
  const angle=w.flowAngle[i]*180/Math.PI,delta=Math.abs(angle/45-Math.round(angle/45))*45;total++;if(delta>.5)offGrid++;bins.add(Math.round(angle));
 }
 assert.ok(total>100);assert.ok(offGrid/total>.90,`${offGrid}/${total} arbitrary headings`);assert.ok(bins.size>80);
 assert.equal(w.routing,'irregular-mesh-steepest');
});
test('an arbitrary sloping plane routes using actual distance rather than raster steps',()=>{
 const a=generateHydrology(customTerrain((x,z)=>2000-.7*x-.3*z,33));checkFlow(a);
 for(let i=0;i<a.height.length;i++){const r=a.receiver[i];if(r<0||a.mesh.boundary[i])continue;const slope=(a.filled[i]-a.filled[r])/Math.hypot(a.mesh.x[i]-a.mesh.x[r],a.mesh.z[i]-a.mesh.z[r]);
  for(const j of neighbors(a.mesh,i)){const other=(a.filled[i]-a.filled[j])/Math.hypot(a.mesh.x[i]-a.mesh.x[j],a.mesh.z[i]-a.mesh.z[j]);assert.ok(slope>=other-1e-6);}
 }
});
test('earlier terrain/hydrology snapshots are not mutated by later stages',()=>{
 const t=generateTerrain(cfg),h=t.height.slice(),hyd=generateHydrology(t),filled=hyd.filled.slice(),e=generateEcology(hyd);
 assert.deepEqual(t.height,h);assert.equal(t.stage,1);assert.equal(t.receiver,undefined);assert.equal(hyd.biome,undefined);assert.equal(hyd.stage,2);assert.equal(e.stage,3);assert.deepEqual(hyd.filled,filled);
});
test('flow traces terminate at sea or an open regional edge',()=>{
 for(let i=0;i<w.height.length;i+=13){const path=drainageTrace(w,i),end=path.at(-1);assert.equal(new Set(path).size,path.length);assert.ok(w.ocean[end]||w.receiver[end]===-1);}
 assert.deepEqual(drainageTrace(w,-1),[]);
});
test('known enclosed bowl fills to its spill level on the irregular mesh',()=>{
 const t=customTerrain((x,z,i)=>{const col=i%17,row=i/17|0;if(col>=3&&col<=13&&row>=3&&row<=13)return 2;if(col===8&&row<3)return 7;return 10;});
 const a=generateHydrology(t);close(a.filled[8*17+8],7);assert.equal(a.lake[8*17+8],1);close(t.height[8*17+8],2);checkFlow(a);
});
test('flat terrain uses ranked plateaus without creating cycles or fake lakes',()=>{
 const a=generateHydrology(customTerrain(()=>5));checkFlow(a);assert.equal(sum(a.lake),0);
});
test('river confluences and downstream continuity come from modeled donors',()=>{
 const donors=new Uint16Array(w.height.length);for(let i=0;i<w.height.length;i++)if(w.river[i]){const r=w.receiver[i];if(r>=0){donors[r]++;if(!w.ocean[r]&&w.receiver[r]>=0)assert.equal(w.river[r],1);}}
 for(const i of w.confluences)assert.ok(donors[i]>=2);assert.ok(w.confluences.length>5);
});
test('wetness distance agrees with independent shortest-path calculations on actual links',()=>{
 const mesh=createTerrainMesh(17,1200,8),N=mesh.x.length,river=new Uint8Array(N);river[145]=1;
 const a={mesh,ocean:new Uint8Array(N),lake:new Uint8Array(N),river},d=wetDistances(a,3000),expected=new Float64Array(N).fill(Infinity),used=new Uint8Array(N);expected[145]=0;
 for(let k=0;k<N;k++){let i=-1;for(let j=0;j<N;j++)if(!used[j]&&(i<0||expected[j]<expected[i]))i=j;used[i]=1;for(let q=mesh.offsets[i];q<mesh.offsets[i+1];q++){const j=mesh.neighbors[q];expected[j]=Math.min(expected[j],expected[i]+mesh.distances[q]);}}
 for(let i=0;i<N;i++)close(d[i],expected[i]);
});
test('wetness and ecology consume the actual new river network',()=>{
 const h=generateHydrology(generateTerrain(cfg)),noRiver=generateEcology({...h,river:new Uint8Array(h.river.length)}),normal=generateEcology(h);
 assert.ok(normal.wetDistanceKm.some((d,i)=>d<noRiver.wetDistanceKm[i]));assert.notDeepEqual(normal.wetDistanceKm,noRiver.wetDistanceKm);
});
test('ecology respects water, remains varied and responds to wind/moisture without rerouting terrain',()=>{
 for(let i=0;i<w.height.length;i++){assert.ok(w.biome[i]<BIOMES.length);if(w.ocean[i])assert.equal(w.biome[i],0);else if(w.lake[i])assert.equal(w.biome[i],1);assert.ok(w.rainfall[i]>0);assert.ok(Number.isFinite(w.temperature[i]));}
 assert.ok(new Set(w.biome).size>=8);
 const dry=generateWorld({...cfg,rain:.45}),east=generateWorld({...cfg,wind:'east'});assert.deepEqual(w.height,dry.height);assert.deepEqual(w.receiver,dry.receiver);assert.notDeepEqual(w.biome,dry.biome);assert.deepEqual(w.height,east.height);assert.notDeepEqual(w.rainfall,east.rainfall);
});
test('different geological histories change elevation, drainage and environments, not just labels',()=>{
 const list=HISTORIES.map(h=>generateWorld({...cfg,history:h.id}));
 for(let i=0;i<list.length;i++)for(let j=i+1;j<list.length;j++){assert.deepEqual(list[i].mesh.x,list[j].mesh.x);assert.notDeepEqual(list[i].height,list[j].height);assert.notDeepEqual(list[i].receiver,list[j].receiver);assert.notDeepEqual(list[i].biome,list[j].biome);}
});
test('glacial, rift and volcanic presets yield lake basins tagged by the actual landforms',()=>{
 for(const [history,type] of [['glacial',1],['rift',2],['volcanic',3]]){const a=generateWorld({...cfg,n:129,history});assert.ok(a.lakeBodies.some(l=>l.history===type&&l.areaKm2>500),history);}
 const old=generateWorld({...cfg,n:129,history:'weathered'}),glacial=generateWorld({...cfg,n:129,history:'glacial'});assert.ok(summary(old).lakeKm2<summary(glacial).lakeKm2*.4);
});
test('rift basin is elongated, caldera basins are more compact for reference seed',()=>{
 function aspect(a,lake){const ids=[];for(let i=0;i<a.height.length;i++)if(a.lakeId[i]===lake.id)ids.push(i);let cx=0,cz=0;for(const i of ids){cx+=a.mesh.x[i];cz+=a.mesh.z[i];}cx/=ids.length;cz/=ids.length;
  let xx=0,zz=0,xz=0;for(const i of ids){const x=a.mesh.x[i]-cx,z=a.mesh.z[i]-cz;xx+=x*x;zz+=z*z;xz+=x*z;}const d=Math.sqrt((xx-zz)**2+4*xz*xz);return Math.sqrt((xx+zz+d)/Math.max(1e-9,xx+zz-d));}
 const r=generateWorld({...cfg,n:129,history:'rift'}),v=generateWorld({...cfg,n:129,history:'volcanic'}),rl=r.lakeBodies.filter(l=>l.history===2).sort((a,b)=>b.areaKm2-a.areaKm2)[0],vl=v.lakeBodies.filter(l=>l.history===3).sort((a,b)=>b.areaKm2-a.areaKm2)[0];
 assert.ok(aspect(r,rl)>3);assert.ok(aspect(v,vl)<2.3);
});
test('climate area and runoff conserve geometric area and summed runoff inputs',()=>{
 close(sum(w.biomeAreas),1200**2,1e-4);let source=0;
 for(let i=0;i<w.height.length;i++){assert.ok(Number.isFinite(w.runoff[i])&&w.runoff[i]>=0);const r=w.receiver[i];if(r>=0&&!w.ocean[r])assert.ok(w.runoff[r]>=w.runoff[i]);
  if(!w.ocean[i])source+=w.rainfall[i]*(1-Math.max(.38,Math.min(.90,.68+w.temperature[i]*.012)))/1000*w.mesh.nodeArea[i]*1e6/(365.25*24*3600);
 }close(w.outlets.reduce((s,o)=>s+w.runoff[o.id],0),source,.001);
});
test('triangle sampling, normals and raster colors agree with physical coordinates',()=>{
 const m=createTerrainMesh(17,1200,42),index=indexMesh(m),values=Float64Array.from(m.x,(x,i)=>.2*x+.7*m.z[i]+20);
 for(let z=0;z<=1200;z+=43)for(let x=0;x<=1200;x+=37){assert.ok(locateTriangle(index,x,z));close(interpolateAt(index,values,x,z),.2*x+.7*z+20);}
 const c=new Uint8ClampedArray(m.x.length*4);for(let i=0;i<m.x.length;i++)c.set([80,120,60,255],i*4);
 const pixels=rasterizeColors(m,c,129);for(let i=0;i<pixels.length;i+=4){assert.equal(pixels[i+3],255);assert.equal(pixels[i],80);}
 const normals=meshNormals(m,new Float32Array(m.x.length));for(let i=0;i<normals.length;i+=3){close(normals[i],0);close(normals[i+1],1);close(normals[i+2],0);}
});
test('v2 JSON export carries real coordinates and valid model receiver IDs',()=>{
 const e=exportWorld(w),json=JSON.parse(JSON.stringify(e,(_,v)=>ArrayBuffer.isView(v)?Array.from(v):v));assert.equal(json.version,'regional-world-v2');assert.equal(json.mesh.x.length,w.height.length);assert.deepEqual(json.receiver,Array.from(w.receiver));assert.equal(json.mesh.nodeArea.length,w.height.length);assert.ok(json.mesh.triangles.length>0);assert.equal(json.config.exaggeration,undefined);
});
test('visual relief settings cannot change the model or its drainage',()=>{
 const a=generateWorld({...cfg,exag:1}),b=generateWorld({...cfg,exag:30});assert.deepEqual(a.height,b.height);assert.deepEqual(a.receiver,b.receiver);assert.deepEqual(a.biome,b.biome);
});
test('multiple histories, seed and parameter extremes preserve drainage invariants',()=>{
 for(let i=0;i<15;i++)checkFlow(generateWorld({seed:i*7411,n:49,relief:i%2?.5:1.6,rain:i%2?.4:1.8,wind:i%3?'west':'east',history:HISTORIES[i%5].id,sizeKm:[600,1200,2400][i%3]}));
});
test('Standard and Fine meshes complete and conserve all contributing area',()=>{
 for(const n of [193,241]){const a=generateWorld({n,seed:42});checkFlow(a);assert.equal(a.height.length,n*n);}
});
