import {generateTerrain,generateHydrology,generateEcology,wetDistances,BIOMES,exportWorld} from './world-core.mjs';
import {generateHumanGeography} from './human-geography.mjs';
import {loadReference,generateReferenceTerrain,referenceHydrology} from './reference-terrain.mjs';
import {resolveSurfaceWater} from './water-balance.mjs';
import {planGeneratedCrop,cropSolvedWorld} from './crop-world.mjs';
import {evaluateBenchmark,compactBenchmark} from './benchmark-metrics.mjs';

/** Ecology reuses the SAME climate that supplied the lake budget. Resolved
 * water masks/runoff, not hypothetical full pits, drive wetness classes.
 */
export function resolveEnvironments(w){
 const N=w.height.length,wetDistanceKm=wetDistances(w,w.stepKm*3),biome=new Uint8Array(N),counts=new Float64Array(BIOMES.length);
 for(let i=0;i<N;i++){const rain=w.rainfall[i],temp=w.temperature[i],e=w.height[i];let b;
  if(w.ocean[i])b=0;else if(w.lake[i])b=1;else if(temp<-5||e>3700&&temp<1)b=11;else if(temp<1.5||e>2900)b=10;
  else if(w.waterState[i]===2||wetDistanceKm[i]<=w.stepKm*1.3&&w.slope[i]<.006&&rain>800&&e<600)b=2;
  else if(e>1300&&rain>550)b=9;else if(rain>1350)b=3;else if(rain>980)b=4;else if(rain>720)b=5;else if(rain>490)b=6;else if(rain>300)b=7;else b=8;
  biome[i]=b;counts[b]+=w.mesh.nodeArea[i];
 }
 return{...w,stage:3,biome,biomeAreas:counts,wetDistanceKm};
}
export function resolveWaterStage(terrain){
 const hydro=terrain.reference?referenceHydrology(terrain):generateHydrology(terrain);
 const climate=generateEcology({...hydro,lake:terrain.observedLake||new Uint8Array(terrain.height.length)});
 return resolveSurfaceWater(hydro,climate);
}
function attachBenchmark(world){
 if(!world.reference)return world;const benchmark=evaluateBenchmark(world);return{...world,benchmark,benchmarkWaterClass:benchmark.water?.class||null};
}

/** Generated worlds are physically solved on a larger parent first. Only then
 * is the visible crop selected. Terrain/water/ecology at crop edges therefore
 * inherit context from outside the camera instead of treating every viewport
 * as its own continent. Human transport is evaluated after cropping so the
 * expensive market graph stays phone-friendly; inherited runoff/areas already
 * contain parent contributions.
 */
async function generatedStages(options,emit,cancelled,start,pause){
 const plan=planGeneratedCrop(options),parentOptions={...options,n:plan.parentN,sizeKm:plan.parentSizeKm};
 let parent=generateTerrain(parentOptions);if(cancelled())return;emit({stage:1,world:cropSolvedWorld(parent,plan),elapsed:performance.now()-start});await pause();if(cancelled())return;
 parent=resolveWaterStage(parent);if(cancelled())return;emit({stage:2,world:cropSolvedWorld(parent,plan),elapsed:performance.now()-start});await pause();if(cancelled())return;
 parent=resolveEnvironments(parent);const ecology=cropSolvedWorld(parent,plan);emit({stage:3,world:ecology,elapsed:performance.now()-start});await pause();if(cancelled())return;
 const human={...generateHumanGeography(ecology),version:'regional-world-v6'};emit({stage:4,world:human,elapsed:performance.now()-start});return human;
}
async function referenceStages(options,emit,cancelled,start,pause){
 let world=generateReferenceTerrain(await loadReference(options.source),options);if(cancelled())return;emit({stage:1,world,elapsed:performance.now()-start});await pause();if(cancelled())return;
 world=attachBenchmark(resolveWaterStage(world));emit({stage:2,world,elapsed:performance.now()-start});await pause();if(cancelled())return;
 world=attachBenchmark(resolveEnvironments(world));emit({stage:3,world,elapsed:performance.now()-start});await pause();if(cancelled())return;
 const human=attachBenchmark({...generateHumanGeography(world),version:'regional-world-v6'});emit({stage:4,world:human,elapsed:performance.now()-start});return human;
}
export async function generateStages(options,emit=()=>{},cancelled=()=>false){const start=performance.now(),pause=()=>new Promise(r=>setTimeout(r,0));return(options.source||'generated')==='generated'?generatedStages(options,emit,cancelled,start,pause):referenceStages(options,emit,cancelled,start,pause);}
export function exportBenchmarkWorld(base,human){
 const out=exportWorld({...base,stage:3});out.version='regional-world-v6';out.reference=base.reference||null;out.parentContext=base.parentContext||null;out.observedLake=base.observedLake||null;out.benchmarkLake=base.benchmarkLake||null;out.benchmarkRiver=base.benchmarkRiver||null;out.landmarks=base.landmarks||[];
 out.water={model:base.waterModel,state:base.waterState,surface:base.waterSurface,potentialSpill:base.potentialSpill,potentialBasinId:base.potentialBasinId,basinBudgets:base.basinWater,explanation:base.waterBudgetNote};
 if(base.benchmark)out.benchmark=compactBenchmark(base.benchmark);
 if(human){out.humanGeography={model:human.humanModel,productivity:human.productivity,travelFriction:human.travelFriction,waterAccessCost:human.waterAccessCost,transportAccess:human.transportAccess,navigableRiver:human.navigableRiver,marketAccess:human.marketAccess,humanPotential:human.humanPotential,strategicNodes:human.strategicNodes,note:'No settlements are placed; real population is held out and used only for benchmark scoring.'};if(human.benchmark)out.benchmark=compactBenchmark(human.benchmark);}
 return out;
}
