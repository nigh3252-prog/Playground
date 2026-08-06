# Manta Delta Star Freighter — reconstruction workspace

Procedural Three.js reconstruction of a sci-fi starship from a single reference image,
built with the [img2threejs](https://github.com/img2threejs/img2threejs) skill.

**Deliverable:** [`../manta-delta-star-freighter.html`](../manta-delta-star-freighter.html) —
one self-contained file, no network requests. Drag to orbit, pinch/scroll to zoom, tap any
part to inspect it, and use the CTRL panel for explode, mast fold, pod jettison and the four
review viewpoints.

## What's here

| Path | What it is |
|---|---|
| `assessment.json` | Pre-spec assessment: object class, complexity, 18-entry detail inventory, resolved unknowns |
| `object-sculpt-spec.json` | The authority. 91 components, 10 materials, 5 repetition systems, full review history |
| `object-sculpt-spec.app.json` | Build-time variant with referencePbr maps withheld from the cel path |
| `build_spec.py` | Authors the spec from the observation pass — edit this, not the JSON |
| `src/createMantaModel.ts` | Generated factory (do not hand-edit; regenerated per pass) |
| `src/celShading.ts` | Cel/ink render system: toon ramp, palette, inverted-hull + edge outlines |
| `app/` | Viewer entry and HTML shell for the shipped file |
| `build_standalone.sh` | spec → factory → bundle → single-file HTML |
| `shoot.mjs` / `sweep.mjs` / `verify_app.mjs` | Headless render, camera solve, and app verification |
| `renders/` | Per-pass renders, comparison sheets, silhouette overlays |
| `pbr/`, `matcrops/` | Per-material reference crops and extracted PBR evidence |

## Rebuild

```bash
./recon/build_standalone.sh          # rebuild the shipped HTML from the spec
cd recon && node verify_app.mjs      # load it in Chromium, exercise controls, screenshot
```

## Gate status at hand-off

| Gate | Result |
|---|---|
| Reference admission | **pass** — single connected subject, 28% frame coverage |
| Strict-quality spec validation | **pass** |
| Multi-angle (degenerate view) | **pass** — ratios 0.38 / 0.77 / 0.53 vs a 0.15 collapse threshold |
| Part coverage (structure) | **pass** — 102 specified, 108 built, 0 errors, 0 unnamed meshes |
| Tier 1 scale delta | **pass** — 0.030 (threshold 0.08) |
| Tier 1 aspect delta | **pass** — 0.040 (threshold 0.05) |
| Tier 1 silhouette IoU | **fail** — 0.711 (threshold 0.85) |

The pipeline was stopped at `form-refinement` with `action: stop` rather than forced past the
bar. See the reasoning in `object-sculpt-spec.json` → `reviewHistory`.

## Corrections after review

Two errors were caught by the author reviewing the render against the reference, both of them
mine, both of them wrong *readings* rather than wrong execution:

1. **Delta wings that do not exist.** The first build inferred a wide forward-swept delta
   planform from the single side elevation. There are no laterally-extending wings in the
   reference at all — the wide bright planes are the slender hull's own overlapping armour
   plating seen at a shallow angle. The hull profile is now **traced** column-by-column from
   the reference silhouette instead of inferred, and the wings are replaced by slim bow planes
   hugging the flank.
2. **Cargo pods instead of viscera.** The underside was built as seven tidy capsules in two
   rows. The reference is a packed mass of soft tubing that loops, folds back on itself and
   crosses over — it reads as intestines. It is now seven `tube` primitives swept along
   serpentine spines, three of which fold back on themselves, cinched by 21 steel bands. A
   capsule cannot fold back on itself, and that fold is the whole character of the thing.

A third error surfaced from the same comparison: the traced ventral line through the belly is
the *viscera*, not the hull. Taking it literally made the body a fat slab, so the hull's own
ventral line is held near -0.20 there and the tubes carry the mass below it.

### Direction of detail

A follow-up review caught that the detail on both was running the **wrong way**:

- **The guts squiggle up and down, not along.** The tube runs undulated gently while travelling
  fore-aft, which reads as flat horizontal ribbons. The reference's underside is a row of
  down-pointing lobes with deep notches between them: the tube plunges, turns at the bottom,
  climbs back, then advances a little. They are now authored as 1.2–2.3 **vertical lobes** per
  run, deliberately unequal in count, depth and span — an even lobe count with matched phases
  read as a coiled spring, which is just as wrong as the ribbons were.
- **The armour plating is banded transversely, not along the hull.** The plate seams in the
  reference are near-vertical lines dividing the hull into bands along its length. The build had
  fore-aft deck strips plus a cross-hatched texture grid, giving the opposite rhythm. There are
  now 15 **transverse armour bands** sized to the traced hull section at each station, and the
  texture's horizontal line set was removed so it stops fighting them. The bands are kept barely
  proud of the flank and stop short of the deck line — at full section height they read as
  scaffolding ribs rather than plating.

## Honest limits

- **The IoU ceiling argument has been retired.** An earlier version of this file argued that
  the reference could not be matched because a half-span-2.7 wing must project above where the
  drawing puts the dorsal surface. That argument was built on the delta wings, which turned out
  not to exist. With a slender traced hull the constraint dissolves, and the remaining IoU gap
  (0.713) is ordinary unmodelled detail — the stern bay, the deck plate overhangs, the bow jaw —
  not a geometric impossibility. Do not cite the old ceiling as a limit; it was a rationalisation
  of a wrong model.
- **Lateral width is still inferred.** The side profile is now traced, but a single side
  elevation cannot show how wide the body is. The top view remains an informed guess.
- **Starboard flank is mirrored** from port; there is no starboard evidence.
- **Material evidence is drawn colour, not photographic PBR.** `extract_pbr_evidence` cleared
  its 0.7 threshold on all ten materials (0.84–0.86), but on a *drawing*: the extracted
  roughness/normal/AO describe brush and ink texture, so only the albedo and the absence of a
  specular lobe are treated as load-bearing. The relief maps are deliberately not wired in.
- Remaining geometry deltas, largest first: the stern chevron vane array and the concentric
  triangular nozzle read far too small and are largely occluded from the review camera; the bow
  chin is blockier than the reference's angular jaw; the reference's characteristic thin
  overhanging deck plates along the top edge are not modelled.
