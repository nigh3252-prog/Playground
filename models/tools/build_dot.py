"""Build Dot v1 using Blender 4.3+: blender -b -t 2 --python models/tools/build_dot.py."""
import math
from pathlib import Path

import bpy
from mathutils import Vector

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)

def paint(name, color, metal=0.0, rough=.45, emit=0.0):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    p = m.node_tree.nodes.get("Principled BSDF")
    p.inputs["Base Color"].default_value = (*color, 1)
    p.inputs["Metallic"].default_value = metal
    p.inputs["Roughness"].default_value = rough
    p.inputs["Emission Color"].default_value = (*color, 1)
    p.inputs["Emission Strength"].default_value = emit
    return m


ivory = paint("Shop enamel | warm porcelain", (.78,.77,.64), .20, .32)
gold = paint("Copper oxide orange", (.66,.23,.055), .45, .38)
dark = paint("Soft graphite", (.027,.039,.047), .20, .50)
steel = paint("Brushed utility hardware", (.33,.38,.38), .72, .30)
rubber = paint("Carbon rubber tread", (.016,.024,.025), .03, .78)
tint = paint("Iris deep water", (.016,.23,.24), .40, .26, .14)
eye = paint("Iris workshop teal", (.14,.92,.76), .05, .23, 1.20)

def group(name, p, parent=None):
    ob = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(ob)
    ob.parent = parent
    ob.location = p
    return ob


def mesh(name, mat, p, parent, bevel=0):
    ob = bpy.context.object
    ob.name = name
    ob.parent = parent
    ob.location = p
    ob.data.materials.append(mat)
    if bevel:
        b = ob.modifiers.new("Machined edges", "BEVEL")
        b.width, b.segments = bevel, 2
        normals = ob.modifiers.new("Face-weighted normals", "WEIGHTED_NORMAL")
        normals.keep_sharp = True
    return ob


def block(name,p,dims,mat,parent,bevel=.025):
    bpy.ops.mesh.primitive_cube_add()
    ob = bpy.context.object
    ob.dimensions = dims
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return mesh(name, mat, p, parent, bevel)


def drum(name,p,radius,depth,mat,parent,axis="z",sides=16,bevel=.006):
    bpy.ops.mesh.primitive_cylinder_add(vertices=sides,radius=radius,depth=depth)
    ob = mesh(name,mat,p,parent,bevel)
    if axis == "x":
        ob.rotation_euler.y = math.pi/2
    if axis == "y":
        ob.rotation_euler.x = math.pi/2
    return ob


def rod(name,a,b,r,mat,parent):
    delta = Vector(b) - Vector(a)
    ob = drum(name, (Vector(a)+Vector(b))/2, r, delta.length, mat, parent, sides=8)
    ob.rotation_mode = 'QUATERNION'
    ob.rotation_quaternion = delta.to_track_quat("Z","Y")
    return ob


root = group("Dot", (0,0,0))
track = group("Drive base", (0,0,0), root)
for sign, side in [(-1,"Left"),(1,"Right")]:
    x = sign*.25
    block(side+" drive casing", (x,.015,.14),(.21,.55,.24),dark,track,.06)
    for y in (-.182,.165):
        drum(side+" tread wheel", (x,y,.125),.125,.223,rubber,track,"x",16)
        drum(side+" outer hub", (x+sign*.118,y,.125),.081,.027,steel,track,"x")
        drum(side+" hub key", (x+sign*.136,y,.125),.028,.019,gold,track,"x",8)
    for i in range(6):
        for z in (.036,.224):
            block(side+" tread shoe", (x,-.195+i*.077,z),(.226,.036,.027),rubber,track,.008)
block("Lower skid plate",(0,0,.195),(.42,.58,.105),steel,track,.038)
block("Shin guard", (0,-.289,.199),(.26,.077,.082),gold,track,.018)
drum("Turntable bearing",(0,0,.255),.205,.045,dark,track)
body = group("Service pod", (0,0,.277), root)
block("Capsule lower deck",(0,.011,.093),(.525,.484,.175),gold,body,.045)
block("Upper porcelain shell",(0,.01,.262),(.567,.48,.32),ivory,body,.085)
block("Rear access plate",(0,.259,.257),(.334,.036,.156),dark,body,.021)
for i in range(5):
    block("Rear vent rib",(-.110+i*.055,.285,.259),(.022,.022,.085),steel,body,.008)
for s,label in [(-1,"L"),(1,"R")]:
    drum(label+" mounting pivot",(s*.269,.062,.192),.071,.036,dark,body,"x")
    drum(label+" brass cover",(s*.293,.062,.192),.045,.017,gold,body,"x",12)
    block(label+" service handle",(s*.212,.121,.397),(.086,.20,.043),dark,body,.016)
face = group("Optic gimbal",(0,-.218,.247),body)
drum("Charcoal optic housing",(0,-.017,0),.177,.105,dark,face,"y",20,.013)
drum("Machined brushed bezel",(0,-.071,0),.151,.034,steel,face,"y",20)
drum("Teal lens glass",(0,-.095,0),.122,.025,tint,face,"y",24)
iris = group("Luminous pupil",(0,-.113,0),face)
drum("Single lit pupil",(0,0,0),.064,.021,eye,iris,"y",20,.008)
rod("Aerial stem",(.169,.112,.389),(.207,.143,.559),.013,steel,body)
drum("Aerial cuff",(.169,.112,.404),.032,.037,dark,body)
bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1,radius=.033)
mesh("Aerial amber cap",gold,(.207,.143,.559),body)
block("Single copper seam",(-.166,-.187,.386),(.097,.042,.022),gold,body,.007)

scene=bpy.context.scene
scene.render.fps=24
scene.frame_start,scene.frame_end=1,73
for frame, swivel, pitch, squint in [
    (1,0,0,1),(16,-.11,.055,1),(32,.09,-.045,1),(46,.045,-.025,1),
    (49,.034,-.016,.20),(53,.026,-.01,1),(73,0,0,1),
]:
    face.rotation_euler=(pitch,0,swivel)
    iris.scale=(1,1,squint)
    face.keyframe_insert(data_path="rotation_euler",frame=frame)
    iris.keyframe_insert(data_path="scale",frame=frame)
for ob in (face, iris):
    action=ob.animation_data.action
    action.name=ob.name+" idle motion"
    track=ob.animation_data.nla_tracks.new()
    track.name="Idle"
    track.strips.new(action.name,1,action)
    ob.animation_data.action=None
scene.frame_set(1)
output=Path(__file__).resolve().parents[1]/"assets"/"dot-v1.glb"
output.parent.mkdir(exist_ok=True)
bpy.ops.export_scene.gltf(filepath=str(output),export_format="GLB",
    export_animations=True,export_animation_mode="NLA_TRACKS",export_yup=True,
    export_apply=True)
