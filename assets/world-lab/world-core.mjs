/** Regional World Lab v2 — synthetic regional context, not a forecast.
 * All physical fields share one irregular triangular mesh. Flow is routed
 * on its actual downhill links, NOT on a D8 raster with decorative splines.
 * Horizontal units km; height m; contributing area km²; mesh IDs are NOT pixels.
 */
import {createTerrainMesh} from './world-mesh.mjs';
export const VERSION='regional-world-v2';
export const BIOMES=[['Ocean','#244859'],['Lake','#397b92'],['Wetland','#547e68'],['Wet forest','#285c49'],['Temperate forest','#49784f'],['Open woodland','#7d925e'],['Grassland','#a8af70'],['Dry steppe','#b4a177'],['Arid scrub','#ccb491'],['Mountain forest','#4d6860'],['Alpine tundra','#92988c'],['Snow / ice','#e5e8df']];
export const HISTORIES=[
  {id:'mixed',name:'Regional mosaic',description:'Weathered lowlands, glacial valleys, a rift basin and an old volcanic field in different parts of the region.'},
  {id:'glacial',name:'Glacial highlands',description:'Scoured troughs and overdeepened basins with sills: elongated valley lakes rather than random mountain bowls.'},
  {id:'rift',name:'Rift country',description:'A long subsiding basin between raised shoulders, with a dominant elongated lake system.'},
  {id:'volcanic',name:'Volcanic plateau',description:'Raised plateau, volcanic edifices and broad caldera depressions. Only regional-scale features are resolved.'},
  {id:'weathered',name:'Old river country',description:'Softer old uplands, a broad descending valley and shallow lowland depressions.'}
];
export const HISTORY_TYPES=[['Weathered land','#a7aa86'],['Glacial trough','#a5ccd4'],['Rift basin','#b79586'],['Volcanic terrain','#a69baa'],['River lowland','#91b77e']];
export const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const mix=(a,b,t)=>a+(b-a)*t,ease=t=>{t=clamp(t,0,1);return t*t*(3-2*t);};
export function random32(seed){let s=seed>>>0;return()=>{s=(s+0x6D2B79F5)>>>0;let t=s;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}
function hash(x,z,s){let k=Math.imul(x^s,374761393)+Math.imul(z^(s>>>7),668265263);k=Math.imul(k^(k>>>13),1274126177);return((k^(k>>>16))>>>0)/4294967295;}
export function noise(x,z,s){const ix=Math.floor(x),iz=Math.floor(z),a=ease(x-ix),b=ease(z-iz);return mix(mix(hash(ix,iz,s),hash(ix+1,iz,s),a),mix(hash(ix,iz+1,s),hash(ix+1,iz+1,s),a),b)*2-1;}
function fbm(x,z,s,octaves=5){let v=0,a=.55,sum=0;for(let k=0;k<octaves;k++){v+=a*noise(x,z,s+k*9173);sum+=a;x=x*2.03+11.3;z=z*2.03-4.7;a*=.49;}return v/sum;}
export function normalizeConfig(input={}){
  // Rendering preferences are deliberately excluded from model configuration.
  const c={seed:431970387,n:193,sizeKm:1200,relief:1,rain:1,wind:'west',history:'mixed'};
  for(const k of Object.keys(c))if(input[k]!==undefined)c[k]=input[k];
  if(!Number.isFinite(Number(c.seed)))throw new TypeError('Seed must be a number');c.seed=Number(c.seed)>>>0;
  if(!Number.isInteger(c.n)||c.n<17||c.n>321)throw new RangeError('Mesh must be 17–321 samples per side');
  for(const [k,a,b] of [['sizeKm',400,3000],['relief',.5,1.6],['rain',.4,1.8]])if(!Number.isFinite(c[k])||c[k]<a||c[k]>b)throw new RangeError(`Invalid ${k}`);
  if(!['west','east'].includes(c.wind))throw new RangeError('Wind must be west or east');
  if(!HISTORIES.some(h=>h.id===c.history))throw new RangeError('Unknown landscape history');return c;
}
function eachNeighbor(mesh,i,fn){for(let k=mesh.offsets[i];k<mesh.offsets[i+1];k++)fn(mesh.neighbors[k],mesh.distances[k]);}

/** These are geological-form recipes, not tectonics/glacial physics over time.
 * Features change actual elevation BEFORE the spill/drainage calculation.
 */
export function createHeightSampler(input={}){
  const config=normalizeConfig(input),{seed,relief,history,sizeKm}=config,rnd=random32(seed),phase=rnd()*6.28,phase2=rnd()*6.28;
  const north=.12+rnd()*.055,east=.77+rnd()*.09,features=[];
  const glacierCount=history==='glacial'?6:history==='mixed'?3:0;
  for(let k=0;k<glacierCount;k++)features.push({type:1,label:'Glacial valley',x:(.23+k*.078+(rnd()-.5)*.025)*sizeKm,z:(north-.045+rnd()*.025)*sizeKm,
    angle:Math.PI/2+(rnd()-.5)*.6,lengthKm:(.23+rnd()*.07)*sizeKm,widthKm:(.010+rnd()*.005)*sizeKm,depthM:320+rnd()*250});
  if(history==='rift'||history==='mixed')features.push({type:2,label:'Rift basin',x:(history==='rift'?.60:.72)*sizeKm,z:.47*sizeKm,angle:1.38+(rnd()-.5)*.35,
    lengthKm:(history==='rift'?.38:.24)*sizeKm,widthKm:(history==='rift'?.036:.026)*sizeKm,depthM:history==='rift'?650:440});
  const volcanoCount=history==='volcanic'?4:history==='mixed'?1:0;
  for(let k=0;k<volcanoCount;k++)features.push({type:3,label:'Volcanic caldera',x:(.35+k*.085+(rnd()-.5)*.025)*sizeKm,z:(.47+(k%2)*.10)*sizeKm,angle:0,
    lengthKm:0,widthKm:(.028+rnd()*.009)*sizeKm,depthM:850+rnd()*250});
  // A regional through-valley gives old country a trunk drainage corridor.
  if(history==='weathered'||history==='mixed')features.push({type:4,label:'Old river valley',x:.43*sizeKm,z:.52*sizeKm,angle:Math.PI/2,lengthKm:.64*sizeKm,widthKm:.045*sizeKm,depthM:120});
  function sample(x,z){
    const u=x/sizeKm,v=z/sizeKm,wx=u+.025*fbm(u*4,v*4,seed+92),wz=v+.025*fbm(u*4,v*4,seed+183);
    const coast=.09+.045*Math.sin(v*8+phase)+.045*fbm(u*5,v*6,seed+100),south=.87+.045*Math.sin(u*7+phase2)+.035*fbm(u*5,v*5,seed+888);
    const landDistance=Math.min(u-coast,south-v),landBlend=ease((landDistance+.04)/.13);
    const continental=140+650*(1-v)+110*u+170*fbm(wx*2.6,wz*2.6,seed+11);
    const nAxis=north+.045*Math.sin(wx*9+phase)+.02*noise(wx*6,0,seed+12),eAxis=east+.055*Math.sin(wz*7+phase2);
    const nBand=Math.exp(-(((wz-nAxis)/.085)**2)),eBand=Math.exp(-(((wx-eAxis)/.083)**2));
    const ridges=(1-Math.abs(fbm(wx*11,wz*11,seed+222,4)))**2;
    const highlands=Math.max(nBand,eBand)*(1800+1250*ridges)+Math.min(nBand,eBand)*280;
    const diagonal=Math.exp(-(((wx-.37-wz*.25)/.078)**2))*Math.exp(-(((wz-.47)/.33)**2));
    const oldRange=diagonal*(180+450*(1-Math.abs(fbm(wx*9,wz*9,seed+434)))**2);
    const basin=-110*Math.exp(-(((wx-.53)/.20)**2)-((wz-.60)/.23)**2);
    const detail=(history==='weathered'?25:50)*fbm(wx*16,wz*16,seed+32,3)*(1+highlands/2200);
    let land=continental+highlands*(history==='weathered'?.62:1)+oldRange+basin+detail,landHistory=0,feature=-1,strongest=.12;
    if(history==='volcanic')land+=650*Math.exp(-(((u-.53)/.28)**4)-((v-.54)/.24)**4);
    for(let k=0;k<features.length;k++){
      const f=features[k],dx=x-f.x,dz=z-f.z,along=dx*Math.cos(f.angle)+dz*Math.sin(f.angle),across=-dx*Math.sin(f.angle)+dz*Math.cos(f.angle);let influence=0;
      if(f.type===1){
        const t=along/f.lengthKm,bend=3*Math.sin(t*5+phase),d=(across-bend)/f.widthKm;
        influence=Math.exp(-(d**4))*ease(t/.10)*ease((1-t)/.12);
        // A downhill trough, with overdeepening toward the foot and a moraine
        // sill. Basins hold water only if the hydrology finds a real spill rim.
        const floor=1550-1250*t-f.depthM*Math.exp(-(((t-.66)/.18)**2))+110*Math.exp(-(((t-.87)/.06)**2));
        land=mix(land,Math.min(land,floor),influence);
      }else if(f.type===2){
        const t=along/(f.lengthKm/2),d=across/f.widthKm;
        influence=Math.exp(-(d**4))*ease((1-Math.abs(t))/.22);
        const target=180-f.depthM*(1-t*t)+80*noise(t*3,0,seed+656);
        land+=500*Math.exp(-(((Math.abs(d)-1.5)/.45)**2))*ease((1-Math.abs(t))/.22);
        land=mix(land,Math.min(land,target),influence);
      }else if(f.type===3){
        const r=Math.hypot(dx,dz)/f.widthKm;
        influence=Math.exp(-((r/1.8)**4));
        land+=f.depthM*1.4*Math.exp(-r*r)-f.depthM*1.65*Math.exp(-((r/.49)**4));
      }else if(f.type===4){
        const center=.43+.035*Math.sin(v*10+phase),d=(u-center)/.045;
        influence=Math.exp(-(d**4))*ease((v-.22)/.10)*ease((.93-v)/.10);
        const floor=Math.max(8,490*(.90-v)) -22*Math.exp(-(((v-.69)/.024)**2));
        land=mix(land,Math.min(land,floor+15*noise(v*8,0,seed+818)),influence*.97);
      }
      if(influence>strongest){strongest=influence;landHistory=f.type;feature=k;}
    }
    const seabed=-120-2000*clamp(-landDistance*6,0,1)+100*fbm(u*6,v*6,seed+54);
    return{height:mix(seabed,land*relief,landBlend),landHistory:landBlend>.85?landHistory:0,feature:landBlend>.85?feature:-1};
  }
  return{sample,features,config};
}
export function generateTerrain(input={}){
  const config=normalizeConfig(input),{n,seed,sizeKm}=config,mesh=createTerrainMesh(n,sizeKm,seed),N=mesh.x.length;
  const {sample,features}=createHeightSampler(config),height=new Float32Array(N),landHistory=new Uint8Array(N),featureAt=new Int16Array(N).fill(-1);
  for(let i=0;i<N;i++){const h=sample(mesh.x[i],mesh.z[i]);height[i]=h.height;landHistory[i]=h.landHistory;featureAt[i]=h.feature;}
  const ocean=new Uint8Array(N),queue=new Int32Array(N);let head=0,tail=0;
  for(let i=0;i<N;i++)if(mesh.boundary[i]&&height[i]<=0){ocean[i]=1;queue[tail++]=i;}
  while(head<tail){const i=queue[head++];eachNeighbor(mesh,i,j=>{if(!ocean[j]&&height[j]<=0){ocean[j]=1;queue[tail++]=j;}});}
  const erosion=openOldDrainage({mesh,height,ocean,landHistory,config});
  const slope=new Float32Array(N);
  for(let i=0;i<N;i++)eachNeighbor(mesh,i,(j,d)=>{slope[i]=Math.max(slope[i],Math.abs(height[i]-height[j])/(d*1000));});
  return{version:VERSION,config,n,stepKm:mesh.stepKm,mesh,height,ocean,slope,landHistory,featureAt,features,erosion,stage:1};
}
/** Limited inherited fluvial breaching: unmarked noise depressions can erode
 * an outlet rather than all becoming lakes. Deliberate glacial/rift/caldera
 * basins remain. This is a landscape recipe, not a geological-time solver.
 */
function openOldDrainage(terrain){
  const {mesh,height:h,landHistory,config,ocean}=terrain;let breachedBasins=0,maxCutM=0;
  for(let pass=0;pass<2;pass++){
    const hydro=generateHydrology(terrain),deepest=new Int32Array(hydro.lakeBodies.length).fill(-1);
    for(let i=0;i<h.length;i++){const id=hydro.lakeId[i];if(id>=0&&(deepest[id]<0||h[i]<h[deepest[id]]))deepest[id]=i;}
    for(const id of deepest){
      if(id<0||h[id]<25||(landHistory[id]>=1&&landHistory[id]<=3)||hydro.filled[id]-h[id]>400)continue;
      const path=drainageTrace(hydro,id);let distance=0;const floor=h[id];let cuts=0;
      for(let k=1;k<path.length;k++){
        const a=path[k-1],i=path[k];distance+=Math.hypot(mesh.x[i]-mesh.x[a],mesh.z[i]-mesh.z[a]);
        const target=floor-.01*distance;if(ocean[i]||h[i]<target)break;
        const cut=h[i]-target;if(cut<=0)continue;maxCutM=Math.max(maxCutM,cut);h[i]=target;cuts++;
        // Blend valley sides a little instead of producing a single-node slot.
        eachNeighbor(mesh,i,j=>{if(ocean[j]||landHistory[j]===2||landHistory[j]===3)return;h[j]-=Math.max(0,Math.min(h[j]-target,cut))*.15;});
      }
      if(cuts)breachedBasins++;
    }
  }
  return{breachedBasins,maxCutM};
}
class Heap{
  constructor(values){this.a=[];this.v=values;}
  less(a,b){return a.key<b.key||a.key===b.key&&a.id<b.id;}
  push(id){const a=this.a,item={id,key:this.v[id]};let i=a.length;a.push(item);while(i>0){const p=(i-1)>>1;if(!this.less(item,a[p]))break;a[i]=a[p];i=p;}a[i]=item;}
  pop(){const a=this.a,out=a[0],last=a.pop();if(a.length){let i=0;while(i*2+1<a.length){let c=i*2+1;if(c+1<a.length&&this.less(a[c+1],a[c]))c++;if(!this.less(a[c],last))break;a[i]=a[c];i=c;}a[i]=last;}return out.id;}
  get length(){return this.a.length;}
}
export function generateHydrology(terrain){
  const {mesh,height:h,ocean,config}=terrain;if(!mesh)throw new TypeError('Hydrology requires physical mesh coordinates');
  const N=h.length,filled=new Float64Array(N),seen=new Uint8Array(N),rank=new Int32Array(N),order=new Int32Array(N),parent=new Int32Array(N).fill(-1),heap=new Heap(filled);
  for(let i=0;i<N;i++)if(ocean[i]||mesh.boundary[i]){filled[i]=ocean[i]?0:h[i];seen[i]=1;heap.push(i);}
  let count=0;
  while(heap.length){const i=heap.pop();rank[i]=count;order[count++]=i;eachNeighbor(mesh,i,j=>{
    if(seen[j])return;seen[j]=1;filled[j]=Math.max(h[j],filled[i]);parent[j]=i;heap.push(j);
  });}
  if(count!==N)throw new Error('Incomplete drainage coverage');
  const receiver=new Int32Array(N).fill(-1),area=new Float64Array(N),basin=new Int32Array(N).fill(-1),lake=new Uint8Array(N),flowAngle=new Float32Array(N).fill(NaN);
  for(let i=0;i<N;i++){
    if(ocean[i])continue;area[i]=mesh.nodeArea[i];lake[i]=filled[i]-h[i]>.5?1:0;
    let best=-1,bestSlope=0;
    eachNeighbor(mesh,i,(j,d)=>{if(rank[j]>=rank[i])return;const slope=(filled[i]-filled[j])/d;if(slope>bestSlope+1e-9){bestSlope=slope;best=j;}});
    if(best<0){if(parent[i]>=0)best=parent[i];else eachNeighbor(mesh,i,j=>{if(filled[j]<=filled[i]&&rank[j]<rank[i]&&(best<0||rank[j]<rank[best]))best=j;});}
    receiver[i]=best;
    if(best>=0)flowAngle[i]=Math.atan2(mesh.z[best]-mesh.z[i],mesh.x[best]-mesh.x[i]);
  }
  for(let k=N-1;k>=0;k--){const i=order[k],r=receiver[i];if(r>=0&&!ocean[r])area[r]+=area[i];}
  const outlets=[];
  for(let k=0;k<N;k++){
    const i=order[k];if(ocean[i])continue;const r=receiver[i];basin[i]=r<0||ocean[r]?i:basin[r];
    if(r<0||ocean[r])outlets.push({id:i,areaKm2:area[i],kind:r>=0?'sea':'edge',xKm:mesh.x[i],zKm:mesh.z[i]});
  }
  outlets.sort((a,b)=>b.areaKm2-a.areaKm2);
  const names=['Alder','Morrow','Kestrel','Bracken','Rook','Sable','Vale','Elowen','Tarn','Rowan','Lark','Cairn'],shift=config.seed%names.length;
  outlets.forEach((o,i)=>{o.name=i<12?`${names[(i+shift)%names.length]} basin`:`Coastal catchment ${i+1}`;});
  const threshold=Math.max(500,config.sizeKm**2*.00055),river=new Uint8Array(N),confluences=[],donors=new Uint8Array(N);
  for(let i=0;i<N;i++)if(!ocean[i]&&area[i]>=threshold&&receiver[i]>=0)river[i]=1;
  for(let i=0;i<N;i++){const r=receiver[i];if(river[i]&&r>=0&&!ocean[r])donors[r]++;}
  for(let i=0;i<N;i++)if(donors[i]>=2&&!lake[i])confluences.push(i);
  const lakeId=new Int32Array(N).fill(-1),lakeBodies=[],queue=new Int32Array(N);
  for(let start=0;start<N;start++)if(lake[start]&&lakeId[start]<0){
    const id=lakeBodies.length;let head=0,tail=0,areaKm2=0,maxDepth=0;const historyArea=new Float64Array(HISTORY_TYPES.length);queue[tail++]=start;lakeId[start]=id;
    while(head<tail){const i=queue[head++];areaKm2+=mesh.nodeArea[i];maxDepth=Math.max(maxDepth,filled[i]-h[i]);historyArea[terrain.landHistory?.[i]||0]+=mesh.nodeArea[i];
      eachNeighbor(mesh,i,j=>{if(lake[j]&&lakeId[j]<0&&Math.abs(filled[j]-filled[i])<.01){lakeId[j]=id;queue[tail++]=j;}});
    }
    const dominant=historyArea.indexOf(Math.max(...historyArea));
    lakeBodies.push({id,seedNode:start,areaKm2,maxDepth,level:filled[start],nodes:tail,history:dominant});
  }
  // Keep ID order; indices remain stable for export / lookup. Sort a copy in UI.
  return{...terrain,filled,receiver,flowAngle,rank,order,area,basin,lake,lakeId,outlets,river,confluences,lakeBodies,riverThresholdKm2:threshold,routing:'irregular-mesh-steepest',stage:2};
}

/** Graph-distance wetness uses the NEW physical river network. No D8 mask. */
export function wetDistances(world,maxKm=30){
  const {mesh,ocean,lake,river}=world,N=ocean.length,distance=new Float64Array(N).fill(Infinity),heap=new Heap(distance),done=new Uint8Array(N);
  // Heap permits stale duplicate entries: once popped at the smallest value,
  // a node is finalized. Only decreasing distances are inserted.
  for(let i=0;i<N;i++)if(ocean[i]||lake[i]||river[i]){distance[i]=0;heap.push(i);}
  while(heap.length){const i=heap.pop();if(done[i])continue;done[i]=1;if(distance[i]>maxKm)continue;
    eachNeighbor(mesh,i,(j,d)=>{const v=distance[i]+d;if(!done[j]&&v<distance[j]&&v<=maxKm){distance[j]=v;heap.push(j);}});
  }
  return distance;
}
export function generateEcology(world){
  if(world.stage<2)throw new Error('Hydrology required before ecology');
  const {n,mesh,height:h,ocean,lake,slope,receiver,order,config}=world,N=h.length,rainfall=new Float32Array(N),temperature=new Float32Array(N),biome=new Uint8Array(N),runoff=new Float64Array(N);
  // Mesh sites remain stratified by row, enabling a simple east/west moisture
  // sweep. Coordinates and wind distance are physical, not pixel offsets.
  for(let row=0;row<n;row++){
    let humidity=1,lastHeight=0,lastX=config.wind==='west'?0:config.sizeKm;
    const ids=Array.from({length:n},(_,c)=>row*n+c).sort((a,b)=>config.wind==='west'?mesh.x[a]-mesh.x[b]:mesh.x[b]-mesh.x[a]);
    for(const i of ids){
      const u=mesh.x[i]/config.sizeKm,v=mesh.z[i]/config.sizeKm,e=Math.max(0,h[i]),rise=Math.max(0,(e-lastHeight)/1000),fall=Math.max(0,(lastHeight-e)/1000),travel=Math.abs(mesh.x[i]-lastX)/config.sizeKm;
      if(ocean[i])humidity=1;else humidity=clamp(humidity*Math.exp(-rise*.75-fall*.25-1.1*travel)+(lake[i]?.025:.13*travel),.04,1);
      const coastal=80+80*(1-v),texture=1+.18*fbm(u*4,v*4,config.seed+907);
      rainfall[i]=clamp((coastal+humidity*1250+humidity*rise*2700)*texture*config.rain,70,3600);
      temperature[i]=7+v*12-e*.0058+noise(u*3,v*3,config.seed+399)*1.4;
      lastHeight=e;lastX=mesh.x[i];
    }
  }
  const wetDistanceKm=wetDistances(world,world.stepKm*3),counts=new Float64Array(BIOMES.length);
  for(let i=0;i<N;i++){
    const rain=rainfall[i],temp=temperature[i],e=h[i];let b;
    if(ocean[i])b=0;else if(lake[i])b=1;else if(temp<-5||e>3700&&temp<1)b=11;else if(temp<1.5||e>2900)b=10;
    else if(wetDistanceKm[i]<=world.stepKm*1.3&&slope[i]<.006&&rain>800&&e<600)b=2;
    else if(e>1300&&rain>550)b=9;else if(rain>1350)b=3;else if(rain>980)b=4;else if(rain>720)b=5;else if(rain>490)b=6;else if(rain>300)b=7;else b=8;
    biome[i]=b;counts[b]+=mesh.nodeArea[i];
    if(!ocean[i]){const evap=clamp(.68+temp*.012,.38,.90);runoff[i]=rain*(1-evap)/1000*mesh.nodeArea[i]*1e6/(365.25*24*3600);}
  }
  for(let k=N-1;k>=0;k--){const i=order[k],r=receiver[i];if(r>=0&&!ocean[r])runoff[r]+=runoff[i];}
  return{...world,rainfall,temperature,biome,runoff,wetDistanceKm,biomeAreas:counts,stage:3};
}
export function generateWorld(config={}){return generateEcology(generateHydrology(generateTerrain(config)));}
export function drainageTrace(world,start){
  if(!world.receiver||!Number.isInteger(start)||start<0||start>=world.height.length)return[];
  const path=[];let i=start;while(i>=0&&path.length<=world.height.length){path.push(i);if(world.ocean[i])break;i=world.receiver[i];}
  if(path.length>world.height.length)throw new Error('Drainage cycle');return path;
}
export function summary(world){let land=0,wet=0,highest=-Infinity;for(let i=0;i<world.height.length;i++){highest=Math.max(highest,world.height[i]);if(!world.ocean[i])land+=world.mesh.nodeArea[i];if(world.lake?.[i])wet+=world.mesh.nodeArea[i];}
  return{landKm2:land,landPercent:land/world.config.sizeKm**2*100,peakM:highest,lakeKm2:wet,majorBasins:world.outlets?.filter(o=>o.areaKm2>=world.config.sizeKm**2*.01).length??0,confluences:world.confluences?.length??0};
}
/** v2 exports mesh IDs + coordinates; old row/column receiver IDs aren't valid. */
export function exportWorld(w){
  if(w.stage!==3)throw new Error('Complete environments before exporting');
  return{version:w.version,routing:w.routing,config:w.config,units:{horizontal:'km',elevation:'m',area:'km²',runoff:'synthetic m³/s'},layout:'Irregular triangular mesh; every field and receiver uses mesh node IDs, NOT raster pixels.',
    mesh:{x:w.mesh.x,z:w.mesh.z,triangles:w.mesh.triangles,nodeArea:w.mesh.nodeArea,boundary:w.mesh.boundary},height:w.height,waterSurface:w.filled,ocean:w.ocean,lake:w.lake,lakeId:w.lakeId,lakeBodies:w.lakeBodies,
    receiver:w.receiver,flowAngleRadians:w.flowAngle,basin:w.basin,upstreamArea:w.area,river:w.river,confluences:w.confluences,runoff:w.runoff,rainfall:w.rainfall,temperature:w.temperature,biome:w.biome,biomeLegend:BIOMES,
    landHistory:w.landHistory,historyLegend:HISTORY_TYPES,features:w.features,outlets:w.outlets};
}
