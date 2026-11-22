"""Reproducible, donor-mesh-only Brood Loom visual spike.

Run: blender --background --python labs/kitbash/brood-loom/build_brood_loom.py
Source geometry is decoded from the three GLB donors. No creature mesh is
generated from a Blender primitive. Display-only floor/lights/camera are not
exported. All positions in the design section use glTF metres: Y up, +Z front.
"""
import bpy
import json
import math
import struct
import hashlib
import sys
from pathlib import Path
from mathutils import Vector, Matrix, Quaternion

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
ASSETS = REPO / 'models' / 'assets'
SOURCES = {
    'arakhne': 'beast-hangar-arakhne-v1.glb',
    'orbital': 'warden-early-crawler-orbital-shell-v1.glb',
    'ferry': 'warden-machine-brood-ferry-v1.glb',
}

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for dat in list(bpy.data.actions): bpy.data.actions.remove(dat)

C = Matrix(((1,0,0,0),(0,0,-1,0),(0,1,0,0),(0,0,0,1)))
CI = C.inverted()
def cv(v): return Vector((v[0],-v[2],v[1]))
def arr(v): return [round(float(x),8) for x in v]
def matarr(m): return [[round(float(x),8) for x in row] for row in m]

donors = {}
for key, filename in SOURCES.items():
    blob=(ASSETS/filename).read_bytes()
    jlen,jtyp=struct.unpack_from('<II',blob,12)
    doc=json.loads(blob[20:20+jlen])
    offset=20+jlen
    blen,btyp=struct.unpack_from('<II',blob,offset)
    donors[key]={'doc':doc,'bin':blob[offset+8:offset+8+blen],
                 'filename':filename,'sha256':hashlib.sha256(blob).hexdigest()}

def accessor(key, index):
    donor=donors[key]; doc=donor['doc']; a=doc['accessors'][index]
    view=doc['bufferViews'][a['bufferView']]
    count={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}[a['type']]
    fmt,size={5126:('f',4),5125:('I',4),5123:('H',2),5121:('B',1),5122:('h',2),5120:('b',1)}[a['componentType']]
    off=view.get('byteOffset',0)+a.get('byteOffset',0)
    stride=view.get('byteStride',count*size)
    return [struct.unpack_from('<'+fmt*count,donor['bin'],off+i*stride) for i in range(a['count'])]

def source_geometry(key, node_index):
    doc=donors[key]['doc']; node=doc['nodes'][node_index]
    verts=[]; faces=[]
    for prim in doc['meshes'][node['mesh']]['primitives']:
        assert prim.get('mode',4)==4
        p=accessor(key,prim['attributes']['POSITION']); base=len(verts); verts.extend(p)
        idx=[x[0] for x in accessor(key,prim['indices'])] if 'indices' in prim else list(range(len(p)))
        faces.extend(tuple(base+idx[j+k] for k in range(3)) for j in range(0,len(idx),3))
    return verts,faces

def source_matrix(key,node_index):
    node=donors[key]['doc']['nodes'][node_index]
    if 'matrix' in node:
        a=node['matrix']; return Matrix([[a[c*4+r] for c in range(4)] for r in range(4)])
    t=Matrix.Translation(Vector(node.get('translation',(0,0,0))))
    q=node.get('rotation',(0,0,0,1)); r=Quaternion((q[3],q[0],q[1],q[2])).to_matrix().to_4x4()
    s=Matrix.Diagonal(Vector(tuple(node.get('scale',(1,1,1)))+(1,)))
    return t@r@s

def material(name,color,metallic=.45,roughness=.42,emission=0):
    m=bpy.data.materials.new(name); m.diffuse_color=(*color,1); m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF'); p.inputs['Base Color'].default_value=(*color,1)
    p.inputs['Metallic'].default_value=metallic; p.inputs['Roughness'].default_value=roughness
    if emission:
        p.inputs['Emission Color'].default_value=(*color,1); p.inputs['Emission Strength'].default_value=emission
    return m

M={
    'navy':material('Brood Loom | midnight blue enamel',(0.024,.070,.100),.63,.35),
    'teal':material('Brood Loom | weathered teal carapace',(.045,.185,.205),.55,.39),
    'edge':material('Brood Loom | oxidised seam trim',(.21,.36,.355),.70,.32),
    'dark':material('Brood Loom | black joint steel',(.016,.023,.029),.73,.42),
    'steel':material('Brood Loom | exposed blue steel',(.15,.205,.22),.78,.31),
    'ceramic':material('Brood Loom | ivory brood ceramic',(.73,.75,.61),.18,.36),
    'warm':material('Brood Loom | amber optics',(.96,.30,.055),.25,.3,3.4),
    'vent':material('Brood Loom | warm brood seams',(.53,.14,.025),.25,.4,1.2),
}
COLL=bpy.data.collections.new('BROOD LOOM | exported creature')
bpy.context.scene.collection.children.link(COLL)
parts=[]; pivots=[]; records=[]

def add_empty(name,loc=(0,0,0),parent=None):
    ob=bpy.data.objects.new(name,None); COLL.objects.link(ob); ob.empty_display_size=.2
    ob.location=cv(loc)
    if parent:
        bpy.context.view_layer.update()
        mw=ob.matrix_world.copy(); ob.parent=parent; ob.matrix_world=mw
    pivots.append(ob); return ob

ROOT=add_empty('Brood_Loom__12m')
BODY=add_empty('Thorax_Frame',(0,7.4,1.3),ROOT)
ABDOMEN=add_empty('Abdomen_Breath',(0,8.35,-2.5),BODY)

def set_parent_world(ob,parent):
    bpy.context.view_layer.update(); mw=ob.matrix_world.copy(); ob.parent=parent; ob.matrix_world=mw

def make_mesh(key,node_index,name,mat_key='navy',normalize=True,crop=None,smooth=False):
    verts,faces=source_geometry(key,node_index)
    low=Vector(tuple(min(v[i] for v in verts) for i in range(3)))
    high=Vector(tuple(max(v[i] for v in verts) for i in range(3)))
    center=(low+high)/2; extent=high-low
    if crop:
        def test(f):
            cent=sum((Vector(verts[i]) for i in f),Vector())/3
            if crop=='shell_L': return cent.x<=0 and cent.y>-.28
            if crop=='shell_R': return cent.x>=0 and cent.y>-.28
            return True
        faces=[f for f in faces if test(f)]
    if normalize:
        vv=[cv(tuple((v[i]-center[i])/extent[i] for i in range(3))) for v in verts]
        norm=Matrix.Diagonal(Vector((1/extent.x,1/extent.y,1/extent.z,1)))@Matrix.Translation(-center)
    else: vv=[cv(v) for v in verts]; norm=Matrix.Identity(4)
    mesh=bpy.data.meshes.new(name+'__donor_mesh'); mesh.from_pydata(vv,[],faces); mesh.materials.append(M[mat_key]); mesh.update()
    for p in mesh.polygons: p.use_smooth=smooth
    ob=bpy.data.objects.new(name,mesh); COLL.objects.link(ob); parts.append(ob)
    node=donors[key]['doc']['nodes'][node_index]
    rec={'name':name,'source_file':SOURCES[key],'source_node_index':node_index,
         'source_node_name':node.get('name'),'source_mesh_index':node['mesh'],
         'source_node_transform_gltf':matarr(source_matrix(key,node_index)),
         'mesh_normalization_from_source_local_gltf':matarr(norm),
         'crop':crop,'triangle_count':len(faces),'material':M[mat_key].name,
         'operation':'duplicate donor mesh; normalize and transform' if normalize else 'duplicate donor mesh; retain source local geometry'}
    ob['source_file']=SOURCES[key]; ob['source_node']=str(node_index)+':'+str(node.get('name','unnamed'))
    ob['kitbash_part']=True; records.append((ob,rec)); return ob

def fit(key,node,name,dims,pos,mat='navy',parent=ROOT,crop=None,smooth=False,rotation=None):
    ob=make_mesh(key,node,name,mat,True,crop,smooth)
    ob.location=cv(pos); ob.scale=(dims[0],dims[2],dims[1])
    if rotation:
        # XYZ design rotations in glTF axes, degrees.
        r=Matrix.Identity(4)
        for ax,a in zip('XYZ',rotation): r=r@Matrix.Rotation(math.radians(a),4,ax)
        q=(C@r@CI).to_quaternion(); ob.rotation_mode='QUATERNION'; ob.rotation_quaternion=q
    if parent: set_parent_world(ob,parent)
    return ob

def rod(key,node,name,start,end,width,depth=None,mat='steel',parent=ROOT,smooth=False):
    a=cv(start); b=cv(end); delta=b-a
    ob=make_mesh(key,node,name,mat,True,None,smooth)
    ob.location=(a+b)/2; ob.rotation_mode='QUATERNION'; ob.rotation_quaternion=delta.to_track_quat('Z','Y')
    ob.scale=(width,depth or width,delta.length)
    if parent: set_parent_world(ob,parent)
    return ob

# The abdomen is a new shell-and-sac assembly, not an imported complete model.
fit('orbital',3,'Abdomen_Inner_Brood_Sac',(6.6,5.65,8.8),(0,8.15,-2.75),'dark',ABDOMEN,smooth=True)
shells=[]
for side,sign in [('L',-1),('R',1)]:
    hinge=add_empty('Carapace_'+side+'_Hinge',(sign*.18,11.65,-2.75),ABDOMEN)
    shell=fit('orbital',3,'Carapace_'+side+'_Cut_Donor_Shell',(7.2,6.75,9.25),(0,8.45,-2.75),'teal',hinge,crop='shell_'+side,smooth=False)
    shells.append((hinge,sign))

# Torus rings and a recycled ferry plate form the load-bearing brood cradle.
fit('ferry',3,'Ventral_Brood_Cradle',(4.8,.55,6.65),(0,5.82,-2.6),'navy',ABDOMEN,smooth=False)
for i,(z,w,h,cy) in enumerate([(-.65,6.80,5.85,8.0),(-3.35,6.85,6.3,8.05),(-5.6,4.2,4.7,8.1)]):
    fit('orbital',4,f'Abdomen_Circumferential_Rib_{i+1}',(w,h,.24),(0,cy,z),'edge',ABDOMEN,smooth=True)

# A short dorsal row gives the large shell a readable mechanical spine.
for i,(z,w) in enumerate([(0.0,1.02),(-1.8,1.18),(-3.6,1.06),(-5.25,.73)]):
    y=11.72 if i in (1,2) else (11.28 if i==0 else 10.76)
    fit('arakhne',8,f'Dorsal_Keel_Plate_{i+1}',(w,.35,1.22),(0,y,z),'navy',ABDOMEN)
    fit('arakhne',7,f'Dorsal_Keel_Amber_Inlay_{i+1}',(.15,.07,.70),(0,y+.205,z),'vent',ABDOMEN)

# Cephalothorax and narrow neck unify head, legs, and abdomen.
fit('ferry',4,'Cephalothorax_Armored_Housing',(4.4,3.05,4.8),(0,7.6,2.1),'navy',BODY,smooth=False)
fit('ferry',3,'Cephalothorax_Underside_Plate',(3.55,.62,4.4),(0,6.45,2.05),'dark',BODY)
rod('ferry',2,'Thorax_To_Abdomen_Junction',(0,7.35,.2),(0,8.0,-1.7),2.55,2.55,'steel',BODY)
rod('ferry',8,'Head_Neck_Bearing',(0,7.55,3.8),(0,7.15,4.85),1.48,1.48,'steel',BODY)

# Preserve the complete Arakhne head's relative mesh layout; only recolor and
# relocate this one anatomical subtree, never its humanoid donor body.
HEAD=add_empty('Head_Six_Eye_Gimbal',(0,7.16,5.02),BODY)
HEAD.scale=(1.22,1.22,1.22)
head_rotation=Matrix.Rotation(math.radians(-10),4,'X')
HEAD.rotation_mode='QUATERNION'; HEAD.rotation_quaternion=(C@head_rotation@CI).to_quaternion()
for ni in donors['arakhne']['doc']['nodes'][47]['children']:
    name=donors['arakhne']['doc']['nodes'][ni].get('name',str(ni))
    mat='navy' if ni in (48,49) else ('warm' if ni in (50,51,52,54,55,56) else 'ceramic')
    ob=make_mesh('arakhne',ni,'Head_'+name,mat,False,None,ni not in (53,57))
    ob.parent=HEAD; ob.matrix_basis=C@source_matrix('arakhne',ni)@CI

# Four bilateral leg pairs. Their lengths and attachment points are newly
# composed from genuine Arakhne thigh, tibia, joint, armor, and claw meshes.
leg_pivots=[]
leg_layout=[
    # hip y,z; knee x,y,z; foot x,y,z
    ((7.5,3.15),(5.8,9.5,5.65),(8.9,.08,8.65)),
    ((7.65,1.62),(7.25,10.2,2.65),(10.9,.08,3.65)),
    ((7.5,-.05),(7.6,10.15,-1.45),(11.4,.08,-2.65)),
    ((7.45,-1.65),(6.65,9.55,-5.15),(9.1,.08,-8.25)),
]
for side,sgn in [('L',-1),('R',1)]:
    for idx,(hyz,k,f) in enumerate(leg_layout,1):
        hip=(sgn*(1.65 if idx<3 else 1.7),hyz[0],hyz[1])
        knee=(sgn*k[0],k[1],k[2]); foot=(sgn*f[0],f[1],f[2])
        hipv=Vector(hip); kneev=Vector(knee); footv=Vector(foot)
        hiproot=add_empty(f'Leg_{side}{idx}_Hip_Pivot',hip,BODY)
        kneeroot=add_empty(f'Leg_{side}{idx}_Knee_Pivot',knee,hiproot)
        leg_pivots.append((hiproot,kneeroot,sgn,idx))
        fit('arakhne',11,f'Leg_{side}{idx}_Hip_Joint',(1.05,.9,1.05),hip,'steel',hiproot,smooth=False)
        rod('arakhne',59,f'Leg_{side}{idx}_Femur',hip,knee,.49,.44,'dark',hiproot)
        # Armor sleeves overlap the joints and stop before the sharp elbow.
        ap=hipv.lerp(kneev,.17); bp=hipv.lerp(kneev,.83)
        rod('arakhne',9,f'Leg_{side}{idx}_Femur_Carapace',tuple(ap),tuple(bp),.86,.72,'navy',hiproot)
        fit('arakhne',11,f'Leg_{side}{idx}_Knee_Joint',(.92,.92,.92),knee,'edge',kneeroot)
        t1=kneev.lerp(footv,.015); t2=kneev.lerp(footv,.9)
        rod('arakhne',61,f'Leg_{side}{idx}_Tibia',tuple(t1),tuple(t2),.31,.28,'steel',kneeroot)
        rod('arakhne',28,f'Leg_{side}{idx}_Tibia_Blade',tuple(kneev.lerp(footv,.035)),tuple(kneev.lerp(footv,.52)),.61,.48,'teal',kneeroot)
        rod('arakhne',62,f'Leg_{side}{idx}_Ground_Spike',tuple(kneev.lerp(footv,.86)),tuple(footv),.40,.35,'dark',kneeroot)
        # A restrained warning stripe faces outward along each upper segment.
        p=hipv.lerp(kneev,.74); p.x+=sgn*.23
        fit('arakhne',7,f'Leg_{side}{idx}_Joint_Indicator',(.16,.40,.18),tuple(p),'warm',hiproot)

# Front pedipalps are short, blade-ended manipulators, not another body overlay.
for side,sgn in [('L',-1),('R',1)]:
    pivot=add_empty('Pedipalp_'+side+'_Pivot',(sgn*.85,6.7,5.6),HEAD)
    a=(sgn*.85,6.6,5.55); b=(sgn*1.65,5.8,6.65); tip=(sgn*1.25,4.9,7.3)
    rod('arakhne',59,'Pedipalp_'+side+'_Upper',a,b,.33,.33,'steel',pivot)
    fit('arakhne',11,'Pedipalp_'+side+'_Joint',(.56,.56,.56),b,'edge',pivot)
    rod('arakhne',62,'Pedipalp_'+side+'_Ceramic_Claw',b,tip,.52,.48,'ceramic',pivot)

# Six pendulous ceramic capsules. Each hangs from an exposed stem and collar.
EGGS=[]
for row,z in enumerate([-.45,-2.65,-4.85]):
    for side,sgn in [('L',-1),('R',1)]:
        x=sgn*(1.38 if row<2 else 1.05)
        y=4.2 if row<2 else 4.42
        pivot=add_empty(f'Brood_Capsule_{row+1}{side}_Suspension',(x,5.94,z),ABDOMEN)
        rod('ferry',8,f'Brood_Capsule_{row+1}{side}_Stem',(x,5.97,z),(x,5.2,z),.23,.23,'dark',pivot)
        fit('ferry',2,f'Brood_Capsule_{row+1}{side}_Collar',(1.20,.32,1.20),(x,5.23,z),'edge',pivot,smooth=False)
        fit('ferry',4,f'Brood_Capsule_{row+1}{side}_Ceramic_Egg',(1.38,2.45,1.46),(x,y,z),'ceramic',pivot,smooth=False)
        fit('ferry',9,f'Brood_Capsule_{row+1}{side}_Base_Valve',(.52,.19,.52),(x,y-1.13,z),'dark',pivot)
        fit('arakhne',7,f'Brood_Capsule_{row+1}{side}_Warm_Seam',(.11,1.1,.085),(x,y,z+.72),'vent',pivot)
        EGGS.append((pivot,sgn,row))

# Snapshot original neutral transforms, then normalize the entire assembly to
# exactly twelve metres high and ground the lowest actual mesh vertex at Y=0.
bpy.context.view_layer.update()
def bounds(objects):
    pts=[ob.matrix_world@v.co for ob in objects for v in ob.data.vertices]
    return Vector(tuple(min(p[i] for p in pts) for i in range(3))),Vector(tuple(max(p[i] for p in pts) for i in range(3)))
lo,hi=bounds(parts); factor=12/(hi.z-lo.z)
ROOT.scale=(factor,)*3; ROOT.location.z=-lo.z*factor
bpy.context.view_layer.update(); lo,hi=bounds(parts)
neutral={ob.name:{'location':ob.location.copy(),'rotation_mode':ob.rotation_mode,'rotation_euler':ob.rotation_euler.copy(),'rotation_quaternion':ob.rotation_quaternion.copy(),'scale':ob.scale.copy()} for ob in pivots}

def restore():
    for ob in pivots:
        d=neutral[ob.name]; ob.location=d['location']; ob.rotation_mode=d['rotation_mode']; ob.rotation_euler=d['rotation_euler']; ob.rotation_quaternion=d['rotation_quaternion']; ob.scale=d['scale']

def animate(ob,clip,keys,path):
    ob.animation_data_create(); ob.animation_data.action=None
    for frame,value in keys:
        setattr(ob,path,value); ob.keyframe_insert(data_path=path,frame=frame-1)
    action=ob.animation_data.action; action.name=clip+'__'+ob.name
    for fcurve in action.fcurves:
        for kp in fcurve.keyframe_points: kp.interpolation='BEZIER'
    track=ob.animation_data.nla_tracks.new(); track.name=clip
    strip=track.strips.new(clip,0,action); strip.action_frame_start=0; strip.action_frame_end=max(k[0] for k in keys)-1
    ob.animation_data.action=None
    # Tracks are muted only while rendering neutral, exporter includes them.
    track.mute=True
    restore()

# A restrained idle: thorax stays fixed, abdomen breathes, eggs swing from their
# attachment points, head surveys. Feet remain planted in the neutral clip.
base=neutral[ABDOMEN.name]['scale']
animate(ABDOMEN,'idle',[(1,base),(31,Vector((base.x*1.016,base.y*1.012,base.z*1.022))),(61,base)],'scale')
for ob,sgn,row in EGGS:
    ob.rotation_mode='XYZ'; neutral[ob.name]['rotation_mode']='XYZ'
    e=neutral[ob.name]['rotation_euler']
    animate(ob,'idle',[(1,e),(16,Vector((e.x+sgn*.018,e.y,e.z+.018*(row-1)))),(31,e),(46,Vector((e.x-sgn*.018,e.y,e.z-.018*(row-1)))),(61,e)],'rotation_euler')
HEAD.rotation_mode='XYZ'; neutral[HEAD.name]['rotation_mode']='XYZ'; neutral[HEAD.name]['rotation_euler']=HEAD.rotation_euler.copy()
headbase=neutral[HEAD.name]['rotation_euler']
animate(HEAD,'idle',[(1,headbase),(31,Vector((headbase.x+.025,headbase.y,headbase.z+.035))),(61,headbase)],'rotation_euler')

# A brood readiness gesture peels the donor-shell halves and swings the eggs
# out by a few degrees. It is a visual study, not a gameplay attack or root move.
for ob,sgn in shells:
    ob.rotation_mode='XYZ'; neutral[ob.name]['rotation_mode']='XYZ'; e=neutral[ob.name]['rotation_euler']
    animate(ob,'brood_open',[(1,e),(31,Vector((e.x,e.y-sgn*.30,e.z))),(51,Vector((e.x,e.y-sgn*.30,e.z))),(81,e)],'rotation_euler')
for ob,sgn,row in EGGS:
    e=neutral[ob.name]['rotation_euler']
    animate(ob,'brood_open',[(1,e),(31,Vector((e.x,e.y+sgn*.105,e.z))),(51,Vector((e.x,e.y+sgn*.105,e.z))),(81,e)],'rotation_euler')

restore(); bpy.context.scene.frame_set(0); bpy.context.view_layer.update()
for ob,rec in records:
    rec['parent']=ob.parent.name if ob.parent else None
    rec['local_matrix_blender_z_up']=matarr(ob.matrix_local)
    rec['world_matrix_gltf_y_up']=matarr(CI@ob.matrix_world@C)
    rec['source_local_to_final_world_gltf']=matarr(CI@ob.matrix_world@C@Matrix(rec['mesh_normalization_from_source_local_gltf']))

scene=bpy.context.scene; scene.render.fps=30; scene.frame_start=0; scene.frame_end=80
scene.world.color=(.13,.13,.13)
scene.unit_settings.system='METRIC'; scene.unit_settings.scale_length=1

# Export only the authored creature, with self-contained PBR materials and NLA.
bpy.ops.object.select_all(action='DESELECT')
for ob in parts+pivots: ob.select_set(True)
bpy.context.view_layer.objects.active=ROOT
for ob in pivots:
    if ob.animation_data:
        for tr in ob.animation_data.nla_tracks: tr.mute=False
export_kwargs=dict(filepath=str(HERE/'brood-loom.glb'),export_format='GLB',use_selection=True,
                   export_yup=True,export_animations=True,export_extras=True,
                   export_animation_mode='NLA_TRACKS',export_frame_range=False,
                   export_force_sampling=True,export_nla_strips=True)
bpy.ops.export_scene.gltf(**export_kwargs)
for ob in pivots:
    if ob.animation_data:
        for tr in ob.animation_data.nla_tracks: tr.mute=True
restore(); scene.frame_set(0); bpy.context.view_layer.update()

recipe={
    'title':'Brood Loom — widow-inspired Warden boss kitbash visual spike',
    'status':'Visual prototype; no combat integration or collision/rig contract implied',
    'coordinate_system':'GLB uses metres, Y up, +Z forward; build script uses Blender conversion explicitly',
    'source_provenance':[{'file':'models/assets/'+v['filename'],'sha256':v['sha256'],'license_claim':'No additional public licence asserted; repository donor provenance only'} for v in donors.values()],
    'design':'Eight splayed legs, high split abdomen, six suspended pale ceramic brood capsules, small six-eyed head. Every exported mesh comes from donor geometry, with partial shell extraction on two meshes.',
    'dimensions_m':{'width':round(hi.x-lo.x,6),'height':round(hi.z-lo.z,6),'depth':round(hi.y-lo.y,6)},
    'bounds_gltf_m':{'min':arr((lo.x,lo.z,-hi.y)),'max':arr((hi.x,hi.z,-lo.y))},
    'normalization':{'uniform_scale':factor,'ground_offset_blender_z':ROOT.location.z,'target_height_m':12},
    'triangles':sum(len(ob.data.polygons) for ob in parts),
    'mesh_objects':len(parts),'named_rigid_pivots':len(pivots),
    'triangle_contribution_by_donor':{filename:sum(r['triangle_count'] for _,r in records if r['source_file']==filename) for filename in SOURCES.values()},
    'animations':[{'name':'idle','duration_seconds':2,'description':'Abdomen breathing, head scanning and subtle capsule sway; fixed leg stance.'},{'name':'brood_open','duration_seconds':80/30,'description':'Split upper carapace opens; suspended capsules spread slightly and return.'}],
    'authored_geometry':'No creature primitives generated. Render floor and light/camera objects are excluded from GLB.',
    'limitations':['Rigid object articulation, no skeleton or skinning.','Visual clips only; no combat behavior, hitboxes, collision mesh, LOD, or attachment contract.','No texture baking; donor geometry receives new flat PBR materials.','Cut carapace borders are open single surfaces over a closed inner sac.'],
    'parts':[r for o,r in records],
    'hierarchy':[{'name':o.name,'parent':o.parent.name if o.parent else None,'local_matrix_blender_z_up':matarr(o.matrix_local)} for o in pivots],
}
(HERE/'recipe.json').write_text(json.dumps(recipe,indent=2)+'\n')

# Neutral studio render; these display objects are created after the export.
STUDIO=bpy.data.collections.new('STUDIO | excluded from GLB'); scene.collection.children.link(STUDIO)
def studio_object(ob):
    for co in list(ob.users_collection):co.objects.unlink(ob)
    STUDIO.objects.link(ob)
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.025)); floor=bpy.context.object; floor.name='Studio_Floor'; studio_object(floor)
floor.data.materials.append(material('Studio | neutral grey',(.205,.225,.23),0,.82))
def light(name,loc,power,size,color):
    data=bpy.data.lights.new(name,'AREA'); data.energy=power; data.shape='DISK'; data.size=size; data.color=color
    ob=bpy.data.objects.new(name,data); STUDIO.objects.link(ob); ob.location=loc
    ob.rotation_euler=(Vector((0,0,5.7))-ob.location).to_track_quat('-Z','Y').to_euler()
light('Large warm key',(-11,-16,25),5200,13,(1,.88,.73))
light('Cool broad fill',(15,-3,17),3500,11,(.68,.82,1))
light('Rear silhouette',(0,16,22),7000,10,(.80,1,1))
camdata=bpy.data.cameras.new('Review camera'); cam=bpy.data.objects.new('Review camera',camdata); STUDIO.objects.link(cam)
cam.location=(23,-30,20.5); target=Vector((0,.0,5.6)); cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler()
camdata.type='ORTHO'; camdata.ortho_scale=29.0; camdata.lens=50; scene.camera=cam
scene.render.engine='CYCLES'; scene.cycles.samples=64; scene.cycles.use_denoising=False
scene.render.resolution_x=1600; scene.render.resolution_y=1200; scene.render.resolution_percentage=100
scene.view_settings.view_transform='AgX'; scene.view_settings.look='AgX - Medium High Contrast'
scene.render.image_settings.file_format='PNG'; scene.render.filepath=str(HERE/'brood-loom-neutral.png')
bpy.ops.wm.save_as_mainfile(filepath=str(HERE/'brood-loom-authoring.blend'))
if '--no-render' not in sys.argv:
    if '--open-only' not in sys.argv:
        bpy.ops.render.render(write_still=True)
    for ob in pivots:
        if ob.animation_data:
            for tr in ob.animation_data.nla_tracks: tr.mute=tr.name!='brood_open'
    scene.frame_set(40); bpy.context.view_layer.update()
    scene.render.filepath=str(HERE/'brood-loom-open.png')
    bpy.ops.render.render(write_still=True)
    for ob in pivots:
        if ob.animation_data:
            for tr in ob.animation_data.nla_tracks: tr.mute=True
    restore(); scene.frame_set(0)
    scene.render.filepath=str(HERE/'brood-loom-neutral.png')
    bpy.ops.wm.save_as_mainfile(filepath=str(HERE/'brood-loom-authoring.blend'))
print('BROOD_LOOM_REPORT '+json.dumps({k:recipe[k] for k in ('dimensions_m','triangles','mesh_objects','named_rigid_pivots','animations')}))
