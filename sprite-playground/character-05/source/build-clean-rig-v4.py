#!/usr/bin/env python3
"""Build the Character 05 v4 subtraction-pass sprites and active atlas.

The first completion atlas painted several joints more than once. This pass
does not generate new art: it keeps the corrected side-specific shoulders
whole, derives lower legs and ankle-down feet from retained source sprites,
and publishes only the thirteen parts used by the runtime.
"""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
PARTS = ROOT / "parts"

ACTIVE_PARTS = [
    "body",
    "left_shoulder",
    "right_shoulder",
    "left_forearm_fist",
    "right_forearm_fist",
    "left_thigh",
    "right_thigh",
    "left_lower_leg",
    "right_lower_leg",
    "left_foot",
    "right_foot",
    "left_weight",
    "right_weight",
]


def save_compact(image: Image.Image, path: Path, colors: int = 192) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.quantize(
        colors=colors,
        method=Image.Quantize.FASTOCTREE,
        dither=Image.Dither.NONE,
    ).save(path, optimize=True)


def crop_exact(source_name: str, box: tuple[int, int, int, int], output_name: str) -> None:
    source = Image.open(PARTS / source_name).convert("RGBA")
    save_compact(source.crop(box), PARTS / output_name)


def fit(image: Image.Image, max_width: int, max_height: int) -> Image.Image:
    scale = min(max_width / image.width, max_height / image.height, 1)
    if scale >= 1:
        return image.copy()
    return image.resize(
        (max(1, round(image.width * scale)), max(1, round(image.height * scale))),
        Image.Resampling.LANCZOS,
    )


def build_atlas() -> None:
    columns = 4
    rows = 4
    cell = 384
    inset = 12
    atlas = Image.new("RGBA", (columns * cell, rows * cell), (0, 0, 0, 0))
    manifest: dict[str, dict[str, object]] = {}

    for index, name in enumerate(ACTIVE_PARTS):
        row, column = divmod(index, columns)
        source = Image.open(PARTS / f"{name}.png").convert("RGBA")
        sprite = fit(source, cell - inset * 2, cell - inset * 2)
        x = column * cell + (cell - sprite.width) // 2
        y = row * cell + (cell - sprite.height) // 2
        atlas.alpha_composite(sprite, (x, y))
        manifest[name] = {
            "file": f"parts/{name}.png",
            "atlas_crop": [column * cell, row * cell, cell, cell],
            "size": [source.width, source.height],
        }

    save_compact(atlas, ROOT / "character-05-parts-atlas.png", 224)
    (ROOT / "character-05-parts-atlas.json").write_text(
        json.dumps(
            {
                "character": "05",
                "generated_atlas_size": [columns * cell, rows * cell],
                "grid": [columns, rows],
                "active_part_count": len(ACTIVE_PARTS),
                "joint_ownership": {
                    "shoulder": "body socket; full side-specific upper arm tucks beneath",
                    "elbow": "full side-specific upper arm",
                    "hip": "body; thigh tucks beneath",
                    "knee": "thigh; lower leg tucks beneath",
                    "ankle": "foot; lower leg tucks beneath",
                    "wrist": "combined forearm/fist",
                },
                "handedness": (
                    "Names are viewer/image-left and viewer/image-right. Corrected "
                    "shoulders and all other side-specific pieces remain independent; "
                    "nothing is mirrored at runtime."
                ),
                "parts": manifest,
            },
            indent=2,
        )
        + "\n"
    )


def main() -> None:
    # Knee-to-ankle segments from the retained clean whole lower-leg art.
    crop_exact("left_shin_foot.png", (0, 0, 205, 205), "left_lower_leg.png")
    crop_exact("right_shin_foot.png", (0, 0, 212, 206), "right_lower_leg.png")

    # Ankle-down feet. Their visible side discs are the runtime pivots; the
    # duplicated upper calf/collar from the earlier boot sprites is discarded.
    crop_exact("left_boot.png", (0, 150, 292, 260), "left_foot.png")
    crop_exact("right_boot.png", (0, 150, 290, 270), "right_foot.png")

    build_atlas()


if __name__ == "__main__":
    main()
