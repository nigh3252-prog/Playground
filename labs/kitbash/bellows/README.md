# Bellows — 12 m kitbash study

A broad, squat mechanical amphibian with a ceramic hinged maw, heavy orange rear haunches, small front limbs, paired pressure vessels and a cyan throat. This is a visual spike, with no game integration.

## Asset

| Property | Value |
|---|---|
| Export | `bellows.glb`, self-contained glTF 2.0 |
| Neutral size | 19.8407 m wide × 12.0000 m tall × 14.0409 m deep |
| Warden comparison | Three times the specified 4 m Warden height |
| Coordinates | Metres; +Y up; facing +Z; grounded at Y = 0 |
| Triangles | 6,684 |
| Mesh parts | 93 |
| Materials | Unified oxide/orange, ivory ceramic, soot metal, bronze and cyan |
| Rig | Named rigid-part pivots |
| Animations | `Idle` — 4.0 s; `Charge_Jump_Demo` — 6.3 s |

The independent GLB validator measures height as 12.00000499 m, a five-micrometre transform/vertex rounding difference from the authored exact 12 m height. The file loads correctly in its static neutral pose, without needing an animation to establish its size or limb positions. Both clips begin at that same neutral pose.

## What was kitbashed

Every triangle in the exported character comes from an existing donor mesh. There are no newly generated primitive meshes in the character. Source meshes are selected, copied, affinely transformed, reparented and recolored into a new composition.

| Donor | Main reused parts and role |
|---|---|
| `shark-jaw-stalker-standalone-v1.glb` | Nodes 3/4 and 55/56 become the broad frontal upper/lower jaw arches; 47/49 become bearings and valve hardware; 74/93 supply teeth; 102/107/115/143 supply mechanical limb pieces. The shark's original long side-profile arch is reinterpreted across the new creature's face. |
| `shelf-buddies-pond-scum-v1.glb` | Nodes 18/25 supply the large rear haunches, shoulders and eye turrets; 32 becomes dorsal armor; 19 supplies forearm volume; 6 supplies planted pads. |
| `flying-furnace-beetle-v1.glb` | Nodes 1/2 supply the pressure belly and vessels; 3/4 become pressure ribs, ports and throat; 38/40 become mouth recess and internal ramp; 43/44/45 become eye components; 15 supplies claws. |

`recipe.json` records all 93 selections, original node and mesh IDs, parent pivots, the source-world-to-design 4×4 transform for each part, material substitutions, source SHA256 hashes, dimensions, clip names and limitations.

## Files

- `bellows.glb` — portable model and both animations.
- `bellows.blend` — editable Blender source scene.
- `bellows-neutral.png` — three-quarter neutral render.
- `bellows-front.png` — front neutral render for mouth/silhouette review.
- `bellows-charge.png` — peak mouth/pressure pose at frame 86.
- `build_bellows.py` — complete reproducible assembly/export/render script.
- `recipe.json` — complete part manifest and provenance.
- `donor_catalog_records.json` — exact donor catalog credits and license statements.
- `verify_bellows.py` and `validation.json` — independent exported-GLB validation and its results.
- `check_motion.py` and `motion_validation.json` — Blender motion/ground review and results.

## Rebuild

From the repository root, with Blender 4.3.2 or compatible:

```sh
blender -b -t 4 -P labs/kitbash/bellows/build_bellows.py
python labs/kitbash/bellows/verify_bellows.py
```

For geometry and animation export without studio renders:

```sh
blender -b -t 4 -P labs/kitbash/bellows/build_bellows.py -- --export-only
```

The script uses the donor GLBs in `models/assets/`. It exports only the character. The render floor, camera and lights are excluded from the GLB. The standalone validator uses Python and NumPy.

### Neutral transform preservation

Blender 4.3's NLA export reset some animated object's constant transforms to defaults. The build captures every model node's exact neutral local TRS before export, then restores these values in the GLB JSON after export. The binary geometry and animation sampler data remain untouched. This preserves the 12 m scale and hinge/pivot offsets even when no animation is playing. Independent validation checks static bounds, neutral clip starts, actual moving channels, and ground clearance at every 30 fps frame in both clips.

## Motion and scope

`Idle` breathes through the body, jaw and pressure vessels. `Charge_Jump_Demo` opens the maw, inflates the body, compresses before a short hop, and returns through a weighted landing. The forelimbs and hind limbs remain planted during the mouth charge and fold during the hop. The highest point during the jump is approximately 15.452 m above the ground; the requested 12 m refers to neutral/rest geometry.

This is rigid-part preview motion. It has no skinning, foot IK, collision, production root-motion contract, gameplay, particle effects or damage states. Armor overlaps and assembly intersections are intentional. The low-poly donors receive a cohesive replacement material palette; the painted high-resolution Shark-Jaw v2 donor is not used.

## Credits and reuse

The donors are original authored models from the existing Playground catalog: Shark-Jaw Stalker standalone study, Shelf Buddies: Pond Scum, and Furnace Beetle from the Flying Monsters 3D Gallery. See `donor_catalog_records.json` for their full credit strings.

**The donor catalog specifies no public reuse license. This derivative study inherits that provenance and does not make a CC0 claim.** Original reference images, donor viewer controls and runtimes are not included.
