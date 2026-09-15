/** Demand-drawn, touch-friendly city map. No continuous animation loop. */
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const inside=(p,poly)=>{let yes=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if((a.z>p.z)!==(b.z>p.z)&&p.x<(b.x-a.x)*(p.z-a.z)/(b.z-a.z)+a.x)yes=!yes;}return yes;};
const rgb=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
const tint=(hex,amount)=>{const c=rgb(hex);return`rgb(${c.map(v=>Math.round(v+(255-v)*amount)).join(',')})`;};
const bilerp=(p,u,v)=>({x:p[0].x*(1-u)*(1-v)+p[1].x*u*(1-v)+p[2].x*u*v+p[3].x*(1-u)*v,z:p[0].z*(1-u)*(1-v)+p[1].z*u*(1-v)+p[2].z*u*v+p[3].z*(1-u)*v});

export function createCityView(canvas,{onSelect=()=>{},onChange=()=>{}}={}){
 const ctx=canvas.getContext('2d',{alpha:false}),pointers=new Map(),listeners=[],oldTouchAction=canvas.style.touchAction;
 const request=globalThis.requestAnimationFrame?.bind(globalThis)||((fn)=>setTimeout(fn,16)),cancel=globalThis.cancelAnimationFrame?.bind(globalThis)||clearTimeout;
 let city=null,width=1,height=1,dpr=1,zoom=1,scale=1,center={x:0,z:0},active=true,destroyed=false,pending=null,selected=null,suppressTap=false,pinch=null;
 canvas.style.touchAction='none';
 const screen=p=>({x:width/2+(p.x-center.x)*scale,y:height/2+(p.z-center.z)*scale});
 const world=p=>({x:center.x+(p.x-width/2)/scale,z:center.z+(p.y-height/2)/scale});
 const local=e=>{const r=canvas.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top};};
 const updateScale=()=>{scale=city?Math.max(1,Math.min(width,height))/(city.bounds.size*1.06)*zoom:1;};
 const getView=()=>({kmAcross:city?width/scale:0,zoom,center:{...center}});
 const notify=()=>onChange(getView());
 const invalidate=()=>{if(!active||destroyed||!ctx||pending!==null)return;pending=request(()=>{pending=null;if(active&&!destroyed)draw();});};
 const constrain=()=>{if(!city)return;const b=city.bounds,margin=b.size*.55;center.x=clamp(center.x,b.x-margin,b.x+b.size+margin);center.z=clamp(center.z,b.z-margin,b.z+b.size+margin);};
 const changed=()=>{constrain();notify();invalidate();};
 const path=polygon=>{ctx.beginPath();if(!polygon.length)return;ctx.moveTo(polygon[0].x,polygon[0].z);for(let i=1;i<polygon.length;i++)ctx.lineTo(polygon[i].x,polygon[i].z);ctx.closePath();};
 const rectangle=(polygon,u,v,du,dv)=>[bilerp(polygon,u,v),bilerp(polygon,u+du,v),bilerp(polygon,u+du,v+dv),bilerp(polygon,u,v+dv)];

 function draw(){
  if(!ctx||!city)return;
  ctx.setTransform(dpr,0,0,dpr,0,0);ctx.fillStyle='#dce0cb';ctx.fillRect(0,0,width,height);
  ctx.setTransform(dpr*scale,0,0,dpr*scale,dpr*(width/2-center.x*scale),dpr*(height/2-center.z*scale));
  const visible={x:center.x-width/(2*scale),z:center.z-height/(2*scale),right:center.x+width/(2*scale),bottom:center.z+height/(2*scale)},inView=(p,padding=0)=>p.x>=visible.x-padding&&p.x<=visible.right+padding&&p.z>=visible.z-padding&&p.z<=visible.bottom+padding;
  for(const patch of city.terrain?.patches||[]){
   const high=clamp(patch.height/2600,0,1),slope=clamp(patch.slope*3,0,1);ctx.fillStyle=`rgb(${Math.round(217+high*10+slope*3)},${Math.round(223-high*12-slope*9)},${Math.round(199-high*4-slope*3)})`;path(patch.polygon);ctx.fill();
  }
  const colors=new Map(city.districts.map(d=>[d.id,d.color||'#c8bda5'])),kinds=new Map(city.districts.map(d=>[d.id,d.kind])),densities=new Map(city.districts.map(d=>[d.id,d.densityPerKm2||1000])),cellPx=(city.cellKm||.13)*scale;
  for(const block of city.blocks){
   if(!inView(block.center,(city.cellKm||.13)*2))continue;
   const kind=kinds.get(block.districtId),base=colors.get(block.districtId),variation=block.variation??.5,park=kind==='park';
   ctx.fillStyle=park?tint('#7ea179',variation*.15):tint(base,.38);path(block.polygon);ctx.fill();
   if(park){
    if(cellPx>9){ctx.fillStyle='rgba(56,107,70,.23)';for(const[u,v,r]of[[.32,.36,.09],[.7,.62,.12],[.27,.73,.065]]){const p=bilerp(block.polygon,u,v);ctx.beginPath();ctx.arc(p.x,p.z,(city.cellKm||.13)*r,0,Math.PI*2);ctx.fill();}}
    continue;
   }
   if(cellPx<4){ctx.fillStyle=tint(base,.02+variation*.24);path(rectangle(block.polygon,.1,.1,.8,.8));ctx.fill();continue;}
   const dense=kind==='downtown'||kind==='mixed',industry=kind==='industrial';
   // Block patches represent urban fabric, with distinct warehouse, dense
   // center and residential grains. They are not cadastral/building records.
   const columns=industry?1:dense?2:2,rows=industry?2:dense?3:2,gap=industry?.065:dense?.045:.085,pad=dense?.12:.16,du=(1-pad*2-gap*(columns-1))/columns,dv=(1-pad*2-gap*(rows-1))/rows;
   for(let row=0;row<rows;row++)for(let col=0;col<columns;col++){
    const shade=(variation+row*.18+col*.31)%1,roof=industry?'#839d9f':dense?'#a08768':densities.get(block.districtId)>4500?'#b29a7f':'#b4a78d';ctx.fillStyle=tint(roof,shade*.36);
    const p=rectangle(block.polygon,pad+col*(du+gap),pad+row*(dv+gap),du*(industry?.98:1),dv);path(p);ctx.fill();
    if(cellPx>25){ctx.strokeStyle='rgba(86,76,62,.24)';ctx.lineWidth=.45/scale;ctx.stroke();}
   }
  }
  ctx.lineCap='round';ctx.lineJoin='round';
  for(const kind of['local','collector','arterial']){
   const roads=city.roads.filter(r=>r.kind===kind);if(kind==='local'&&cellPx<5)continue;
   for(const road of roads){if(road.points.length<2)continue;ctx.beginPath();ctx.moveTo(road.points[0].x,road.points[0].z);for(const p of road.points.slice(1))ctx.lineTo(p.x,p.z);
    const px=Math.max(kind==='arterial'?1.8:kind==='collector'?1.15:.65,road.widthKm*scale);ctx.strokeStyle=kind==='arterial'?'#b9ad95':'#b6b5a6';ctx.lineWidth=(px+1)/scale;ctx.stroke();ctx.strokeStyle=kind==='arterial'?'#f5e4be':'#f7f4e9';ctx.lineWidth=px/scale;ctx.stroke();
   }
  }
  // Water is drawn last among ground features, including the true narrow
  // parent channels, so stroke antialiasing cannot paint over the shoreline.
  for(const kind of['ocean','lake','river']){ctx.beginPath();for(const water of city.terrain?.water||[])if(water.kind===kind){const p=water.polygon;if(!p.length)continue;ctx.moveTo(p[0].x,p[0].z);for(let i=1;i<p.length;i++)ctx.lineTo(p[i].x,p[i].z);ctx.closePath();}ctx.fillStyle=kind==='ocean'?'#a6cdd3':kind==='river'?'#85bcc8':'#a8ced4';ctx.fill();}
  const district=city.districts.find(d=>d.id===selected);
  if(district){
   ctx.fillStyle='rgba(233,167,54,.19)';for(const block of city.blocks)if(block.districtId===district.id){path(block.polygon);ctx.fill();}
   ctx.beginPath();for(const line of district.boundary||[]){ctx.moveTo(line[0].x,line[0].z);ctx.lineTo(line[1].x,line[1].z);}ctx.strokeStyle='#94652c';ctx.lineWidth=2.2/scale;ctx.stroke();
  }
  ctx.setTransform(dpr,0,0,dpr,0,0);
  drawLabels();
  // A quiet north reference remains readable while the map is panned.
  ctx.font='600 11px system-ui, sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#516766';ctx.fillText('N',width-24,31);ctx.beginPath();ctx.moveTo(width-24,43);ctx.lineTo(width-24,56);ctx.strokeStyle='#516766';ctx.lineWidth=1.2;ctx.stroke();
 }
 function drawLabels(){
  const taken=[],maxLabels=width<600?zoom>1.7?9:5:zoom>1.7?16:10,ordered=[...city.districts].sort((a,b)=>(b.id===selected)-(a.id===selected)||b.population-a.population);let count=0;
  ctx.textAlign='center';ctx.textBaseline='middle';
  for(const d of ordered){
   const p=screen(d.center),isSelected=d.id===selected;if(!isSelected&&(count>=maxLabels||Math.sqrt(d.areaKm2)*scale<24))continue;if(p.x<25||p.x>width-25||p.y<35||p.y>height-35)continue;
   const font=isSelected?13:d.kind==='downtown'?12:11;ctx.font=`${isSelected||d.kind==='downtown'?600:500} ${font}px system-ui, sans-serif`;
   const tw=ctx.measureText(d.name).width,box={x:p.x-tw/2-7,y:p.y-font/2-5,w:tw+14,h:font+10};
   if(!isSelected&&taken.some(b=>box.x<b.x+b.w+7&&box.x+box.w>b.x-7&&box.y<b.y+b.h+7&&box.y+box.h>b.y-7))continue;
   taken.push(box);count++;ctx.fillStyle=isSelected?'rgba(255,243,210,.96)':'rgba(250,250,238,.86)';ctx.beginPath();if(ctx.roundRect)ctx.roundRect(box.x,box.y,box.w,box.h,4);else ctx.rect(box.x,box.y,box.w,box.h);ctx.fill();
   if(isSelected){ctx.strokeStyle='#b18842';ctx.lineWidth=1;ctx.stroke();}ctx.fillStyle=d.kind==='park'?'#395b3b':'#3c4946';ctx.fillText(d.name,p.x,p.y);
  }
 }

 function resize(){
  if(destroyed)return;const r=canvas.getBoundingClientRect();width=Math.max(1,r.width||canvas.clientWidth||1);height=Math.max(1,r.height||canvas.clientHeight||1);dpr=Math.min(globalThis.devicePixelRatio||1,width<650?1.5:2,Math.sqrt(3500000/(width*height)));
  canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);updateScale();changed();
 }
 function reset(){if(!city||destroyed)return;zoom=1;center={x:city.bounds.x+city.bounds.size/2,z:city.bounds.z+city.bounds.size/2};updateScale();changed();}
 function zoomAt(factor,p={x:width/2,y:height/2}){
  if(!city||destroyed||!Number.isFinite(factor)||factor<=0)return;const anchor=world(p);zoom=clamp(zoom*factor,.65,20);updateScale();center={x:anchor.x-(p.x-width/2)/scale,z:anchor.z-(p.y-height/2)/scale};changed();
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
  if(!active||destroyed||!city||e.button>0||pointers.size>=2)return;e.preventDefault();const p=local(e);if(!pointers.size)suppressTap=false;pointers.set(e.pointerId,{...p,startX:p.x,startY:p.y});try{canvas.setPointerCapture(e.pointerId);}catch{}if(pointers.size===2)beginPinch();
 }
 function pointerMove(e){
  if(!active||destroyed||!pointers.has(e.pointerId))return;e.preventDefault();const prev=pointers.get(e.pointerId),p=local(e);pointers.set(e.pointerId,{...prev,...p});
  if(pointers.size===2){if(!pinch)beginPinch();const[a,b]=[...pointers.values()],midpoint={x:(a.x+b.x)/2,y:(a.y+b.y)/2},dist=Math.hypot(a.x-b.x,a.y-b.y);zoom=clamp(pinch.zoom*dist/pinch.distance,.65,20);updateScale();center={x:pinch.anchor.x-(midpoint.x-width/2)/scale,z:pinch.anchor.z-(midpoint.y-height/2)/scale};changed();return;}
  if(Math.hypot(p.x-prev.startX,p.y-prev.startY)>5)suppressTap=true;if(suppressTap){center.x-=(p.x-prev.x)/scale;center.z-=(p.y-prev.y)/scale;changed();}
 }
 function pointerEnd(e){
  if(!pointers.has(e.pointerId))return;const p=local(e),start=pointers.get(e.pointerId),tap=active&&!destroyed&&e.type==='pointerup'&&pointers.size===1&&!suppressTap&&Math.hypot(p.x-start.startX,p.y-start.startY)<=5;
  pointers.delete(e.pointerId);try{canvas.releasePointerCapture(e.pointerId);}catch{}if(e.type!=='pointerup')suppressTap=true;pinch=null;
  if(tap){const point=world(p),block=city.blocks.find(b=>inside(point,b.polygon));if(block){selected=block.districtId;invalidate();onSelect(selected);}}
  if(!pointers.size)suppressTap=false;
 }
 function listen(name,fn,options){canvas.addEventListener(name,fn,options);listeners.push([name,fn,options]);}
 listen('pointerdown',pointerDown);listen('pointermove',pointerMove);listen('pointerup',pointerEnd);listen('pointercancel',pointerEnd);listen('lostpointercapture',pointerEnd);
 listen('wheel',e=>{if(!active||destroyed||!city)return;e.preventDefault();zoomAt(Math.exp(-e.deltaY*.0015),local(e));},{passive:false});
 listen('dblclick',e=>{if(!active||destroyed||!city)return;e.preventDefault();zoomAt(1.8,local(e));});
 listen('contextmenu',e=>{if(active)e.preventDefault();});
 const resizeTarget=globalThis.window||globalThis,onResize=()=>{if(active)resize();};resizeTarget.addEventListener?.('resize',onResize);
 return{
  show(value){if(destroyed)return;clearPointers();city=value;selected=null;active=true;zoom=1;center={x:city.bounds.x+city.bounds.size/2,z:city.bounds.z+city.bounds.size/2};resize();},
  resize,zoomBy:zoomAt,reset,selectDistrict,setActive,getView,
  destroy(){if(destroyed)return;setActive(false);destroyed=true;resizeTarget.removeEventListener?.('resize',onResize);for(const[name,fn,options]of listeners)canvas.removeEventListener(name,fn,options);canvas.style.touchAction=oldTouchAction;city=null;},
 };
}
