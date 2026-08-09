import React,{Suspense,useEffect,useMemo,useRef} from 'react';
import {createRoot} from 'react-dom/client';
import * as THREE from 'three';
import {Canvas,useFrame,useLoader,useThree} from '@react-three/fiber';
import {Physics,RigidBody,CuboidCollider} from '@react-three/rapier';
import {Ecctrl,EcctrlAnimationStateController,useEcctrlAnimationStore} from 'ecctrl';
import {gunzipSync} from 'fflate';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {loadActualRobot} from './puppet-gate1-robot.js';

const status=document.querySelector('#status');
const stat=(text,isError=false)=>{status.textContent=text;status.classList.toggle('error',isError)};
const h=React.createElement;
const CAPSULE_HALF_HEIGHT=0.3;
const CAPSULE_RADIUS=0.3;
const FLOAT_HEIGHT=0.2;
const PUPPET_GROUND_Y=-(CAPSULE_HALF_HEIGHT+CAPSULE_RADIUS+FLOAT_HEIGHT);
const EC='https://cdn.jsdelivr.net/gh/pmndrs/ecctrl@e2f4eb899ab54787170f5472832efb0a238c0ef9/public/AnimationLibrary.glb';
const view={robot:true,puppet:false,bones:false,reset:0};

for(const key of ['robot','puppet','bones']){
  const button=document.querySelector('#'+key);
  button.onclick=()=>{view[key]=!view[key];button.dataset.on=String(view[key])};
}
document.querySelector('#reset').onclick=()=>view.reset++;

const skeletonRoles=['head','chest','waist','uaL','laL','handL','uaR','laR','handR','ulL','llL','footL','ulR','llR','footR'];
const skeletonPairs=[
  ['waist','chest'],['chest','head'],
  ['chest','uaL'],['uaL','laL'],['laL','handL'],
  ['chest','uaR'],['uaR','laR'],['laR','handR'],
  ['waist','ulL'],['ulL','llL'],['llL','footL'],
  ['waist','ulR'],['ulR','llR'],['llR','footR']
];
const norm=value=>(value||'').toLowerCase().replace(/[^a-z0-9]/g,'');
const aliases={
  head:['head','head1'],
  chest:['chest','upperchest','spine03','spine3','spine02','spine2','spine1','spine'],
  waist:['pelvis','hips','hip','waist'],
  uaL:['lupperarmbend','lupperarm','leftupperarm','leftarm','upperarml','mixamorigleftarm'],
  laL:['lforearmbend','lforearm','leftforearm','leftlowerarm','lowerarml','mixamorigleftforearm'],
  handL:['lhand','lefthand','handl','mixamoriglefthand'],
  uaR:['rupperarmbend','rupperarm','rightupperarm','rightarm','upperarmr','mixamorigrightarm'],
  laR:['rforearmbend','rforearm','rightforearm','rightlowerarm','lowerarmr','mixamorigrightforearm'],
  handR:['rhand','righthand','handr','mixamorigrighthand'],
  ulL:['lthighbend','lthigh','leftupleg','leftupperleg','thighl','mixamorigleftupleg'],
  llL:['lshin','leftshin','leftleg','leftlowerleg','calfl','lowerlegl','mixamorigleftleg'],
  footL:['lfoot','leftfoot','footl','mixamorigleftfoot'],
  ulR:['rthighbend','rthigh','rightupleg','rightupperleg','thighr','mixamorigrightupleg'],
  llR:['rshin','rightshin','rightleg','rightlowerleg','calfr','lowerlegr','mixamorigrightleg'],
  footR:['rfoot','rightfoot','footr','mixamorigrighfoot','mixamorigrig hfoot'.replace(' ',''),'mixamorigrigh tfoot'.replace(' ','')]
};

function allBones(root){
  const result=[];
  root.traverse(object=>{if(object.isBone)result.push(object)});
  return result;
}
function findBone(bones,role){
  const names=aliases[role]||[];
  for(const name of names){
    const match=bones.find(bone=>norm(bone.name)===name);
    if(match)return match;
  }
  for(const name of names){
    const matches=bones.filter(bone=>norm(bone.name).endsWith(name));
    if(matches.length)return matches.sort((a,b)=>norm(a.name).length-norm(b.name).length)[0];
  }
  for(const name of names){
    const matches=bones.filter(bone=>norm(bone.name).includes(name));
    if(matches.length)return matches.sort((a,b)=>norm(a.name).length-norm(b.name).length)[0];
  }
  return null;
}
function commonAncestor(a,b){
  if(!a||!b)return null;
  const seen=new Set();
  for(let node=a;node;node=node.parent)if(node.isBone)seen.add(node);
  for(let node=b;node;node=node.parent)if(node.isBone&&seen.has(node))return node;
  return null;
}
function inferTargets(bones){
  const targets=new Map();
  for(const role of skeletonRoles){
    const bone=findBone(bones,role);
    if(bone)targets.set(role,bone);
  }
  if(!targets.has('laL')&&targets.get('handL')?.parent?.isBone)targets.set('laL',targets.get('handL').parent);
  if(!targets.has('laR')&&targets.get('handR')?.parent?.isBone)targets.set('laR',targets.get('handR').parent);
  if(!targets.has('llL')&&targets.get('footL')?.parent?.isBone)targets.set('llL',targets.get('footL').parent);
  if(!targets.has('llR')&&targets.get('footR')?.parent?.isBone)targets.set('llR',targets.get('footR').parent);
  if(!targets.has('chest')){
    const ancestor=commonAncestor(targets.get('uaL'),targets.get('uaR'));
    if(ancestor)targets.set('chest',ancestor);
    else if(targets.get('head')?.parent?.parent?.isBone)targets.set('chest',targets.get('head').parent.parent);
  }
  return targets;
}
function averageMatrixPositions(a,b){
  return new THREE.Vector3()
    .addVectors(new THREE.Vector3().setFromMatrixPosition(a),new THREE.Vector3().setFromMatrixPosition(b))
    .multiplyScalar(0.5);
}
function keyboard(){
  const state=useRef({});
  useEffect(()=>{
    const down=event=>{state.current[event.code]=true;if(event.code==='Space')event.preventDefault()};
    const up=event=>delete state.current[event.code];
    addEventListener('keydown',down,{passive:false});
    addEventListener('keyup',up);
    return()=>{removeEventListener('keydown',down);removeEventListener('keyup',up)};
  },[]);
  return state;
}

function makeVisual(ROBOT){
  return function Visual(){
    const wrap=useRef();
    const robotLayer=useRef();
    const binding=useRef([]);
    const debug=useRef(null);
    const targetsRef=useRef(new Map());
    const previousAction=useRef();
    const gltf=useLoader(GLTFLoader,EC);
    const animationState=useEcctrlAnimationStore(state=>state.animationState);
    const puppet=gltf.scene;
    const mixer=useMemo(()=>new THREE.AnimationMixer(puppet),[puppet]);
    const actions=useMemo(()=>Object.fromEntries(gltf.animations.map(clip=>[clip.name,mixer.clipAction(clip)])),[gltf.animations,mixer]);

    useEffect(()=>{
      const map={IDLE:'Idle_Loop',WALK:'Walk_Loop',RUN:'Jog_Fwd_Loop',JUMP_START:'Jump_Start',JUMP_IDLE:'Jump_Loop',JUMP_FALL:'Jump_Loop',JUMP_LAND:'Jump_Land'};
      const name=map[animationState]||'Idle_Loop';
      const action=actions[name];
      if(!action||action===previousAction.current)return;
      action.reset();
      if(name==='Jump_Start'||name==='Jump_Land'){
        action.setLoop(THREE.LoopOnce,1);
        action.clampWhenFinished=true;
      }else action.setLoop(THREE.LoopRepeat,Infinity);
      if(previousAction.current)action.crossFadeFrom(previousAction.current,0.15,true);
      action.play();
      previousAction.current=action;
    },[animationState,actions]);

    useEffect(()=>{
      if(!wrap.current||!robotLayer.current)return;
      wrap.current.position.y=0;
      wrap.current.updateWorldMatrix(true,true);
      puppet.updateMatrixWorld(true);
      let inverseWrap=wrap.current.matrixWorld.clone().invert();
      let puppetBox=new THREE.Box3().setFromObject(puppet).applyMatrix4(inverseWrap);
      const visualYOffset=PUPPET_GROUND_Y-puppetBox.min.y;
      wrap.current.position.y=visualYOffset;
      wrap.current.updateWorldMatrix(true,true);
      puppet.updateMatrixWorld(true);
      inverseWrap=wrap.current.matrixWorld.clone().invert();
      puppetBox=new THREE.Box3().setFromObject(puppet).applyMatrix4(inverseWrap);

      const targets=inferTargets(allBones(puppet));
      targetsRef.current=targets;
      const missing=skeletonRoles.filter(role=>!targets.has(role));
      const rests=new Map();
      for(const [role,bone] of targets){
        bone.updateMatrixWorld(true);
        rests.set(role,new THREE.Matrix4().multiplyMatrices(inverseWrap,bone.matrixWorld));
      }

      const targetHead=rests.get('head');
      const targetFootL=rests.get('footL');
      const targetFootR=rests.get('footR');
      if(!ROBOT.joints.head||!ROBOT.joints.footL||!ROBOT.joints.footR||!targetHead||!targetFootL||!targetFootR){
        throw new Error('Could not establish robot and puppet head/foot landmarks');
      }
      const sourceFeet=averageMatrixPositions(ROBOT.joints.footL,ROBOT.joints.footR);
      const targetFeet=averageMatrixPositions(targetFootL,targetFootR);
      const sourceHeight=new THREE.Vector3().setFromMatrixPosition(ROBOT.joints.head).distanceTo(sourceFeet);
      const targetHeight=new THREE.Vector3().setFromMatrixPosition(targetHead).distanceTo(targetFeet);
      const scale=targetHeight/Math.max(sourceHeight,1e-5);
      const scaleMatrix=new THREE.Matrix4().makeScale(scale,scale,scale);

      robotLayer.current.clear();
      const output=[];
      for(const source of ROBOT.pieces){
        const bone=targets.get(source.role);
        const rest=rests.get(source.role);
        const sourceJoint=ROBOT.joints[source.role];
        if(!bone||!rest||!sourceJoint)continue;
        const sourcePosition=new THREE.Vector3().setFromMatrixPosition(scaleMatrix.clone().multiply(sourceJoint));
        const targetPosition=new THREE.Vector3().setFromMatrixPosition(rest);
        const snap=new THREE.Matrix4().makeTranslation(targetPosition.x-sourcePosition.x,targetPosition.y-sourcePosition.y,targetPosition.z-sourcePosition.z);
        const base=snap.multiply(scaleMatrix.clone()).multiply(source.matrix);
        const mesh=new THREE.Mesh(source.geometry,source.material);
        mesh.name=`Bound_${source.name}`;
        mesh.matrixAutoUpdate=false;
        mesh.castShadow=true;
        mesh.receiveShadow=true;
        robotLayer.current.add(mesh);
        output.push({mesh,bone,inverseRest:rest.clone().invert(),base,role:source.role});
      }
      for(const item of output.filter(entry=>entry.role==='footL'||entry.role==='footR')){
        const box=item.mesh.geometry.boundingBox?.clone().applyMatrix4(item.base);
        if(box)item.base.premultiply(new THREE.Matrix4().makeTranslation(0,puppetBox.min.y-box.min.y,0));
      }
      binding.current=output;

      const lineGeometry=new THREE.BufferGeometry();
      lineGeometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(skeletonPairs.length*6),3));
      const lineMaterial=new THREE.LineBasicMaterial({color:0x52e6ff,depthTest:false,transparent:true,opacity:0.95});
      const lines=new THREE.LineSegments(lineGeometry,lineMaterial);
      lines.frustumCulled=false;lines.renderOrder=999;
      const pointGeometry=new THREE.BufferGeometry();
      pointGeometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(skeletonRoles.length*3),3));
      const pointMaterial=new THREE.PointsMaterial({color:0xffffff,size:0.055,sizeAttenuation:true,depthTest:false});
      const points=new THREE.Points(pointGeometry,pointMaterial);
      points.frustumCulled=false;points.renderOrder=1000;
      wrap.current.add(lines,points);
      debug.current={lines,points};

      const detail=missing.length?`Missing puppet joints: ${missing.join(', ')}`:'15/15 puppet joints mapped';
      stat(`BOUND ${output.length} actual robot mesh primitives → ${targets.size}/15 puppet joints\n${detail}\nCanonical skeleton and EC Puppet share one local frame\nPuppet sole → ECCTRL ground · robot sole → puppet sole\nVisual offset ${visualYOffset.toFixed(3)} · robot scale ${scale.toFixed(3)}×`);
      return()=>{
        wrap.current?.remove(lines,points);
        lineGeometry.dispose();lineMaterial.dispose();pointGeometry.dispose();pointMaterial.dispose();
        if(debug.current?.lines===lines)debug.current=null;
      };
    },[puppet]);

    useFrame((_,deltaTime)=>{
      mixer.update(deltaTime);
      puppet.traverse(object=>{if(object.isMesh||object.isSkinnedMesh)object.visible=view.puppet});
      if(robotLayer.current)robotLayer.current.visible=view.robot;
      if(!wrap.current)return;
      wrap.current.updateWorldMatrix(true,true);
      const inverseWrap=wrap.current.matrixWorld.clone().invert();
      const position=new THREE.Vector3();

      if(debug.current){
        const {lines,points}=debug.current;
        lines.visible=view.bones;points.visible=view.bones;
        const lineArray=lines.geometry.attributes.position.array;
        const pointArray=points.geometry.attributes.position.array;
        let index=0;
        for(const [from,to] of skeletonPairs){
          for(const role of [from,to]){
            const bone=targetsRef.current.get(role);
            if(bone)bone.getWorldPosition(position).applyMatrix4(inverseWrap);else position.set(0,0,0);
            lineArray[index++]=position.x;lineArray[index++]=position.y;lineArray[index++]=position.z;
          }
        }
        lines.geometry.attributes.position.needsUpdate=true;
        index=0;
        for(const role of skeletonRoles){
          const bone=targetsRef.current.get(role);
          if(bone)bone.getWorldPosition(position).applyMatrix4(inverseWrap);else position.set(0,0,0);
          pointArray[index++]=position.x;pointArray[index++]=position.y;pointArray[index++]=position.z;
        }
        points.geometry.attributes.position.needsUpdate=true;
      }

      const current=new THREE.Matrix4();
      const boneDelta=new THREE.Matrix4();
      const desired=new THREE.Matrix4();
      for(const item of binding.current){
        item.bone.updateMatrixWorld(true);
        current.multiplyMatrices(inverseWrap,item.bone.matrixWorld);
        boneDelta.multiplyMatrices(current,item.inverseRest);
        desired.multiplyMatrices(boneDelta,item.base);
        item.mesh.matrix.copy(desired);
        item.mesh.matrixWorldNeedsUpdate=true;
      }
    });

    return h('group',{ref:wrap},h('primitive',{object:puppet}),h('group',{ref:robotLayer}));
  };
}

function makePlayer(Visual){
  return function Player(){
    const controller=useRef();
    const input=keyboard();
    const seenReset=useRef(0);
    useFrame(()=>{
      if(!controller.current)return;
      const keys=input.current;
      controller.current.setMovement({forward:!!keys.KeyW,backward:!!keys.KeyS,leftward:!!keys.KeyA,rightward:!!keys.KeyD,run:!!keys.ShiftLeft||!!keys.ShiftRight,jump:!!keys.Space});
      if(seenReset.current!==view.reset){
        seenReset.current=view.reset;
        controller.current.body?.setTranslation({x:0,y:2,z:0},true);
        controller.current.body?.setLinvel({x:0,y:0,z:0},true);
      }
    });
    return h(Ecctrl,{ref:controller,position:[0,2,0],capsuleHalfHeight:CAPSULE_HALF_HEIGHT,capsuleRadius:CAPSULE_RADIUS,floatHeight:FLOAT_HEIGHT,maxWalkVel:2,maxRunVel:5},h(EcctrlAnimationStateController,{ecctrl:controller}),h(Visual));
  };
}

function Camera(){
  const {camera,gl}=useThree();
  const controls=useMemo(()=>new OrbitControls(camera,gl.domElement),[camera,gl]);
  useEffect(()=>{
    camera.position.set(4.5,3.2,7);controls.target.set(0,1,0);controls.enableDamping=true;controls.maxPolarAngle=1.54;
    return()=>controls.dispose();
  },[controls,camera]);
  useFrame(()=>controls.update());
  return null;
}

async function boot(){
  const ROBOT=await loadActualRobot(THREE,gunzipSync,stat);
  stat('Loading ECCTRL mannequin…');
  const Player=makePlayer(makeVisual(ROBOT));
  function Scene(){
    return h(React.Fragment,null,
      h('color',{attach:'background',args:['#11151b']}),
      h('hemisphereLight',{intensity:1.25}),
      h('directionalLight',{position:[6,10,4],intensity:2,castShadow:true}),
      h(Camera),
      h(Physics,{gravity:[0,-9.81,0]},
        h(RigidBody,{type:'fixed',colliders:false},
          h(CuboidCollider,{args:[30,0.25,30],position:[0,-0.25,0]}),
          h('mesh',{position:[0,-0.25,0],receiveShadow:true},h('boxGeometry',{args:[60,0.5,60]}),h('meshStandardMaterial',{color:'#2a313b'})),
          h('gridHelper',{args:[60,60]})
        ),
        h(Player)
      )
    );
  }
  createRoot(document.querySelector('#root')).render(h(Canvas,{shadows:true,camera:{fov:48,position:[4.5,3.2,7]}},h(Suspense,{fallback:null},h(Scene))));
}

boot().catch(error=>window.__gate1Fail('Gate 1 boot failed:',error));
