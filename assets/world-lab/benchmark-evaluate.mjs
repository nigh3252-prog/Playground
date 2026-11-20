import {indexMesh,locateTriangle} from './world-mesh.mjs';
import {confusion,components,sizeBins,weightedQuantile,quantile,populationMetrics,sampleLines,alignment,pointIndex,nearestDistance,fingerprint} from './benchmark-math.mjs';
import {PROTOCOL} from './benchmark-protocol.mjs';
export function decodeBytes(base64,length){const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));if(bytes.length!==length)throw new Error('Observation grid length mismatch');return bytes;}
const isLand=(w,i)=>!w.ocean[i]&&!w.lake?.[i];
export function terrainMetrics(w,box={x:0,z:0,size:w.config.sizeKm}){
 const ids=[];for(let i=0;i<w.height.length;i++)if(!w.ocean[i]&&w.mesh.x[i]>=box.x&&w.mesh.x[i]<=box.x+box.size&&w.mesh.z[i]>=box.z&&w.mesh.z[i]<=box.z+box.size)ids.push(i);
 const heights=ids.map(i=>w.height[i]),weights=ids.map(i=>w.mesh.nodeArea[i]),slopes=ids.map(i=>w.slope[i]),total=weights.reduce((s,a)=>s+a,0),bands=[0,500,1000,2000,3000,4000,5000,Infinity];
 let peak=null;for(const i of ids)if(!peak||w.height[i]>peak.elevationM)peak={elevationM:w.height[i],xKm:w.mesh.x[i],zKm:w.mesh.z[i]};
 const p05=weightedQuantile(heights,weights,.05),p95=weightedQuantile(heights,weights,.95);
 return{peak,sampledPeakM:peak?.elevationM??null,p05ElevationM:p05,medianElevationM:weightedQuantile(heights,weights,.5),p95ElevationM:p95,centralReliefM:p05===null?null:p95-p05,p95SlopePercent:100*(weightedQuantile(slopes,weights,.95)||0),nominalSpacingKm:w.stepKm,landAreaKm2:total,elevationBands:bands.slice(0,-1).map((lo,k)=>{const hi=bands[k+1];let area=0;for(let j=0;j<ids.length;j++)if(heights[j]>=lo&&heights[j]<hi)area+=weights[j];return{minM:lo,maxM:Number.isFinite(hi)?hi:null,areaKm2:area,landFraction:total?area/total:0};}),peakCaution:'Sampled mesh maximum, not a surveyed summit; different source/detail settings smooth peaks differently.'};
}
export function evaluateWorld(w,observations){
 if(w.stage!==4)throw new Error('Complete all model stages before scoring');
 if(w.referenceMode!=='blind')return{status:'not-independent',reason:'Mapped water was supplied to the model. Disable water constraints for an independent score.'};
 if(observations.status!=='complete')return{status:'unavailable',reason:observations.error||'Observations are not complete. Missing data is not dry land.'};
 const n=observations.n,N=n*n,size=w.config.sizeKm,cell=size/n,area=cell*cell,coverage=decodeBytes(observations.coverage,N),obsClass=decodeBytes(observations.water,N),index=indexMesh(w.mesh);
 const predicted=new Uint8Array(N),observed=new Uint8Array(N),valid=new Uint8Array(N),gridScore=new Float32Array(N),sourceNodes=new Int32Array(N);
 for(let z=0;z<n;z++)for(let x=0;x<n;x++){const i=z*n+x,px=(x+.5)*cell,pz=(z+.5)*cell,q=locateTriangle(index,px,pz);if(!q)throw new Error('Reference mesh does not cover analysis domain');
  const wet=(w.lake[q.a]?q.wa:0)+(w.lake[q.b]?q.wb:0)+(w.lake[q.c]?q.wc:0),waterSea=(w.ocean[q.a]?q.wa:0)+(w.ocean[q.b]?q.wb:0)+(w.ocean[q.c]?q.wc:0);predicted[i]=wet>=.5?1:0;observed[i]=obsClass[i]===1?1:0;
  sourceNodes[i]=q.wa>=q.wb&&q.wa>=q.wc?q.a:q.wb>=q.wc?q.b:q.c;gridScore[i]=q.wa*w.humanPotential[q.a]+q.wb*w.humanPotential[q.b]+q.wc*w.humanPotential[q.c];
  const margin=PROTOCOL.edgeBufferKm;valid[i]=coverage[i]===1&&waterSea<.5&&px>=margin&&pz>=margin&&px<size-margin&&pz<size-margin&&![2,3,4,5].includes(obsClass[i])?1:0;
 }
 const pComp=components(predicted,n,area),oComp=components(observed,n,area),min=PROTOCOL.minimumLakeKm2,raw=confusion(predicted,observed,valid,area);
 const macroP=new Uint8Array(N),macroO=new Uint8Array(N),macroValid=valid.slice(),agreement=new Uint8Array(N);
 for(let i=0;i<N;i++){
  const pb=pComp.bodies[pComp.ids[i]],ob=oComp.bodies[oComp.ids[i]];macroP[i]=pb&&pb.areaKm2>=min?1:0;macroO[i]=ob&&ob.areaKm2>=min?1:0;
  if(ob&&ob.areaKm2<min)macroValid[i]=0;
  agreement[i]=!macroValid[i]?0:macroP[i]?(macroO[i]?1:2):macroO[i]?3:4;
 }
 const water=confusion(macroP,macroO,macroValid,area),maskAt=([x,z])=>{const ix=Math.floor(x/cell),iz=Math.floor(z/cell);return ix>=0&&iz>=0&&ix<n&&iz<n&&valid[iz*n+ix]===1&&obsClass[iz*n+ix]===0;};
 const modelLines=[];for(let i=0;i<w.height.length;i++){const r=w.receiver[i];if(r<0||!w.river[i]||w.area[i]<PROTOCOL.riverDrainageKm2||w.lake[i]||w.lake[r])continue;modelLines.push([[w.mesh.x[i],w.mesh.z[i]],[w.mesh.x[r],w.mesh.z[r]]]);}
 const realLines=observations.rivers.filter(r=>r.areaKm2>=PROTOCOL.riverDrainageKm2).flatMap(r=>r.paths);
 const pLines=sampleLines(modelLines,2,maskAt),oLines=sampleLines(realLines,2,maskAt),rivers=alignment(pLines,oLines,PROTOCOL.riverToleranceKm);
 rivers.minimumDrainageKm2=PROTOCOL.riverDrainageKm2;rivers.domain='Mapped open-water interiors omitted; artificial paths retained only outside those water masks.';rivers.predictedDensityKmPerKm2=rivers.predictedToObserved.lengthKm/(raw.evaluatedKm2||1);rivers.observedDensityKmPerKm2=rivers.observedToPredicted.lengthKm/(raw.evaluatedKm2||1);
 const pJ=w.confluences.filter(i=>w.area[i]>=PROTOCOL.riverDrainageKm2&&maskAt([w.mesh.x[i],w.mesh.z[i]])).map(i=>({x:w.mesh.x[i],z:w.mesh.z[i],weight:1}));
 const oJ=(observations.confluences||[]).filter(p=>maskAt([p.x,p.z])).map(p=>({...p,weight:1}));
 const confluences=alignment(pJ,oJ,PROTOCOL.riverToleranceKm);
 const scores=[],areas=[];for(let i=0;i<N;i++)if(coverage[i]===1&&!obsClass[i]&&isLand(w,sourceNodes[i])){scores.push(gridScore[i]);areas.push(area);}
 function scorePoints(points){return points.map(p=>{const q=locateTriangle(index,p.xKm,p.zKm);if(!q)return{...p,score:null};const land=(isLand(w,q.a)?q.wa:0)+(isLand(w,q.b)?q.wb:0)+(isLand(w,q.c)?q.wc:0);return{...p,score:land<.5?null:q.wa*w.humanPotential[q.a]+q.wb*w.humanPotential[q.b]+q.wc*w.humanPotential[q.c]};});}
 const pop=scorePoints(observations.population||[]),historic=scorePoints(observations.historical||[]);
 const population=populationMetrics(pop,scores,areas),historical=populationMetrics(historic,scores,areas);
 population.interpretation='2020 tract counts represented at Census internal points, not household locations. Modern population is a secondary proxy, not validation of a preindustrial explanation.';
 historical.interpretation='1850 largest-100 urban-place sample geolocated with modern Census place internal points. Not all historical population; rural/Indigenous populations and unmatched/annexed places are absent. No local sample means N/A, not zero population.';
 const budgetArea=(w.basinWater||[]).reduce((s,b)=>s+(b&&['retained','overflowing'].includes(b.status)?b.wetAreaKm2:0),0),modelNodeArea=w.mesh.nodeArea.reduce((s,a,i)=>s+(w.lake[i]?a:0),0);
 const snapshot={schema:PROTOCOL.version,status:'scored',region:observations.region.id,regionName:observations.region.name,role:observations.region.role,modelVersion:w.version,profile:PROTOCOL.parameterProfile,profileFingerprint:fingerprint(JSON.stringify({protocol:PROTOCOL,climate:w.climateForcing?.kind||'synthetic',settings:w.config})),settings:w.config,protocol:PROTOCOL,sourceDigest:observations.sourceDigest,generatedAt:new Date().toISOString(),water,allSizeWaterDiagnostic:raw,lakeSizes:{minimumScoredAreaKm2:min,predicted:sizeBins(pComp.bodies),observed:sizeBins(oComp.bodies),catalogue:observations.lakeSizes},rivers,confluences,population,historical,terrain:terrainMetrics(w),waterAreaDiagnostics:{budgetAreaKm2:budgetArea,nodeMaskAreaKm2:modelNodeArea,rasterMaskAreaKm2:predicted.reduce((s,v)=>s+v*area,0),note:'Budget, node-mask and rendered-color water footprints are different discretizations. The scored mask is thresholded on a fixed analysis grid, not blue screen pixels.'},limitations:[
  'US coverage only. Reservoirs, mapped intermittent water/marsh/playa, cropped large-water boundaries and edge buffers are excluded from the main natural-lake score.',
  'NHD lake polygons ≥1 km² are collected; primary comparisons use connected analysis-grid water bodies ≥25 km². Fine lakes are diagnostic, not trustworthy mesh predictions.',
  'DEM surfaces over water are not bathymetry. Holding out polygons does not create missing basin-floor measurements; missed flat lakes are an input limitation as well as a model result.',
  'Lake counts are connected components at this analysis resolution, not a complete named-lake census.',
  'River alignment is geometric and tolerance-based, not full network-topology equivalence. Catchment IoU is not reported: HUC administrative/subbasin units are not the model outlet partitions.',
  'No parameters are fitted automatically. Calibration/validation assignments are fixed; looking at or tuning against a holdout compromises its independence.'
 ],sourceStatus:observations.provenance,climateForcing:w.climateForcing||{kind:'synthetic'}};
 return{...snapshot,overlay:{n,agreement,predicted,observed,valid:macroValid},populationPoints:pop,historicalPoints:historic};
}
export function portableReport(report){const{overlay,populationPoints,historicalPoints,...rest}=report;return rest;}
