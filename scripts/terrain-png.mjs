/** Decode non-interlaced, eight-bit RGB/RGBA/grayscale/paletted PNGs.
 * Terrarium data must be read as bytes, without display color conversion.
 */
import {inflateSync} from 'node:zlib';
export function decodePNG(input){
  const b=Buffer.from(input);if(b.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw new Error('Not a PNG tile');
  let width,height,depth,type,interlace,palette=null,alpha=null;const chunks=[];
  for(let p=8;p+12<=b.length;){const len=b.readUInt32BE(p),kind=b.toString('ascii',p+4,p+8),d=b.subarray(p+8,p+8+len);if(p+len+12>b.length)throw new Error('Truncated PNG');
    if(kind==='IHDR'){width=d.readUInt32BE(0);height=d.readUInt32BE(4);depth=d[8];type=d[9];interlace=d[12];}
    else if(kind==='IDAT')chunks.push(d);else if(kind==='PLTE')palette=d;else if(kind==='tRNS')alpha=d;
    p+=len+12;
  }
  if(depth!==8||interlace!==0||!width||!height||width>4096||height>4096)throw new Error('Unsupported PNG tile format');
  const channels={0:1,2:3,3:1,4:2,6:4}[type];if(!channels)throw new Error('Unsupported PNG color type');
  const raw=inflateSync(Buffer.concat(chunks)),stride=width*channels,out=Buffer.alloc(stride*height);
  if(raw.length!==(stride+1)*height)throw new Error('PNG scanline size mismatch');
  const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
  for(let y=0;y<height;y++){const filter=raw[y*(stride+1)];if(filter>4)throw new Error('Invalid PNG filter');for(let x=0;x<stride;x++){
    const k=y*stride+x,a=x>=channels?out[k-channels]:0,up=y?out[k-stride]:0,c=y&&x>=channels?out[k-stride-channels]:0;
    const add=filter===0?0:filter===1?a:filter===2?up:filter===3?(a+up)>>1:paeth(a,up,c);out[k]=(raw[y*(stride+1)+1+x]+add)&255;
  }}
  const rgba=new Uint8Array(width*height*4);for(let i=0;i<width*height;i++){const p=i*channels,k=i*4;
    if(type===3){const q=out[p];if(!palette||q*3+2>=palette.length)throw new Error('Bad PNG palette');rgba.set([palette[q*3],palette[q*3+1],palette[q*3+2],alpha?.[q]??255],k);}
    else if(type===0||type===4)rgba.set([out[p],out[p],out[p],type===4?out[p+1]:255],k);
    else rgba.set([out[p],out[p+1],out[p+2],type===6?out[p+3]:255],k);
  }return{width,height,rgba};
}
export function decodeTerrarium(bytes){const {width,height,rgba}=decodePNG(bytes),heightM=new Float32Array(width*height);for(let i=0;i<heightM.length;i++){
  const k=i*4;if(rgba[k+3]===0)throw new Error('Terrain tile has missing elevation');heightM[i]=rgba[k]*256+rgba[k+1]+rgba[k+2]/256-32768;
}return{width,height,heightM};}
