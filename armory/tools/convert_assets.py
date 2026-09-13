"""Run only through Blender with --disable-autoexec."""
import json
from pathlib import Path
import sys
import bpy

jobs = json.loads(Path(sys.argv[sys.argv.index("--") + 1]).read_text())
report = []
for job in jobs:
    source = Path(job["input"])
    print("CONVERT", job["id"], str(source), flush=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    if source.suffix.lower() == ".blend":
        bpy.ops.wm.open_mainfile(filepath=str(source), load_ui=False, use_scripts=False)
    elif source.suffix.lower() == ".fbx":
        bpy.ops.import_scene.fbx(filepath=str(source))
    elif source.suffix.lower() == ".obj":
        if hasattr(bpy.ops.wm, "obj_import"):
            try:
                bpy.ops.wm.obj_import(filepath=str(source))
            except AttributeError:
                bpy.ops.import_scene.obj(filepath=str(source))
        else:
            bpy.ops.import_scene.obj(filepath=str(source))
    else:
        raise ValueError(str(source))

    # Make legacy files portable. Do not execute embedded scripts or preserve lights/cameras.
    image_paths = {p.name.lower(): p for p in source.parent.rglob("*") if p.is_file() and p.suffix.lower() in (".png", ".jpg", ".jpeg", ".tga", ".bmp")}
    for image in bpy.data.images:
        if image.source != "FILE":
            continue
        if not image.packed_file:
            found = image_paths.get(Path(image.filepath.replace("\\", "/")).name.lower())
            if found:
                image.filepath = str(found)
                image.reload()
        if max(image.size[:], default=0) > 2048:
            ratio = 2048 / max(image.size[:])
            image.scale(max(1, int(image.size[0] * ratio)), max(1, int(image.size[1] * ratio)))
        if image.has_data:
            image.pack()
    for material in bpy.data.materials:
        if not material.use_nodes:
            base = tuple(material.diffuse_color)
            material.use_nodes = True
            shader = material.node_tree.nodes.get("Principled BSDF")
            if shader:
                shader.inputs["Base Color"].default_value = base
                shader.inputs["Roughness"].default_value = 0.65
    bpy.ops.object.select_all(action="DESELECT")
    objects = [o for o in bpy.context.scene.objects if o.type in ("MESH", "ARMATURE", "EMPTY")]
    meshes = [o for o in objects if o.type == "MESH"]
    if not meshes:
        raise ValueError("No mesh: " + job["id"])
    for obj in objects:
        obj.hide_set(False)
        obj.hide_viewport = False
        obj.hide_render = False
        obj.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.export_scene.gltf(filepath=job["output"], export_format="GLB", use_selection=True, export_animations=True, export_apply=True)
    report.append({"id": job["id"], "objects": [{"name": o.name, "type": o.type} for o in objects], "materials": [m.name for m in bpy.data.materials]})
Path("/tmp/armory-conversion-report.json").write_text(json.dumps(report, indent=2))
print("CONVERSION COMPLETE", len(report), flush=True)
