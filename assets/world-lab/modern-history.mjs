/** Modern history is an explicit target-era game model, not a demographic
 * forecast. Twelve 25-year frames follow the unchanged agrarian simulation.
 * The endpoint assumes 65 people/km² of habitability-weighted land and 72%
 * urbanization. Natural increase and settlement redistribution are modeled as
 * a transition toward that target; the agrarian food ledger is not extended.
 *
 * Up to 1000 representative urban centers stand for a hierarchy of cities and
 * towns, with rural residents represented across the suitable countryside.
 * Two multi-source land searches provide inherited community access, disjoint
 * hinterlands and a sparse neighboring-center transport graph: no all-pairs
 * regional searches, no sea crossings, and no mutation of parent geography.
 */
import {simulateHumanHistory} from './human-history.mjs';
import {createCommunityIdentity,namePlace} from './place-names.mjs';

export const MODERN_GENERATIONS=12;
export const MODERN_YEARS_PER_GENERATION=25;
export const MODERN_HISTORY_VERSION='modern-history-v1';
const TARGET_DENSITY=65,TARGET_URBAN_SHARE=.72,MAX_CENTERS=1000;
const ROAD_CLASSES=[['trail',.012],['road',.018],['arterial',.026]];
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
const pause=()=>new Promise(resolve=>setTimeout(resolve,0));
const sum=a=>a.reduce((v,x)=>v+x,0);
function hash(n,seed){let t=(n^seed)>>>0;t=Math.imul(t^t>>>16,0x45d9f3b);t=Math.imul(t^t>>>16,0x45d9f3b);return((t^t>>>16)>>>0)/4294967296;}
const accessAt=(world,i)=>Number.isFinite(world.transportAccess?.[i])?clamp(world.transportAccess[i]):1/(1+world.travelFriction[i]);
const dry=(world,i)=>!world.ocean[i]&&!world.lake[i];

class Heap{
 constructor(){this.a=[];}
 push(id,key){const a=this.a,item={id,key};let i=a.length;a.push(item);while(i){const p=(i-1)>>1;if(a[p].key<=key)break;a[i]=a[p];i=p;}a[i]=item;}
 pop(){const a=this.a,out=a[0],last=a.pop();if(a.length){let i=0;while(i*2+1<a.length){let c=i*2+1;if(c+1<a.length&&a[c+1].key<a[c].key)c++;if(a[c].key>=last.key)break;a[i]=a[c];i=c;}a[i]=last;}return out;}
}

// Prefix rounding conserves an integer total in linear time. The final positive
// weight receives the exact remaining budget, including floating-point residue.
function apportion(total,weights){
 const out=new Float64Array(weights.length),weightSum=sum(weights);if(!total||!weightSum)return out;
 let cumulative=0,assigned=0,last=-1;for(let i=0;i<weights.length;i++)if(weights[i]>0)last=i;
 for(let i=0;i<weights.length;i++)if(weights[i]>0){cumulative+=weights[i];const next=i===last?total:Math.min(total,Math.round(total*cumulative/weightSum));out[i]=next-assigned;assigned=next;}
 return out;
}

function landModel(world){
 const N=world.height.length,mesh=world.mesh,habitability=new Float64Array(N),component=new Int32Array(N).fill(-1),components=[],queue=new Int32Array(N);
 let landAreaKm2=0,suitableAreaKm2=0,habitableAreaKm2=0;
 for(let i=0;i<N;i++)if(dry(world,i)){
  landAreaKm2+=mesh.nodeArea[i];
  if(world.slope[i]<.14&&world.biome[i]!==11&&world.productivity[i]>.005){
   const biomeFactor=world.biome[i]===10?.2:world.biome[i]===2?.45:1;
   habitability[i]=Math.sqrt(world.productivity[i])*Math.exp(-Math.max(0,world.slope[i])*14)*biomeFactor*(.82+.18*accessAt(world,i))*Math.exp(-Math.max(0,world.height[i]-1800)/3000);
   suitableAreaKm2+=habitability[i]*mesh.nodeArea[i];habitableAreaKm2+=mesh.nodeArea[i];
  }
 }
 for(let i=0;i<N;i++)if(dry(world,i)&&component[i]===-1){
  const id=components.length,part={id,nodes:[],mass:0,centers:[]};let head=0,tail=0;queue[tail++]=i;component[i]=id;
  while(head<tail){const node=queue[head++];part.nodes.push(node);part.mass+=habitability[node]*mesh.nodeArea[node];
   for(let k=mesh.offsets[node];k<mesh.offsets[node+1];k++){const j=mesh.neighbors[k];if(dry(world,j)&&component[j]===-1){component[j]=id;queue[tail++]=j;}}
  }
  components.push(part);
 }
 return {habitability,component,components,landAreaKm2,suitableAreaKm2,habitableAreaKm2};
}

async function landOwners(world,sources,cancelled){
 const N=world.height.length,mesh=world.mesh,owner=new Int32Array(N).fill(-1),previous=new Int32Array(N).fill(-1),distance=new Float64Array(N).fill(Infinity),heap=new Heap();
 for(const {nodeId,id} of sources){owner[nodeId]=id;distance[nodeId]=0;heap.push(nodeId,0);}
 let visits=0;
 while(heap.a.length){const {id,key}=heap.pop();if(key!==distance[id])continue;
  if(++visits%4096===0){await pause();if(cancelled())return null;}
  for(let k=mesh.offsets[id];k<mesh.offsets[id+1];k++){
   const j=mesh.neighbors[k];if(!dry(world,j))continue;
   const cost=key+mesh.distances[k]*(.75+Math.min(5,(world.travelFriction[id]+world.travelFriction[j])*.12));
   if(cost<distance[j]||(cost===distance[j]&&owner[id]<owner[j])){distance[j]=cost;owner[j]=owner[id];previous[j]=id;heap.push(j,cost);}
  }
 }
 return {owner,previous,distance};
}

function chooseCenters(world,history,land){
 const {mesh}=world,{seed}=history,occupied=new Set(history.sites.map(s=>s.nodeId));
 const desired=Math.min(MAX_CENTERS,Math.max(history.sites.length,Math.ceil(land.suitableAreaKm2/1800)));
 if(!desired)return [];
 const side=Math.max(world.parentDomain.nominalSpacingKm||1,Math.sqrt(land.habitableAreaKm2/desired)),bins=new Map(),occupiedBins=new Set();
 const key=node=>`${Math.floor(mesh.x[node]/side)},${Math.floor(mesh.z[node]/side)}`;
 for(const site of history.sites)occupiedBins.add(key(site.nodeId));
 for(let node=0;node<world.height.length;node++)if(land.habitability[node]>.035&&world.slope[node]<.085&&!occupied.has(node)){
  const bin=key(node);if(occupiedBins.has(bin))continue;
  const score=land.habitability[node]*(.7+.55*accessAt(world,node))*(.78+.44*hash(node,seed));
  const old=bins.get(bin);if(!old||score>old.score)bins.set(bin,{nodeId:node,score,step:1+Math.floor(hash(node,seed^0x9187)*7)});
 }
 // Ordering bin winners by a seeded value samples the whole parent when the
 // representative-center cap is reached, rather than filling one corner first.
 return [...bins.values()].sort((a,b)=>hash(a.nodeId,seed^0x417a)-hash(b.nodeId,seed^0x417a)||a.nodeId-b.nodeId).slice(0,MAX_CENTERS-history.sites.length).sort((a,b)=>a.step-b.step||a.nodeId-b.nodeId);
}

function connectCenters(world,history,ownership,earlyGenerations,targetDegree){
 const {mesh}=world,{owner,distance,previous}=ownership,pairs=new Map();
 // A river link records water transport, not a paved approach. Keep land pairs,
 // degree, and connectivity separate so river-connected cities can gain roads.
 const landRoutes=history.routes.filter(r=>r.kind==='land'),known=new Set(landRoutes.map(r=>`${Math.min(r.a,r.b)},${Math.max(r.a,r.b)}`));
 for(let i=0;i<world.height.length;i++)if(owner[i]>=0)for(let k=mesh.offsets[i];k<mesh.offsets[i+1];k++){
  const j=mesh.neighbors[k];if(owner[j]<0||owner[i]===owner[j])continue;
  const a=Math.min(owner[i],owner[j]),b=Math.max(owner[i],owner[j]),key=`${a},${b}`;if(known.has(key))continue;
  const cost=distance[i]+distance[j]+mesh.distances[k],old=pairs.get(key);
  if(!old||cost<old.cost)pairs.set(key,{a,b,i:owner[i]===a?i:j,j:owner[i]===a?j:i,cost});
 }
 const parent=Int32Array.from(history.sites,(_,i)=>i),degree=new Uint16Array(history.sites.length),root=x=>{while(parent[x]!==x){parent[x]=parent[parent[x]];x=parent[x];}return x;};
 for(const r of landRoutes){parent[root(r.a)]=root(r.b);degree[r.a]++;degree[r.b]++;}
 const ordered=[...pairs.values()].sort((a,b)=>a.cost-b.cost||a.a-b.a||a.b-b.b),selected=[],selectedPairs=new Set();
 const add=p=>{
  selectedPairs.add(`${p.a},${p.b}`);degree[p.a]++;degree[p.b]++;
  const left=[p.i],right=[p.j];while(previous[left.at(-1)]>=0)left.push(previous[left.at(-1)]);while(previous[right.at(-1)]>=0)right.push(previous[right.at(-1)]);
  selected.push({a:p.a,b:p.b,nodes:[...left.reverse(),...right],kind:'land',founded:Math.max(earlyGenerations+2,history.sites[p.a].founded,history.sites[p.b].founded)});
 };
 // First connect each dry component using only overland edges.
 for(const p of ordered){const ra=root(p.a),rb=root(p.b);if(ra===rb)continue;parent[ra]=rb;add(p);}
 // Then spend bounded extra degree on important centers before local ones.
 // Candidate discovery remains the same O(mesh edges) ownership-boundary pass.
 for(const p of [...ordered].sort((a,b)=>Math.max(targetDegree[b.a],targetDegree[b.b])-Math.max(targetDegree[a.a],targetDegree[a.b])||a.cost-b.cost||a.a-b.a||a.b-b.b)){
  if(selectedPairs.has(`${p.a},${p.b}`)||degree[p.a]>=targetDegree[p.a]||degree[p.b]>=targetDegree[p.b])continue;
  add(p);
 }
 selected.sort((a,b)=>a.founded-b.founded||a.a-b.a||a.b-b.b);
 for(const route of selected)history.routes.push({id:history.routes.length,...route});
}

function urbanForm(population,nodeId,world,availableAreaKm2){
 if(!population)return {urbanAreaKm2:0,densityPerKm2:0,coreDensityPerKm2:0,suburbanDensityPerKm2:0,corePopulation:0,coreAreaKm2:0,suburbanAreaKm2:0};
 let coreDensityPerKm2=6500+Math.min(7500,Math.sqrt(population)*4),suburbanDensityPerKm2=1000+Math.min(1600,Math.sqrt(population)*1.2)+accessAt(world,nodeId)*150;
 const corePopulation=Math.round(population*.38);let coreAreaKm2=corePopulation/coreDensityPerKm2,suburbanAreaKm2=(population-corePopulation)/suburbanDensityPerKm2;
 const scale=Math.min(1,availableAreaKm2/Math.max(1e-12,coreAreaKm2+suburbanAreaKm2));
 if(scale<1){coreAreaKm2*=scale;suburbanAreaKm2*=scale;coreDensityPerKm2/=scale;suburbanDensityPerKm2/=scale;}
 const urbanAreaKm2=coreAreaKm2+suburbanAreaKm2;
 return {urbanAreaKm2,densityPerKm2:population/urbanAreaKm2,coreDensityPerKm2,suburbanDensityPerKm2,corePopulation,coreAreaKm2,suburbanAreaKm2};
}

function settleUrbanNodes(world,states,ownedNodes){
 const N=world.height.length,population=new Float64Array(N),urbanFraction=new Float32Array(N),urbanArea=new Float64Array(N);
 for(const state of states)if(state.population){
  const nodes=ownedNodes[state.siteId];let cursor=0;
  for(const [area,people] of [[state.coreAreaKm2,state.corePopulation],[state.suburbanAreaKm2,state.population-state.corePopulation]]){
   let remaining=area,assigned=0,covered=0;
   while(remaining>1e-10&&cursor<nodes.length){
    const node=nodes[cursor],capacity=world.mesh.nodeArea[node]*.7-urbanArea[node],used=Math.min(remaining,Math.max(0,capacity));
    covered+=used;remaining-=used;urbanArea[node]+=used;
    const next=remaining<=1e-10?people:Math.min(people,Math.round(people*covered/area));population[node]+=next-assigned;assigned=next;
    if(capacity-used<1e-10)cursor++;
   }
   // Floating point area residue must not lose a resident at the last cell.
   if(assigned<people&&nodes.length)population[nodes[Math.min(cursor,nodes.length-1)]]+=people-assigned;
  }
 }
 for(let i=0;i<N;i++)urbanFraction[i]=urbanArea[i]/world.mesh.nodeArea[i];
 return {population,urbanFraction,urbanArea};
}

export async function simulateWorldHistory(world,options={},progress=()=>{},cancelled=()=>false){
 const era=options.era??'modern';if(!['modern','agrarian'].includes(era))throw new Error('History era must be modern or agrarian');
 const earlyGenerations=options.generations??12,totalGenerations=earlyGenerations+(era==='modern'?MODERN_GENERATIONS:0);
 const history=await simulateHumanHistory(world,options,update=>progress({...update,generations:totalGenerations,era:'agrarian'}),cancelled);
 if(!history||cancelled())return null;
 const N=world.height.length,mesh=world.mesh,land=landModel(world);
 Object.assign(history,{earlyGenerations,era,modernYearsPerGeneration:MODERN_YEARS_PER_GENERATION});
 for(const frame of history.snapshots){
  // Early farm/village residents remain in their original site budgets. Only
  // town/city budgets are classified urban; the source ledger is untouched.
  const urbanPopulation=sum(frame.siteStates.map(s=>['town','city'].includes(s.status)?s.population:0));
  Object.assign(frame,{era:'agrarian',eraLabel:'Agrarian settlement'});
  Object.assign(frame.summary,{urbanPopulation,ruralPopulation:frame.summary.population-urbanPopulation,landAreaKm2:land.landAreaKm2,densityPerKm2:land.landAreaKm2?frame.summary.population/land.landAreaKm2:0});
 }
 if(era==='agrarian')return history;
 const early=history.snapshots.at(-1),usedNames=new Set(history.sites.map(s=>s.name)),inheritedPopulation=new Float64Array(N);
 for(const state of early.siteStates)inheritedPopulation[history.sites[state.siteId].nodeId]+=state.population;
 const inheritance=await landOwners(world,history.sites,cancelled);if(!inheritance||cancelled())return null;
 const additions=chooseCenters(world,history,land),componentGroups=new Map();
 for(const candidate of additions){
  const {nodeId,step}=candidate,id=history.sites.length,origin=inheritance.owner[nodeId],part=land.component[nodeId];
  let groupId=origin>=0?(early.siteStates[origin]?.groupId??history.sites[origin].groupId):componentGroups.get(part);
  if(groupId===undefined){groupId=history.groups.length;history.groups.push({...createCommunityIdentity(world,nodeId,groupId,history.seed),founded:earlyGenerations+step,color:['#d5a65b','#70a9b1','#b88bba','#a3b36b','#dc896a','#819bd2','#bbad89','#77b59c'][groupId%8]});componentGroups.set(part,groupId);}
  const named=namePlace(world,{nodeId,id,seed:history.seed,group:history.groups[groupId],usedNames});usedNames.add(named.name);
  history.sites.push({id,nodeId,...named,groupId,founded:earlyGenerations+step,reason:world.navigableRiver[nodeId]?'River access and suitable nearby land support this later urban center.':'Suitable land and regional access support a later town and its rural hinterland.',originSiteId:origin>=0?origin:null});
 }
 await pause();if(cancelled())return null;
 const ownership=await landOwners(world,history.sites,cancelled);if(!ownership||cancelled())return null;
 const ownedNodes=history.sites.map(()=>[]),masses=new Float64Array(history.sites.length),areas=new Float64Array(history.sites.length);
 for(let i=0;i<N;i++)if(ownership.owner[i]>=0){const id=ownership.owner[i];masses[id]+=land.habitability[i]*mesh.nodeArea[i];if(land.habitability[i]>0&&world.slope[i]<.14){ownedNodes[id].push(i);areas[id]+=mesh.nodeArea[i]*.7;}}
 for(const site of history.sites){
  // An inherited viable village always has its own buildable node, even if
  // modern biome preference otherwise rates that node as unsuitable.
  if(!ownedNodes[site.id].length){ownedNodes[site.id].push(site.nodeId);areas[site.id]=mesh.nodeArea[site.nodeId]*.7;}
  ownedNodes[site.id].sort((a,b)=>ownership.distance[a]-ownership.distance[b]||a-b);
  land.components[land.component[site.nodeId]].centers.push(site.id);
 }
 const weights=new Float64Array(history.sites.length);
 const score=id=>{const site=history.sites[id],old=early.siteStates[id];return (.7+land.habitability[site.nodeId]+accessAt(world,site.nodeId)*.4+Math.log1p(old?.population||0)*.06)*(.65+hash(site.nodeId,history.seed^0x179a));};
 for(const part of land.components){part.centers.sort((a,b)=>score(b)-score(a)||a-b);part.centers.forEach((id,rank)=>{weights[id]=Math.pow(Math.max(1,masses[id]),.65)/Math.pow(rank+1,.88);});}
 const targetLandDegree=new Uint8Array(history.sites.length).fill(3);
 for(const part of land.components){
  const ranked=[...part.centers].sort((a,b)=>weights[b]-weights[a]||a-b),major=Math.max(1,Math.ceil(ranked.length*.05)),regional=Math.max(major,Math.ceil(ranked.length*.2));
  ranked.forEach((id,rank)=>targetLandDegree[id]=rank<major?5:rank<regional?4:3);
 }
 connectCenters(world,history,ownership,earlyGenerations,targetLandDegree);
 const targetPopulation=Math.max(early.summary.population,Math.round(land.suitableAreaKm2*TARGET_DENSITY));
 const componentWeights=land.components.map(p=>p.mass||sum(p.centers.map(id=>early.siteStates[id]?.population||0)));
 history.version=MODERN_HISTORY_VERSION;history.generations=totalGenerations;
 history.modernModel={kind:'target-era-density',targetDensityPerSuitableKm2:TARGET_DENSITY,targetUrbanShare:TARGET_URBAN_SHARE,representativeCenterLimit:MAX_CENTERS,transitionGenerations:MODERN_GENERATIONS,yearsPerTransition:MODERN_YEARS_PER_GENERATION,description:'Prototype density and urbanization assumptions; not a calibrated demographic forecast. Later growth and redistribution do not use the agrarian food ledger.'};
 let eventId=history.snapshots.reduce((n,f)=>Math.max(n,...f.events.map(e=>e.id+1)),0);
 for(let step=1;step<=MODERN_GENERATIONS;step++){
  if(cancelled())return null;
  const generation=earlyGenerations+step,year=early.year+step*MODERN_YEARS_PER_GENERATION,t=step/MODERN_GENERATIONS,previous=history.snapshots.at(-1),population=Math.round(early.summary.population+(targetPopulation-early.summary.population)*t**1.65);
  const urbanShare=(early.summary.population?early.summary.urbanPopulation/early.summary.population:0)*(1-t)+TARGET_URBAN_SHARE*t;
  const componentPopulation=apportion(population,componentWeights),cityPopulation=new Float64Array(history.sites.length),ruralTargets=new Float64Array(land.components.length);
  for(const part of land.components){
   const active=part.centers.filter(id=>history.sites[id].founded<=generation),urban=active.length?Math.round(componentPopulation[part.id]*urbanShare):0;
   const budget=apportion(urban,active.map(id=>weights[id]));active.forEach((id,i)=>cityPopulation[id]=budget[i]);ruralTargets[part.id]=componentPopulation[part.id]-urban;
  }
  const siteStates=history.sites.filter(s=>s.founded<=generation).map(site=>{
   const population=cityPopulation[site.id],old=early.siteStates[site.id],form=urbanForm(population,site.nodeId,world,areas[site.id]);
   return {siteId:site.id,population,peakPopulation:Math.max(population,previous.siteStates[site.id]?.peakPopulation||0),status:!population?'abandoned':population>=50000?'city':population>=5000?'town':'village',groupId:old?.groupId??site.groupId,farmAreaKm2:0,...form};
  });
  const nodal=settleUrbanNodes(world,siteStates,ownedNodes),ruralPopulation=new Float64Array(N),populationDensity=new Float32Array(N),influence=new Int16Array(N).fill(-1),cultivation=new Float32Array(N),woodland=new Float32Array(N),soil=early.soil.slice(),settled=new Float32Array(N);
  for(const part of land.components){
   // A supplied world's agrarian population can survive on a biome disfavored
   // by the modern preference model. Keep those inherited residents at their
   // existing nodes instead of dropping a rural budget with zero weights.
   const allocation=apportion(ruralTargets[part.id],part.nodes.map(i=>part.mass?land.habitability[i]*Math.max(0,mesh.nodeArea[i]-nodal.urbanArea[i]):inheritedPopulation[i]));
   part.nodes.forEach((node,i)=>{ruralPopulation[node]=allocation[i];nodal.population[node]+=allocation[i];});
  }
  let cultivatedKm2=0;
  for(let i=0;i<N;i++)if(dry(world,i)){
   populationDensity[i]=nodal.population[i]/mesh.nodeArea[i];
   const city=ownership.owner[i],state=city>=0?siteStates[city]:null;
   if(state?.population)influence[i]=state.groupId;
   else if(inheritance.owner[i]>=0)influence[i]=early.siteStates[inheritance.owner[i]]?.groupId??-1;
   const desired=early.cultivation[i]*(1-t)+land.habitability[i]*.2*t;
   cultivation[i]=Math.min(1-nodal.urbanFraction[i],desired);woodland[i]=Math.min(1-cultivation[i]-nodal.urbanFraction[i],early.woodland[i]);
   settled[i]=clamp(Math.sqrt(nodal.urbanFraction[i])+.07*Math.log1p(ruralPopulation[i]/mesh.nodeArea[i]));cultivatedKm2+=cultivation[i]*mesh.nodeArea[i];
  }
  const routeStates=history.routes.filter(r=>r.founded<=generation).map(route=>{
   const a=siteStates[route.a],b=siteStates[route.b],active=!!(a?.population&&b?.population);
   const state={routeId:route.id,active,traffic:active?(a.population+b.population)*(.025+.025*t):0,lastUsed:active?generation:previous.routeStates[route.id]?.lastUsed??route.founded};
   if(route.kind==='land'){
    const demand=active?a.population+b.population:0,desired=demand>=100000?2:demand>=10000?1:0,prior=ROAD_CLASSES.findIndex(([name])=>name===previous.routeStates[route.id]?.roadClass),level=Math.max(desired,prior);
    [state.roadClass,state.widthKm]=ROAD_CLASSES[level];
   }
   return state;
  });
  const era=step<=4?'industrial':step<=8?'urbanizing':'modern',eraLabel=era==='industrial'?'Industrial transition':era==='urbanizing'?'Urban expansion':'Modern day';
  const events=[],addEvent=(type,siteIds,text,extra={})=>events.push({id:eventId++,generation,year,type,siteIds,routeId:null,text,...extra});
  if([1,5,9].includes(step))addEvent('urbanization',[],`${eraLabel}: population and settlement distribution follow explicit target-era density assumptions.`);
  for(const site of history.sites)if(site.founded===generation)addEvent('founding',[site.id],`${site.name} emerges as a later urban center. ${site.reason}`);
  for(const route of history.routes)if(route.founded===generation&&route.id>=early.routeStates.length)addEvent('connection',[route.a,route.b],`${history.sites[route.a].name} and ${history.sites[route.b].name} connect along a land corridor.`,{routeId:route.id});
  const urbanPopulation=sum(cityPopulation),ruralTotal=sum(ruralPopulation),urbanAreaKm2=sum(siteStates.map(s=>s.urbanAreaKm2));
  const summary={population:urbanPopulation+ruralTotal,urbanPopulation,ruralPopulation:ruralTotal,landAreaKm2:land.landAreaKm2,suitableAreaKm2:land.suitableAreaKm2,densityPerKm2:land.landAreaKm2?(urbanPopulation+ruralTotal)/land.landAreaKm2:0,urbanShare:population?urbanPopulation/population:0,urbanAreaKm2,settlements:siteStates.filter(s=>s.population>0).length,abandoned:siteStates.filter(s=>!s.population).length,routeCount:routeStates.filter(r=>r.active).length,cultivatedKm2};
  const accounting={model:'modern-density-transition',populationBefore:previous.summary.population,populationAfter:summary.population,modeledPopulationChange:summary.population-previous.summary.population,urbanPopulation,ruralPopulation:ruralTotal,urbanPopulationChange:urbanPopulation-previous.summary.urbanPopulation,ruralPopulationChange:ruralTotal-previous.summary.ruralPopulation,targetPopulation,targetDensityPerSuitableKm2:TARGET_DENSITY,targetUrbanShare:TARGET_URBAN_SHARE};
  history.snapshots.push({generation,year,era,eraLabel,siteStates,routeStates,cultivation,woodland,soil,influence,settled,population:nodal.population,ruralPopulation,populationDensity,urbanFraction:nodal.urbanFraction,events,summary,accounting});
  progress({generation,generations:totalGenerations,era});await pause();
 }
 if(cancelled())return null;
 return history;
}
