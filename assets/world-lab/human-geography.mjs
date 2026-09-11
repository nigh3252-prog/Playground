import {clamp} from './world-utils.mjs';

export const HUMAN_VERSION='regional-human-v1';
export const STRATEGIC_TYPES={
  confluence:['River confluence','#d7b86a'],
  mouth:['River mouth','#73aeb6'],
  head:['Head of navigation','#d9d5b7'],
  port:['Natural port','#7d9ec0'],
  pass:['Mountain pass','#b68b73'],
  ford:['River crossing','#a6a890']
};
const BIOME_PRODUCTIVITY=[0,0,.08,.38,.64,.72,.88,.48,.20,.20,.035,.008];
const BIOME_FRICTION=[.12,.12,4.2,2.35,1.72,1.34,1.0,1.18,1.50,2.55,4.4,7.0];
const eachNeighbor=(mesh,i,fn)=>{for(let k=mesh.offsets[i];k<mesh.offsets[i+1];k++)fn(mesh.neighbors[k],mesh.distances[k],k);};
const gaussian=(x,c,w)=>Math.exp(-((x-c)/w)**2);
const angularDifference=(a,b)=>Math.abs(Math.atan2(Math.sin(a-b),Math.cos(a-b)));

class MinHeap{
  constructor(){this.a=[];}
  push(id,key){const a=this.a,item={id,key};let i=a.length;a.push(item);while(i){const p=(i-1)>>1;if(a[p].key<key||a[p].key===key&&a[p].id<=id)break;a[i]=a[p];i=p;}a[i]=item;}
  pop(){const a=this.a,out=a[0],last=a.pop();if(a.length){let i=0;while(i*2+1<a.length){let c=i*2+1;if(c+1<a.length&&(a[c+1].key<a[c].key||a[c+1].key===a[c].key&&a[c+1].id<a[c].id))c++;if(a[c].key>last.key||a[c].key===last.key&&a[c].id>=last.id)break;a[i]=a[c];i=c;}a[i]=last;}return out;}
  get length(){return this.a.length;}
}

function percentile(values,p,mask){const a=[];for(let i=0;i<values.length;i++)if(!mask||mask(i))if(Number.isFinite(values[i]))a.push(values[i]);if(!a.length)return 0;a.sort((x,y)=>x-y);return a[Math.min(a.length-1,Math.max(0,Math.floor((a.length-1)*p)))];}
function robustNormalize(values,mask){const lo=percentile(values,.05,mask),hi=percentile(values,.95,mask),out=new Float32Array(values.length),d=Math.max(1e-9,hi-lo);for(let i=0;i<values.length;i++)out[i]=mask&&!mask(i)?0:clamp((values[i]-lo)/d,0,1);return out;}

/** Potential food surplus. This is intentionally crop-agnostic: it estimates
 * whether preindustrial agriculture can produce a surplus, not which crop is
 * grown or a real soil-yield forecast.
 */
export function productivityAt({biome,tempC,rainMm,slope,elevationM,wetDistanceKm,upstreamAreaKm2}){
  let base=BIOME_PRODUCTIVITY[biome]??.25;
  const temp=gaussian(tempC,13,11),rain=rainMm<450?clamp(rainMm/450,0,1):rainMm<=1600?1:clamp(1-(rainMm-1600)/2600,.30,1);
  const grade=Math.exp(-Math.max(0,slope)*28),elev=Math.exp(-Math.max(0,elevationM-1100)/1900);
  const water=wetDistanceKm<22&&biome!==2?1.08:1;
  const floodplain=upstreamAreaKm2>1200&&slope<.006&&elevationM<900?1.12:1;
  return clamp(base*temp*rain*grade*elev*water*floodplain,0,1);
}
export function localTravelFriction({biome,slope,elevationM}){
  const base=BIOME_FRICTION[biome]??1.5,grade=1+Math.min(8,Math.pow(Math.max(0,slope)*100,1.28)*.095),alt=1+Math.max(0,elevationM-1800)/3800;
  return base*grade*alt;
}

function riverLinkSlope(world,i){const r=world.receiver[i];if(r<0)return Infinity;const d=Math.hypot(world.mesh.x[i]-world.mesh.x[r],world.mesh.z[i]-world.mesh.z[r]);return d?Math.max(0,(world.filled[i]-world.filled[r])/(d*1000)):Infinity;}
function isWater(world,i){return !!(world.ocean[i]||world.lake[i]);}
function isReceiverEdge(world,a,b){return world.receiver[a]===b||world.receiver[b]===a;}

/** Generalized bulk-transport cost for an edge. Units are "land-km
 * equivalents", not hours, money or calibrated historical freight rates.
 * Water and navigable-river links are deliberately much cheaper than carts.
 */
export function edgeTravelCost(world,friction,navigableRiver,a,b,distanceKm){
  const waterA=isWater(world,a),waterB=isWater(world,b);
  if(waterA&&waterB)return distanceKm*.11;
  if(isReceiverEdge(world,a,b)&&(navigableRiver[a]||navigableRiver[b]))return distanceKm*.22;
  if(waterA!==waterB)return distanceKm*.48;
  return distanceKm*(friction[a]+friction[b])*.5;
}

function navigability(world){
  const N=world.height.length,nav=new Uint8Array(N),navDonors=new Uint8Array(N),threshold=Math.max(2200,world.config.sizeKm**2*.00235);
  let km=0;
  for(let i=0;i<N;i++){
    const r=world.receiver[i];if(r<0||world.ocean[i]||world.lake[i])continue;
    const slope=riverLinkSlope(world,i);
    if(world.river[i]&&world.area[i]>=threshold&&world.runoff[i]>=4&&slope<=.0018&&world.height[i]<1250){nav[i]=1;km+=Math.hypot(world.mesh.x[i]-world.mesh.x[r],world.mesh.z[i]-world.mesh.z[r]);}
  }
  for(let i=0;i<N;i++){const r=world.receiver[i];if(nav[i]&&r>=0)navDonors[r]++;}
  return{navigableRiver:nav,navigableDonors:navDonors,navigableRiverKm:km,navigableAreaThresholdKm2:threshold};
}

function travelField(world,friction,navigableRiver){
  const {mesh}=world,N=world.height.length,dist=new Float64Array(N).fill(Infinity),heap=new MinHeap(),source=new Uint8Array(N);
  // Sources are usable river reaches and practical shore nodes. Water itself
  // is not assigned human potential, but reaching its shore unlocks shipping.
  for(let i=0;i<N;i++){
    if(navigableRiver[i])source[i]=1;
    if(!isWater(world,i)&&world.slope[i]<.025){eachNeighbor(mesh,i,j=>{if(isWater(world,j))source[i]=1;});}
    if(source[i]){dist[i]=0;heap.push(i,0);}
  }
  while(heap.length){const item=heap.pop(),i=item.id;if(item.key!==dist[i])continue;eachNeighbor(mesh,i,(j,d)=>{
    const nd=dist[i]+edgeTravelCost(world,friction,navigableRiver,i,j,d);if(nd<dist[j]){dist[j]=nd;heap.push(j,nd);}
  });}
  const access=new Float32Array(N);for(let i=0;i<N;i++)access[i]=isWater(world,i)?0:Math.exp(-Math.min(1000,dist[i])/115);
  return{waterAccessCost:dist,transportAccess:access,transportSource:source};
}

function productionSources(world,productivity,friction,navigableRiver,limit=150){
  const mass=new Float64Array(productivity.length);
  for(let i=0;i<mass.length;i++)if(!isWater(world,i)){mass[i]=productivity[i]*world.mesh.nodeArea[i];eachNeighbor(world.mesh,i,j=>{if(!isWater(world,j))mass[i]+=productivity[j]*world.mesh.nodeArea[j]*.18;});}
  const candidates=Array.from({length:mass.length},(_,i)=>i).filter(i=>mass[i]>0).sort((a,b)=>mass[b]-mass[a]||a-b),chosen=[],minSpacing=Math.max(22,world.config.sizeKm/55);
  for(const i of candidates){let okay=true;for(const j of chosen)if(Math.hypot(world.mesh.x[i]-world.mesh.x[j],world.mesh.z[i]-world.mesh.z[j])<minSpacing){okay=false;break;}if(okay)chosen.push(i);if(chosen.length>=limit)break;}
  return{ids:chosen,mass,friction,navigableRiver};
}

/** Reachable surplus uses many bounded shortest-path searches rather than a
 * straight-line radius. Cheap river/lake/sea links allow surplus to propagate
 * farther than carts over difficult land. This is deliberately pre-road.
 */
function marketAccess(world,productivity,friction,navigableRiver){
  const N=world.height.length,raw=new Float64Array(N),{ids,mass}=productionSources(world,productivity,friction,navigableRiver),dist=new Float64Array(N).fill(Infinity),touched=[],heap=new MinHeap(),maxCost=210,decay=72;
  for(const source of ids){
    dist[source]=0;touched.push(source);heap.push(source,0);
    while(heap.length){const item=heap.pop(),i=item.id;if(item.key!==dist[i]||item.key>maxCost)continue;raw[i]+=mass[source]*Math.exp(-item.key/decay);
      eachNeighbor(world.mesh,i,(j,d)=>{const nd=item.key+edgeTravelCost(world,friction,navigableRiver,i,j,d);if(nd<=maxCost&&nd<dist[j]){if(!Number.isFinite(dist[j]))touched.push(j);dist[j]=nd;heap.push(j,nd);}});
    }
    for(const i of touched)dist[i]=Infinity;touched.length=0;heap.a.length=0;
  }
  return{marketAccessRaw:raw,marketAccess:robustNormalize(raw,i=>!isWater(world,i)),productionSourceCount:ids.length};
}

function strategicScores(world,productivity,navigableRiver,navigableDonors){
  const N=world.height.length,score=new Float32Array(N),kind=Array(N).fill(''),reason=Array(N).fill(''),riverDonors=new Uint8Array(N);
  for(let i=0;i<N;i++){const r=world.receiver[i];if(world.river[i]&&r>=0&&!world.ocean[r])riverDonors[r]++;}
  function set(i,s,k,r){if(s>score[i]){score[i]=s;kind[i]=k;reason[i]=r;}}
  for(let i=0;i<N;i++){
    if(isWater(world,i))continue;const r=world.receiver[i];
    if(world.confluences.includes(i))set(i,.86,'confluence','major tributaries meet here');
    if(world.river[i]&&r>=0&&isWater(world,r))set(i,.94,'mouth','river traffic meets open water');
    if(navigableRiver[i]&&!navigableDonors[i])set(i,.78,'head','upstream limit of the navigable reach');
    let shore=false;eachNeighbor(world.mesh,i,j=>{if(isWater(world,j))shore=true;});if(shore&&world.slope[i]<.018&&productivity[i]>.18)set(i,.62+.18*productivity[i],'port','low-gradient shore beside productive land');
    if(world.river[i]&&!navigableRiver[i]&&world.area[i]>650&&world.area[i]<6000&&riverLinkSlope(world,i)<.003&&world.slope[i]<.018)set(i,.38+.20*productivity[i],'ford','manageable non-navigable river crossing');
    const h=world.height[i];if(h>450&&h<2300&&world.slope[i]<.065){
      const high=[],low=[];eachNeighbor(world.mesh,i,j=>{const angle=Math.atan2(world.mesh.z[j]-world.mesh.z[i],world.mesh.x[j]-world.mesh.x[i]),dh=world.height[j]-h;if(dh>170)high.push(angle);if(dh<90)low.push(angle);});
      let opposite=0;for(let a=0;a<high.length;a++)for(let b=a+1;b<high.length;b++)opposite=Math.max(opposite,angularDifference(high[a],high[b]));
      if(high.length>=2&&low.length>=2&&opposite>2.15)set(i,.46+.25*clamp((opposite-2.15)/.8,0,1),'pass','low saddle through surrounding high ground');
    }
  }
  return{strategicScore:score,strategicKind:kind,strategicReason:reason};
}

function selectStrategicNodes(world,score,kind,reason,humanPotential,max=36){
  const ids=Array.from({length:score.length},(_,i)=>i).filter(i=>score[i]>=.36&&!isWater(world,i)).sort((a,b)=>(score[b]+humanPotential[b]*.25)-(score[a]+humanPotential[a]*.25)||a-b),out=[],spacing=Math.max(24,world.config.sizeKm/55);
  for(const i of ids){let okay=true;for(const n of out)if(Math.hypot(world.mesh.x[i]-n.xKm,world.mesh.z[i]-n.zKm)<spacing){okay=false;break;}if(!okay)continue;out.push({id:i,type:kind[i],label:STRATEGIC_TYPES[kind[i]]?.[0]||'Transport opportunity',score:score[i],potential:humanPotential[i],reason:reason[i],xKm:world.mesh.x[i],zKm:world.mesh.z[i]});if(out.length>=max)break;}
  return out;
}

export function generateHumanGeography(world){
  if(!world||world.stage<3)throw new Error('Environments are required before human geography');
  const N=world.height.length,productivity=new Float32Array(N),travelFriction=new Float32Array(N),productiveArea=new Float64Array(N);
  for(let i=0;i<N;i++){
    if(isWater(world,i))continue;
    productivity[i]=productivityAt({biome:world.biome[i],tempC:world.temperature[i],rainMm:world.rainfall[i],slope:world.slope[i],elevationM:world.height[i],wetDistanceKm:world.wetDistanceKm[i],upstreamAreaKm2:world.area[i]});
    travelFriction[i]=localTravelFriction({biome:world.biome[i],slope:world.slope[i],elevationM:world.height[i]});productiveArea[i]=productivity[i]*world.mesh.nodeArea[i];
  }
  const nav=navigability(world),travel=travelField(world,travelFriction,nav.navigableRiver),market=marketAccess(world,productivity,travelFriction,nav.navigableRiver),strategic=strategicScores(world,productivity,nav.navigableRiver,nav.navigableDonors);
  const frictionNorm=robustNormalize(travelFriction,i=>!isWater(world,i)),humanPotential=new Float32Array(N);
  for(let i=0;i<N;i++)if(!isWater(world,i)){
    const ease=1-frictionNorm[i],raw=.30*productivity[i]+.31*market.marketAccess[i]+.18*travel.transportAccess[i]+.13*strategic.strategicScore[i]+.08*ease;
    humanPotential[i]=clamp(raw*(world.biome[i]===2?.62:1),0,1);
  }
  const strategicNodes=selectStrategicNodes(world,strategic.strategicScore,strategic.strategicKind,strategic.strategicReason,humanPotential);
  let productiveLandKm2=0;for(let i=0;i<N;i++)if(productivity[i]>=.45)productiveLandKm2+=world.mesh.nodeArea[i];
  return{...world,version:'regional-world-v4',stage:4,productivity,productiveArea,productiveLandKm2,travelFriction,travelFrictionNormalized:frictionNorm,...nav,...travel,...market,...strategic,humanPotential,strategicNodes,humanModel:HUMAN_VERSION};
}

export function humanSummary(world){
  if(world.stage<4)return null;let highPotentialKm2=0;for(let i=0;i<world.height.length;i++)if(world.humanPotential[i]>=.67)highPotentialKm2+=world.mesh.nodeArea[i];
  return{productiveLandKm2:world.productiveLandKm2,highPotentialKm2,navigableRiverKm:world.navigableRiverKm,strategicNodes:world.strategicNodes.length,productionSources:world.productionSourceCount};
}
