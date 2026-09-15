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
const city={bounds:{x:0,z:0,size:10},center:{x:5,z:5},districts:[{id:7,name:'Downtown',kind:'downtown',center:{x:5,z:5},population:9000,areaKm2:100,color:'#bcaa90',boundary:[]}],blocks:[{id:0,districtId:7,polygon,center:{x:5,z:5}}],roads:[],terrain:{patches:[],water:[]}};

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
