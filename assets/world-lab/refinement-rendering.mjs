/** Local material cues on the inherited atlas colors; diagnostic layers stay
 * unaltered. Water uses a real width mask, not a thicker atlas line. */
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const blend=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*clamp(t,0,1));
export function refinementColors(data,parentColors,{kind='natural',stage=4,normals=null,vectorWater=false}={}){
 const N=data.heightM.length,out=new Uint8ClampedArray(N*4),natural=kind==='natural';
 for(let i=0;i<N;i++){
  let color=[0,0,0,0];for(const[id,w]of data.sourceWeights[i])for(let k=0;k<4;k++)color[k]+=parentColors[id*4+k]*w;
  if(natural&&!data.waterMask[i]){
   color=blend(color,[148,143,130,255],clamp((data.slope[i]-.28)/.6,0,.65));
   color=blend(color,[76,91,68,255],clamp(data.incisionM[i]/10,0,.28));
   color=blend(color,[96,126,86,255],data.bank[i]*.18);
   for(let k=0;k<3;k++)color[k]*=data.ambient?.[i]??1;
  }
  if(!vectorWater&&kind!=='tectonics'&&stage>=2&&data.waterMask[i]&&data.oceanWeight[i]<.5&&data.lakeWeight[i]<.5)color=[49,120,143,110];
  if(normals&&color[3]>150){const j=i*3,light=clamp((-.6*normals[j]+normals[j+1]-.35*normals[j+2])/Math.hypot(.6,1,.35),0,1),shade=.69+.38*light;for(let k=0;k<3;k++)color[k]*=shade;}
  out.set(color,i*4);
 }
 return out;
}

/** Paint the analytic bank outlines at texture resolution, not the coarser
 * vertex mask. The mesh still uses the same physical water/ground heights. */
export function paintRefinedWater(ctx,data,xy,{kind='natural',stage=4}={}){
 if(stage<2||kind==='tectonics')return 0;
 let count=0;
 for(const c of data.channels||[]){
  if(!c.leftBank?.length||!c.rightBank?.length)continue;
  const polygon=[...c.leftBank,...[...c.rightBank].reverse()];
  ctx.save();ctx.beginPath();polygon.forEach(([x,z],i)=>{const p=xy(x,z);i?ctx.lineTo(...p):ctx.moveTo(...p);});ctx.closePath();ctx.clip();
  ctx.clearRect(0,0,ctx.canvas.width,ctx.canvas.height);ctx.fillStyle='rgba(49,120,143,0.4314)';ctx.fillRect(0,0,ctx.canvas.width,ctx.canvas.height);ctx.restore();count++;
 }
 return count;
}
