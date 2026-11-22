# Playground model-review guide

This is a **subjective human curation layer**, separate from the generated asset manifest in [catalog.json](./catalog.json). The review covers the first 83 explicitly matched models from conversations on 2026-11-22; the remaining catalog entries are **unreviewed**, not rejected. Review data is in [reviews.json](./reviews.json). Keep model assets and their catalog IDs unchanged when editing review text.

## How to read the registry

- Join each `modelReviews[]` row to a catalog row using **both** `id` and `version`. Never join by order, display label, model number, or just the latest version. Deep link with `?model=<id>&v=<version>`.
- `visualQuality` is `exceptional`, `high`, `medium`, `low`, or `null` (reviewed but not given a quality judgment). **Missing review** means unreviewed, not low. This is *perceived visual craftsmanship*, not triangle/mesh count, combat suitability, or permission to ship.
- `tags` express distinct uses/next steps. They are not a numerical rank: `gold-standard`, `parts-donor`, `recover`, `refine`, `concept`, `use-as-is`, `superseded`, `concept-mismatch`, `placeholder`, `review-rig`, `avoid`, etc. A high-detail model can be superseded by a better sibling; a lower-quality whole model can still donate great components.
- `assessment` preserves nuanced observations and explicit uncertainty. `reuseCandidates[]` are **candidate parts only**, not verified submeshes; `extractionVerified: false` is deliberate. Inspect actual GLB scene hierarchy, UVs, materials, rigging, and license before extracting.
- `unresolvedReferences[]` records comments that could not be mapped safely to one exact catalog asset (for example, “Crocodilian #2”). Do not silently assign them to convenient neighboring assets.
- No asset was changed, re-rated automatically, copied, licensed, or inserted into Warden by adding this registry.

## Target quality and why it works

**Warden V1 is the flagship benchmark.** White Mech, Scout Gunner/Rail/Missile, Bulwark Modular (front and reusable pieces), and Splitline V2 illustrate successful practices; they are not identical styles. Visually rich **painted UV textures and strong volumes** often outperform increasing triangle counts. Scout Gunner looks sophisticated with a relatively small mesh. Conversely, the Apiary has many triangles in smooth spheres without much perceived surface detail. A large assembly made of many simple parts can still be medium-detail.

Aim for distinctive silhouettes, strong three-dimensional plate/wedge geometry at appropriate scale, and painted texture information for small grooves, grilles, wear, fasteners and material separation. Avoid generic, unsupported barrel clusters (miniguns need a convincing housing), unnecessary grips/handles, accidental anatomy-like silhouettes, and very childlike/goofy forms unless explicitly intended. Preserve purposefully simple assets where their tiny scale or low-threat gameplay role justifies it.

Visual craftsmanship, concept, gameplay target size, rig/skeleton health, animation quality, and raw performance are separate judgments. White Mech is visually excellent despite poor animations; Scout Gunner has a strong body but thin hit target. **Do not downgrade good geometry just because an existing walk clip is poor.** Inspect skin/rig, retargeting compatibility, and animation independently.

## Exact-mesh kitbashing: the non-negotiable rule

When asked to “kitbash,” **reuse the actual source GLB geometry** and, where possible, the original UV maps and textures. In the originating meshes, inspect nodes/submeshes and their transforms, then extract/copy, remove unwanted handles, reposition, rotate, resize, mirror only where appropriate, and combine with other real assets. Retain source attribution and check usage rights; current catalog entries often say “No public reuse license specified,” which does **not** grant third-party reuse rights. Do not describe a rough source design and produce a worse new approximation. “Inspired by” generation is a different operation and must be labeled honestly.

For any extraction: record the exact `id@version`, verified scene-node path(s), mesh/material/texture provenance, transforms, scale and orientation conversions, and resultant destination. The registry does **not** yet have verified node paths. When asked to build a batch of enemies, prioritize high-quality exact donors for parts, use medium-quality models as silhouettes/concept seeds, and upgrade them toward Warden's finish. Never interpret a review as authorization to implement a new enemy or gameplay trait.

## Specific design opportunities (not implementation approval)

- **Reusable weapons:** Scout Missile shoulder rockets, Scout Gunner arm guns, Bulwark shoulders/chest, vertical hip-mounted missile pods, the Railgun family. Swappable physical modules could distinguish Borderlands enemy traits and bring back Bazaar's enemy-equipment ideas.
- **Machine Lab recovery:** concept quality often exceeds mesh quality. Railworm/train-worm, Hotshoe, Split Sled and Sump Twins are good ways to test a true donor-parts workflow.
- **Haunted Ice Kit:** model doesn't match the intended crystal-and-skull growth idea. Target is simple elongated four-sided pyramid/prism or D8-like crystalline forms, skull clusters resembling mold growth; **no snow**.
- **Monstro:** future Hopper with disproportionately large frog-like body and only slightly larger legs. Crab-neck detail is speculative.
- **Goat-headed mech:** Oryxus inspired a possible distinctive trait silhouette. Not an approved feature.
- **Tiny flies forming a ring:** potentially useful *group behavior*; do not confuse it with retaining current Halo/Ring flying enemies, which the user wants to retire.
- **Redshift:** the user corrected the prior prompt: it was inspired by a particular saw-weapon concept and was *not* intended to be shaped like a triangular-side-profile railgun. Do not propagate that misinterpretation.

## Adding future review batches

1. Preserve natural conversation notes, identify exact `id@version` using `catalog.json`, and only add entries when identity is supported.
2. Add/edit one review row and candidate parts without modifying the immutable model metadata or GLB assets. Do not guess a quality rating from polygon count, family membership or adjacent variants.
3. Keep contradictory feedback and evolving preference explicit (e.g. Nightmaw Bat was initially disliked but later acknowledged as medium-detail with a salvageable vision).
4. Verify all keys are unique and present in the catalog and that `visualQuality` is a supported value.
5. As the review grows, add confirmed node paths to donor candidates only after actual GLB inspection.
6. Model-family navigation should keep related variants together, but separate **review quality** from **catalog complexity** (the latter is raw triangle count).

See [PARTS_CATALOG.md](./PARTS_CATALOG.md) for the initial donor shortlist and family preferences.
