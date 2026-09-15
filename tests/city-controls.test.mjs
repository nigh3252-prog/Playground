import test from 'node:test';
import assert from 'node:assert/strict';
import {createCityControls} from '../assets/world-lab/city-controls.mjs';

class Element{
  constructor(){this.children=[];this.textContent='';this.disabled=false;this.hidden=false;this.value='';this.dataset={};this.style={};}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=children;}
  add(child){this.append(child);}
  setAttribute(key,value){this[key]=value;}
  focus(){}
}

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
