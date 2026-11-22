# Mech art studies

## Power Dolls

[Painted UV Reference Lab](power-dolls.html) uses the three posed GLBs and matching equipment-screen reference crops from [Warden PR #188](https://github.com/nigh3252-prog/warden-playground/pull/188), commit [f05d09ea](https://github.com/nigh3252-prog/warden-playground/commit/f05d09ea9144829543ebab33ff40cac34f437eba). The models retain their embedded painted color and normal atlases. The lab shows both atlas pages and the UV overlay.

The supplied reference crops depict Power Dolls equipment screens and remain attributed to the original game. The source PR identifies no public reuse license for the studies or the reference images.

| File          | SHA-256                                                            |
| ------------- | ------------------------------------------------------------------ |
| `cannon.glb`  | `37bbf945c0550e70f60bb5e13c9c7f74753e897c08b9e91ba9070dd2ae7df056` |
| `cannon.png`  | `3a6cca851b5b5ed3de6fbcf2d75ff235cd9609d257d5155f593c00d246829681` |
| `scout.glb`   | `9ff3284587a987bcb3e2d430fbb8c0cb4ac7b34a9fe2007305f8bae1161cb63d` |
| `scout.png`   | `6a546a8670e60a6c8461ea8e64229252313e783d86fc1a58d848cb985a289527` |
| `missile.glb` | `b5a972dfa8c212e807b1bc5354d72e39a8eff361900897ee17351dffaabcd78e` |
| `missile.png` | `324d5df62acf2fcd6950743744d7d1ebd6a1456f6ce645c0251388d464f29925` |

## Crocodilian

[Atlas & UV Inspection](crocodilian.html) adapts the standalone viewer from [Warden PR #187](https://github.com/nigh3252-prog/warden-playground/pull/187), commit [0fd4f80a](https://github.com/nigh3252-prog/warden-playground/commit/0fd4f80a1b4d9b76a1e928bc4f995c34d21ca0c0). It loads and downloads the existing [Model Review Bench GLB](../models/assets/crocodilian-v1.glb) from [Playground PR #38](https://github.com/nigh3252-prog/Playground/pull/38). Its SHA-256 is `d2c4ba627e0aab9877bb57c6225e981274984cb44da5886060c6f9410f563de6`. The bench catalog records the original Warden mesh and textures and their reuse status.

Both viewers use Playground's vendored Three.js and its [MIT license](../armory/vendor/THREE-LICENSE.txt).

## Witch Hat Mech (Hexenschmied)

The [Witch Hat Mech study](witch-hat-mech.html) comes from the November 2026 Witch Hat Mech handoff. It preserves the Pass 2 camera presets, reference overlays, silhouette ghost, pose, drawing and part adjustments. The public version restores the original procedural hands, thighs, lower legs and boots from Pass 1. The handoff’s private Pass 2 scene contains a fan-model guest and geometry taken from that guest.

The bench has posed GLB exports for [Pass 1](../models/?model=witch-hat-mech&v=v1) and the [public Pass 2 study](../models/?model=witch-hat-mech&v=v2). The GLBs contain the mech geometry, transforms and clay materials. The interactive study carries the reference overlays and pose controls.

## Mecha, Robot & Creature Reference Hangar

The [Reference Hangar](reference-hangar.html) restores the recovered multi-format catalog, viewer and notes. Models load from their linked upstream hosts. The license filter highlights entries with documented reuse terms, and source-only cards preserve the original links where a working direct file could not be verified.

The [Player Gundam fan model](reference-hangar.html?q=Player+Gundam) matches the handoff’s guest GLB. Its [upstream repository](https://github.com/shbrown1/mechjam/blob/839409340471fd5b9e460996ae0fd779d6db6a5f/Player/playergundam.glb) lists no license, so the Hangar lists it for reference.
