import {WorldView} from './world-view.mjs';
import {clipMesh,interpolateClip} from './window-geometry.mjs';
export class AtlasView extends WorldView{
 constructor(canvas,{onPick=()=>{},onChange=()=>{}}={}){super(canvas,{onPick:id=>{if(this.clip)onPick(this.clip.sourceIds[id]);},onChange});}
 setWorld(world,box){
  if(this.dataMesh!==world.mesh||JSON.stringify(this.box)!==JSON.stringify(box)){this.clip=clipMesh(world.mesh,box);this.dataMesh=world.mesh;this.box=box;}
  const h=Float32Array.from(world.height,(v,i)=>world.ocean[i]?0:world.stage>=2?world.waterSurface?.[i]??world.filled[i]:v);
  super.setSurface(this.clip.mesh,interpolateClip(this.clip,h));this.modelHeights=h;
 }
}
