import test from 'node:test';
import assert from 'node:assert/strict';
import {createCityControls} from '../assets/world-lab/city-controls.mjs';
import {createCityView} from '../assets/world-lab/city-view.mjs';

class Element{
  constructor(){this.children=[];this.textContent='';this.disabled=false;this.hidden=false;this.value='';this.dataset={};this.style={};}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=children;}
  add(child){this.append(child);}
  setAttribute(key,value){this[key]=value;}
  focus(){}
}

class TestCanvas extends EventTarget{
  constructor(){super();this.style={};}
  getBoundingClientRect(){return{left:0,top:0,width:400,height:300};}
  getContext(){return null;}
  setPointerCapture(){}
  releasePointerCapture(){}
}

function areaExplorer(t){
  const oldDocument=globalThis.document,oldOption=globalThis.Option,elements=new Map();
  const get=id=>{if(!elements.has(id))elements.set(id,id==='cityCanvas'?new TestCanvas():new Element());return elements.get(id);};
  globalThis.document={getElementById:get,createElement:()=>new Element(),addEventListener(){},body:{dataset:{},children:[]}};
  globalThis.Option=class extends Element{constructor(label,value){super();this.textContent=label;this.value=value;}};
  const history={sites:[{id:0,name:'Selected',nameOrigin:'Old crossing',founded:0},{id:1,name:'Neighbor',founded:0}]};
  const frame={generation:2,year:50,siteStates:[{siteId:0,population:100},{siteId:1,population:100}]};
  const sites=[{id:0,name:'Selected',point:{x:100,z:100},radiusKm:2},{id:1,name:'Neighbor',point:{x:500,z:500},radiusKm:2}];
  const context={world:{},history,frame,enabled:true,busy:false},queued=[];let view;
  const controls=createCityControls({
    schedule:fn=>queued.push(fn),
    buildContext:()=>({bounds:{x:0,z:0,size:1000},sites,routes:[],rivers:[]}),
    buildCity:(w,h,f,id,{detail})=>{
      const center=sites[id].point,bounds={x:center.x-5,z:center.z-5,size:10};
      const polygon=[{x:bounds.x,z:bounds.z},{x:bounds.x+10,z:bounds.z},{x:bounds.x+10,z:bounds.z+10},{x:bounds.x,z:bounds.z+10}];
      return{siteId:id,name:h.sites[id].name,population:100,areaKm2:100,densityPerKm2:1,bounds,center,detailLevel:detail,
        districts:[{id:7,name:'Center',kind:'downtown',center,population:100,areaKm2:100,densityPerKm2:1,boundary:[]}],
        blocks:[{id:0,districtId:7,kind:'downtown',polygon,center}],roads:[],buildings:[],terrain:{patches:[],water:[]}};
    },
    createView:(canvas,options)=>(view=createCityView(canvas,options)),
  });
  t.after(()=>{view?.destroy();if(oldDocument===undefined)delete globalThis.document;else globalThis.document=oldDocument;if(oldOption===undefined)delete globalThis.Option;else globalThis.Option=oldOption;});
  controls.setContext(context);
  return{controls,context,get,get view(){return view;},flush(){while(queued.length)queued.shift()();}};
}

test('Window keeps its terrain disclosure visible when the next detail needs a closer zoom',t=>{
  const h=areaExplorer(t);
  h.controls.openMap({center:{x:300,z:300},kmAcross:30});h.flush();
  assert.equal(h.controls.loadArea('window'),true);h.flush();
  assert.equal(h.get('cityScreen').hidden,false);assert.equal(h.get('cityDetailHint').hidden,false);
  assert.match(h.get('cityDetailHint').textContent,/same terrain/i);
  h.view.setViewport({center:{x:300,z:300},kmAcross:600});
  assert.match(h.get('cityDetailHint').textContent,/same terrain/i);
  assert.match(h.get('cityDetailHint').textContent,/zoom closer/i);
  assert.equal(h.controls.loadArea('metro'),false);
  assert.match(h.get('cityDetailHint').textContent,/same terrain/i);
});

for(const detail of ['metro','streets'])test(`${detail} area loads clear an offscreen city from controls and map selection`,t=>{
  const h=areaExplorer(t);h.controls.open(0);h.flush();
  h.view.setViewport({center:{x:500,z:500},kmAcross:30});const before=h.view.getView();
  assert.equal(h.controls.loadArea(detail),true);h.flush();
  assert.equal(h.controls.current,null);
  assert.equal(h.get('cityTitle').textContent,detail==='metro'?'Metro overview':'Street map');
  assert.match(h.get('citySummary').textContent,/1 places? in this area/);
  assert.equal(h.get('cityDistrictPanel').hidden,true);assert.equal(h.get('cityDistrict').disabled,true);
  assert.equal(h.get('cityNameOrigin').textContent,'');assert.equal(h.get('cityModelNote').textContent,'');
  assert.deepEqual(h.view.getView().center,before.center);assert.ok(Math.abs(h.view.getView().kmAcross-before.kmAcross)<1e-9);
  // A stale view selection swallows this tap as a district choice instead of
  // reopening the old place after the controls have cleared their selection.
  h.view.setViewport({center:{x:100,z:100},kmAcross:30});
  for(const type of ['pointerdown','pointerup']){const event=new Event(type,{cancelable:true});Object.assign(event,{pointerId:1,clientX:200,clientY:150,button:0});h.get('cityCanvas').dispatchEvent(event);}
  h.flush();assert.equal(h.controls.current?.siteId,0);assert.equal(h.get('cityTitle').textContent,'Selected');
});

for(const detail of ['parent','window'])test(`${detail} uses an area title after leaving a selected city`,t=>{
  const h=areaExplorer(t);h.controls.open(0);h.flush();const before=h.view.getView();
  assert.equal(h.controls.loadArea(detail),true);h.flush();
  assert.equal(h.get('cityTitle').textContent,detail==='parent'?'Parent map':'Window map');
  assert.equal(h.controls.current,null);assert.equal(h.get('cityDistrictPanel').hidden,true);
  assert.deepEqual(h.view.getView().center,before.center);assert.ok(Math.abs(h.view.getView().kmAcross-before.kmAcross)<1e-9);
});

test('returning to Parent cancels a pending place selection',t=>{
  const h=areaExplorer(t);h.controls.open(0);h.flush();
  h.view.setViewport({center:{x:500,z:500},kmAcross:30});
  for(const type of ['pointerdown','pointerup']){const event=new Event(type,{cancelable:true});Object.assign(event,{pointerId:1,clientX:200,clientY:150,button:0});h.get('cityCanvas').dispatchEvent(event);}
  assert.equal(h.get('cityLoading').hidden,false);
  assert.equal(h.controls.loadArea('parent'),true);h.flush();
  assert.equal(h.controls.current,null);assert.equal(h.controls.detailLevel,'parent');
  assert.equal(h.get('cityTitle').textContent,'Parent map');assert.equal(h.get('cityLoading').hidden,true);
});

test('area refinement retains a selected city whose footprint is still in the request',t=>{
  const h=areaExplorer(t);h.controls.open(0);h.flush();
  h.view.setViewport({center:{x:107,z:100},kmAcross:5});const before=h.view.getView();
  assert.equal(h.controls.loadArea('metro'),true);h.flush();
  assert.equal(h.controls.current?.siteId,0);assert.equal(h.controls.current.detailLevel,'metro');
  assert.equal(h.get('cityTitle').textContent,'Selected');assert.equal(h.get('cityDistrictPanel').hidden,false);
  assert.deepEqual(h.view.getView().center,before.center);assert.ok(Math.abs(h.view.getView().kmAcross-before.kmAcross)<1e-9);
});

test('Explore map stays available for ready countryside after returning to the atlas',t=>{
  const h=areaExplorer(t);
  for(const siteStates of [[],[{siteId:0,population:0,status:'abandoned'}]]){
    h.controls.setContext({...h.context,frame:{...h.context.frame,siteStates}});
    assert.equal(h.get('openCities').disabled,true);assert.equal(h.get('exploreMap').disabled,false);
    h.get('exploreMap').onclick();h.flush();assert.equal(h.get('cityScreen').hidden,false);
    h.get('cityBack').onclick();assert.equal(h.get('cityScreen').hidden,true);
    assert.equal(h.get('exploreMap').disabled,false);
    h.get('exploreMap').onclick();h.flush();assert.equal(h.get('cityScreen').hidden,false);
    assert.equal(h.controls.loadArea('window'),true);h.flush();assert.equal(h.controls.detailLevel,'window');
  }
});

test('Explore map is unavailable until its dated context is ready',t=>{
  const h=areaExplorer(t);
  for(const missing of [{world:null},{history:null},{frame:null},{enabled:false},{busy:true}]){
    h.controls.setContext({...h.context,...missing});
    assert.equal(h.get('exploreMap').disabled,true);assert.equal(h.controls.openMap(),false);
  }
});

test('area detail is explicit, reuses overlapping requests, and cancels queued refinement',t=>{
 const oldDocument=globalThis.document,oldOption=globalThis.Option,elements=new Map();
 const get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
 globalThis.document={getElementById:get,createElement:()=>new Element(),addEventListener(){},body:{dataset:{},children:[]}};
 globalThis.Option=class extends Element{constructor(label,value){super();this.textContent=label;this.value=value;}};
 t.after(()=>{globalThis.document=oldDocument;globalThis.Option=oldOption;});
 const queued=[],built=[],shown=[],levels=[],added=[],viewport={center:{x:500,z:500},kmAcross:30,kmHigh:60};let callbacks;
 const controls=createCityControls({schedule:fn=>queued.push(fn),buildContext:()=>({bounds:{x:0,z:0,size:1000},sites:[{id:0,point:{x:500,z:500},radiusKm:4},{id:1,point:{x:521,z:500},radiusKm:4}]}),buildCity:(w,h,f,id,options)=>{built.push({id,detail:options.detail});return{siteId:id,name:h.sites[id].name,population:100,areaKm2:2,densityPerKm2:50,bounds:{x:490,z:490,size:30},districts:[],detailLevel:options.detail};},createView:(canvas,options)=>{callbacks=options;return{show:(c,o)=>shown.push(o),setActive(){},setDetailLevel:l=>levels.push(l),getView:()=>viewport,addCity:c=>added.push(c),setCity(){},selectDistrict(){}};}});
 const history={sites:[{id:0,name:'Center',founded:0},{id:1,name:'Edge',founded:0}]},frame={generation:2,year:50,siteStates:[{siteId:0,population:100},{siteId:1,population:200}]};
 controls.setContext({world:{},history,frame,enabled:true,busy:false});controls.openMap(viewport);while(queued.length)queued.shift()();
 assert.deepEqual(built,[]);assert.equal(callbacks.autoDetail,false);
 assert.equal(typeof controls.loadArea,'function');assert.equal(controls.loadArea('metro'),true);
 assert.equal(get('cityLoading').hidden,false);while(queued.length)queued.shift()();
 assert.deepEqual(built,[{id:0,detail:'metro'},{id:1,detail:'metro'}]);assert.equal(levels.at(-1),'metro');
 assert.deepEqual(viewport,{center:{x:500,z:500},kmAcross:30,kmHigh:60});
 controls.loadArea('metro');while(queued.length)queued.shift()();assert.equal(built.length,2,'same dated plans are reused');
 controls.loadArea('streets');controls.close();while(queued.length)queued.shift()();assert.equal(built.length,2,'cancelled work does not generate roofs');
 controls.openMap(viewport);while(queued.length)queued.shift()();controls.loadArea('streets');while(queued.length)queued.shift()();
 assert.equal(built.length,4);assert.equal(levels.at(-1),'streets');
});

test('city selection stays dated and pending work cannot reopen a city after reroll or Back',t=>{
  const oldDocument=globalThis.document,oldOption=globalThis.Option,elements=new Map();
  const get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  globalThis.document={getElementById:get,createElement:()=>new Element(),addEventListener(){},body:{dataset:{},children:[]}};
  globalThis.Option=class extends Element{constructor(label,value){super();this.textContent=label;this.value=value;}};
  t.after(()=>{if(oldDocument===undefined)delete globalThis.document;else globalThis.document=oldDocument;if(oldOption===undefined)delete globalThis.Option;else globalThis.Option=oldOption;});
  const queued=[],built=[],shown=[],selected=[],opened=[];
  const controls=createCityControls({schedule:fn=>queued.push(fn),onOpen:id=>opened.push(id),buildCity:(w,h,f,id)=>{built.push(id);return {siteId:id,name:h.sites[id].name,population:100,areaKm2:2,densityPerKm2:50,bounds:{size:8},districts:[{id:0,name:'Center',kind:'downtown',population:60,areaKm2:1,densityPerKm2:60},{id:1,name:'East',kind:'residential',population:40,areaKm2:1,densityPerKm2:40}]};},createView:()=>({show:c=>shown.push(c),setActive(){},resize(){},selectDistrict:id=>selected.push(id),zoomBy(){},reset(){}})});
  const world={},history={sites:[{id:0,name:'Exchange',founded:0},{id:1,name:'Later',founded:4},{id:2,name:'Empty',founded:0}]};
  const frame={generation:2,year:50,eraLabel:'Early settlements',siteStates:[{siteId:0,population:100,status:'town'},{siteId:1,population:1000,status:'city'},{siteId:2,population:0,status:'abandoned'}]};
  const context={world,history,frame,enabled:true,busy:false};
  controls.setContext(context);controls.showChooser();
  assert.equal(get('cityList').children.length,1);
  const staleRow=get('cityList').children[0];
  assert.equal(controls.open(1),false);assert.equal(controls.open(2),false);
  assert.equal(controls.open(0),true);
  controls.setContext({...context,history:null,frame:null,busy:true});
  queued.shift()();staleRow.onclick();
  assert.deepEqual(built,[]);assert.deepEqual(opened,[]);
  assert.equal(get('cityScreen').hidden,true);assert.equal(get('cityChooser').hidden,true);
  controls.setContext(context);controls.open(0);controls.close();queued.shift()();
  assert.deepEqual(shown,[]);
  controls.open(0);queued.shift()();
  assert.deepEqual(built,[0]);assert.deepEqual(opened,[0]);assert.equal(shown.length,1);
  get('cityDistrict').value='1';get('cityDistrict').onchange();
  assert.equal(get('cityDistrictName').textContent,'East');
  assert.match(get('cityDistrictFacts').textContent,/40 people/);
  assert.deepEqual(selected.at(-1),1);
  controls.setContext(context);assert.equal(get('cityScreen').hidden,false);
  controls.setContext({...context,frame:{...frame,generation:3,year:75}});
  assert.equal(get('cityScreen').hidden,true);
});

test('background neighborhood loads preserve the chosen city and stale map detail cannot reopen after Back',t=>{
 const oldDocument=globalThis.document,oldOption=globalThis.Option,elements=new Map();
 const get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
 globalThis.document={getElementById:get,createElement:()=>new Element(),addEventListener(){},body:{dataset:{},children:[]}};
 globalThis.Option=class extends Element{constructor(label,value){super();this.textContent=label;this.value=value;}};
 t.after(()=>{if(oldDocument===undefined)delete globalThis.document;else globalThis.document=oldDocument;if(oldOption===undefined)delete globalThis.Option;else globalThis.Option=oldOption;});
 const queued=[],opened=[],added=[],shown=[];let callbacks;
 const controls=createCityControls({schedule:fn=>queued.push(fn),buildContext:()=>({}),onOpen:id=>opened.push(id),buildCity:(w,h,f,id)=>({siteId:id,name:h.sites[id].name,population:100,areaKm2:2,densityPerKm2:50,bounds:{size:8},districts:[]}),createView:(canvas,options)=>{callbacks=options;return {show:(c,o)=>shown.push({c,o}),setActive(){},addCity:c=>added.push(c.siteId),setCity(){},selectDistrict(){}};}});
 const history={sites:[{id:0,name:'Selected',founded:0},{id:1,name:'Neighbor',founded:0}]},frame={generation:2,year:50,siteStates:[{siteId:0,population:100},{siteId:1,population:200}]};
 controls.setContext({world:{},history,frame,enabled:true,busy:false});controls.open(0);queued.shift()();
 callbacks.onDetailRequest(1);queued.shift()();
 assert.deepEqual(added,[1]);assert.deepEqual(opened,[0]);assert.equal(controls.current.siteId,0);assert.equal(get('cityTitle').textContent,'Selected');
 const viewport={center:{x:20,z:30},kmAcross:120};controls.openMap(viewport);queued.shift()();assert.equal(controls.current,null);assert.deepEqual(shown.at(-1).o.viewport,viewport);
 callbacks.onDetailRequest(1);controls.close();queued.shift()();assert.deepEqual(added,[1]);assert.equal(get('cityScreen').hidden,true);
});
