// Run: node --test tests/procedural-city-road-surface.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRoadField,projectToSegment,paintRoadSurface} from '../assets/city-lab/road-surface.mjs';

const p=(x,y,z)=>({x,y,z});
const road=(points,width=8,type='collector')=>({points,width,type});
const near=(actual,expected,tolerance=1e-7)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} != ${expected}`);

test('projects onto segments and interpolates height, rather than snapping to vertices',()=>{
  const hit=projectToSegment(4,2,p(0,0,0),p(10,1,0));
  near(hit.t,.4);near(hit.y,.4);near(hit.distance,2);
  near(projectToSegment(-3,0,p(0,0,0),p(10,1,0)).t,0);
  near(projectToSegment(30,0,p(0,0,0),p(10,1,0)).t,1);
});
test('zero-length segments are safe and invalid input is rejected',()=>{
  near(projectToSegment(1,0,p(0,2,0),p(0,2,0)).y,2);
  const field=createRoadField([road([p(0,0,0),p(0,0,0),p(10,1,0)])],()=>-3);
  near(field.height(5,0),.5);
  assert.throws(()=>createRoadField([road([p(0,NaN,0),p(10,0,0)])],()=>0),TypeError);
  assert.throws(()=>createRoadField([road([p(0,0,0),p(10,0,0)],0)],()=>0),TypeError);
});
test('road grades are continuous across old nearest-point boundaries and bin edges',()=>{
  const field=createRoadField([road([p(-60,-3,0),p(0,0,0),p(60,3,0)])],()=>-10);
  for(let x=-59;x<=59;x+=.13){near(field.height(x,0),x*.05);near(field.height(x,3),x*.05);}
  for(const x of [-48,-30,-24,0,24,30,48]) assert.ok(Math.abs(field.height(x+1e-4,0)-field.height(x-1e-4,0))<.00002);
});
test('undeveloped terrain is unchanged and shoulders feather continuously',()=>{
  const field=createRoadField([road([p(-60,2,0),p(60,2,0)])],(x,z)=>.01*x+.02*z);
  near(field.height(0,50),1);near(field.height(90,0),.9);
  near(field.height(0,0),2);
  const a=field.height(0,11.9999),b=field.height(0,12.0001);
  assert.ok(Math.abs(a-b)<1e-4);
});
test('crossings share a flat junction pad even if their original heights disagree',()=>{
  const roads=[road([p(-60,0,0),p(60,0,0)],12,'arterial'),road([p(0,2,-60),p(0,2,60)],8)];
  const field=createRoadField(roads,()=>-2);
  assert.equal(field.junctions.length,1);
  near(field.height(0,0),.8);
  for(const [x,z] of [[3,0],[-3,0],[0,3],[0,-3],[2,2]]) near(field.height(x,z),.8);
  assert.equal(field.markingAllowed(0,0,0,1,0),false);
  assert.equal(field.markingAllowed(30,0,0,1,0),true);
  const reversed=createRoadField([...roads].reverse(),()=>-2);
  for(let x=-50;x<=50;x+=1.1) near(field.height(x,0),reversed.height(x,0));
});
test('T and angled branch endpoints get connected junction pads',()=>{
  for(const end of [p(30,1,40),p(0,1,40)]) {
    const field=createRoadField([road([p(-60,0,0),p(60,0,0)],12,'arterial'),road([p(0,1,0),end],6.5,'local')],()=>0);
    assert.ok(field.junctions.length>=1);
    const y=field.height(0,0);assert.ok(y>0&&y<1);
    near(field.height(0,1),y);
    assert.equal(field.markingAllowed(0,1,1,0,1),false);
  }
});
test('overlapping parallel routes keep one center marking, not z-fighting duplicates',()=>{
  const field=createRoadField([road([p(-100,0,0),p(100,0,0)],12,'arterial'),road([p(-100,0,0),p(100,0,0)],6.5,'local')],()=>-3);
  assert.equal(field.markingAllowed(0,0,0,1,0),true);
  assert.equal(field.markingAllowed(0,0,1,1,0),false);
  near(field.height(0,0),0);
});
test('asphalt is painted after ALL shoulders, with round joins and no depth layers',()=>{
  const calls=[];
  const ctx={save(){},restore(){},beginPath(){},moveTo(){},lineTo(){},stroke(){calls.push({width:this.lineWidth,color:this.strokeStyle,join:this.lineJoin,cap:this.lineCap});}};
  const roads=[road([p(-30,0,0),p(0,0,0),p(10,0,20)],12,'arterial'),road([p(0,0,0),p(-20,0,20)],8)];
  paintRoadSurface(ctx,roads,createRoadField(roads,()=>0));
  assert.deepEqual(calls.slice(0,2).map(c=>c.color),['#857d69','#857d69']);
  assert.deepEqual(calls.slice(2,4).map(c=>c.color),['#414744','#414744']);
  assert.ok(calls.slice(0,4).every(c=>c.join==='round'&&c.cap==='round'));
  assert.equal(calls.length,roads.length*3);
});
test('single ground mesh owns asphalt/paint; no floating ribbon or dash geometry remains',()=>{
  const html=readFileSync(new URL('../procedural-city-roads.html',import.meta.url),'utf8');
  assert.ok(html.includes("name='unified-terrain-road-surface'"));
  assert.ok(html.includes('map:ui.showRoads.checked?roadTexture:groundTexture'));
  assert.ok(!html.includes('ribbonGeometry'));
  assert.ok(!html.includes('addRoadMesh'));
  assert.ok(!html.includes('dashGeom'));
  assert.ok(html.includes('groundTexture?.dispose();roadTexture?.dispose();'));
  assert.ok(html.includes('Math.min(minHeight,currentParams.waterLevel)-4'));
});
test('many layouts: heights stay finite and sampling is deterministic',()=>{
  for(let s=0;s<30;s++) {
    const paths=[];
    for(let r=0;r<7;r++) {
      const points=[];
      for(let i=0;i<=50;i++){
        const t=i/50,angle=r*Math.PI/7;
        const v=-190+t*380;
        points.push(p(Math.cos(angle)*v,Math.sin(t*4+s)*2,Math.sin(angle)*v+Math.sin(t*6+s+r)*12));
      }
      paths.push(road(points,r===0?12:8,r===0?'arterial':'collector'));
    }
    const field=createRoadField(paths,(x,z)=>Math.sin(x/40+s)+Math.cos(z/60));
    for(let z=-200;z<=200;z+=17)for(let x=-200;x<=200;x+=17){
      const a=field.height(x,z);assert.ok(Number.isFinite(a));near(a,field.height(x,z));
    }
  }
});
