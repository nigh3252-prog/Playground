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
| Multi-angle (degenerate view) | **pass** — ratios 0.39 / 1.61 / 0.49 vs a 0.15 collapse threshold |
| Part coverage (structure) | **pass** — 92 specified, 98 built, 0 errors, 0 unnamed meshes |
| Tier 1 aspect delta | **pass** — 0.047 (threshold 0.05) |
| Tier 1 scale delta | **pass** — 0.055 (threshold 0.08) |
| Tier 1 silhouette IoU | **fail** — 0.723 (threshold 0.85) |
| overall-silhouette feature | **0.78** against a 0.80 bar |

The pipeline was stopped at `form-refinement` with `action: stop` rather than forced past the
bar. See the reasoning in `object-sculpt-spec.json` → `reviewHistory`.

## Honest limits

- **The reference is not a consistent perspective projection.** Matching its silhouette aspect
  needs a 16° camera pitch, but at 16° a wing of half-span 2.7 projects its far edge to Y=0.94
  while the drawing puts the dorsal surface at Y=0.56. Satisfying both needs half-span 1.31,
  and the measured span sweep shows narrower spans score *worse* overall (1.8 → IoU 0.597 vs
  2.7 → 0.631). The drawing shows more deck than a real camera can at that aspect. IoU
  ~0.72–0.75 is the ceiling for a physically consistent camera.
- **Planform is inferred**, not measured. A single side elevation cannot show wing chord,
  sweep or span. Confidence 0.45. The top view is an informed guess.
- **Starboard flank is mirrored** from port; there is no starboard evidence.
- **Material evidence is drawn colour, not photographic PBR.** `extract_pbr_evidence` cleared
  its 0.7 threshold on all ten materials (0.84–0.86), but on a *drawing*: the extracted
  roughness/normal/AO describe brush and ink texture, so only the albedo and the absence of a
  specular lobe are treated as load-bearing. The relief maps are deliberately not wired in.
- Remaining geometry deltas, largest first: missing ventral mass under the stern bay; bow wing
  tip sits low and short; tail blade slightly oversized.
