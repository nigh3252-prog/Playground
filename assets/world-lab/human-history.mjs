/** Parent-wide, deterministic game history. These are explicit prototype heuristics,
 * not calibrated historical population or crop forecasts. One person-year of food
 * comes from 1/(85 * productivity * soil) km² of crops. At most 62% of a cell is
 * farmed. Five-year demographic updates, nearest reachable land ownership, and
 * explicit surplus transfers ensure land, food and migrants are never duplicated.
 * River freight is allowed only on navigable receiver edges. This version has no
 * open-water capability: coasts do not automatically unlock trans-oceanic travel.
 */
export const HUMAN_HISTORY_VERSION='human-history-v1';
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
const pause=()=>new Promise(resolve=>setTimeout(resolve,0));
function random32(seed){return()=>{seed=(seed+0x6D2B79F5)>>>0;let t=seed;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}
function hash(n,seed){let t=(n^seed)>>>0;t=Math.imul(t^t>>>16,0x45d9f3b);t=Math.imul(t^t>>>16,0x45d9f3b);return((t^t>>>16)>>>0)/4294967296;}
class Heap{
 constructor(){this.a=[];}
 push(id,key){const a=this.a,v={id,key};let i=a.length;a.push(v);while(i){const p=(i-1)>>1;if(a[p].key<=key)break;a[i]=a[p];i=p;}a[i]=v;}
 pop(){const a=this.a,out=a[0],v=a.pop();if(a.length){let i=0;while(i*2+1<a.length){let c=i*2+1;if(c+1<a.length&&a[c+1].key<a[c].key)c++;if(a[c].key>=v.key)break;a[i]=a[c];i=c;}a[i]=v;}return out;}
}
function validate(world,options){
 if(!world||world.stage!==4)throw new Error('Human history requires a Stage 4 world');
 if(!world.parentDomain)throw new Error('Human history requires a whole parent world');
 const N=world.height?.length;if(!N)throw new Error('Parent height array is missing');
 for(const key of ['ocean','lake','slope','biome','productivity','productiveArea','travelFriction','navigableRiver','receiver'])if(world[key]?.length!==N)throw new Error(`Parent ${key} must have ${N} nodes`);
 const mesh=world.mesh;
 for(const key of ['x','z','nodeArea'])if(mesh?.[key]?.length!==N)throw new Error(`Parent mesh.${key} must have ${N} nodes`);
 if(mesh.offsets?.length!==N+1||mesh.neighbors?.length!==mesh.distances?.length||mesh.offsets[N]!==mesh.neighbors.length||mesh.offsets[0]!==0)throw new Error('Parent mesh adjacency is invalid');
 for(let i=0;i<N;i++){
  if(!Number.isFinite(world.height[i])||!Number.isFinite(world.productivity[i])||world.productivity[i]<0||world.productivity[i]>1||!Number.isFinite(world.productiveArea[i])||world.productiveArea[i]<0||!Number.isFinite(mesh.nodeArea[i])||mesh.nodeArea[i]<=0||!Number.isFinite(mesh.x[i])||!Number.isFinite(mesh.z[i])||!Number.isFinite(world.slope[i])||!Number.isFinite(world.travelFriction[i])||world.travelFriction[i]<0)throw new Error(`Invalid parent geography at node ${i}`);
  if(mesh.offsets[i]>mesh.offsets[i+1])throw new Error('Parent mesh offsets must be ordered');
 }
 for(let k=0;k<mesh.neighbors.length;k++)if(!Number.isInteger(mesh.neighbors[k])||mesh.neighbors[k]<0||mesh.neighbors[k]>=N||!Number.isFinite(mesh.distances[k])||mesh.distances[k]<=0)throw new Error('Invalid parent mesh edge');
 const seed=options.seed??104729,generations=options.generations??12,yearsPerGeneration=options.yearsPerGeneration??25;
 if(!Number.isInteger(seed)||seed<0||seed>4294967295)throw new Error('History seed must be a uint32 integer');
 if(!Number.isInteger(generations)||generations<1||generations>20)throw new Error('History generations must be an integer from 1 to 20');
 if(!Number.isFinite(yearsPerGeneration)||yearsPerGeneration<=0||yearsPerGeneration>100)throw new Error('History yearsPerGeneration must be greater than 0 and at most 100');
 return {N,seed,generations,yearsPerGeneration};
}
// Indexed by world-core.BIOMES: water, wetland, forests, open woodland,
// grassland, steppe, scrub, mountain forest, alpine tundra, snow/ice.
const BIOME_WOODLAND=[0,0,.22,.9,.85,.5,.15,.05,.025,.75,0,0];
const COLORS=['#d5a65b','#70a9b1','#b88bba','#a3b36b','#dc896a','#819bd2','#bbad89','#77b59c'];
const PREFIX=['Ash','Alder','Willow','Stone','Reed','Oak','Fern','Hazel','Birch','Raven','Moss','Elm','Cedar','Flint','Amber','Pine'];
const SUFFIX=['ford','mere','stead','brook','field','haven','bank','grove','hill','wick','vale','well'];

export async function simulateHumanHistory(world,options={},progress=()=>{},cancelled=()=>false){
 const {N,seed,generations,yearsPerGeneration}=validate(world,options);
 if(cancelled())return null;
 const rng=random32(seed),mesh=world.mesh,sites=[],routes=[],groups=[],snapshots=[],states=[],routeStates=[],searches=[],generationTrade=[],nameCounts=new Map(),blockedUntil=[],abandonedAt=[],siteAt=new Int32Array(N).fill(-1);
 const dry=i=>!world.ocean[i]&&!world.lake[i];
 const viable=i=>dry(i)&&world.productivity[i]>=.075&&world.slope[i]<.085;
 const riverEdge=(a,b)=>(world.receiver[a]===b&&world.navigableRiver[a])||(world.receiver[b]===a&&world.navigableRiver[b]);
 const edgeCost=(a,b,d)=>d*(riverEdge(a,b)?.35:Math.max(.7,(world.travelFriction[a]+world.travelFriction[b])*.5));
 const maxTravel=240,farmTravel=75,spacing=Math.max(12,(world.parentDomain.nominalSpacingKm||world.stepKm||8)*1.4);
 const apart=(node)=>sites.every(s=>Math.hypot(mesh.x[node]-mesh.x[s.nodeId],mesh.z[node]-mesh.z[s.nodeId])>=spacing);
 function search(node){
  const costs=new Map([[node,0]]),previous=new Map(),heap=new Heap();heap.push(node,0);
  while(heap.a.length){const {id,key}=heap.pop();if(key!==costs.get(id))continue;
   for(let k=mesh.offsets[id];k<mesh.offsets[id+1];k++){const j=mesh.neighbors[k];if(!dry(j))continue;const d=key+edgeCost(id,j,mesh.distances[k]);if(d>maxTravel||d>=(costs.get(j)??Infinity))continue;costs.set(j,d);previous.set(j,id);heap.push(j,d);}
  }return {costs,previous};
 }
 let events=[],eventId=0;
 function event(g,type,ids,text,extra={}){events.push({id:eventId++,generation:g,year:g*yearsPerGeneration,type,siteIds:ids,routeId:null,text,...extra});}
 function found(node,groupId,g,population){
  const id=sites.length,reason=world.navigableRiver[node]?'A navigable river reach offered food and transport.':world.productivity[node]>.4?'Productive, accessible countryside supported the founding households.':'Households settled workable land within reach of their neighbors.';
  const stem=PREFIX[(Math.floor(rng()*PREFIX.length)+id)%PREFIX.length]+SUFFIX[Math.floor(rng()*SUFFIX.length)],nameCount=(nameCounts.get(stem)||0)+1;
  nameCounts.set(stem,nameCount);const name=stem+(nameCount>1?` ${nameCount}`:'');
  sites.push({id,nodeId:node,name,groupId,founded:g,reason});siteAt[node]=id;searches.push(search(node));states.push({siteId:id,population,peakPopulation:population,status:'village',groupId,farmAreaKm2:0,foodRatio:1});
  event(g,'founding',[id],`${name} was founded. ${reason}`);return id;
 }
 const candidates=[];for(let i=0;i<N;i++)if(viable(i))candidates.push({node:i,key:-Math.log(Math.max(1e-9,rng()))/(.15+world.productivity[i])});
 candidates.sort((a,b)=>a.key-b.key||a.node-b.node);
 const origins=Math.min(8,Math.max(1,Math.round(Math.sqrt(candidates.length)/32))),anchors=[];
 for(const c of candidates){if(groups.length>=origins)break;if(anchors.some(a=>Math.hypot(mesh.x[c.node]-mesh.x[a],mesh.z[c.node]-mesh.z[a])<world.parentDomain.sizeKm/7))continue;
  const groupId=groups.length;groups.push({id:groupId,name:`${PREFIX[Math.floor(rng()*PREFIX.length)]} kinship`,color:COLORS[groupId]});anchors.push(c.node);
  const initial=node=>Math.max(90,Math.round(mesh.nodeArea[node]*85*world.productivity[node]*.12));
  const origin=found(c.node,groupId,0,initial(c.node));
  const near=[...searches[origin].costs].filter(([node,d])=>d>spacing&&d<170&&viable(node)).map(([node,d])=>({node,key:hash(node,seed+groupId)*(.3+world.productivity[node])/(1+d/100)})).sort((a,b)=>b.key-a.key);
  let count=0;for(const x of near)if(apart(x.node)){found(x.node,groupId,0,initial(x.node));if(++count===3)break;}
 }
 let woodland=new Float32Array(N),soil=new Float32Array(N).fill(1),cultivation=new Float32Array(N),settled=new Float32Array(N),influence=new Int16Array(N).fill(-1);
 const potentialWood=new Float32Array(N);
 for(let i=0;i<N;i++)potentialWood[i]=woodland[i]=dry(i)?(BIOME_WOODLAND[world.biome[i]]??0):0;
 function establishRoute(a,b,g){
  if(a>b)[a,b]=[b,a];
  if(routes.some(r=>r.a===a&&r.b===b))return;
  const searchResult=searches[a];if(!searchResult.costs.has(sites[b].nodeId))return;
  const nodes=[sites[b].nodeId];while(nodes.at(-1)!==sites[a].nodeId)nodes.push(searchResult.previous.get(nodes.at(-1)));nodes.reverse();
  const id=routes.length;
  routes.push({id,a,b,nodes,kind:nodes.slice(1).some((node,k)=>riverEdge(nodes[k],node))?'river':'land',founded:g});
  routeStates.push({routeId:id,traffic:0,active:true,lastUsed:g});
  event(g,'connection',[a,b],`${sites[a].name} and ${sites[b].name} established a ${routes[id].kind==='river'?'river-linked':'land'} route.`,{routeId:id});
 }
 function connect(g){
  const degree=new Uint16Array(sites.length);for(const r of routes){degree[r.a]++;degree[r.b]++;}
  const pairs=[];for(let a=0;a<sites.length;a++){if(!states[a].population)continue;for(let b=a+1;b<sites.length;b++){if(!states[b].population||routes.some(r=>r.a===a&&r.b===b))continue;const cost=searches[a].costs.get(sites[b].nodeId);if(cost!==undefined)pairs.push({a,b,cost});}}
  pairs.sort((a,b)=>a.cost-b.cost||a.a-b.a||a.b-b.b);
  for(const {a,b} of pairs){if(degree[a]>=3||degree[b]>=3)continue;establishRoute(a,b,g);degree[a]++;degree[b]++;}
 }
 function ledger(){return {populationBefore:states.reduce((v,s)=>v+s.population,0),populationAfter:0,births:0,deaths:0,migrated:0,foodProduced:0,foodConsumed:0,transportLoss:0,cultivatedKm2:0};}
 // Every cell goes to the nearest occupied place by actual travel cost. Equal
 // costs resolve by stable ID; no site can harvest its neighbor's allocation.
 function allocate(){
  const owner=new Int32Array(N).fill(-1),distance=new Float32Array(N).fill(Infinity),areas=states.map(()=>[]);
  for(const s of states)if(s.population)for(const [node,d] of searches[s.siteId].costs)if(d<=farmTravel&&viable(node)&&(d<distance[node]||(d===distance[node]&&s.siteId<owner[node]))){distance[node]=d;owner[node]=s.siteId;}
  for(let i=0;i<N;i++)if(owner[i]>=0)areas[owner[i]].push(i);
  return {owner,areas};
 }
 function harvest(time,dt,accounting,initial=false){
  const {owner,areas}=allocate(),supply=new Float64Array(states.length),capacity=new Float64Array(states.length);cultivation.fill(0);settled.fill(0);influence.fill(-1);
  for(const s of states){s.farmAreaKm2=0;if(!s.population)continue;
   for(const node of areas[s.siteId])capacity[s.siteId]+=mesh.nodeArea[node]*world.productivity[node]*soil[node]*85*.62;
   const fraction=clamp(s.population*1.15/Math.max(1,capacity[s.siteId]))*.62;
   for(const node of areas[s.siteId]){
    cultivation[node]=fraction;s.farmAreaKm2+=cultivation[node]*mesh.nodeArea[node];
    // Fields immediately displace woodland, including founding and the final
    // allocation refresh. Both covers share this cell rather than overlap.
    woodland[node]=Math.min(woodland[node],1-cultivation[node]);
    // Local multi-decade harvest variability; no prescribed global collapse.
    const harvestFactor=.97+.27*Math.sin(time/19+hash(node,seed)*2.5+sites[s.siteId].groupId*1.9);
    supply[s.siteId]+=cultivation[node]*mesh.nodeArea[node]*world.productivity[node]*soil[node]*85*harvestFactor;
    settled[node]=clamp(fraction/.62*.5+(node===sites[s.siteId].nodeId?.4:0));influence[node]=s.groupId;
   }
  }
  accounting.foodProduced+=supply.reduce((v,x)=>v+x,0);
  // Surplus trade is a transfer, with 12% lost to carriage; recipient need and
  // donor surplus cap every transfer. Roads do not manufacture food.
  for(const r of routes){const a=states[r.a],b=states[r.b],rs=routeStates[r.id];if(!a.population||!b.population||(blockedUntil[r.id]??-1)>=Math.ceil(time/yearsPerGeneration)){rs.active=false;rs.traffic=0;continue;}
   let donor=r.a,recipient=r.b;if(supply[donor]-a.population<supply[recipient]-b.population)[donor,recipient]=[recipient,donor];
   const amount=Math.min(Math.max(0,supply[donor]-states[donor].population),Math.max(0,states[recipient].population-supply[recipient])/.88,Math.min(a.population,b.population)*.16);
   if(!initial)generationTrade[r.id]=(generationTrade[r.id]||0)+amount*.88;
   supply[donor]-=amount;supply[recipient]+=amount*.88;accounting.transportLoss+=amount*.12;
   rs.traffic=(a.population+b.population)*.018+amount;rs.active=true;rs.lastUsed=Math.ceil(time/yearsPerGeneration);
  }
  for(const s of states){s.foodRatio=s.population?supply[s.siteId]/s.population:0;accounting.foodConsumed+=Math.min(s.population,supply[s.siteId]);}
  if(!initial)for(let node=0;node<N;node++)if(dry(node)){
   // Fallow soil regenerates, intensive fields lose fertility slowly, and forest
   // succession only approaches the original biome's woodland potential.
   const c=cultivation[node];soil[node]=clamp(soil[node]+dt*(.006*(1-c/.62)-.011*c/.62),.28,1);
   woodland[node]=clamp(woodland[node]+dt*(.014*(potentialWood[node]*(1-c)-woodland[node])-.035*c*woodland[node]),0,1-c);
  }
  return capacity;
 }
 function snapshot(g,accounting){
  let population=0,settlements=0,abandoned=0,cultivatedKm2=0;
  for(const s of states){s.peakPopulation=Math.max(s.peakPopulation,s.population);s.status=!s.population?'abandoned':s.population>=12000?'city':s.population>=2500?'town':'village';population+=s.population;if(s.population)settlements++;else abandoned++;cultivatedKm2+=s.farmAreaKm2;}
  accounting.populationAfter=population;accounting.cultivatedKm2=cultivatedKm2;
  snapshots.push({generation:g,year:g*yearsPerGeneration,siteStates:states.map(s=>({...s})),routeStates:routeStates.map(s=>({...s})),cultivation:cultivation.slice(),woodland:woodland.slice(),soil:soil.slice(),influence:influence.slice(),settled:settled.slice(),events,summary:{population,settlements,abandoned,routeCount:routeStates.filter(s=>s.active).length,cultivatedKm2},accounting:{...accounting}});events=[];
 }
 connect(0);const first=ledger();harvest(0,0,first,true);snapshot(0,first);progress({generation:0,generations});await pause();
 for(let g=1;g<=generations;g++){
  if(cancelled())return null;generationTrade.fill(0);const accounting=ledger(),steps=Math.ceil(yearsPerGeneration/5),dt=yearsPerGeneration/steps;
  for(let step=0;step<steps;step++){
   const time=(g-1)*yearsPerGeneration+(step+1)*dt,capacity=harvest(time,dt,accounting);
   const oldPopulation=states.map(s=>s.population);
   for(const s of states)if(s.population){const births=Math.floor(s.population*.023*dt*clamp(s.foodRatio)),deaths=Math.min(s.population+births,Math.ceil(s.population*dt*(.010+.065*Math.max(0,1-s.foodRatio))));s.population+=births-deaths;accounting.births+=births;accounting.deaths+=deaths;}
   // Proposals use the shared pre-migration state, then commit once. Incoming
   // households cannot be forwarded again during this same small update.
   const delta=new Int32Array(states.length),incoming=new Float64Array(states.length);
   for(const s of states)if(oldPopulation[s.siteId]>0&&s.foodRatio<.98){
    const neighbors=states.filter(t=>t.siteId!==s.siteId&&t.population>0&&searches[s.siteId].costs.has(sites[t.siteId].nodeId)&&(t.foodRatio>s.foodRatio+.12||(s.population<100&&t.population>s.population&&t.foodRatio>=s.foodRatio-.02))&&capacity[t.siteId]>t.population+incoming[t.siteId]).sort((a,b)=>b.foodRatio-a.foodRatio||a.siteId-b.siteId);
    const target=neighbors[0];if(!target)continue;
    const spare=Math.max(0,Math.floor(capacity[target.siteId]-target.population-incoming[target.siteId])),amount=Math.min(s.population,spare,s.population<100?s.population:Math.max(1,Math.floor(s.population*.14*dt/5)));
    if(!amount)continue;delta[s.siteId]-=amount;delta[target.siteId]+=amount;incoming[target.siteId]+=amount;accounting.migrated+=amount;
    event(g,'migration',[s.siteId,target.siteId],`${amount} people moved from ${sites[s.siteId].name} to ${sites[target.siteId].name} in search of more reliable food.`,{amount});
   }
   for(const s of states){s.population+=delta[s.siteId];if(oldPopulation[s.siteId]>0&&!s.population){abandonedAt[s.siteId]=g;event(g,'abandonment',[s.siteId],`${sites[s.siteId].name} was left empty after food pressure and departure.`);}}
   if(step===steps-1){
    let founded=0;
    for(const source of [...states]){if(source.population<180||founded>=8||sites.length>=240)continue;
     const pressure=source.population/Math.max(1,capacity[source.siteId]);if(pressure<.42&&rng()>.28)continue;
     const candidates=[...searches[source.siteId].costs].filter(([node,d])=>d>spacing&&d<maxTravel&&viable(node)&&(siteAt[node]<0?apart(node):states[siteAt[node]].population===0&&abandonedAt[siteAt[node]]<g)).map(([node,d])=>({node,score:world.productivity[node]*soil[node]*(.8+.4*hash(node,seed+g))*(siteAt[node]>=0?1.15:1)/(1+d/180)})).sort((a,b)=>b.score-a.score||a.node-b.node);
     const candidate=candidates[0];if(!candidate)continue;const amount=Math.min(Math.floor(source.population*.18),Math.max(60,Math.floor(mesh.nodeArea[candidate.node]*world.productivity[candidate.node]*15)));if(amount<45)continue;
     source.population-=amount;accounting.migrated+=amount;let target=siteAt[candidate.node];
     if(target>=0){states[target].population=amount;states[target].groupId=source.groupId;event(g,'reoccupation',[target,source.siteId],`Households from ${sites[source.siteId].name} returned to ${sites[target].name}, reusing its old fields.`);}
     else target=found(candidate.node,source.groupId,g,amount);
     establishRoute(source.siteId,target,g);
     event(g,'migration',[source.siteId,target],`${amount} people from ${sites[source.siteId].name} established a new home at ${sites[target].name}.`,{amount});founded++;
    }
   }
  }
  connect(g);
  // Reallocate after departures/founding so frame land and place totals describe
  // the same instant. This display-only harvest is excluded from the food ledger.
  harvest(g*yearsPerGeneration,0,ledger(),true);
  for(const r of routes){
   // Report only transfers recorded during real updates, even if this route
   // became vacant or disputed later. Display refreshes cannot add trade events.
   if(generationTrade[r.id]>0)event(g,'cooperation',[r.a,r.b],`${sites[r.a].name} and ${sites[r.b].name} shared a limited food surplus along their route.`,{routeId:r.id,amount:generationTrade[r.id]});
   const a=states[r.a],b=states[r.b];if(!a.population||!b.population||!routeStates[r.id].active)continue;
   if(a.foodRatio<.95&&b.foodRatio<.95&&a.groupId!==b.groupId&&hash(r.id,seed+g)<.20){blockedUntil[r.id]=g+1;routeStates[r.id].active=false;routeStates[r.id].traffic=0;event(g,'conflict',[r.a,r.b],`Food pressure led neighbors at ${sites[r.a].name} and ${sites[r.b].name} to suspend trade along their disputed route for a generation.`,{routeId:r.id});}
  }
  for(const s of states){const previous=snapshots.at(-1).siteStates[s.siteId];if(previous?.population>0&&s.population>0){if(s.population<previous.population*.8)event(g,'decline',[s.siteId],`${sites[s.siteId].name} declined as food pressure and departures reduced its population.`);else if(s.population>previous.population*1.25)event(g,'growth',[s.siteId],`${sites[s.siteId].name} grew as food and access supported more households.`);}}
  snapshot(g,accounting);progress({generation:g,generations});await pause();
 }
 if(cancelled())return null;
 return {version:HUMAN_HISTORY_VERSION,seed,generations,yearsPerGeneration,groups,sites,routes,snapshots};
}
