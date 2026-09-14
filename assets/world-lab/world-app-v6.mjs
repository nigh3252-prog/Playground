import {createRefinedWindow} from './terrain-refinement.mjs';
import {refinementColors} from './refinement-rendering.mjs';
import {normalizeWindow,createInheritedWindow} from './inherited-window.mjs';
import {installLocalExplorer} from './local-explorer.mjs';
import {BIOMES,HISTORY_TYPES,clamp,noise,drainageTrace,geologySummary} from './world-core.mjs';
import {AtlasView} from './atlas-view.mjs';
import {meshNormals} from './world-view.mjs';
import {rasterizeWindow} from './window-geometry.mjs';
import {chooseWindow} from './parent-world.mjs';
import {generateStagesV6,runSuite} from './benchmark-pipeline.mjs';
import {BENCHMARK_REGIONS,PROTOCOL} from './benchmark-protocol.mjs';
import {terrainMetrics,portableReport} from './benchmark-evaluate.mjs';
import {fromLonLat,toLonLat} from './reference-regions.mjs';
import {WATER_STATES} from './water-balance.mjs';
import {BOUNDARY_COLORS,tectonicColor,tectonicFacts} from './tectonic-debug.mjs';
const $=id=>document.getElementById(id),fmt=(n,d=0)=>n===null||n===undefined||!Number.isFinite(Number(n))?'N/A':Number(n).toLocaleString('en-US',{maximumFractionDigits:d}),pct=v=>v===null||v===undefined?'N/A':fmt(v*100,1)+'%',params=new URLSearchParams(location.search);
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let localWindow=null,inheritedView=null,overviewExag=18;
let detailEnabled=params.get('detail')!=='0';
const localCache=new WeakMap();
function localSurface(w,b){
 if(!detailEnabled||b.size>12)return createInheritedWindow(w,b);
 const key=[b.x,b.z,b.size].join(','),previous=localCache.get(w);
 if(previous?.key===key)return previous.data;
 const data=createRefinedWindow(w,b,{n:b.size<=1.2?193:161});localCache.set(w,{key,data});return data;
}
let world=null,snapshots=[],generation=0,worker=null,suiteWorker=null,selected=-1,stage=clamp(Number(params.get('stage'))||4,1,4),mode=params.get('mode')||'natural',box=null,cropIndex=Number(params.get('crop'))||0,parentView=params.get('parent')==='1',playing=false,timer=0,lastExag=18,reports=[],selectedReport=null;
const view=new AtlasView($('world'),{onPick:inspect,onChange:({yaw})=>{$('compass').style.transform=`rotate(${-yaw}rad)`;}});
if(!view.gl){$('mapView').textContent='2D';$('mapView').disabled=true;}
for(const id of ['seed','continentCount','crustScale','size','resolution','relief','rain','wind','worldSource','climate']){const key={size:'sizeKm',resolution:'n',worldSource:'source'}[id]||id;if(params.has(key)){const el=$(id),value=params.get(key);if(el.tagName==='SELECT'){if([...el.options].some(o=>o.value===value))el.value=value;}else if(Number.isFinite(Number(value)))el.value=value;}}
if([...$('mapMode').options].some(o=>o.value===mode))$('mapMode').value=mode;else mode='natural';
function updateURL(values){try{const u=new URL(location.href);u.searchParams.delete('history');for(const[k,v]of Object.entries(values))u.searchParams.set(k,String(v));history.replaceState(null,'',u);}catch{}}
function busy(text){$('notice').textContent=text;$('notice').hidden=false;}
function fail(error){busy(error?.message||String(error));$('status').textContent='Generation failed; no fake replacement data';stop();}
function settings(){const source=$('worldSource').value;return{source,seed:Number($('seed').value)>>>0,continentCount:Number($('continentCount').value),crustScale:Number($('crustScale').value),sizeKm:Number($('size').value),n:Number($('resolution').value),rain:Number($('rain').value),relief:Number($('relief').value),wind:$('wind').value,climate:$('climate').value};}
function syncControls(){const reference=$('worldSource').value!=='generated';for(const id of ['seed','newSeed','continentCount','crustScale','size','relief'])$(id).disabled=reference;$('newWindow').hidden=reference;$('parentMap').hidden=reference;$('climate').disabled=!reference;
 $('sourceHelp').textContent=reference?'Benchmark mode: raw real elevation; water and population are withheld until scoring. No known lake shapes are imposed.':'A larger parent landmass is solved first. New window changes only what you see—not the parent rivers or basins.';
 for(const id of ['rain','relief'])$(id+'Out').value=Number($(id).value).toFixed(1)+'×';}
function accept(data,token){if(token!==generation)return;if(data.error)return fail(data.error);if(data.progress){$('status').textContent=data.progress;return;}
 snapshots[data.stage]=data.world;
 if(data.stage===1){$('geologyNote').textContent=data.world.parentDomain?geologySummary(data.world):'Unburned real DEM + independent observations';}
 if(data.stage===stage)showStage(stage);
 if(data.stage===4){$('export').disabled=false;document.body.dataset.computeMs=String(Math.round(data.elapsed));const b=data.world.benchmark;if(b?.status==='scored'){addReport(portableReport(b));selectedReport=portableReport(b);renderBenchmarks();}}
}
async function generate(){if(localWindow)setWindow(null);view.selectedPoint=null;stop();const opts=settings(),token=++generation;worker?.terminate();world=null;snapshots=[];selected=-1;$('inspect').hidden=true;$('export').disabled=true;document.body.dataset.ready='false';
 busy(opts.source==='generated'?'Building the parent landmass before choosing a window…':'Loading raw elevation and independent benchmark sources…');$('status').textContent='Terrain → Water → Ecology → Human';syncControls();updateURL({...opts,stage,mode,crop:cropIndex,parent:parentView?1:0,exag:view.exag});
 let fallbackStarted=false;const fallback=async()=>{if(fallbackStarted||token!==generation)return;fallbackStarted=true;worker?.terminate();try{await generateStagesV6(opts,m=>accept(m,token),()=>token!==generation);}catch(e){if(token===generation)fail(e);}};
 try{worker=new Worker(new URL('./world-worker-v6.mjs',import.meta.url),{type:'module'});worker.onmessage=({data})=>accept(data,token);worker.onerror=e=>{e.preventDefault();fallback();};worker.postMessage(opts);}catch{fallback();}
}
function currentBox(){if(localWindow&&world.parentDomain)return normalizeWindow(world.config.sizeKm,localWindow);if(!world.parentDomain||parentView)return{x:0,z:0,size:world.config.sizeKm,index:cropIndex};return chooseWindow(world,cropIndex);}
function applyWindow(reset=false){if(!world)return;box=currentBox();view.setWorld(world,box);inheritedView=localWindow?localSurface(world,box):null;if(inheritedView?.refinement)view.setLocalSurface(inheritedView);if(reset)view.reset();$('parentMap').textContent=parentView?'Window':'Parent';

 const stats=localWindow?{}:terrainMetrics(world,box);$('regionSize').textContent=world.parentDomain?`${fmt(box.size)} km view · ${fmt(world.config.sizeKm)} km parent`:BENCHMARK_REGIONS[world.config.source]?.name||'Real-data benchmark';
 $('scaleNote').textContent=`${fmt(box.size)} km across · r6`;$('terrainStats').innerHTML=`<b>Land ${pct(stats.landFraction)} · water ${pct(1-stats.landFraction)}</b><br>Sampled peak ${fmt(stats.sampledPeakM)} m<br>Middle 90% relief ${fmt(stats.centralReliefM)} m · P95 slope ${fmt(stats.p95SlopePercent,1)}%<br>Physical sample spacing ${fmt(world.stepKm,2)} km · view height ${view.exag}×`;
 $('inputNote').textContent=world.parentDomain?'Whole-parent drainage retained. Crop edges mean the world continues.':'BLIND BENCHMARK: observed water/population are not model inputs.';
 $('resolutionNote').textContent=world.parentDomain?`${world.n}² parent samples across ${fmt(world.config.sizeKm)} km. Changing window does not reroute rivers. Explore adds constrained local landforms at 12 km and below; the parent model remains unchanged.`:`${world.n}² model samples. Scores use the same ${PROTOCOL.evaluationN}² evaluation grid at every detail setting. NOAA station normals are interpolated—not a gridded precipitation model.`;
 if(inheritedView){const m=inheritedView.metrics,label=box.size<1?`${fmt(box.size*1000)} m`:`${fmt(box.size,2)} km`;
  $('regionSize').textContent=`${label} view · same ${fmt(world.config.sizeKm)} km parent`;
  $('scaleNote').textContent=`${label} across · ${inheritedView.refinement?'refined terrain':'inherited terrain'}`;
  $('terrainStats').innerHTML=`<b>Same world · ${label} window</b><br>Inherited elevation ${fmt(m.minElevationM)}–${fmt(m.maxElevationM)} m<br>Relief ${fmt(m.reliefM,1)} m · ${inheritedView.rivers.length} inherited river edges<br>Source spacing ${fmt(world.stepKm,2)} km · height ${view.exag}×`;
  if(inheritedView.refinement){const r=inheritedView.refinement;
   $('terrainStats').innerHTML=`<b>Same world · ${label} · refined</b><br>Relief ${fmt(m.reliefM,1)} m · ${fmt(r.spacingM,1)} m render sampling<br>${r.channelCount} inherited reaches · ${r.gullyCount} dry gullies<br>Base + modeled detail · height ${view.exag}×`;
   $('inputNote').textContent='Parent rivers retained. Modeled banks and erosion detail; not surveyed local terrain.';
  }else $('inputNote').textContent='Original parent surface. Turn on local detail at 12 km or closer to compare.';
  $('resolutionNote').textContent=inheritedView.warnings.join(' ');
 }
 document.body.dataset.localWindow=String(Boolean(localWindow));document.body.dataset.refined=String(Boolean(inheritedView?.refinement));
 paint();if(selected>=0)inspect(selected,false);
 document.dispatchEvent(new CustomEvent('watershed-window'));

}
function showStage(value){stage=clamp(value|0,1,4);document.querySelectorAll('[data-stage]').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.stage)===stage)));$('progress').style.width=`${stage/4*100}%`;updateURL({stage});
 $('stageDescription').textContent=['','Terrain before lakes or people.','Water budget and drainage solved on the complete input domain.','Environments use actual modeled water and the selected climate forcing.','Human potential is predicted first; real observations are scored afterward.'][stage];
 if(!snapshots[stage]){busy('Preparing this generation stage…');return;}const previous=world;world=snapshots[stage];$('notice').hidden=true;applyWindow(!previous||previous.config.source!==world.config.source||previous.config.sizeKm!==world.config.sizeKm);
 $('status').textContent=stage===4?world.benchmark?.status==='scored'?`Benchmark ready · ${world.benchmark.role}`:world.benchmark?.status==='unavailable'?'Map ready; benchmark observations unavailable':`${world.strategicNodes.length} transport opportunities · parent solution`:stage===1?world.parentDomain?'Parent landmass → view window':'Raw measured elevation':`${world.lakeBodies?.length||0} retained / mapped lakes`;
 document.body.dataset.ready='true';document.body.dataset.stage=String(stage);document.body.dataset.source=world.config.source||'generated';}
const rgb=h=>[parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)],blend=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*clamp(t,0,1)),biomes=BIOMES.map(b=>rgb(b[1]));
function ramp(v,colors){const t=clamp(v,0,1)*(colors.length-1),i=Math.min(colors.length-2,Math.floor(t));return blend(colors[i],colors[i+1],t-i);}
const potentialColors=[[48,64,63],[89,108,76],[148,151,79],[214,184,87],[244,213,135]],terrainColors=[[123,149,113],[157,165,124],[160,150,123],[143,145,135],[220,223,211]];
function actualMode(){if(['agreement','observed','population'].includes(mode)&&(!world.benchmark||world.benchmark.status!=='scored'))return'natural';if(['potential','productivity','travel','transport'].includes(mode)&&stage<4)return'natural';if(mode==='water'&&stage<2||mode==='rainfall'&&stage<3)return'natural';return mode;}
function paint(){if(!world||!box)return;const w=world,N=w.height.length,kind=actualMode(),colors=new Uint8ClampedArray(N*4),normal=!view.gl&&!inheritedView?.refinement?meshNormals(w.mesh,Float32Array.from(view.modelHeights,h=>h/1000*view.exag)):null;
 for(let i=0;i<N;i++){let c,alpha=255;
  if(kind==='tectonics')c=tectonicColor(w,i);
  else if(w.ocean[i]){c=[34,73,91];alpha=100;}else if(stage>=2&&w.lake[i]){c=biomes[1];alpha=110;}
  else if(kind==='water')c=rgb(WATER_STATES[w.waterState[i]][1]);
  else if(kind==='history')c=rgb(HISTORY_TYPES[w.landHistory[i]][1]);
  else if(kind==='rainfall')c=ramp((w.rainfall[i]-150)/1500,[[196,163,104],[131,160,125],[52,115,136]]);
  else if(kind==='productivity')c=ramp(w.productivity[i],[[86,73,55],[123,140,78],[165,187,105]]);
  else if(kind==='travel')c=ramp(w.travelFrictionNormalized[i],[[76,133,99],[170,150,81],[159,73,67]]);
  else if(kind==='transport')c=ramp(w.transportAccess[i],[[71,77,63],[69,118,113],[127,188,191]]);
  else if(kind==='potential'||stage===4&&kind==='natural')c=ramp(w.humanPotential[i],potentialColors);
  else if(stage>=3&&kind==='natural')c=biomes[w.biome[i]];else c=ramp(w.height[i]/5000,terrainColors);
  let shade=1;if(alpha===255&&normal){const j=i*3;shade=.69+.38*clamp((-.6*normal[j]+normal[j+1]-.35*normal[j+2])/Math.hypot(.6,1,.35),0,1);}colors.set([c[0]*shade,c[1]*shade,c[2]*shade,alpha],i*4);
 }
 const canvas=document.createElement('canvas');canvas.width=canvas.height=2048;const ctx=canvas.getContext('2d'),base=document.createElement('canvas');base.width=base.height=1024;const pixels=inheritedView?.refinement?rasterizeWindow(inheritedView.mesh,refinementColors(inheritedView,colors,{kind,stage,normals:!view.gl?view.normals:null}),1024,{x:0,z:0,size:box.size}):rasterizeWindow(w.mesh,colors,1024,box);base.getContext('2d').putImageData(new ImageData(pixels,1024,1024),0,0);ctx.drawImage(base,0,0,2048,2048);
 const scale=2048/box.size,xy=(x,z)=>[(x-box.x)*scale,(z-box.z)*scale],node=i=>xy(w.mesh.x[i],w.mesh.z[i]);ctx.lineCap='round';ctx.lineJoin='round';
 const line=points=>{ctx.beginPath();points.forEach(([x,z],i)=>i?ctx.lineTo(x,z):ctx.moveTo(x,z));ctx.stroke();};
 if(kind==='tectonics'&&w.geology?.tectonics){
  const tectonics=w.geology.tectonics;
  for(const boundary of tectonics.boundaries){ctx.strokeStyle=BOUNDARY_COLORS[boundary.kind];ctx.lineWidth=boundary.kind==='subduction'||boundary.kind==='collision'?6:4;line(boundary.points.map(({x,z})=>xy(x,z)));}
  ctx.strokeStyle='#f2f0d4';ctx.fillStyle='#f2f0d4';ctx.lineWidth=3;
  for(const plate of tectonics.plates){const start=xy(plate.centerX,plate.centerZ),end=xy(plate.centerX+plate.velocityX*620,plate.centerZ+plate.velocityZ*620);line([start,end]);const angle=Math.atan2(end[1]-start[1],end[0]-start[0]);ctx.beginPath();ctx.moveTo(end[0],end[1]);ctx.lineTo(end[0]-13*Math.cos(angle-.5),end[1]-13*Math.sin(angle-.5));ctx.lineTo(end[0]-13*Math.cos(angle+.5),end[1]-13*Math.sin(angle+.5));ctx.closePath();ctx.fill();}
 }
 if(['agreement','observed'].includes(kind)&&w.benchmark?.overlay){const o=w.benchmark.overlay,grid=document.createElement('canvas');grid.width=grid.height=o.n;const im=grid.getContext('2d').createImageData(o.n,o.n),palette=[[50,65,72],[101,190,179],[232,158,82],[180,136,210],[123,133,104]];
  for(let i=0;i<o.n*o.n;i++){const c=kind==='agreement'?palette[o.agreement[i]]:o.valid[i]?(o.observed[i]?[83,160,188]:[146,153,119]):[50,65,72];im.data.set([...c,255],i*4);}grid.getContext('2d').putImageData(im,0,0);ctx.imageSmoothingEnabled=false;ctx.drawImage(grid,0,0,2048,2048);ctx.imageSmoothingEnabled=true;
 }
 if(stage>=2&&$('showRivers').checked){ctx.strokeStyle='#5ba4bd';if(inheritedView){for(const e of inheritedView.rivers){if(inheritedView.channels?.some(c=>c.from===e.from&&c.to===e.to))continue;ctx.lineWidth=(inheritedView.refinement?.channelCount||0)>0 ? .6 : 1.1+Math.min(3.8,Math.sqrt((e.upstreamAreaKm2||0)/50000));line(e.points.map(([x,z])=>xy(x,z)));}}else for(let i=0;i<N;i++)if(w.river[i]){const r=w.receiver[i];if(r<0||w.lake[i]&&w.lake[r])continue;ctx.lineWidth=1.1+Math.min(3.8,Math.sqrt(w.area[i]/50000));line([node(i),node(r)]);}}
 if(stage===4&&$('showNavigable').checked){ctx.strokeStyle='#d2dfb8';ctx.lineWidth=3;for(let i=0;i<N;i++)if(w.navigableRiver[i]&&w.receiver[i]>=0)line([node(i),node(w.receiver[i])]);}
 if(stage===4&&$('showStrategic').checked){for(const p of w.strategicNodes){const[x,z]=node(p.id);ctx.fillStyle='#19353d';ctx.strokeStyle='#d9c891';ctx.lineWidth=2;ctx.beginPath();ctx.arc(x,z,5,0,Math.PI*2);ctx.fill();ctx.stroke();}}
 const observed=snapshots[4]?.observations;if(observed&&$('showReference').checked&&!w.parentDomain){ctx.strokeStyle='#dfa5c1';ctx.lineWidth=1.4;ctx.setLineDash([5,6]);for(const r of observed.rivers)for(const p of r.paths)line(p.map(([x,z])=>xy(x,z)));ctx.setLineDash([]);}
 if(w.reference&&$('showLabels').checked){ctx.font='bold 20px system-ui';for(const[name,lat,lon]of BENCHMARK_REGIONS[w.config.source].landmarks){const[x,z]=xy(...fromLonLat(BENCHMARK_REGIONS[w.config.source],lon,lat));ctx.fillStyle='#edf2dc';ctx.strokeStyle='#19333b';ctx.lineWidth=4;ctx.strokeText(name,x+7,z-6);ctx.fillText(name,x+7,z-6);ctx.beginPath();ctx.arc(x,z,3,0,Math.PI*2);ctx.fill();}}
 if(observed&&(kind==='population'||$('showPopulation').checked)){const points=$('populationYear').value==='1850'?observed.historical:observed.population;for(const p of points){const[x,z]=xy(p.xKm,p.zKm);ctx.fillStyle=$('populationYear').value==='1850'?'#f0c687bb':'#dccbeb66';ctx.beginPath();ctx.arc(x,z,Math.min(16,1+Math.sqrt(p.population)/60),0,Math.PI*2);ctx.fill();}}
 if(parentView&&!localWindow&&w.parentDomain){const selectedBox=chooseWindow(w,cropIndex),[x,z]=xy(selectedBox.x,selectedBox.z);ctx.strokeStyle='#ffe0a1';ctx.lineWidth=5;ctx.strokeRect(x,z,selectedBox.size*scale,selectedBox.size*scale);}
 if(selected>=0){if(stage>=2){ctx.strokeStyle='#ffdfa0';ctx.lineWidth=3.5;line(drainageTrace(w,selected).map(node));}const[x,z]=view.selectedPoint?xy(view.selectedPoint.x,view.selectedPoint.z):node(selected);ctx.strokeStyle='#fff1cc';ctx.lineWidth=3;ctx.beginPath();ctx.arc(x,z,9,0,Math.PI*2);ctx.stroke();}
 ctx.strokeStyle='#bdd5cf';ctx.fillStyle='#bdd5cf';ctx.lineWidth=2;line([[205,1972],[205,1980],[546,1980],[546,1972]]);ctx.font='22px system-ui';ctx.fillText(box.size<6?`${fmt(box.size/6*1000)} m`:`${fmt(box.size/6,1)} km`,205,1963);
 view.setTexture(canvas);renderLegend(kind);
}
function renderLegend(kind){let rows=[],title='';if(kind==='agreement'){title='Predicted versus mapped water';rows=[['Correct predicted water','#65beb3'],['Model-only water','#e89e52'],['Missed mapped water','#b488d2'],['Dry agreement','#7b8568'],['Excluded / unknown','#324148']];}
 else if(kind==='observed'){title='Held-out natural-lake water';rows=[['Mapped water','#53a0bc'],['Evaluated dry land','#929977'],['Excluded / unknown','#324148']];}
 else if(kind==='water'){title='Modeled basin states';rows=WATER_STATES;}
 else if(kind==='population'){title=$('populationYear').value==='1850'?'1850 large-city SAMPLE':'2020 tract-point population';rows=[['Count-sized points—not settlements','#dccbeb']];}
 else if(kind==='tectonics'){title='Tectonic cause';rows=Object.entries(BOUNDARY_COLORS).map(([label,color])=>[label[0].toUpperCase()+label.slice(1),color]);}
 else if(stage===3&&kind==='natural'){title='Environments';rows=BIOMES;}
 else{title=kind==='elevation'?'Elevation':kind==='history'?'Geological family':kind==='natural'&&stage<3?'Landform':kind.replaceAll('-',' ')||'Map';rows=kind==='history'?HISTORY_TYPES:[['Low','#455448'],['High','#e8ce86']];}
 $('legend').innerHTML='<h2>'+escape(title)+'</h2>'+rows.map(r=>`<div class="swatch-row"><i style="background:${r[1]}"></i><span>${escape(r[0])}</span></div>`).join('')+(kind==='agreement'||kind==='observed'?'<p class="note">Natural water bodies ≥25 km². Reservoirs, seasonal water, cropped boundary systems, non-US coverage and map edges are excluded. This is not a complete census of small lakes.</p>':'');
}
function inspect(id,repaint=true){if(!world||id<0||id>=world.height.length)return;selected=id;const w=world,b=stage>=2?w.basinWater?.[w.potentialBasinId?.[id]]:null,facts=[['Elevation',fmt(w.height[id])+' m'],['Physical spacing',fmt(w.stepKm,2)+' km']];
 if(w.reference){const[lon,lat]=toLonLat(BENCHMARK_REGIONS[w.config.source],w.mesh.x[id],w.mesh.z[id]);facts.push(['Longitude / latitude',fmt(lon,3)+' / '+fmt(lat,3)]);}else facts.push(['Parent coordinates',fmt(w.mesh.x[id])+' / '+fmt(w.mesh.z[id])+' km']);
 if(stage>=2)facts.push(['Full upstream area',fmt(w.area[id])+' km²']);if(b)facts.push(['Basin state',b.status],['Spill / actual level',fmt(b.spillM)+' / '+fmt(b.level)+' m']);
 if(stage>=3)facts.push(['Precipitation',fmt(w.rainfall[id])+' mm/y'],['Temperature',fmt(w.temperature[id],1)+' °C']);if(stage===4)facts.push(['Human potential',fmt(w.humanPotential[id]*100)+' / 100'],['Food potential',fmt(w.productivity[id]*100)+' / 100']);if(w.parentDomain)facts.push(...tectonicFacts(w,id));
 $('inspect').hidden=false;$('legend').hidden=true;$('inspectTitle').textContent=w.ocean[id]?'Ocean':b?'Water-basin diagnosis':'Physical sample';$('inspectFacts').innerHTML=facts.map(([k,v])=>`<div><small>${escape(k)}</small><b>${escape(v)}</b></div>`).join('');
 $('inspectNote').textContent=w.parentDomain?'This is a parent-world sample. Its contributing area and drainage continue outside the visible window; the gold trace is not rerouted at the edge.':`Blind real-terrain prediction. Climate: ${w.climateForcing?.kind||'not computed yet'}. Water/population targets do not enter this prediction.`;if(repaint)paint();}
function stop(){playing=false;clearTimeout(timer);$('play').textContent='▶ Watch build';}
function watch(){if(playing){stop();return;}playing=true;$('play').textContent='Ⅱ Pause';let s=1;const advance=()=>{if(!playing)return;if(!snapshots[s]){timer=setTimeout(advance,150);return;}showStage(s);if(s===4){stop();return;}s++;timer=setTimeout(advance,1900);};advance();}
function setVisualScale(value,persist=true){const v=clamp(Number(value)||1,1,30);if(v>1)lastExag=v;view.setExaggeration(v);$('trueScale').setAttribute('aria-pressed',String(v===1));$('exaggerate').checked=v>1;$('exaggeration').disabled=v===1;$('exaggeration').value=lastExag;$('exaggerationOut').value=v===1?'Off · 1×':v+'×';$('viewNote').textContent=v===1?'True height · 1×':`Relief ×${v} · physical heights unchanged`;document.body.dataset.verticalScale=String(v);if(persist){try{localStorage.setItem('watershed-relief',v);localStorage.setItem('watershed-last-relief',lastExag);}catch{}updateURL({exag:v});}if(world){applyWindow(false);}}
function addReport(report){const key=r=>[r.region,r.settings?.n,r.profileFingerprint,r.sourceDigest].join(':');reports=reports.filter(r=>key(r)!==key(report));reports.push(report);try{localStorage.setItem('watershed-benchmark-reports',JSON.stringify(reports.slice(-30)));}catch{}}
function metric(label,value){return`<div class="metric"><small>${escape(label)}</small><strong>${escape(value)}</strong></div>`;}
function renderBenchmarks(){const r=selectedReport;let html='';if(r?.status==='scored'){
 html+=`<h3>${escape(r.regionName)} <small>${escape(r.role)} · ${r.settings.n}²</small></h3><div class="metrics">`+metric('Water precision',pct(r.water.precision))+metric('Water recall',pct(r.water.recall))+metric('Lake-area bias',fmt(r.water.areaBiasPercent,1)+'%')+metric('Predicted / observed water',fmt(r.water.predictedKm2)+' / '+fmt(r.water.observedKm2)+' km²')+metric('Extra / missed water',fmt(r.water.falsePositiveKm2)+' / '+fmt(r.water.falseNegativeKm2)+' km²')+metric('Excluded area',fmt(r.water.excludedKm2)+' km²')+metric('River alignment (model → real)',pct(r.rivers.predictedToObserved.withinTolerance))+metric('River coverage (real → model)',pct(r.rivers.observedToPredicted.withinTolerance))+metric('Model / real river length',fmt(r.rivers.predictedToObserved.lengthKm)+' / '+fmt(r.rivers.observedToPredicted.lengthKm)+' km')+metric('Sampled peak',fmt(r.terrain.sampledPeakM)+' m')+metric('2020 population in top 20% land',pct(r.population.captures[1]?.populationShare))+metric('1850 SAMPLE in top 20% land',pct(r.historical.captures[1]?.populationShare))+metric('2020 tract density rank correlation',fmt(r.population.rankCorrelation,3))+metric('1850 sample locations',fmt(r.historical.sampleCount))+'</div>';
 html+=`<p class="note">2020: ${fmt(r.population.matchedCount)} / ${fmt(r.population.sampleCount)} tract internal points scored (${pct(r.population.coverage)} of represented population). Counts are located at representative points, not individual homes. The 1850 sample includes only matched members of the 100 largest urban places; it is not all historical population.</p>`;
 html+=`<details><summary>Lake sizes and measurement details</summary><div class="table-scroll"><table><tr><th>Area km²</th><th>Predicted count</th><th>Observed count</th></tr>${r.lakeSizes.predicted.map((b,i)=>`<tr><td>${b.minKm2}–${b.maxKm2??'∞'}</td><td>${b.count}</td><td>${r.lakeSizes.observed[i].count}</td></tr>`).join('')}</table></div><p class="note">Connected components on the fixed ${PROTOCOL.evaluationN}² grid. Main scoring begins at ${PROTOCOL.minimumLakeKm2} km²; smaller bodies are diagnostic. Source peak smoothing: ${escape(r.terrain.peakCaution)}</p><p class="note">${r.limitations.map(escape).join('<br><br>')}</p></details>`;
 html+=`<p class="note">Climate: ${escape(r.climateForcing.kind)}. Frozen profile ${escape(r.profile)}. Source snapshot ${escape(r.sourceDigest.slice(0,12))}. No automatic fitting; a displayed holdout is not proof of successful validation.</p>`;
 }else html='<p class="note">Open a real region and reach Human, or run the suite. Missing data and empty historical samples appear as N/A—not invented scores.</p>';
 $('benchmarkDetail').innerHTML=html;
 $('benchmarkRows').innerHTML=reports.map((v,i)=>`<tr><td><button class="text-btn" data-report="${i}">${escape(v.regionName||v.region)}</button><small>${escape(v.role||'')} · ${v.settings?.n||'?'}²</small></td><td>${pct(v.water?.precision)}</td><td>${pct(v.water?.recall)}</td><td>${fmt(v.water?.areaBiasPercent,1)}%</td><td>${pct(v.rivers?.predictedToObserved.withinTolerance)}</td><td>${pct(v.historical?.captures?.[1]?.populationShare)}</td></tr>`).join('');
 document.querySelectorAll('[data-report]').forEach(b=>b.onclick=()=>{selectedReport=reports[Number(b.dataset.report)];renderBenchmarks();});
}
function startSuite(sweep=false){if(suiteWorker){suiteWorker.terminate();suiteWorker=null;$('suiteStatus').textContent='Cancelled; completed rows retained';$('runSuite').textContent='Run all 4 regions';return;}
 const id=$('worldSource').value;if(sweep&&!BENCHMARK_REGIONS[id]){toast('Choose a real reference region for a resolution sweep');return;}
 const opts={job:'suite',n:129,region:sweep?id:null,sweep};$('suiteStatus').textContent='Loading baseline datasets…';$('runSuite').textContent='Cancel run';
 const receive=data=>{if(data.error){$('suiteStatus').textContent=data.error;suiteWorker?.terminate();suiteWorker=null;$('runSuite').textContent='Run all 4 regions';}if(data.progress)$('suiteStatus').textContent=data.progress;if(data.report){addReport(data.report);selectedReport=data.report;renderBenchmarks();}if(data.suiteComplete){$('suiteStatus').textContent='Completed with one fixed parameter profile; no fitting performed';suiteWorker?.terminate();suiteWorker=null;$('runSuite').textContent='Run all 4 regions';}};
 try{suiteWorker=new Worker(new URL('./world-worker-v6.mjs',import.meta.url),{type:'module'});suiteWorker.onmessage=({data})=>receive(data);suiteWorker.onerror=e=>{e.preventDefault();receive({error:'Benchmark worker unavailable. Use the build-time report or a hosted browser with workers.'});};suiteWorker.postMessage(opts);}catch(e){receive({error:e.message});}}
function saveJSON(name,payload){const blob=new Blob([JSON.stringify(payload,(_,v)=>ArrayBuffer.isView(v)?Array.from(v):v)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),4000);}
function toast(text){$('toast').textContent=text;$('toast').hidden=false;setTimeout(()=>$('toast').hidden=true,2200);}
$('menuToggle').onclick=()=>{$('menu').hidden=!$('menu').hidden;$('menuToggle').setAttribute('aria-expanded',String(!$('menu').hidden));};$('legendToggle').onclick=()=>{$('legend').hidden=!$('legend').hidden;$('legendToggle').setAttribute('aria-expanded',String(!$('legend').hidden));$('inspect').hidden=true;};$('closeInspect').onclick=()=>{selected=-1;$('inspect').hidden=true;paint();};
$('worldSource').onchange=()=>{syncControls();stage=1;generate();};$('regenerate').onclick=generate;$('newSeed').onclick=()=>{$('seed').value=crypto.getRandomValues(new Uint32Array(1))[0];cropIndex=0;generate();};
$('newWindow').onclick=()=>{setWindow(null);view.selectedPoint=null;cropIndex++;parentView=false;selected=-1;$('inspect').hidden=true;updateURL({crop:cropIndex,parent:0});applyWindow(true);};$('parentMap').onclick=()=>{setWindow(null);view.selectedPoint=null;parentView=!parentView;updateURL({parent:parentView?1:0});applyWindow(true);};
$('mapView').onclick=()=>{view.toggleMap();$('mapView').textContent=view.map?'3D':'Map';};$('reset').onclick=()=>view.reset();$('play').onclick=watch;document.querySelectorAll('[data-stage]').forEach(b=>b.onclick=()=>{stop();showStage(Number(b.dataset.stage));});
$('mapMode').onchange=()=>{mode=$('mapMode').value;updateURL({mode});if(['agreement','observed','population'].includes(mode))showStage(4);else paint();};for(const id of ['showRivers','showNavigable','showStrategic','showReference','showLabels','showPopulation','populationYear'])$(id).onchange=paint;
for(const id of ['rain','relief'])$(id).oninput=syncControls;$('trueScale').onclick=()=>setVisualScale(view.exag===1?lastExag:1);$('exaggerate').onchange=()=>setVisualScale($('exaggerate').checked?lastExag:1);$('exaggeration').oninput=()=>setVisualScale($('exaggeration').value);
$('openBenchmarks').onclick=()=>{$('benchmarks').hidden=false;$('menu').hidden=true;selectedReport=world?.benchmark?.status==='scored'?portableReport(world.benchmark):selectedReport;renderBenchmarks();};$('closeBenchmarks').onclick=()=>{$('benchmarks').hidden=true;};$('runSuite').onclick=()=>startSuite(false);$('runSweep').onclick=()=>startSuite(true);$('saveReports').onclick=()=>saveJSON('watershed-benchmark-results.json',{protocol:PROTOCOL,reports});
$('copyLink').onclick=async()=>{try{await navigator.clipboard.writeText(location.href);toast('View link copied');}catch{toast('Copy the address bar to share this view');}};
$('export').onclick=()=>{const w=snapshots[4];if(!w)return;saveJSON('watershed-r6-geography.json',{version:w.version,config:w.config,parentDomain:w.parentDomain||null,viewWindow:box,mesh:w.mesh,height:w.height,receiver:w.receiver,upstreamArea:w.area,lake:w.lake,waterSurface:w.waterSurface,basinBudgets:w.basinWater,runoff:w.runoff,humanPotential:w.humanPotential,benchmark:w.benchmark?portableReport(w.benchmark):null,note:'Full physical parent graph retained; the viewWindow does not alter it.'});};
addEventListener('keydown',e=>{if(e.key==='Escape'){$('benchmarks').hidden=true;$('menu').hidden=true;}});
addEventListener('unhandledrejection',e=>fail(e.reason));document.addEventListener('world-view-error',e=>fail(e.detail));
function setDetail(enabled){
 detailEnabled=Boolean(enabled);updateURL({detail:detailEnabled?1:0});if(world&&localWindow)applyWindow(false);
 document.dispatchEvent(new CustomEvent('watershed-window'));
}
function setWindow(next){
 if(!world?.parentDomain)return false;
 const entering=Boolean(next&&!localWindow),leaving=Boolean(!next&&localWindow);
 if(entering)overviewExag=view.exag;
 localWindow=next?normalizeWindow(world.config.sizeKm,next):null;
 inheritedView=null;selected=-1;$('inspect').hidden=true;
 view.selectedPoint=localWindow?{x:localWindow.x+localWindow.size/2,z:localWindow.z+localWindow.size/2}:null;
 if(entering||leaving)setVisualScale(entering?1:overviewExag,false);
 const u=new URL(location.href);for(const k of ['localX','localZ','localKm'])u.searchParams.delete(k);
 if(localWindow){u.searchParams.set('localX',String(localWindow.x));u.searchParams.set('localZ',String(localWindow.z));u.searchParams.set('localKm',String(localWindow.size));}
 u.searchParams.set('exag',String(view.exag));history.replaceState(null,'',u);
 applyWindow(true);return true;
}
window.__regionalWorldLab={get detailEnabled(){return detailEnabled;},setDetail,get localWindow(){return localWindow;},get localData(){return inheritedView;},setWindow,get world(){return world;},get snapshots(){return snapshots;},get stage(){return stage;},get generation(){return generation;},get box(){return box;},get reports(){return reports;},view,generate,showStage,inspect,watch,stop,setVisualScale,chooseWindow:()=>{setWindow(null);cropIndex++;applyWindow(true);}};
installLocalExplorer(window.__regionalWorldLab);
let initial=18;try{const saved=Number(localStorage.getItem('watershed-relief'));if(saved>=1&&saved<=30)initial=saved;const previous=JSON.parse(localStorage.getItem('watershed-benchmark-reports')||'[]');reports=previous.filter(r=>r.schema===PROTOCOL.version).slice(-30);}catch{}if(params.has('exag'))initial=clamp(Number(params.get('exag'))||1,1,30);setVisualScale(initial,false);syncControls();generate();
fetch(new URL('./benchmarks/baseline-reports.json',import.meta.url)).then(r=>r.ok?r.json():null).then(data=>{if(data?.reports){for(const r of data.reports)if(!reports.some(p=>p.region===r.region&&p.settings?.n===r.settings?.n&&p.sourceDigest===r.sourceDigest))reports.push(r);renderBenchmarks();}}).catch(()=>{});
