# Character 05 · Iron Haul

Character 05 is a 13-part, non-mirrored paper-doll rig based on the orange-and-cream heavyweight robot in the source lineup. It roams a field in a grounded hauling walk, gathers into a distinct brace, and drops into the concept art's broad anchor-slam silhouette before recovering.

## Asset pipeline

1. The supplied lineup was used as the visual authority for a new isolated, neutral bind-pose reference.
2. The generated near-white checkerboard was converted to true alpha.
3. Sixteen rough crops were taken from that bind pose: body, pelvis, separate shoulders, separate upper arms, separate fist/forearms, separate thighs, separate shin/feet, two knee covers, and two weights.
4. The rough crop sheet and isolated reference were sent through a second image-generation pass. That pass reconstructed the surfaces hidden by the assembled pose and added readable sockets to the ends of the movable pieces.
5. The finished 4x4 sheet was keyed to true alpha, quantized without flattening transparency, and split into individual PNGs.
6. The two shoulders were corrected in a dedicated side-by-side pass: separate viewer-left and viewer-right crops from the original concept each drove their own generation, so neither side is a flipped substitute.
7. The v3 proportion pass returned to the original concept instead of recursively using the neutral generated reference. A tight torso crop produced the longer, screen-left-facing barrel body; separate same-side leg crops produced new thighs, shins, and boots.
8. The v4 subtraction pass removed the duplicate pelvis, shoulder-cap, knee-overlay, calf, and ankle geometry from the active rig. Each corrected shoulder now stays whole from its real torso socket to its elbow, matching the concept's actual joint count.
9. Clean lower legs are derived from the retained side-specific shin/foot art and end at the ankle. Separate ankle-down feet own the only visible ankle caps and stay parallel to the field.
10. The exact concept crop is locked to a joint map. Visible pivots, inferred hidden hip/root pivots, side identity, chain-guide candidates, and crop-overlap radii are recorded in both a review image and machine-readable coordinates.

The image-left fist always drives the image-left chain and image-left weight; image-right does the same on the other side. No side is mirrored at runtime.

## Files

- `index.html` — autonomous field animation with no playback controls
- `character-05-rig.js` — two-bone walk, brace/slam state machine, link renderer, and damped weight motion
- `character-05-reference.png` — transparent isolated reference from the first generation pass
- `character-05-parts-atlas.png` — transparent 4x4 active-runtime atlas (13 occupied cells)
- `character-05-parts-atlas.json` — atlas cells, output files, sizes, and handedness note
- `parts/` — thirteen active transparent paper-doll sprites plus retained superseded source-side exports
- `source/character-05-concept-crop.png` — Character 5 crop from the supplied concept lineup
- `source/character-05-concept-isolated.png` — exact Character 5 pixels with unrelated lineup fragments removed from the surrounding paper
- `source/character-05-joint-map.png` — review render of the proposed pivots and crop-overlap zones
- `source/character-05-joint-map.svg` — editable overlay that renders the joint map without altering the concept pixels
- `source/character-05-joint-map.json` — source-pixel pivot coordinates, confidence, overlap radii, side lock, and atlas guidance
- `source/character-05-rough-crops.png` — reduced rough crop sheet used for the completion pass
- `source/character-05-viewer-left-shoulder-context.png` — original-concept crop with the torso on the shoulder's right
- `source/character-05-viewer-right-shoulder-context.png` — original-concept crop with the torso on the shoulder's left
- `source/character-05-body-context-v3.png` — original-concept torso crop used by the barrel-body pass
- `source/character-05-viewer-left-leg-context-v3.png` — original viewer-left leg context
- `source/character-05-viewer-right-leg-context-v3.png` — original viewer-right leg context
- `source/build-rough-atlas.py` — checkerboard key and rough crop builder
- `source/build-final-atlas.py` — final checkerboard key, atlas splitter, and compact PNG writer
- `source/build-shoulders-v2.py` — side-faithful shoulder extraction, alpha key, and atlas repacker; run after the base atlas build
- `source/build-proportions-v3.py` — v3 checkerboard key, independent thigh/shin/boot export, rigid shoulder-cap derivation, and active atlas repacker
- `source/build-clean-rig-v4.py` — deterministic duplicate-joint removal, clean lower-leg/foot derivation, and 13-part active atlas builder
- `source/generation-prompts-v3.md` — concept-grounded prompt set and input mapping for the v3 bitmap pass

## Movement read

The walk is intentionally slow and weighty: each foot stays planted for most of its cycle, the wide barrel torso lags and sways over the planted side, and the short swing phase keeps foot lift low. Whole shoulder-to-elbow sprites rotate around the exact sockets painted into the torso. Thighs own the visible knee faces, lower legs tuck beneath them, and separate ankle-down feet stay flat on the field. The larger blocks scrape along the ground, and fewer oversized links run from the outer forearms in front of the fists. The brace rises and gathers tension; the anchor slam drops the body, compresses the knees, drives the arms down, and holds the impact before recovery.
