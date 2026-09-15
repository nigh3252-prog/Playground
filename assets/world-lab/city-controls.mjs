import {DETAIL_LEVELS,planAreaDetail} from './area-detail.mjs';
const $=id=>document.getElementById(id);
const number=(n,d=0)=>Number(n||0).toLocaleString('en-US',{maximumFractionDigits:d});

// The shell owns dated selection and focus. Geometry and drawing are supplied
// by the model/view, so a queued open cannot survive a history replacement.
export function createCityControls({buildCity,createView,buildContext=()=>null,buildWindow=()=>null,getViewport=()=>null,onEnter=()=>{},onOpen=()=>{},onClose=()=>{},onError=()=>{},schedule=fn=>requestAnimationFrame(()=>setTimeout(fn,0))}){
  let context={},scene=null,view=null,city=null,request=0,modal=null,opener=null;
  let level='parent',areaBusy=false;
  const pendingDetails=new Set();
  const cache=new Map(),inertBefore=new Map();
  function ready(){return !!(context.enabled&&context.world&&context.history&&context.frame&&!context.busy);}
  function available(){
    const {history,frame}=context;
    if(!ready())return [];
    return frame.siteStates.flatMap(state=>{
      const site=history.sites[state.siteId];
      return site&&site.founded<=frame.generation&&state.population>0&&state.status!=='abandoned'?[{site,state}]:[];
    }).sort((a,b)=>b.state.population-a.state.population||a.site.id-b.site.id);
  }
  function activate(element){
    if(!modal)opener=document.activeElement;
    modal=element;
    for(const child of document.body.children){
      if(!inertBefore.has(child))inertBefore.set(child,child.inert);
      child.inert=child!==element;
    }
  }
  function close({restoreFocus=true}={}){
    ++request;pendingDetails.clear();areaBusy=false;const wasOpen=!!modal;modal=null;city=null;
    $('cityScreen').hidden=true;$('cityChooser').hidden=true;
    document.body.dataset.city='false';view?.setActive(false);
    for(const [element,previous] of inertBefore)element.inert=previous;
    inertBefore.clear();
    if(wasOpen){onClose();if(restoreFocus&&opener?.isConnected!==false)opener?.focus();}
    opener=null;
  }
  function renderChoices(){
    const origin=context,query=$('citySearch').value.trim().toLocaleLowerCase();
    const places=available(),matches=places.filter(p=>p.site.name.toLocaleLowerCase().includes(query));
    $('cityChooserSummary').textContent=`${context.frame?.eraLabel||'Early settlements'} · Year ${number(context.frame?.year)} · ${number(places.length)} places`;
    $('cityList').replaceChildren(...matches.slice(0,60).map(({site,state})=>{
      const button=document.createElement('button');button.type='button';button.className='city-choice';
      const name=document.createElement('strong'),facts=document.createElement('span');
      name.textContent=site.name;facts.textContent=`${number(state.population)} people${state.urbanAreaKm2?` · ${number(state.urbanAreaKm2)} km²`:''}`;
      button.append(name,facts);
      button.onclick=()=>{if(context===origin)open(site.id);};
      return button;
    }));
    $('citySearchNote').textContent=!matches.length?'No places match this name.':matches.length>60?`Showing the 60 largest of ${number(matches.length)}. Search for any place.`:'Choose a place to explore its neighborhoods.';
  }
  function showChooser(){
    if(!available().length)return;
    onEnter();
    $('cityChooser').hidden=false;$('citySearch').value='';activate($('cityChooser'));
    renderChoices();$('citySearch').focus();
  }
  function selectDistrict(id,updateView=true){
    if(!city)return;
    const district=city.districts.find(d=>String(d.id)===String(id));
    $('cityDistrict').value=district?String(district.id):'-1';
    $('cityDistrictName').textContent=district?.name||'City overview';
    $('cityDistrictFacts').textContent=district?`${number(district.population)} people · ${number(district.areaKm2,2)} km² · ${number(district.densityPerKm2)} people/km²`:`${number(city.districts.length)} neighborhoods · ${number(city.densityPerKm2)} people/km² across the built area`;
    $('cityDistrictKind').textContent=district?district.kind.replaceAll('-',' ').replaceAll('_',' '):'Tap a neighborhood or choose one above';
    if(updateView)view?.selectDistrict(district?.id??-1);
    if(district)setPanel(true);
  }
  function setPanel(expanded){
    $('cityDistrictBody').hidden=!expanded;
    $('cityPanelToggle').setAttribute('aria-expanded',String(expanded));
    $('cityPanelToggle').textContent=expanded?'Neighborhoods ▾':'Neighborhoods ▴';
  }
  function ensureView(){
    if(!scene)scene=buildContext(context.world,context.history,context.frame);
    if(!view)view=createView($('cityCanvas'),{
      autoDetail:false,onSelect:id=>selectDistrict(id,false),
      onSelectSite:id=>loadDetail(id,{detail:level==='streets'?'streets':'metro'}),onDetailRequest:id=>loadDetail(id,{select:false}),
      onChange:({kmAcross})=>{$('cityScale').textContent=`${number(kmAcross,kmAcross<10?1:0)} km across`;updateDetailControls();},
    });
  }
  function cityInfo(place){
    $('cityTitle').textContent=city.name;
    $('citySummary').textContent=`${number(city.population)} people · ${number(city.areaKm2,1)} km² built · Year ${number(context.frame.year)}`;
    $('cityNameOrigin').textContent=place.site.nameOrigin||'';
    const origins=city.development?.summary||'Regional approaches lead into older streets, neighborhood connections and later planned districts.';
    $('cityModelNote').textContent=`${origins}${city.footprintLimited?' Development is constrained by available land here.':''}`;
    $('cityDistrict').disabled=false;$('cityReset').disabled=false;
    $('cityDistrict').replaceChildren(new Option('City overview','-1'),...city.districts.map(d=>new Option(`${d.name} · ${number(d.population)}`,String(d.id))));
    $('cityDistrictPanel').hidden=false;selectDistrict(-1);onOpen(city.siteId,city);
  }
  function areaInfo(detail,siteCount=0){
    $('cityTitle').textContent={parent:'Parent map',window:'Window map',metro:'Metro overview',streets:'Street map'}[detail];
    $('citySummary').textContent=`Year ${number(context.frame.year)} · ${detail==='parent'?'Zoom to an area':siteCount?`${number(siteCount)} place${siteCount===1?'':'s'} in this area`:'Terrain and regional connections'}`;
    for(const id of ['cityNameOrigin','cityModelNote','cityDistrictName','cityDistrictFacts','cityDistrictKind'])$(id).textContent='';
    $('cityDistrict').disabled=true;$('cityDistrict').replaceChildren();$('cityDistrict').value='';
    $('cityDistrictPanel').hidden=true;setPanel(false);
  }
  function built(place,detail='streets'){
    const id=place.site.id,key=`${detail}:${id}`,value=cache.get(key)||buildCity(context.world,context.history,context.frame,id,{detail});
    if(!value)throw new Error('This place has no inhabited city at this date.');
    cache.delete(key);cache.set(key,value);
    const keys=[...cache.keys()].filter(k=>k.startsWith(detail+':')),limit=detail==='streets'?8:64;
    if(keys.length>limit){const expired=keys.find(k=>cache.get(k)!==city)||keys[0],old=cache.get(expired);cache.delete(expired);const overview=cache.get(`metro:${old.siteId}`);if(overview)view?.addCity(overview);else view?.removeCity?.(old.siteId);}
    return value;
  }
  function loadDetail(siteId,{select=true,detail='streets'}={}){
    if(areaBusy||modal!==$('cityScreen')||pendingDetails.has(siteId))return;
    const place=available().find(p=>p.site.id===siteId);if(!place)return;
    const token=request,origin=context;pendingDetails.add(siteId);
    $('cityLoading').textContent=`Building ${place.site.name}…`;$('cityLoading').hidden=false;
    schedule(()=>{
      if(token!==request||context!==origin)return;
      pendingDetails.delete(siteId);
      try{const value=built(place,detail);if(select){city=value;level=detail;view.setDetailLevel?.(level);view.setCity(city);cityInfo(place);}else view.addCity(value);}
      catch(error){onError(error);}
      $('cityLoading').hidden=pendingDetails.size===0;updateDetailControls();
    });
  }
  function showScreen(){
    onEnter();++request;pendingDetails.clear();areaBusy=false;
    $('cityChooser').hidden=true;$('cityScreen').hidden=false;activate($('cityScreen'));
    document.body.dataset.city='true';$('cityBack').focus();setPanel(false);
    $('cityCanvas').style.visibility='hidden';$('cityDistrictPanel').hidden=true;
    $('cityLoading').textContent='Preparing map…';$('cityLoading').hidden=false;
  }
  function open(siteId){
    const place=available().find(p=>p.site.id===siteId);if(!place)return false;
    showScreen();level='streets';const token=request,origin=context;
    $('cityTitle').textContent=place.site.name;$('citySummary').textContent='Building neighborhoods…';
    schedule(()=>{
      if(token!==request||context!==origin)return;
      try{
        city=built(place);ensureView();
        $('cityCanvas').style.visibility='visible';view.setActive(true);view.show(city,{context:scene,detailLevel:level});
        $('cityLoading').hidden=pendingDetails.size===0;cityInfo(place);updateDetailControls();
      }catch(error){close();onError(error);}
    });return true;
  }
  function openMap(viewport=getViewport()){
    if(!ready())return false;
    showScreen();const token=request,origin=context;city=null;level='parent';
    areaInfo(level);
    schedule(()=>{
      if(token!==request||context!==origin)return;
      try{
        ensureView();$('cityCanvas').style.visibility='visible';view.setActive(true);view.show(null,{context:scene,viewport,detailLevel:level});
        $('cityLoading').hidden=pendingDetails.size===0;$('cityReset').disabled=false;updateDetailControls();
      }catch(error){close();onError(error);}
    });return true;
  }
  function updateDetailControls(message){
    const next=DETAIL_LEVELS[Math.min(3,DETAIL_LEVELS.indexOf(level)+1)],viewport=view?.getView?.(),plan=planAreaDetail(requestSites(),viewport,next);
    for(const name of DETAIL_LEVELS){const button=$('cityLevel'+name[0].toUpperCase()+name.slice(1));if(!button)continue;button.setAttribute('aria-pressed',String(name===level));button.disabled=areaBusy;}
    const load=$('loadArea');if(load){load.textContent=`Load ${next==='streets'?'streets':next+' detail'} here`;load.disabled=areaBusy||!plan.allowed;}
    const hint=$('cityDetailHint');if(hint)hint.textContent=(level==='window'?'Same terrain, sharper map. ':'')+(message||(areaBusy?'Preparing the selected area…':!plan.allowed?plan.reason:level==='parent'?'Zoom to an area, then load window detail.':level==='window'?'Load metro detail to see districts and major roads.':level==='metro'?'Zoom closer, then load streets and buildings.':'Pan to another area and load its streets.'));
    document.body.dataset.mapDetail=level;
  }
  function requestSites(){return(scene?.sites||[]).map(site=>{const known=cache.get(`metro:${site.id}`)||cache.get(`streets:${site.id}`);return known?{...site,bounds:known.bounds}:site;});}
  function loadArea(targetLevel){
    if(areaBusy||modal!==$('cityScreen')||!view)return false;
    if(targetLevel==='parent'){
      ++request;pendingDetails.clear();city=null;level='parent';view.setCity?.(null);view.setDetailLevel?.(level);
      $('cityLoading').hidden=true;areaInfo(level);updateDetailControls();return true;
    }
    const viewport=view.getView?.(),plan=planAreaDetail(requestSites(),viewport,targetLevel);
    if(!plan.allowed){updateDetailControls(plan.reason);return false;}
    const token=++request,origin=context;pendingDetails.clear();areaBusy=true;
    if(city&&!plan.siteIds.includes(city.siteId)){city=null;view.setCity?.(null);areaInfo(targetLevel,plan.siteIds.length);}
    $('cityLoading').hidden=false;$('cityLoading').textContent=`Preparing ${targetLevel} detail…`;updateDetailControls();
    const places=new Map(available().map(p=>[p.site.id,p]));let cursor=0,failures=0;
    const finish=()=>{
      areaBusy=false;level=targetLevel;view.setDetailLevel?.(level);
      $('cityLoading').hidden=true;$('cityReset').disabled=false;
      if(!city)areaInfo(level,plan.siteIds.length);
      $('cityDistrictPanel').hidden=!city||!['metro','streets'].includes(level);
      updateDetailControls(failures?`${failures} place${failures===1?'':'s'} could not load. Try this area again.`:plan.siteIds.length===0&&targetLevel!=='window'?'Countryside · no urban footprints in this area.':undefined);
    };
    const step=()=>{
      if(token!==request||context!==origin||modal!==$('cityScreen'))return;
      if(cursor===0&&targetLevel==='window'){
        try{const patch=buildWindow(context.world,viewport);if(patch)view.addTerrainWindow?.(patch);}catch(error){failures++;onError(error);}
      }
      if(cursor>=plan.siteIds.length){finish();return;}
      const id=plan.siteIds[cursor++],place=places.get(id);
      $('cityLoading').textContent=`${targetLevel==='metro'?'Planning districts':'Building streets'} · ${cursor} of ${plan.siteIds.length}${place?' · '+place.site.name:''}`;
      try{if(place){const value=built(place,targetLevel);view.addCity(value);if(city?.siteId===id){city=value;view.setCity(city);cityInfo(place);}}}catch(error){failures++;onError(error);}
      schedule(step);
    };
    schedule(step);return true;
  }
  function setContext(next){
    const changed=context.world!==next.world||context.history!==next.history||context.frame!==next.frame||context.enabled!==next.enabled||context.busy!==next.busy;
    if(changed){close({restoreFocus:false});cache.clear();scene=null;context=next;}
    $('openCities').hidden=!next.enabled;$('openCities').disabled=!available().length;
    $('exploreMap').hidden=!next.enabled;$('exploreMap').disabled=!ready();
  }
  $('exploreMap').onclick=()=>openMap();$('cityPanelToggle').onclick=()=>setPanel($('cityDistrictBody').hidden);
  $('openCities').onclick=showChooser;$('closeCityChooser').onclick=()=>close();
  $('citySearch').oninput=renderChoices;$('cityBack').onclick=()=>close();
  $('cityDistrict').onchange=()=>selectDistrict($('cityDistrict').value);
  $('cityZoomIn').onclick=()=>view?.zoomBy(1.6);$('cityZoomOut').onclick=()=>view?.zoomBy(1/1.6);$('cityReset').onclick=()=>view?.fitParent?.();
  for(const name of DETAIL_LEVELS){const button=$('cityLevel'+name[0].toUpperCase()+name.slice(1));if(button)button.onclick=()=>loadArea(name);}
  if($('loadArea'))$('loadArea').onclick=()=>loadArea(DETAIL_LEVELS[Math.min(3,DETAIL_LEVELS.indexOf(level)+1)]);
  document.addEventListener('keydown',event=>{
    if(!modal)return;
    if(event.key==='Escape'){event.preventDefault();close();return;}
    if(event.key!=='Tab')return;
    const focusable=[...modal.querySelectorAll('button:not(:disabled),select:not(:disabled),input:not(:disabled),summary')].filter(e=>e.getClientRects().length);
    const first=focusable[0],last=focusable.at(-1);
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
  });
  return {setContext,open,openMap,openParent:()=>openMap(null),loadArea,close,showChooser,get current(){return city;},get detailLevel(){return level;}};
}
