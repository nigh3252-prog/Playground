/** Visible urban form, in parent kilometers. Accounting cells constrain the
 * occupied land but never supply street edges or building orientations. */
import {datedLandRoutes,routeWidth} from './city-plan.mjs';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const hash=(n,seed)=>{let t=(n^seed)>>>0;t=Math.imul(t^t>>>16,0x45d9f3b);t=Math.imul(t^t>>>16,0x45d9f3b);return((t^t>>>16)>>>0)/4294967296;};
const lerp=(a,b,t)=>({x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t});
const boxOf=p=>({x:Math.min(...p.map(v=>v.x)),z:Math.min(...p.map(v=>v.z)),right:Math.max(...p.map(v=>v.x)),bottom:Math.max(...p.map(v=>v.z))});
const overlaps=(a,b)=>a.x<=b.right&&a.right>=b.x&&a.z<=b.bottom&&a.bottom>=b.z;
const expand=(b,r)=>({x:b.x-r,z:b.z-r,right:b.right+r,bottom:b.bottom+r});
const lengthOf=p=>p.slice(1).reduce((v,b,i)=>v+distance(p[i],b),0);
function inside(p,poly){let yes=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if((a.z>p.z)!==(b.z>p.z)&&p.x<(b.x-a.x)*(p.z-a.z)/(b.z-a.z)+a.x)yes=!yes;}return yes;}
function polygonOverlap(a,b){
 for(const p of[a,b])for(let i=0;i<p.length;i++){
  const q=p[(i+1)%p.length],dx=q.z-p[i].z,dz=p[i].x-q.x;let amin=Infinity,amax=-Infinity,bmin=Infinity,bmax=-Infinity;
  for(const v of a){const d=v.x*dx+v.z*dz;amin=Math.min(amin,d);amax=Math.max(amax,d);}
  for(const v of b){const d=v.x*dx+v.z*dz;bmin=Math.min(bmin,d);bmax=Math.max(bmax,d);}
  if(amax<bmin-1e-10||bmax<amin-1e-10)return false;
 }return true;
}
function rectangle(center,angle,width,depth,pad=0){
 const dx=Math.cos(angle),dz=Math.sin(angle),u=width/2+pad,v=depth/2+pad;
 return[[-u,-v],[u,-v],[u,v],[-u,v]].map(([a,b])=>({x:center.x+dx*a-dz*b,z:center.z+dz*a+dx*b}));
}
function corridor(a,b,r){return rectangle(lerp(a,b,.5),Math.atan2(b.z-a.z,b.x-a.x),distance(a,b)+r*2,r*2);}
function pointSegmentDistance(p,a,b){const dx=b.x-a.x,dz=b.z-a.z,t=clamp(((p.x-a.x)*dx+(p.z-a.z)*dz)/(dx*dx+dz*dz||1),0,1);return distance(p,{x:a.x+dx*t,z:a.z+dz*t});}
function polygonSegmentDistance(polygon,a,b){
 if(inside(a,polygon)||inside(b,polygon))return 0;
 let d=Infinity;
 for(let i=0;i<polygon.length;i++){
  const p=polygon[i],q=polygon[(i+1)%polygon.length],ax=b.x-a.x,az=b.z-a.z,bx=q.x-p.x,bz=q.z-p.z,den=ax*bz-az*bx;
  if(Math.abs(den)>1e-12){const t=((p.x-a.x)*bz-(p.z-a.z)*bx)/den,u=((p.x-a.x)*az-(p.z-a.z)*ax)/den;if(t>=0&&t<=1&&u>=0&&u<=1)return 0;}
  d=Math.min(d,pointSegmentDistance(p,a,b),pointSegmentDistance(a,p,q),pointSegmentDistance(b,p,q));
 }return d;
}

// A uniform spatial hash bounds both road-clearance and roof-overlap work.
// Its resolution follows urban grain rather than parent terrain resolution.
function spatialIndex(step){
 const bins=new Map();
 const visit=(box,fn)=>{for(let z=Math.floor(box.z/step);z<=Math.floor(box.bottom/step);z++)for(let x=Math.floor(box.x/step);x<=Math.floor(box.right/step);x++)fn(`${x},${z}`);};
 return{
  add(value,box){value.box=box;visit(box,key=>{let bin=bins.get(key);if(!bin){bin=[];bins.set(key,bin);}bin.push(value);});},
  query(box,fn){const seen=new Set();let hit=false;visit(box,key=>{if(hit)return;for(const value of bins.get(key)||[]){if(seen.has(value))continue;seen.add(value);if(overlaps(box,value.box)&&fn(value)){hit=true;break;}}});return hit;}
 };
}

function clipSegment(a,b,bounds){
 const dx=b.x-a.x,dz=b.z-a.z;let lo=0,hi=1;
 for(const[p,q]of[[-dx,a.x-bounds.x],[dx,bounds.x+bounds.size-a.x],[-dz,a.z-bounds.z],[dz,bounds.z+bounds.size-a.z]]){
  if(Math.abs(p)<1e-12){if(q<0)return null;}else{const t=q/p;if(p<0)lo=Math.max(lo,t);else hi=Math.min(hi,t);if(lo>hi)return null;}
 }return[lo===0?{...a}:lerp(a,b,lo),hi===1?{...b}:lerp(a,b,hi)];
}

function riverBridges(points,width,water){
 const bridges=[],intervals=[];let along=0;
 for(let i=1;i<points.length;i++){
  const a=points[i-1],b=points[i],length=distance(a,b),box=expand(boxOf([a,b]),width/2);
  for(const channel of water){
   if(channel.kind!=='river'||!overlaps(box,boxOf(channel.polygon)))continue;
   const poly=channel.polygon,orientation=Math.sign(poly.reduce((sum,p,j)=>{const q=poly[(j+1)%poly.length];return sum+p.x*q.z-q.x*p.z;},0))||1;let lo=0,hi=1;
   for(let j=0;j<poly.length;j++){
    const p=poly[j],q=poly[(j+1)%poly.length],dx=q.x-p.x,dz=q.z-p.z,pad=width/2*Math.hypot(dx,dz),da=((a.z-p.z)*dx-(a.x-p.x)*dz)*orientation+pad,db=((b.z-p.z)*dx-(b.x-p.x)*dz)*orientation+pad;
    if(da<0&&db<0){lo=1;hi=0;break;}
    if(da<0)lo=Math.max(lo,da/(da-db));else if(db<0)hi=Math.min(hi,da/(da-db));
   }
   if(hi<=lo)continue;
   intervals.push([along+lo*length,along+hi*length]);bridges.push({segmentIndex:i-1,kind:'river',points:[lerp(a,b,lo),lerp(a,b,hi)]});
  }along+=length;
 }
 // A bridge can cross the inherited channel, never run along it as an
 // invented elevated road. Merge adjacent source segments before measuring.
 intervals.sort((a,b)=>a[0]-b[0]);let start=-Infinity,end=-Infinity;
 for(const span of intervals){if(span[0]>end+.001){start=span[0];end=span[1];}else end=Math.max(end,span[1]);if(end-start>.4)return null;}
 return bridges;
}

function inheritedApproaches(world,history,frame,site,bounds){
 const approaches=[];
 for(const {route,state} of datedLandRoutes(history,frame)){
  const through=route.a!==site.id&&route.b!==site.id;
  const sourceNodeIds=route.a===site.id||through?[...route.nodes]:[...route.nodes].reverse(),source=sourceNodeIds.filter(i=>i>=0&&i<world.mesh.x.length).map(i=>({x:world.mesh.x[i],z:world.mesh.z[i]})),points=[];
  for(let i=1;i<source.length;i++){
   const clipped=clipSegment(source[i-1],source[i],bounds);if(!clipped){if(points.length)break;continue;}
   if(!points.length)points.push(clipped[0]);if(distance(points.at(-1),clipped[1])>1e-10)points.push(clipped[1]);
   if(distance(clipped[1],source[i])>1e-8)break;
  }
  if(points.length>1)approaches.push({routeId:route.id,sourceRouteKind:route.kind,sourceNodeIds,points,connection:{...points[0]},entry:{...points.at(-1)},foundedGeneration:route.founded,sourceGeneration:frame.generation,through,roadClass:state.roadClass||'road',widthKm:routeWidth(state,frame.era||'agrarian'),traffic:state.traffic||0,roadIds:[]});
 }return approaches;
}

class Heap{
 constructor(){this.a=[];}
 push(id,key){const a=this.a,v={id,key};let i=a.length;a.push(v);while(i){const p=(i-1)>>1;if(a[p].key<=key)break;a[i]=a[p];i=p;}a[i]=v;}
 pop(){const a=this.a,out=a[0],v=a.pop();if(a.length){let i=0;while(i*2+1<a.length){let c=i*2+1;if(c+1<a.length&&a[c+1].key<a[c].key)c++;if(a[c].key>=v.key)break;a[i]=a[c];i=c;}a[i]=v;}return out;}
}

function landNetwork(grid,growth,blocked){
 const {n,step,angle,origin,cells}=grid,cos=Math.cos(angle),sin=Math.sin(angle),edgeCache=new Map();
 const cellAt=p=>{
  const dx=p.x-origin.x,dz=p.z-origin.z,col=Math.floor((dx*cos+dz*sin)/step+n/2),row=Math.floor((-dx*sin+dz*cos)/step+n/2);
  for(let y=Math.max(0,row-1);y<=Math.min(n-1,row+1);y++)for(let x=Math.max(0,col-1);x<=Math.min(n-1,col+1);x++){const c=cells[y*n+x];if(c.developed&&inside(p,c.polygon))return c;}return null;
 };
 const safe=(a,b,width=.008,districtId=null)=>{
  const len=distance(a,b),count=Math.max(1,Math.ceil(len/Math.min(.2,step*.55)));
  for(let i=0;i<=count;i++){const c=cellAt(lerp(a,b,i/count));if(!c||districtId!=null&&c.districtId!==districtId)return false;}
  return !blocked(corridor(a,b,width/2+.0005));
 };
 const nearest=p=>{const c=cellAt(p);if(c)return c;let best=null,d=Infinity;for(const candidate of growth.chosen){const value=distance(candidate.center,p);if(value<d){d=value;best=candidate;}}return best;};
 const path=(a,b,width=.012)=>{
  if(safe(a,b,width))return[{...a},{...b}];
  const start=nearest(a),end=nearest(b);if(!start||!end)return null;
  const costs=new Float64Array(cells.length).fill(Infinity),previous=new Int32Array(cells.length).fill(-1),closed=new Uint8Array(cells.length),heap=new Heap();costs[start.id]=0;heap.push(start.id,distance(start.center,end.center));
  while(heap.a.length){
   const {id}=heap.pop();if(closed[id])continue;if(id===end.id)break;closed[id]=1;const c=cells[id];
   for(const j of[c.col>0?id-1:-1,c.col<n-1?id+1:-1,c.row>0?id-n:-1,c.row<n-1?id+n:-1]){
    if(j<0||!cells[j].developed||closed[j])continue;
    const key=`${Math.min(id,j)},${Math.max(id,j)},${width}`;let allowed=edgeCache.get(key);
    if(allowed===undefined){allowed=!blocked(corridor(c.center,cells[j].center,width/2+.0005));edgeCache.set(key,allowed);}if(!allowed)continue;
    const next=costs[id]+distance(c.center,cells[j].center)*(1+cells[j].slope*4);if(next>=costs[j])continue;costs[j]=next;previous[j]=id;heap.push(j,next+distance(cells[j].center,end.center));
   }
  }
  if(!Number.isFinite(costs[end.id]))return null;
  const points=[];for(let id=end.id;id>=0;id=previous[id]){points.push(cells[id].center);if(id===start.id)break;}points.reverse();
  if(distance(points[0],a)>.00001){if(!safe(a,points[0],width))return null;points.unshift(a);}else points[0]=a;
  if(distance(points.at(-1),b)>.00001){if(!safe(points.at(-1),b,width))return null;points.push(b);}else points[points.length-1]=b;
  // String pulling removes hidden-cell directions from the visible path. The
  // resulting bends are only those needed to stay around shoreline or slopes.
  const simplified=[points[0]];let i=0;while(i<points.length-1){let next=Math.min(points.length-1,i+80);while(next>i+1&&!safe(points[i],points[next],width))next--;simplified.push(points[next]);i=next;}return simplified;
 };
 const trace=(points,width,districtId=null)=>{
  const out=[points[0]];
  for(let i=1;i<points.length;i++){
   const a=out.at(-1),b=points[i];if(safe(a,b,width,districtId)){out.push(b);continue;}
   let lo=0,hi=1;for(let k=0;k<8;k++){const t=(lo+hi)/2;if(safe(a,lerp(a,b,t),width,districtId))lo=t;else hi=t;}
   if(distance(a,b)*lo>.006)out.push(lerp(a,b,lo));break;
  }return out;
 };
 return{cellAt,safe,path,trace};
}

function sampleLine(points,along){
 let remaining=along;
 for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],length=distance(a,b);if(remaining<=length||i===points.length-1)return{point:lerp(a,b,clamp(remaining/(length||1),0,1)),angle:Math.atan2(b.z-a.z,b.x-a.x),segment:i-1};remaining-=length;}
 return{point:points[0],angle:0,segment:0};
}

export function generateUrbanStructure({world,history,frame,site,grid,growth,districts,bounds,terrain,blocked,buildingBlocked=blocked,blockedWithoutRiver,owned=()=>true,orientation,seed,population,detail='streets',historicRecipes=[]}){
 const roads=[],center=grid.cells[growth.start].center,origin=grid.origin,modern=(frame.era||'agrarian')!=='agrarian',land=landNetwork(grid,growth,blocked),approaches=inheritedApproaches(world,history,frame,site,bounds);
 const streetWidth=clamp(Math.sqrt(growth.area)*.0018,.0035,.009),collectorWidth=Math.max(streetWidth*1.5,.006),arterialWidth=modern?Math.max(.012,streetWidth*2.8):Math.max(.006,streetWidth*1.8);
 const add=(points,options={})=>{
  const clean=points?.filter((p,i)=>!i||distance(p,points[i-1])>1e-8);if(!clean||clean.length<2||roads.length>=12000)return null;
  const road={id:roads.length,kind:'local',name:'Local street',widthKm:streetWidth,phase:'neighborhood connector',patternId:'connections',sourceRouteId:null,bridge:false,...options,points:clean.map(p=>({x:p.x,z:p.z}))};roads.push(road);return road;
 };
 for(const approach of approaches){
  const approachWidth=approach.widthKm;
  // Preserve a problematic regional polyline as provenance, but never invent
  // a broad-water bridge or pave a steep inherited travel corridor.
  if(approach.points.slice(1).some((b,i)=>blockedWithoutRiver(corridor(approach.points[i],b,approachWidth/2)))){approach.streetEligible=false;continue;}
  const bridges=riverBridges(approach.points,approachWidth,terrain.water);if(!bridges){approach.streetEligible=false;continue;}approach.streetEligible=true;
  const road=add(approach.points,{kind:'arterial',name:'Regional approach',widthKm:approachWidth,phase:'inherited approach',patternId:`route-${approach.routeId}`,sourceRouteId:approach.routeId,provenance:{kind:'regional route',sourceGeneration:frame.generation,foundedGeneration:approach.foundedGeneration,routeId:approach.routeId,roadClass:approach.roadClass},bridge:bridges.length>0,bridges});if(road)approach.roadIds.push(road.id);
 }
 if((approaches.length||historicRecipes.length)&&distance(origin,center)>.00001){
  const join=land.path(origin,center,collectorWidth);
  if(join)add(join,{kind:'collector',name:'Approach junction',widthKm:collectorWidth});
  else if(distance(origin,center)<Math.max(.5,grid.step*3)&&!blockedWithoutRiver(corridor(origin,center,collectorWidth/2))){const bridges=riverBridges([origin,center],collectorWidth,terrain.water);if(bridges)add([origin,center],{kind:'collector',name:'Approach crossing',widthKm:collectorWidth,bridge:bridges.length>0,bridges});}
 }

 // Connected district centers supply a sparse city skeleton, then local
 // streets grow from it. They are not a tessellation of accounting cells.
 for(const approach of approaches.filter(a=>a.through&&a.streetEligible)){
  let nearest=null,best=Infinity;
  for(let i=1;i<approach.points.length;i++){const a=approach.points[i-1],b=approach.points[i],dx=b.x-a.x,dz=b.z-a.z,t=clamp(((center.x-a.x)*dx+(center.z-a.z)*dz)/(dx*dx+dz*dz||1),0,1),p=lerp(a,b,t),d=distance(p,center);if(d<best){best=d;nearest=p;}}
  const join=nearest&&land.path(nearest,center,collectorWidth);
  if(join)add(join,{kind:'collector',name:'Through-road junction',widthKm:collectorWidth,phase:'through-route connection',sourceConnectionRouteId:approach.routeId});
 }
 const connected=new Set([0]),hubs=districts.map(d=>d.center);
 const connection=(a,b,token,width=collectorWidth)=>{
  const dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz),bend=(hash(token,seed)-.5)*len*.19;
  const curved=Array.from({length:9},(_,i)=>{const t=i/8,p=lerp(a,b,t),offset=Math.sin(Math.PI*t)*bend;return{x:p.x-dz/(len||1)*offset,z:p.z+dx/(len||1)*offset};});
  return curved.slice(1).every((p,i)=>land.safe(curved[i],p,width))?curved:land.path(a,b,width);
 };
 if(distance(center,hubs[0])>1e-7)add(connection(center,hubs[0],700),{kind:'collector',name:'Founding street',widthKm:collectorWidth,phase:'old center',patternId:'old-center'});
 while(connected.size<hubs.length){
  let from=-1,to=-1,best=Infinity;for(const a of connected)for(let b=0;b<hubs.length;b++)if(!connected.has(b)){const d=distance(hubs[a],hubs[b]);if(d<best){best=d;from=a;to=b;}}
  if(to<0)break;const points=connection(hubs[from],hubs[to],to+821);add(points,{kind:'collector',name:'District connection',widthKm:collectorWidth});connected.add(to);
 }
 // A few later, wider cross-city interventions cut through the older fabric.
 if(modern&&population>=5000&&hubs.length>2){
  const ordered=districts.filter(d=>d.kind!=='park').sort((a,b)=>Math.atan2(a.center.z-center.z,a.center.x-center.x)-Math.atan2(b.center.z-center.z,b.center.x-center.x));
  for(let k=0;k<Math.min(3,Math.ceil(Math.log10(population/1000)));k++){const a=ordered[Math.floor(k*ordered.length/6)],b=ordered[Math.floor((k/6+.5)*ordered.length)%ordered.length];add(connection(a.center,b.center,991+k,arterialWidth),{kind:'arterial',name:'Cross-town avenue',widthKm:arterialWidth,phase:'later arterial',patternId:'later-arteries'});}
 }

 const connectedHistoric=[];
 for(const recipe of historicRecipes){
  const anchor=recipe.anchor;if(!anchor)continue;
  if(distance(anchor,center)<1e-8){connectedHistoric.push(recipe);continue;}
  let join=land.path(anchor,center,collectorWidth),bridges=[];
  // Fine retained paths may lie on dry land that a coarser current occupancy
  // cell omits. A short, terrain-checked join can reach that inherited bank.
  if(!join){const strip=corridor(anchor,center,collectorWidth/2);if(owned(strip)&&!blockedWithoutRiver(strip)){const spans=riverBridges([anchor,center],collectorWidth,terrain.water);if(spans){join=[anchor,center];bridges=spans;}}}
  if(join){add(join,{kind:'collector',name:'Founding quarter connection',phase:'retained path connection',widthKm:collectorWidth,bridge:bridges.length>0,bridges,sourceGeneration:recipe.sourceGeneration});connectedHistoric.push(recipe);}
 }
 const maturity=clamp((frame.generation-site.founded)/18,0,1),coreRadius=clamp(Math.sqrt(growth.area)*(.08+.04*maturity),.028,1.25),spokes=[],spokeCount=5+Math.floor(maturity*2+hash(77,seed)*2),base=orientation.angle;
 for(let i=0;i<(detail==='metro'?1:spokeCount);i++){
  const angle=base+i*Math.PI*2/spokeCount+(hash(i+48,seed)-.5)*.3,len=coreRadius*(.8+hash(i+92,seed)*.5),bend=(hash(i+26,seed)-.5)*.35;
  const points=Array.from({length:13},(_,k)=>{const t=k/12,a=angle+Math.sin(Math.PI*t)*bend;return{x:center.x+Math.cos(a)*len*t,z:center.z+Math.sin(a)*len*t};});
  const valid=land.trace(points,i===0?arterialWidth:streetWidth),road=add(valid,{kind:i===0?'arterial':'local',name:i===0?'Market street':'Old town lane',widthKm:i===0?arterialWidth:streetWidth,phase:'old center',patternId:'old-center'});if(road)spokes.push(road);
 }
 if(detail==='streets')for(const fraction of[.43,.79])for(let i=0;i<spokes.length;i++){
  const a=sampleLine(spokes[i].points,lengthOf(spokes[i].points)*fraction).point,b=sampleLine(spokes[(i+1)%spokes.length].points,lengthOf(spokes[(i+1)%spokes.length].points)*fraction).point;
  const points=connection(a,b,310+i+Math.round(fraction*100),streetWidth);add(points,{name:'Old town connection',phase:'old center',patternId:'old-center'});
 }

 // Each quarter has its own plan. Curved residential branches and irregular
 // crosslinks dominate; compact straight grids belong to selected planned
 // quarters and more widely spaced industrial access streets.
 const spacing=clamp(Math.sqrt(growth.area/26000),population<1500?.024:.065,.29),patterns=[],localPlans=[];
 for(const district of districts){
  if(district.kind==='park')continue;
  const id=district.id,industrial=district.kind==='industrial',planned=modern&&(industrial||id!==0&&(id%3===2||id%7===3)),phase=industrial?'industrial access':planned?'planned expansion':id===0?'old center':'neighborhood connector',patternId=`quarter-${id}`;
  const surveyAngle=orientation.source==='terrain'?base:0,angle=planned?surveyAngle:base+(hash(id+382,seed)-.5)*1.9+(id%2?.34:-.21),cos=Math.cos(angle),sin=Math.sin(angle),hub=district.center,curvature=planned?0:.1+hash(id+121,seed)*.14,localSpacing=spacing*(industrial?1.75:planned?1.07:.9+hash(id+71,seed)*.35);
  let extent=0;for(const c of growth.chosen)if(c.districtId===id)extent=Math.max(extent,distance(c.center,hub)+grid.step);extent=Math.max(extent,localSpacing*2);
  const spineParts=[];
  for(const sign of[-1,1]){
   const count=Math.max(4,Math.ceil(extent/(localSpacing*.6))),points=Array.from({length:count+1},(_,k)=>{const t=k/count,u=sign*extent*t,v=Math.sin(t*Math.PI*1.3)*extent*curvature*.37*sign;return{x:hub.x+cos*u-sin*v,z:hub.z+sin*u+cos*v};});
   spineParts.push(land.trace(points,collectorWidth,id));
  }
  const spinePoints=[...spineParts[0].slice(1).reverse(),...spineParts[1]],spine=add(spinePoints,{kind:'collector',name:industrial?'Works access':'Neighborhood high street',widthKm:collectorWidth,phase,patternId,districtId:id});
  if(!spine)continue;patterns.push({id:patternId,districtId:id,phase,angleRadians:angle,surveyId:planned?'founding-survey':null,surveySource:planned?(orientation.source==='terrain'?'terrain contour':'cardinal survey'):null});
  if(detail==='streets')localPlans.push({spine,id,industrial,planned,phase,patternId,curvature,localSpacing,extent});
 }
 if(detail==='streets')for(const {spine,id,industrial,planned,phase,patternId,curvature,localSpacing,extent} of localPlans){
  const spineLength=lengthOf(spine.points),branches=[];
  for(let along=localSpacing*.55;along<spineLength-localSpacing*.15;along+=localSpacing*(planned?1:.86+hash(branches.length+id*97,seed)*.3)){
   const source=sampleLine(spine.points,along),root=source.point,parts=[];
   if(id===0&&distance(root,center)<coreRadius*.8)continue;
   for(const sign of[-1,1]){
    const branchAngle=source.angle+Math.PI/2+(planned?0:(hash(branches.length+id*101,seed)-.5)*.36),count=Math.max(4,Math.ceil(extent/(localSpacing*.65))),points=Array.from({length:count+1},(_,k)=>{const t=k/count,a=branchAngle+Math.sin(t*Math.PI*1.2)*curvature*sign,u=sign*extent*t;return{x:root.x+Math.cos(a)*u,z:root.z+Math.sin(a)*u};});
    parts.push(land.trace(points,streetWidth,id));
   }
   const road=add([...parts[0].slice(1).reverse(),...parts[1]],{name:industrial?'Works lane':planned?'Planned street':'Residential lane',phase,patternId,districtId:id});if(road)branches.push({parts,road});
  }
  // Connect successive branches at varied depths. A missing branch or a
  // shore edge ends the run; every resumed run still starts on a real street.
  for(let side=0;side<2;side++)for(let tier=1;tier<=(planned?4:3);tier++){
   let run=[];const finish=()=>{if(run.length>1)add(run,{name:planned?'Quarter cross street':'Crescent connection',phase,patternId,districtId:id});run=[];};
   for(let j=0;j<branches.length;j++){
    const branch=branches[j].parts[side],along=localSpacing*(tier*(planned?1.55:1.9))*(planned?1:1+.14*Math.sin(j*.7+tier));
    if(lengthOf(branch)<along){finish();continue;}const p=sampleLine(branch,along).point;
    if(run.length&&!land.safe(run.at(-1),p,streetWidth,id))finish();run.push(p);
   }finish();
  }
 }

 // Stitch local plans across their shared edges. This retains the separate
 // survey directions without treating administrative boundaries as barriers.
 if(detail==='streets'){
 // Replay only a bounded early path skeleton, never historical roofs or
 // whole historical cities. Coordinates and widths come from dated recipes.
 for(const recipe of connectedHistoric)for(let spoke=0;spoke<7;spoke++){
  const angle=recipe.angleRadians+spoke*Math.PI*2/7,bend=(hash(spoke+701+recipe.phase*31,seed)-.5)*.36,radius=recipe.radiusKm*(.85+hash(spoke+88,seed)*.3);
  const points=Array.from({length:13},(_,k)=>{const t=k/12,a=angle+Math.sin(Math.PI*t)*bend;return{x:recipe.anchor.x+Math.cos(a)*radius*t,z:recipe.anchor.z+Math.sin(a)*radius*t};});
  const widthKm=.0035;
  if(points.every(p=>p.x>=bounds.x&&p.x<=bounds.x+bounds.size&&p.z>=bounds.z&&p.z<=bounds.z+bounds.size)&&points.slice(1).every((p,i)=>!blocked(corridor(points[i],p,widthKm/2+.0005))))add(points,{name:'Retained founding lane',widthKm,phase:'old center',patternId:`historic-${recipe.phase}`,provenance:{kind:'retained local path',pathId:`${site.id}:${recipe.sourceGeneration}:${spoke}`,sourceGeneration:recipe.sourceGeneration,sourceYear:recipe.sourceYear,foundedGeneration:recipe.sourceGeneration,sourceRouteId:recipe.sourceRouteId}});
 }
 const reach=spacing*2.4,endpoints=spatialIndex(Math.max(.1,reach)),ends=[];
 for(const road of roads){
  if(road.districtId==null)continue;
  for(const first of[true,false]){
   const point=first?road.points[0]:road.points.at(-1),other=first?road.points[1]:road.points.at(-2),length=distance(point,other),end={point,roadId:road.id,districtId:road.districtId,dx:(point.x-other.x)/(length||1),dz:(point.z-other.z)/(length||1),used:false};
   endpoints.add(end,boxOf([point]));ends.push(end);
  }
 }
 let stitched=0;
 for(const end of ends){
  if(end.used||stitched>=districts.length*5)continue;
  let best=null,score=Infinity;
  endpoints.query(expand(boxOf([end.point]),reach),candidate=>{
   if(candidate.used||candidate.districtId===end.districtId)return false;
   const dx=candidate.point.x-end.point.x,dz=candidate.point.z-end.point.z,len=Math.hypot(dx,dz);
   if(len<.004||len>reach||(end.dx*dx+end.dz*dz)/len<-.15||(candidate.dx*dx+candidate.dz*dz)/len>.15)return false;
   if(len<score&&land.safe(end.point,candidate.point,streetWidth)){score=len;best=candidate;}return false;
  });
  if(!best)continue;
  add([end.point,best.point],{name:'Joining street',phase:'neighborhood connector',districtIds:[end.districtId,best.districtId]});end.used=true;best.used=true;stitched++;
 }

 }
 // Principal identifiers stay stable when local detail is added.
 roads.sort((a,b)=>(a.kind==='local')-(b.kind==='local')||a.id-b.id);
 const roadIds=new Map(roads.map((road,id)=>[road.id,id]));
 for(let id=0;id<roads.length;id++)roads[id].id=id;
 for(const approach of approaches)approach.roadIds=approach.roadIds.map(id=>roadIds.get(id));
 const buildings=detail==='metro'?[]:makeBuildings({roads,land,blocked:buildingBlocked,districts,growth,population,seed,spacing,streetWidth});
 const phases=[...new Set(roads.map(r=>r.phase))].map(phase=>({phase,roadCount:roads.filter(r=>r.phase===phase).length}));
 const routeCount=approaches.filter(a=>a.streetEligible).length,summary=`${routeCount?`${routeCount} dated land approach${routeCount===1?'':'es'} connect to the local streets. `:''}An irregular center connects to ${modern?'curved residential streets and locally planned quarters':'lanes shaped around the occupied land'}.`;
 return{roads,buildings,approaches,development:{sourceGeneration:frame.generation,settlementFoundedGeneration:site.founded,phases,patterns,buildingCount:buildings.length,localStreetCount:roads.filter(r=>r.kind==='local').length,summary,note:'Up to three dated early path skeletons are retained where present-day terrain and settlement territory permit; later neighborhood streets and roofs are regenerated. Shared survey axes organize planned quarters. Street phases and building footprints are procedural interpretations of the dated settlement, active regional routes and inherited terrain. They are not recorded construction events or a census of individual buildings. District populations reconcile exactly to the selected date.'}};
}

function makeBuildings({roads,land,blocked,districts,growth,population,seed,spacing,streetWidth}){
 const roadIndex=spatialIndex(Math.max(.08,spacing*1.3)),roofIndex=spatialIndex(Math.max(.08,spacing*1.3)),buildings=[],streetClearance=.0025,roofClearance=.002,waterClearance=.003;
 for(const road of roads)for(let i=1;i<road.points.length;i++){
  const a=road.points[i-1],b=road.points[i],length=distance(a,b),pieces=Math.max(1,Math.ceil(length/Math.max(.12,spacing*2)));
  for(let j=0;j<pieces;j++){const segment={a:lerp(a,b,j/pieces),b:lerp(a,b,(j+1)/pieces),halfWidth:road.widthKm/2};roadIndex.add(segment,expand(boxOf([segment.a,segment.b]),segment.halfWidth+streetClearance));}
 }
 const lengths=roads.map(r=>lengthOf(r.points)),total=lengths.reduce((a,b)=>a+b,0),budget=clamp(Math.round(population/3),8,48000),minimum=population<1500?.017:.026,slotSpacing=Math.max(minimum,total*2/(budget*1.65)),formScale=clamp(Math.sqrt(growth.area/180),.72,2.1);
 const candidates=[];
 for(let ri=0;ri<roads.length;ri++){
  const road=roads[ri],slots=Math.max(1,Math.floor(lengths[ri]/slotSpacing));
  for(let slot=0;slot<slots;slot++)candidates.push({ri,along:(slot+.5)*lengths[ri]/slots,order:hash(Math.imul(ri+1,7919)+slot,seed)});
 }
 // A deterministic mixed order distributes a bounded roof budget throughout
 // every neighborhood instead of exhausting it on the first central roads.
 candidates.sort((a,b)=>a.order-b.order||a.ri-b.ri||a.along-b.along);
 for(let ci=0;ci<candidates.length&&buildings.length<budget;ci++){
  const {ri,along}=candidates[ci],road=roads[ri],front=sampleLine(road.points,along);
  for(const side of[-1,1]){
   if(buildings.length>=budget)break;
   const token=ci*2+(side+1)/2,variation=hash(token+3901,seed),probe={x:front.point.x-Math.sin(front.angle)*side*(road.widthKm/2+.026*formScale),z:front.point.z+Math.cos(front.angle)*side*(road.widthKm/2+.026*formScale)},cell=land.cellAt(probe);if(!cell)continue;
   const district=districts[cell.districtId];if(district.kind==='park')continue;
   const kind=district.kind,industrial=kind==='industrial',dense=kind==='downtown'||kind==='mixed',width=(industrial?.068+variation*.068:dense?.022+variation*.029:.02+variation*.025)*formScale,depth=(industrial?.045+hash(token+1,seed)*.055:dense?.025+hash(token+1,seed)*.022:.017+hash(token+1,seed)*.024)*formScale,setback=streetClearance+(industrial?.009:dense?.003:.005)*formScale;
   const offset=road.widthKm/2+setback+depth/2,center={x:front.point.x-Math.sin(front.angle)*side*offset,z:front.point.z+Math.cos(front.angle)*side*offset},polygon=rectangle(center,front.angle,width,depth),padded=rectangle(center,front.angle,width,depth,waterClearance),actual=land.cellAt(center);
   if(!actual||districts[actual.districtId].kind==='park'||polygon.some(p=>!land.cellAt(p))||blocked(padded))continue;
   const box=boxOf(polygon);
   if(roadIndex.query(expand(box,streetClearance),s=>polygonSegmentDistance(polygon,s.a,s.b)<s.halfWidth+streetClearance-1e-10))continue;
   if(roofIndex.query(expand(box,roofClearance),b=>polygonOverlap(polygon,b.clearancePolygon)))continue;
   const building={id:buildings.length,polygon,center,kind:districts[actual.districtId].kind,districtId:actual.districtId,roadId:road.id,areaKm2:width*depth,height:actual.height,angleRadians:front.angle,frontage:{point:{...front.point},side,setbackKm:setback,segmentIndex:front.segment},variation};
   buildings.push(building);const clearancePolygon=rectangle(center,front.angle,width,depth,roofClearance);roofIndex.add({clearancePolygon},boxOf(clearancePolygon));
  }
 }return buildings;
}
