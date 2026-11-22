"""Bellows: a 12 metre kitbash spike, assembled exclusively from donor mesh parts.
Run: blender -b -t 4 -P labs/kitbash/bellows/build_bellows.py
All model geometry comes from the three catalogued GLBs; the render floor is excluded.
Design/recipe coordinates are glTF (X right, Y up, +Z facing forward).
"""
import bpy, math, json, struct, pathlib, hashlib, sys
import numpy as np
from mathutils import Vector, Matrix, Euler
ROOT=pathlib.Path(__file__).resolve().parents[3]
OUT=pathlib.Path(__file__).resolve().parent
OUT.mkdir(parents=True,exist_ok=True)
ASSETS=ROOT/'models/assets'
SOURCES={'shark':'shark-jaw-stalker-standalone-v1.glb','pond':'shelf-buddies-pond-scum-v1.glb','beetle':'flying-furnace-beetle-v1.glb'}
C=np.array([[1,0,0,0],[0,0,-1,0],[0,1,0,0],[0,0,0,1]],dtype=float)

def trans(v):
 m=np.eye(4);m[:3,3]=v;return m

def rot(v):
 x,y,z=v;cx,sx=math.cos(x),math.sin(x);cy,sy=math.cos(y),math.sin(y);cz,sz=math.cos(z),math.sin(z)
 r=np.eye(4);r[:3,:3]=np.array([[cz,-sz,0],[sz,cz,0],[0,0,1]])@np.array([[cy,0,sy],[0,1,0],[-sy,0,cy]])@np.array([[1,0,0],[0,cx,-sx],[0,sx,cx]]);return r

class Donor:
 def __init__(self,path):
  self.path=path;b=path.read_bytes();n=struct.unpack_from('<I',b,12)[0];self.g=json.loads(b[20:20+n]);self.buf=b[28+n:];self.parents={c:i for i,nd in enumerate(self.g['nodes']) for c in nd.get('children',[])};self.cache={}
 def mat(self,i):
  nd=self.g['nodes'][i]
  if 'matrix' in nd:m=np.array(nd['matrix']).reshape(4,4).T
  else:
   m=trans(nd.get('translation',[0,0,0]));s=np.diag([*nd.get('scale',[1,1,1]),1]);q=nd.get('rotation',[0,0,0,1]);x,y,z,w=q;r=np.eye(4);r[:3,:3]=[[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],[2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],[2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]];m=m@r@s
  return self.mat(self.parents[i])@m if i in self.parents else m
 def accessor(self,i):
  a=self.g['accessors'][i];v=self.g['bufferViews'][a['bufferView']];ct=a['componentType'];dt={5120:'i1',5121:'u1',5122:'<i2',5123:'<u2',5125:'<u4',5126:'<f4'}[ct];k={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}[a['type']];d=np.dtype(dt);stride=v.get('byteStride',k*d.itemsize)
  return np.ndarray((a['count'],k),dtype=d,buffer=self.buf,offset=v.get('byteOffset',0)+a.get('byteOffset',0),strides=(stride,d.itemsize)).copy()
 def get(self,i):
  if i in self.cache:return self.cache[i]
  nd=self.g['nodes'][i];vs=[];fs=[]
  for prim in self.g['meshes'][nd['mesh']]['primitives']:
   assert prim.get('mode',4)==4,'Triangle donor mesh required'
   p=self.accessor(prim['attributes']['POSITION']);p=(np.column_stack([p,np.ones(len(p))])@self.mat(i).T)[:,:3]
   ind=self.accessor(prim['indices']).flatten() if 'indices' in prim else np.arange(len(p));faces=ind.reshape(-1,3)+len(vs);vs.extend(p.tolist());fs.extend(faces.tolist())
  self.cache[i]=(np.array(vs),fs);return self.cache[i]
D={k:Donor(ASSETS/v) for k,v in SOURCES.items()}
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
for a in list(bpy.data.actions):bpy.data.actions.remove(a)
scene=bpy.context.scene
scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1
scene.render.fps=30

def material(name,color,metal=.3,rough=.6,emit=0):
 m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1);p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=rough
 if emit:p.inputs['Emission Color'].default_value=(*color,1);p.inputs['Emission Strength'].default_value=emit
 return m
M={
 'oxide':material('Bellows | fired oxide',(.46,.105,.033),.40,.62),
 'orange':material('Bellows | heat orange',(.79,.255,.065),.35,.56),
 'burnt':material('Bellows | aged orange',(.30,.055,.018),.40,.68),
 'ivory':material('Bellows | ceramic ivory',(.79,.72,.51),.22,.48),
 'teeth':material('Bellows | tooth ceramic',(.95,.88,.67),.12,.36),
 'soot':material('Bellows | sooted iron',(.028,.042,.046),.55,.53),
 'black':material('Bellows | mouth recess',(.006,.011,.014),.05,.9),
 'bronze':material('Bellows | valve bronze',(.49,.275,.07),.67,.40),
 'cyan':material('Bellows | pressure cyan',(.025,.70,.85),.25,.32,1.4),
 'darkcyan':material('Bellows | cooled throat',(.017,.17,.18),.5,.45),
}
MODEL=[];recipe=[]

def empty(name,pos=(0,0,0),parent=None):
 o=bpy.data.objects.new(name,None);scene.collection.objects.link(o);o.empty_display_type='PLAIN_AXES';o.location=Vector((pos[0],-pos[2],pos[1]));
 if parent:
  bpy.context.view_layer.update();o.parent=parent;o.matrix_parent_inverse=parent.matrix_world.inverted()
 MODEL.append(o);return o
root=empty('Bellows_Root')
body=empty('Bellows_Breathing_Body',(0,5.6,-.6),root)
jaw=empty('Bellows_Jaw_Hinge',(0,5.4,3.0),body)
rear={s:empty('Bellows_Rear_Haunch_'+('L' if s<0 else 'R'),(s*5.8,4.8,-2.2),root) for s in [-1,1]}
front={s:empty('Bellows_Front_Limb_'+('L' if s<0 else 'R'),(s*5.7,5.2,2.6),root) for s in [-1,1]}
tanks={s:empty('Bellows_Pressure_Tank_'+('L' if s<0 else 'R'),(s*4.3,8.4,-3.1),body) for s in [-1,1]}

def part(name,donor,node,dims,center,mat,parent=body,rotation=(0,0,0),fit=None,mirror=False):
 verts,faces=D[donor].get(node);lo=verts.min(0);hi=verts.max(0);cent=(lo+hi)/2
 if fit is None:
  scale=np.array(dims)/(hi-lo);aff=trans(center)@rot(rotation)@np.diag([*scale,1])@trans(-cent)
 else:aff=np.array(fit)
 p=(np.column_stack([verts,np.ones(len(verts))])@(C@aff).T)[:,:3]
 if np.linalg.det(aff[:3,:3])<0:faces=[f[::-1] for f in faces]
 mesh=bpy.data.meshes.new(name+'_donor_mesh');mesh.from_pydata(p.tolist(),[],faces);mesh.update();mesh.materials.append(M[mat]);o=bpy.data.objects.new(name,mesh);scene.collection.objects.link(o)
 if parent:
  bpy.context.view_layer.update();o.parent=parent;o.matrix_parent_inverse=parent.matrix_world.inverted()
 o['donor_file']=SOURCES[donor];o['donor_node_id']=node;o['donor_mesh_id']=D[donor].g['nodes'][node]['mesh'];o['kitbash_geometry']='Affine transformed original donor triangles';o['kitbash_role']=name
 MODEL.append(o)
 recipe.append({'name':name,'source':str(pathlib.Path('models/assets')/SOURCES[donor]),'node_id':node,'node_name':D[donor].g['nodes'][node].get('name'),'mesh_id':D[donor].g['nodes'][node]['mesh'],'source_world_to_design_matrix_row_major':aff.tolist(),'material':M[mat].name,'parent':parent.name if parent else None,'triangles':len(faces),'topology':'original donor triangles; affine transform only'})
 return o,aff

# Large nested masses: abdomen, dorsal plate, and the body beneath the mouth.
part('Pressure_Belly','beetle',1,(12.4,7.8,10.2),(0,6.1,-1.2),'soot')
part('Frog_Back_Carapace','pond',32,(12.1,5.3,9.9),(0,8.0,-1.65),'oxide')
part('Belly_Forward_Armour','beetle',2,(11.7,5.6,6.9),(0,4.8,.4),'burnt')
# Turn the shark's long side-profile arch into a wide frontal maw.
_,upper=part('Upper_Maw_Ceramic_Arch','shark',3,(13.8,3.9,3.3),(0,7.65,4.65),'ivory')
part('Upper_Maw_Orange_Armour','shark',4,None,None,'orange',fit=upper)
# Actual original lower-jaw topology, widened into a massive scoop.
_,lower=part('Lower_Maw_Ceramic_Arch','shark',55,(13.0,3.4,4.1),(0,3.0,4.7),'ivory',jaw)
part('Lower_Maw_Inner_Trim','shark',56,None,None,'orange',jaw,fit=lower)
part('Mouth_Dark_Cavity','beetle',38,(12.3,5.7,1.8),(0,5.4,4.38),'black')
part('Throat_Pressure_Casing','beetle',3,(6.4,3.25,1.3),(0,5.25,4.84),'soot')
throat,_=part('Throat_Cyan_Diaphragm','beetle',4,(4.9,1.95,1.05),(0,5.26,5.44),'cyan')
part('Tongue_Pressure_Ramp','beetle',40,(6.0,1.1,3.25),(0,3.4,5.05),'darkcyan',jaw)
# Chunky alternating ceramic teeth, taken from the shark's triangular tooth mesh.
for k,x in enumerate([-5.1,-3.4,-1.7,0,1.7,3.4,5.1]):
 y=6.72-.051*x*x
 part('Upper_Tooth_%02d'%k,'shark',93,(1.05,1.52,.92),(x,y,6.28),'teeth')
for k,x in enumerate([-4.5,-2.25,0,2.25,4.5]):
 y=3.78+.042*x*x
 part('Lower_Tooth_%02d'%k,'shark',74,(1.0,1.25,.9),(x,y,6.46),'teeth',jaw)
# Circular cheek bearings keep the deliberately broad mouth mechanically readable.
for s in [-1,1]:
 tag='L' if s<0 else 'R'
 part('Jaw_Bearing_'+tag,'shark',47,(2.15,2.15,1.8),(s*6.55,5.55,4.55),'soot')
 part('Jaw_Bearing_Bronze_'+tag,'shark',49,(1.45,1.45,1.97),(s*6.55,5.55,4.65),'bronze')
 part('Jaw_Bearing_Cyan_Cap_'+tag,'beetle',4,(.78,.78,.22),(s*6.55,5.55,5.72),'cyan')
 # Raised eyes read above the broad hood, with little extra silhouette noise.
 part('Eye_Turret_'+tag,'pond',18,(3.5,2.65,3.5),(s*4.4,9.10,3.20),'oxide')
 part('Eye_Socket_'+tag,'beetle',43,(2.9,1.15,1.0),(s*4.45,9.54,4.57),'soot')
 part('Eye_Cyan_Slit_'+tag,'beetle',44,(2.0,.40,.50),(s*4.45,9.56,5.00),'cyan')
 part('Eye_Heavy_Brow_'+tag,'beetle',45,(3.30,.9,1.42),(s*4.45,10.10,4.45),'orange',rotation=(0,0,s*.12))
 # Each rear leg has a broad armored haunch, an exposed knee bearing and a folded shank.
 h=rear[s]
 part('Rear_Haunch_Underbody_'+tag,'beetle',1,(6.1,6.2,7.2),(s*7.1,4.25,-2.2),'soot',h)
 part('Rear_Haunch_Armour_'+tag,'pond',18,(5.9,5.8,6.75),(s*7.6,4.80,-2.15),'orange',h,rotation=(0,s*.13,s*.10))
 part('Rear_Haunch_Secondary_'+tag,'beetle',3,(2.1,3.9,5.1),(s*9.30,4.65,-2.25),'oxide',h)
 part('Rear_Knee_Bearing_'+tag,'shark',47,(2.65,2.65,1.15),(s*9.10,2.70,-2.5),'soot',h,rotation=(0,math.pi/2,0))
 part('Rear_Knee_Hub_'+tag,'shark',49,(1.65,1.65,1.35),(s*9.4,2.7,-2.5),'bronze',h,rotation=(0,math.pi/2,0))
 part('Rear_Folded_Shin_'+tag,'shark',107,(2.8,2.3,5.4),(s*7.9,1.55,-4.2),'oxide',h)
 part('Rear_Foot_'+tag,'pond',6,(4.2,1.02,5.2),(s*7.9,.51,-3.25),'soot',h)
 for k,dx in enumerate([-1.3,0,1.3]):
  part('Rear_Toe_'+tag+'_'+str(k),'beetle',15,(1.0,.66,1.8),(s*7.9+dx,.41,-.28),'ivory',h)
 # Smaller forelimbs brace the front of the frog body.
 h=front[s]
 part('Front_Shoulder_'+tag,'pond',25,(3.5,3.4,3.35),(s*5.9,5.0,2.65),'oxide',h)
 part('Front_Arm_'+tag,'pond',19,(2.05,4.5,2.35),(s*6.85,3.33,3.4),'soot',h,rotation=(0,0,s*.30))
 part('Front_Arm_Shield_'+tag,'shark',143,(2.55,3.3,2.6),(s*7.05,3.30,3.60),'orange',h,rotation=(0,0,s*.25))
 part('Front_Wrist_'+tag,'shark',115,(2.15,2.2,2.3),(s*7.50,1.50,5.0),'oxide',h)
 part('Front_Palm_'+tag,'pond',6,(3.15,1.0,3.30),(s*7.5,.50,5.5),'soot',h)
 for k,dx in enumerate([-.92,0,.92]):
  part('Front_Claw_'+tag+'_'+str(k),'beetle',15,(.72,.55,1.55),(s*7.5+dx,.33,7.22),'ivory',h)
 # Paired pressure vessels with simple bronze collars and large valve handles.
 t=tanks[s]
 part('Pressure_Vessel_'+tag,'beetle',2,(3.65,5.2,4.45),(s*4.3,9.25,-3.15),'orange',t)
 part('Pressure_Vessel_Crown_'+tag,'beetle',3,(3.45,1.1,3.85),(s*4.3,11.62,-3.15),'soot',t)
 part('Pressure_Valve_Stem_'+tag,'shark',102,(.85,1.2,.85),(s*4.3,12.12,-3.15),'bronze',t)
 part('Pressure_Valve_Handle_'+tag,'shark',47,(1.8,1.8,.42),(s*4.3,12.52,-3.15),'bronze',t,rotation=(math.pi/2,0,0))
 # Furnace abdomen plates are now the lateral pressure ribs.
 for j,z in enumerate([-3.8,-1.55,.7]):
  part('Pressure_Rib_'+tag+'_'+str(j),'beetle',3,(1.25,2.6,1.85),(s*5.86,7.1,z),'soot')
  part('Pressure_Port_'+tag+'_'+str(j),'beetle',4,(.45,1.50,1.1),(s*6.4,7.1,z+.08),'cyan')

# The neutral model is exactly 12m tall, standing on Y=0 in glTF.
bpy.context.view_layer.update()
def bounds():
 pts=[o.matrix_world@v.co for o in MODEL if o.type=='MESH' for v in o.data.vertices]
 return Vector([min(p[k] for p in pts) for k in range(3)]),Vector([max(p[k] for p in pts) for k in range(3)])
lo,hi=bounds();factor=12.0/(hi.z-lo.z);root.scale=(factor,)*3;root.location.z=-lo.z*factor;bpy.context.view_layer.update();lo,hi=bounds()
neutralroot=root.location.copy();neutralbody=body.location.copy()
all_control=[root,body,jaw,*rear.values(),*front.values(),*tanks.values()]
rest={o.name:{'location':o.location.copy(),'rotation_euler':o.rotation_euler.copy(),'scale':o.scale.copy()} for o in all_control}

def reset():
 for o in all_control:
  for prop,v in rest[o.name].items():setattr(o,prop,v.copy())

def clip(name,frames,func):
 actions={}
 for o in all_control:
  o.animation_data_create();a=bpy.data.actions.new(name+'__'+o.name);o.animation_data.action=a;actions[o.name]=a
 for f in frames:
  scene.frame_set(f);reset();func(f)
  for o in all_control:
   # Insert all three transforms so clips can be switched without stale controls.
   for prop in ['location','rotation_euler','scale']:o.keyframe_insert(data_path=prop,frame=f,group=o.name)
 for o in all_control:
  a=actions[o.name]
  if hasattr(a,'fcurves'):
   for fc in a.fcurves:
    for k in fc.keyframe_points:k.interpolation='BEZIER'
  o.animation_data.action=None;track=o.animation_data.nla_tracks.new();track.name=name;strip=track.strips.new(name,1,a);strip.extrapolation='NOTHING';strip.blend_type='REPLACE'
 reset();scene.frame_set(1)

def idle(f):
 phase=math.sin((f-1)/120*math.tau)
 body.location.z=neutralbody.z+.11*phase
 body.scale=(1+.012*phase,1+.020*phase,1+.018*phase)
 jaw.rotation_euler.x=.035*(1-math.cos((f-1)/120*math.tau))
 for s in [-1,1]:tanks[s].rotation_euler.y=s*.016*phase
clip('Idle',[1,16,31,46,61,76,91,106,121],idle)

# A non-gameplay attack study: inhale, compression, squat, hop, and weighted landing.
# Values are deliberate coarse keys, with no simulated trajectory or foot IK.
keys={1:(0,0,0,0),31:(.16,0,.10,0),61:(.40,0,.22,0),86:(.54,0,-.12,0),99:(.23,1.35,.08,-.09855),112:(.12,3.3,.12,-.2409),132:(.20,1.75,.06,-.12775),148:(.50,0,-.24,0),166:(.15,0,.05,0),190:(0,0,0,0)}
def charge(f):
 angle,lift,bodylift,crouch=keys[f]
 jaw.rotation_euler.x=angle
 root.location.z=neutralroot.z+lift
 body.location.z=neutralbody.z+bodylift
 body.scale=(1+.07*(angle/.54),1+.05*(angle/.54),1+.02*(angle/.54))
 for s in [-1,1]:
  rear[s].rotation_euler.x=crouch
  rear[s].rotation_euler.y=s*crouch*.35
  front[s].rotation_euler.x=-crouch*.55
  tanks[s].rotation_euler.y=s*.05*(angle/.54)
clip('Charge_Jump_Demo',list(keys),charge)
scene.frame_start=1;scene.frame_end=190;reset();scene.frame_set(1)
bpy.context.view_layer.update();lo,hi=bounds()
# Export selected asset nodes only, with a standard glTF coordinate system.
bpy.ops.object.select_all(action='DESELECT')
for o in MODEL:o.select_set(True)
bpy.context.view_layer.objects.active=root
# Capture exact neutral local TRS before the NLA exporter temporarily resets controls.
neutral_node_trs={}
for ob in MODEL:
 local=ob.parent.matrix_world.inverted()@ob.matrix_world if ob.parent else ob.matrix_world.copy()
 gm=Matrix((np.linalg.inv(C)@np.array(local)@C).tolist())
 loc,quat,sca=gm.decompose()
 neutral_node_trs[ob.name]={'translation':list(loc),'rotation':[quat.x,quat.y,quat.z,quat.w],'scale':list(sca)}
bpy.ops.export_scene.gltf(filepath=str(OUT/'bellows.glb'),export_format='GLB',use_selection=True,export_yup=True,export_animations=True,export_animation_mode='NLA_TRACKS',export_anim_slide_to_zero=True,export_frame_range=False,export_force_sampling=True,export_extras=True,export_materials='EXPORT')
# Blender 4.3's NLA exporter resets non-varying animated object TRS to defaults.
# Restore the captured neutral node transforms. Animation samplers remain untouched.
# Every animation channel overrides its property normally, while omitted constant
# channels now inherit the intended pivot positions and 12m global scale.
export_path=OUT/'bellows.glb'
blob=export_path.read_bytes();json_len=struct.unpack_from('<I',blob,12)[0]
gltf=json.loads(blob[20:20+json_len]);restored=0
for nd in gltf['nodes']:
 if nd.get('name') in neutral_node_trs:
  nd.pop('matrix',None);nd.update(neutral_node_trs[nd['name']]);restored+=1
encoded=json.dumps(gltf,separators=(',',':'),ensure_ascii=False).encode('utf8')
encoded+=b' '*((-len(encoded))%4)
remaining_chunks=blob[20+json_len:]
export_path.write_bytes(struct.pack('<4sII',b'glTF',2,20+len(encoded)+len(remaining_chunks))+struct.pack('<II',len(encoded),0x4E4F534A)+encoded+remaining_chunks)
print('Restored exact neutral TRS on',restored,'model nodes; animation buffers unchanged.')
# Derivative recipe and provenance, including full affine transforms for every mesh.
catalog=json.loads((ROOT/'models/catalog.json').read_text())
credits=[v for v in catalog['models'] if (v.get('asset') or '').split('/')[-1] in SOURCES.values()]
manifest={
 'schema_version':1,'name':'Bellows','status':'throwaway 3D kitbash spike; no game integration',
 'coordinate_system':'glTF 2.0: +X right, +Y up, +Z forward; metres',
 'dimensions_m':{'width':hi.x-lo.x,'height':hi.z-lo.z,'depth':hi.y-lo.y},
 'neutral_bounds_gltf':{'min':[lo.x,lo.z,-hi.y],'max':[hi.x,hi.z,-lo.y]},
 'target_height_m':12,'warden_reference_height_m':4,'height_multiplier_vs_warden':3,
 'neutral_frame':1,'rest_pose_export':'Captured neutral local TRS restored after Blender 4.3 NLA export; animation buffers are unchanged.','global_scale':factor,'global_translation_gltf':[0,float(root.location.z),0],
 'triangles':sum(len(o.data.polygons) for o in MODEL if o.type=='MESH'),
 'mesh_parts':sum(o.type=='MESH' for o in MODEL),'rig':'named rigid-part pivots with NLA-exported glTF animation',
 'clips':[{'name':'Idle','seconds':4.0,'purpose':'slow body inflation and jaw breathing'},{'name':'Charge_Jump_Demo','seconds':6.3,'purpose':'inhale, mouth open, crouch, hop, heavy landing'}],
 'source_mesh_policy':'Every exported model triangle is copied from a selected donor mesh. No primitive mesh is added to the model; donor topology is retained and affine-transformed. Render floor/lights/camera are excluded.',
 'source_files':[{'path':str(pathlib.Path('models/assets')/fn),'sha256':hashlib.sha256((ASSETS/fn).read_bytes()).hexdigest()} for fn in SOURCES.values()],
 'donor_credits':credits,'license':'Derivative study inherits donor provenance. No public reuse license specified for the donors; no CC0 claim.',
 'composition':'Shark side-profile upper and lower arches become a broad frontal amphibian maw. Pond Scum head/shoulder/arm/foot meshes become back armor and asymmetric-sized limbs. Furnace Beetle abdomen, mouth, carapace and ports become pressure vessels, throat, knees and ribs.',
 'limitations':['Visual study only: rigid part animation, no skinning, foot IK, colliders, gameplay, VFX or damage states.','A deliberate warm oxide/ivory/cyan material replacement unifies the low-poly donor parts; painted v2 texture donor is not used.','Donor intersections are intentional assembly joints and armor overlaps.','Jump demo is an expressive in-place preview, not an authored production locomotion or root-motion system.'],
 'parts':recipe}
(OUT/'recipe.json').write_text(json.dumps(manifest,indent=2))
(OUT/'donor_catalog_records.json').write_text(json.dumps(credits,indent=2))
if '--export-only' in sys.argv:
 bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'bellows.blend'))
 print('BELLOWS_REPORT '+json.dumps({k:manifest[k] for k in ['dimensions_m','triangles','mesh_parts','clips']}))
 sys.exit(0)
# Studio render stage, intentionally separate from the self-contained GLB.
for o in all_control:
 for tr in o.animation_data.nla_tracks:tr.mute=True
reset();scene.frame_set(1);bpy.context.view_layer.update()
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.03));floor=bpy.context.object;floor.name='RENDER_ONLY_Floor';floor.data.materials.append(material('RENDER_ONLY_FloorMat',(.035,.045,.053),.18,.8))
world=scene.world;world.use_nodes=True;world.node_tree.nodes['Background'].inputs[0].default_value=(.045,.065,.078,1);world.node_tree.nodes['Background'].inputs[1].default_value=.45
look=Vector((0,-.5,5.2))
bpy.ops.object.camera_add(location=(23.5,-31,20));cam=bpy.context.object;cam.name='RENDER_ONLY_Camera';cam.rotation_euler=(look-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=28.8;scene.camera=cam
for name,loc,energy,col,size in [('Key',(-12,-15,24),4400,(1,.77,.55),14),('Fill',(12,-9,12),3000,(.59,.83,1),12),('Rim',(2,13,21),5800,(1,.38,.14),11)]:
 bpy.ops.object.light_add(type='AREA',location=loc);l=bpy.context.object;l.name='RENDER_ONLY_'+name;l.data.energy=energy;l.data.color=col;l.data.shape='DISK';l.data.size=size;l.rotation_euler=(look-l.location).to_track_quat('-Z','Y').to_euler()
scene.render.engine='BLENDER_EEVEE_NEXT';scene.eevee.taa_render_samples=32;scene.render.resolution_x=1280;scene.render.resolution_y=1024;scene.render.resolution_percentage=100;scene.render.image_settings.file_format='PNG';scene.render.film_transparent=False;scene.view_settings.view_transform='AgX'
scene.render.filepath=str(OUT/'bellows-neutral.png');bpy.ops.render.render(write_still=True)
# Front orthographic is useful for judging the new jaw composition.
cam.location=(0,-38,13);cam.rotation_euler=(Vector((0,-.6,5.5))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.ortho_scale=26.5
scene.render.filepath=str(OUT/'bellows-front.png');bpy.ops.render.render(write_still=True)
# Show the same asset at its peak charge pose.
for o in all_control:
 for tr in o.animation_data.nla_tracks:tr.mute=(tr.name!='Charge_Jump_Demo')
scene.frame_set(86);cam.location=(23.5,-31,20);cam.rotation_euler=(look-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.ortho_scale=28.8
scene.render.filepath=str(OUT/'bellows-charge.png');bpy.ops.render.render(write_still=True)
# Save a useful authored scene in its neutral state with the stage available.
for o in all_control:
 for tr in o.animation_data.nla_tracks:tr.mute=False
scene.frame_set(1);reset();bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'bellows.blend'))
print('BELLOWS_REPORT '+json.dumps({k:manifest[k] for k in ['dimensions_m','triangles','mesh_parts','clips']}))
