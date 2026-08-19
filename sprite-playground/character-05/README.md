# Character 05 · Iron Haul

Character 05 is a 16-part, non-mirrored paper-doll rig based on the orange-and-cream heavyweight robot in the source lineup. It roams a field in a neutral hauling walk, lowers into the concept art's broad action stance, and slams both chained weights outward before recovering.

## Asset pipeline

1. The supplied lineup was used as the visual authority for a new isolated, neutral bind-pose reference.
2. The generated near-white checkerboard was converted to true alpha.
3. Sixteen rough crops were taken from that bind pose: body, pelvis, separate shoulders, separate upper arms, separate fist/forearms, separate thighs, separate shin/feet, two knee covers, and two weights.
4. The rough crop sheet and isolated reference were sent through a second image-generation pass. That pass reconstructed the surfaces hidden by the assembled pose and added readable sockets to the ends of the movable pieces.
5. The finished 4x4 sheet was keyed to true alpha, quantized without flattening transparency, and split into individual PNGs.
6. The two shoulders were corrected in a dedicated side-by-side pass: separate viewer-left and viewer-right crops from the original concept each drove their own generation. Each final shoulder remains intact from its inward torso ring through its elbow socket, so the runtime no longer mirrors a pauldron or exposes a guessed shoulder/upper-arm seam.

The image-left fist always drives the image-left chain and image-left weight; image-right does the same on the other side. No side is mirrored at runtime.

## Files

- `index.html` — autonomous field animation with no playback controls
- `character-05-rig.js` — two-bone walk, brace/slam state machine, link renderer, and damped weight motion
- `character-05-reference.png` — transparent isolated reference from the first generation pass
- `character-05-parts-atlas.png` — transparent 4x4 completion atlas from the second generation pass
- `character-05-parts-atlas.json` — atlas cells, output files, sizes, and handedness note
- `parts/` — sixteen transparent paper-doll sprites
- `source/character-05-concept-crop.png` — Character 5 crop from the supplied concept lineup
- `source/character-05-rough-crops.png` — reduced rough crop sheet used for the completion pass
- `source/character-05-viewer-left-shoulder-context.png` — original-concept crop with the torso on the shoulder's right
- `source/character-05-viewer-right-shoulder-context.png` — original-concept crop with the torso on the shoulder's left
- `source/build-rough-atlas.py` — checkerboard key and rough crop builder
- `source/build-final-atlas.py` — final checkerboard key, atlas splitter, and compact PNG writer
- `source/build-shoulders-v2.py` — side-faithful shoulder extraction, alpha key, and atlas repacker; run after the base atlas build

## Movement read

The walk is intentionally slow and weighty: enlarged two-bone legs take short alternating steps while the smaller spherical body bobs and the arms counter-swing. Each source-faithful shoulder is drawn behind the body from its painted inward ring to its real elbow socket; the separate forearm begins at that socket. Each block follows its own damped spring target and the chain is redrawn link-by-link along a sagging curve from the correctly paired fist. During the brace, the feet spread, the body lowers, the shoulders open, and the blocks move outward into the low, wide silhouette of the concept. The slam adds independent weight inertia, dust, and ground rings before the rig returns to its neutral hauling gait.
