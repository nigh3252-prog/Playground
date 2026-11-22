# Warden: three creature kitbash studies

This visual experiment assembles **Bellows**, **Brood Loom**, and **Shutter Wraith** from selected meshes in the existing Playground collection. Every creature is authored at a **12-meter neutral geometry height**, with glTF's Y-up convention and its face toward +Z. The reference Warden is displayed at 4 meters in the lab.

Open [`../kitbash.html`](../kitbash.html) through the repository's static host. Each creature has a native animated GLB, a reproducible Blender build script, a recipe identifying source parts and transforms, and rendered review images.

| Study | Main source parts | Shape to evaluate |
| --- | --- | --- |
| Bellows | Shark-Jaw Stalker, Pond Scum, Furnace Beetle | Wide pressure mouth, low body, heavy hindquarters |
| Brood Loom | Arakhne, Orbital Shell, Brood Ferry | Raised egg abdomen, open underside, eight long legs |
| Shutter Wraith | Hooded Reliquary, Void Reaper, shoulder assembly, Lantern Medusa | Floating hollow armor, opening shutters, three independent sentries |

## Scope and scale

These are visual prototypes. Their exported native clips demonstrate the intended character of movement; the studies do not yet supply production foot IK, collision shapes, attacks, hitboxes, damage states, game integration or a device performance certification. Rigid parts move on named pivots. The source geometry is reused deliberately and material treatment is recorded in each recipe.

12 meters is the selected design target, three times the displayed Warden height. The exact gameplay Dreadmaw (Nightmare V19 B) asset was measured in its authored neutral skin pose at the confirmed runtime conversion of `0.22 × 10 meters per world unit`. Its body height excluding the two tall launcher pods is **20.1471 m**, so each 12 m creature is **59.56%** of that height: approximately the requested lower end of 60–70%. Including those pods, the full neutral envelope is **22.5022 m**, and the ratio is **53.33%**. Its measured length is 55.2852 m and hip-bone height is 10.0320 m, consistent with the game notes.

These are neutral asset measurements, not measurements of every live procedural pose. The runtime asset contains no animation clips; generated tendrils, live posture and attack movement were not evaluated. The complete measurements, source asset hash and part exclusions are in `reference-scale.json`. Runtime branch `codex/first-floor-machine-hunts`, commit `48fdcb7bb1adb6183c15e8b9d46d1610d413c223`; scale sources are `src/bosses/dreadmawModel.mjs` and `src/scale/units.mjs`.

Animations can change the visible envelope. The lab calibrates all four models from their rest bounds, places them on a shared ground plane, and uses one camera scale for the lineup. A floating pose or jump can extend above its neutral height.

## Files

- `bellows/bellows.glb`, `bellows/recipe.json`, `bellows/build_bellows.py`
- `brood-loom/brood-loom.glb`, `brood-loom/recipe.json`, `brood-loom/build_brood_loom.py`
- `shutter-wraith/shutter-wraith.glb`, `shutter-wraith/recipe.json`, and its Blender build script
- `viewer.mjs`, `styles.css`, `studies.json`: the comparison lab
- `export_portable.py`: produces an offline HTML copy with all GLBs, renderer modules and recipes embedded

Each model recipe records exact donor paths, source hashes, selected part identities and assembly transforms. Source assets live in `../../models/assets/`; split GLB donors are concatenated by the appropriate builder. Run the Blender scripts from a checkout containing those original sources. Review each script's command-line switches before rebuilding renders.

## Portable export

```sh
python labs/kitbash/export_portable.py /absolute/output/warden-kitbash-study.html
```

Open that HTML in a modern browser with WebGL. It loads no remote assets and needs no local server. It preserves the same native animation and model/recipe downloads as the hosted lab. When WebGL is unavailable, the lab shows rendered still previews and keeps the model/recipe downloads working.

## Credits

The donor models are existing user workshop assets. Their catalog provenance remains in `models/catalog.json`, with exact selected sources in each recipe. No new public reuse license is granted to those models by this experiment. Recombining or recoloring the geometry does not replace its source provenance. Three.js and its included loaders/controls retain the MIT license in `armory/vendor/THREE-LICENSE.txt`; the Meshoptimizer decoder keeps `models/vendor/meshoptimizer/LICENSE.md`. The portable exporter embeds both notices.
