import test from 'node:test';
import assert from 'node:assert/strict';
import {createHistoryControls} from '../assets/world-lab/history-controls.mjs';

// Minimal DOM surface for the controls' state transitions, without a browser or
// dependencies. Saved event handlers stand in for a queued click during reroll.
class Element{
  constructor(){this.children=[];this.textContent='';this.disabled=false;this.hidden=false;this.value='';}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=children;}
  add(child){this.children.push(child);}
  setAttribute(key,value){this[key]=value;}
}
test('reroll clears old history and ignores queued events from the replaced result',t=>{
  const elements=new Map(),oldDocument=globalThis.document,oldOption=globalThis.Option;
  const get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  globalThis.document={getElementById:get,createElement:()=>new Element()};
  globalThis.Option=class extends Element{constructor(label,value){super();this.textContent=label;this.value=value;}};
  t.after(()=>{if(oldDocument===undefined)delete globalThis.document;else globalThis.document=oldDocument;if(oldOption===undefined)delete globalThis.Option;else globalThis.Option=oldOption;});
  const calls=[],controls=createHistoryControls({onDate:g=>calls.push(['date',g]),onSelect:id=>calls.push(['site',id]),onGenerate(){},onPaint(){},onOptions(){}});
  const world={parentDomain:{},mesh:{x:[5],z:[5]}},box={x:0,z:0,size:10};
  const frame={generation:0,year:0,siteStates:[{siteId:0,population:100,status:'village'}],events:[{id:0,generation:0,year:0,siteIds:[0],text:'Oldford was founded.'}],summary:{population:100,settlements:1,abandoned:0}};
  const data={generations:4,sites:[{id:0,nodeId:0,name:'Oldford',founded:0}],snapshots:[frame]};
  controls.render({world,data,generation:0,box,enabled:true});
  const oldButton=get('historyEvents').children[0];
  oldButton.onclick();assert.deepEqual(calls,[['date',0],['site',0]]);calls.length=0;
  controls.render({world,data:null,generation:4,box,enabled:true,busy:true});
  assert.equal(get('historyEvents').children.length,0);
  assert.equal(get('historyPlace').children.length,1);
  assert.equal(get('placeCard').hidden,true);
  assert.ok(!get('historySummary').textContent.includes('100'));
  oldButton.onclick();assert.deepEqual(calls,[]);
  controls.render({world,data:{...data},generation:0,box,enabled:true});
  oldButton.onclick();assert.deepEqual(calls,[]);
  get('historyEvents').children[0].onclick();assert.deepEqual(calls,[['date',0],['site',0]]);
  controls.stop();
});

test('modern controls show separate city and rural totals, open a dated city and clear it during regeneration',t=>{
  const elements=new Map(),oldDocument=globalThis.document,oldOption=globalThis.Option;
  const get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  globalThis.document={getElementById:get,createElement:()=>new Element()};
  globalThis.Option=class extends Element{constructor(label,value){super();this.textContent=label;this.value=value;}};
  t.after(()=>{if(oldDocument===undefined)delete globalThis.document;else globalThis.document=oldDocument;if(oldOption===undefined)delete globalThis.Option;else globalThis.Option=oldOption;});
  const opened=[],controls=createHistoryControls({onDate(){},onSelect(){},onGenerate(){},onPaint(){},onOptions(){},onOpenCity:id=>opened.push(id)});
  const world={parentDomain:{},mesh:{x:[5],z:[5]}},box={x:0,z:0,size:10};
  const frame={generation:24,year:600,era:'modern',eraLabel:'Contemporary',siteStates:[{siteId:0,groupId:0,population:720000,status:'city',urbanAreaKm2:240,densityPerKm2:3000}],events:[],routeStates:[],summary:{population:1000000,urbanPopulation:720000,ruralPopulation:280000,densityPerKm2:52.3,settlements:1,abandoned:0}};
  const data={generations:24,earlyGenerations:12,yearsPerGeneration:25,groups:[{name:'River Assembly'}],routes:[],sites:[{id:0,nodeId:0,name:'River Exchange',nameOrigin:'Named for the river crossing.',founded:0}],snapshots:Array.from({length:25},(_,generation)=>({...frame,generation,events:[]}))};
  controls.render({world,data,generation:24,box,enabled:true,selectedSite:0});
  assert.match(get('historySummary').textContent,/1,000,000 people/);
  assert.match(get('historyPopulationBreakdown').textContent,/720,000 urban.*280,000 rural.*52.3 people\/km²/);
  assert.equal(get('historyEraLabel').textContent,'Contemporary');
  assert.equal(get('historyDate').max,'24');
  assert.equal(get('openCity').disabled,false);
  assert.match(get('placeNameOrigin').textContent,/river crossing/);
  assert.match(get('placeFacts').textContent,/240 km² urban.*3,000 people\/km²/);
  const queued=get('openCity').onclick;
  queued();assert.deepEqual(opened,[0]);
  controls.render({world,data:null,generation:24,box,enabled:true,busy:true});
  queued();assert.deepEqual(opened,[0]);
  assert.equal(get('openCity').disabled,true);
  assert.equal(get('historyPopulationBreakdown').textContent,'');
  controls.stop();
});
