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

const h=React.createElement;
const CAPSULE_HALF_HEIGHT=0.3;
const CAPSULE_RADIUS=0.3;
const FLOAT_HEIGHT=0.2;
const PUPPET_GROUND_Y=-(CAPSULE_HALF_HEIGHT+CAPSULE_RADIUS+FLOAT_HEIGHT);
const EC='https://cdn.jsdelivr.net/gh/pmndrs/ecctrl@e2f4eb899ab54787170f5472832efb0a238c0ef9/public/AnimationLibrary.glb';
const STORAGE_KEY='puppet-lab-gate1-appearance-v1';

const statusNode=document.querySelector('#status');
const detailEyebrow=document.querySelector('#detail-eyebrow');
const detailTitle=document.querySelector('#detail-title');
const detailMeta=document.querySelector('#detail-meta');
const detailControls=document.querySelector('#detail-controls');
const saveIndicator=document.querySelector('#save-indicator');
const topbarPill=document.querySelector('#topbar-pill');
const contextLabel=document.querySelector('#context-label');
const contextRail=document.querySelector('#context-rail');
const modeRail=document.querySelector('#mode-rail');

let runtimeStatus='Booting Puppet Lab…';
let runtimeError=false;
let runtimeInfo={
  pieceCount:0,
  jointCount:0,
  scale:0,
  visualYOffset:0,
  packageSha:'',
  bindPose:'',
  boneNames:{},
  binding:'Idle appearance frame'
};

const BODY_PARTS=[
  ['head','Head'],
  ['chest','Chest'],
  ['waist','Waist'],
  ['uaL','L Upper Arm'],
  ['laL','L Forearm'],
  ['handL','L Hand'],
  ['uaR','R Upper Arm'],
  ['laR','R Forearm'],
  ['handR','R Hand'],
  ['ulL','L Upper Leg'],
  ['llL','L Lower Leg'],
  ['footL','L Foot'],
  ['ulR','R Upper Leg'],
  ['llR','R Lower Leg'],
  ['footR','R Foot']
].map(([id,label])=>({id,label}));

const BODY_BY_ID=Object.fromEntries(BODY_PARTS.map(part=>[part.id,part]));
const skeletonRoles=BODY_PARTS.map(part=>part.id);
const skeletonPairs=[
  ['waist','chest'],['chest','head'],
  ['chest','uaL'],['uaL','laL'],['laL','handL'],
  ['chest','uaR'],['uaR','laR'],['laR','handR'],
  ['waist','ulL'],['ulL','llL'],['llL','footL'],
  ['waist','ulR'],['ulR','llR'],['llR','footR']
];

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
  ulR:['rthighbend','rthigh','rightupleg','rightupperleg','thighr','mixamorigrighthupleg'],
  llR:['rshin','rightshin','rightleg','rightlowerleg','calfr','lowerlegr','mixamorigrightleg'],
  footR:['rfoot','rightfoot','footr','mixamorigrightfoot']
};

const MODES=[
  {
    id:'play',label:'PLAY',
    items:[
      {id:'robot',label:'Robot',sub:'appearance'},
      {id:'puppet',label:'EC Puppet',sub:'source body'},
      {id:'bones',label:'Skeleton',sub:'15 joints'},
      {id:'reset',label:'Reset',sub:'position'}
    ]
  },
  {id:'bind',label:'BIND',items:BODY_PARTS},
  {id:'tweak',label:'TWEAK',items:BODY_PARTS},
  {
    id:'debug',label:'DEBUG',
    items:[
      {id:'robot',label:'Robot'},
      {id:'puppet',label:'EC Puppet'},
      {id:'bones',label:'Skeleton'},
      {id:'resetAppearance',label:'Reset Tweaks'}
    ]
  }
];
const MODE_BY_ID=Object.fromEntries(MODES.map(mode=>[mode.id,mode]));

const ui={
  activeMode:'play',
  step:'normal',
  memory:Object.fromEntries(MODES.map(mode=>[
    mode.id,
    {
      selected:(mode.id==='play'?'robot':mode.id==='debug'?'bones':'head'),
      scrollLeft:0,
      visited:false
    }
  ]))
};

const view={robot:true,puppet:false,bones:false,reset:0};
const defaultTweak=()=>({p:[0,0,0],r:[0,0,0],s:1,hidden:false,frame:'appearance'});
function sanitizeTweak(source){
  const fallback=defaultTweak();
  if(!source||typeof source!=='object')return fallback;
  const p=Array.isArray(source.p)&&source.p.length===3?source.p.map(Number):fallback.p;
  const r=Array.isArray(source.r)&&source.r.length===3?source.r.map(Number):fallback.r;
  const s=Number.isFinite(Number(source.s))?Math.min(3,Math.max(0.1,Number(source.s))):1;
  return {
    p:p.map(value=>Number.isFinite(value)?value:0),
    r:r.map(value=>Number.isFinite(value)?value:0),
    s,
    hidden:!!source.hidden,
    frame:source.frame==='puppet'?'puppet':'appearance'
  };
}
function loadTweaks(){
  const result=Object.fromEntries(skeletonRoles.map(role=>[role,defaultTweak()]));
  try{
    const saved=JSON.parse(localStorage.getItem(STORAGE_KEY)||'{}');
    for(const role of skeletonRoles)if(saved[role])result[role]=sanitizeTweak(saved[role]);
  }catch(error){
    console.warn('Could not read saved Puppet Lab appearance',error);
  }
  return result;
}
const tweaks=loadTweaks();

let saveTimer=0;
function saveTweaks(){
  try{
    localStorage.setItem(STORAGE_KEY,JSON.stringify(tweaks));
    saveIndicator.textContent='Saved';
    clearTimeout(saveTimer);
    saveTimer=setTimeout(()=>{saveIndicator.textContent=''},1000);
  }catch(error){
    saveIndicator.textContent='Save failed';
    console.warn(error);
  }
}
function resetRole(role){
  tweaks[role]=defaultTweak();
  saveTweaks();
}
function resetAllTweaks(){
  for(const role of skeletonRoles)tweaks[role]=defaultTweak();
  saveTweaks();
}

function stat(text,isError=false){
  runtimeStatus=text;
  runtimeError=isError;
  statusNode.textContent=text;
  statusNode.classList.toggle('error',isError);
  statusNode.hidden=!(isError||ui.activeMode==='debug');
  if(document.body.dataset.ready==='true')renderDetail();
}
window.__gate1Fail=(label,error)=>stat(label+'\n'+(error?.message||error||'Unknown error'),true);

const norm=value=>(value||'').toLowerCase().replace(/[^a-z0-9]/g,'');
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
function tweakMatrix(role,target=new THREE.Matrix4()){
  const tweak=tweaks[role]||defaultTweak();
  const position=new THREE.Vector3(...tweak.p);
  const quaternion=new THREE.Quaternion().setFromEuler(new THREE.Euler(...tweak.r,'XYZ'));
  const scale=new THREE.Vector3(tweak.s,tweak.s,tweak.s);
  return target.compose(position,quaternion,scale);
}
function roleLabel(role){return BODY_BY_ID[role]?.label||role}
function selectedRole(mode=ui.activeMode){
  return ['bind','tweak'].includes(mode)?ui.memory[mode].selected:null;
}

function modeDef(id=ui.activeMode){return MODE_BY_ID[id]}
function saveContextPosition(){ui.memory[ui.activeMode].scrollLeft=contextRail.scrollLeft}
function renderModeRail(){
  modeRail.innerHTML=MODES.map(mode=>
    `<button class="chip" type="button" data-mode="${mode.id}" aria-pressed="${mode.id===ui.activeMode}">${mode.label}</button>`
  ).join('');
}
function contextPressed(itemId){
  if(ui.activeMode==='play'||ui.activeMode==='debug'){
    if(itemId==='robot')return view.robot;
    if(itemId==='puppet')return view.puppet;
    if(itemId==='bones')return view.bones;
    return false;
  }
  return ui.memory[ui.activeMode].selected===itemId;
}
function renderContext(){
  const mode=modeDef();
  const memory=ui.memory[ui.activeMode];
  contextLabel.textContent=mode.label;
  contextRail.innerHTML=mode.items.map(item=>{
    const tweak=tweaks[item.id];
    const sub=item.sub||(ui.activeMode==='tweak'&&tweak?.hidden?'hidden':'');
    return `<button class="chip" type="button" data-item="${item.id}" aria-pressed="${contextPressed(item.id)}">
      ${item.label}${sub?`<small>${sub}</small>`:''}
    </button>`;
  }).join('');
  requestAnimationFrame(()=>{
    contextRail.scrollLeft=memory.visited?memory.scrollLeft:0;
    memory.visited=true;
  });
  renderDetail();
}
function setMode(next){
  if(!MODE_BY_ID[next]||next===ui.activeMode)return;
  saveContextPosition();
  ui.activeMode=next;
  modeRail.querySelectorAll('[data-mode]').forEach(button=>{
    button.setAttribute('aria-pressed',String(button.dataset.mode===next));
  });
  renderContext();
}
function formatPosition(value){return `${value>=0?'+':''}${value.toFixed(3)}`}
function formatRotation(value){
  const degrees=THREE.MathUtils.radToDeg(value);
  return `${degrees>=0?'+':''}${degrees.toFixed(0)}°`;
}
function stepValues(){
  if(ui.step==='fine')return {p:0.005,r:THREE.MathUtils.degToRad(1),s:0.01};
  if(ui.step==='coarse')return {p:0.10,r:THREE.MathUtils.degToRad(15),s:0.10};
  return {p:0.02,r:THREE.MathUtils.degToRad(5),s:0.05};
}
function axisControl(kind,axis,label,value){
  const formatted=kind==='p'?formatPosition(value):formatRotation(value);
  return `<div class="axis-control">
    <div class="axis-title"><span>${label}</span><span class="axis-value">${formatted}</span></div>
    <div class="axis-buttons">
      <button type="button" data-nudge="${kind}" data-axis="${axis}" data-dir="-1">−</button>
      <button type="button" data-nudge="${kind}" data-axis="${axis}" data-dir="1">+</button>
    </div>
  </div>`;
}
function renderTweakControls(role){
  const tweak=tweaks[role];
  return `
    <div class="compact-row">
      <button class="mini-button ${ui.step==='fine'?'active':''}" type="button" data-step="fine">Fine</button>
      <button class="mini-button ${ui.step==='normal'?'active':''}" type="button" data-step="normal">Normal</button>
      <button class="mini-button ${ui.step==='coarse'?'active':''}" type="button" data-step="coarse">Coarse</button>
      <button class="mini-button ${tweak.hidden?'active':''}" type="button" data-action="hide">${tweak.hidden?'Show':'Hide'}</button>
      <button class="mini-button danger" type="button" data-action="reset-role">Reset Part</button>
    </div>
    <div class="section-label">Position · bone-local</div>
    <div class="axis-grid">
      ${axisControl('p',0,'X',tweak.p[0])}
      ${axisControl('p',1,'Y',tweak.p[1])}
      ${axisControl('p',2,'Z',tweak.p[2])}
    </div>
    <div class="section-label">Rotation</div>
    <div class="axis-grid">
      ${axisControl('r',0,'X',tweak.r[0])}
      ${axisControl('r',1,'Y',tweak.r[1])}
      ${axisControl('r',2,'Z',tweak.r[2])}
    </div>
    <div class="section-label">Scale</div>
    <div class="scale-row">
      <button class="mini-button" type="button" data-nudge="s" data-dir="-1">−</button>
      <div class="scale-value">${tweak.s.toFixed(2)}×</div>
      <button class="mini-button" type="button" data-nudge="s" data-dir="1">+</button>
    </div>`;
}
function renderDetail(){
  if(!detailEyebrow)return;
  const mode=ui.activeMode;
  const role=selectedRole();
  topbarPill.textContent=runtimeInfo.bindPose||'Idle bind';
  statusNode.hidden=!(runtimeError||mode==='debug');

  if(mode==='play'){
    detailEyebrow.textContent='Play';
    detailTitle.textContent='Robot on ECCTRL puppet';
    detailMeta.textContent=`${runtimeInfo.pieceCount||'—'} robot pieces · ${runtimeInfo.jointCount||'—'}/15 joints · ${runtimeInfo.bindPose||'Idle_loop bind pose'}.`;
    detailControls.innerHTML=`<div class="compact-row">
      <button class="mini-button" type="button" data-quick="robot" aria-pressed="${view.robot}">Robot</button>
      <button class="mini-button" type="button" data-quick="puppet" aria-pressed="${view.puppet}">EC Puppet</button>
      <button class="mini-button" type="button" data-quick="bones" aria-pressed="${view.bones}">Skeleton</button>
    </div>`;
    return;
  }

  if(mode==='bind'&&role){
    const tweak=tweaks[role];
    detailEyebrow.textContent='Bind';
    detailTitle.textContent=roleLabel(role);
    detailMeta.textContent='Compare the authored Idle appearance orientation with a strict ECCTRL joint-frame attachment. Movement always comes from ECCTRL.';
    detailControls.innerHTML=`
      <dl class="bind-grid">
        <dt>Robot reference</dt><dd>${runtimeInfo.bindPose||'Idle_loop @ 0.000s'}</dd>
        <dt>EC joint</dt><dd>${runtimeInfo.boneNames[role]||role}</dd>
        <dt>Attachment</dt><dd>${tweak.frame==='puppet'?'Strict puppet frame':'Preserve idle appearance'}</dd>
      </dl>
      <div class="compact-row" style="margin-top:7px">
        <button class="mini-button ${tweak.frame==='appearance'?'active':''}" type="button" data-frame="appearance">Idle Appearance</button>
        <button class="mini-button ${tweak.frame==='puppet'?'active':''}" type="button" data-frame="puppet">Puppet Frame</button>
        <button class="mini-button" type="button" data-quick="bones" aria-pressed="${view.bones}">Skeleton</button>
      </div>`;
    return;
  }

  if(mode==='tweak'&&role){
    const tweak=tweaks[role];
    detailEyebrow.textContent='Tweak';
    detailTitle.textContent=roleLabel(role);
    detailMeta.textContent=`Additive attachment delta · ${tweak.frame==='puppet'?'Puppet frame':'Idle appearance'} base · automatically saved on this device.`;
    detailControls.innerHTML=renderTweakControls(role);
    return;
  }

  detailEyebrow.textContent='Debug';
  detailTitle.textContent='Puppet / appearance diagnostics';
  detailMeta.textContent=`Scale ${runtimeInfo.scale?runtimeInfo.scale.toFixed(3)+'×':'—'} · visual offset ${Number.isFinite(runtimeInfo.visualYOffset)?runtimeInfo.visualYOffset.toFixed(3):'—'} · package ${runtimeInfo.packageSha?runtimeInfo.packageSha.slice(0,10):'—'}.`;
  detailControls.innerHTML=`<div class="compact-row">
    <button class="mini-button" type="button" data-quick="robot" aria-pressed="${view.robot}">Robot</button>
    <button class="mini-button" type="button" data-quick="puppet" aria-pressed="${view.puppet}">EC Puppet</button>
    <button class="mini-button" type="button" data-quick="bones" aria-pressed="${view.bones}">Skeleton</button>
    <button class="mini-button danger" type="button" data-action="reset-all">Reset All Tweaks</button>
  </div>`;
  statusNode.textContent=runtimeStatus;
}

function toggleView(key){
  if(key==='reset'){view.reset++;return}
  if(key==='robot'||key==='puppet'||key==='bones')view[key]=!view[key];
  renderContext();
}
function handleItem(item){
  if(ui.activeMode==='play'){
    toggleView(item);
    return;
  }
  if(ui.activeMode==='debug'){
    if(item==='resetAppearance'){
      if(confirm('Reset every saved appearance tweak?'))resetAllTweaks();
      renderContext();
      return;
    }
    toggleView(item);
    return;
  }
  ui.memory[ui.activeMode].selected=item;
  renderContext();
}

modeRail.addEventListener('click',event=>{
  const button=event.target.closest('[data-mode]');
  if(button)setMode(button.dataset.mode);
});
contextRail.addEventListener('click',event=>{
  const button=event.target.closest('[data-item]');
  if(button)handleItem(button.dataset.item);
});
contextRail.addEventListener('scroll',saveContextPosition,{passive:true});

detailControls.addEventListener('click',event=>{
  const button=event.target.closest('button');
  if(!button)return;
  const quick=button.dataset.quick;
  if(quick){toggleView(quick);return}
  const step=button.dataset.step;
  if(step){
    ui.step=step;
    renderDetail();
    return;
  }
  const role=selectedRole();
  if(button.dataset.frame&&role){
    tweaks[role].frame=button.dataset.frame==='puppet'?'puppet':'appearance';
    saveTweaks();
    renderDetail();
    return;
  }
  const action=button.dataset.action;
  if(action==='hide'&&role){
    tweaks[role].hidden=!tweaks[role].hidden;
    saveTweaks();renderContext();return;
  }
  if(action==='reset-role'&&role){
    resetRole(role);renderContext();return;
  }
  if(action==='reset-all'){
    if(confirm('Reset every saved appearance tweak?')){resetAllTweaks();renderContext()}
    return;
  }
  const kind=button.dataset.nudge;
  if(!kind||!role)return;
  const direction=Number(button.dataset.dir)||0;
  const steps=stepValues();
  if(kind==='p'){
    const axis=Number(button.dataset.axis);
    tweaks[role].p[axis]+=direction*steps.p;
  }else if(kind==='r'){
    const axis=Number(button.dataset.axis);
    tweaks[role].r[axis]+=direction*steps.r;
  }else if(kind==='s'){
    tweaks[role].s=Math.min(3,Math.max(0.1,tweaks[role].s+direction*steps.s));
  }
  saveTweaks();
  renderDetail();
});

for(const rail of [contextRail,modeRail]){
  let dragging=false,moved=false,startX=0,startScroll=0;
  rail.addEventListener('pointerdown',event=>{
    if(event.pointerType==='touch')return;
    dragging=true;moved=false;startX=event.clientX;startScroll=rail.scrollLeft;
    rail.setPointerCapture?.(event.pointerId);
  });
  rail.addEventListener('pointermove',event=>{
    if(!dragging)return;
    const dx=event.clientX-startX;
    if(Math.abs(dx)>4)moved=true;
    rail.scrollLeft=startScroll-dx;
  });
  rail.addEventListener('pointerup',event=>{
    dragging=false;
    rail.releasePointerCapture?.(event.pointerId);
  });
  rail.addEventListener('click',event=>{
    if(moved){event.preventDefault();event.stopPropagation();moved=false}
  },true);
}

renderModeRail();
renderContext();

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
      const boneNames={};
      for(const [role,bone] of targets){
        bone.updateMatrixWorld(true);
        rests.set(role,new THREE.Matrix4().multiplyMatrices(inverseWrap,bone.matrixWorld));
        boneNames[role]=bone.name||role;
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

        // Appearance base: keep the authored Idle_loop frame-0 orientation, but seat its
        // source joint at the ECCTRL joint. The local attachment below is then expressed
        // in the EC bone's complete rest frame, so runtime position AND rotation come
        // from the authoritative ECCTRL bone rather than a world-space delta.
        const sourcePosition=new THREE.Vector3().setFromMatrixPosition(scaleMatrix.clone().multiply(sourceJoint));
        const targetPosition=new THREE.Vector3().setFromMatrixPosition(rest);
        const snap=new THREE.Matrix4().makeTranslation(
          targetPosition.x-sourcePosition.x,
          targetPosition.y-sourcePosition.y,
          targetPosition.z-sourcePosition.z
        );
        const appearanceBase=snap.multiply(scaleMatrix.clone()).multiply(source.matrix);
        let appearanceLocal=rest.clone().invert().multiply(appearanceBase);

        // Strict full-frame alternative: map the robot mesh's actual source-joint-local
        // transform directly into the EC joint frame. BIND mode can switch each part
        // between this and the authored appearance frame without rebuilding geometry.
        const sourceLocal=sourceJoint.clone().invert().multiply(source.matrix);
        let puppetLocal=scaleMatrix.clone().multiply(sourceLocal);

        const material=source.material.clone();
        const mesh=new THREE.Mesh(source.geometry,material);
        mesh.name=`Bound_${source.name}`;
        mesh.matrixAutoUpdate=false;
        mesh.castShadow=true;
        mesh.receiveShadow=true;
        robotLayer.current.add(mesh);

        const entry={mesh,material,bone,rest,appearanceLocal,puppetLocal,role:source.role};
        output.push(entry);
      }

      // Keep the visual sole aligned with the puppet sole for both bind strategies.
      for(const item of output.filter(entry=>entry.role==='footL'||entry.role==='footR')){
        for(const key of ['appearanceLocal','puppetLocal']){
          const local=item[key];
          const rest=item.rest;
          const base=rest.clone().multiply(local);
          const box=item.mesh.geometry.boundingBox?.clone().applyMatrix4(base);
          if(!box)continue;
          const dy=puppetBox.min.y-box.min.y;
          const worldCorrection=new THREE.Matrix4().makeTranslation(0,dy,0);
          item[key]=rest.clone().invert().multiply(worldCorrection).multiply(rest).multiply(local);
        }
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

      runtimeInfo={
        pieceCount:output.length,
        jointCount:targets.size,
        scale,
        visualYOffset,
        packageSha:ROBOT.packageSha256||'',
        bindPose:ROBOT.appearanceBindPose||'Idle_loop @ 0.000s',
        boneNames,
        binding:'Full EC joint frame + appearance offset'
      };
      const detail=missing.length?`Missing puppet joints: ${missing.join(', ')}`:'15/15 puppet joints mapped';
      stat(`BOUND ${output.length} actual robot mesh primitives → ${targets.size}/15 puppet joints\n${detail}\nIdle_loop appearance bind + full EC joint-frame runtime\nPuppet sole → ECCTRL ground · robot sole → puppet sole\nVisual offset ${visualYOffset.toFixed(3)} · robot scale ${scale.toFixed(3)}×`);
      renderDetail();

      return()=>{
        wrap.current?.remove(lines,points);
        lineGeometry.dispose();lineMaterial.dispose();pointGeometry.dispose();pointMaterial.dispose();
        for(const item of output)item.material.dispose();
        if(debug.current?.lines===lines)debug.current=null;
      };
    },[puppet]);

    useFrame((_,deltaTime)=>{
      mixer.update(deltaTime);
      puppet.traverse(object=>{if(object.isMesh||object.isSkinnedMesh)object.visible=view.puppet});
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
      const tweak=new THREE.Matrix4();
      const desired=new THREE.Matrix4();
      const selected=selectedRole();
      const editing=ui.activeMode==='bind'||ui.activeMode==='tweak';

      for(const item of binding.current){
        item.bone.updateMatrixWorld(true);
        current.multiplyMatrices(inverseWrap,item.bone.matrixWorld);
        tweakMatrix(item.role,tweak);
        const local=tweaks[item.role]?.frame==='puppet'?item.puppetLocal:item.appearanceLocal;
        desired.copy(current).multiply(tweak).multiply(local);
        item.mesh.matrix.copy(desired);
        item.mesh.matrixWorldNeedsUpdate=true;
        item.mesh.visible=view.robot&&!tweaks[item.role]?.hidden;

        const highlighted=editing&&item.role===selected;
        if(item.material.emissive){
          item.material.emissive.setHex(highlighted?0x173c4a:0x000000);
          item.material.emissiveIntensity=highlighted?0.9:0;
        }
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
      controller.current.setMovement({
        forward:!!keys.KeyW,backward:!!keys.KeyS,leftward:!!keys.KeyA,rightward:!!keys.KeyD,
        run:!!keys.ShiftLeft||!!keys.ShiftRight,jump:!!keys.Space
      });
      if(seenReset.current!==view.reset){
        seenReset.current=view.reset;
        controller.current.body?.setTranslation({x:0,y:2,z:0},true);
        controller.current.body?.setLinvel({x:0,y:0,z:0},true);
      }
    });
    return h(Ecctrl,{
      ref:controller,position:[0,2,0],
      capsuleHalfHeight:CAPSULE_HALF_HEIGHT,capsuleRadius:CAPSULE_RADIUS,floatHeight:FLOAT_HEIGHT,
      maxWalkVel:2,maxRunVel:5
    },h(EcctrlAnimationStateController,{ecctrl:controller}),h(Visual));
  };
}

function Camera(){
  const {camera,gl}=useThree();
  const controls=useMemo(()=>new OrbitControls(camera,gl.domElement),[camera,gl]);
  useEffect(()=>{
    camera.position.set(4.5,3.2,7);
    controls.target.set(0,1,0);
    controls.enableDamping=true;
    controls.maxPolarAngle=1.54;
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
          h('mesh',{position:[0,-0.25,0],receiveShadow:true},
            h('boxGeometry',{args:[60,0.5,60]}),
            h('meshStandardMaterial',{color:'#2a313b'})
          ),
          h('gridHelper',{args:[60,60]})
        ),
        h(Player)
      )
    );
  }
  createRoot(document.querySelector('#root')).render(
    h(Canvas,{shadows:true,camera:{fov:48,position:[4.5,3.2,7]}},
      h(Suspense,{fallback:null},h(Scene))
    )
  );
  document.body.dataset.ready='true';
  renderDetail();
}

boot().catch(error=>window.__gate1Fail('Puppet Lab boot failed:',error));
