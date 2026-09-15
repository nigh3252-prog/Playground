// Date-aware, view-only helpers. Nothing here advances the simulation.
const inside=(x,z,b)=>x>=b.x&&z>=b.z&&x<=b.x+b.size&&z<=b.z+b.size;
const mix=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*Math.max(0,Math.min(1,t)));
const rgb=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));

export function visibleHistorySites(world,history,frame,box){
  if(!history||!frame)return [];
  return frame.siteStates.flatMap(state=>{
    const site=history.sites[state.siteId];
    if(!site||site.founded>frame.generation)return [];
    const x=world.mesh.x[site.nodeId],z=world.mesh.z[site.nodeId];
    return inside(x,z,box)?[{site,state,x,z}]:[];
  });
}

export function nearestHistorySite(world,history,frame,nodeId,box,maxDistance=box.size*.025){
  const x=world.mesh.x[nodeId],z=world.mesh.z[nodeId];
  if(!inside(x,z,box))return -1;
  let best=-1,distance=maxDistance;
  for(const p of visibleHistorySites(world,history,frame,box)){
    const d=Math.hypot(p.x-x,p.z-z);
    if(d<=distance){distance=d;best=p.site.id;}
  }
  return best;
}

export function visibleHistoryRoutes(history,frame,traces=true){
  if(!history||!frame)return [];
  return frame.routeStates.flatMap(state=>{
    const route=history.routes[state.routeId];
    return route&&route.founded<=frame.generation&&(state.active||traces)?[{route,state}]:[];
  });
}

export function describeHistoryPlace(history,frame,siteId){
  const site=history?.sites[siteId],state=frame?.siteStates.find(s=>s.siteId===siteId);
  if(!site||!state||site.founded>frame.generation)return null;
  return {site,state,group:history.groups[state.groupId],age:(frame.generation-site.founded)*history.yearsPerGeneration,
    events:history.snapshots.filter(f=>f.generation<=frame.generation).flatMap(f=>f.events).filter(e=>e.generation<=frame.generation&&e.siteIds.includes(siteId)),
    traces:visibleHistoryRoutes(history,frame).filter(({route,state:r})=>!r.active&&(route.a===siteId||route.b===siteId))};
}

export function historyNodeColor(base,world,history,frame,id,{landUse=false,influence=false}={}){
  if(world.ocean[id]||world.lake[id])return base;
  let c=base;
  if(landUse){
    // Compare with the original cover: recovery reveals the original biome again.
    const initial=history.snapshots?.[0]?.woodland?.[id]??frame.woodland[id];
    c=mix(c,[151,152,102],Math.max(0,initial-frame.woodland[id])*.65);
    c=mix(c,[210,184,115],frame.cultivation[id]*.8);
    c=mix(c,[208,199,144],frame.settled[id]*.12);
    // A parent sample stores a physical built-area fraction, not an invented
    // circular city footprint that could spill across the shoreline.
    if(frame.urbanFraction)c=mix(c,[193,168,143],Math.sqrt(frame.urbanFraction[id])*.85);
  }
  const group=history.groups[frame.influence[id]];
  if(influence&&group)c=mix(c,rgb(group.color),frame.settled[id]*.48);
  return c;
}

export function drawHumanHistory(ctx,world,history,frame,box,{routes=true,traces=true,labels=true,influence=false,selectedSite=-1,symbolScale=1}={}){
  if(!history||!frame)return;
  const scale=ctx.canvas.width/box.size,xy=id=>[(world.mesh.x[id]-box.x)*scale,(world.mesh.z[id]-box.z)*scale];
  ctx.save();ctx.beginPath();ctx.rect(0,0,ctx.canvas.width,ctx.canvas.height);ctx.clip();
  ctx.lineCap='round';ctx.lineJoin='round';
  const modern=!!frame.urbanFraction;
  if(routes)for(const {route,state} of visibleHistoryRoutes(history,frame,traces)){
    ctx.strokeStyle=state.active?(route.kind==='land'?'#eed3a4b8':'#b7e4dfbf'):'#ddc9a585';
    ctx.lineWidth=(state.active?(modern ? .7+Math.min(2,Math.log10(1+state.traffic)*.3):1.5+Math.min(5,Math.sqrt(state.traffic)/40)):1.7)*symbolScale*(modern?Math.max(.5,Math.min(1,1200/box.size)):1);
    ctx.setLineDash(state.active?[]:[8*symbolScale,7*symbolScale]);
    ctx.beginPath();route.nodes.forEach((id,i)=>{const [x,y]=xy(id);i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.stroke();
  }
  ctx.setLineDash([]);
  const sites=visibleHistorySites(world,history,frame,box).filter(p=>traces||p.state.status!=='abandoned').sort((a,b)=>b.state.population-a.state.population);
  const labelBoxes=[];
  const crowdScale=modern?Math.max(.35,Math.min(1,Math.sqrt(120/Math.max(1,sites.length)))):1;
  for(const {site,state} of sites){
    const [x,y]=xy(site.nodeId),abandoned=state.status==='abandoned',chosen=site.id===selectedSite;
    const radius=(abandoned?4.5:modern?(3+Math.log10(1+state.population))*crowdScale:Math.min(14,3.8+Math.sqrt(state.population)/55))*symbolScale;
    ctx.strokeStyle=chosen?'#ffffff':abandoned?'#ded2b5':'#283a36';
    ctx.lineWidth=(chosen?3:1.8)*symbolScale;
    ctx.fillStyle=influence?(history.groups[state.groupId]?.color||'#efdbab'):'#f3e3bc';
    ctx.beginPath();ctx.arc(x,y,radius,0,Math.PI*2);if(!abandoned)ctx.fill();ctx.stroke();
    if(chosen){ctx.strokeStyle='#fff5cc';ctx.lineWidth=1.5*symbolScale;ctx.beginPath();ctx.arc(x,y,radius+6*symbolScale,0,Math.PI*2);ctx.stroke();}
    if(!labels||(!chosen&&abandoned)||(!chosen&&labelBoxes.length>=12))continue;
    ctx.font=`600 ${15*symbolScale}px system-ui`;
    const tx=x+radius+5*symbolScale,ty=y-4*symbolScale,width=ctx.measureText(site.name).width;
    const rect={x:tx-3,y:ty-16*symbolScale,w:width+6,h:20*symbolScale};
    if(!chosen&&labelBoxes.some(b=>rect.x<b.x+b.w&&rect.x+rect.w>b.x&&rect.y<b.y+b.h&&rect.y+rect.h>b.y))continue;
    labelBoxes.push(rect);ctx.lineWidth=4*symbolScale;ctx.strokeStyle='#243a36';ctx.strokeText(site.name,tx,ty);ctx.fillStyle=chosen?'#ffffff':'#fff2d3';ctx.fillText(site.name,tx,ty);
  }
  ctx.restore();
}
