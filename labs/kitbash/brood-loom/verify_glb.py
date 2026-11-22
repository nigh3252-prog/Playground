"""Import the delivered GLB independently, verify scale, render its native peak.
Run after build_brood_loom.py with Blender --background --python this_file.
"""
import bpy,json
from pathlib import Path
from mathutils import Vector
HERE=Path(__file__).resolve().parent
bpy.ops.wm.open_mainfile(filepath=str(HERE/'brood-loom-authoring.blend'))
creature=bpy.data.collections.get('BROOD LOOM | exported creature')
for ob in list(creature.objects): bpy.data.objects.remove(ob,do_unlink=True)
bpy.data.collections.remove(creature)
before=set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=str(HERE/'brood-loom.glb'))
loaded=list(set(bpy.data.objects)-before)
meshes=[ob for ob in loaded if ob.type=='MESH']
for ob in loaded:
    if ob.animation_data:
        ob.animation_data.action=None
        for tr in ob.animation_data.nla_tracks:tr.mute=True
bpy.context.scene.frame_set(0);bpy.context.view_layer.update()
pts=[ob.matrix_world@v.co for ob in meshes for v in ob.data.vertices]
lo=Vector(tuple(min(p[i] for p in pts) for i in range(3)))
hi=Vector(tuple(max(p[i] for p in pts) for i in range(3)))
assert abs(hi.z-lo.z-12)<.0001,(lo,hi)
assert abs(lo.z)<.0001,(lo,hi)
report={'validation':'Independent Blender import of exported GLB',
        'neutral_dimensions_m':{'width':hi.x-lo.x,'height':hi.z-lo.z,'depth':hi.y-lo.y},
        'ground_min_blender_z_m':lo.z,'mesh_count':len(meshes),
        'triangles':sum(len(ob.data.polygons) for ob in meshes),
        'native_animation_tracks':{},'peak_frame':40,'fps':30}
for ob in loaded:
    if ob.animation_data:
        names=[]
        for tr in ob.animation_data.nla_tracks:
            names.append(tr.name);tr.mute=not tr.name.startswith('brood_open')
        report['native_animation_tracks'][ob.name]=names
bpy.context.scene.frame_set(40);bpy.context.view_layer.update()
bpy.context.scene.render.filepath=str(HERE/'brood-loom-open.png')
bpy.ops.render.render(write_still=True)
(HERE/'verification.json').write_text(json.dumps(report,indent=2)+'\n')
print('BROOD_IMPORTED_GLB_VERIFIED '+json.dumps(report))
