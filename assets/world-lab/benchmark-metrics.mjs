import {indexMesh,nearestNode} from './world-mesh.mjs';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const each=(m,i,fn)=>{for(let k=m.offsets[i];k<m.offsets[i+1];k++)fn(m.neighbors[k],m.distances[k]);};
class Heap{constructor(){this.a=[];}push(id,key){const a=this.a,v={id,key};let i=a.length;a.push(v);while(i){const p=(i-1)>>1;if(a[p].key<=key)break;a[i]=a[p];i=p;}a[i]=v;}pop(){const a=this.a,out=a[0],last=a.pop();if(a.length){let i=0;while(i*2+1<a.length){let c=i*2+1;if(c+1<a.length&&a[c+1].key<a[c].key)c++;if(a[c].key>=last.key)break;a[i]=a[c];i=c;}a[i]=last;}return out;}get length(){return this.a.length;}}
function weightedQuantile(values,weights,q,mask){const rows=[];let total=0;for(let i=0;i<values.length;i++)if((!mask||mask(i))&&Number.isFinite(values[i])&&weights[i]>0){rows.push([values[i],weights[i]]);total+=weights[i];}rows.sort((a,b)=>a[0]-b[0]);let c=0;for(const r of rows){c+=r[1];if(c>=total*q)return r[0];}return rows.at(-1)?.[0]??0;}
function components(world,mask){const seen=new Uint8Array(mask.length),areas=[];for(let s=0;s<mask.length;s++)if(mask[s]&&!seen[s]){let area=0,q=[s];seen[s]=1;for(let h=0;h<q.length;h++){const i=q[h];area+=world.mesh.nodeArea[i];each(world.mesh,i,j=>{if(mask[j]&&!seen[j]){seen[j]=1;q.push(j);}});}areas.push(area);}return areas.sort((a,b)=>a-b);}
function percentile(a,p){if(!a.length)return 0;const i=Math.min(a.length-1,Math.floor((a.length-1)*p));return a[i];}
export function terrainStatistics(world){const land=i=>!world.ocean[i]&&!world.observedLake?.[i],weights=world.mesh.nodeArea,peak=Math.max(...Array.from(world.height,(v,i)=>land(i)?v:-Infinity));
 const p05=weightedQuantile(world.height,weights,.05,land),p50=weightedQuantile(world.height,weights,.50,land),p95=weightedQuantile(world.height,weights,.95,land),s95=weightedQuantile(world.slope,weights,.95,land),s50=weightedQuantile(world.slope,weights,.50,land);
 let landKm2=0;for(let i=0;i<weights.length;i++)if(land(i))landKm2+=weights[i];return{peakElevationM:peak,p05ElevationM:p05,medianElevationM:p50,p95ElevationM:p95,relief90M:p95-p05,medianSlope:s50,p95Slope:s95,landKm2};}
export function waterBenchmark(world){
 if(!world.benchmarkLake)return null;let tp=0,fp=0,fn=0,tn=0;const cls=new Uint8Array(world.height.length),pred=new Uint8Array(world.height.length),obs=new Uint8Array(world.height.length);
 for(let i=0;i<world.height.length;i++){
  if(world.ocean[i]||world.observedLake?.[i])continue;const a=world.mesh.nodeArea[i],p=world.lake?.[i]?1:0,o=world.benchmarkLake[i]?1:0;pred[i]=p;obs[i]=o;
  if(p&&o){tp+=a;cls[i]=1;}else if(p){fp+=a;cls[i]=2;}else if(o){fn+=a;cls[i]=3;}else tn+=a;
 }
 const precision=tp/(tp+fp||1),recall=tp/(tp+fn||1),f1=2*precision*recall/(precision+recall||1),jaccard=tp/(tp+fp+fn||1),pc=components(world,pred),oc=components(world,obs);
 return{class:cls,truePositiveKm2:tp,falsePositiveKm2:fp,falseNegativeKm2:fn,trueNegativeKm2:tn,predictedLakeKm2:tp+fp,observedLakeKm2:tp+fn,areaBias:(tp+fp)/(tp+fn||1)-1,precision,recall,f1,jaccard,predictedComponents:pc.length,observedComponents:oc.length,predictedMedianKm2:percentile(pc,.5),observedMedianKm2:percentile(oc,.5),predictedP90Km2:percentile(pc,.9),observedP90Km2:percentile(oc,.9)};
}
function distanceToMask(world,mask,maxKm=30){const d=new Float64Array(mask.length).fill(Infinity),heap=new Heap();for(let i=0;i<mask.length;i++)if(mask[i]){d[i]=0;heap.push(i,0);}while(heap.length){const {id:i,key}=heap.pop();if(key!==d[i]||key>maxKm)continue;each(world.mesh,i,(j,len)=>{const v=key+len;if(v<d[j]&&v<=maxKm){d[j]=v;heap.push(j,v);}});}return d;}
export function riverBenchmark(world,toleranceKm=Math.max(8,world.stepKm*1.5)){
 if(!world.benchmarkRiver||!world.river)return null;const refD=distanceToMask(world,world.benchmarkRiver,toleranceKm),modelD=distanceToMask(world,world.river,toleranceKm);let modelLen=0,modelMatched=0,ref=0,refMatched=0;
 for(let i=0;i<world.height.length;i++){
  if(world.river[i]&&world.receiver[i]>=0){const len=Math.hypot(world.mesh.x[i]-world.mesh.x[world.receiver[i]],world.mesh.z[i]-world.mesh.z[world.receiver[i]]);modelLen+=len;if(refD[i]<=toleranceKm||refD[world.receiver[i]]<=toleranceKm)modelMatched+=len;}
  if(world.benchmarkRiver[i]){ref++;if(modelD[i]<=toleranceKm)refMatched++;}
 }
 const precision=modelMatched/(modelLen||1),recall=refMatched/(ref||1),f1=2*precision*recall/(precision+recall||1);return{toleranceKm,modeledRiverKm:modelLen,modeledAlignedKm:modelMatched,precision,referenceSamples:ref,referenceMatched:refMatched,recall,f1};
}
export function populationBenchmark(world){
 const places=world.referencePopulation;if(!places?.length||!world.humanPotential)return null;const index=indexMesh(world.mesh),threshold=weightedQuantile(world.humanPotential,world.mesh.nodeArea,.80,i=>!world.ocean[i]&&!world.lake[i]),landMeanNum=world.humanPotential.reduce((s,v,i)=>s+(!world.ocean[i]&&!world.lake[i]?v*world.mesh.nodeArea[i]:0),0),landArea=world.mesh.nodeArea.reduce((s,a,i)=>s+(!world.ocean[i]&&!world.lake[i]?a:0),0);
 let pop=0,weighted=0,topPop=0,used=0;const scored=[];for(const p of places){const i=nearestNode(index,p.xKm,p.zKm);if(i<0||world.ocean[i]||world.lake[i])continue;const value=world.humanPotential[i],w=Math.max(1,p.population||1);pop+=w;weighted+=w*value;if(value>=threshold)topPop+=w;used++;scored.push({...p,node:i,potential:value});}
 const landMean=landMeanNum/(landArea||1),populationWeightedPotential=weighted/(pop||1);return{placeCount:used,populationRepresented:pop,populationWeightedPotential,landMeanPotential:landMean,potentialUplift:populationWeightedPotential/(landMean||1),top20Threshold:threshold,populationInTop20:topPop/(pop||1),places:scored.sort((a,b)=>(b.population||0)-(a.population||0))};
}
export function evaluateBenchmark(world){const terrain=terrainStatistics(world),water=waterBenchmark(world),rivers=riverBenchmark(world),population=populationBenchmark(world);return{version:'watershed-benchmark-v1',region:world.reference?.region?.id||'generated',role:world.reference?.region?.role||'generated',terrain,water,rivers,population};}
export function compactBenchmark(result){return{version:result.version,region:result.region,role:result.role,terrain:result.terrain,water:result.water&&Object.fromEntries(Object.entries(result.water).filter(([k])=>k!=='class')),rivers:result.rivers,population:result.population&&Object.fromEntries(Object.entries(result.population).filter(([k])=>k!=='places'))};}
export function compareTerrainToSuite(stats,suite){const refs=suite?.regions||[];if(!refs.length)return null;const range=key=>{const a=refs.map(r=>r.metrics.terrain[key]).filter(Number.isFinite);return{min:Math.min(...a),max:Math.max(...a),median:a.sort((x,y)=>x-y)[Math.floor(a.length/2)]};};return{peakElevationM:range('peakElevationM'),relief90M:range('relief90M'),p95Slope:range('p95Slope'),generated:stats};}
