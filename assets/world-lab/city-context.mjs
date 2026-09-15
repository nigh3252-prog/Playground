/** The local map is another camera on the parent, not a second world. */
import {rasterizeWindow} from './window-geometry.mjs';

export function regionalCityContext(world,history,frame,colors){
 const size=world.mesh.sizeKm||world.config.sizeKm,bounds={x:0,z:0,size};
 const point=id=>({x:world.mesh.x[id],z:world.mesh.z[id]});
 const states=new Map((frame.siteStates||[]).map(s=>[s.siteId,s]));
 const sites=history.sites.flatMap(site=>{
  const state=states.get(site.id);
  if(site.founded>frame.generation||!state||state.population<=0||state.status==='abandoned')return [];
  return [{id:site.id,name:site.name,population:state.population,point:point(site.nodeId),radiusKm:Math.sqrt((state.urbanAreaKm2||state.population/3000)/Math.PI)}];
 });
 const active=new Map((frame.routeStates||[]).filter(r=>r.active).map(r=>[r.routeId,r]));
 const routes=history.routes.filter(r=>r.founded<=frame.generation&&active.has(r.id)).map(r=>({id:r.id,a:r.a,b:r.b,kind:r.kind,widthKm:(frame.era||'agrarian')==='agrarian'?.012:.026,points:r.nodes.map(point),traffic:active.get(r.id).traffic||0}));
 const rivers=[];
 for(let i=0;i<world.height.length;i++){
  const j=world.receiver?.[i];
  if(world.river?.[i]&&j>=0&&!world.ocean[i]&&!(world.lake[i]&&world.lake[j]))rivers.push({points:[point(i),point(j)],widthKm:Math.min(.22,Math.max(.04,.032+Math.sqrt(Math.max(0,world.runoff?.[i]||0))*.003))});
 }
 // The caller supplies the actual nodal palette used for the regional map.
 // Store terrain alone: dots and labels must retain their own zoom behavior.
 const width=1536,pixels=colors?rasterizeWindow(world.mesh,colors,width,bounds):null;
 return {bounds,sites,routes,rivers,pixels,pixelWidth:width,year:frame.year};
}

export function contextTexture(context,makeCanvas=()=>document.createElement('canvas')){
 if(!context?.pixels)return null;
 const canvas=makeCanvas();canvas.width=canvas.height=context.pixelWidth;
 const ctx=canvas.getContext('2d'),im=ctx.createImageData(context.pixelWidth,context.pixelWidth);
 im.data.set(context.pixels);ctx.putImageData(im,0,0);
 return canvas;
}
