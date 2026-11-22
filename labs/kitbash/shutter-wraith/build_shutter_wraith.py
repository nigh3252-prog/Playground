"""Rebuild the approved Shutter Wraith visual spike from actual Playground meshes.

Run from any directory: blender -b -t 4 -P build_shutter_wraith.py
Only this script's directory is written. Source assets are read from models/assets.
Authoring coordinates are Blender Z-up, facing -Y; the exported GLB is Y-up/+Z.
"""
from pathlib import Path
import bpy, bmesh, json, math, struct, hashlib, sys
from mathutils import Matrix, Vector, Euler

OUT=Path(__file__).resolve().parent
ROOT=OUT.parents[2]
ASSETS=ROOT/'models'/'assets'
SRC=OUT/'_sources';SRC.mkdir(exist_ok=True)
FPS=30
bpy.context.preferences.filepaths.save_version=0
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
for a in list(bpy.data.actions):bpy.data.actions.remove(a)

def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def matrix_list(m):return [[round(v,9) for v in row] for row in m]
def bounds(mesh):
    ps=[v.co for v in mesh.vertices]
    lo=Vector(tuple(min(v[i] for v in ps) for i in range(3)))
    hi=Vector(tuple(max(v[i] for v in ps) for i in range(3)))
    return lo,hi
def triangles(mesh):return sum(len(f.vertices)-2 for f in mesh.polygons)

source_files=['stone-wanderer-hooded-reliquary-v1.glb','stone-wanderer-twin-candle-mask-v1.glb','flying-void-reaper-v1.glb','flying-lantern-medusa-v1.glb','warden-linkage-module-v1.glb']
templates={};sources=[]
for name in source_files:
    p=ASSETS/name
    parts=[]
    if not p.exists():
        parts=sorted(ASSETS.glob(name+'.part*'));p=SRC/name
        p.write_bytes(b''.join(f.read_bytes() for f in parts))
    data=p.read_bytes();ln=struct.unpack_from('<I',data,12)[0];g=json.loads(data[20:20+ln])
    node_by_name={n.get('name'): (i,n) for i,n in enumerate(g['nodes']) if 'mesh' in n}
    before=set(bpy.data.objects);bpy.ops.import_scene.gltf(filepath=str(p));bpy.context.view_layer.update()
    added=set(bpy.data.objects)-before
    deps=bpy.context.evaluated_depsgraph_get()
    for obj in added:
        if obj.type!='MESH' or obj.name not in node_by_name:continue
        idx,node=node_by_name[obj.name]
        mesh=bpy.data.meshes.new_from_object(obj.evaluated_get(deps),preserve_all_data_layers=True,depsgraph=deps)
        mesh.transform(obj.matrix_world)
        templates[(name,obj.name)]={'mesh':mesh,'node_index':idx,'mesh_index':node['mesh'],'source_world_matrix_blender':matrix_list(obj.matrix_world)}
    for obj in added:bpy.data.objects.remove(obj,do_unlink=True)
    sources.append({'path':'models/assets/'+name,'sha256':sha(p),'bytes':len(data),'parts':[{'path':'models/assets/'+f.name,'sha256':sha(f)} for f in parts]})

def material(name,color,metal=.25,rough=.62,emission=0):
    m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1)
    p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=rough
    p.inputs['Emission Color'].default_value=(*color,1);p.inputs['Emission Strength'].default_value=emission
    return m
dark=material('Wraith · graphite metal',(.024,.036,.052),.62,.49)
slate=material('Wraith · worn blue slate',(.11,.18,.22),.48,.63)
ivory=material('Wraith · pale ceramic',(.48,.48,.39),.25,.68)
bronze=material('Wraith · tarnished bronze',(.30,.19,.065),.72,.48)
cyan=material('Wraith · cold cyan core',(.015,.57,.70),.25,.26,2.5)
amber=material('Wraith · amber lens',(.95,.26,.022),.25,.3,2.8)
black=material('Wraith · hood shadow',(.005,.008,.014),.05,.92)

created=[];pieces=[];groups={}
def group(name,parent=None,at=(0,0,0)):
    o=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(o);o.empty_display_type='PLAIN_AXES'
    o.location=at;o.parent=parent;created.append(o);groups[name]=o;return o
root=group('Shutter_Wraith_ROOT')
body=group('Wraith_Suspended_Frame',root)

def piece(name,donor,node,at,size,rotation=(0,0,0),parent=body,mat=None,hood_cut=False,solidify=0):
    t=templates[(donor,node)];mesh=t['mesh'].copy();lo,hi=bounds(mesh)
    removed=[]
    if hood_cut:
        bm=bmesh.new();bm.from_mesh(mesh);bm.faces.ensure_lookup_table()
        dead=[f for f in bm.faces if f.normal.z<-.5 or f.normal.y<-.43]
        removed=[f.index for f in dead]
        bmesh.ops.delete(bm,geom=dead,context='FACES');bm.to_mesh(mesh);bm.free();mesh.update()
    # Use original complete donor bounds as the normalized reference, including
    # the removed hood faces: that keeps its apex and skirt proportions exact.
    s=Vector(tuple(size[i]/max(hi[i]-lo[i],1e-8) for i in range(3)))
    rot=Euler(tuple(math.radians(v) for v in rotation),'XYZ').to_matrix().to_4x4()
    affine=rot@Matrix.Diagonal((*s,1))@Matrix.Translation(-(lo+hi)/2)
    mesh.transform(affine)
    o=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(o);o.location=at;o.parent=parent
    if mat:mesh.materials.clear();mesh.materials.append(mat)
    if solidify:
        bpy.context.view_layer.objects.active=o;o.select_set(True)
        mod=o.modifiers.new('Donor shell thickness','SOLIDIFY');mod.thickness=solidify;mod.offset=0
        bpy.ops.object.modifier_apply(modifier=mod.name);o.select_set(False)
    for p in mesh.polygons:p.use_smooth=False
    created.append(o)
    pieces.append({'name':name,'source':'models/assets/'+donor,'source_node_name':node,'source_node_index':t['node_index'],'source_mesh_index':t['mesh_index'],'source_world_matrix_blender':t['source_world_matrix_blender'],'mesh_affine_from_baked_source_blender':matrix_list(affine),'parent':parent.name if parent else None,'translation_blender':list(at),'target_dimensions_blender_before_rotation':list(size),'rotation_degrees_baked_xyz':list(rotation),'removed_source_face_indices':removed,'solidify_m':solidify,'material_override':mat.name if mat else None,'triangles':triangles(o.data)})
    o['donor_path']='models/assets/'+donor;o['donor_node_index']=t['node_index'];o['donor_node_name']=node
    return o

H='stone-wanderer-hooded-reliquary-v1.glb';T='stone-wanderer-twin-candle-mask-v1.glb'
R='flying-void-reaper-v1.glb';M='flying-lantern-medusa-v1.glb';W='warden-linkage-module-v1.glb'

# A cut-open, deep cowl. Nothing fills the torso between its ceramic shutters.
hood=group('Deep_Hood',body,at=(0,.25,9.35))
piece('Cowl · cut donor hood',H,'Part_0',(0,0,0),(4.35,3.3,4.1),parent=hood,hood_cut=True,solidify=.065)
piece('Cowl · dark inside',H,'Part_0',(0,.035,-.025),(4.12,3.1,3.96),parent=hood,mat=black,hood_cut=True)
piece('Mask · suspended reliquary face',H,'Part_1',(0,-.91,-.15),(1.22,.54,1.6),parent=hood,mat=ivory)
piece('Mask · left amber optic',H,'Part_2',(-.29,-1.2,-.13),(.28,.12,.12),parent=hood,mat=amber)
piece('Mask · right amber optic',H,'Part_3',(.29,-1.2,-.13),(.28,.12,.12),parent=hood,mat=amber)
piece('Mask · narrow silent mouth',T,'Part_7',(0,-1.205,-.55),(.085,.08,.37),parent=hood,mat=black)
piece('Cowl · split bronze crest',R,'skeletal_spear_head',(0,.1,2.02),(.40,.50,1.1),rotation=(80,0,0),parent=hood,mat=bronze)
for side in [-1,1]:
    piece('Cowl · inner rim '+str(side),R,'skeletal_spear_head',(side*1.34,-.92,-.12),(.14,.19,3.1),rotation=(0,side*24,0),parent=hood,mat=bronze)

# Actual Warden linkage topology supplies rails and four armored mechanical shutters.
for side in [-1,1]:
    piece('Frame · painted linkage '+str(side),W,'Deployment_Mechanism',(side*1.18,.55,6.35),(.78,1.0,3.7),rotation=(0,0,side*8))
    piece('Shoulder · angular flange '+str(side),R,'wing_crescent_blade',(side*2.18,.04,7.93),(2.5,.88,.85),rotation=(0,side*15,side*5),mat=slate)

core=group('Exposed_Cyan_Heart',body,at=(0,.1,6.25))
piece('Core · vertical luminous seed',M,'core',(0,-.1,0),(.65,.58,3.45),parent=core,mat=cyan)
piece('Core · bronze containment hoop',R,'core_corona',(0,.18,.1),(2.34,.18,3.6),parent=core,mat=bronze)
piece('Core · lower amber lens',R,'void_core',(0,-.1,-1.64),(.44,.40,.34),parent=core,mat=amber)
for side in [-1,1]:
    piece('Core · hanging conductor '+str(side),M,'tendril',(side*.47,.36,-.45),(.3,.35,3.35),rotation=(0,side*12,0),parent=core,mat=dark)

shutters=[]
for side in [-1,1]:
    for row,height in enumerate([7.13,5.52]):
        pivot=group(f'Shutter_{"L" if side<0 else "R"}_{row+1}',body,(side*1.85,-.14,height))
        shutters.append((pivot,side,row))
        # The donor's full world pose is baked first; original bones are excluded.
        piece(f'Shutter · painted module {side} {row}',W,'Weapon_Assembly',(-side*.73,-.29,0),(1.58,.57,1.40),rotation=(0,side*6,side*-2),parent=pivot)
        piece(f'Shutter · amber index {side} {row}',H,'Part_4',(-side*1.39,-.61,.18),(.075,.045,.56),parent=pivot,mat=amber)

# Long, irregular scythes and a broken hanging hem replace the donor's flying wings.
arms=[]
for side in [-1,1]:
    suffix='' if side<0 else '_02'
    arm=group('Blade_Arm_'+('L' if side<0 else 'R'),body,(side*2.15,.13,7.6));arms.append((arm,side))
    piece('Blade arm · shoulder sweep '+str(side),R,'scythe_wing'+suffix,(side*.75,0,-1.16),(1.82,.7,2.9),rotation=(0,side*15,side*9),parent=arm,mat=slate)
    piece('Blade arm · hooked forearm '+str(side),R,'lower_scythe'+suffix,(side*1.43,-.34,-3.0),(1.35,1.02,2.28),rotation=(0,-side*12,0),parent=arm,mat=dark)
    piece('Blade arm · polished cutting face '+str(side),R,'wing_crescent_blade'+suffix,(side*1.54,-.51,-3.72),(1.40,.22,1.28),rotation=(0,side*17,side*15),parent=arm,mat=ivory)
    piece('Blade arm · cyan edge '+str(side),R,'wing_energy_edge'+suffix,(side*.79,-.42,-1.04),(1.75,.10,2.8),rotation=(0,side*15,side*9),parent=arm,mat=cyan)

skirts=[]
for side in [-1,1]:
    skirt=group('Torn_Mantle_'+('L' if side<0 else 'R'),body,(side*.96,.65,4.65));skirts.append((skirt,side))
    piece('Mantle · long broken blade '+str(side),R,'scythe_wing' if side<0 else 'scythe_wing_02',(side*.36,0,-1.25),(1.9,.48,3.25),rotation=(0,-side*11,side*4),parent=skirt,mat=slate)
    piece('Mantle · outer fragment '+str(side),R,'lower_scythe' if side<0 else 'lower_scythe_02',(side*1.07,.18,-1.64),(.92,.62,1.8),rotation=(0,side*16,0),parent=skirt,mat=dark)
tail=group('Trailing_Spiral',body,(0,.7,4.3))
piece('Trailing spiral · donor cable',R,'spiral_tail',(0,0,-1.89),(.97,.8,3.78),parent=tail,mat=dark)
piece('Trailing spiral · bronze point',R,'tail_arrow',(.08,0,-3.74),(.35,.3,.78),parent=tail,mat=bronze)

# Three distinct, independently animated sentry shells: bell, crescent, and hood.
sentries=[]
sentryA=group('Sentry_01_Bell',root,(-4.45,-.4,8.25));sentries.append(sentryA)
piece('Sentry 01 · bell shell',M,'bell',(0,0,.08),(1.95,1.7,1.05),parent=sentryA,mat=slate)
piece('Sentry 01 · cyan eye',M,'core',(0,-.38,-.34),(.51,.48,.6),parent=sentryA,mat=cyan)
for k,(x,y) in enumerate([(-.63,-.25),(.63,-.25),(0,.5)]):
    piece('Sentry 01 · jaw '+str(k),M,'beak_mandible'+('' if k==0 else '_0'+str(k+1)),(x,y,-.55),(.52,.38,.96),rotation=(0,(k-1)*23,0),parent=sentryA,mat=bronze)
piece('Sentry 01 · crown',T,'Part_1',(0,.05,.75),(.24,.3,.68),parent=sentryA,mat=ivory)

sentryB=group('Sentry_02_Crescent',root,(4.65,.15,6.55));sentries.append(sentryB)
piece('Sentry 02 · armored crescent',R,'orbital_blade',(0,.08,0),(2.20,.72,1.54),rotation=(0,0,0),parent=sentryB,mat=ivory)
piece('Sentry 02 · amber eye',R,'void_core',(0,-.29,0),(.62,.56,.62),parent=sentryB,mat=amber)
for side in [-1,1]:
    piece('Sentry 02 · floating fang '+str(side),R,'wing_crescent_blade' if side<0 else 'wing_crescent_blade_02',(side*.81,-.1,-.72),(.52,.3,1.1),rotation=(0,side*24,0),parent=sentryB,mat=slate)

sentryC=group('Sentry_03_Hood',root,(-3.32,.65,3.05));sentries.append(sentryC)
piece('Sentry 03 · miniature open cowl',H,'Part_0',(0,0,.3),(1.45,1.3,1.8),parent=sentryC,hood_cut=True,solidify=.05)
piece('Sentry 03 · cyan lens',M,'core',(0,-.3,.17),(.42,.4,.42),parent=sentryC,mat=cyan)
for k,side in enumerate([-1,1]):
    piece('Sentry 03 · hanging fragment '+str(side),M,'tendril' if k==0 else 'tendril_04',(side*.35,.12,-.75),(.35,.32,1.4),rotation=(0,side*22,0),parent=sentryC,mat=bronze)

# Neutral bounds are computed from every exported vertex, with no stage objects.
bpy.context.view_layer.update()
mesh_objects=[o for o in created if o.type=='MESH']
points=[o.matrix_world@v.co for o in mesh_objects for v in o.data.vertices]
lo=Vector(tuple(min(v[i] for v in points) for i in range(3)));hi=Vector(tuple(max(v[i] for v in points) for i in range(3)))
normalization=12/(hi.z-lo.z);root.scale=(normalization,)*3;root.location.z=-lo.z*normalization
bpy.context.view_layer.update()
points=[o.matrix_world@v.co for o in mesh_objects for v in o.data.vertices]
low=Vector(tuple(min(v[i] for v in points) for i in range(3)));high=Vector(tuple(max(v[i] for v in points) for i in range(3)))
assert abs(high.z-low.z-12)<1e-5
rest={o:(o.location.copy(),o.rotation_euler.copy(),o.scale.copy()) for o in created}

def reset():
    for o,(p,r,s) in rest.items():o.location=p;o.rotation_euler=r;o.scale=s

def animate(clip,duration,pose):
    reset();n=round(duration*FPS);animated=[body,hood,core,tail]+[o for o,_,_ in shutters]+[o for o,_ in arms]+[o for o,_ in skirts]+sentries
    for o in animated:
        o.animation_data_create();o.animation_data.action=bpy.data.actions.new(clip+' · '+o.name)
    for f in range(n+1):
        t=f/FPS;reset();pose(t,duration)
        for o in animated:
            o.keyframe_insert(data_path='location',frame=f+1,group='Transform')
            o.keyframe_insert(data_path='rotation_euler',frame=f+1,group='Transform')
            o.keyframe_insert(data_path='scale',frame=f+1,group='Transform')
    for o in animated:
        a=o.animation_data.action
        for fc in a.fcurves:
            for k in fc.keyframe_points:k.interpolation='LINEAR'
        track=o.animation_data.nla_tracks.new();track.name=clip;strip=track.strips.new(a.name,1,a);strip.name=clip
        strip.blend_type='REPLACE';track.mute=True;o.animation_data.action=None
    reset()

def idle(t,d):
    p=math.tau*t/d
    body.location.z+=.13*(1-math.cos(p));body.rotation_euler.y=.018*math.sin(p)
    hood.rotation_euler.z=.04*math.sin(p+.2);tail.rotation_euler.y=.055*math.sin(p-.7)
    core.scale*=1+.035*math.sin(2*p)
    for o,side,row in shutters:o.rotation_euler.z=side*.035*math.sin(p+.5*row)
    for o,side in arms:o.rotation_euler.y=side*.045*math.sin(p-.3)
    for o,side in skirts:o.rotation_euler.y=side*.05*math.sin(p-.7)
    for i,o in enumerate(sentries):
        q=p+i*math.tau/3;o.location.x+=.22*math.sin(q);o.location.z+=.25*math.sin(q+.4);o.location.y+=.2*math.cos(q);o.rotation_euler.z=.1*math.sin(q)

def pulse(t,start,end):
    if t<=start or t>=end:return 0
    return math.sin(math.pi*(t-start)/(end-start))**2

def attack(t,d):
    prep=pulse(t,.05,.95);fire=pulse(t,.6,2.35)
    body.location.z+=.18*prep;body.rotation_euler.x=-.12*fire;body.location.y-=.22*fire
    for o,side,row in shutters:
        o.rotation_euler.z=side*(.28*prep+.18*fire);o.location.x+=side*.24*prep
    for o,side in arms:o.rotation_euler.y=-side*(.18*prep+.4*fire);o.rotation_euler.x=-.16*fire
    hood.rotation_euler.x=.13*fire;core.scale*=1+.12*fire
    for i,o in enumerate(sentries):
        lunge=pulse(t,.67+i*.34,1.25+i*.34)
        o.location.y-=1.2*lunge;o.location.z+=.22*prep;o.rotation_euler.x=.2*lunge

def expose(t,d):
    opening=min(1,t/.8, max(0,(d-t)/.8));opening=opening*opening*(3-2*opening)
    body.location.z+=.18*opening;hood.rotation_euler.x=-.09*opening
    for o,side,row in shutters:
        o.rotation_euler.z=side*math.radians(68)*opening;o.location.x+=side*.6*opening
    for o,side in arms:o.rotation_euler.y=side*.22*opening;o.location.y+=.4*opening
    for o,side in skirts:o.rotation_euler.y=side*.18*opening
    core.location.y-=.22*opening;core.scale*=1+.14*opening
    for i,o in enumerate(sentries):
        o.location.x+=(1 if o.location.x>0 else -1)*.5*opening;o.location.z+=.3*opening

animate('idle',6,idle);animate('attack',3,attack);animate('expose',4,expose)
reset();bpy.context.scene.frame_set(1)

# Native glTF clips are merged by equal NLA track names across the moving nodes.
bpy.ops.object.select_all(action='DESELECT')
for o in created:o.select_set(True)
bpy.context.view_layer.objects.active=root
props=bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
options=dict(filepath=str(OUT/'shutter-wraith.glb'),export_format='GLB',use_selection=True,export_yup=True,export_animations=True,export_extras=True,export_lights=False,export_cameras=False,export_skins=False,export_apply=False)
if 'export_animation_mode' in props:options['export_animation_mode']='NLA_TRACKS'
if 'export_nla_strips' in props:options['export_nla_strips']=True
if 'export_force_sampling' in props:options['export_force_sampling']=True
if 'export_frame_range' in props:options['export_frame_range']=False
if 'export_anim_slide_to_zero' in props:options['export_anim_slide_to_zero']=True
bpy.context.scene.render.fps=FPS
bpy.ops.export_scene.gltf(**options)
export_bytes=(OUT/'shutter-wraith.glb').read_bytes()
export_json_length=struct.unpack_from('<I',export_bytes,12)[0]
export_json=json.loads(export_bytes[20:20+export_json_length])
export_nodes={n.get('name'):i for i,n in enumerate(export_json['nodes'])}
for p in pieces:p['export_node_index']=export_nodes[p['name']]

recipe={'format':'playground-kitbash-recipe','version':1,'name':'Shutter Wraith','status':'approved visual spike; gameplay integration not included','coordinate_system':'GLB: meters, +Y up, +Z forward. Build coordinates: Blender +Z up, -Y forward.','height_m':12,'ground_baseline_m':0,'hover_note':'Neutral exported vertex bounds are Y=0..12m. The lowest trailing tip defines Y=0; the main body and all three sentries are suspended above it. Display stage is 0.45m below this datum.','native_clips':[{'name':'idle','seconds':6,'loop':True},{'name':'attack','seconds':3,'loop':False},{'name':'expose','seconds':4,'loop':False}],'source_files':sources,'normalization':{'uniform_scale':normalization,'translation_blender':list(root.location),'pre_normalization_bounds_blender':{'min':list(lo),'max':list(hi)}},'bounds_m_y_up':{'min':[low.x,low.z,-high.y],'max':[high.x,high.z,-low.y]},'triangles':sum(triangles(o.data) for o in mesh_objects),'mesh_count':len(mesh_objects),'pieces':pieces,'groups':{o.name:{'parent':o.parent.name if o.parent else None,'rest_translation_blender':list(rest[o][0]),'rest_rotation_euler_xyz':list(rest[o][1]),'rest_scale':list(rest[o][2])} for o in created if o.type=='EMPTY'},'design':'Open, cut donor cowl; separate painted Warden shutter panels around a visible suspended cyan heart; reaper blades recast as limbs and a torn mantle; distinct bell, crescent, and hood sentries.','verification':{'neutral_height_exact':abs(high.z-low.z-12)<1e-5}}
(OUT/'recipe.json').write_text(json.dumps(recipe,indent=2))

# A neutral studio render, with the real mesh, authored materials and no compositing.
stage_mat=material('STAGE · neutral charcoal',(.075,.09,.105),0,.92)
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.45));stage=bpy.context.object;stage.name='STAGE';stage.data.materials.append(stage_mat)
def aim(o,p):o.rotation_euler=(Vector(p)-o.location).to_track_quat('-Z','Y').to_euler()
center=(low+high)/2
bpy.ops.object.camera_add(location=(17,-29,15));camera=bpy.context.object;camera.name='CAMERA';camera.data.type='ORTHO';camera.data.ortho_scale=17.3;aim(camera,(0,0,6.0));bpy.context.scene.camera=camera
for name,energy,pos,diam,color in [('Key',2700,(6,-12,18),9,(1,.87,.69)),('Fill',1800,(-10,-5,10),10,(.62,.8,1)),('Rim',3600,(5,8,15),8,(.45,.8,1))]:
    bpy.ops.object.light_add(type='AREA',location=pos);l=bpy.context.object;l.name=name;l.data.energy=energy;l.data.shape='DISK';l.data.size=diam;l.data.color=color;aim(l,(0,0,6))
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=48;scene.cycles.use_denoising=False
scene.world.use_nodes=True;scene.world.node_tree.nodes.get('Background').inputs['Color'].default_value=(.16,.19,.24,1);scene.world.node_tree.nodes.get('Background').inputs['Strength'].default_value=.28
scene.render.resolution_x=1440;scene.render.resolution_y=1440;scene.render.resolution_percentage=100
scene.view_settings.view_transform='AgX';scene.view_settings.look='AgX - Medium High Contrast';scene.view_settings.exposure=0
scene.render.image_settings.file_format='PNG';scene.render.filepath=str(OUT/'shutter-wraith-neutral.png')
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'shutter-wraith.blend'))
if '--no-render' not in sys.argv:
    bpy.ops.render.render(write_still=True)
    # An exposed-state frame makes the moving shutters and empty torso reviewable.
    expose(2,4);bpy.context.view_layer.update();scene.render.filepath=str(OUT/'shutter-wraith-expose.png');bpy.ops.render.render(write_still=True)
reset();bpy.context.view_layer.update()
print('SHUTTER_WRAITH_RESULT '+json.dumps({'triangles':recipe['triangles'],'meshes':recipe['mesh_count'],'height_m':12,'clips':['idle','attack','expose'],'glb_bytes':(OUT/'shutter-wraith.glb').stat().st_size}))
