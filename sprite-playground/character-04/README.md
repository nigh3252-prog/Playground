# Character 04 · Resonance Wander

Character 04 is a front-facing, asymmetrical paper-doll rig based on the tuning-fork figure in the source lineup. The image-left hand keeps the smaller shafted ring; the image-right hand keeps the larger chained ring. The rig never mirrors either side.

## Files

- `index.html` — autonomous field animation with no playback controls
- `character-04-rig.js` — canvas renderer and drift/listen/resonate state machine
- `character-04-reference.png` — clean, isolated full-character reference
- `character-04-parts-atlas.png` — transparent ten-part atlas
- `character-04-parts-atlas.json` — crop rectangles and joint pivots
- `parts/` — individual transparent PNGs
- `source/character-04-source-crop.png` — source-art crop used only as an image-generation reference

The final reference and all atlas parts are regenerated assets, not crops from the lineup. A neon-green generation plate was removed after generation; the published PNGs contain true alpha.

## Movement read

The character behaves like a resonance conductor instead of a conventional runner. It uses restrained gliding steps, stops to listen, raises both mismatched focuses, vibrates the tuning-fork head, and emits procedural resonance waves before wandering again.
