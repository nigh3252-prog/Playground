import {readFile} from 'node:fs/promises';
import {blindTerrain,predictFromTerrain} from '../assets/world-lab/benchmark-pipeline.mjs';
import {BENCHMARK_REGIONS} from '../assets/world-lab/benchmark-protocol.mjs';

for(const id of Object.keys(BENCHMARK_REGIONS)){
  const input=JSON.parse(await readFile(`assets/world-lab/benchmarks/${id}.input.json`,'utf8'));
  const terrain=blindTerrain(input,{n:129,rain:1,wind:'west'}),water=predictFromTerrain(terrain,{forcing:input.forcing})[1];
  const byStatus={},details=[];
  for(const b of water.basinWater||[]){
    if(!b)continue;const s=byStatus[b.status]??={count:0,wetAreaKm2:0,basinAreaKm2:0,maxDepthM:0};s.count++;s.wetAreaKm2+=b.wetAreaKm2||0;s.basinAreaKm2+=b.basinAreaKm2||0;s.maxDepthM=Math.max(s.maxDepthM,b.depthM||0);
    if(['retained','overflowing'].includes(b.status))details.push({id:b.id,status:b.status,wetAreaKm2:+(b.wetAreaKm2||0).toFixed(1),basinAreaKm2:+(b.basinAreaKm2||0).toFixed(1),depthM:+(b.depthM||0).toFixed(1),spillM:+(b.spillM||0).toFixed(1),inflowM3y:+(b.inflowM3Year||0).toFixed(0),landRunoffM3y:+(b.landRunoffM3Year||0).toFixed(0),precipM3y:+(b.precipitationM3Year||0).toFixed(0),evapM3y:+(b.evaporationM3Year||0).toFixed(0),seepM3y:+(b.seepageM3Year||0).toFixed(0),outflowM3y:+(b.outflowM3Year||0).toFixed(0),leakMYear:+(b.retention?.leakMYear||0).toFixed(3)});
  }
  details.sort((a,b)=>b.wetAreaKm2-a.wetAreaKm2);
  console.log('WATER_DIAGNOSTIC',JSON.stringify({id,conditioning:terrain.erosion,visibleLakeBodies:water.lakeBodies.length,byStatus,largestStandingWater:details.slice(0,12)}));
}
