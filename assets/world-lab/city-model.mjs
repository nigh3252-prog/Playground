/** Neighborhood-scale urban content in parent kilometers. The urban grain is
 * generated; the ground and water come from the parent's actual triangles.
 * This does not claim to recover terrain below the parent mesh resolution. */
import {indexMesh,locateTriangle} from './world-mesh.mjs';
import {generateUrbanStructure} from './city-structure.mjs';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const indexes=new WeakMap();
const MAX_SLOPE=.22,MAX_GRID=129;
const COLORS={downtown:'#c2a886',mixed:'#c4b297',residential:'#c8c0a6',industrial:'#a6b6b7',park:'#8aac87'};
const hash=(n,seed)=>{let t=(n^seed)>>>0;t=Math.imul(t^t>>>16,0x45d9f3b);t=Math.imul(t^t>>>16,0x45d9f3b);return((t^t>>>16)>>>0)/4294967296;};
const polygonArea=p=>Math.abs(p.reduce((v,a,i)=>{const b=p[(i+1)%p.length];return v+a.x*b.z-b.x*a.z;},0))/2;
const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const bilerp=(p,u,v)=>({x:p[0].x*(1-u)*(1-v)+p[1].x*u*(1-v)+p[2].x*u*v+p[3].x*(1-u)*v,z:p[0].z*(1-u)*(1-v)+p[1].z*u*(1-v)+p[2].z*u*v+p[3].z*(1-u)*v});

class Heap{
 constructor(){this.a=[];}
 push(id,key){const v={id,key},a=this.a;let i=a.length;a.push(v);while(i){const p=(i-1)>>1;if(a[p].key<key||a[p].key===key&&a[p].id<=id)break;a[i]=a[p];i=p;}a[i]=v;}
 pop(){const a=this.a,out=a[0],v=a.pop();if(a.length){let i=0;while(i*2+1<a.length){let c=i*2+1;if(c+1<a.length&&(a[c+1].key<a[c].key||a[c+1].key===a[c].key&&a[c+1].id<a[c].id))c++;if(a[c].key>v.key||a[c].key===v.key&&a[c].id>=v.id)break;a[i]=a[c];i=c;}a[i]=v;}return out;}
}

function boxOf(p){let x=Infinity,z=Infinity,right=-Infinity,bottom=-Infinity;for(const v of p){x=Math.min(x,v.x);z=Math.min(z,v.z);right=Math.max(right,v.x);bottom=Math.max(bottom,v.z);}return{x,z,right,bottom};}
function overlaps(a,b){return a.x<=b.right&&a.right>=b.x&&a.z<=b.bottom&&a.bottom>=b.z;}
function interpolate(a,b,t){const p={};for(const k of Object.keys(a))p[k]=a[k]+(b[k]-a[k])*t;return p;}
function clip(poly,field,value,above=true){
 const out=[];for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],da=(a[field]-value)*(above?1:-1),db=(b[field]-value)*(above?1:-1),insideA=da>=0,insideB=db>=0;
  if(insideA)out.push(a);if(insideA!==insideB)out.push(interpolate(a,b,da/(da-db)));
 }return out;
}
function clipToBox(poly,bounds){for(const[f,v,above]of[['x',bounds.x,true],['x',bounds.x+bounds.size,false],['z',bounds.z,true],['z',bounds.z+bounds.size,false]]){poly=clip(poly,f,v,above);if(!poly.length)break;}return poly;}
function polygonOverlap(a,b){
 // Both polygons are convex: triangle clips and gently warped block quads.
 for(const p of[a,b])for(let i=0;i<p.length;i++){
  const q=p[(i+1)%p.length],dx=q.z-p[i].z,dz=p[i].x-q.x;
  let amin=Infinity,amax=-Infinity,bmin=Infinity,bmax=-Infinity;
  for(const v of a){const d=v.x*dx+v.z*dz;amin=Math.min(amin,d);amax=Math.max(amax,d);}
  for(const v of b){const d=v.x*dx+v.z*dz;bmin=Math.min(bmin,d);bmax=Math.max(bmax,d);}
  if(amax<bmin-1e-9||bmax<amin-1e-9)return false;
 }return true;
}
function polygonIndex(polygons,bounds){
 const n=24,scale=n/bounds.size,bins=Array.from({length:n*n},()=>[]),range=b=>[clamp(Math.floor((b.x-bounds.x)*scale),0,n-1),clamp(Math.floor((b.right-bounds.x)*scale),0,n-1),clamp(Math.floor((b.z-bounds.z)*scale),0,n-1),clamp(Math.floor((b.bottom-bounds.z)*scale),0,n-1)];
 for(const p of polygons){p.box=boxOf(p.polygon);const[x0,x1,z0,z1]=range(p.box);for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++)bins[z*n+x].push(p);}
 return poly=>{const box=boxOf(poly),[x0,x1,z0,z1]=range(box),seen=new Set();for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++)for(const p of bins[z*n+x]){if(seen.has(p))continue;seen.add(p);if(overlaps(box,p.box)&&polygonOverlap(poly,p.polygon))return true;}return false;};
}

function parentTerrain(world,bounds){
 const {mesh}=world,patches=[],water=[],steep=[],{triangles:t}=mesh;
 const boundsRect={x:bounds.x,z:bounds.z,right:bounds.x+bounds.size,bottom:bounds.z+bounds.size};
 for(let k=0;k<t.length;k+=3){
  const a=t[k],b=t[k+1],c=t[k+2];
  if(Math.max(mesh.x[a],mesh.x[b],mesh.x[c])<boundsRect.x||Math.min(mesh.x[a],mesh.x[b],mesh.x[c])>boundsRect.right||Math.max(mesh.z[a],mesh.z[b],mesh.z[c])<boundsRect.z||Math.min(mesh.z[a],mesh.z[b],mesh.z[c])>boundsRect.bottom)continue;
  const ids=[a,b,c],raw=ids.map(id=>({x:mesh.x[id],z:mesh.z[id],height:world.height[id],surface:world.waterSurface?.[id]??world.height[id],ocean:world.ocean[id]?1:0,lake:world.lake[id]?1:0,slope:world.slope?.[id]||0}));
  const polygon=clipToBox(raw,bounds);if(polygon.length<3||polygonArea(polygon)<1e-10)continue;
  patches.push({polygon:polygon.map(p=>({x:p.x,z:p.z})),height:polygon.reduce((v,p)=>v+p.height,0)/polygon.length,slope:polygon.reduce((v,p)=>v+p.slope,0)/polygon.length});
  for(const kind of['ocean','lake']){const p=clip(polygon,kind,.5);if(p.length>=3&&polygonArea(p)>1e-10)water.push({kind,polygon:p.map(v=>({x:v.x,z:v.z})),surface:p.reduce((s,v)=>s+v.surface,0)/p.length});}
  const p=clip(polygon,'slope',MAX_SLOPE);if(p.length>=3&&polygonArea(p)>1e-10)steep.push({kind:'steep',polygon:p.map(v=>({x:v.x,z:v.z}))});
 }
 // Preserve inherited channels rather than inventing new fine-scale drainage.
 for(let i=0;i<world.height.length;i++){
  const j=world.receiver?.[i];if(!world.river?.[i]||j==null||j<0||world.ocean[i]||world.lake[i])continue;
  const a={x:mesh.x[i],z:mesh.z[i]},b={x:mesh.x[j],z:mesh.z[j]},length=distance(a,b);if(!length||!overlaps(boxOf([a,b]),boundsRect))continue;
  const width=clamp(.016+Math.sqrt(Math.max(0,world.runoff?.[i]||0))*.0015,.02,.11),dx=(b.x-a.x)/length,dz=(b.z-a.z)/length;
  const p=clipToBox([{x:a.x-dx*width-dz*width,z:a.z-dz*width+dx*width},{x:b.x+dx*width-dz*width,z:b.z+dz*width+dx*width},{x:b.x+dx*width+dz*width,z:b.z+dz*width-dx*width},{x:a.x-dx*width+dz*width,z:a.z-dz*width-dx*width}],bounds);
  if(p.length>=3)water.push({kind:'river',polygon:p,sourceNodes:[i,j]});
 }
 return{patches,water,steep,sourceResolutionKm:world.parentDomain?.nominalSpacingKm||mesh.stepKm||world.stepKm||mesh.sizeKm/(mesh.n-1)};
}

function validate(world,history,frame,siteId){
 if(world?.stage!==4||!world.parentDomain)throw new Error('City detail requires the whole Stage 4 parent world');
 const mesh=world.mesh,N=world.height?.length,size=mesh?.sizeKm??world.parentDomain.sizeKm??world.config?.sizeKm;
 if(!N||mesh?.x?.length!==N||mesh?.z?.length!==N||!mesh.triangles?.length||world.ocean?.length!==N||world.lake?.length!==N||!(size>0))throw new Error('City detail requires the actual parent terrain triangles and water fields');
 const site=history?.sites?.find(s=>s.id===siteId),state=frame?.siteStates?.find(s=>s.siteId===siteId);
 if(!site)throw new Error('Settlement site does not exist');
 if(!Number.isInteger(frame?.generation)||!Number.isFinite(frame?.year)||site.founded>frame.generation||!state)throw new Error('Settlement does not exist at this date');
 if(!Number.isSafeInteger(state.population)||state.population<=0||state.status==='abandoned')throw new Error('Only an inhabited settlement with a positive population can open');
 if(!Number.isInteger(site.nodeId)||site.nodeId<0||site.nodeId>=N||world.ocean[site.nodeId]||world.lake[site.nodeId])throw new Error('Settlement site must be on parent land');
 return{site,state,size};
}

function inheritedOrientation(world,history,frame,site,seed){
 const {mesh}=world,active=new Set((frame.routeStates||[]).filter(r=>r.active).map(r=>r.routeId));
 const routes=(history.routes||[]).filter(r=>r.kind==='land'&&r.founded<=frame.generation&&(r.a===site.id||r.b===site.id)&&active.has(r.id));
 for(const route of routes){const ids=route.a===site.id?route.nodes:[...route.nodes].reverse(),next=ids.find(id=>id!==site.nodeId&&id>=0&&id<mesh.x.length);if(next!==undefined)return{angle:Math.atan2(mesh.z[next]-mesh.z[site.nodeId],mesh.x[next]-mesh.x[site.nodeId]),source:'inherited route',ids:routes.map(r=>r.id)};}
 const r=world.receiver?.[site.nodeId];if(r>=0&&world.slope?.[site.nodeId]>.035)return{angle:Math.atan2(mesh.z[r]-mesh.z[site.nodeId],mesh.x[r]-mesh.x[site.nodeId])+Math.PI/2,source:'terrain',ids:[]};
 return{angle:(hash(site.id+17,seed)-.5)*Math.PI,source:'local street plan',ids:[]};
}

function makeGrid(world,index,origin,length,n,angle,seed,blocked){
 const step=length/n,cos=Math.cos(angle),sin=Math.sin(angle),vertices=[],sample=[],cells=[],phase=hash(74,seed)*6.28;
 const at=(x,z)=>{const q=locateTriangle(index,x,z);if(!q)return null;const sum=f=>q.wa*f[q.a]+q.wb*f[q.b]+q.wc*f[q.c];return{height:sum(world.height),slope:world.slope?sum(world.slope):0,ocean:sum(world.ocean),lake:sum(world.lake)};};
 for(let row=0;row<=n;row++)for(let col=0;col<=n;col++){
  const id=row*(n+1)+col,u=(col-n/2+.18*Math.sin(row*.37+phase)+.07*(hash(id,seed)-.5))*step,v=(row-n/2+.18*Math.sin(col*.41+phase)+.07*(hash(id,seed+99)-.5))*step;
  const p={x:origin.x+u*cos-v*sin,z:origin.z+u*sin+v*cos};vertices.push(p);sample.push(at(p.x,p.z));
 }
 for(let row=0;row<n;row++)for(let col=0;col<n;col++){
  const a=row*(n+1)+col,ids=[a,a+1,a+n+2,a+n+1],polygon=ids.map(i=>vertices[i]),center={x:polygon.reduce((s,p)=>s+p.x,0)/4,z:polygon.reduce((s,p)=>s+p.z,0)/4},middle=at(center.x,center.z),samples=[middle,...ids.map(i=>sample[i])];
  const valid=samples.every(p=>p&&p.slope<MAX_SLOPE&&p.ocean<.5&&p.lake<.5),buildable=valid&&!blocked(polygon);
  cells.push({id:row*n+col,row,col,polygon,center,buildable,height:middle?.height||0,slope:middle?.slope||0,areaKm2:polygonArea(polygon),cost:Infinity,districtId:-1,developed:false});
 }return{cells,vertices,n,step,origin,angle};
}
function neighbors(grid,id){const {n}=grid,row=Math.floor(id/n),col=id%n,out=[];if(col>0)out.push(id-1);if(col<n-1)out.push(id+1);if(row>0)out.push(id-n);if(row<n-1)out.push(id+n);return out;}
function growCity(grid,origin,target,seed){
 const {cells}=grid;let start=-1,nearest=Infinity;
 for(const c of cells)if(c.buildable){const d=distance(c.center,origin);if(d<nearest){nearest=d;start=c.id;}}
 if(start<0)throw new Error('No buildable neighborhood land is available around this settlement');
 const heap=new Heap(),chosen=[];cells[start].cost=0;heap.push(start,0);let area=0;
 while(heap.a.length&&area<target){const {id,key}=heap.pop(),c=cells[id];if(c.developed||key!==c.cost)continue;c.developed=true;chosen.push(c);area+=c.areaKm2;
  for(const j of neighbors(grid,id)){const b=cells[j];if(!b.buildable||b.developed)continue;
   const avenue=Math.min(Math.abs(b.col-cells[start].col),Math.abs(b.row-cells[start].row)),edge=1+b.slope*13+.13*Math.sin(b.col*.24+seed%19)+.16*Math.sin(b.row*.31+seed%13)+(avenue<2?-.24:0)+hash(j,seed)*.12;
   const cost=key+distance(c.center,b.center)*edge;if(cost<b.cost){b.cost=cost;heap.push(j,cost);}
  }
 }return{chosen,start,area};
}

function assignDistricts(grid,growth,population,era,seed,origin){
 const {chosen,start}=growth,modern=era!=='agrarian',count=Math.min(chosen.length,modern?clamp(Math.ceil(population/30000),5,96):clamp(Math.round(3+Math.log10(Math.max(1,population)/50)*2),3,18)),seeds=[start];
 // Distributed seeds and geodesic assignment keep each neighborhood connected
 // even when the shoreline splits nearby land into separate peninsulas.
 const nearestSeed=new Float64Array(grid.cells.length).fill(Infinity);
 while(seeds.length<count){let best=-1,score=-1;const last=grid.cells[seeds.at(-1)].center;
  for(const c of chosen){nearestSeed[c.id]=Math.min(nearestSeed[c.id],(c.center.x-last.x)**2+(c.center.z-last.z)**2);const value=nearestSeed[c.id]*(.92+.16*hash(c.id,seed));if(value>score){best=c.id;score=value;}}
  if(best<0||score<=0)break;seeds.push(best);
 }
 const industrial=modern&&population>=1500?1:-1,park=seeds.length-1;
 const districts=seeds.map((cellId,id)=>{const kind=id===0?'downtown':id===industrial||modern&&population>=1500&&id%17===1?'industrial':id===park||modern&&id%19===0?'park':id%9===2&&population>30000?'mixed':'residential';return{id,name:'',kind,population:0,areaKm2:0,densityPerKm2:0,color:COLORS[kind],center:{...grid.cells[cellId].center},blockIds:[],boundary:[]};});
 const costs=new Float64Array(grid.cells.length).fill(Infinity),heap=new Heap();
 for(let i=0;i<seeds.length;i++){const id=seeds[i];grid.cells[id].districtId=i;costs[id]=0;heap.push(id,0);}
 while(heap.a.length){const {id,key}=heap.pop(),c=grid.cells[id];if(key!==costs[id])continue;for(const j of neighbors(grid,id)){const b=grid.cells[j];if(!b.developed)continue;const next=key+distance(c.center,b.center)*(1+b.slope*3);if(next<costs[j]-1e-9){costs[j]=next;b.districtId=c.districtId;heap.push(j,next);}}}
 const usedNames=new Set(),centerHeight=grid.cells[start].height;
 const localNames=['Commons','Union','Council','Assembly','Founders','Cooperative','Exchange','Market','Civic','Prospect','Terrace','Crescent','Courts','Gardens','Green','Square','Parade','Promenade','Walk','Avenue','Corner','Junction','Circle','Quarter','Steps','Arcade','Mews','Plaza','Fields','Broadway','Library','School'];
 for(const d of districts){const dx=d.center.x-origin.x,dz=d.center.z-origin.z,compass=['East','Southeast','South','Southwest','West','Northwest','North','Northeast'],direction=compass[(Math.round(Math.atan2(dz,dx)/(Math.PI/4))+8)%8];
  let name=d.kind==='downtown'?(population>=50000?'Downtown':'Town center'):d.kind==='park'?`${direction} park`:d.kind==='industrial'?`${direction} logistics`:d.kind==='mixed'?`${direction} center`:grid.cells[seeds[d.id]].height>centerHeight+45?`${direction} heights`:direction.length>5?direction:`${direction}side`;
  // Distinct local street/civic names keep a large metro legible without
  // filling it with "Westside 25". Direction and district use stay meaningful.
  const offset=Math.floor(hash(d.id,seed)*localNames.length),suffix=d.kind==='park'?' Park':d.kind==='industrial'?' Works':d.kind==='mixed'?' Center':'';
  for(let attempt=0;usedNames.has(name);attempt++){
   const word=localNames[(offset+attempt)%localNames.length],prefix=['','Union ','Council ','Civic '][Math.floor(attempt/localNames.length)];
   name=`${direction} ${prefix}${word}${suffix}`;
  }
  usedNames.add(name);d.name=name;
 }
 const divisions=Math.max(1,Math.min(4,Math.ceil(grid.step/.16),Math.floor(Math.sqrt(24000/chosen.length))));grid.divisions=divisions;grid.districtKinds=districts.map(d=>d.kind);
 const blocks=[],centroids=districts.map(()=>({x:0,z:0}));
 for(const c of chosen){const d=districts[c.districtId];
  for(let row=0;row<divisions;row++)for(let col=0;col<divisions;col++){
   const u=col/divisions,v=row/divisions,s=1/divisions,polygon=divisions===1?c.polygon:[bilerp(c.polygon,u,v),bilerp(c.polygon,u+s,v),bilerp(c.polygon,u+s,v+s),bilerp(c.polygon,u,v+s)],center=bilerp(c.polygon,u+s/2,v+s/2),areaKm2=polygonArea(polygon),id=blocks.length;
   d.blockIds.push(id);d.areaKm2+=areaKm2;centroids[d.id].x+=center.x*areaKm2;centroids[d.id].z+=center.z*areaKm2;
   blocks.push({id,cellId:c.id,districtId:d.id,kind:d.kind,polygon,center,areaKm2,variation:hash(id,seed),height:c.height});
  }
 }
 const centerDistance=new Float64Array(districts.length).fill(Infinity);for(const d of districts){centroids[d.id].x/=d.areaKm2;centroids[d.id].z/=d.areaKm2;}
 for(const b of blocks){const d=distance(b.center,centroids[b.districtId]);if(d<centerDistance[b.districtId]){centerDistance[b.districtId]=d;districts[b.districtId].center=b.center;}}
 for(const c of chosen){const d=districts[c.districtId],ids=[c.col<grid.n-1?c.id+1:-1,c.row<grid.n-1?c.id+grid.n:-1,c.col>0?c.id-1:-1,c.row>0?c.id-grid.n:-1],edges=[[1,2],[2,3],[3,0],[0,1]];
  for(let k=0;k<4;k++){const other=ids[k]>=0?grid.cells[ids[k]]:null;if(!other?.developed||other.districtId!==d.id)d.boundary.push(edges[k].map(i=>c.polygon[i]));}
 }
 const weights=districts.map(d=>d.areaKm2*(d.kind==='park'?0:d.kind==='industrial'?.14:d.kind==='downtown'?2.25:d.kind==='mixed'?1.5:.75+hash(d.id,seed)*.65)),total=weights.reduce((a,b)=>a+b,0),remainders=[];
 let allocated=0;for(const d of districts){const exact=population*weights[d.id]/total;d.population=Math.floor(exact);allocated+=d.population;remainders.push({id:d.id,fraction:exact-d.population});}
 remainders.sort((a,b)=>b.fraction-a.fraction||a.id-b.id);for(let i=0;i<population-allocated;i++)districts[remainders[i%remainders.length].id].population++;
 for(const d of districts)d.densityPerKm2=d.population/d.areaKm2;
 return{districts,blocks};
}

export function generateCity(world,history,frame,siteId){
 const {site,state,size}=validate(world,history,frame,siteId),population=state.population,seed=((world.config?.seed||0)^(history.seed||0)^Math.imul(siteId+1,2891336453))>>>0;
 let index=indexes.get(world.mesh);if(!index){index=indexMesh({...world.mesh,sizeKm:size,n:world.mesh.n||Math.round(Math.sqrt(world.mesh.x.length))});indexes.set(world.mesh,index);}
 const origin={x:world.mesh.x[site.nodeId],z:world.mesh.z[site.nodeId]},era=frame.era||'agrarian',defaultDensity=era==='agrarian'?900:population<5000?1800:population<50000?3000:5000;
 const density=Number.isFinite(state.densityPerKm2)&&state.densityPerKm2>0?state.densityPerKm2:defaultDensity;
 const targetAreaKm2=Number.isFinite(state.urbanAreaKm2)&&state.urbanAreaKm2>0?state.urbanAreaKm2:population/density;
 const length=Math.min(size*1.5,Math.max(.35,Math.sqrt(targetAreaKm2)*2.65)),grain=population<1500?.035:population<50000?.065:.13,n=Math.min(MAX_GRID,Math.max(33,Math.round(length/grain)))|1;
 const initialSize=Math.min(size,length*1.5),initialBounds={x:clamp(origin.x-initialSize/2,0,size-initialSize),z:clamp(origin.z-initialSize/2,0,size-initialSize),size:initialSize};
 const terrain=parentTerrain(world,initialBounds),blocked=polygonIndex([...terrain.water,...terrain.steep],initialBounds),orientation=inheritedOrientation(world,history,frame,site,seed);
 const grid=makeGrid(world,index,origin,length,n,orientation.angle,seed,blocked),growth=growCity(grid,origin,targetAreaKm2,seed),{districts,blocks}=assignDistricts(grid,growth,population,era,seed,origin);
 const developed=boxOf(blocks.flatMap(b=>b.polygon)),span=Math.max(developed.right-developed.x,developed.bottom-developed.z),extent=Math.min(size,Math.max(.3,span*1.32)),bounds={x:clamp((developed.x+developed.right-extent)/2,0,size-extent),z:clamp((developed.z+developed.bottom-extent)/2,0,size-extent),size:extent};
 const blockedWithoutRiver=polygonIndex([...terrain.water.filter(w=>w.kind!=='river'),...terrain.steep],initialBounds),structure=generateUrbanStructure({world,history,frame,site,grid,growth,districts,bounds,terrain,blocked,blockedWithoutRiver,orientation,seed,population});
 // The initial context covers every generated block; crop rendering to the
 // final view without re-solving drainage or assigning extra population.
 delete terrain.steep;
 return{version:'neighborhood-city-v2',siteId,name:site.name,nameOrigin:site.nameOrigin||null,population,year:frame.year,generation:frame.generation,era,eraLabel:frame.eraLabel||era,groupId:state.groupId??site.groupId,origin,center:grid.cells[growth.start].center,bounds,areaKm2:growth.area,targetAreaKm2,densityPerKm2:population/growth.area,footprintLimited:growth.area<targetAreaKm2*.96,districts,blocks,...structure,terrain,cellKm:grid.step/grid.divisions,orientationRadians:orientation.angle,orientationSource:orientation.source,inheritedRouteIds:orientation.ids,geographyNote:'Neighborhoods, streets and building footprints are generated at city scale. Terrain and water are interpolated from the unchanged parent mesh; no finer terrain observations are implied.'};
}
