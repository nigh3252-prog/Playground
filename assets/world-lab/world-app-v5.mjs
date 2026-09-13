import {BIOMES,HISTORY_TYPES,clamp,noise,summary,geologySummary,drainageTrace,normalizeConfig} from './world-core.mjs';
import {humanSummary,STRATEGIC_TYPES} from './human-geography.mjs';
import {rasterizeColors} from './world-mesh.mjs';
import {WorldView} from './world-view.mjs';
import {generateStages,exportBenchmarkWorld} from './world-pipeline.mjs';
import {REFERENCES,REFERENCE_SOURCES} from './reference-regions.mjs';
import {geographicLocation} from './reference-terrain.mjs';
import {WATER_STATES} from './water-balance.mjs';
const $=id=>document.getElementById(id),fmt=(v,d=0)=>Number(v).toLocaleString('en-US',{maximumFractionDigits:d}),params=new URLSearchParams(location.search);
let snapshots=[],world=null,stage=clamp(Number(params.get('stage'))||4,1,4)|0,mode='natural',selected=-1,worker=null,run=0,playing=false,timer=0,pendingStage=stage,lastExag=18;
const descriptions=['','Original terrain: generated geology or real geographic elevation data.','Rainfall, runoff, evaporation and leakage decide which basins retain water.','Environments follow the resolved water and modeled climate.','Food surplus and bulk transport reveal pre-settlement potential—not cities.'];
const view=new WorldView($('world'),{onPick:inspect,onChange:({yaw})=>{$('compass').style.transform=`rotate(${-yaw}rad)`;}});
if(!view.gl){$('mapView').textContent='2D';$('mapView').disabled=true;}
for(const [key,id] of [['seed','seed'],['n','resolution'],['sizeKm','size'],['relief','relief'],['rain','rain'],['wind','wind'],['source','worldSource'],['mode','mapMode']])if(params.has(key)){
 const el=$(id),value=params.get(key);if(el.tagName==='SELECT'){if([...el.options].some(o=>o.value===value))el.value=value;}else if(Number.isFinite(Number(value)))el.value=value;
}
mode=$('mapMode').value;
function updateURL(values){try{const url=new URL(location.href);url.searchParams.delete('history');for(const[k,v]of Object.entries(values))url.searchParams.set(k,String(v));history.replaceState(null,'',url);}catch{}}
function setBusy(text){$('notice').hidden=false;$('notice').textContent=text;}
function error(text){setBusy(text);$('status').textContent='Unable to complete this generation';stop();}
function updateOutputs(){for(const key of ['relief','rain'])$(key+'Out').value=Number($(key).value).toFixed(1)+'×';}
function syncSourceUI(){
 const ref=REFERENCES[$('worldSource').value];for(const id of ['seed','newSeed','size','relief'])$(id).disabled=!!ref;
 $('sourceHelp').textContent=ref?ref.description:'Seed-driven terrain and geological histories. No geography preset is required.';
 $('regenerate').textContent=ref?'Load reference':'Generate';$('showReference').disabled=!ref;
 $('sourceCredits').hidden=!ref;
}
function config(){const source=$('worldSource').value,ref=REFERENCES[source];return{...normalizeConfig({seed:ref?1:Number($('seed').value),n:Number($('resolution').value),sizeKm:ref?ref.sizeKm:Number($('size').value),relief:ref?1:Number($('relief').value),rain:Number($('rain').value),wind:$('wind').value}),source};}
function accept(data,token){
 if(token!==run)return;if(data.error){error(data.error);return;}
 try{snapshots[data.stage]=data.world;
  if(data.stage===1){const ref=data.world.reference;$('geologyNote').textContent=ref?ref.region.name:geologySummary(data.world);$('geologyDetail').textContent=ref?'Real elevation + mapped water. No synthetic mountains or volcano shapes are added.':`${data.world.features.length} geological features selected by the seed.`;
   $('inputNote').textContent=ref?'REAL INPUTS: elevation + mapped lakes. MODELED: rivers, climate, ecology and human potential. Reference labels do not influence scores.':'GENERATED WORLD · annual water-budget heuristic';}
  if(data.stage===pendingStage)showStage(pendingStage);
  if(data.stage===4){$('export').disabled=false;document.body.dataset.computeMs=String(Math.round(data.elapsed));}
 }catch(e){error(e.message);}
}
async function generate(){
 stop();let c;try{c=config();}catch(e){error(e.message);return;}
 const token=++run;worker?.terminate();world=null;snapshots=[];selected=-1;$('inspect').hidden=true;$('export').disabled=true;pendingStage=stage;document.body.dataset.ready='false';
 $('regionSize').textContent=REFERENCES[c.source]?REFERENCES[c.source].name:`${fmt(c.sizeKm)} × ${fmt(c.sizeKm)} km`;
 $('scaleNote').textContent=`${fmt(c.sizeKm)} km across · r5`;$('resolutionNote').textContent=`${fmt(c.n*c.n)} mesh samples; ${fmt(c.sizeKm/(c.n-1),2)} km nominal spacing. This is regional context, not street detail.`;
 $('geologyNote').textContent='Preparing input…';$('geologyDetail').textContent='';$('status').textContent='Terrain → water budget → ecology → human';
 setBusy(c.source==='generated'?'Shaping the land…':'Loading the compact real-data reference pack…');updateURL({...c,stage,mode,exag:view.exag});
 let fallbackStarted=false;const fallback=async()=>{if(fallbackStarted||token!==run)return;fallbackStarted=true;worker?.terminate();try{await generateStages(c,m=>accept(m,token),()=>token!==run);}catch(e){if(token===run)error(e.message);}};
 try{worker=new Worker(new URL('./world-worker-v5.mjs',import.meta.url),{type:'module'});worker.onmessage=({data})=>accept(data,token);worker.onerror=e=>{e.preventDefault();fallback();};worker.postMessage(c);}catch{fallback();}
}
const rgb=h=>[parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)],colors=BIOMES.map(b=>rgb(b[1])),historyColors=HISTORY_TYPES.map(b=>rgb(b[1]));
const blend=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*clamp(t,0,1));
function ramp(v,stops){const t=clamp(v,0,1)*(stops.length-1),i=Math.min(stops.length-2,Math.floor(t));return blend(stops[i],stops[i+1],t-i);}
const ramps={potential:[[58,69,67],[91,102,76],[140,137,78],[188,163,85],[224,196,103]],productivity:[[87,72,57],[117,100,66],[136,139,76],[113,155,83],[176,184,102]],travel:[[86,137,101],[127,145,91],[168,139,83],[174,107,76],[142,75,70]],transport:[[90,75,61],[89,106,86],[75,126,119],[64,139,156],[109,170,174]]};
const basinPalette=['#92a986','#c4a280','#809caa','#b8b884','#928dae','#bba79b','#8bb4ab','#b797a4','#a7b7c7','#d0b77a','#829583','#9bacc3'];
function reliefColor(h){return ramp(clamp(h/4200,0,1),[[123,149,113],[157,165,124],[160,150,123],[143,145,135],[220,223,211]]);}
function actualMode(){if(mode==='basins'&&stage<2||mode==='water'&&stage<2||mode==='rainfall'&&stage<3||Object.hasOwn(ramps,mode)&&stage<4)return'natural';return mode;}
function paint(){
 if(!world)return;const w=world,N=w.height.length,kind=actualMode(),nodeColors=new Uint8ClampedArray(N*4),top=new Map((w.outlets||[]).slice(0,12).map((o,i)=>[o.id,rgb(basinPalette[i])])),selectedBasin=selected>=0?w.basin?.[selected]:-1;
 for(let i=0;i<N;i++){const h=w.height[i];let c,alpha=255;
  if(w.ocean[i]){c=blend([61,109,124],[30,61,77],clamp(-h/1900,0,1));alpha=100;}
  else if(w.observedLake?.[i]||stage>=2&&w.lake[i]){c=colors[1];alpha=110;}
  else if(kind==='water')c=rgb(WATER_STATES[w.waterState[i]][1]);
  else if(kind==='basins')c=top.get(w.basin[i])||[128,146,121];
  else if(kind==='rainfall')c=w.rainfall[i]>900?blend([129,163,133],[53,109,132],(w.rainfall[i]-900)/1100):blend([197,166,107],[129,163,133],(w.rainfall[i]-120)/780);
  else if(kind==='history')c=historyColors[w.landHistory[i]];
  else if(kind==='productivity')c=ramp(w.productivity[i],ramps.productivity);
  else if(kind==='travel')c=ramp(w.travelFrictionNormalized[i],ramps.travel);
  else if(kind==='transport')c=ramp(w.transportAccess[i],ramps.transport);
  else if(kind==='potential'||kind==='natural'&&stage===4)c=ramp(w.humanPotential[i],ramps.potential);
  else if(kind==='natural'&&stage===3)c=colors[w.biome[i]];else c=reliefColor(h);
  let shade=1;if(alpha===255){shade=.98+.03*noise(w.mesh.x[i]/w.stepKm*.8,w.mesh.z[i]/w.stepKm*.8,w.config.seed+818);if(kind==='elevation'&&Math.abs(h/250-Math.round(h/250))<.025)shade*=.84;}
  if(!view.gl&&alpha===255){const j=i*3,light=clamp((-.6*view.normals[j]+view.normals[j+1]-.35*view.normals[j+2])/Math.hypot(.6,1,.35),0,1);shade*=.69+.38*light;}
  if(selectedBasin>=0&&stage>=2&&!w.ocean[i]&&!w.lake[i]&&w.basin[i]!==selectedBasin)shade*=.70;
  nodeColors.set([c[0]*shade,c[1]*shade,c[2]*shade,alpha],i*4);
 }
 const base=document.createElement('canvas');base.width=base.height=1024;base.getContext('2d').putImageData(new ImageData(rasterizeColors(w.mesh,nodeColors,1024),1024,1024),0,0);
 const canvas=document.createElement('canvas');canvas.width=canvas.height=2048;const ctx=canvas.getContext('2d');ctx.drawImage(base,0,0,2048,2048);
 const scale=2048/w.config.sizeKm,xy=i=>[w.mesh.x[i]*scale,w.mesh.z[i]*scale];ctx.lineJoin='round';ctx.lineCap='round';
 function line(points){ctx.beginPath();points.forEach(([x,z],k)=>k?ctx.lineTo(x,z):ctx.moveTo(x,z));ctx.stroke();}
 if($('showMesh').checked){ctx.strokeStyle='#e2efc526';ctx.lineWidth=.65;const t=w.mesh.triangles;ctx.beginPath();for(let k=0;k<t.length;k+=3){[t[k],t[k+1],t[k+2],t[k]].forEach((id,j)=>{const[x,z]=xy(id);j?ctx.lineTo(x,z):ctx.moveTo(x,z);});}ctx.stroke();}
 if(stage>=2&&$('showRivers').checked){ctx.strokeStyle='#5ba4bd';for(let i=0;i<N;i++)if(w.river[i]){const r=w.receiver[i];if(r<0||w.lake[i]&&w.lake[r])continue;ctx.lineWidth=1.05+Math.min(4.7,Math.sqrt(w.area[i]/w.config.sizeKm**2)*11);line([xy(i),xy(r)]);}}
 if(stage===4&&$('showNavigable').checked){ctx.strokeStyle='#d2dfb8';ctx.lineWidth=3.2;for(let i=0;i<N;i++)if(w.navigableRiver[i]&&w.receiver[i]>=0)line([xy(i),xy(w.receiver[i])]);}
 if(stage===4&&$('showStrategic').checked){for(const node of w.strategicNodes){const[x,z]=xy(node.id);ctx.fillStyle='#13292d';ctx.strokeStyle=STRATEGIC_TYPES[node.type]?.[1]||'#d7b86a';ctx.lineWidth=2.3;ctx.beginPath();ctx.arc(x,z,5.8,0,Math.PI*2);ctx.fill();ctx.stroke();}}
 if(w.reference&&$('showReference').checked){
  ctx.strokeStyle='#e7a3b7';ctx.lineWidth=1.5;ctx.setLineDash([6,5]);for(const river of w.referenceRivers)line(river.points.map(([x,z])=>[x*scale,z*scale]));ctx.setLineDash([]);
  ctx.strokeStyle='#bbd4e4aa';ctx.lineWidth=1;for(const lake of w.referenceLakes)for(const rings of lake.polygons)for(const ring of rings)line(ring.map(([x,z])=>[x*scale,z*scale]));
  ctx.font='bold 22px system-ui';for(const p of w.landmarks){const x=p.xKm*scale,z=p.zKm*scale;ctx.fillStyle=p.type==='volcano'?'#ffbc91':'#edf2dc';ctx.strokeStyle='#18333b';ctx.lineWidth=4;ctx.beginPath();ctx.arc(x,z,p.type==='volcano'?5:3,0,Math.PI*2);ctx.fill();ctx.strokeText(p.name,x+9,z-7);ctx.fillText(p.name,x+9,z-7);}
 }
 if(selected>=0){if(stage>=2){ctx.strokeStyle='#ffdfa0';ctx.lineWidth=3.8;line(drainageTrace(w,selected).map(xy));}const[x,z]=xy(selected);ctx.strokeStyle='#fff4ce';ctx.lineWidth=3;ctx.beginPath();ctx.arc(x,z,10,0,Math.PI*2);ctx.stroke();}
 ctx.strokeStyle='#bdd5cf';ctx.fillStyle='#bdd5cf';ctx.lineWidth=2;line([[205,1972],[205,1980],[205+2048/6,1980],[205+2048/6,1972]]);ctx.font='22px system-ui';ctx.fillText(`${fmt(w.config.sizeKm/6)} km`,205,1963);
 view.setTexture(canvas);updateLegend();
}
function showStage(value){
 stage=clamp(value|0,1,4);pendingStage=stage;document.querySelectorAll('[data-stage]').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.stage)===stage)));$('progress').style.width=`${stage/4*100}%`;$('stageDescription').textContent=descriptions[stage];updateURL({stage});
 if(!snapshots[stage]){setBusy('Preparing this stage…');return;}world=snapshots[stage];$('notice').hidden=true;
 const heights=Float32Array.from(world.height,(h,i)=>world.ocean[i]?0:stage>=2?world.waterSurface[i]:h);view.setSurface(world.mesh,heights);
 const key=world.config.source||'generated';if(view.lastRegion!==key||view.lastSize!==world.config.sizeKm){view.reset();view.lastRegion=key;view.lastSize=world.config.sizeKm;}
 $('showNavigable').disabled=stage<4;$('showStrategic').disabled=stage<4;paint();if(selected>=0)inspect(selected,false);
 if(stage===1)$('status').textContent=world.reference?'Real terrain · mapped water input':`${world.features.length} seeded landforms`;
 else if(stage===4){const h=humanSummary(world);$('status').textContent=`${h.strategicNodes} opportunities · ${fmt(h.navigableRiverKm)} km modeled navigation`;}
 else{const dry=world.basinWater.filter(b=>b?.status==='dry').length,seasonal=world.basinWater.filter(b=>b?.status==='seasonal').length;$('status').textContent=`${world.lakeBodies.length} lakes · ${dry} dry / ${seasonal} seasonal basins`;}
 document.body.dataset.ready='true';document.body.dataset.stage=String(stage);document.body.dataset.modelVersion=world.version;document.body.dataset.source=key;
}
function updateLegend(){
 if(!world)return;const kind=actualMode();let rows=[],title='';
 if(kind==='water'){rows=WATER_STATES.map(([a,b])=>[a,b,'']);title='Actual surface-water states';}
 else if(kind==='basins'){rows=world.outlets.slice(0,8).map((o,i)=>[o.name,basinPalette[i],fmt(o.areaKm2)+' km²']);title='Resolved catchments';}
 else if(kind==='rainfall'){rows=[['Dry','#c5a66b','~120 mm/y'],['Moderate','#81a385','~900'],['Wet','#356d84','2,000+']];title='Modeled rainfall';}
 else if(kind==='history'){rows=HISTORY_TYPES.map(([a,b])=>[a,b,'']);title=world.reference?'Leakage-family proxies (not geology data)':'Generated landform history';}
 else if(Object.hasOwn(ramps,kind)||kind==='natural'&&stage===4){const k=kind==='natural'?'potential':kind;title={potential:'Human potential',productivity:'Food-surplus potential',travel:'Overland difficulty',transport:'Bulk-transport access'}[k];rows=ramps[k].map((c,i)=>[i===0?'Low':i===4?'High':'',`rgb(${c.join(',')})`,'']);}
 else if(stage===3&&kind==='natural'){title='Modeled environments';rows=BIOMES.map((b,i)=>[...b,fmt(world.biomeAreas[i]/world.config.sizeKm**2*100,1)+'%']).filter((b,i)=>world.biomeAreas[i]>0);}
 else{title='Elevation';rows=[['Lowland','#7b9571','0–500 m'],['Upland','#9da57c','500–1,300'],['Mountains','#a0967b','1,300–3,000'],['High terrain','#dcdfd3','3,000+']];}
 if(world.reference&&$('showReference').checked)rows.push(['Reference rivers (dashed)','#e7a3b7','not model'],['Blue rivers','#5ba4bd','modeled']);
 $('legend').innerHTML='<h2>'+title+'</h2>'+rows.map(r=>`<div class="swatch-row"><i style="background:${r[1]}"></i><span>${r[0]}</span><small>${r[2]}</small></div>`).join('');
}
function inspect(index,repaint=true){
 if(!world||index<0||index>=world.height.length)return;selected=index;const w=world,loc=geographicLocation(w,index),known=w.observedLake?.[index],b=stage>=2?w.basinWater[w.potentialBasinId[index]]:null;
 const lake=known?w.referenceLakes.find(l=>l.id===w.observedLakeId[index]):null;
 $('inspect').hidden=false;$('legend').hidden=true;$('legendToggle').setAttribute('aria-expanded','false');$('inspectTitle').textContent=lake?lake.name+' · mapped':b?({dry:'Dry / leaky basin',seasonal:'Seasonally wet basin',retained:'Retained lake',overflowing:'Overflowing lake'}[b.status]):w.ocean[index]?'Ocean':stage===4?'Human geography':'Selected terrain';
 const facts=[[known?'Mapped surface':'Terrain elevation',fmt(w.height[index])+' m']];
 if(loc)facts.push(['Longitude / latitude',fmt(loc[0],3)+' / '+fmt(loc[1],3)]);else facts.push(['Landform',HISTORY_TYPES[w.landHistory[index]][0]]);
 if(stage>=2&&!w.ocean[index])facts.push(['Upstream land',fmt(w.area[index])+' km²']);
 if(b){facts.push(['Actual water level',b.status==='dry'?'No standing water':fmt(b.level)+' m'],['Spill threshold',fmt(b.spillM)+' m'],['Annual supply',fmt(b.supplyM3Year/1e6,2)+' million m³'],['Evaporation + leakage',fmt((b.evaporationM3Year+b.seepageM3Year)/1e6,2)+' million m³'],['Surface outflow',fmt(b.outflowM3Year/1e6,2)+' million m³/y']);}
 if(stage>=3&&!w.ocean[index])facts.push(['Modeled precipitation',fmt(w.rainfall[index])+' mm/y'],['Modeled temperature',fmt(w.temperature[index],1)+' °C']);
 if(stage===4&&!w.ocean[index]&&!w.lake[index])facts.push(['Food surplus',fmt(w.productivity[index]*100)+' / 100'],['Human potential',fmt(w.humanPotential[index]*100)+' / 100'],['Market access',fmt(w.marketAccess[index]*100)+' / 100'],['Transport access',fmt(w.transportAccess[index]*100)+' / 100'],['Land friction',fmt(w.travelFriction[index],1)+'×']);
 $('inspectFacts').innerHTML=facts.map(([a,v])=>`<div><small>${a}</small><b>${v}</b></div>`).join('');
 const outlet=stage>=2?w.outlets.find(o=>o.id===w.basin[index]):null;
 $('inspectNote').textContent=lake?`${lake.levelSource}. Preserved reference water, not predicted by our water balance; no bathymetry is supplied.`:b?'Annual plausibility estimate, not measured groundwater. A closed basin stops surface drainage; leaked water is not sent down a phantom river.':outlet?`Gold follows surface drainage to ${outlet.kind==='inland'?'a closed inland sink':outlet.kind==='reference-lake'?'a mapped freshwater boundary':outlet.kind==='sea'?'the sea':'the edge of this crop'}.`:w.reference?'Real geographic input; downstream ecology and human scores remain illustrative.':'Use Water to inspect the resolved drainage.';
 if(repaint)paint();
}
function stop(){playing=false;clearTimeout(timer);$('play').textContent='▶ Watch build';}
function watch(){if(playing){stop();return;}playing=true;$('play').textContent='Ⅱ Pause build';let next=1;const step=()=>{if(!playing)return;if(!snapshots[next]){timer=setTimeout(step,150);return;}showStage(next);if(next===4){stop();return;}next++;timer=setTimeout(step,2100);};step();}
function setVisualScale(value,persist=true){const v=clamp(Number(value)||1,1,30);if(v>1)lastExag=v;view.setExaggeration(v);$('trueScale').setAttribute('aria-pressed',String(v===1));$('exaggerate').checked=v>1;$('exaggeration').disabled=v===1;$('exaggeration').value=lastExag;$('exaggerationOut').value=v===1?'Off · 1×':v+'×';$('viewNote').textContent=(v===1?'True height · 1×':'Relief ×'+v)+' · water widths symbolic';document.body.dataset.verticalScale=String(v);if(persist){try{localStorage.setItem('watershed-relief',String(v));localStorage.setItem('watershed-last-relief',String(lastExag));}catch{}updateURL({exag:v});}if(!view.gl&&world)paint();}
function toast(text){$('toast').textContent=text;$('toast').hidden=false;setTimeout(()=>$('toast').hidden=true,2500);}
$('menuToggle').onclick=()=>{const closed=!$('menu').hidden;$('menu').hidden=closed;$('menuToggle').setAttribute('aria-expanded',String(!closed));};
$('legendToggle').onclick=()=>{const closed=!$('legend').hidden;$('legend').hidden=closed;$('legendToggle').setAttribute('aria-expanded',String(!closed));if(!closed)$('inspect').hidden=true;};
$('worldSource').onchange=()=>{syncSourceUI();stage=1;generate();};$('mapView').onclick=()=>{view.toggleMap();$('mapView').textContent=view.map?'3D':'Map';};
$('reset').onclick=()=>view.reset();$('regenerate').onclick=generate;$('newSeed').onclick=()=>{$('seed').value=crypto.getRandomValues(new Uint32Array(1))[0];generate();};$('play').onclick=watch;
for(const b of document.querySelectorAll('[data-stage]'))b.onclick=()=>{stop();showStage(Number(b.dataset.stage));};
$('mapMode').onchange=()=>{mode=$('mapMode').value;updateURL({mode});paint();};for(const id of ['showReference','showMesh','showRivers','showNavigable','showStrategic'])$(id).onchange=paint;
for(const id of ['relief','rain'])$(id).oninput=updateOutputs;
$('trueScale').onclick=()=>setVisualScale(view.exag===1?lastExag:1);$('exaggerate').onchange=()=>setVisualScale($('exaggerate').checked?lastExag:1);$('exaggeration').oninput=()=>setVisualScale(Number($('exaggeration').value));
$('closeInspect').onclick=()=>{selected=-1;$('inspect').hidden=true;paint();};
$('copyLink').onclick=async()=>{try{updateURL({stage,mode,source:$('worldSource').value,exag:view.exag});await navigator.clipboard.writeText(location.href);toast('Region / seed link copied');}catch{toast('Copy the address bar to share this view');}};
$('export').onclick=()=>{if(!snapshots[4])return;const payload=exportBenchmarkWorld(snapshots[3],snapshots[4]),blob=new Blob([JSON.stringify(payload,(_,v)=>ArrayBuffer.isView(v)?Array.from(v):v)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`watershed-r5-${world.config.source||world.config.seed}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);};
addEventListener('unhandledrejection',e=>error(e.reason?.message||String(e.reason)));document.addEventListener('world-view-error',e=>error(e.detail));
window.__regionalWorldLab={get world(){return world;},get snapshots(){return snapshots;},get stage(){return stage;},get selected(){return selected;},get generation(){return run;},view,generate,showStage,inspect,watch,stop,setVisualScale};
let initial=18;try{const saved=Number(localStorage.getItem('watershed-relief')),last=Number(localStorage.getItem('watershed-last-relief'));if(saved>=1&&saved<=30)initial=saved;if(last>=2&&last<=30)lastExag=last;}catch{}
if(params.has('exag'))initial=clamp(Number(params.get('exag'))||1,1,30);setVisualScale(initial,false);syncSourceUI();updateOutputs();generate();
