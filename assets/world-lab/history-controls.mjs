import {visibleHistorySites,describeHistoryPlace} from './history-presentation.mjs';
import {installWorldMenu} from './world-menu.mjs';

const $=id=>document.getElementById(id);
const number=n=>Math.round(n||0).toLocaleString('en-US');

export function createHistoryControls({onDate,onSelect,onGenerate,onPaint,onOptions,onOpenCity}){
  const menuShell=installWorldMenu();
  let history=null,frame=null,playing=false,timer=0,pending=false,active=false;
  function stop(){playing=false;clearTimeout(timer);$('historyPlay').textContent='▶';$('historyPlay').setAttribute('aria-label','Play history');}
  function advance(){
    if(!playing||!history)return;
    if(frame.generation>=history.generations){stop();return;}
    onDate(frame.generation+1);timer=setTimeout(advance,1200);
  }
  $('historyPlay').onclick=()=>{
    if(playing)return stop();
    if(!history)return;
    playing=true;$('historyPlay').textContent='Ⅱ';$('historyPlay').setAttribute('aria-label','Pause history');
    if(frame.generation>=history.generations)onDate(0);
    timer=setTimeout(advance,900);
  };
  $('historyPrevious').onclick=()=>{stop();onDate(frame.generation-1);};
  $('historyNext').onclick=()=>{stop();onDate(frame.generation+1);};
  $('historyDate').oninput=()=>{stop();onDate(Number($('historyDate').value));};
  $('historyPlace').onchange=()=>onSelect(Number($('historyPlace').value));
  $('historyOptions').onclick=()=>{menuShell?.show('history');onOptions?.();};
  $('closePlace').onclick=()=>onSelect(-1);
  function generate(random){
    if(random)$('historySeed').value=crypto.getRandomValues(new Uint32Array(1))[0];
    if(!$('historySeed').reportValidity())return;
    stop();onGenerate({seed:Number($('historySeed').value)>>>0,generations:Number($('historyGenerations').value),yearsPerGeneration:25,era:$('historyEra').value});
  }
  $('newHistory').onclick=()=>generate(true);$('applyHistory').onclick=()=>generate(false);
  for(const id of ['historyLandUse','historyRoutes','historyTraces','historyLabels','historyInfluence'])$(id).onchange=onPaint;
  function eventButton(event){
    const origin=history;
    const button=document.createElement('button');button.type='button';button.className='history-event';
    const date=document.createElement('span');date.textContent=`Year ${event.year}`;
    const text=document.createElement('span');text.textContent=event.text;button.append(date,text);
    button.onclick=()=>{if(origin!==history||!frame||pending||!active)return;stop();onDate(event.generation);if(event.siteIds.length)onSelect(event.siteIds[0],true);};
    return button;
  }
  function render({world,data,generation,box,selectedSite=-1,enabled=false,busy=false}){
    history=data;frame=data?.snapshots[generation];pending=busy;active=enabled;
    $('historyTimeline').hidden=!enabled;$('historySettings').hidden=!world?.parentDomain;
    $('placeCard').hidden=true;$('openCity').disabled=true;$('openCity').onclick=null;
    for(const id of ['newHistory','applyHistory'])$(id).disabled=busy||!world?.parentDomain;
    for(const id of ['historyDate','historyPlay','historyPrevious','historyNext','historyPlace'])$(id).disabled=!frame||busy;
    if(!frame){
      stop();$('historyYear').textContent=busy?'Generating…':'History unavailable';$('historyGeneration').textContent='';
      $('historySummary').textContent='';$('historyPopulationBreakdown').textContent='';$('historyEraLabel').textContent='';$('historyDate').value='0';
      $('historyPlace').replaceChildren(new Option('Explore a place…','-1'));
      $('historyEvents').replaceChildren();$('placeEvents').replaceChildren();
      $('historyEventCount').textContent='This generation';$('generationEvents').open=false;
      return;
    }
    if(!enabled)return;
    $('historyDate').max=String(history.generations);$('historyDate').value=String(generation);
    $('historyDate').setAttribute('aria-valuetext',`Year ${frame.year}, generation ${generation}`);
    $('historyYear').textContent=`Year ${frame.year}`;
    $('historyEraLabel').textContent=frame.eraLabel||'Early settlements';
    $('historyGeneration').textContent=`Generation ${generation} of ${history.generations}`;
    $('historyPrevious').disabled=busy||generation===0;$('historyNext').disabled=busy||generation===history.generations;
    const modern=!!frame.era&&frame.era!=='agrarian',classified=Number.isFinite(frame.summary.urbanPopulation);
    $('historySummary').textContent=`Parent · ${number(frame.summary.population)} people · ${number(frame.summary.settlements)} ${modern?'cities and towns':'settlements'}${frame.summary.abandoned?` · ${number(frame.summary.abandoned)} abandoned`:''}`;
    $('historyPopulationBreakdown').textContent=classified?`${number(frame.summary.urbanPopulation)} urban · ${number(frame.summary.ruralPopulation)} rural · ${Number(frame.summary.densityPerKm2).toLocaleString('en-US',{maximumFractionDigits:1})} people/km² of land`:'';
    const visible=visibleHistorySites(world,history,frame,box).sort((a,b)=>b.state.population-a.state.population);
    $('historyPlace').replaceChildren(new Option(visible.length?'Explore a place…':'No recorded places here · choose Parent','-1'));
    $('historyPlace').disabled=busy||!visible.length;
    for(const {site,state} of visible){
      $('historyPlace').add(new Option(`${site.name} · ${state.status==='abandoned'?'abandoned':number(state.population)}`,String(site.id)));
    }
    $('historyPlace').value=String(selectedSite);
    $('historyEventCount').textContent=`This generation · ${frame.events.length} events`;
    $('historyEvents').replaceChildren(...frame.events.map(eventButton));
    if(!frame.events.length){const p=document.createElement('p');p.className='note';p.textContent='A quiet generation. Existing places continue to change.';$('historyEvents').append(p);}
    const place=describeHistoryPlace(history,frame,selectedSite);
    if(!place)return;
    $('placeCard').hidden=false;$('placeName').textContent=place.site.name;
    $('placeOverview').textContent=`${place.state.status} · ${number(place.state.population)} people · ${place.age} years old`;
    $('placeFacts').textContent=`Founded in year ${place.site.founded*history.yearsPerGeneration} · ${place.group?.name||'Unaffiliated'} · ${modern?`${number(place.state.urbanAreaKm2)} km² urban · ${number(place.state.densityPerKm2)} people/km²`:`${number(place.state.farmAreaKm2)} km² cultivated`}${place.traces.length?` · ${place.traces.length} old route${place.traces.length===1?'':'s'}`:''}`;
    $('placeReason').textContent=place.site.reason||'';
    $('placeNameOrigin').textContent=place.site.nameOrigin||'';
    const origin=history,siteId=selectedSite;
    $('openCity').disabled=busy||place.state.population<=0||place.state.status==='abandoned';
    $('openCity').onclick=()=>{if(origin!==history||pending||!active||$('openCity').disabled)return;stop();onOpenCity?.(siteId);};
    $('placeEvents').replaceChildren(...place.events.slice().reverse().map(eventButton));
  }
  return {render,stop,openPlace(){ $('placeDetails').open=true; },
    overlays(){return{landUse:$('historyLandUse').checked,routes:$('historyRoutes').checked,traces:$('historyTraces').checked,labels:$('historyLabels').checked,influence:$('historyInfluence').checked};}};
}
