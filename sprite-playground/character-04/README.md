# Character 04 · Resonance Wander

Character 04 is a front-facing, asymmetrical paper-doll rig based on the tuning-fork figure in the source lineup. The image-left hand keeps the smaller shafted ring; the image-right hand keeps the larger chained ring. The rig never mirrors either side.

## Files

- `index.html` — autonomous field animation with no playback controls
- `character-04-rig.js` — canvas renderer and drift/listen/resonate state machine
- `character-04-reference.png` — clean, isolated full-character reference
- `character-04-parts-atlas.png` — transparent fourteen-part atlas
- `character-04-parts-atlas.json` — crop rectangles and joint pivots
- `character-04-focus-animation.json` — focus-strip frame sizes, wrist pivots, hand mapping, and playback timing
- `parts/right_focus-frames.png` — four transparent frames for the image-right large chained ring
- `parts/left_focus-frames.png` — four transparent frames for the image-left small shafted ring
- `parts/` — individual transparent PNGs
- `source/character-04-source-crop.png` — source-art crop used only as an image-generation reference
- `source/character-04-focus-animation-source.png` — supplied two-row focus animation sheet
- `source/build-focus-animation.py` — deterministic black-key, alignment, and strip builder for the supplied sheet

The final reference and all atlas parts are regenerated assets, not crops from the lineup. A neon-green generation plate was removed after generation; the published PNGs contain true alpha. The two focus animation strips are extracted from the supplied black-backed frame sheet and wrist-aligned with transparent backgrounds.

## Movement read

The character behaves like a resonance conductor instead of a conventional runner. Its regenerated thighs, knee covers, and lower legs form two-joint walking chains attached directly to the torso's painted hip sockets. It uses restrained steps, stops to listen, raises both mismatched focuses, vibrates the tuning-fork head, and emits procedural resonance waves before wandering again. Four painted flame frames play at 8 fps, with a two-frame offset between hands, so the purple fire crackles continuously without both rings changing in lockstep.
