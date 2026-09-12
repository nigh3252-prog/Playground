import {readFile,writeFile} from 'node:fs/promises';
import {blindTerrain,predictFromTerrain} from '../assets/world-lab/benchmark-pipeline.mjs';
import {evaluateWorld,portableReport} from '../assets/world-lab/benchmark-evaluate.mjs';
import {BENCHMARK_REGIONS,PROTOCOL} from '../assets/world-lab/benchmark-protocol.mjs';
const reports=[];
for(const id of Object.keys(BENCHMARK_REGIONS)){
 const input=JSON.parse(await readFile(`assets/world-lab/benchmarks/${id}.input.json`,'utf8'));
 const observed=JSON.parse(await readFile(`assets/world-lab/benchmarks/${id}.observations.json`,'utf8'));
 const terrain=blindTerrain(input,{n:129,rain:1,wind:'west'}),world=predictFromTerrain(terrain,{forcing:input.forcing})[3],report=portableReport(evaluateWorld(world,observed));
 if(report.status!=='scored')throw new Error('Unscored baseline: '+id);reports.push(report);console.log(`BASELINE ${id}: ${report.water.predictedKm2.toFixed(1)} predicted vs ${report.water.observedKm2.toFixed(1)} observed km²; no fitting`);
}
await writeFile('assets/world-lab/benchmarks/baseline-reports.json',JSON.stringify({protocol:PROTOCOL,created:new Date().toISOString(),reports},null,2));
