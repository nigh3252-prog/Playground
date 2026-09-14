import {WorldView} from './world-view.mjs';
import {clipMesh,interpolateClip} from './window-geometry.mjs';
export class AtlasView extends WorldView{
 constructor(canvas,{onPick=()=>{},onChange=()=>{}}={}){super(canvas,{onPick:id=>{
  if(!this.clip)return;
  const p=this.lastPick||{x:this.clip.mesh.x[id],z:this.clip.mesh.z[id]};
  this.selectedPoint={x:this.box.x+p.x,z:this.box.z+p.z};
  onPick(this.clip.sourceIds[id]);
  canvas.dispatchEvent(new CustomEvent('watershed-pick',{detail:this.selectedPoint}));
 },onChange});}
 reset(map=this.map){
  super.reset(map);
  // Regional framing is unchanged. At local scale a fixed 650 m camera
  // target can put an elevated landscape completely outside the viewport.
  if(this.surface?.length&&this.size<=120){let lo=Infinity,hi=-Infinity;for(const h of this.surface){lo=Math.min(lo,h);hi=Math.max(hi,h);}this.target[1]=(lo+hi)/2000*this.exag;}
 }
 setWorld(world,box){
  if(this.dataMesh!==world.mesh||JSON.stringify(this.box)!==JSON.stringify(box)){this.clip=clipMesh(world.mesh,box);this.dataMesh=world.mesh;this.box=box;}
  const h=Float32Array.from(world.height,(v,i)=>world.ocean[i]?0:world.stage>=2?world.waterSurface?.[i]??world.filled[i]:v);
  super.setSurface(this.clip.mesh,interpolateClip(this.clip,h));this.modelHeights=h;
 }
}
