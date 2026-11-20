import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {BENCHMARK_REGIONS,PROTOCOL} from '../assets/world-lab/benchmark-protocol.mjs';
const root='assets/world-lab/benchmarks';
const sha=text=>createHash('sha256').update(text).digest('hex');
const manifest=JSON.parse(await readFile(`${root}/manifest.json`,'utf8'));
if(manifest.schema!=='watershed-frozen-benchmark-manifest-v1')throw new Error('Frozen benchmark manifest missing/wrong schema');
if(manifest.protocol?.version!==PROTOCOL.version||manifest.protocol?.frozenSnapshots!==true)throw new Error('Frozen benchmark protocol mismatch');
const report=[];
for(const id of Object.keys(BENCHMARK_REGIONS)){
 const inputText=await readFile(`${root}/${id}.input.json`,'utf8'),obsText=await readFile(`${root}/${id}.observations.json`,'utf8');
 const input=JSON.parse(inputText),obs=JSON.parse(obsText);
 if(input.schema!=='watershed-blind-input-v1'||!input.provenance?.rawDEM||input.provenance?.waterMasksUsed!==false)throw new Error(`${id}: invalid blind terrain snapshot`);
 if(obs.schema!=='watershed-observations-v2-frozen'||obs.status!=='complete'||obs.snapshot?.immutableTarget!==true)throw new Error(`${id}: invalid frozen observations`);
 if(obs.protocol?.version!==PROTOCOL.version||input.snapshot?.protocol!==PROTOCOL.version)throw new Error(`${id}: protocol mismatch`);
 if(obs.region?.id!==id||input.region?.id!==id)throw new Error(`${id}: region mismatch`);
 if(!obs.water||!obs.coverage||!Array.isArray(obs.population)||!obs.population.length||!Array.isArray(obs.rivers)||!obs.rivers.length)throw new Error(`${id}: incomplete observations`);
 if(!input.forcing?.stations?.length||input.forcing.stations.length<4)throw new Error(`${id}: missing climate normals`);
 const meta=manifest.regions.find(r=>r.id===id);if(!meta)throw new Error(`${id}: missing manifest entry`);
 report.push({id,inputBytes:Buffer.byteLength(inputText),observationBytes:Buffer.byteLength(obsText),inputSha256:sha(inputText),observationSha256:sha(obsText),waterFeatures:meta.waterFeatures,riverFeatures:meta.riverFeatures,censusTracts:meta.censusTracts,climateStations:meta.climateStations});
}
console.log(JSON.stringify({protocol:PROTOCOL.version,capturedAt:manifest.capturedAt,regions:report},null,2));
