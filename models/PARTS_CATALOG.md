# Reusable parts and variant preference shortlist

This is a human-reviewed **candidate index**, not a set of extracted assets. Machine-readable donor candidates and source keys live in [reviews.json](./reviews.json), which is canonical. For each candidate, inspect the original GLB and its materials/UVs before declaring a specific mesh ready for reassembly.

| Source (`id@version`) | Candidate actual geometry | Potential reuse | Caveat |
|---|---|---|---|
| `warden-scout-gunner@v2` | Arm guns, torso | Enemy arm modules, mech bodies | Skinny complete enemy is a small hit target; walk animation needs work |
| `warden-scout-rail@v2` | Rail weapon | Modular scout/mech armament | Similar to Gunner, but similarity does not prove shared mesh |
| `warden-scout-missile@v2` | Shoulder rockets, body elements | Humanoid and crawler launchers | Priority exact-mesh extraction target |
| `bulwark-modular@v1` | Shoulders, chest plates, front panel details, separate gun | Armor and heavy mech construction | Side UV/texture distortion and repeated leg painting to repair |
| `vertical-pods-a-hip-assembly@v1` | Vertical hip pod assembly | Warden launcher and enemy equipment | Verify scale and fit |
| `vertical-pods-a-pod-module@v1` | Individual pod | Modular missile hardware | Single chamber may be ideal for Warden |
| `vertical-pods-b-hip-assembly@v1` | Alternate pod assembly | Warden / large T-Rex-monster equipment | Needs non-graybox texture detail |
| `railgun-breach-engine@v1` | Squared shell, flared lower section | Weapon module and large machine body | Strip redundant handles instead of remaking |
| `railgun-breach-engine@v2` | Rounded internals | Hybrid with V1 shell | Overall V1 exterior preferred |
| `railgun-dynamo@v2` | Fist-like tip | Possible Shockwave treatment | Only exploratory |
| `railgun-longbow@v1` | Long barrel | Extended-barrel gun | Avoid extra underside handle |
| `railgun-splitline@v2` | Complete assembly | Excellent weapon donor | V2 exclusively preferred; in-game deployment intentionally deferred |
| `railgun-pale-horse@v1` | Main housing | Possible shoulder cannon | Recover/repurpose, not an approved final weapon |
| `railgun-sunspike@v1`, `@v2` | Both versions' mechanisms | Existing successful combined Warden implementation | Preserve exact part lineage |
| `flying-ruin-titan@v1` | Mixed creature elements | More detailed monster kitbashing | Candidate parts are not yet extracted |
| `warden-iguana-crab@v1` | Crab collar/neck forms | Possible Monstro exploration | High-poly; performance and fit unverified |

## Variant and family interpretation

- **Splitline:** V2 decisively preferred. V1 is not a donor priority despite high construction quality.
- **Breach Engine:** prefer V1's squared outer architecture, select V2 internal round mechanisms only where useful.
- **Dynamo:** V1 has the stronger overall character; V2 fist is independently interesting.
- **Longbow:** V1 extended barrel is a valuable shape.
- **Sunspike:** both versions are successful; existing in-game combination is liked.
- **Redshift:** V2 is a poor interpretation; V1 somewhat recoverable. Neither should be treated as a railgun design benchmark.
- **Pale Horse:** V1 may be repurposed rather than used as the intended standalone weapon.
- **Bulwark:** keep bare frame as a variant of the Modular family rather than a separate showpiece.
- **Spirecoil:** Organic V3 is visually rich but needs neck flap alignment; V2 silhouette and V1 mechanical are currently medium-level, despite their size and part counts.

## Before a future AI builds 40 enemies

Choose a concept/silhouette seed, then use **real reviewed donor meshes** to bring it up to target quality. Confirm each source and its usable pieces, preserve UV textures and material mappings, record mesh provenance, and prototype animation/target size independently. For enemy traits, swappable visible launcher, gun, armor, or head modules could communicate different behaviors; that remains an exploration, not a specification.

Never copy a review's descriptive words into a new crude mesh and call it a kitbash.
