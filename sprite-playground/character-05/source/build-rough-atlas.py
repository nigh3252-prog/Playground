#!/usr/bin/env python3
"""Key the generated bind-pose reference and crop a rough 4x4 paper-doll sheet.

The rough sheet intentionally contains occluded fragments. It is supplied to the
second image-generation pass so those fragments can be reconstructed as complete,
animation-ready pieces while retaining the generated reference's proportions.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image


PARTS = {
    "body": (420, 150, 985, 645),
    "pelvis": (525, 500, 875, 675),
    "left_shoulder": (300, 205, 555, 465),
    "right_shoulder": (845, 190, 1115, 465),
    "left_upper_arm": (260, 365, 495, 585),
    "right_upper_arm": (925, 355, 1155, 585),
    "left_forearm_fist": (250, 485, 430, 765),
    "right_forearm_fist": (965, 480, 1145, 765),
    "left_thigh": (425, 535, 635, 735),
    "right_thigh": (755, 535, 965, 735),
    "left_shin_foot": (385, 645, 645, 900),
    "right_shin_foot": (755, 645, 1015, 905),
    "left_knee": (425, 590, 585, 755),
    "right_knee": (815, 590, 975, 755),
    "left_weight": (35, 700, 295, 930),
    "right_weight": (1100, 695, 1385, 935),
}


def keyed_alpha(image: Image.Image) -> Image.Image:
    """Remove the near-white, near-neutral checkerboard with a soft edge."""
    rgba = image.convert("RGBA")
    pixels = []
    for red, green, blue, _ in rgba.getdata():
        low = min(red, green, blue)
        high = max(red, green, blue)
        spread = high - low
        brightness = (red + green + blue) / 3

        # Background squares are 240--255 and essentially neutral. Painted
        # cream armor is warmer and darker, so color spread protects it.
        # The generated checker has two hard levels (roughly 241 and 254).
        # A binary key avoids leaving a low-alpha copy of every square behind.
        # Warm cream paint is protected by its much wider RGB spread.
        alpha = 0 if brightness >= 230.0 and spread <= 16 else 255
        pixels.append((red, green, blue, alpha))
    rgba.putdata(pixels)
    return rgba


def contain(fragment: Image.Image, size: tuple[int, int]) -> Image.Image:
    """Scale a crop into one atlas cell without distorting it."""
    width, height = size
    scale = min(width / fragment.width, height / fragment.height)
    scaled = fragment.resize(
        (max(1, round(fragment.width * scale)), max(1, round(fragment.height * scale))),
        Image.Resampling.LANCZOS,
    )
    return scaled


def main() -> None:
    if len(sys.argv) != 4:
        raise SystemExit(
            "usage: build-rough-atlas.py INPUT CLEAN_REFERENCE ROUGH_ATLAS"
        )

    input_path, clean_path, atlas_path = map(Path, sys.argv[1:])
    clean = keyed_alpha(Image.open(input_path))
    clean.save(clean_path, optimize=True)

    cell = 512
    inset = 24
    atlas = Image.new("RGBA", (cell * 4, cell * 4), (0, 0, 0, 0))
    manifest = {}
    for index, (name, crop_box) in enumerate(PARTS.items()):
        row, column = divmod(index, 4)
        fragment = clean.crop(crop_box)
        fragment = contain(fragment, (cell - inset * 2, cell - inset * 2))
        x = column * cell + (cell - fragment.width) // 2
        y = row * cell + (cell - fragment.height) // 2
        atlas.alpha_composite(fragment, (x, y))
        manifest[name] = {
            "source_crop": list(crop_box),
            "atlas_cell": [column * cell, row * cell, cell, cell],
        }

    atlas.save(atlas_path, optimize=True)
    atlas_path.with_suffix(".json").write_text(
        json.dumps(
            {
                "description": "Rough overlap-preserving crops for the completion pass.",
                "cell_size": cell,
                "parts": manifest,
            },
            indent=2,
        )
        + "\n"
    )


if __name__ == "__main__":
    main()
