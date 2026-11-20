// Portable exports: no services or third-party ZIP dependency.
const encoder = new TextEncoder();
const crcTable = Uint32Array.from({length:256}, (_, n) => {
  let c = n;
  for (let k=0;k<8;k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
export function makeZip(entries) {
  if (entries.length > 65535) throw new Error("Too many ZIP entries.");
  const local=[], central=[]; let offset=0;
  for (const entry of entries) {
    if (!/^[a-zA-Z0-9_./-]+$/.test(entry.name) || entry.name.includes("..") || entry.name.startsWith("/")) throw new Error("Unsafe export path.");
    const name=encoder.encode(entry.name), bytes=typeof entry.data==="string"?encoder.encode(entry.data):entry.data;
    if (!(bytes instanceof Uint8Array) || bytes.length > 0xffffffff) throw new Error("Unsupported ZIP data.");
    const crc=crc32(bytes), header=new Uint8Array(30+name.length), h=new DataView(header.buffer);
    h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint16(6,0x800,true);h.setUint16(12,33,true);
    h.setUint32(14,crc,true);h.setUint32(18,bytes.length,true);h.setUint32(22,bytes.length,true);h.setUint16(26,name.length,true);header.set(name,30);
    const record=new Uint8Array(46+name.length), r=new DataView(record.buffer);
    r.setUint32(0,0x02014b50,true);r.setUint16(4,20,true);r.setUint16(6,20,true);r.setUint16(8,0x800,true);r.setUint16(14,33,true);
    r.setUint32(16,crc,true);r.setUint32(20,bytes.length,true);r.setUint32(24,bytes.length,true);r.setUint16(28,name.length,true);r.setUint32(42,offset,true);record.set(name,46);
    local.push(header,bytes);central.push(record);offset+=header.length+bytes.length;
  }
  const centralSize=central.reduce((n,x)=>n+x.length,0),end=new Uint8Array(22),e=new DataView(end.buffer);
  if (offset+centralSize+22 > 0xffffffff) throw new Error("ZIP exceeds 4 GB.");
  e.setUint32(0,0x06054b50,true);e.setUint16(8,entries.length,true);e.setUint16(10,entries.length,true);e.setUint32(12,centralSize,true);e.setUint32(16,offset,true);
  return new Blob([...local,...central,end],{type:"application/zip"});
}
export function selectionManifest(models, notes={}, orientations={}) {
  return {
    schema:"warden-armory-selection",version:1,createdAt:new Date().toISOString(),intendedProject:"Warden Mech",
    geometry:"Original GLB assets; display orientation is a suggestion, not applied to the exported geometry.",
    favorites:models.map(model=>({
      ...model,file:"models/"+model.id+".glb",notes:typeof notes[model.id]==="string"?notes[model.id]:"",
      viewerRotationRadians:orientations[model.id]??null,
      integration:{status:"unconfigured",scale:null,attachmentPoint:null,gripPoint:null,muzzlePoint:null}
    }))
  };
}
export function readSelection(data, knownIds) {
  if (!data || data.schema!=="warden-armory-selection" || data.version!==1 || !Array.isArray(data.favorites) || data.favorites.length>5000) throw new Error("This is not a supported Warden Armory shortlist.");
  const ids=[],notes={},orientations={};let skipped=0;
  for (const item of data.favorites) {
    if (!item || typeof item.id!=="string" || !knownIds.has(item.id)) {skipped++;continue;}
    ids.push(item.id);
    if (typeof item.notes==="string") notes[item.id]=item.notes.slice(0,4000);
    const rotation=item.viewerRotationRadians;
    if (Array.isArray(rotation) && rotation.length===3 && rotation.every(n=>Number.isFinite(n)&&Math.abs(n)<1000)) orientations[item.id]=rotation;
  }
  return {ids:[...new Set(ids)],notes,orientations,skipped};
}
