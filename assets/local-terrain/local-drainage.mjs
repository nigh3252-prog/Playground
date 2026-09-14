const NEIGHBORS=[[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]];

class MinHeap{
 constructor(){this.nodes=[];this.keys=[];}
 push(node,key){let i=this.nodes.length;this.nodes.push(node);this.keys.push(key);while(i){const p=(i-1)>>1;if(this.keys[p]<=key)break;this.nodes[i]=this.nodes[p];this.keys[i]=this.keys[p];i=p;this.nodes[i]=node;this.keys[i]=key;}}
 pop(){if(!this.nodes.length)return-1;const node=this.nodes[0],lastNode=this.nodes.pop(),lastKey=this.keys.pop();if(this.nodes.length){let i=0;this.nodes[0]=lastNode;this.keys[0]=lastKey;for(;;){let child=i*2+1;if(child>=this.nodes.length)break;if(child+1<this.nodes.length&&this.keys[child+1]<this.keys[child])child++;if(this.keys[i]<=this.keys[child])break;[this.nodes[i],this.nodes[child]]=[this.nodes[child],this.nodes[i]];[this.keys[i],this.keys[child]]=[this.keys[child],this.keys[i]];i=child;}}return node;}
 get size(){return this.nodes.length;}
}
function angleDistance(a,b){return Math.abs(Math.atan2(Math.sin(a-b),Math.cos(a-b)));}

export function routeLocalDrainage({heightM,width,height,spacingM,preferredOutletBearingRad=0}){
 if(!heightM||heightM.length!==width*height||!Number.isInteger(width)||!Number.isInteger(height)||width<3||height<3||!(spacingM>0))throw new TypeError('Invalid local drainage grid');
 const count=width*height,conditionedHeightM=Float32Array.from(heightM),receiver=new Int32Array(count).fill(-2),visited=new Uint8Array(count),order=new Int32Array(count),heap=new MinHeap();let orderLength=0,maxFillM=0;
 const seedBoundary=(row,col)=>{const id=row*width+col;if(visited[id])return;visited[id]=1;receiver[id]=-1;const x=col-(width-1)/2,z=row-(height-1)/2,bearing=Math.atan2(z,x),tie=angleDistance(bearing,preferredOutletBearingRad)*1e-7;heap.push(id,conditionedHeightM[id]+tie);};
 for(let col=0;col<width;col++){seedBoundary(0,col);seedBoundary(height-1,col);}for(let row=1;row<height-1;row++){seedBoundary(row,0);seedBoundary(row,width-1);}
 while(heap.size){
  const id=heap.pop(),row=Math.floor(id/width),col=id-row*width;order[orderLength++]=id;
  for(const [dc,dr] of NEIGHBORS){const nr=row+dr,nc=col+dc;if(nr<0||nr>=height||nc<0||nc>=width)continue;const next=nr*width+nc;if(visited[next])continue;visited[next]=1;receiver[next]=id;const raised=Math.max(conditionedHeightM[next],conditionedHeightM[id]+1e-4);maxFillM=Math.max(maxFillM,raised-heightM[next]);conditionedHeightM[next]=raised;heap.push(next,raised);}
 }
 const cellAreaM2=spacingM*spacingM,flowAccumulation=new Float32Array(count);flowAccumulation.fill(cellAreaM2);
 for(let i=orderLength-1;i>=0;i--){const id=order[i],down=receiver[id];if(down>=0)flowAccumulation[down]+=flowAccumulation[id];}
 const boundary=[];for(let id=0;id<count;id++){const row=Math.floor(id/width),col=id-row*width;if(receiver[id]===-1&&(row===0||row===height-1||col===0||col===width-1))boundary.push(id);}
 boundary.sort((a,b)=>flowAccumulation[b]-flowAccumulation[a]||a-b);const threshold=cellAreaM2*4,outlets=boundary.filter(id=>flowAccumulation[id]>=threshold);if(!outlets.length&&boundary.length)outlets.push(boundary[0]);
 return{conditionedHeightM,receiver,flowAccumulation,outlets,primaryOutlet:outlets[0]??-1,maxFillM};
}
