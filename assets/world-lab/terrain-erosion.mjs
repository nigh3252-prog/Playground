import {clamp} from './world-utils.mjs';

/** Apply bounded steepest-descent transport; older relief diffuses faster. */
export function erodeTerrain({elevation,width,height},tectonicAge,options={}){
 if(!elevation||elevation.length!==width*height||tectonicAge?.length!==elevation.length)throw new Error('Invalid erosion fields');
 const passes=clamp(Math.round(options.passes??4),1,8),out=Float32Array.from(elevation),sediment=new Float32Array(elevation.length),delta=new Float32Array(elevation.length);
 for(let pass=0;pass<passes;pass++){
  delta.fill(0);
  for(let z=1;z<height-1;z++)for(let x=1;x<width-1;x++){
   const i=z*width+x,current=out[i];
   if(!(current>0))continue;
   let target=i,lowest=current;
   for(const candidate of [i-1,i+1,i-width,i+width])if(out[candidate]<lowest){lowest=out[candidate];target=candidate;}
   const drop=current-lowest;
   if(drop<1)continue;
   const ageFactor=clamp((tectonicAge[i]-20)/880,0,1),fraction=.012+ageFactor*.044,amount=Math.min(drop*.16,drop*fraction,46);
   if(!(amount>0))continue;
   delta[i]-=amount;delta[target]+=amount*.78;sediment[target]+=amount;
  }
  for(let i=0;i<out.length;i++)out[i]+=delta[i];
 }
 return{elevation:out,sediment,passes};
}
