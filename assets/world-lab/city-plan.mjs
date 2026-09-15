/** Dated inputs for the city plan. These recipes contain no fine street or
 * roof geometry, so a Metro request never realizes that work. */
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function datedLandRoutes(history,frame){
 const active=new Map((frame.routeStates||[]).filter(r=>r.active).map(r=>[r.routeId,r]));
 return(history.routes||[]).filter(r=>r.kind==='land'&&r.founded<=frame.generation&&active.has(r.id)).map(route=>({route,state:active.get(route.id)}));
}
export function routeWidth(state,era){return Number.isFinite(state?.widthKm)&&state.widthKm>0?state.widthKm:era==='agrarian'?.012:.026;}
export function urbanArea(state,era){
 const population=state.population,density=Number.isFinite(state.densityPerKm2)&&state.densityPerKm2>0?state.densityPerKm2:era==='agrarian'?900:population<5000?1800:population<50000?3000:5000;
 return Number.isFinite(state.urbanAreaKm2)&&state.urbanAreaKm2>0?state.urbanAreaKm2:population/density;
}
function datedSources(history,frame,site){
 const sources=(history.snapshots||[]).filter(f=>f.generation>=site.founded&&f.generation<=frame.generation).sort((a,b)=>a.generation-b.generation),selected=[];
 if(!sources.some(f=>f.generation===frame.generation))sources.push(frame);
 for(const source of sources){
  const state=source.siteStates.find(s=>s.siteId===site.id);if(!state||state.population<=0||state.status==='abandoned')continue;
  const area=urbanArea(state,source.era||'agrarian');
  if(!selected.length||selected.length<3&&area>=selected.at(-1).area*8)selected.push({source,state,area});
 }
 return selected;
}
export function historicPathRecipes(world,history,frame,site,seed){
 return datedSources(history,frame,site).map(({source,area},phase)=>{
  const inherited=datedLandRoutes(history,source).find(({route})=>route.a===site.id||route.b===site.id)?.route;
  const nodes=inherited?(inherited.a===site.id?inherited.nodes:[...inherited.nodes].reverse()):[],next=nodes.find(n=>n!==site.nodeId&&n>=0&&n<world.mesh.x.length);
  const angle=next===undefined?((seed%65521)/65521-.5)*Math.PI:Math.atan2(world.mesh.z[next]-world.mesh.z[site.nodeId],world.mesh.x[next]-world.mesh.x[site.nodeId]);
  return{phase,sourceGeneration:source.generation,sourceYear:source.year,sourceRouteId:inherited?.id??null,radiusKm:clamp(Math.sqrt(area)*.12,.012,.65),angleRadians:angle};
 });
}
export function planSignature(world,history,frame,site){
 // Include dated content rather than just object identity: callers and tests
 // can edit a snapshot in place, and inactive/future routes have no effect.
 const routes=datedLandRoutes(history,frame).map(({route,state})=>[route,state]);
 const inhabited=new Set(frame.siteStates.filter(t=>t.population>0&&t.status!=='abandoned').map(t=>t.siteId)),neighbors=history.sites.filter(s=>s.founded<=frame.generation&&inhabited.has(s.id)),neighborIds=new Set(neighbors.map(s=>s.id));
 const sources=datedSources(history,frame,site).map(({source,state})=>[source.generation,source.year,source.era,state,datedLandRoutes(history,source)]);
 return JSON.stringify([world.config?.seed,history.seed,site,frame.generation,frame.year,frame.era,frame.eraLabel,frame.siteStates.filter(s=>neighborIds.has(s.siteId)),neighbors,routes,sources]);
}
export function roadAccess(world,routes,step,bounds){
 const segments=[];
 for(const{route,state}of routes)for(let i=1;i<route.nodes.length;i++){
  const a=route.nodes[i-1],b=route.nodes[i],x=world.mesh.x[a],z=world.mesh.z[a],dx=world.mesh.x[b]-x,dz=world.mesh.z[b]-z,length2=dx*dx+dz*dz;
  if(bounds&&(Math.max(x,x+dx)<bounds.x-step*4||Math.min(x,x+dx)>bounds.x+bounds.size+step*4||Math.max(z,z+dz)<bounds.z-step*4||Math.min(z,z+dz)>bounds.z+bounds.size+step*4))continue;
  if(length2>0)segments.push({x,z,dx,dz,length2,strength:state.roadClass==='arterial'?.55:state.roadClass==='trail'?.3:.43});
 }
 return point=>{let access=0;for(const s of segments){const t=clamp(((point.x-s.x)*s.dx+(point.z-s.z)*s.dz)/s.length2,0,1),d=Math.hypot(point.x-s.x-t*s.dx,point.z-s.z-t*s.dz);if(d<step*4)access=Math.max(access,s.strength*Math.exp(-d/(step*1.8)));}return access;};
}

// A stable dry founding anchor is independent of the current accounting grid,
// which becomes coarser as a city expands. In particular, river settlements
// must keep their lanes on a bank rather than at the regional river node.
export function anchorHistoricPaths(recipes,origin,terrainBlocked){
 return recipes.map(recipe=>{
  const radius=recipe.radiusKm*1.3;
  const clear=p=>!terrainBlocked(Array.from({length:12},(_,i)=>({x:p.x+Math.cos(i*Math.PI/6)*radius,z:p.z+Math.sin(i*Math.PI/6)*radius})));
  if(clear(origin))return{...recipe,anchor:{...origin}};
  const reach=Math.max(.12,recipe.radiusKm*4);
  for(let ring=1;ring<=12;ring++)for(let spoke=0;spoke<16;spoke++){
   const angle=recipe.angleRadians+spoke*Math.PI/8,p={x:origin.x+Math.cos(angle)*reach*ring/12,z:origin.z+Math.sin(angle)*reach*ring/12};
   if(clear(p))return{...recipe,anchor:p};
  }
  return{...recipe,anchor:null};
 });
}


// Refinement can happen after callers edit or replace dated source objects.
// Capture only the scalars and route nodes the deferred street pass consumes;
// parent terrain and the much larger history snapshots are not copied.
export function datedStructureInputs(history,frame,site){
 const routes=[],routeStates=[];
 for(const {route,state} of datedLandRoutes(history,frame)){
  routes.push({id:route.id,a:route.a,b:route.b,kind:route.kind,founded:route.founded,nodes:[...route.nodes]});
  routeStates.push({routeId:state.routeId,active:state.active,roadClass:state.roadClass,widthKm:state.widthKm,traffic:state.traffic});
 }
 return{history:{routes},frame:{generation:frame.generation,year:frame.year,era:frame.era,routeStates},site:{id:site.id,nodeId:site.nodeId,founded:site.founded}};
}
