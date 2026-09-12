import {generateHydrology,generateEcology} from './world-core.mjs';
import {generateReferenceTerrain} from './reference-terrain.mjs';
import {generateHumanGeography} from './human-geography.mjs';
import {resolveSurfaceWater} from './water-balance.mjs';
import {resolveEnvironments} from './world-pipeline.mjs';
import {generateParentTerrain,chooseWindow} from './parent-world.mjs';
import {evaluateWorld,portableReport} from './benchmark-evaluate.mjs';
import {BENCHMARK_REGIONS,PROTOCOL} from './benchmark-protocol.mjs';
const cache=new Map();
export async function loadBenchmark(id,kind){
 if(!BENCHMARK_REGIONS[id]||!['input','observations'].includes(kind))throw new Error('Unknown benchmark resource');
 const key=id+'.'+kind;if(!cache.has(key))cache.set(key,fetch(new URL(`./benchmarks/${key}.json`,import.meta.url)).then(async r=>{if(!r.ok)throw new Error(`Benchmark ${key} unavailable (${r.status}); no synthetic data will be substituted.`);return r.json();}).catch(e=>{cache.delete(key);throw e;}));return cache.get(key);
}
function bytesToBase64(bytes){let text='';for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(text);}
/** Explicit allow-list: raw elevation and climate only. No lake shapes, river
 * lines, population, city coordinates or benchmark split affect prediction.
 */
export function blindTerrain(pack,options={}){
 if(pack.schema!=='watershed-blind-input-v1'||!pack.provenance.rawDEM||pack.provenance.waterMasksUsed)throw new Error('A raw, unburned DEM is required for a held-out benchmark');
 const region={...pack.region,landmarks:[]},cells=pack.n*pack.n;
 const safe={schema:'watershed-reference-v2',region,n:pack.n,height:pack.rawHeight,lakeIndex:bytesToBase64(new Uint8Array(cells*2)),lakes:[],rivers:[],benchmarkLake:bytesToBase64(new Uint8Array(cells)),benchmarkBoundaryWater:bytesToBase64(new Uint8Array(cells)),benchmarkRiver:bytesToBase64(new Uint8Array(cells)),population:[],benchmarkMeta:{blindAdapter:true},provenance:pack.provenance};
 const w=generateReferenceTerrain(safe,options);return{...w,version:'regional-world-v6',referenceMode:'blind',reference:{...w.reference,measuredInputs:'Raw real DEM; no mapped lake/river constraints or settlement data.',modeledOutputs:'Hydrology and human potential predicted without water/population targets.',edgeWarning:'Cropped region; lake-bottom bathymetry and external upstream inflows are absent.'},benchmarkRole:pack.region.role};
}
export function observedClimate(world,forcing){
 if(!forcing||forcing.kind!=='NOAA-1991-2020-station-normals'||forcing.stations.length<4)throw new Error('Real-climate forcing is missing; select synthetic climate explicitly rather than silently substituting it');
 const rainfall=new Float32Array(world.height.length),temperature=new Float32Array(world.height.length),stationDistanceKm=new Float32Array(world.height.length),rainScale=Number(world.config.rain||1);
 for(let i=0;i<world.height.length;i++){
  const x=world.mesh.x[i],z=world.mesh.z[i],nearest=forcing.stations.map(p=>({p,d:Math.hypot(x-p.xKm,z-p.zKm)})).sort((a,b)=>a.d-b.d).slice(0,4);let total=0,rain=0,temp=0;
  for(const{p,d}of nearest){const weight=1/(d*d+25);total+=weight;rain+=p.rainMm*weight;temp+=(p.tempC-.0065*(Math.max(0,world.height[i])-p.elevationM))*weight;}
  rainfall[i]=rain/total*rainScale;temperature[i]=temp/total;stationDistanceKm[i]=nearest[0].d;
 }
 return{rainfall,temperature,stationDistanceKm,climateForcing:{kind:forcing.kind,period:'1991–2020',stationCount:forcing.stations.length,interpolation:forcing.interpolation,rainMultiplier:rainScale,maxNearestStationKm:stationDistanceKm.reduce((a,b)=>Math.max(a,b),0),caution:'Observed station normals, interpolated and lapse-adjusted; NOT a NOAA gridded field, historical climate reconstruction, or mountain precipitation model.'}};
}
/** This function has no observation-pack parameter by design. */
export function predictFromTerrain(terrain,{forcing,syntheticClimate=false}={}){
 const potential=generateHydrology(terrain),climate=terrain.reference&&!syntheticClimate?observedClimate(terrain,forcing):generateEcology({...potential,lake:new Uint8Array(terrain.height.length)});
 const water={...resolveSurfaceWater(potential,climate),version:'regional-world-v6',climateForcing:climate.climateForcing||{kind:'synthetic',caution:'Generated climate; not measured normals.'}};
 const ecology=resolveEnvironments(water),human={...generateHumanGeography(ecology),version:'regional-world-v6'};return[terrain,water,ecology,human];
}
export async function generateStagesV6(options,emit=()=>{},cancelled=()=>false){
 const start=performance.now(),source=options.source||'generated',pause=()=>new Promise(r=>setTimeout(r,0));let terrain,forcing,input;
 if(source==='generated')terrain=generateParentTerrain(options);else{input=await loadBenchmark(source,'input');terrain=blindTerrain(input,options);forcing=input.forcing;}
 if(cancelled())return;emit({stage:1,world:terrain,elapsed:performance.now()-start});await pause();if(cancelled())return;
 const potential=generateHydrology(terrain),climate=source!=='generated'&&options.climate!=='synthetic'?observedClimate(terrain,forcing):generateEcology({...potential,lake:new Uint8Array(terrain.height.length)});
 const water={...resolveSurfaceWater(potential,climate),version:'regional-world-v6',climateForcing:climate.climateForcing||{kind:'synthetic'}};emit({stage:2,world:water,elapsed:performance.now()-start});await pause();if(cancelled())return;
 const ecology=resolveEnvironments(water);emit({stage:3,world:ecology,elapsed:performance.now()-start});await pause();if(cancelled())return;
 let human={...generateHumanGeography(ecology),version:'regional-world-v6'};
 if(source!=='generated'){
  emit({progress:'Scoring against held-out water and population…'});
  try{const observations=await loadBenchmark(source,'observations');if(cancelled())return;const report=evaluateWorld(human,observations);human={...human,benchmark:report,observations,landmarks:input.region.landmarks.map(([name,lat,lon,type])=>({name,lat,lon,type}))};}
  catch(e){human={...human,benchmark:{status:'unavailable',reason:e.message}};}
 }
 emit({stage:4,world:human,elapsed:performance.now()-start});return human;
}
export async function runSuite({n=129,region=null,sweep=false}={},emit=()=>{}){
 const reports=[];for(const id of region?[region]:Object.keys(BENCHMARK_REGIONS))for(const detail of sweep?[129,193,241]:[n]){
  emit({progress:`${BENCHMARK_REGIONS[id].name} · ${detail}² mesh`});
  const input=await loadBenchmark(id,'input'),terrain=blindTerrain(input,{n:detail,rain:1,wind:'west'}),stages=predictFromTerrain(terrain,{forcing:input.forcing}),obs=await loadBenchmark(id,'observations'),report=portableReport(evaluateWorld(stages[3],obs));reports.push(report);emit({report});await new Promise(r=>setTimeout(r,0));
 }return{protocol:PROTOCOL,reports};
}
