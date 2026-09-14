import {WorldView} from '../world-lab/world-view.mjs';
import {generateLocalTerrain,serializeLocalTerrain} from './local-terrain.mjs';
import {createLocalRenderMesh,localTextureSize} from './local-rendering.mjs';
import {generateSolvedParent} from './local-parent.mjs';

const $=id=>document.getElementById(id),params=new URLSearchParams(location.search),clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),fmt=(n,d=0)=>Number(n).toLocaleString('en-US',{maximumFractionDigits:d});
const state={status:'loading',parent:null,tile:null,error:null,mode:'natural',generation:0};window.__localTerrainLab=state;
for(const id of ['seed','continentCount','crustScale','windowIndex','siteIndex'])if(params.has(id))$(id).value=params.get(id);
if(params.has('mode')&&[...$('mapMode').options].some(option=>option.value===params.get('mode')))$('mapMode').value=params.get('mode');
const view=new WorldView($('terrain'),{onPick:inspect});view.setExaggeration(4);if(!view.gl){$('mapView').textContent='2D';$('mapView').disabled=true;}

const mesh=createLocalRenderMesh(),texture=document.createElement('canvas');texture.width=texture.height=localTextureSize();
function updateURL(){const url=new URL(location.href);for(const id of ['seed','continentCount','crustScale','windowIndex','siteIndex'])url.searchParams.set(id,$(id).value);url.searchParams.set('mode',$('mapMode').value);history.replaceState(null,'',url);}
function colorRamp(t,stops){t=clamp(t,0,1)*(stops.length-1);const i=Math.min(stops.length-2,Math.floor(t)),f=t-i;return stops[i].map((v,ch)=>Math.round(v+(stops[i+1][ch]-v)*f));}
function paint(){
 const tile=state.tile;if(!tile)return;const mode=$('mapMode').value,ctx=texture.getContext('2d'),image=ctx.createImageData(texture.width,texture.height),range=Math.max(1,tile.metrics.maxElevationM-tile.metrics.minElevationM),maxFlow=Math.max(...tile.flowAccumulation);
 for(let py=0;py<texture.height;py++)for(let px=0;px<texture.width;px++){
  const row=Math.round(py/(texture.height-1)*256),col=Math.round(px/(texture.width-1)*256),id=row*257+col,e=(tile.heightM[id]-tile.metrics.minElevationM)/range,s=tile.slope[id],flow=Math.log1p(tile.flowAccumulation[id])/Math.log1p(maxFlow),water=tile.waterMask[id],walk=tile.walkability[id];let color;
  if(mode==='elevation')color=colorRamp(e,[[37,78,91],[91,126,91],[164,153,112],[225,225,214]]);
  else if(mode==='slope')color=colorRamp(s/.7,[[78,125,91],[205,185,99],[174,73,61]]);
  else if(mode==='drainage')color=colorRamp(flow,[[50,66,61],[67,112,104],[112,191,212],[218,245,247]]);
  else if(mode==='water')color=water?[58,139,183]:[112,132,104];
  else if(mode==='walkability')color=walk?[121,166,102]:water?[48,119,166]:[126,83,66];
  else{color=colorRamp(e,[[64,101,76],[111,137,88],[145,133,99],[188,185,166]]);if(tile.surfaceClass[id]===2)color=[79,121,99];if(water)color=[53,127,170];}
  const out=(py*texture.width+px)*4;image.data[out]=color[0];image.data[out+1]=color[1];image.data[out+2]=color[2];image.data[out+3]=255;
 }
 ctx.putImageData(image,0,0);const focusPx=410/1200*texture.width,origin=(texture.width-focusPx)/2;ctx.strokeStyle='#e3f0cf';ctx.lineWidth=4;ctx.setLineDash([12,7]);ctx.strokeRect(origin,origin,focusPx,focusPx);ctx.setLineDash([]);view.setTexture(texture);state.mode=mode;updateURL();
}
function inspect(id){if(!state.tile)return;const row=Math.floor(id/257),col=id%257,x=(col-128)*4.6875,z=(row-128)*4.6875;$('status').textContent=`${fmt(x)} m east · ${fmt(z)} m south · ${fmt(state.tile.heightM[id],1)} m elevation · ${fmt(state.tile.slope[id]*100,1)}% grade`;}
function metrics(tile){$('metrics').innerHTML=`<div class="metric"><small>Elevation</small><b>${fmt(tile.metrics.minElevationM)}–${fmt(tile.metrics.maxElevationM)} m</b></div><div class="metric"><small>Total relief</small><b>${fmt(tile.metrics.reliefM,1)} m</b></div><div class="metric"><small>P95 grade</small><b>${fmt(tile.metrics.p95Slope*100,1)}%</b></div><div class="metric"><small>Walkable terrain</small><b>${fmt(tile.metrics.walkableFraction*100,1)}%</b></div><div class="metric"><small>Surface water</small><b>${fmt(tile.metrics.waterFraction*100,1)}%</b></div><div class="metric"><small>Drain outlets</small><b>${tile.drainage.outlets.length}</b></div>`;}
function settings(){
 const seed=Number($('seed').value),continentCount=Number($('continentCount').value),crustScale=Number($('crustScale').value),windowIndex=Number($('windowIndex').value),siteIndex=Number($('siteIndex').value);
 if(!Number.isInteger(seed)||seed<0||seed>4294967295||!Number.isInteger(continentCount)||continentCount<1||continentCount>4||!Number.isFinite(crustScale)||crustScale<.75||crustScale>1.45||!Number.isInteger(windowIndex)||windowIndex<0||!Number.isInteger(siteIndex)||siteIndex<0)throw new Error('Enter valid parent controls and non-negative window/site indices.');
 return{seed,continentCount,crustScale,windowIndex,siteIndex};
}
async function generate(){
 const token=++state.generation;state.status='generating';state.error=null;$('status').classList.remove('error');$('status').textContent='Building parent geography…';$('exportTerrain').disabled=true;await new Promise(resolve=>setTimeout(resolve,20));
 try{const options=settings(),parent=generateSolvedParent({seed:options.seed,sizeKm:1200,n:193,continentCount:options.continentCount,crustScale:options.crustScale});if(token!==state.generation)return;$('status').textContent='Synthesizing the 1.8 km padded terrain domain…';await new Promise(resolve=>setTimeout(resolve,20));const tile=generateLocalTerrain(parent,{windowIndex:options.windowIndex,siteIndex:options.siteIndex});if(token!==state.generation)return;state.parent=parent;state.tile=tile;state.status='ready';view.setSurface(mesh,tile.heightM);view.reset();view.target[1]=(tile.metrics.minElevationM+tile.metrics.maxElevationM)/2000*view.exag;metrics(tile);paint();$('exportTerrain').disabled=false;$('status').textContent=`Ready · site ${options.siteIndex} · ${fmt(tile.metrics.reliefM,1)} m local relief · parent anchor ${fmt(tile.anchor.centerXKm,1)}, ${fmt(tile.anchor.centerZKm,1)} km`;document.body.dataset.ready='true';}
 catch(error){if(token!==state.generation)return;state.status='error';state.error=error;$('status').classList.add('error');$('status').textContent='Generation failed; no replacement terrain was substituted: '+error.message;document.body.dataset.ready='false';}
}
function save(){const blob=new Blob([JSON.stringify(serializeLocalTerrain(state.tile))],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`local-terrain-${state.tile.anchor.parentSeed}-${state.tile.anchor.siteIndex}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),4000);}
$('generate').onclick=generate;$('nextSite').onclick=()=>{$('siteIndex').value=Number($('siteIndex').value||0)+1;generate();};$('mapMode').onchange=paint;$('mapView').onclick=()=>{view.toggleMap();$('mapView').textContent=view.map?'3D':'Map';};$('exportTerrain').onclick=save;$('copyLink').onclick=async()=>{updateURL();try{await navigator.clipboard.writeText(location.href);$('status').textContent='Reproducible link copied.';}catch{$('status').textContent='Copy the address bar to share this terrain.';}};
addEventListener('unhandledrejection',event=>{state.status='error';state.error=event.reason;$('status').classList.add('error');$('status').textContent='Unexpected error: '+(event.reason?.message||event.reason);});generate();
