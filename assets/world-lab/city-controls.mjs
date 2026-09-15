const $=id=>document.getElementById(id);
const number=(n,d=0)=>Number(n||0).toLocaleString('en-US',{maximumFractionDigits:d});

// The shell owns dated selection and focus. Geometry and drawing are supplied
// by the model/view, so a queued open cannot survive a history replacement.
export function createCityControls({buildCity,createView,buildContext=()=>null,getViewport=()=>null,onEnter=()=>{},onOpen=()=>{},onClose=()=>{},onError=()=>{},schedule=fn=>requestAnimationFrame(fn)}){
  let context={},scene=null,view=null,city=null,request=0,modal=null,opener=null;
  const pendingDetails=new Set();
  const cache=new Map(),inertBefore=new Map();
  function available(){
    const {world,history,frame,enabled,busy}=context;
    if(!world||!history||!frame||!enabled||busy)return [];
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
    ++request;pendingDetails.clear();const wasOpen=!!modal;modal=null;city=null;
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
      onSelect:id=>selectDistrict(id,false),
      onSelectSite:id=>loadDetail(id),onDetailRequest:id=>loadDetail(id,{select:false}),
      onChange:({kmAcross})=>{$('cityScale').textContent=`${number(kmAcross,kmAcross<10?1:0)} km across`;},
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
  function built(place){
    const id=place.site.id,value=cache.get(id)||buildCity(context.world,context.history,context.frame,id);
    if(!value)throw new Error('This place has no inhabited city at this date.');
    cache.set(id,value);if(cache.size>6)cache.delete(cache.keys().next().value);return value;
  }
  function loadDetail(siteId,{select=true}={}){
    if(modal!==$('cityScreen')||pendingDetails.has(siteId))return;
    const place=available().find(p=>p.site.id===siteId);if(!place)return;
    const token=request,origin=context;pendingDetails.add(siteId);
    $('cityLoading').textContent=`Building ${place.site.name}…`;$('cityLoading').hidden=false;
    schedule(()=>{
      if(token!==request||context!==origin)return;
      pendingDetails.delete(siteId);
      try{const detail=built(place);if(select){city=detail;view.setCity(city);cityInfo(place);}else view.addCity(detail);}
      catch(error){onError(error);}
      $('cityLoading').hidden=pendingDetails.size===0;
    });
  }
  function showScreen(){
    onEnter();++request;pendingDetails.clear();
    $('cityChooser').hidden=true;$('cityScreen').hidden=false;activate($('cityScreen'));
    document.body.dataset.city='true';$('cityBack').focus();setPanel(false);
    $('cityCanvas').style.visibility='hidden';$('cityDistrictPanel').hidden=true;
    $('cityLoading').textContent='Preparing map…';$('cityLoading').hidden=false;
  }
  function open(siteId){
    const place=available().find(p=>p.site.id===siteId);if(!place)return false;
    showScreen();const token=request,origin=context;
    $('cityTitle').textContent=place.site.name;$('citySummary').textContent='Building neighborhoods…';
    schedule(()=>{
      if(token!==request||context!==origin)return;
      try{
        city=built(place);ensureView();
        $('cityCanvas').style.visibility='visible';view.setActive(true);view.show(city,{context:scene});
        $('cityLoading').hidden=pendingDetails.size===0;cityInfo(place);
      }catch(error){close();onError(error);}
    });return true;
  }
  function openMap(viewport=getViewport()){
    if(!available().length||!viewport)return false;
    showScreen();const token=request,origin=context;city=null;
    $('cityTitle').textContent='Explore map';$('citySummary').textContent=`Year ${number(context.frame.year)} · Zoom toward a town or city`;
    schedule(()=>{
      if(token!==request||context!==origin)return;
      try{
        ensureView();$('cityCanvas').style.visibility='visible';view.setActive(true);view.show(null,{context:scene,viewport});
        $('cityLoading').hidden=pendingDetails.size===0;$('cityReset').disabled=true;
      }catch(error){close();onError(error);}
    });return true;
  }
  function setContext(next){
    const changed=context.world!==next.world||context.history!==next.history||context.frame!==next.frame||context.enabled!==next.enabled||context.busy!==next.busy;
    if(changed){close({restoreFocus:false});cache.clear();scene=null;context=next;}
    $('openCities').hidden=!next.enabled;$('openCities').disabled=!available().length;
    $('exploreMap').hidden=!next.enabled;$('exploreMap').disabled=!available().length;
  }
  $('exploreMap').onclick=()=>openMap();$('cityPanelToggle').onclick=()=>setPanel($('cityDistrictBody').hidden);
  $('openCities').onclick=showChooser;$('closeCityChooser').onclick=()=>close();
  $('citySearch').oninput=renderChoices;$('cityBack').onclick=()=>close();
  $('cityDistrict').onchange=()=>selectDistrict($('cityDistrict').value);
  $('cityZoomIn').onclick=()=>view?.zoomBy(1.6);$('cityZoomOut').onclick=()=>view?.zoomBy(1/1.6);$('cityReset').onclick=()=>view?.reset();
  document.addEventListener('keydown',event=>{
    if(!modal)return;
    if(event.key==='Escape'){event.preventDefault();close();return;}
    if(event.key!=='Tab')return;
    const focusable=[...modal.querySelectorAll('button:not(:disabled),select:not(:disabled),input:not(:disabled),summary')].filter(e=>e.getClientRects().length);
    const first=focusable[0],last=focusable.at(-1);
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
  });
  return {setContext,open,openMap,close,showChooser,get current(){return city;}};
}
