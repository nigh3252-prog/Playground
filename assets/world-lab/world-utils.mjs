export const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const mix=(a,b,t)=>a+(b-a)*t, ease=t=>{t=clamp(t,0,1);return t*t*(3-2*t);};
export function random32(seed){let s=seed>>>0;return()=>{s=(s+0x6D2B79F5)>>>0;let t=s;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}
function hash(x,z,s){let k=Math.imul(x^s,374761393)+Math.imul(z^(s>>>7),668265263);k=Math.imul(k^(k>>>13),1274126177);return((k^(k>>>16))>>>0)/4294967295;}
export function noise(x,z,s){const ix=Math.floor(x),iz=Math.floor(z),a=ease(x-ix),b=ease(z-iz);return mix(mix(hash(ix,iz,s),hash(ix+1,iz,s),a),mix(hash(ix,iz+1,s),hash(ix+1,iz+1,s),a),b)*2-1;}
