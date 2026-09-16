export const ATLAS_MENU_SECTIONS=Object.freeze(['explore','build','history','layers','world','tools']);
export const CITY_MENU_SECTIONS=Object.freeze(['detail','places','layers','tools']);

const LABELS={explore:'Explore',build:'Build',history:'History',layers:'Layers',world:'World',tools:'Tools',detail:'Detail',places:'Places'};
const sectionsFor=context=>context==='city'?CITY_MENU_SECTIONS:ATLAS_MENU_SECTIONS;

export function reduceMenuState(state,action){
  if(!state||!action)return state;
  if(action.type==='toggle-menu'){
    if(state.open)return{...state,open:false,panelOpen:false};
    const active=sectionsFor(state.context).includes(state.last?.[state.context])?state.last[state.context]:sectionsFor(state.context)[0];
    return{...state,open:true,panelOpen:true,active};
  }
  if(action.type==='select'){
    if(!sectionsFor(state.context).includes(action.section))return state;
    if(state.open&&state.panelOpen&&state.active===action.section)return{...state,panelOpen:false};
    return{...state,open:true,panelOpen:true,active:action.section,last:{...state.last,[state.context]:action.section}};
  }
  if(action.type==='context'){
    if(!['atlas','city'].includes(action.context))return state;
    const active=sectionsFor(action.context).includes(state.last?.[action.context])?state.last[action.context]:sectionsFor(action.context)[0];
    return{...state,context:action.context,active};
  }
  return state;
}

function closestControl(element){
  if(!element)return null;
  return element.closest?.('.row,.check,.two,.info-card,details')||element;
}

function button(document,id,label,section){
  const el=document.createElement('button');el.type='button';el.id=id;el.className='world-menu-rail-button';el.dataset.menuSection=section;el.textContent=label;el.setAttribute('aria-expanded','false');return el;
}

export function installWorldMenu({document=globalThis.document}={}){
  if(!document?.body)return null;
  const menu=document.getElementById('menu');
  if(!menu)return null;
  if(menu.__worldMenuController)return menu.__worldMenuController;

  const original=[...menu.childNodes];
  menu.replaceChildren();menu.classList.add('menu-shell');
  const rail=document.createElement('nav');rail.id='worldMenuRail';rail.className='world-menu-rail';rail.setAttribute('aria-label','Map menu categories');
  const panel=document.createElement('section');panel.id='worldMenuPanel';panel.className='world-menu-panel';panel.setAttribute('aria-live','polite');
  const panelHead=document.createElement('div');panelHead.className='world-menu-panel-head';
  const panelTitle=document.createElement('h2');panelTitle.id='worldMenuTitle';
  const panelClose=document.createElement('button');panelClose.type='button';panelClose.className='world-menu-panel-close';panelClose.textContent='×';panelClose.setAttribute('aria-label','Collapse submenu');
  panelHead.append(panelTitle,panelClose);
  const panelBody=document.createElement('div');panelBody.className='world-menu-panel-body';panel.append(panelHead,panelBody);menu.append(rail,panel);

  const panelSections=new Map(),railButtons=new Map();
  for(const section of [...new Set([...ATLAS_MENU_SECTIONS,...CITY_MENU_SECTIONS])]){
    const b=button(document,`worldMenu-${section}`,LABELS[section],section);rail.append(b);railButtons.set(section,b);
    const body=document.createElement('section');body.className='world-menu-section';body.dataset.menuPanel=section;body.hidden=true;panelBody.append(body);panelSections.set(section,body);
  }
  const group=(section,context='both')=>{const el=document.createElement('div');el.className='world-menu-group';el.dataset.menuContext=context;panelSections.get(section).append(el);return el;};
  const atlas={explore:group('explore','atlas'),build:group('build','atlas'),history:group('history','atlas'),layers:group('layers','atlas'),world:group('world','atlas'),tools:group('tools','atlas')};
  const city={detail:group('detail','city'),places:group('places','city'),layers:group('layers','city'),tools:group('tools','city')};

  const historySettings=original.find(node=>node?.id==='historySettings');
  if(historySettings)atlas.history.append(historySettings);
  for(const node of original){if(node!==historySettings)atlas.world.append(node);}

  const move=(id,target,{closest=false}={})=>{const el=document.getElementById(id);if(!el)return null;const node=closest?closestControl(el):el;if(node&&node!==target&&!target.contains(node))target.append(node);return node;};
  for(const id of ['newWindow','parentMap','exploreMap','openCities'])move(id,atlas.explore);
  move('inspect',atlas.explore);
  move('placeCard',atlas.explore);

  const dock=document.querySelector('.dock');
  if(dock){
    const stages=dock.querySelector('nav');if(stages)atlas.build.append(stages);
    const progress=dock.querySelector('.progress');if(progress)atlas.build.append(progress);
    move('stageDescription',atlas.build);const playRow=dock.querySelector('.play-row');if(playRow)atlas.build.append(playRow);
    move('historyTimeline',atlas.history);
    dock.hidden=true;
  }

  for(const id of ['mapView','trueScale'])move(id,atlas.layers);
  move('legendToggle',atlas.layers);move('legend',atlas.layers);move('terrainStats',atlas.layers);
  for(const id of ['mapMode','showRivers','showNavigable','showStrategic','showReference','showLabels','showPopulation','populationYear','exaggerate','exaggeration'])move(id,atlas.layers,{closest:true});

  move('openBenchmarks',atlas.tools);move('reset',atlas.tools,{closest:true});move('export',atlas.tools);
  const dataDetails=[...atlas.world.querySelectorAll('details')].at(-1);if(dataDetails)atlas.tools.append(dataDetails);

  const cityDetail=document.querySelector('.city-detail-controls');if(cityDetail)city.detail.append(cityDetail);
  move('cityScale',city.detail);
  move('cityDistrictPanel',city.places);
  const cityKey=document.querySelector('.city-key');if(cityKey)city.layers.append(cityKey);
  const cityReset=document.createElement('button');cityReset.type='button';cityReset.className='action';cityReset.textContent='Reset city view';cityReset.onclick=()=>document.getElementById('cityReset')?.click();city.tools.append(cityReset);
  const cityToolsNote=document.createElement('p');cityToolsNote.className='note';cityToolsNote.textContent='Zoom controls stay on the map; reset and exports live here or with the selected place.';city.tools.append(cityToolsNote);

  const cityScreen=document.getElementById('cityScreen');
  let cityMenuToggle=document.getElementById('cityMenuToggle');
  if(cityScreen&&!cityMenuToggle){cityMenuToggle=document.createElement('button');cityMenuToggle.id='cityMenuToggle';cityMenuToggle.type='button';cityMenuToggle.className='action glass';cityMenuToggle.textContent='☰';cityMenuToggle.setAttribute('aria-label','Map menu');cityScreen.append(cityMenuToggle);}

  let state={open:!menu.hidden,panelOpen:!menu.hidden,context:document.body.dataset.city==='true'?'city':'atlas',active:'explore',last:{atlas:'explore',city:'detail'}};
  state={...state,active:state.context==='city'?'detail':'explore'};

  function render(){
    const available=sectionsFor(state.context);
    for(const [section,b] of railButtons){const visible=available.includes(section);b.hidden=!visible;b.setAttribute('aria-expanded',String(visible&&state.panelOpen&&state.active===section));}
    for(const [section,body] of panelSections)body.hidden=!(state.panelOpen&&available.includes(section)&&state.active===section);
    for(const el of menu.querySelectorAll('[data-menu-context]'))el.hidden=el.dataset.menuContext!=='both'&&el.dataset.menuContext!==state.context;
    panel.hidden=!state.panelOpen;panelTitle.textContent=LABELS[state.active]||'Menu';menu.dataset.menuContext=state.context;menu.dataset.panelOpen=String(state.panelOpen);
    if(cityMenuToggle){cityMenuToggle.hidden=state.context!=='city';cityMenuToggle.setAttribute('aria-expanded',String(!menu.hidden));}
    const mainToggle=document.getElementById('menuToggle');if(mainToggle)mainToggle.setAttribute('aria-expanded',String(!menu.hidden));
  }
  function select(section){state=reduceMenuState({...state,open:true},{type:'select',section});render();}
  function show(section){if(!sectionsFor(state.context).includes(section))return false;state={...state,open:true,panelOpen:true,active:section,last:{...state.last,[state.context]:section}};menu.hidden=false;render();return true;}
  function setContext(context){state=reduceMenuState(state,{type:'context',context});render();}
  function syncOpen(){const open=!menu.hidden;state={...state,open,panelOpen:open?true:false};render();}
  for(const [section,b] of railButtons)b.onclick=()=>select(section);
  panelClose.onclick=()=>{state={...state,panelOpen:false};render();};
  if(cityMenuToggle)cityMenuToggle.onclick=()=>document.getElementById('menuToggle')?.click();

  const observer=typeof MutationObserver!=='undefined'?new MutationObserver(records=>{for(const r of records){if(r.target===menu&&r.attributeName==='hidden')syncOpen();if(r.target===document.body&&r.attributeName==='data-city')setContext(document.body.dataset.city==='true'?'city':'atlas');}}):null;
  observer?.observe(menu,{attributes:true,attributeFilter:['hidden']});observer?.observe(document.body,{attributes:true,attributeFilter:['data-city']});
  render();
  const controller={select,show,setContext,get state(){return state;},destroy(){observer?.disconnect();}};
  menu.__worldMenuController=controller;return controller;
}
