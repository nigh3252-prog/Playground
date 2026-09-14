import {visibleHistorySites,describeHistoryPlace} from './history-presentation.mjs';

const $=id=>document.getElementById(id);
const number=n=>Math.round(n||0).toLocaleString('en-US');

export function createHistoryControls({onDate,onSelect,onGenerate,onPaint,onOptions}){
  let history=null,frame=null,playing=false,timer=0;
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
  $('historyOptions').onclick=onOptions;
  $('closePlace').onclick=()=>onSelect(-1);
  function generate(random){
    if(random)$('historySeed').value=crypto.getRandomValues(new Uint32Array(1))[0];
    if(!$('historySeed').reportValidity())return;
    stop();onGenerate({seed:Number($('historySeed').value)>>>0,generations:Number($('historyGenerations').value),yearsPerGeneration:25});
  }
  $('newHistory').onclick=()=>generate(true);$('applyHistory').onclick=()=>generate(false);
  for(const id of ['historyLandUse','historyRoutes','historyTraces','historyLabels','historyInfluence'])$(id).onchange=onPaint;
  function eventButton(event){
    const button=document.createElement('button');button.type='button';button.className='history-event';
    const date=document.createElement('span');date.textContent=`Year ${event.year}`;
    const text=document.createElement('span');text.textContent=event.text;button.append(date,text);
    button.onclick=()=>{stop();onDate(event.generation);if(event.siteIds.length)onSelect(event.siteIds[0],true);};
    return button;
  }
  function render({world,data,generation,box,selectedSite=-1,enabled=false,busy=false}){
    history=data;frame=data?.snapshots[generation];
    $('historyTimeline').hidden=!enabled;$('historySettings').hidden=!world?.parentDomain;
    $('placeCard').hidden=true;
    for(const id of ['newHistory','applyHistory'])$(id).disabled=busy||!world?.parentDomain;
    for(const id of ['historyDate','historyPlay','historyPrevious','historyNext','historyPlace'])$(id).disabled=!frame||busy;
    if(!enabled||!frame)return;
    $('historyDate').max=String(history.generations);$('historyDate').value=String(generation);
    $('historyDate').setAttribute('aria-valuetext',`Year ${frame.year}, generation ${generation}`);
    $('historyYear').textContent=`Year ${frame.year}`;
    $('historyGeneration').textContent=`Generation ${generation} of ${history.generations}`;
    $('historyPrevious').disabled=busy||generation===0;$('historyNext').disabled=busy||generation===history.generations;
    $('historySummary').textContent=`${number(frame.summary.population)} people · ${number(frame.summary.settlements)} settlements · ${number(frame.summary.abandoned)} abandoned`;
    $('historyPlace').replaceChildren(new Option('Explore a place…','-1'));
    for(const {site,state} of visibleHistorySites(world,history,frame,box).sort((a,b)=>b.state.population-a.state.population)){
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
    $('placeFacts').textContent=`Founded in year ${place.site.founded*history.yearsPerGeneration} · ${place.group?.name||'Unaffiliated'} · ${number(place.state.farmAreaKm2)} km² cultivated${place.traces.length?` · ${place.traces.length} old route${place.traces.length===1?'':'s'}`:''}`;
    $('placeReason').textContent=place.site.reason||'';
    $('placeEvents').replaceChildren(...place.events.slice().reverse().map(eventButton));
  }
  return {render,stop,openPlace(){ $('placeDetails').open=true; },
    overlays(){return{landUse:$('historyLandUse').checked,routes:$('historyRoutes').checked,traces:$('historyTraces').checked,labels:$('historyLabels').checked,influence:$('historyInfluence').checked};}};
}
