import bpy, pathlib, json
from mathutils import Vector
P=pathlib.Path(__file__).parent
bpy.ops.wm.open_mainfile(filepath=str(P/'bellows.blend'))
for o in bpy.data.objects:
 if o.animation_data:
  for tr in o.animation_data.nla_tracks:tr.mute=tr.name!='Charge_Jump_Demo'
rows=[]
for frame in [1,31,61,86,99,112,132,148,166,190]:
 bpy.context.scene.frame_set(frame);bpy.context.view_layer.update()
 def mm(sub):
  p=[o.matrix_world@v.co for o in bpy.data.objects if o.type=='MESH' and any(s in o.name for s in sub) for v in o.data.vertices]
  return [round(min(x.z for x in p),3),round(max(x.z for x in p),3)]
 rows.append({'frame':frame,'jaw_height':mm(['Lower_Maw','Lower_Tooth']),'foot_height':mm(['Front_Palm','Rear_Foot']),'whole_height':mm([''])})
print('MOTION_BOUNDS',json.dumps(rows))
worst=(1e9,None,None)
for frame in range(1,191):
 bpy.context.scene.frame_set(frame)
 bpy.context.view_layer.update()
 for o in bpy.data.objects:
  if o.type!='MESH':continue
  low=min((o.matrix_world@v.co).z for v in o.data.vertices)
  if low<worst[0]:worst=(low,frame,o.name)
print('DENSE_GROUND_MIN',worst)
(P/'motion_validation.json').write_text(json.dumps({'keyframe_bounds':rows,'dense_ground_min_m':worst[0],'dense_ground_min_frame':worst[1],'dense_ground_min_part':worst[2]},indent=2))
