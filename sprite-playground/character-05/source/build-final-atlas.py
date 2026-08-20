#!/usr/bin/env python3
"""Finish the generated Character 05 atlas and export transparent part sprites."""

from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image


PART_NAMES = [
    "body",
    "pelvis",
    "left_shoulder",
    "right_shoulder",
    "left_upper_arm",
    "right_upper_arm",
    "left_forearm_fist",
    "right_forearm_fist",
    "left_thigh",
    "right_thigh",
    "left_shin_foot",
    "right_shin_foot",
    "left_knee",
    "right_knee",
    "left_weight",
    "right_weight",
]


def key_checkerboard(image: Image.Image) -> Image.Image:
    """Convert the generated near-white checkerboard to binary alpha."""
    rgba = image.convert("RGBA")
    pixels = []
    for red, green, blue, _ in rgba.getdata():
        spread = max(red, green, blue) - min(red, green, blue)
        brightness = (red + green + blue) / 3
        alpha = 0 if brightness >= 230 and spread <= 16 else 255
        pixels.append((red, green, blue, alpha))
    rgba.putdata(pixels)
    return rgba


def save_small_png(image: Image.Image, path: Path, colors: int = 160) -> None:
    """Palette-quantize without flattening alpha, keeping Git blobs compact."""
    path.parent.mkdir(parents=True, exist_ok=True)
    palette = image.quantize(
        colors=colors,
        method=Image.Quantize.FASTOCTREE,
        dither=Image.Dither.NONE,
    )
    palette.save(path, optimize=True)


def add_padding(image: Image.Image, padding: int = 10) -> Image.Image:
    alpha = image.getchannel("A")
    bounds = alpha.getbbox()
    if not bounds:
        raise ValueError("empty generated cell")
    trimmed = image.crop(bounds)
    result = Image.new(
        "RGBA",
        (trimmed.width + padding * 2, trimmed.height + padding * 2),
        (0, 0, 0, 0),
    )
    result.alpha_composite(trimmed, (padding, padding))
    return result


def main() -> None:
    if len(sys.argv) != 5:
        raise SystemExit(
            "usage: build-final-atlas.py GENERATED_ATLAS CLEAN_REFERENCE "
            "ROUGH_CROPS OUTPUT_DIR"
        )

    atlas_input, clean_input, rough_input, output_dir = map(Path, sys.argv[1:])
    output_dir.mkdir(parents=True, exist_ok=True)
    parts_dir = output_dir / "parts"
    source_dir = output_dir / "source"

    atlas = key_checkerboard(Image.open(atlas_input))
    save_small_png(atlas, output_dir / "character-05-parts-atlas.png", 192)

    width, height = atlas.size
    x_edges = [round(index * width / 4) for index in range(5)]
    y_edges = [round(index * height / 4) for index in range(5)]
    manifest = {}

    for index, name in enumerate(PART_NAMES):
        row, column = divmod(index, 4)
        cell_box = (
            x_edges[column],
            y_edges[row],
            x_edges[column + 1],
            y_edges[row + 1],
        )
        sprite = add_padding(atlas.crop(cell_box))
        sprite_path = parts_dir / f"{name}.png"
        save_small_png(sprite, sprite_path, 192)
        manifest[name] = {
            "file": f"parts/{name}.png",
            "atlas_crop": [
                cell_box[0],
                cell_box[1],
                cell_box[2] - cell_box[0],
                cell_box[3] - cell_box[1],
            ],
            "size": [sprite.width, sprite.height],
        }

    reference = Image.open(clean_input).convert("RGBA")
    reference.thumbnail((1100, 900), Image.Resampling.LANCZOS)
    save_small_png(reference, output_dir / "character-05-reference.png", 192)

    rough = Image.open(rough_input).convert("RGBA")
    rough.thumbnail((1024, 1024), Image.Resampling.LANCZOS)
    save_small_png(rough, source_dir / "character-05-rough-crops.png", 128)

    (output_dir / "character-05-parts-atlas.json").write_text(
        json.dumps(
            {
                "character": "05",
                "generated_atlas_size": [width, height],
                "grid": [4, 4],
                "handedness": (
                    "Names are image-left/image-right in the bind pose; no sprites "
                    "are mirrored at runtime."
                ),
                "parts": manifest,
            },
            indent=2,
        )
        + "\n"
    )


if __name__ == "__main__":
    main()
