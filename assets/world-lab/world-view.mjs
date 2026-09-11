/* Small dependency-free WebGL atlas viewer. No CDN/runtime dependencies.
 * Render-only vertical exaggeration never feeds back into the generator.
 */
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const norm=v=>{const d=Math.hypot(...v)||1;return v.map(x=>x/d);};
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
function multiply(a,b){const o=new Float32Array(16);for(let c=0;c<4;c++)for(let r=0;r<4;r++)for(let k=0;k<4;k++)o[c*4+r]+=a[k*4+r]*b[c*4+k];return o;}
function lookAt(eye,target){const z=norm(eye.map((v,i)=>v-target[i])),x=norm(cross([0,1,0],z)),y=cross(z,x);return new Float32Array([x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,-dot(x,eye),-dot(y,eye),-dot(z,eye),1]);}
function perspective(aspect,far){const f=1/Math.tan(45*Math.PI/360),near=.1;return new Float32Array([f/aspect,0,0,0,0,f,0,0,0,0,(far+near)/(near-far),-1,0,0,2*far*near/(near-far),0]);}
export class WorldView {
  constructor(canvas,{onPick=()=>{},onChange=()=>{}}={}){
    this.canvas=canvas;this.onPick=onPick;this.onChange=onChange;this.size=1200;this.exag=18;
    this.yaw=-.12;this.pitch=.91;this.distance=1900;this.target=[0,20,0];this.map=false;
    this.pointers=new Map();this.dirty=true;this.surface=null;this.textureCanvas=null;
    const gl=canvas.getContext('webgl',{antialias:true,alpha:false,powerPreference:'high-performance'});
    this.gl=gl;
    if(gl){this.setupGL();}else{this.ctx=canvas.getContext('2d');this.map=true;}
    this.wireEvents();this.resize();
    this.frame=()=>{if(this.dirty){this.draw();this.dirty=false;}this.raf=requestAnimationFrame(this.frame);};this.frame();
  }
  setupGL(){const gl=this.gl;
    const vs=`attribute vec3 pos; attribute vec3 normal; attribute vec2 uv;
      uniform mat4 mvp; varying vec3 vN; varying vec2 vUV;
      void main(){vN=normal;vUV=uv;gl_Position=mvp*vec4(pos,1.0);}`;
    const fs=`precision mediump float; varying vec3 vN; varying vec2 vUV; uniform sampler2D tex;
      void main(){vec4 c=texture2D(tex,vUV);float sun=max(0.0,dot(normalize(vN),normalize(vec3(-.6,1.0,-.35))));
      float shade=.69+.38*sun; if(c.a<.6)shade=.94;
      gl_FragColor=vec4(c.rgb*shade,1.0);}`;
    const shader=(type,src)=>{const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s;};
    const v=shader(gl.VERTEX_SHADER,vs),f=shader(gl.FRAGMENT_SHADER,fs),p=gl.createProgram();gl.attachShader(p,v);gl.attachShader(p,f);gl.linkProgram(p);gl.deleteShader(v);gl.deleteShader(f);
    if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(p));
    this.program=p;gl.useProgram(p);
    this.locs={pos:gl.getAttribLocation(p,'pos'),normal:gl.getAttribLocation(p,'normal'),uv:gl.getAttribLocation(p,'uv'),mvp:gl.getUniformLocation(p,'mvp')};
    this.buffer=gl.createBuffer();this.index=gl.createBuffer();this.texture=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,this.texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    const aniso=gl.getExtension('EXT_texture_filter_anisotropic');if(aniso)gl.texParameterf(gl.TEXTURE_2D,aniso.TEXTURE_MAX_ANISOTROPY_EXT,Math.min(8,gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    gl.enable(gl.DEPTH_TEST);gl.clearColor(.094,.19,.235,1);gl.uniform1i(gl.getUniformLocation(p,'tex'),0);
  }
  setSurface(n,size,heights){this.n=n;this.size=size;this.surface=heights;this.rebuild();}
  rebuild(){
    if(!this.surface)return;
    const {n,size,exag}=this,step=size/(n-1),h=this.surface;
    this.displayH=Float32Array.from(h,v=>v/1000*exag);
    if(this.gl){const gl=this.gl,verts=new Float32Array(n*n*8);
      for(let z=0;z<n;z++)for(let x=0;x<n;x++){
        const i=z*n+x,k=i*8,y=this.displayH[i];
        const dx=(this.displayH[z*n+Math.min(n-1,x+1)]-this.displayH[z*n+Math.max(0,x-1)])/(x===0||x===n-1?step:2*step);
        const dz=(this.displayH[Math.min(n-1,z+1)*n+x]-this.displayH[Math.max(0,z-1)*n+x])/(z===0||z===n-1?step:2*step);
        const no=norm([-dx,1,-dz]);verts.set([x*step-size/2,y,z*step-size/2,...no,x/(n-1),z/(n-1)],k);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.bufferData(gl.ARRAY_BUFFER,verts,gl.STATIC_DRAW);
      if(this.indexN!==n){
        const large=n*n>65535;
        if(large&&!gl.getExtension('OES_element_index_uint'))throw new Error('Choose Standard resolution on this device');
        const idx=large?new Uint32Array((n-1)**2*6):new Uint16Array((n-1)**2*6);let k=0;
        for(let z=0;z<n-1;z++)for(let x=0;x<n-1;x++){const a=z*n+x;idx.set([a,a+n,a+1,a+1,a+n,a+n+1],k);k+=6;}
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this.index);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,idx,gl.STATIC_DRAW);this.count=idx.length;this.indexType=large?gl.UNSIGNED_INT:gl.UNSIGNED_SHORT;this.indexN=n;
      }
    }
    this.dirty=true;
  }
  setTexture(canvas){this.textureCanvas=canvas;if(this.gl){const gl=this.gl;gl.bindTexture(gl.TEXTURE_2D,this.texture);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,canvas);gl.generateMipmap(gl.TEXTURE_2D);}this.dirty=true;}
  setExaggeration(v){this.exag=v;this.rebuild();}
  reset(map=this.map){this.map=map;this.yaw=0;this.pitch=map?1.565:.96;this.distance=this.size*(innerWidth<650?2.8:1.65);this.target=[0,12,0];this.dirty=true;}
  toggleMap(){if(!this.gl)return;this.reset(!this.map);}
  resize(){const dpr=Math.min(devicePixelRatio||1,1.7);this.width=this.canvas.clientWidth;this.height=this.canvas.clientHeight;this.canvas.width=Math.round(this.width*dpr);this.canvas.height=Math.round(this.height*dpr);this.gl?.viewport(0,0,this.canvas.width,this.canvas.height);this.dirty=true;}
  basis(){const {yaw:a,pitch:p,distance:d,target:t}=this;
    const eye=[t[0]+Math.sin(a)*Math.cos(p)*d,t[1]+Math.sin(p)*d,t[2]+Math.cos(a)*Math.cos(p)*d];
    const f=norm(t.map((v,i)=>v-eye[i])),r=norm(cross(f,[0,1,0])),u=cross(r,f);return{eye,f,r,u};}
  draw(){
    if(!this.textureCanvas||!this.surface)return;
    if(!this.gl){const ctx=this.ctx,w=this.canvas.width,h=this.canvas.height,s=Math.min(w,h)*.88*this.size*(innerWidth<650?2.8:1.65)/this.distance,scale=s/this.size,ox=(w-s)/2-this.target[0]*scale,oy=(h-s)/2-this.target[2]*scale;ctx.fillStyle='#183745';ctx.fillRect(0,0,w,h);ctx.drawImage(this.textureCanvas,ox,oy,s,s);this.fallbackFrame={x:ox/w*this.width,y:oy/h*this.height,size:s/w*this.width};return;}
    const gl=this.gl,{eye}=this.basis(),mvp=multiply(perspective(this.width/this.height,this.size*12),lookAt(eye,this.target));
    gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.useProgram(this.program);gl.uniformMatrix4fv(this.locs.mvp,false,mvp);
    gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this.index);gl.bindTexture(gl.TEXTURE_2D,this.texture);
    for(const [loc,size,offset] of [[this.locs.pos,3,0],[this.locs.normal,3,12],[this.locs.uv,2,24]]){gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,size,gl.FLOAT,false,32,offset);}
    gl.drawElements(gl.TRIANGLES,this.count,this.indexType,0);this.onChange({yaw:this.yaw});
  }
  heightAt(x,z){const {n,size,displayH:h}=this,u=(x/size+.5)*(n-1),v=(z/size+.5)*(n-1);if(u<0||v<0||u>n-1||v>n-1)return null;
    const ix=Math.min(n-2,Math.floor(u)),iz=Math.min(n-2,Math.floor(v)),tx=u-ix,tz=v-iz,i=iz*n+ix;
    return(h[i]*(1-tx)+h[i+1]*tx)*(1-tz)+(h[i+n]*(1-tx)+h[i+n+1]*tx)*tz;
  }
  pick(clientX,clientY){
    if(!this.surface)return;
    const rect=this.canvas.getBoundingClientRect(),px=clientX-rect.left,py=clientY-rect.top;
    if(!this.gl){const f=this.fallbackFrame;if(!f)return;const x=(px-f.x)/f.size,z=(py-f.y)/f.size;if(x>=0&&x<=1&&z>=0&&z<=1)this.onPick(Math.round(z*(this.n-1))*this.n+Math.round(x*(this.n-1)));return;}
    const {eye,f,r,u}=this.basis(),tan=Math.tan(Math.PI/8),sx=(px/this.width*2-1)*this.width/this.height*tan,sy=(1-py/this.height*2)*tan;
    const dir=norm(f.map((v,i)=>v+r[i]*sx+u[i]*sy)),dt=this.size/120;let previous=0;
    for(let t=dt;t<this.distance+this.size*3;t+=dt){
      const x=eye[0]+dir[0]*t,z=eye[2]+dir[2]*t,h=this.heightAt(x,z),y=eye[1]+dir[1]*t;
      if(h!==null&&y<=h){let lo=previous,hi=t;
        for(let k=0;k<12;k++){const m=(lo+hi)/2,mh=this.heightAt(eye[0]+dir[0]*m,eye[2]+dir[2]*m);if(mh!==null&&eye[1]+dir[1]*m<=mh)hi=m;else lo=m;}
        const u=clamp(((eye[0]+dir[0]*hi)/this.size+.5)*(this.n-1),0,this.n-1),v=clamp(((eye[2]+dir[2]*hi)/this.size+.5)*(this.n-1),0,this.n-1);
        this.onPick(Math.round(v)*this.n+Math.round(u));return;
      }previous=t;
    }
  }
  wireEvents(){const c=this.canvas;let start=null,moved=false;
    c.addEventListener('contextmenu',e=>e.preventDefault());
    c.addEventListener('pointerdown',e=>{c.setPointerCapture(e.pointerId);this.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});if(this.pointers.size===1){start={x:e.clientX,y:e.clientY};moved=false;}else moved=true;});
    c.addEventListener('pointermove',e=>{
      const old=this.pointers.get(e.pointerId);if(!old)return;
      const dx=e.clientX-old.x,dy=e.clientY-old.y;
      if(start&&Math.hypot(e.clientX-start.x,e.clientY-start.y)>5)moved=true;
      if(this.pointers.size===2){const other=[...this.pointers.entries()].find(([id])=>id!==e.pointerId)[1];
        const a=Math.hypot(old.x-other.x,old.y-other.y),b=Math.hypot(e.clientX-other.x,e.clientY-other.y);if(b>5)this.distance=clamp(this.distance*a/b,this.size*.12,this.size*5);
        this.pan(dx*.5,dy*.5);
      }else if(e.shiftKey||e.buttons===2||this.map){this.pan(dx,dy);}else{this.yaw-=dx*.005;this.pitch=clamp(this.pitch+dy*.004,.23,1.565);}
      this.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});this.dirty=true;
    });
    c.addEventListener('pointerup',e=>{if(this.pointers.size===1&&!moved)this.pick(e.clientX,e.clientY);this.pointers.delete(e.pointerId);});
    c.addEventListener('pointercancel',e=>this.pointers.delete(e.pointerId));
    c.addEventListener('wheel',e=>{e.preventDefault();this.distance=clamp(this.distance*Math.exp(e.deltaY*.001),this.size*.12,this.size*5);this.dirty=true;},{passive:false});
    addEventListener('resize',()=>this.resize());
    c.addEventListener('webglcontextlost',e=>{e.preventDefault();document.dispatchEvent(new CustomEvent('world-view-error',{detail:'Graphics context lost. Reload the page or choose the Quick resolution.'}));});
  }
  pan(dx,dy){const scale=this.distance/Math.max(400,this.height)*.6,a=this.yaw;this.target[0]-=(Math.cos(a)*dx+Math.sin(a)*dy)*scale;this.target[2]-=(-Math.sin(a)*dx+Math.cos(a)*dy)*scale;this.target[0]=clamp(this.target[0],-this.size,this.size);this.target[2]=clamp(this.target[2],-this.size,this.size);}
  destroy(){cancelAnimationFrame(this.raf);if(this.gl){const gl=this.gl;gl.deleteBuffer(this.buffer);gl.deleteBuffer(this.index);gl.deleteTexture(this.texture);gl.deleteProgram(this.program);}}
}
