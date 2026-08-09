export const PACKAGE_SHA256='96ad5c3c58fd3ed4b6418ebfd6fd7bc47126528f98dd2a16fe1f3f5029466b9e';

const PARTS=[
  {file:'actual_robot_pack_v4.b64.part0'},
  {file:'actual_robot_pack_v4.b64.part1'},
  {file:'actual_robot_pack_v4.b64.part2'},
  {file:'actual_robot_pack_v4.b64.part3'},
  {file:'actual_robot_pack_v4.b64.part4'},
  {file:'actual_robot_pack_v4.b64.part5'},
  {file:'actual_robot_pack_v4.b64.part6a',patch:'actual_robot_pack_v4.patch6a'},
  {file:'actual_robot_pack_v4.b64.part6b',patch:'actual_robot_pack_v4.patch6b'},
  {file:'actual_robot_pack_v4.b64.part6c',patch:'actual_robot_pack_v4.patch6c'},
  {file:'actual_robot_pack_v4.b64.part6d',patch:'actual_robot_pack_v4.patch6d'},
  {file:'actual_robot_pack_v4.b64.part7a'},
  {file:'actual_robot_pack_v4.b64.part7b'},
  {file:'actual_robot_pack_v4.b64.part7c'},
  {file:'actual_robot_pack_v4.b64.part7d'},
  {file:'actual_robot_pack_v4.b64.part8'}
];

const clean=text=>text.replace(/\s+/g,'');

function decodeBase64(text,label){
  const value=clean(text);
  if(!value.length)throw new Error(`${label} was empty`);
  if(value.length%4!==0)throw new Error(`${label} has invalid base64 length ${value.length}`);
  if(!/^[A-Za-z0-9+/]*={0,2}$/.test(value))throw new Error(`${label} contains a non-base64 character`);
  let binary;
  try{binary=atob(value)}catch(error){throw new Error(`${label} could not be decoded\n${error?.message||error}`)}
  const bytes=new Uint8Array(binary.length);
  for(let index=0;index<binary.length;index++)bytes[index]=binary.charCodeAt(index);
  return bytes;
}

async function fetchText(file,label){
  const url=`./assets/${file}`;
  let response;
  try{response=await fetch(url,{cache:'no-store'})}
  catch(error){throw new Error(`${label} fetch failed\n${url}\n${error?.message||error}`)}
  if(!response.ok)throw new Error(`${label} returned HTTP ${response.status}\n${url}`);
  return response.text();
}

function concatBytes(arrays){
  const total=arrays.reduce((sum,array)=>sum+array.length,0);
  const output=new Uint8Array(total);
  let offset=0;
  for(const array of arrays){output.set(array,offset);offset+=array.length}
  return output;
}

async function loadPackage(gunzipSync,report){
  const compressedParts=[];
  for(let index=0;index<PARTS.length;index++){
    const spec=PARTS[index];
    report(`Loading actual robot geometry… ${index+1}/${PARTS.length}`);
    let text=clean(await fetchText(spec.file,`Robot payload ${spec.file}`));
    if(spec.patch){
      const patch=clean(await fetchText(spec.patch,`Robot repair ${spec.patch}`));
      if(text.length!==3000)throw new Error(`${spec.file} expected 3000 characters, got ${text.length}`);
      if(patch.length!==100)throw new Error(`${spec.patch} expected 100 characters, got ${patch.length}`);
      text=text.slice(0,2600)+patch+text.slice(2700);
    }
    compressedParts.push(decodeBase64(text,`Robot payload ${spec.file}`));
  }

  const compressed=concatBytes(compressedParts);
  if(compressed[0]!==0x1f||compressed[1]!==0x8b){
    throw new Error(`Actual robot payload is not gzip data (first bytes ${compressed[0]}, ${compressed[1]})`);
  }

  let raw;
  try{raw=gunzipSync(compressed)}
  catch(error){throw new Error(`Actual robot gzip decode failed\n${error?.message||error}`)}

  let data;
  try{data=JSON.parse(new TextDecoder().decode(raw))}
  catch(error){throw new Error(`Actual robot package JSON failed\n${error?.message||error}`)}

  if(data?.version!==4)throw new Error(`Unsupported actual robot package version ${data?.version}`);
  if(!data.joints||Object.keys(data.joints).length!==15)throw new Error('Actual robot package did not contain 15 joint sockets');
  if(!Array.isArray(data.pieces)||data.pieces.length!==20){
    throw new Error(`Actual robot package contained ${data?.pieces?.length??0} pieces, expected 20`);
  }
  return data;
}

const typedCopy=(bytes,Type)=>new Type(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));

export async function loadActualRobot(THREE,gunzipSync,report){
  const data=await loadPackage(gunzipSync,report);
  report('Building actual robot meshes…');
  const material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:0.72,metalness:0.18});
  const joints=Object.fromEntries(
    Object.entries(data.joints).map(([role,matrix])=>[role,new THREE.Matrix4().fromArray(matrix)])
  );
  const pieces=[];

  for(const source of data.pieces){
    if(!joints[source.role])throw new Error(`Robot piece ${source.name} referenced missing joint ${source.role}`);
    if(source.m?.length!==16||source.lo?.length!==3||source.hi?.length!==3){
      throw new Error(`Robot piece ${source.name} has invalid transform metadata`);
    }
    const quantized=typedCopy(decodeBase64(source.p,'Embedded robot positions'),Uint16Array);
    const packedNormals=typedCopy(decodeBase64(source.n,'Embedded robot normals'),Int8Array);
    const packedColors=typedCopy(decodeBase64(source.c,'Embedded robot colors'),Uint8Array);
    const indices=source.it===32
      ?typedCopy(decodeBase64(source.i,'Embedded robot indices'),Uint32Array)
      :typedCopy(decodeBase64(source.i,'Embedded robot indices'),Uint16Array);
    if(quantized.length!==source.v*3||packedNormals.length!==source.v*3||packedColors.length!==source.v*3){
      throw new Error(`Robot piece ${source.name} has inconsistent vertex data`);
    }

    const positions=new Float32Array(source.v*3);
    const normals=new Float32Array(source.v*3);
    const colors=new Float32Array(source.v*3);
    for(let vertex=0;vertex<source.v;vertex++){
      for(let axis=0;axis<3;axis++){
        const index=vertex*3+axis;
        positions[index]=source.lo[axis]+(quantized[index]/65535)*(source.hi[axis]-source.lo[axis]);
        normals[index]=Math.max(-1,packedNormals[index]/127);
        colors[index]=packedColors[index]/255;
      }
    }

    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
    geometry.setAttribute('normal',new THREE.BufferAttribute(normals,3));
    geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));
    geometry.setIndex(new THREE.BufferAttribute(indices,1));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    pieces.push({
      name:source.name,
      role:source.role,
      matrix:new THREE.Matrix4().fromArray(source.m),
      geometry,
      material
    });
  }
  return {joints,pieces,packageSha256:PACKAGE_SHA256};
}
