#!/usr/bin/env python3
"""Build side-faithful Character 05 shoulder/upper-arm sprites.

Each side comes from its own image-generation result, prompted from a separate
crop of the original concept. The published shoulder stays intact from its
torso-mount ring through its elbow socket, eliminating a false mid-arm seam.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image


PART_ORDER = [
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

# Raw imagegen pixels. Names use viewer/image side, matching the rig.
EXTRACTIONS = {
    "left_shoulder": (250, 55, 955, 905),
    "right_shoulder": (165, 55, 1060, 880),
}


def key_checkerboard(image: Image.Image) -> Image.Image:
    rgba = image.convert("RGBA")
    pixels = []
    for red, green, blue, _ in rgba.getdata():
        spread = max(red, green, blue) - min(red, green, blue)
        brightness = (red + green + blue) / 3
        alpha = 0 if brightness >= 230 and spread <= 16 else 255
        pixels.append((red, green, blue, alpha))
    rgba.putdata(pixels)
    return rgba


def trim_with_padding(image: Image.Image, padding: int = 14) -> Image.Image:
    bounds = image.getchannel("A").getbbox()
    if not bounds:
        raise ValueError("empty shoulder extraction")
    trimmed = image.crop(bounds)
    result = Image.new(
        "RGBA",
        (trimmed.width + padding * 2, trimmed.height + padding * 2),
        (0, 0, 0, 0),
    )
    result.alpha_composite(trimmed, (padding, padding))
    return result


def save_compact(image: Image.Image, path: Path, colors: int = 192) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    palette = image.quantize(
        colors=colors,
        method=Image.Quantize.FASTOCTREE,
        dither=Image.Dither.NONE,
    )
    palette.save(path, optimize=True)


def fit(image: Image.Image, width: int, height: int) -> Image.Image:
    scale = min(width / image.width, height / image.height, 1)
    if scale == 1:
        return image.copy()
    return image.resize(
        (max(1, round(image.width * scale)), max(1, round(image.height * scale))),
        Image.Resampling.LANCZOS,
    )


def rebuild_atlas(output_dir: Path) -> None:
    cell = 384
    inset = 12
    atlas = Image.new("RGBA", (cell * 4, cell * 4), (0, 0, 0, 0))
    manifest = {}

    for index, name in enumerate(PART_ORDER):
        row, column = divmod(index, 4)
        source = Image.open(output_dir / "parts" / f"{name}.png").convert("RGBA")
        sprite = fit(source, cell - inset * 2, cell - inset * 2)
        x = column * cell + (cell - sprite.width) // 2
        y = row * cell + (cell - sprite.height) // 2
        atlas.alpha_composite(sprite, (x, y))
        manifest[name] = {
            "file": f"parts/{name}.png",
            "atlas_crop": [column * cell, row * cell, cell, cell],
            "size": [source.width, source.height],
        }

    save_compact(atlas, output_dir / "character-05-parts-atlas.png", 192)
    (output_dir / "character-05-parts-atlas.json").write_text(
        json.dumps(
            {
                "character": "05",
                "generated_atlas_size": [cell * 4, cell * 4],
                "grid": [4, 4],
                "handedness": (
                    "Names are viewer/image-left and viewer/image-right in the bind "
                    "pose. Shoulder and upper-arm sprites are independently generated "
                    "from their same-side original-concept crops; no runtime mirroring."
                ),
                "parts": manifest,
            },
            indent=2,
        )
        + "\n"
    )


def main() -> None:
    if len(sys.argv) != 6:
        raise SystemExit(
            "usage: build-shoulders-v2.py LEFT_GENERATED RIGHT_GENERATED "
            "LEFT_CONTEXT RIGHT_CONTEXT OUTPUT_DIR"
        )

    left_generated, right_generated, left_context, right_context, output_dir = map(
        Path, sys.argv[1:]
    )
    output_dir.mkdir(parents=True, exist_ok=True)
    source_dir = output_dir / "source"

    generated = {
        "left": key_checkerboard(Image.open(left_generated)),
        "right": key_checkerboard(Image.open(right_generated)),
    }
    for name, crop in EXTRACTIONS.items():
        side = name.split("_", 1)[0]
        sprite = trim_with_padding(generated[side].crop(crop))
        save_compact(sprite, output_dir / "parts" / f"{name}.png")

    for side, context_path in (
        ("left", left_context),
        ("right", right_context),
    ):
        context = Image.open(context_path).convert("RGBA")
        save_compact(
            context,
            source_dir / f"character-05-viewer-{side}-shoulder-context.png",
            160,
        )

    rebuild_atlas(output_dir)


if __name__ == "__main__":
    main()
