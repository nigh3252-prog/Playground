import {readFile} from 'node:fs/promises';
import {blindTerrain,predictFromTerrain} from '../assets/world-lab/benchmark-pipeline.mjs';
import {BENCHMARK_REGIONS} from '../assets/world-lab/benchmark-protocol.mjs';

for(const id of Object.keys(BENCHMARK_REGIONS)){
  const input=JSON.parse(await readFile(`assets/world-lab/benchmarks/${id}.input.json`,'utf8'));
  const terrain=blindTerrain(input,{n:129,rain:1,wind:'west'}),water=predictFromTerrain(terrain,{forcing:input.forcing})[1];
  const byStatus={};
  for(const b of water.basinWater||[]){
    if(!b)continue;const s=byStatus[b.status]??={count:0,wetAreaKm2:0,basinAreaKm2:0,maxDepthM:0};s.count++;s.wetAreaKm2+=b.wetAreaKm2||0;s.basinAreaKm2+=b.basinAreaKm2||0;s.maxDepthM=Math.max(s.maxDepthM,b.depthM||0);
  }
  console.log('WATER_DIAGNOSTIC',JSON.stringify({id,conditioning:terrain.erosion,visibleLakeBodies:water.lakeBodies.length,byStatus}));
}
