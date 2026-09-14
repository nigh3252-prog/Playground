export function localTextureSize(){return 1024;}

export function createLocalRenderMesh(){
 const n=257,count=n*n,x=new Float64Array(count),z=new Float64Array(count),triangles=new Uint32Array((n-1)*(n-1)*6),step=1.2/(n-1);let k=0;
 for(let row=0;row<n;row++)for(let col=0;col<n;col++){const id=row*n+col;x[id]=col*step;z[id]=row*step;}
 for(let row=0;row<n-1;row++)for(let col=0;col<n-1;col++){const a=row*n+col,b=a+1,c=a+n,d=c+1;triangles.set([a,b,c,b,d,c],k);k+=6;}
 return{n,sizeKm:1.2,stepKm:step,x,z,triangles};
}
