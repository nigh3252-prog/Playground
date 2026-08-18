# Character 04 · Resonance Wander

Character 04 is a front-facing, asymmetrical paper-doll rig based on the tuning-fork figure in the source lineup. The image-left hand keeps the smaller shafted ring; the image-right hand keeps the larger chained ring. The rig never mirrors either side.

## Files

- `index.html` — autonomous field animation with no playback controls
- `character-04-rig.js` — canvas renderer, gait solver, attack timelines, and the drift/mark/strike/resonate state machine
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

The character behaves like a resonance conductor instead of a conventional runner. Its regenerated thighs, knee covers, and lower legs form two-joint walking chains attached directly to the torso's painted hip sockets, and both arms are solved the same way from fixed piston lengths, so no part is stretched thinner in one pose than another.

### Walk

The gait is driven by distance covered rather than by a timer. One cycle covers a fixed stride length, the stance foot is pushed backwards at exactly walking speed so the boots never skate, and each plant lands on a real contact: the body drops onto it, the shadow tightens, and a small puff of dust comes off the sole. Hips sway toward the stance leg, the torso counter-rolls, both focuses counter-swing against the legs, and the heavy chained ring and the fork head trail the body on springs. Stopping eases the cycle into the nearest double-support pose instead of freezing mid-stride.

### Attacks

The character marks a hovering resonant mote, then walks to the side that puts the mote in front of the hand it intends to use — the rig never mirrors, so the approach itself carries the intent. Pointing anywhere on the field marks a target for it; there are still no playback controls.

- **Chime** — the small shafted focus snaps up behind the cowl, holds, then whips down through the mark. Aimed: the contact frame is built from the mote's actual position, so the ring passes through it. Fast, light, with a short hit-stop and a thin shockwave.
- **Slam** — the chained focus is hauled overhead, held at the top, and driven down through the mark into the floor. Long anticipation, a deep crouch and lunge, a heavy hit-stop, ground shock rings, cracks, dust, and a body that stays sunk into the landing before it recovers.

Both strikes leave the tuning-fork head ringing afterwards, and either one can shatter the mote. A marked mote sometimes draws the pair in sequence: ring it out of the air, then bring the chain down on it.

### Resonance

The listening hold is intact: it stops, raises both mismatched focuses, vibrates the tuning-fork head, and releases one clean wave from the fork at the peak. Four painted flame frames play at 8 fps, with a two-frame offset between hands, so the purple fire crackles continuously without both rings changing in lockstep.
