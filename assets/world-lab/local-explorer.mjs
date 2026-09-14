/** Navigation for the existing Watershed app, not a second generator. */
import {windowAround} from './inherited-window.mjs';
const scales=[120,12,1.2,.41];
const span=km=>km<1?`${Math.round(km*1000)} m`:`${Number(km.toFixed(2)).toLocaleString()} km`;

export function installLocalExplorer(lab){
 const $=id=>document.getElementById(id),host=$('parentMap')?.parentElement;
 if(!host)return null;
 const button=document.createElement('button');button.id='localExploreToggle';button.className='glass';button.textContent='Explore';button.disabled=true;button.setAttribute('aria-expanded','false');button.setAttribute('aria-controls','localExplorer');host.append(button);
 const style=document.createElement('style');style.textContent=`#localExplorer{position:fixed;right:14px;top:68px;width:min(300px,calc(100vw - 28px));max-height:calc(100dvh - 248px);overflow:auto;border-radius:14px;padding:12px;z-index:13}#localExplorer h2{margin:0;font-size:14px}#localExplorer .local-actions{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:8px}#localExplorer label{display:block;font-size:11px;margin:10px 0 5px}#localExplorer p{font-size:11px;line-height:1.5}#localContext{display:block;width:150px;height:150px;margin:8px auto;border:1px solid #aabbaf55;border-radius:6px;cursor:crosshair;touch-action:manipulation}#localExplorer .local-warning{color:#e4cb97}#localExplorer .local-check{display:flex;align-items:center;gap:8px;margin:12px 0}#localExplorer .local-close{font-size:21px;min-width:36px;min-height:36px;background:none;border:0;color:inherit}`;document.head.append(style);
 const panel=document.createElement('section');panel.id='localExplorer';panel.className='glass';panel.hidden=true;panel.setAttribute('aria-label','Explore the same parent world');
 panel.innerHTML=`<div class="panel-head"><h2>Explore this world</h2><button id="localClose" class="local-close" aria-label="Close exploration controls">×</button></div><p class="note">Tap a place on the map, then focus. Terrain, rivers, and all four stages stay part of the same world.</p><label for="localWidth">Window width</label><select id="localWidth"><option value="120">Landscape · 120 km</option><option value="12">Valley · 12 km</option><option value="1.2">Local · 1.2 km</option><option value="0.41">Gameplay focus · 410 m</option></select><label class="local-check"><input id="localDetail" type="checkbox" checked> Refine local terrain</label><button id="localRiverSpot" class="action" style="width:100%">Find a river valley</button><div class="local-actions"><button id="localFocus" class="action primary">Focus here</button><button id="localCloser" class="action">Closer</button><button id="localWider" class="action">Wider</button><button id="localOverview" class="action">Back to overview</button></div><p id="localLocation" class="note" aria-live="polite"></p><canvas id="localContext" width="256" height="256" aria-label="Regional context: tap to reposition the local window"></canvas><p class="note">Regional context · marker shows the selected area.</p><p id="localResolution" class="local-warning"></p><button id="localExport" class="action">Export local terrain</button><p class="note">Local detail adds modeled banks, smaller landforms and dry erosion gullies. Uncheck it to compare with the original parent surface.</p>`;
 document.body.append(panel);
 let context=null,pending=null,riverSpotIndex=0;
 const params=new URLSearchParams(location.search);
 if(['localX','localZ','localKm'].every(k=>params.has(k))){const b={x:Number(params.get('localX')),z:Number(params.get('localZ')),size:Number(params.get('localKm'))};if([b.x,b.z,b.size].every(Number.isFinite)&&b.size>0)pending=b;}
 const available=()=>Boolean(lab.world?.parentDomain&&lab.box);
 const center=()=>lab.view.selectedPoint||{x:lab.box.x+lab.box.size/2,z:lab.box.z+lab.box.size/2};
 function focus(width=Number($('localWidth').value),point=center()){
  if(!available())return;
  lab.setWindow(windowAround(lab.world.config.sizeKm,point.x,point.z,width));
 }
 function close(){panel.hidden=true;button.setAttribute('aria-expanded','false');}
 function drawContext(){
  const canvas=$('localContext'),ctx=canvas.getContext('2d');
  if(!context){canvas.hidden=true;return;}canvas.hidden=false;ctx.clearRect(0,0,256,256);ctx.drawImage(context.canvas,0,0,256,256);
  if(lab.localWindow){const b=lab.box,s=256/context.box.size,x=(b.x-context.box.x)*s,z=(b.z-context.box.z)*s,size=b.size*s,cx=x+size/2,cz=z+size/2;
   ctx.strokeStyle='#ffe0a1';ctx.lineWidth=2;ctx.strokeRect(x,z,Math.max(size,1),Math.max(size,1));ctx.beginPath();ctx.moveTo(cx-5,cz);ctx.lineTo(cx+5,cz);ctx.moveTo(cx,cz-5);ctx.lineTo(cx,cz+5);ctx.stroke();}
 }
 function sync(){
  button.disabled=!available();
  if(!available()){close();context=null;return;}
  if(!lab.localWindow&&lab.view.textureCanvas){const canvas=document.createElement('canvas');canvas.width=canvas.height=256;canvas.getContext('2d').drawImage(lab.view.textureCanvas,0,0,256,256);context={box:{...lab.box},canvas};}
  if(pending){const next=pending;pending=null;lab.setWindow(next);return;}
  const b=lab.box,p=center(),local=Boolean(lab.localWindow);
  if(local){const option=scales.find(s=>Math.abs(s-b.size)<1e-6);if(option)$('localWidth').value=String(option);}
  $('localLocation').textContent=`${span(b.size)} across · parent coordinates ${p.x.toFixed(3)}, ${p.z.toFixed(3)} km`;
  const spacing=lab.world.stepKm??lab.world.mesh.stepKm;
  const detail=lab.localData?.refinement;$('localDetail').checked=lab.detailEnabled;$('localResolution').textContent=Number.isFinite(spacing)?`Source spacing: ${span(spacing)}. ${detail?`Refined sampling: ${detail.spacingM.toFixed(1)} m. Banks and small landforms are synthesized inside the original geography, not measured data.`:b.size>12?'Focus at 12 km or closer to see local detail.':'Original coarse surface: turn refinement on to compare.'}`:'The parent source resolution is unavailable.';
  $('localCloser').disabled=b.size<=.410001;$('localWider').disabled=!local;$('localOverview').disabled=!local;$('localExport').disabled=!local;
  button.textContent=local?`Explore · ${span(b.size)}`:'Explore';drawContext();
 }
 button.onclick=()=>{panel.hidden=!panel.hidden;button.setAttribute('aria-expanded',String(!panel.hidden));if(!panel.hidden){$('menu').hidden=true;$('menuToggle').setAttribute('aria-expanded','false');sync();}};
 $('localClose').onclick=close;$('localFocus').onclick=()=>focus();$('localWidth').onchange=()=>focus();
 $('localCloser').onclick=()=>{const width=scales.find(s=>s<lab.box.size-1e-6);if(width)focus(width);};
 $('localWider').onclick=()=>{const width=[...scales].reverse().find(s=>s>lab.box.size+1e-6);if(width)focus(width,{x:lab.box.x+lab.box.size/2,z:lab.box.z+lab.box.size/2});else lab.setWindow(null);};
 $('localOverview').onclick=()=>lab.setWindow(null);
 $('localDetail').onchange=()=>{lab.setDetail($('localDetail').checked);sync();};
 $('localRiverSpot').onclick=()=>{
  const w=lab.snapshots[4]||lab.world,b=context?.box||lab.box,candidates=[];if(!w?.river)return;
  for(let i=0;i<w.height.length;i++){
   const r=w.receiver[i];if(!w.river[i]||r<0||w.ocean[i]||w.lake?.[i]||w.lake?.[r]||w.height[r]<60)continue;
   const x=(w.mesh.x[i]+w.mesh.x[r])*.5,z=(w.mesh.z[i]+w.mesh.z[r])*.5;
   if(x<b.x||x>b.x+b.size||z<b.z||z>b.z+b.size)continue;
   const grade=(w.height[i]-w.height[r])/Math.hypot(w.mesh.x[i]-w.mesh.x[r],w.mesh.z[i]-w.mesh.z[r])/1000;
   if(grade<=0||grade>.12)continue;
   const score=-Math.abs(Math.log(Math.max(grade,.0001)/.009))+Math.min(w.height[i],1200)/2400;
   candidates.push({x,z,score});
  }
  candidates.sort((a,b)=>b.score-a.score);
  if(!candidates.length){$('localLocation').textContent='No suitable inland reach in this region. Try another regional window.';return;}
  const point=candidates[riverSpotIndex++%candidates.length];lab.showStage(3);lab.setDetail(true);focus(1.2,point);
 };
 $('localContext').onclick=e=>{if(!context||!available())return;const r=e.currentTarget.getBoundingClientRect(),x=context.box.x+(e.clientX-r.left)/r.width*context.box.size,z=context.box.z+(e.clientY-r.top)/r.height*context.box.size;focus(lab.localWindow?lab.box.size:Number($('localWidth').value),{x,z});};
 $('localExport').onclick=()=>{const data=lab.localData;if(!data)return;const blob=new Blob([JSON.stringify(data,(_,v)=>ArrayBuffer.isView(v)?Array.from(v):v)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`watershed-window-${data.source.seed}-${data.window.size}km.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),4000);};
 const onKey=e=>{if(e.key==='Escape')close();};
 document.addEventListener('watershed-window',sync);$('world').addEventListener('watershed-pick',sync);addEventListener('keydown',onKey);sync();
 return {sync,close,destroy(){document.removeEventListener('watershed-window',sync);$('world').removeEventListener('watershed-pick',sync);removeEventListener('keydown',onKey);button.remove();panel.remove();style.remove();}};
}
