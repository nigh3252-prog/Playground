import test from 'node:test';
import assert from 'node:assert/strict';
import * as cityContext from '../assets/world-lab/city-context.mjs';
const {regionalCityContext}=cityContext;
import {AtlasView} from '../assets/world-lab/atlas-view.mjs';

test('local context retains exact parent connections and river geometry at the selected date',()=>{
 const world={config:{sizeKm:1200},mesh:{sizeKm:1200,x:[10,30,45,70],z:[40,42,80,99]},height:[10,15,8,0],receiver:[1,2,-1,-1],river:[1,1,0,0],ocean:[0,0,0,1],lake:[0,0,0,0],runoff:[4,25,0,0]};
 const history={sites:[{id:0,nodeId:0,name:'West',founded:0},{id:1,nodeId:2,name:'East',founded:0},{id:2,nodeId:1,name:'Future',founded:3}],routes:[{id:0,a:0,b:1,nodes:[0,1,2],founded:1,kind:'land'},{id:1,a:0,b:2,nodes:[0,1],founded:3,kind:'land'}]};
 const frame={year:50,generation:2,siteStates:[{siteId:0,population:5000,urbanAreaKm2:3},{siteId:1,population:9000,urbanAreaKm2:6},{siteId:2,population:1200}],routeStates:[{routeId:0,active:true,widthKm:.018,roadClass:'road'},{routeId:1,active:true}]};
 const before=structuredClone({world,history,frame}),c=regionalCityContext(world,history,frame);
 assert.deepEqual({world,history,frame},before);assert.deepEqual(c.sites.map(s=>s.id),[0,1]);
 assert.deepEqual(c.routes.map(r=>r.id),[0]);assert.deepEqual(c.routes[0].points,[{x:10,z:40},{x:30,z:42},{x:45,z:80}]);
 assert.deepEqual(c.rivers[1].points,[{x:30,z:42},{x:45,z:80}]);assert.equal(c.bounds.size,1200);
 assert.equal(c.routes[0].widthKm,.018,'draw the road width at this date');
});

test('a requested terrain window uses parent coordinates without changing the input viewport',()=>{
 assert.equal(typeof cityContext.regionalWindowContext,'function');
 const viewport={center:{x:900,z:80},kmAcross:120,kmHigh:240},world={mesh:{sizeKm:1000}};
 const window=cityContext.regionalWindowContext(world,null,viewport);
 assert.ok(window.bounds.x<=840&&window.bounds.x+window.bounds.size>=960);
 assert.equal(window.bounds.z,0);assert.ok(window.bounds.size<1000);
 assert.deepEqual(viewport,{center:{x:900,z:80},kmAcross:120,kmHigh:240});
});

test('window-to-local camera handoff accounts for cropped parent coordinates and fallback map scale',()=>{
 const view=Object.create(AtlasView.prototype);
 Object.assign(view,{box:{x:800,z:1200,size:1200},size:1200,target:[40,0,-90],width:400,height:800,gl:null,fallbackFrame:{size:300}});
 assert.deepEqual(view.getMapViewport(),{center:{x:1440,z:1710},kmAcross:1600});
 view.gl={};view.distance=400;assert.ok(Math.abs(view.getMapViewport().kmAcross-400*Math.tan(Math.PI/8))<1e-9);
});
