"""Shared-scale studio lineup of the final three GLBs and the actual Warden.

Run inside the original repository:
  blender --background --python labs/kitbash/preview/render_lineup.py

All bosses are imported at their authored scale. Only the reference Warden is
uniformly normalized to 4m if its source dimensions differ. Floor, lighting,
camera and arrangement are review-only; this script never modifies the GLBs.
"""
import bpy, json, hashlib, subprocess, os, struct, sys
from pathlib import Path
from mathutils import Vector, Matrix, Quaternion

HERE=Path(__file__).resolve().parent
REPO=HERE.parents[2]
FILES=[
 ('Warden',REPO/'models/assets/warden-v1.glb',4.0),
 ('Bellows',HERE.parent/'bellows/bellows.glb',12.0),
 ('Brood Loom',HERE.parent/'brood-loom/brood-loom.glb',12.0),
 ('Shutter Wraith',HERE.parent/'shutter-wraith/shutter-wraith.glb',12.0),
]

bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
scene=bpy.context.scene;scene.render.fps=30;scene.frame_set(0)
scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1
for action in list(bpy.data.actions):bpy.data.actions.remove(action)

def bounds(obs):
 depsgraph=bpy.context.evaluated_depsgraph_get();pts=[]
 for ob in obs:
  # The glTF importer creates a hidden Icosphere as an armature custom-shape
  # helper for the Warden. It is not part of the visible reference geometry.
  if ob.type!='MESH' or ob.hide_render:continue
  evaluated=ob.evaluated_get(depsgraph);mesh=evaluated.to_mesh()
  pts.extend(evaluated.matrix_world@v.co for v in mesh.vertices)
  evaluated.to_mesh_clear()
 return (Vector(tuple(min(p[i] for p in pts)for i in range(3))),Vector(tuple(max(p[i] for p in pts)for i in range(3))))

def apply_rigid_gltf_rest(path,obs):
 """Discard Blender's cached import-action values in this review-only scene."""
 blob=path.read_bytes();n=struct.unpack_from('<I',blob,12)[0];doc=json.loads(blob[20:20+n])
 assert not doc.get('skins'),'Rigid boss review assumes no skins'
 conversion=Matrix(((1,0,0,0),(0,0,-1,0),(0,1,0,0),(0,0,0,1)))
 inverse=conversion.inverted();byname={o.name:o for o in obs}
 for ob in obs:ob.animation_data_clear()
 for node in doc['nodes']:
  name=node.get('name');ob=byname.get(name)
  assert ob is not None,('Unmatched GLB node during review import',name)
  if 'matrix'in node:
   a=node['matrix'];matrix=Matrix([[a[c*4+r]for c in range(4)]for r in range(4)])
  else:
   q=node.get('rotation',(0,0,0,1));matrix=(Matrix.Translation(Vector(node.get('translation',(0,0,0))))@
      Quaternion((q[3],q[0],q[1],q[2])).to_matrix().to_4x4()@
      Matrix.Diagonal(Vector(tuple(node.get('scale',(1,1,1)))+(1,))))
  ob.matrix_parent_inverse=Matrix.Identity(4);ob.matrix_basis=conversion@matrix@inverse
 bpy.context.view_layer.update()

groups=[];report={'title':'Warden boss kitbash prototypes at shared metre scale','models':[],'dimensions_px':[2600,1150]}
cursor=0
for title,source_path,height in FILES:
 path=source_path
 if title=='Warden':
  subprocess.run([os.environ.get('CODEX_PRIMARY_RUNTIME_NODE','node'),str(HERE/'decode_warden.mjs')],check=True)
  path=HERE/'warden-v1-decoded.glb'
 before=set(bpy.data.objects);bpy.ops.import_scene.gltf(filepath=str(path));obs=list(set(bpy.data.objects)-before)
 # Measure only meshes that actually exist as mesh nodes in the source GLB.
 # Blender's armature custom-shape Icosphere lives in a hidden collection, so
 # checking object.hide_render alone is insufficient to exclude that helper.
 blob=path.read_bytes();jsonlen=struct.unpack_from('<I',blob,12)[0];doc=json.loads(blob[20:20+jsonlen])
 source_mesh_names={n.get('name')for n in doc['nodes']if 'mesh'in n}
 removed_helpers=[]
 for ob in list(obs):
  if ob.type=='MESH' and ob.name not in source_mesh_names:
   removed_helpers.append(ob.name);obs.remove(ob);bpy.data.objects.remove(ob,do_unlink=True)
 for ob in obs:
  if ob.animation_data:
   ob.animation_data.action=None
   for tr in ob.animation_data.nla_tracks:
    tr.mute=not (title=='Warden' and tr.name=='Idle_Loop')
 if title!='Warden':apply_rigid_gltf_rest(path,obs)
 bpy.context.scene.frame_set(0);bpy.context.view_layer.update()
 lo,hi=bounds(obs);raw=[float(v)for v in hi-lo]
 roots=[ob for ob in obs if ob.parent not in obs]
 group=bpy.data.objects.new('Lineup | '+title,None);scene.collection.objects.link(group)
 for ob in roots:
  mw=ob.matrix_world.copy();ob.parent=group;ob.matrix_world=mw
 # Keep all boss exports at exact authored scale; assertions catch a bad export.
 if title=='Warden':
  factor=height/(hi.z-lo.z);group.scale=(factor,)*3
 else:
  assert abs(hi.z-lo.z-height)<.001,(title,lo,hi)
  factor=1.0
 bpy.context.view_layer.update();lo,hi=bounds(obs)
 # Place forward-facing models on one floor, side-by-side in requested order.
 width=hi.x-lo.x
 group.location=(cursor-lo.x,-(hi.y+lo.y)/2,-lo.z)
 bpy.context.view_layer.update();lo,hi=bounds(obs)
 report['models'].append({'name':title,'file':str(source_path.relative_to(REPO)),'sha256':hashlib.sha256(source_path.read_bytes()).hexdigest(),
   'excluded_importer_helper_meshes':removed_helpers,
   'pose':'Native Idle_Loop at time 0' if title=='Warden' else 'Exported default neutral pose',
   'raw_import_dimensions_blender_xyz_m':raw,'uniform_display_scale':factor,
   'display_dimensions_m':{'width':float(hi.x-lo.x),'height':float(hi.z-lo.z),'depth':float(hi.y-lo.y)},
   'lineup_bounds_blender_xyz_m':{'min':list(lo),'max':list(hi)}})
 for ob in obs:ob.name=title.replace(' ','_')+' | '+ob.name
 groups.append((title,obs,group));cursor=hi.x+3.25

# Centre the row and put every front-facing silhouette at the same camera angle.
left=min(bounds(obs)[0].x for _,obs,_ in groups);right=max(bounds(obs)[1].x for _,obs,_ in groups)
centre=(left+right)/2
for _,obs,group in groups:group.location.x-=centre
bpy.context.view_layer.update()

def material(name,color,roughness=1):
 m=bpy.data.materials.new(name);m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF')
 p.inputs['Base Color'].default_value=(*color,1);p.inputs['Roughness'].default_value=roughness
 return m

floor_mat=material('Lineup | warm neutral floor',(.25,.275,.275),.88)
bpy.ops.mesh.primitive_plane_add(size=300,location=(0,0,-.025));bpy.context.object.name='Lineup Studio Floor';bpy.context.object.data.materials.append(floor_mat)
world=bpy.data.worlds.new('Lineup | slate environment');scene.world=world;world.use_nodes=True
world.node_tree.nodes['Background'].inputs['Color'].default_value=(.14,.17,.19,1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value=.7

def light(name,position,power,size,color,target=(0,0,5)):
 data=bpy.data.lights.new(name,'AREA');data.energy=power;data.shape='DISK';data.size=size;data.color=color
 ob=bpy.data.objects.new(name,data);scene.collection.objects.link(ob);ob.location=position
 ob.rotation_euler=(Vector(target)-ob.location).to_track_quat('-Z','Y').to_euler()
# One broad key per two models keeps the large row legible and evenly exposed.
light('Left key',(-22,-23,31),14500,22,(1,.88,.74),(-20,0,6))
light('Right key',(22,-23,31),14500,22,(1,.88,.74),(20,0,6))
light('Broad cool fill',(0,-5,29),9000,32,(.64,.79,1),(0,0,5))
light('Broad rear rim',(0,18,29),24000,42,(.75,.92,1),(0,0,6))

camdata=bpy.data.cameras.new('Lineup Camera');cam=bpy.data.objects.new('Lineup Camera',camdata);scene.collection.objects.link(cam)
cam.location=(0,-100,39);target=Vector((0,0,5.0));cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler()
camdata.type='ORTHO';camdata.ortho_scale=(right-left)*1.075;scene.camera=cam
scene.render.engine='CYCLES';scene.cycles.samples=48;scene.cycles.use_denoising=False
scene.render.resolution_x=2600;scene.render.resolution_y=1150;scene.render.resolution_percentage=100
scene.view_settings.view_transform='AgX';scene.view_settings.look='AgX - Medium High Contrast'
scene.render.image_settings.file_format='PNG';scene.render.filepath=str(HERE/'warden-boss-lineup.png')
report['camera']={'orthographic_horizontal_span_m':camdata.ortho_scale,'position_blender_xyz_m':list(cam.location),'target_blender_xyz_m':list(target)}
# Projected centres help a later exact label overlay without baking text into 3D.
from bpy_extras.object_utils import world_to_camera_view
for model,(_,obs,group) in zip(report['models'],groups):
 lo,hi=bounds(obs);point=Vector(((lo.x+hi.x)/2,0,0));ndc=world_to_camera_view(scene,cam,point)
 model['label_anchor_px']=[round(ndc.x*2600),round((1-ndc.y)*1150)]
 model['lineup_bounds_blender_xyz_m']={'min':list(lo),'max':list(hi)}
(HERE/'lineup-layout.json').write_text(json.dumps(report,indent=2)+'\n')
if '--save-blend' in sys.argv:
 bpy.ops.wm.save_as_mainfile(filepath=str(HERE/'warden-boss-lineup.blend'))
bpy.ops.render.render(write_still=True)
print('LINEUP_RENDERED '+json.dumps(report))
