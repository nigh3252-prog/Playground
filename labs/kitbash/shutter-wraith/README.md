# Shutter Wraith

A visual kitbash spike of a floating armored reliquary. Four painted Warden shutter assemblies surround a suspended cyan heart; an opened stone hood hides a small amber-eyed mask. Reaper blades become hanging limbs and an irregular mantle. Three independent sentry shells use a bell, a crescent, and a miniature open hood.

## Files

- `shutter-wraith.glb` — Y-up, +Z forward, native meter geometry, exactly 12 m neutral height.
- `shutter-wraith.blend` — editable assembly, transform actions, and studio scene.
- `recipe.json` — exact donor file hashes, source node/mesh indices, geometry transforms, cuts, material overrides, and exported node indices.
- `build_shutter_wraith.py` — reproducible Blender build. Reads the unchanged donors in `models/assets`; joins multipart Warden data only inside this folder's temporary `_sources` directory.
- `shutter-wraith-neutral.png` and `shutter-wraith-expose.png` — rendered views of the actual model.
- `verify_export.py` and `verification.json` — exported GLB measurements and animation/source checks.

## Scale and baseline

The neutral exported geometry is 12 m high, approximately 11.63 m wide including the three sentries, and 3.31 m deep. The lowest trailing blade defines Y=0. The main body and sentries hang above it; the studio floor sits 0.45 m below that datum to show the hovering silhouette. Idle motion rises from the neutral baseline.

## Native clips

| Clip | Duration | Motion |
| --- | --- | --- |
| `idle` | 6 seconds, loop | Suspended body rise, slow hood and blade sway, breathing shutters, independent sentry drift. |
| `attack` | 3 seconds | Body and arms draw in, shutters separate, then the three sentries lunge in sequence. |
| `expose` | 4 seconds | All four shutters swing outward, arms fall back, and the core moves forward into the opening. |

Animations are rigid node transforms. Original Warden bones are excluded after evaluating and baking the selected source meshes. No combat behavior, hit volumes, or gameplay balancing is included in this visual spike.

## Rebuild

```sh
blender -b -t 4 -P labs/kitbash/shutter-wraith/build_shutter_wraith.py
python labs/kitbash/shutter-wraith/verify_export.py
```

For a geometry and animation rebuild that preserves the existing PNGs:

```sh
blender -b -t 4 -P labs/kitbash/shutter-wraith/build_shutter_wraith.py -- --no-render
```

The current export has 13,785 triangles and 54 mesh nodes. Donor geometry and painted materials remain subject to their existing project provenance; the recipe records all reused sources rather than assigning a new blanket license.
