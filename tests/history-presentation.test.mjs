import test from 'node:test';
import assert from 'node:assert/strict';
import {visibleHistorySites, nearestHistorySite, visibleHistoryRoutes, describeHistoryPlace, historyNodeColor} from '../assets/world-lab/history-presentation.mjs';

const world = {mesh:{x:[5,8,60,6],z:[5,8,60,6]},stepKm:2,ocean:[0,0,0,1],lake:[0,0,0,0]};
const box = {x:0,z:0,size:20};
const history = {
  yearsPerGeneration:25, groups:[{id:0,name:'Reedfolk',color:'#e6b275'}],
  sites:[{id:0,nodeId:0,name:'Reedbank',founded:0,reason:'A river crossing'}, {id:1,nodeId:1,name:'Newstead',founded:2}, {id:2,nodeId:2,name:'Farbank',founded:0}],
  routes:[{id:0,a:0,b:2,founded:0,nodes:[0,2],kind:'land'}, {id:1,a:0,b:1,founded:2,nodes:[0,1],kind:'land'}],
  snapshots:[
    {generation:0,year:0,siteStates:[{siteId:0,population:400,peakPopulation:400,status:'village',groupId:0},{siteId:2,population:200,status:'village',groupId:0}],routeStates:[{routeId:0,active:true,traffic:50}],events:[{id:0,generation:0,year:0,siteIds:[0],text:'Reedbank founded.'}]},
    {generation:1,year:25,siteStates:[{siteId:0,population:0,peakPopulation:400,status:'abandoned',groupId:0},{siteId:2,population:220,status:'village',groupId:0}],routeStates:[{routeId:0,active:false,traffic:0,lastUsed:0}],events:[{id:1,generation:1,year:25,siteIds:[0],text:'Reedbank abandoned.'}]},
    {generation:2,year:50,siteStates:[{siteId:0,population:100,peakPopulation:400,status:'village',groupId:0},{siteId:1,population:50,status:'village',groupId:0}],routeStates:[{routeId:1,active:true,traffic:10}],events:[{id:2,generation:2,year:50,siteIds:[0,1],text:'Families returned.'}]}
  ]
};

test('visible sites and tap targets exclude future and off-window places',()=>{
  const frame=history.snapshots[0];
  assert.deepEqual(visibleHistorySites(world,history,frame,box).map(p=>p.site.id),[0]);
  assert.equal(nearestHistorySite(world,history,frame,1,box,8),0);
  assert.equal(nearestHistorySite(world,history,frame,2,box,100),-1);
  assert.equal(nearestHistorySite(world,history,frame,1,box,1),-1);
  assert.equal(nearestHistorySite(world,history,history.snapshots[1],0,box,8),0);
});

test('routes honor their date and optional abandoned traces',()=>{
  assert.deepEqual(visibleHistoryRoutes(history,history.snapshots[0]).map(p=>p.route.id),[0]);
  assert.equal(visibleHistoryRoutes(history,history.snapshots[1]).length,1);
  assert.equal(visibleHistoryRoutes(history,history.snapshots[1],false).length,0);
});

test('place card reconstructs the viewed past without later population or events',()=>{
  const old=describeHistoryPlace(history,history.snapshots[0],0);
  assert.equal(old.age,0);
  assert.equal(old.state.population,400);
  assert.equal(old.events.length,1);
  assert.equal(old.traces.length,0);
  assert.equal(describeHistoryPlace(history,history.snapshots[0],1),null);
  const abandoned=describeHistoryPlace(history,history.snapshots[1],0);
  assert.equal(abandoned.age,25);
  assert.equal(abandoned.state.status,'abandoned');
  assert.equal(abandoned.events.length,2);
  assert.equal(abandoned.traces.length,1);
  assert.equal(describeHistoryPlace(history,history.snapshots[2],0).events.length,3);
});

test('land-use and influence tints leave water unchanged and remain optional',()=>{
  const base=[80,110,75],frame={cultivation:[.7,.7,.7,.7],settled:[1,1,1,1],woodland:[.2,.2,.2,.2],influence:[0,0,0,0]};
  assert.deepEqual(historyNodeColor(base,world,history,frame,3,{landUse:true,influence:true}),base);
  assert.deepEqual(historyNodeColor(base,world,history,frame,0,{}),base);
  assert.notDeepEqual(historyNodeColor(base,world,history,frame,0,{landUse:true}),base);
  assert.notDeepEqual(historyNodeColor(base,world,history,frame,0,{influence:true}),base);
  assert.deepEqual(base,[80,110,75]);
});

test('modern built fractions change urban land coloring without painting water or empty countryside',()=>{
  const base=[80,110,75],frame={cultivation:[0,0,0,0],settled:[0,0,0,0],woodland:[1,1,1,1],influence:[-1,-1,-1,-1],urbanFraction:[0,.2,.7,.8]};
  const tint=id=>historyNodeColor(base,world,history,frame,id,{landUse:true});
  assert.deepEqual(tint(0),base);
  assert.notDeepEqual(tint(1),base);
  assert.ok(tint(2)[0]>tint(1)[0]);
  assert.deepEqual(tint(3),base);
});
