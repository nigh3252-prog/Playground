import {generateTerrain,generateHydrology,generateEcology,wetDistances,BIOMES,exportWorld} from './world-core.mjs';
import {generateHumanGeography} from './human-geography.mjs';
import {loadReference,generateReferenceTerrain,referenceHydrology} from './reference-terrain.mjs';
import {resolveSurfaceWater} from './water-balance.mjs';
/** Ecology reuses the SAME climate that supplied the lake budget. Water
 * masks/runoff are actual resolved surface water, not hypothetical full pits.
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
 // Do not boost rainfall because of lakes that have not yet been justified.
 const climate=generateEcology({...hydro,lake:terrain.observedLake||new Uint8Array(terrain.height.length)});
 return resolveSurfaceWater(hydro,climate);
}
export async function generateStages(options,emit=()=>{},cancelled=()=>false){
 const start=performance.now(),source=options.source||'generated',pause=()=>new Promise(r=>setTimeout(r,0));
 let terrain=source==='generated'?generateTerrain(options):generateReferenceTerrain(await loadReference(source),options);
 if(cancelled())return;emit({stage:1,world:terrain,elapsed:performance.now()-start});await pause();if(cancelled())return;
 const water=resolveWaterStage(terrain);emit({stage:2,world:water,elapsed:performance.now()-start});await pause();if(cancelled())return;
 const ecology=resolveEnvironments(water);emit({stage:3,world:ecology,elapsed:performance.now()-start});await pause();if(cancelled())return;
 const human={...generateHumanGeography(ecology),version:'regional-world-v5'};emit({stage:4,world:human,elapsed:performance.now()-start});return human;
}
export function exportBenchmarkWorld(base,human){
 const out=exportWorld({...base,stage:3});out.version='regional-world-v5';out.reference=base.reference||null;out.observedLake=base.observedLake||null;out.landmarks=base.landmarks||[];
 out.water={model:base.waterModel,state:base.waterState,surface:base.waterSurface,potentialSpill:base.potentialSpill,potentialBasinId:base.potentialBasinId,basinBudgets:base.basinWater,explanation:base.waterBudgetNote};
 if(human)out.humanGeography={model:human.humanModel,productivity:human.productivity,travelFriction:human.travelFriction,waterAccessCost:human.waterAccessCost,transportAccess:human.transportAccess,navigableRiver:human.navigableRiver,marketAccess:human.marketAccess,humanPotential:human.humanPotential,strategicNodes:human.strategicNodes,note:'No settlements are placed; reference city labels are never scored.'};return out;
}
