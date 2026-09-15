/** One demand-drawn camera from regional connections to individual streets. */
import {contextTexture} from './city-context.mjs';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const inside=(p,poly)=>{let yes=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if((a.z>p.z)!==(b.z>p.z)&&p.x<(b.x-a.x)*(p.z-a.z)/(b.z-a.z)+a.x)yes=!yes;}return yes;};
const rgb=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
const tint=(hex,amount)=>{const c=rgb(hex);return`rgb(${c.map(v=>Math.round(v+(255-v)*amount)).join(',')})`;};
export function createCityView(canvas,{onSelect=()=>{},onChange=()=>{},onSelectSite=()=>{},onDetailRequest=()=>{}}={}){
 const ctx=canvas.getContext('2d',{alpha:false}),pointers=new Map(),listeners=[],oldTouchAction=canvas.style.touchAction;
 const request=globalThis.requestAnimationFrame?.bind(globalThis)||((fn)=>setTimeout(fn,16)),cancel=globalThis.cancelAnimationFrame?.bind(globalThis)||clearTimeout;
 let city=null,context=null,texture=null,initialViewport=null,width=1,height=1,dpr=1,zoom=1,scale=1,center={x:0,z:0},active=true,destroyed=false,pending=null,selected=null,suppressTap=false,pinch=null;
 const cities=new Map(),requested=new Set(),roadBoxes=new WeakMap();
 canvas.style.touchAction='none';
 const screen=p=>({x:width/2+(p.x-center.x)*scale,y:height/2+(p.z-center.z)*scale});
 const world=p=>({x:center.x+(p.x-width/2)/scale,z:center.z+(p.y-height/2)/scale});
 const local=e=>{const r=canvas.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top};};
 const baseSize=()=>city?.bounds.size||context?.bounds.size||1;
 const updateScale=()=>{scale=Math.max(1,Math.min(width,height))/(baseSize()*1.06)*zoom;};
 const zoomLimits=()=>context?[width/(context.bounds.size*2.4)*baseSize()*1.06/Math.min(width,height),width/.15*baseSize()*1.06/Math.min(width,height)]:[.65,100];
 const getView=()=>({kmAcross:city||context?width/scale:0,zoom,center:{...center}});
 const notify=()=>onChange(getView());
 const invalidate=()=>{if(!active||destroyed||!ctx||pending!==null)return;pending=request(()=>{pending=null;if(active&&!destroyed)draw();});};
 const constrain=()=>{if(!city&&!context)return;const b=context?.bounds||city.bounds,margin=b.size*.15;center.x=clamp(center.x,b.x-margin,b.x+b.size+margin);center.z=clamp(center.z,b.z-margin,b.z+b.size+margin);};
 const detailTargets=()=>!context?[]:context.sites.filter(s=>s.radiusKm*scale>32).map(s=>({s,p:screen(s.point)})).filter(({p})=>p.x>0&&p.x<width&&p.y>0&&p.y<height).sort((a,b)=>Math.hypot(a.p.x-width/2,a.p.y-height/2)-Math.hypot(b.p.x-width/2,b.p.y-height/2)).slice(0,6);
 function requestVisibleDetail(){
  if(!context||!active)return;
  const candidates=detailTargets().filter(({s})=>!cities.has(s.id)&&!requested.has(s.id));
  if(candidates.length){const id=candidates[0].s.id;requested.add(id);onDetailRequest(id);}
 }
 const changed=()=>{constrain();notify();invalidate();requestVisibleDetail();};
 const path=polygon=>{ctx.beginPath();if(!polygon.length)return;ctx.moveTo(polygon[0].x,polygon[0].z);for(let i=1;i<polygon.length;i++)ctx.lineTo(polygon[i].x,polygon[i].z);ctx.closePath();};
 const line=points=>{ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(p.x,p.z):ctx.moveTo(p.x,p.z));};
 const regionSites=()=>context?.sites||[];
 function draw(){
  if(!ctx||(!city&&!context))return;
  ctx.setTransform(dpr,0,0,dpr,0,0);ctx.fillStyle='#183745';ctx.fillRect(0,0,width,height);
  ctx.setTransform(dpr*scale,0,0,dpr*scale,dpr*(width/2-center.x*scale),dpr*(height/2-center.z*scale));
  const visible={x:center.x-width/(2*scale),z:center.z-height/(2*scale),right:center.x+width/(2*scale),bottom:center.z+height/(2*scale)};
  const inView=(p,padding=0)=>p.x>=visible.x-padding&&p.x<=visible.right+padding&&p.z>=visible.z-padding&&p.z<=visible.bottom+padding;
  const intersects=b=>b.x<=visible.right&&b.right>=visible.x&&b.z<=visible.bottom&&b.bottom>=visible.z;
  if(texture){const b=context.bounds;ctx.drawImage(texture,b.x,b.z,b.size,b.size);}
  else if(city)for(const patch of city.terrain?.patches||[]){const high=clamp(patch.height/2600,0,1);ctx.fillStyle=`rgb(${Math.round(128+high*33)},${Math.round(152-high*7)},${Math.round(104+high*25)})`;path(patch.polygon);ctx.fill();}
  ctx.lineCap='round';ctx.lineJoin='round';
  for(const river of context?.rivers||[]){line(river.points);ctx.strokeStyle='#5ba4bd';ctx.lineWidth=Math.max(.65/scale,river.widthKm);ctx.stroke();}
  for(const route of context?.routes||[]){
   const waterway=route.kind==='river'||route.kind==='sea'||route.kind==='ferry';
   line(route.points);ctx.strokeStyle=waterway?'#5d98a6':'#a29e79';ctx.lineWidth=2.4/scale;ctx.stroke();
   ctx.strokeStyle=waterway?'#9ac3c7':'#e0d5ad';ctx.lineWidth=1.2/scale;ctx.stroke();
  }
  const visibleCities=[...cities.values()].filter(c=>intersects({x:c.bounds.x,z:c.bounds.z,right:c.bounds.x+c.bounds.size,bottom:c.bounds.z+c.bounds.size}));
  for(const c of visibleCities){
   if(c.bounds.size*scale<35)continue;
   // Accounting cells share a single filled path. Their internal lattice is
   // never painted as streets, lots or roof patterns.
   for(const kind of ['residential','mixed','downtown','industrial','park']){
    const blocks=c.blocks.filter(b=>b.kind===kind&&inView(b.center,(c.cellKm||.4)*3));
    ctx.beginPath();for(const b of blocks){const p=b.polygon;ctx.moveTo(p[0].x,p[0].z);for(let k=1;k<p.length;k++)ctx.lineTo(p[k].x,p[k].z);ctx.closePath();}
    ctx.fillStyle=({residential:'#b7bea3',mixed:'#b8b5a0',downtown:'#b6b09b',industrial:'#9eafb0',park:'#577b56'})[kind];
    ctx.globalAlpha=kind==='park'?.6:.62;ctx.fill();ctx.globalAlpha=1;
   }
   for(const building of c.buildings||[]){
    if(!inView(building.center,.2))continue;
    const size=Math.sqrt(building.areaKm2||.0002)*scale;if(size<.6)continue;
    const color=building.kind==='industrial'?'#607a80':building.kind==='downtown'?'#78776b':building.kind==='mixed'?'#82897f':'#9b9c88';
    ctx.fillStyle=tint(color,(building.variation||0)*.23);path(building.polygon);ctx.fill();
    if(size>5){ctx.strokeStyle='rgba(42,58,54,.35)';ctx.lineWidth=.6/scale;ctx.stroke();}
   }
  }
  // Draw each road once over its frontages; all roof clearance was checked
  // against the entire network when the geometry was generated.
  for(const kind of ['local','collector','arterial'])for(const c of visibleCities){
   if(c.bounds.size*scale<35||kind==='local'&&scale<7)continue;
   for(const road of c.roads){
    if(road.kind!==kind||road.points.length<2)continue;
    let b=roadBoxes.get(road);if(!b){b={x:Math.min(...road.points.map(p=>p.x)),z:Math.min(...road.points.map(p=>p.z)),right:Math.max(...road.points.map(p=>p.x)),bottom:Math.max(...road.points.map(p=>p.z))};roadBoxes.set(road,b);}if(!intersects(b))continue;
    line(road.points);const px=Math.max(kind==='arterial'?1.8:kind==='collector'?1.05:.45,road.widthKm*scale);
    ctx.strokeStyle=kind==='arterial'?'#7f806f':'#a2aa98';ctx.lineWidth=(px+(scale>12?1.4:.8))/scale;ctx.stroke();
    ctx.strokeStyle=kind==='arterial'?'#d2b69c':kind==='collector'?'#ece9d8':'#e4e7d8';ctx.lineWidth=px/scale;ctx.stroke();
   }
  }
  // Preserve the inherited shoreline and channels, including at street zoom.
  for(const c of visibleCities)for(const kind of ['ocean','lake','river']){
   ctx.beginPath();for(const water of c.terrain?.water||[])if(water.kind===kind){const p=water.polygon;if(!p.length)continue;ctx.moveTo(p[0].x,p[0].z);for(let i=1;i<p.length;i++)ctx.lineTo(p[i].x,p[i].z);ctx.closePath();}
   ctx.fillStyle=kind==='river'?'#5ba4bd':'#22495b';ctx.fill();
  }
  for(const c of visibleCities)for(const road of c.roads)if(road.bridge){
   for(const bridge of (road.bridges||[]).filter(b=>b.kind==='river')){
    const points=bridge.points||road.points.slice(bridge.segmentIndex,bridge.segmentIndex+2);if(points.length!==2)continue;
    line(points);const px=Math.max(1.8,road.widthKm*scale);
    ctx.strokeStyle='#536b69';ctx.lineWidth=(px+2)/scale;ctx.stroke();
    ctx.strokeStyle=road.kind==='arterial'?'#d2b69c':'#ece9d8';ctx.lineWidth=px/scale;ctx.stroke();
   }
  }
  const district=city?.districts.find(d=>d.id===selected);
  if(district){
   ctx.beginPath();for(const edge of district.boundary||[]){ctx.moveTo(edge[0].x,edge[0].z);ctx.lineTo(edge[1].x,edge[1].z);}ctx.strokeStyle='#f0d597';ctx.lineWidth=2/scale;ctx.stroke();
  }
  ctx.setTransform(dpr,0,0,dpr,0,0);
  drawLabels();
  ctx.font='600 11px system-ui, sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#e2e9d6';ctx.fillText('N',width-24,31);ctx.beginPath();ctx.moveTo(width-24,43);ctx.lineTo(width-24,56);ctx.strokeStyle='#e2e9d6';ctx.lineWidth=1.2;ctx.stroke();
 }
 function drawLabels(){
  const taken=[];ctx.textAlign='center';ctx.textBaseline='middle';
  function label(name,p,isSelected=false,small=false){
   if(p.x<25||p.x>width-25||p.y<90||p.y>height-35)return;
   const font=small?10:12;ctx.font=`${small?500:600} ${font}px system-ui, sans-serif`;
   const tw=ctx.measureText(name).width,box={x:p.x-tw/2-6,y:p.y-font/2-4,w:tw+12,h:font+8};
   if(!isSelected&&taken.some(b=>box.x<b.x+b.w+9&&box.x+box.w>b.x-9&&box.y<b.y+b.h+8&&box.y+box.h>b.y-8))return;
   taken.push(box);ctx.fillStyle=isSelected?'rgba(247,227,177,.96)':'rgba(23,47,48,.87)';ctx.beginPath();if(ctx.roundRect)ctx.roundRect(box.x,box.y,box.w,box.h,4);else ctx.rect(box.x,box.y,box.w,box.h);ctx.fill();ctx.fillStyle=isSelected?'#384338':'#e2e6d4';ctx.fillText(name,p.x,p.y);
  }
  if(city&&city.bounds.size*scale>120){
   const districts=[...city.districts].sort((a,b)=>(b.id===selected)-(a.id===selected)||b.population-a.population);let count=0;
   for(const d of districts){if(d.id!==selected&&(count>=(width<600?6:12)||Math.sqrt(d.areaKm2)*scale<45))continue;const before=taken.length;label(d.name,screen(d.center),d.id===selected,d.kind!=='downtown');if(taken.length>before)count++;}
  }
  for(const site of [...regionSites()].sort((a,b)=>b.population-a.population)){
   const p=screen(site.point);if(p.x<-10||p.x>width+10||p.y<-10||p.y>height+10)continue;
   if(cities.has(site.id)&&site.radiusKm*scale>22){if(site.id!==city?.siteId)label(site.name,screen(cities.get(site.id).center));continue;}
   const radius=clamp(1.2+Math.log10(Math.max(1,site.population))*.4,2,4.8);ctx.beginPath();ctx.arc(p.x,p.y,radius,0,Math.PI*2);ctx.fillStyle='#e4ddba';ctx.fill();ctx.strokeStyle='#435b53';ctx.lineWidth=1;ctx.stroke();
   if(taken.length<(width<600?8:18))label(site.name,{x:p.x,y:p.y-12});
  }
 }
 function setViewport(viewport){
  if(!viewport||!(viewport.kmAcross>0)||!Number.isFinite(viewport.center?.x)||!Number.isFinite(viewport.center?.z))return;
  center={...viewport.center};scale=width/viewport.kmAcross;zoom=scale*baseSize()*1.06/Math.min(width,height);changed();
 }
 function addCity(value){
  if(!value)return;
  cities.set(value.siteId,value);requested.delete(value.siteId);
  // Six nearest visible cities plus an explicitly selected place that may
  // now be off screen. Evict by distance, never FIFO against the load order.
  if(cities.size>7){
   const wanted=new Set(detailTargets().map(({s})=>s.id));
   const evict=[...cities.values()].filter(c=>c!==city).sort((a,b)=>Number(wanted.has(a.siteId))-Number(wanted.has(b.siteId))||Math.hypot(b.center.x-center.x,b.center.z-center.z)-Math.hypot(a.center.x-center.x,a.center.z-center.z))[0];
   if(evict)cities.delete(evict.siteId);
  }
  invalidate();requestVisibleDetail();
 }
 function setCity(value){
  const previous=getView(),previousBase=baseSize();city=value;selected=null;
  // Rebase an in-flight pinch when the selected city's zoom units change.
  if(pinch)pinch.zoom*=baseSize()/previousBase;
  addCity(value);setViewport(previous);invalidate();
 }

 function resize(){
  if(destroyed)return;const r=canvas.getBoundingClientRect();width=Math.max(1,r.width||canvas.clientWidth||1);height=Math.max(1,r.height||canvas.clientHeight||1);dpr=Math.min(globalThis.devicePixelRatio||1,width<650?1.5:2,Math.sqrt(3500000/(width*height)));
  canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);updateScale();changed();
 }
 function reset(){if(destroyed)return;if(!city){if(initialViewport)setViewport(initialViewport);return;}zoom=1;center={x:city.bounds.x+city.bounds.size/2,z:city.bounds.z+city.bounds.size/2};updateScale();changed();}
 function zoomAt(factor,p={x:width/2,y:height/2}){
  if((!city&&!context)||destroyed||!Number.isFinite(factor)||factor<=0)return;const anchor=world(p);zoom=clamp(zoom*factor,...zoomLimits());updateScale();center={x:anchor.x-(p.x-width/2)/scale,z:anchor.z-(p.y-height/2)/scale};changed();
 }
 function selectDistrict(id){
  if(!city||destroyed)return;const d=city.districts.find(d=>d.id===id);selected=d?.id??null;
  if(d){const p=screen(d.center);if(p.x<35||p.x>width-35||p.y<45||p.y>height-45){center={...d.center};changed();}}
  invalidate();
 }
 function clearPointers(){for(const id of pointers.keys()){try{canvas.releasePointerCapture(id);}catch{}}pointers.clear();pinch=null;suppressTap=false;}
 function setActive(value){active=!!value;if(!active){clearPointers();if(pending!==null){cancel(pending);pending=null;}}else invalidate();}
 function beginPinch(){const [a,b]=[...pointers.values()];if(!a||!b)return;const midpoint={x:(a.x+b.x)/2,y:(a.y+b.y)/2};pinch={distance:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y)),zoom,anchor:world(midpoint)};suppressTap=true;}
 function pointerDown(e){
  if(!active||destroyed||(!city&&!context)||e.button>0||pointers.size>=2)return;e.preventDefault();const p=local(e);if(!pointers.size)suppressTap=false;pointers.set(e.pointerId,{...p,startX:p.x,startY:p.y});try{canvas.setPointerCapture(e.pointerId);}catch{}if(pointers.size===2)beginPinch();
 }
 function pointerMove(e){
  if(!active||destroyed||!pointers.has(e.pointerId))return;e.preventDefault();const prev=pointers.get(e.pointerId),p=local(e);pointers.set(e.pointerId,{...prev,...p});
  if(pointers.size===2){if(!pinch)beginPinch();const[a,b]=[...pointers.values()],midpoint={x:(a.x+b.x)/2,y:(a.y+b.y)/2},dist=Math.hypot(a.x-b.x,a.y-b.y);zoom=clamp(pinch.zoom*dist/pinch.distance,...zoomLimits());updateScale();center={x:pinch.anchor.x-(midpoint.x-width/2)/scale,z:pinch.anchor.z-(midpoint.y-height/2)/scale};changed();return;}
  if(Math.hypot(p.x-prev.startX,p.y-prev.startY)>5)suppressTap=true;if(suppressTap){center.x-=(p.x-prev.x)/scale;center.z-=(p.y-prev.y)/scale;changed();}
 }
 function pointerEnd(e){
  if(!pointers.has(e.pointerId))return;const p=local(e),start=pointers.get(e.pointerId),tap=active&&!destroyed&&e.type==='pointerup'&&pointers.size===1&&!suppressTap&&Math.hypot(p.x-start.startX,p.y-start.startY)<=5;
  pointers.delete(e.pointerId);try{canvas.releasePointerCapture(e.pointerId);}catch{}if(e.type!=='pointerup')suppressTap=true;pinch=null;
  if(tap){
   const point=world(p),near=regionSites().map(s=>({s,p:screen(s.point)})).filter(v=>Math.hypot(v.p.x-p.x,v.p.y-p.y)<Math.max(12,Math.min(35,v.s.radiusKm*scale))).sort((a,b)=>Math.hypot(a.p.x-p.x,a.p.y-p.y)-Math.hypot(b.p.x-p.x,b.p.y-p.y))[0];
   if(near&&near.s.id!==city?.siteId){onSelectSite(near.s.id);return;}
   for(const c of [city,...cities.values()].filter(Boolean)){const block=c.blocks.find(b=>inside(point,b.polygon));if(!block)continue;if(c!==city){onSelectSite(c.siteId);return;}selected=block.districtId;invalidate();onSelect(selected);break;}
  }
  if(!pointers.size)suppressTap=false;
 }
 function listen(name,fn,options){canvas.addEventListener(name,fn,options);listeners.push([name,fn,options]);}
 listen('pointerdown',pointerDown);listen('pointermove',pointerMove);listen('pointerup',pointerEnd);listen('pointercancel',pointerEnd);listen('lostpointercapture',pointerEnd);
 listen('wheel',e=>{if(!active||destroyed||(!city&&!context))return;e.preventDefault();zoomAt(Math.exp(-e.deltaY*.0015),local(e));},{passive:false});
 listen('dblclick',e=>{if(!active||destroyed||(!city&&!context))return;e.preventDefault();zoomAt(1.8,local(e));});
 listen('contextmenu',e=>{if(active)e.preventDefault();});
 const resizeTarget=globalThis.window||globalThis,onResize=()=>{if(active)resize();};resizeTarget.addEventListener?.('resize',onResize);
 return{
  show(value,options={}){
   if(destroyed)return;clearPointers();cities.clear();requested.clear();city=value;context=options.context||null;texture=ctx&&context?context.texture||contextTexture(context):null;selected=null;active=true;zoom=1;
   if(city)cities.set(city.siteId,city);
   const b=city?.bounds||context?.bounds||{x:0,z:0,size:1};center={x:b.x+b.size/2,z:b.z+b.size/2};initialViewport=options.viewport||null;
   resize();if(initialViewport)setViewport(initialViewport);
  },
  setCity,addCity,setViewport,
  resize,zoomBy:zoomAt,reset,selectDistrict,setActive,getView,
  destroy(){if(destroyed)return;setActive(false);destroyed=true;resizeTarget.removeEventListener?.('resize',onResize);for(const[name,fn,options]of listeners)canvas.removeEventListener(name,fn,options);canvas.style.touchAction=oldTouchAction;city=null;},
 };
}
