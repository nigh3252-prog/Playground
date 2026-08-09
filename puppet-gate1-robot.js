export const PACKAGE_SHA256='96ad5c3c58fd3ed4b6418ebfd6fd7bc47126528f98dd2a16fe1f3f5029466b9e';
export const APPEARANCE_BIND_POSE='Idle_loop @ 0.000s';

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

// The source GLB's raw/no-animation node transforms are not a useful assembled pose.
// These matrices are sampled from the original cool robot.glb at Idle_loop t=0 and
// transform each owning rigid joint from the raw source pose into the authored idle
// assembly pose. Every current robot mesh is a rigid descendant of one of these 15
// joints, so the same correction transforms its raw world matrix into the exact idle
// frame-0 world matrix without running the robot's animation at runtime.
const IDLE_BIND_CORRECTIONS={
  head:[0.999147276,0.000754080848,0.04128138,0,-0.00193856654,0.999587325,0.0286604471,0,-0.041242722,-0.0287160328,0.998736356,0,-0.0882440777,-0.308920468,0.0227073665,1],
  chest:[0.994496099,-0.00954271085,0.104338136,0,-0.00448145733,0.991057997,0.13335653,0,-0.104677721,-0.133090127,0.985560487,0,-0.072314946,-0.256755796,-0.602504894,1],
  waist:[0.924697421,0,0.380702876,0,0,1,0,0,-0.380702876,0,0.924697421,0,-0.0756542096,-0.298899531,-0.0738196346,1],
  uaL:[0.456507835,-0.48456286,-0.746189697,0,-0.364096016,0.663495901,-0.653610934,0,0.811809514,0.570063093,0.126463682,0,2.5116401,2.07769515,4.6753428,1],
  laL:[0.534781539,-0.837164615,-0.114730815,0,0.126587374,0.213619224,-0.96868032,0,0.835453967,0.503508838,0.220214156,0,0.259217327,4.62940895,4.94041186,1],
  handL:[0.394951579,-0.100385866,0.913201123,0,0.908868304,0.187744417,-0.372439458,0,-0.134060715,0.977074817,0.165387437,0,-2.08607039,3.33631965,1.02896152,1],
  uaR:[-0.233971385,0.271879112,0.933455247,0,0.478623501,0.86791539,-0.132822654,0,-0.846272184,0.415696928,-0.333195181,0,-3.42454231,0.655693992,0.981990537,1],
  laR:[0.0798232993,0.743960791,0.663438341,0,0.458229818,0.563683126,-0.687231379,0,-0.885242101,0.358864135,-0.295909897,0,-2.94640275,2.57831952,3.0864826,1],
  handR:[0.767054567,0.397359397,0.503718994,0,-0.334924124,0.917651553,-0.213873891,0,-0.547223199,-0.00465486025,0.836973912,0,0.655758632,0.915073052,1.2861028,1],
  ulL:[-0.153673385,0.480927461,0.863185478,0,-0.5536594,0.681645759,-0.478351104,0,-0.81844766,-0.551426616,0.161521027,0,2.84621229,0.536852155,1.36612232,1],
  llL:[0.172530297,-0.420688035,0.890650176,0,-0.169725667,0.877986165,0.447582054,0,-0.97027543,-0.228397304,0.0800797137,0,1.55754746,1.01808503,-0.931480091,1],
  footL:[1,-2.69600538e-10,5.88744056e-10,0,-2.69600539e-10,0.99999999,2.25604176e-08,0,5.88744059e-10,2.25604175e-08,0.999999951,0,0.253581982,0.350620582,0.507349299,1],
  ulR:[0.396556466,-0.203268658,-0.895220163,0,0.63514957,0.764845284,0.107685645,0,0.662823993,-0.611309901,0.432415764,0,-2.63733524,0.535622314,-0.846978598,1],
  llR:[0.600200173,0.54996838,-0.580771783,0,-0.0892995006,0.767636466,0.63463002,0,0.794853034,-0.329053063,0.50985006,0,-0.742401478,0.973471689,-1.95221299,1],
  footR:[0.837439383,-7.88048197e-08,0.546530428,0,2.71337448e-08,0.999999885,1.3885305e-08,0,-0.546530336,3.24633518e-09,0.837439235,0,-0.499921727,0.350620732,-0.653435546,1]
};

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
  report(`Building actual robot meshes from ${APPEARANCE_BIND_POSE}…`);
  const material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:0.72,metalness:0.18});
  const corrections=Object.fromEntries(
    Object.entries(IDLE_BIND_CORRECTIONS).map(([role,matrix])=>[role,new THREE.Matrix4().fromArray(matrix)])
  );
  const joints=Object.fromEntries(
    Object.entries(data.joints).map(([role,matrix])=>{
      const correction=corrections[role];
      if(!correction)throw new Error(`Missing idle bind correction for robot joint ${role}`);
      return [role,correction.clone().multiply(new THREE.Matrix4().fromArray(matrix))];
    })
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
    const correction=corrections[source.role];
    if(!correction)throw new Error(`Missing idle bind correction for robot piece ${source.name}`);
    pieces.push({
      name:source.name,
      role:source.role,
      matrix:correction.clone().multiply(new THREE.Matrix4().fromArray(source.m)),
      geometry,
      material
    });
  }
  return {joints,pieces,packageSha256:PACKAGE_SHA256,appearanceBindPose:APPEARANCE_BIND_POSE};
}
