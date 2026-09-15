import test from 'node:test';
import assert from 'node:assert/strict';
import {createCityView} from '../assets/world-lab/city-view.mjs';

// EventTarget exercises the real pointer handlers. The drawing context is
// deliberately absent here; actual map pixels are checked in the preview.
class TestCanvas extends EventTarget{
 constructor(){super();this.style={};this.clientWidth=400;this.clientHeight=300;}
 getBoundingClientRect(){return{left:0,top:0,width:this.clientWidth,height:this.clientHeight};}
 getContext(){return null;}
 setPointerCapture(){}
 releasePointerCapture(){}
}
function pointer(canvas,type,id,x,y){const e=new Event(type,{cancelable:true});Object.assign(e,{pointerId:id,clientX:x,clientY:y,button:0});canvas.dispatchEvent(e);}
const polygon=[{x:0,z:0},{x:10,z:0},{x:10,z:10},{x:0,z:10}];
const city={bounds:{x:0,z:0,size:10},center:{x:5,z:5},districts:[{id:7,name:'Downtown',kind:'downtown',center:{x:5,z:5},population:9000,areaKm2:100,color:'#bcaa90',boundary:[]}],blocks:[{id:0,districtId:7,kind:'downtown',polygon,center:{x:5,z:5}}],roads:[],terrain:{patches:[],water:[]}};

test('explicit area mode never requests city geometry from zooming and keeps its camera between levels',()=>{
 const canvas=new TestCanvas(),requests=[],view=createCityView(canvas,{autoDetail:false,onDetailRequest:id=>requests.push(id)});
 view.show(null,{context:{bounds:{x:0,z:0,size:1200},sites:[{id:2,point:{x:600,z:400},radiusKm:5}],routes:[],rivers:[]},viewport:{center:{x:600,z:400},kmAcross:400},detailLevel:'parent'});
 view.zoomBy(10);assert.deepEqual(requests,[],'zoom alone must not build a city');
 const before=view.getView();assert.equal(typeof view.setDetailLevel,'function');view.setDetailLevel('metro');
 assert.deepEqual(view.getView().center,before.center);assert.equal(view.getView().kmAcross,before.kmAcross);
 assert.ok(Math.abs(view.getView().kmHigh-view.getView().kmAcross*.75)<1e-9);
 view.destroy();
});

test('lower detail levels hide already cached roofs and local streets without losing the principal roads',()=>{
 const previousRequest=globalThis.requestAnimationFrame,previousCancel=globalThis.cancelAnimationFrame,queued=[];
 globalThis.requestAnimationFrame=fn=>(queued.push(fn),queued.length);globalThis.cancelAnimationFrame=()=>{};
 const paths=[];let current=[];
 const ctx=new Proxy({beginPath(){current=[];},moveTo(x,y){current.push([x,y]);},lineTo(x,y){current.push([x,y]);},fill(){paths.push(JSON.stringify(current));},stroke(){paths.push(JSON.stringify(current));},measureText(){return{width:20};}},{get:(object,key)=>key in object?object[key]:(()=>{})});
 const canvas=new TestCanvas();canvas.getContext=()=>ctx;
 const local=[{x:1,z:1},{x:2,z:2}],major=[{x:6,z:6},{x:7,z:7}],roof=[{x:8,z:8},{x:8.2,z:8},{x:8.2,z:8.2},{x:8,z:8.2}];
 const encoded=points=>JSON.stringify(points.map(p=>[p.x,p.z])),draw=()=>{paths.length=0;while(queued.length)queued.shift()();};
 const view=createCityView(canvas,{autoDetail:false});
 try{
  view.show({...city,roads:[{kind:'local',points:local,widthKm:.006},{kind:'arterial',points:major,widthKm:.026}],buildings:[{polygon:roof,center:{x:8.1,z:8.1},areaKm2:.04,kind:'residential'}]});draw();
  assert.ok(paths.includes(encoded(local))&&paths.includes(encoded(roof)));
  view.setDetailLevel('metro');draw();assert.ok(paths.includes(encoded(major)));assert.ok(!paths.includes(encoded(local))&&!paths.includes(encoded(roof)));
  view.setDetailLevel('window');draw();assert.ok(!paths.includes(encoded(major))&&!paths.includes(encoded(roof)));
 }finally{view.destroy();if(previousRequest)globalThis.requestAnimationFrame=previousRequest;else delete globalThis.requestAnimationFrame;if(previousCancel)globalThis.cancelAnimationFrame=previousCancel;else delete globalThis.cancelAnimationFrame;}
});

// A screen/world transform error would make the same tap choose the wrong neighborhood after zoom.
test('city zoom reports the actual visible kilometers and district taps use map coordinates',()=>{
 const canvas=new TestCanvas(),selected=[],changes=[],view=createCityView(canvas,{onSelect:id=>selected.push(id),onChange:v=>changes.push(v)});
 view.show(city);const initial=view.getView();assert.ok(initial.kmAcross>10);
 view.zoomBy(2);assert.ok(Math.abs(view.getView().kmAcross-initial.kmAcross/2)<1e-9);
 pointer(canvas,'pointerdown',1,200,150);pointer(canvas,'pointerup',1,200,150);assert.deepEqual(selected,[7]);
 view.reset();assert.equal(view.getView().kmAcross,initial.kmAcross);assert.ok(changes.length>=3);
 view.destroy();
});

// Forgetting gesture suppression selects a district accidentally when a pan or pinch ends.
test('drag and pinch gestures move the city without producing a district tap',()=>{
 const canvas=new TestCanvas(),selected=[],view=createCityView(canvas,{onSelect:id=>selected.push(id)});view.show(city);
 const before=view.getView();pointer(canvas,'pointerdown',1,100,150);pointer(canvas,'pointermove',1,150,150);pointer(canvas,'pointerup',1,150,150);
 assert.notEqual(view.getView().center.x,before.center.x);assert.deepEqual(selected,[]);
 pointer(canvas,'pointerdown',2,100,150);pointer(canvas,'pointerdown',3,300,150);pointer(canvas,'pointermove',2,50,150);pointer(canvas,'pointermove',3,350,150);
 assert.ok(view.getView().zoom>1);pointer(canvas,'pointerup',2,50,150);pointer(canvas,'pointerup',3,350,150);assert.deepEqual(selected,[]);
 view.destroy();
});

// Keeping handlers alive behind the regional map would allow hidden-city gestures and leaked selections.
test('inactive and destroyed city views ignore pointer input and canceled gestures never select',()=>{
 const canvas=new TestCanvas(),selected=[],view=createCityView(canvas,{onSelect:id=>selected.push(id)});view.show(city);
 pointer(canvas,'pointerdown',1,200,150);pointer(canvas,'pointercancel',1,200,150);assert.deepEqual(selected,[]);
 view.setActive(false);const before=view.getView();pointer(canvas,'pointerdown',2,100,150);pointer(canvas,'pointermove',2,200,150);pointer(canvas,'pointerup',2,200,150);assert.deepEqual(view.getView(),before);
 view.setActive(true);pointer(canvas,'pointerdown',3,200,150);pointer(canvas,'pointerup',3,200,150);assert.deepEqual(selected,[7]);
 view.destroy();pointer(canvas,'pointerdown',4,200,150);pointer(canvas,'pointerup',4,200,150);assert.deepEqual(selected,[7]);
});

// A stale CSS-pixel extent breaks picking and the physical scale when a phone
// rotates or the desktop window changes width.
test('window resize keeps the center pick and visible-kilometer scale in sync and cleans up on destroy',()=>{
 const previous=globalThis.window,windowEvents=new EventTarget();globalThis.window=windowEvents;
 try{
  const canvas=new TestCanvas(),selected=[],view=createCityView(canvas,{onSelect:id=>selected.push(id)});view.show(city);const before=view.getView();
  canvas.clientWidth=800;windowEvents.dispatchEvent(new Event('resize'));
  assert.equal(view.getView().kmAcross,before.kmAcross*2);
  pointer(canvas,'pointerdown',1,400,150);pointer(canvas,'pointerup',1,400,150);assert.deepEqual(selected,[7]);
  const pixels=canvas.width;view.destroy();canvas.clientWidth=200;windowEvents.dispatchEvent(new Event('resize'));assert.equal(canvas.width,pixels);
 }finally{if(previous===undefined)delete globalThis.window;else globalThis.window=previous;}
});

test('regional handoff preserves parent coordinates and scale, and selecting a nearby town keeps that camera',()=>{
 const canvas=new TestCanvas(),chosen=[],view=createCityView(canvas,{onSelectSite:id=>chosen.push(id)});
 const context={bounds:{x:0,z:0,size:1200},sites:[{id:2,name:'Neighbor',point:{x:600,z:400},radiusKm:1}],routes:[],rivers:[]};
 const viewport={center:{x:600,z:400},kmAcross:240};
 view.show(null,{context,viewport});
 assert.deepEqual(view.getView().center,viewport.center);assert.equal(view.getView().kmAcross,240);
 pointer(canvas,'pointerdown',1,200,150);pointer(canvas,'pointerup',1,200,150);assert.deepEqual(chosen,[2]);
 view.setCity({...city,siteId:2,bounds:{x:595,z:395,size:10}});
 assert.deepEqual(view.getView().center,viewport.center);assert.equal(view.getView().kmAcross,240);
 view.zoomBy(2);assert.ok(Math.abs(view.getView().kmAcross-120)<1e-8);
 view.zoomBy(.01);assert.ok(view.getView().kmAcross>1000,'zoom out reveals the surrounding region');
 view.destroy();
});

test('zooming toward a visible settlement requests its detail without moving the camera or loading future places',()=>{
 const canvas=new TestCanvas(),requests=[],view=createCityView(canvas,{onDetailRequest:id=>requests.push(id)});
 const context={bounds:{x:0,z:0,size:1200},sites:[{id:2,name:'Neighbor',point:{x:600,z:400},radiusKm:5}],routes:[],rivers:[]};
 view.show(null,{context,viewport:{center:{x:600,z:400},kmAcross:400}});
 assert.deepEqual(requests,[]);view.zoomBy(10);
 assert.deepEqual(requests,[2]);assert.ok(Math.abs(view.getView().kmAcross-40)<1e-8);
 view.zoomBy(1.1);assert.deepEqual(requests,[2],'only one pending request per visible city');view.destroy();
});

test('detail arriving during a pinch preserves its physical zoom origin',()=>{
 const canvas=new TestCanvas(),view=createCityView(canvas);
 view.show(null,{context:{bounds:{x:0,z:0,size:1200},sites:[],routes:[],rivers:[]},viewport:{center:{x:600,z:400},kmAcross:80}});
 pointer(canvas,'pointerdown',1,100,150);pointer(canvas,'pointerdown',2,300,150);pointer(canvas,'pointermove',1,80,150);
 const before=view.getView();view.setCity({...city,siteId:0,bounds:{x:595,z:395,size:10},center:{x:600,z:400}});
 assert.equal(view.getView().kmAcross,before.kmAcross);
 pointer(canvas,'pointermove',2,310,150);
 assert.ok(Math.abs(view.getView().kmAcross-before.kmAcross*220/230)<1e-8,'the next movement continues the same pinch');view.destroy();
});

test('more than six visible towns cannot cause repeated load and eviction cycles',()=>{
 const canvas=new TestCanvas(),pending=[],requested=[],view=createCityView(canvas,{onDetailRequest:id=>{pending.push(id);requested.push(id);}});
 const sites=Array.from({length:9},(_,i)=>({id:i,name:`Town ${i}`,point:{x:595+i,z:400},radiusKm:5}));
 view.show(null,{context:{bounds:{x:0,z:0,size:1200},sites,routes:[],rivers:[]},viewport:{center:{x:600,z:400},kmAcross:40}});
 let iterations=0;
 while(pending.length&&iterations++<30){const id=pending.shift(),point=sites[id].point;view.addCity({...city,siteId:id,center:point,bounds:{x:point.x-5,z:point.z-5,size:10}});}
 assert.equal(pending.length,0);assert.equal(requested.length,6);assert.equal(new Set(requested).size,6);
 view.zoomBy(1.01);assert.equal(requested.length,6);view.destroy();
});

test('eviction favors current detail targets over a previously cached but now subpixel town',()=>{
 const canvas=new TestCanvas(),pending=[],requested=[],view=createCityView(canvas,{onDetailRequest:id=>{pending.push(id);requested.push(id);}});
 const sites=[{id:0,name:'Tiny',point:{x:600,z:400},radiusKm:.01},...Array.from({length:6},(_,i)=>({id:i+1,name:`Town ${i}`,point:{x:598+i,z:400},radiusKm:5}))];
 const make=id=>({...city,siteId:id,center:sites[id].point,bounds:{x:sites[id].point.x-5,z:395,size:10}});
 view.show({...city,siteId:99,center:{x:1100,z:1000},bounds:{x:1095,z:995,size:10}},{context:{bounds:{x:0,z:0,size:1200},sites,routes:[],rivers:[]}});
 view.addCity(make(0));view.setViewport({center:{x:600,z:400},kmAcross:40});
 let iterations=0;while(pending.length&&iterations++<30)view.addCity(make(pending.shift()));
 assert.equal(pending.length,0);assert.equal(requested.length,6);assert.equal(new Set(requested).size,6);
 view.zoomBy(1.01);assert.equal(requested.length,6);view.destroy();
});
