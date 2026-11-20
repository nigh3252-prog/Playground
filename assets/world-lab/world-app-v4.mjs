import {BIOMES,HISTORY_TYPES,clamp,noise,summary,geologySummary,drainageTrace,generateTerrain,generateHydrology,generateEcology,normalizeConfig,exportWorld} from './world-core.mjs';
import {generateHumanGeography,humanSummary,STRATEGIC_TYPES} from './human-geography.mjs';
import {rasterizeColors} from './world-mesh.mjs';
import {WorldView} from './world-view.mjs';

const $=id=>document.getElementById(id);
const fmt=(v,d=0)=>Number(v).toLocaleString('en-US',{maximumFractionDigits:d});
const params=new URLSearchParams(location.search);
let snapshots=[],world=null,stage=4,mode='natural',selected=-1,worker=null,run=0,playing=false,timer=0,pendingStage=4,first=true,lastExag=18;
const descriptions=['','Original landforms, including seed-selected geological provinces.','Water follows the physical mesh into rivers, basins and spill-level lakes.','Rain, altitude and drainage shape the environments.','Food surplus, bulk-transport cost and strategic geography reveal where settlement would be attractive.'];

function error(message){$('notice').hidden=false;$('notice').textContent=message;$('status').textContent='Generation interrupted';stop();}
const view=new WorldView($('world'),{onPick:inspect,onChange:({yaw})=>{$('compass').style.transform=`rotate(${-yaw}rad)`;}});
if(!view.gl){$('mapView').textContent='2D';$('mapView').disabled=true;}

const configFields=[['seed','seed'],['sizeKm','size'],['n','resolution'],['relief','relief'],['rain','rain'],['wind','wind']];
for(const [key,id] of configFields)if(params.has(key)){
  const el=$(id),v=params.get(key);if(el.tagName==='SELECT'){if([...el.options].some(o=>o.value===v))el.value=v;}else if(Number.isFinite(Number(v)))el.value=v;
}
if(params.has('stage'))stage=clamp(Number(params.get('stage'))||4,1,4)|0;
if([...$('mapMode').options].some(o=>o.value===params.get('mode'))){mode=params.get('mode');$('mapMode').value=mode;}

function config(){return normalizeConfig({seed:Number($('seed').value),n:Number($('resolution').value),sizeKm:Number($('size').value),relief:Number($('relief').value),rain:Number($('rain').value),wind:$('wind').value});}
function updateOutputs(){for(const key of ['relief','rain'])$(key+'Out').value=Number($(key).value).toFixed(1)+'×';}
function updateURL(values){try{const url=new URL(location.href);url.searchParams.delete('history');for(const [k,v] of Object.entries(values))url.searchParams.set(k,String(v));history.replaceState(null,'',url);}catch{}}
function setBusy(text){$('notice').hidden=false;$('notice').textContent=text;}
function accept(data,token){
  if(token!==run)return;if(data.error){error(data.error);return;}
  try{
    snapshots[data.stage]=data.world;
    if(data.stage===1){$('geologyNote').textContent=geologySummary(data.world);$('geologyDetail').textContent=`${data.world.features.length} regional landform features were selected by seed ${data.world.config.seed}.`;}
    if(data.stage===pendingStage)showStage(pendingStage);
    if(data.stage===4){$('export').disabled=false;document.body.dataset.computeMs=String(Math.round(data.elapsed));}
  }catch(e){error(e.message);}
}
async function generate(){
  stop();let c;try{c=config();}catch(e){error(e.message);return;}
  const token=++run;document.body.dataset.ready='false';worker?.terminate();snapshots=[];selected=-1;$('inspect').hidden=true;$('export').disabled=true;pendingStage=stage;
  $('geologyNote').textContent='Seed is choosing geological provinces…';$('geologyDetail').textContent='Glacial, rift, volcanic and old-river processes can overlap.';
  $('regionSize').textContent=`${fmt(c.sizeKm)} × ${fmt(c.sizeKm)} km`;$('resolutionNote').textContent=`${fmt(c.n*c.n)} irregular mesh sites; about ${(c.sizeKm/(c.n-1)).toFixed(2)} km nominal spacing.`;$('scaleNote').textContent=`${fmt(c.sizeKm)} km across · r4`;
  $('status').textContent='Landforms → water → ecology → human potential';setBusy('Shaping the land, then testing how people could use it…');updateURL({...c,stage,exag:view.exag,mode});
  let fallbackStarted=false;const startFallback=()=>{if(fallbackStarted||token!==run)return;fallbackStarted=true;worker?.terminate();fallback(c,token);};
  try{worker=new Worker(new URL('./world-worker.mjs',import.meta.url),{type:'module'});worker.onmessage=({data})=>accept(data,token);worker.onerror=e=>{e.preventDefault();startFallback();};worker.postMessage(c);}catch{startFallback();}
}
async function fallback(c,token){
  const yieldFrame=()=>new Promise(r=>setTimeout(r,16)),start=performance.now();
  try{
    await yieldFrame();if(token!==run)return;let w=generateTerrain(c);accept({stage:1,world:w,elapsed:performance.now()-start},token);
    await yieldFrame();if(token!==run)return;w=generateHydrology(w);accept({stage:2,world:w,elapsed:performance.now()-start},token);
    await yieldFrame();if(token!==run)return;w=generateEcology(w);accept({stage:3,world:w,elapsed:performance.now()-start},token);
    await yieldFrame();if(token!==run)return;w=generateHumanGeography(w);accept({stage:4,world:w,elapsed:performance.now()-start},token);
  }catch(e){if(token===run)error(e.message);}
}

const rgb=hex=>[parseInt(hex.slice(1,3),16),parseInt(hex.slice(3,5),16),parseInt(hex.slice(5,7),16)];
const colors=BIOMES.map(b=>rgb(b[1])),historyColors=HISTORY_TYPES.map(b=>rgb(b[1]));
const blend=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*clamp(t,0,1));
function reliefColor(h){const stops=[[0,[132,145,113]],[500,[162,165,128]],[1300,[154,148,117]],[2500,[129,132,126]],[3600,[197,201,184]],[4800,[236,236,218]]];for(let k=1;k<stops.length;k++)if(h<stops[k][0])return blend(stops[k-1][1],stops[k][1],(h-stops[k-1][0])/(stops[k][0]-stops[k-1][0]));return stops.at(-1)[1];}
function ramp(v,stops){v=clamp(v,0,1);const p=v*(stops.length-1),i=Math.min(stops.length-2,Math.floor(p));return blend(stops[i],stops[i+1],p-i);}
const basinPalette=['#92a986','#c4a280','#809caa','#b8b884','#928dae','#bba79b','#8bb4ab','#b797a4','#a7b7c7','#d0b77a','#829583','#9bacc3'];
const potentialRamp=[[58,69,67],[91,102,76],[140,137,78],[188,163,85],[224,196,103]];
const foodRamp=[[87,72,57],[117,100,66],[136,139,76],[113,155,83],[176,184,102]];
const difficultyRamp=[[86,137,101],[127,145,91],[168,139,83],[174,107,76],[142,75,70]];
const accessRamp=[[90,75,61],[89,106,86],[75,126,119],[64,139,156],[109,170,174]];
function actualMode(){if(mode==='basins'&&stage<2||mode==='rainfall'&&stage<3||['productivity','travel','transport','potential'].includes(mode)&&stage<4)return'natural';return mode;}

function paint(){
  if(!world)return;const w=world,N=w.height.length,kind=actualMode(),nodeColors=new Uint8ClampedArray(N*4);
  const top=new Map((w.outlets||[]).slice(0,12).map((o,i)=>[o.id,rgb(basinPalette[i])])),selectedBasin=selected>=0?w.basin?.[selected]:-1;
  for(let i=0;i<N;i++){
    const h=w.height[i];let c,alpha=255;
    if(w.ocean[i]){c=blend([61,109,124],[30,61,77],clamp(-h/1900,0,1));alpha=100;}
    else if(stage>=2&&w.lake[i]){c=colors[1];alpha=110;}
    else if(kind==='basins')c=top.get(w.basin[i])||[128,146,121];
    else if(kind==='rainfall')c=w.rainfall[i]>900?blend([129,163,133],[53,109,132],(w.rainfall[i]-900)/1100):blend([197,166,107],[129,163,133],(w.rainfall[i]-120)/780);
    else if(kind==='history')c=historyColors[w.landHistory[i]];
    else if(kind==='productivity')c=ramp(w.productivity[i],foodRamp);
    else if(kind==='travel')c=ramp(w.travelFrictionNormalized[i],difficultyRamp);
    else if(kind==='transport')c=ramp(w.transportAccess[i],accessRamp);
    else if(kind==='potential'||stage===4&&kind==='natural')c=ramp(w.humanPotential[i],potentialRamp);
    else if(stage===3&&kind==='natural')c=colors[w.biome[i]];else c=reliefColor(h);
    let shade=1;if(alpha===255){shade=.97+.055*noise(w.mesh.x[i]/w.stepKm*.8,w.mesh.z[i]/w.stepKm*.8,w.config.seed+818);if(kind==='elevation'&&Math.abs(h/250-Math.round(h/250))<.025)shade*=.84;}
    if(!view.gl&&alpha===255){const j=i*3,lit=clamp((-.6*view.normals[j]+view.normals[j+1]-.35*view.normals[j+2])/Math.hypot(.6,1,.35),0,1);shade*=.69+.38*lit;}
    if(selectedBasin>=0&&stage>=2&&!w.ocean[i]&&w.basin[i]!==selectedBasin)shade*=.70;
    const k=i*4;nodeColors[k]=c[0]*shade;nodeColors[k+1]=c[1]*shade;nodeColors[k+2]=c[2]*shade;nodeColors[k+3]=alpha;
  }
  const base=document.createElement('canvas');base.width=base.height=1024;const bx=base.getContext('2d');bx.putImageData(new ImageData(rasterizeColors(w.mesh,nodeColors,1024),1024,1024),0,0);
  const canvas=document.createElement('canvas');canvas.width=canvas.height=2048;const ctx=canvas.getContext('2d');ctx.drawImage(base,0,0,2048,2048);const scale=2048/w.config.sizeKm,xy=i=>[w.mesh.x[i]*scale,w.mesh.z[i]*scale];
  if($('showMesh').checked){ctx.strokeStyle='#e2efc526';ctx.lineWidth=.65;ctx.beginPath();const t=w.mesh.triangles;for(let k=0;k<t.length;k+=3){for(let j=0;j<3;j++){const[x,z]=xy(t[k+j]);j?ctx.lineTo(x,z):ctx.moveTo(x,z);}ctx.closePath();}ctx.stroke();}
  if(stage>=2&&$('showRivers').checked){const cells=[];for(let i=0;i<N;i++)if(w.river[i])cells.push(i);cells.sort((a,b)=>w.area[a]-w.area[b]);ctx.lineCap='round';ctx.lineJoin='round';for(const i of cells){const r=w.receiver[i];if(r<0||w.lake[i]&&w.lake[r])continue;const[x,z]=xy(i),[rx,rz]=xy(r);ctx.strokeStyle=kind==='basins'?'#2c627b':'#5ba4bd';ctx.lineWidth=1.05+Math.min(4.7,Math.sqrt(w.area[i]/w.config.sizeKm**2)*11);ctx.beginPath();ctx.moveTo(x,z);ctx.lineTo(rx,rz);ctx.stroke();}}
  if(stage>=4&&$('showNavigable').checked){ctx.lineCap='round';for(let i=0;i<N;i++)if(w.navigableRiver[i]){const r=w.receiver[i];if(r<0)continue;const[x,z]=xy(i),[rx,rz]=xy(r);ctx.strokeStyle='#d2dfb8';ctx.lineWidth=3.2;ctx.beginPath();ctx.moveTo(x,z);ctx.lineTo(rx,rz);ctx.stroke();}}
  if(stage>=4&&$('showStrategic').checked){for(const node of w.strategicNodes){const[x,z]=xy(node.id),color=STRATEGIC_TYPES[node.type]?.[1]||'#d7b86a';ctx.fillStyle='#13292d';ctx.strokeStyle=color;ctx.lineWidth=2.3;ctx.beginPath();ctx.arc(x,z,5.8,0,Math.PI*2);ctx.fill();ctx.stroke();}}
  if(selected>=0){const path=drainageTrace(w,selected);if(stage>=2&&path.length){ctx.strokeStyle='#ffdfa0';ctx.lineWidth=3.8;ctx.beginPath();path.forEach((id,k)=>{const[x,z]=xy(id);k?ctx.lineTo(x,z):ctx.moveTo(x,z);});ctx.stroke();}const[x,z]=xy(selected);ctx.strokeStyle='#fff4ce';ctx.lineWidth=3;ctx.beginPath();ctx.arc(x,z,10,0,Math.PI*2);ctx.stroke();}
  const y=1980,x=205,len=2048/6;ctx.strokeStyle='#bdd5cf';ctx.fillStyle='#bdd5cf';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(x,y-8);ctx.lineTo(x,y);ctx.lineTo(x+len,y);ctx.lineTo(x+len,y-8);ctx.stroke();ctx.font='22px system-ui';ctx.fillText(`${fmt(w.config.sizeKm/6)} km`,x,y-17);
  view.setTexture(canvas);updateLegend();
}

function showStage(value){
  stage=clamp(value|0,1,4);pendingStage=stage;document.querySelectorAll('[data-stage]').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.stage)===stage)));$('progress').style.width=`${stage/4*100}%`;$('stageDescription').textContent=descriptions[stage];updateURL({stage});
  if(!snapshots[stage]){setBusy('Preparing this generation stage…');return;}world=snapshots[stage];$('notice').hidden=true;const h=Float32Array.from(world.height,(v,i)=>world.ocean[i]?0:stage>=2?world.filled[i]:v);view.setSurface(world.mesh,h);if(first||view.lastSize!==world.config.sizeKm){view.reset();view.lastSize=world.config.sizeKm;first=false;}
  $('showNavigable').disabled=stage<4;$('showStrategic').disabled=stage<4;paint();if(selected>=0)inspect(selected,false);
  const s=summary(world);if(stage===1)$('status').textContent=`${geologySummary(world)} · peak ${fmt(s.peakM)} m`;else if(stage===4){const h=humanSummary(world);$('status').textContent=`${h.strategicNodes} transport opportunities · ${fmt(h.navigableRiverKm)} km navigable river`;}else $('status').textContent=`${s.majorBasins} major basins · ${fmt(s.lakeKm2)} km² lakes`;
  document.body.dataset.ready='true';document.body.dataset.stage=String(stage);document.body.dataset.modelVersion=world.version;
}

function updateLegend(){
  if(!world)return;const kind=actualMode();let rows=[],title='';
  if(kind==='basins'){rows=world.outlets.slice(0,8).map((o,i)=>[o.name,basinPalette[i],fmt(o.areaKm2)+' km²']);title='Catchments';}
  else if(kind==='rainfall'){rows=[['Dry interior','#c5a66b','~120 mm/yr'],['Seasonal moisture','#81a385','~900'],['Wet slopes','#356d84','~2,000+']];title='Modeled rainfall';}
  else if(kind==='history'){rows=HISTORY_TYPES.map((b,i)=>[...b,i?`${world.features.filter(f=>f.type===i).length} features`:'background']);title='Seeded landform history';}
  else if(kind==='productivity'){rows=[['Marginal','#574839','0–20'],['Workable','#757044','20–50'],['Strong surplus','#719b53','50–80'],['Best land','#b0b866','80–100']];title='Food-surplus potential';}
  else if(kind==='travel'){rows=[['Easy cart country','#568965','low'],['Moderate','#a88b53',''],['Difficult','#ae6b4c',''],['Severe','#8e4b46','high']];title='Overland travel difficulty';}
  else if(kind==='transport'){rows=[['Far from bulk transport','#5a4b3d',''],['Some access','#59786c',''],['Strong access','#408b9c',''],['River / port corridor','#6daaae','']];title='Bulk-transport access';}
  else if(kind==='potential'||stage===4&&kind==='natural'){rows=[['Low human potential','#3a4543',''],['Local opportunity','#8c894e',''],['Strong opportunity','#bca355',''],['Exceptional','#e0c467','']];title='Pre-settlement human potential';}
  else if(stage===3&&kind==='natural'){rows=BIOMES.map((b,i)=>[...b,fmt(world.biomeAreas[i]/world.config.sizeKm**2*100,1)+'%']).filter((b,i)=>world.biomeAreas[i]>0);title='Environments';}
  else{rows=[['Coast / lowland','#849171','0–500 m'],['Hills / upland','#a2a580','500–1,300 m'],['Mountain belt','#81847e','1,300–3,600 m'],['High peaks','#ececda','3,600+ m']];title='Landform';}
  $('legend').innerHTML='<h2>'+title+'</h2>'+rows.map(r=>`<div class="swatch-row"><i style="background:${r[1]}"></i><span>${r[0]}</span><small>${r[2]}</small></div>`).join('');
}

function nearestStrategic(w,index){if(w.stage<4)return null;let best=null,d=Infinity;for(const n of w.strategicNodes){const q=Math.hypot(w.mesh.x[index]-n.xKm,w.mesh.z[index]-n.zKm);if(q<d){d=q;best=n;}}return d<=w.stepKm*2.2?{...best,distanceKm:d}:null;}
function inspect(index,repaint=true){
  if(!world||index<0||index>=world.height.length)return;selected=index;const w=world,water=w.ocean[index]?'Ocean':stage>=2&&w.lake[index]?'Lake':'';$('inspect').hidden=false;$('legend').hidden=true;$('legendToggle').setAttribute('aria-expanded','false');$('inspectTitle').textContent=water||(stage===4?'Human geography':stage===3?BIOMES[w.biome[index]][0]:'Selected terrain');
  const facts=[['Ground elevation',fmt(w.height[index])+' m'],['Landform',HISTORY_TYPES[w.landHistory[index]][0]],['East / south',fmt(w.mesh.x[index])+' / '+fmt(w.mesh.z[index])+' km']];
  if(stage>=2&&!w.ocean[index]){facts.push(['Upstream area',fmt(w.area[index])+' km²'],['Surface / spill',fmt(w.filled[index])+' m']);if(w.receiver[index]>=0)facts.push(['Flow bearing',fmt((90+w.flowAngle[index]*180/Math.PI+360)%360,1)+'°']);}
  if(stage>=3&&!w.ocean[index])facts.push(['Rainfall',fmt(w.rainfall[index])+' mm/yr'],['Temperature',fmt(w.temperature[index],1)+' °C']);
  if(stage>=4&&!w.ocean[index]&&!w.lake[index]){facts.push(['Food surplus',fmt(w.productivity[index]*100)+' / 100'],['Human potential',fmt(w.humanPotential[index]*100)+' / 100'],['Market access',fmt(w.marketAccess[index]*100)+' / 100'],['Bulk transport',fmt(w.transportAccess[index]*100)+' / 100'],['Land friction',fmt(w.travelFriction[index],1)+'×'],['Navigable reach',w.navigableRiver[index]?'Yes':'No']);}
  $('inspectFacts').innerHTML=facts.map(([a,b])=>`<div><small>${a}</small><b>${b}</b></div>`).join('');const outlet=stage>=2?w.outlets.find(o=>o.id===w.basin[index]):null,strategic=nearestStrategic(w,index);
  if(stage===4&&strategic)$('inspectNote').textContent=`Nearby ${strategic.label.toLowerCase()}: ${strategic.reason}. This is a transport opportunity, not a placed settlement.`;
  else $('inspectNote').textContent=outlet?`${outlet.name}. Gold traces drainage ${outlet.kind==='sea'?'to the sea':'beyond the regional edge'}.`:stage===1?'Add hydrology to trace drainage.':'Regional ocean boundary.';if(repaint)paint();
}

function stop(){playing=false;clearTimeout(timer);$('play').textContent='▶ Watch build';}
function watch(){if(playing){stop();return;}playing=true;$('play').textContent='Ⅱ Pause build';let next=1;function advance(){if(!playing)return;if(!snapshots[next]){timer=setTimeout(advance,150);return;}showStage(next);if(next===4){stop();return;}next++;timer=setTimeout(advance,2100);}advance();}
function toast(s){$('toast').textContent=s;$('toast').hidden=false;setTimeout(()=>$('toast').hidden=true,2200);}
function setVisualScale(value,persist=true){const v=clamp(Number(value)||1,1,30);if(v>1)lastExag=v;view.setExaggeration(v);$('trueScale').setAttribute('aria-pressed',String(v===1));$('exaggerate').checked=v>1;$('exaggeration').disabled=v===1;$('exaggeration').value=lastExag;$('exaggerationOut').value=v===1?'Off · 1×':v+'×';$('viewNote').textContent=(v===1?'True height · 1×':'Relief ×'+v)+' · waterways symbolic';document.body.dataset.verticalScale=String(v);if(persist){try{localStorage.setItem('watershed-relief',String(v));localStorage.setItem('watershed-last-relief',String(lastExag));}catch{}updateURL({exag:v});}if(!view.gl&&world)paint();}

$('menuToggle').onclick=()=>{const closed=!$('menu').hidden;$('menu').hidden=closed;$('menuToggle').setAttribute('aria-expanded',String(!closed));};
$('legendToggle').onclick=()=>{const closed=!$('legend').hidden;$('legend').hidden=closed;$('legendToggle').setAttribute('aria-expanded',String(!closed));if(!closed)$('inspect').hidden=true;};
$('mapView').onclick=()=>{view.toggleMap();$('mapView').textContent=view.map?'3D':'Map';};$('reset').onclick=()=>view.reset();$('regenerate').onclick=generate;$('newSeed').onclick=()=>{$('seed').value=crypto.getRandomValues(new Uint32Array(1))[0];generate();};$('play').onclick=watch;
for(const button of document.querySelectorAll('[data-stage]'))button.onclick=()=>{stop();showStage(Number(button.dataset.stage));};
$('mapMode').onchange=()=>{mode=$('mapMode').value;updateURL({mode});paint();};for(const id of ['showRivers','showMesh','showNavigable','showStrategic'])$(id).onchange=paint;for(const id of ['relief','rain'])$(id).oninput=updateOutputs;
$('trueScale').onclick=()=>setVisualScale(view.exag===1?lastExag:1);$('exaggerate').onchange=()=>setVisualScale($('exaggerate').checked?lastExag:1);$('exaggeration').oninput=()=>setVisualScale(Number($('exaggeration').value));$('closeInspect').onclick=()=>{selected=-1;$('inspect').hidden=true;paint();};
$('copyLink').onclick=async()=>{try{updateURL({stage,exag:view.exag,mode});await navigator.clipboard.writeText(location.href);toast('Seed and view link copied');}catch{toast('Copy the address bar to share this seed');}};
$('export').onclick=()=>{const base=snapshots[3],h=snapshots[4];if(!base||!h)return;const payload=exportWorld(base);payload.version='regional-world-v4';payload.humanGeography={model:h.humanModel,productivity:h.productivity,productiveArea:h.productiveArea,productiveLandKm2:h.productiveLandKm2,travelFriction:h.travelFriction,waterAccessCost:h.waterAccessCost,transportAccess:h.transportAccess,navigableRiver:h.navigableRiver,navigableRiverKm:h.navigableRiverKm,navigableAreaThresholdKm2:h.navigableAreaThresholdKm2,marketAccess:h.marketAccess,humanPotential:h.humanPotential,strategicScore:h.strategicScore,strategicKind:h.strategicKind,strategicNodes:h.strategicNodes,note:'Stage 4 is pre-settlement suitability and transport opportunity; no settlements are placed.'};const blob=new Blob([JSON.stringify(payload,(_,v)=>ArrayBuffer.isView(v)?Array.from(v):v)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`region-v4-${h.config.seed}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);};
document.addEventListener('world-view-error',e=>error(e.detail));
window.__regionalWorldLab={get world(){return world;},get snapshots(){return snapshots;},get stage(){return stage;},get selected(){return selected;},get playing(){return playing;},get generation(){return run;},view,showStage,inspect,generate,watch,stop,setVisualScale};
let initialScale=18;try{const saved=Number(localStorage.getItem('watershed-relief')),last=Number(localStorage.getItem('watershed-last-relief'));if(saved>=1&&saved<=30)initialScale=saved;if(last>=2&&last<=30)lastExag=last;}catch{}if(params.has('exag')&&Number.isFinite(Number(params.get('exag'))))initialScale=clamp(Number(params.get('exag')),1,30);
setVisualScale(initialScale,false);updateOutputs();generate();
