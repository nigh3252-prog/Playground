/** Local material cues on the inherited atlas colors; diagnostic layers stay
 * unaltered. Water uses a real width mask, not a thicker atlas line. */
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const blend=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*clamp(t,0,1));
export function refinementColors(data,parentColors,{kind='natural',stage=4,normals=null}={}){
 const N=data.heightM.length,out=new Uint8ClampedArray(N*4),natural=kind==='natural';
 for(let i=0;i<N;i++){
  let color=[0,0,0,0];for(const[id,w]of data.sourceWeights[i])for(let k=0;k<4;k++)color[k]+=parentColors[id*4+k]*w;
  if(natural&&!data.waterMask[i]){
   color=blend(color,[148,143,130,255],clamp((data.slope[i]-.28)/.6,0,.65));
   color=blend(color,[137,126,91,255],clamp(data.incisionM[i]/8,0,.48));
   color=blend(color,[96,126,86,255],data.bank[i]*.18);
  }
  if(kind!=='tectonics'&&stage>=2&&data.waterMask[i]&&data.oceanWeight[i]<.5&&data.lakeWeight[i]<.5)color=[49,120,143,110];
  if(normals&&color[3]>150){const j=i*3,light=clamp((-.6*normals[j]+normals[j+1]-.35*normals[j+2])/Math.hypot(.6,1,.35),0,1),shade=.69+.38*light;for(let k=0;k<3;k++)color[k]*=shade;}
  out.set(color,i*4);
 }
 return out;
}
