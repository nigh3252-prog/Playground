#!/usr/bin/env python3
"""Build the concept-faithful Character 05 proportion pass.

The torso and each leg side come from separate image-generation requests that
were grounded in tight crops of the original lineup.  This script removes the
generated checkerboard, exports independent thigh/shin/boot pieces, derives
rigid shoulder caps from the already-corrected side-specific shoulder art, and
repacks the active runtime atlas.
"""

from __future__ import annotations

import json
import sys
from collections import deque
from pathlib import Path

from PIL import Image


PART_ORDER = [
    "body",
    "pelvis",
    "left_shoulder_cap",
    "right_shoulder_cap",
    "left_upper_arm",
    "right_upper_arm",
    "left_forearm_fist",
    "right_forearm_fist",
    "left_thigh",
    "right_thigh",
    "left_shin",
    "right_shin",
    "left_boot",
    "right_boot",
    "left_knee",
    "right_knee",
    "left_weight",
    "right_weight",
]


def checkerboard_to_alpha(image: Image.Image) -> Image.Image:
    """Remove only near-white neutral pixels connected to an image edge.

    Limiting the key to edge-connected pixels protects the cream torso paint
    and bright metal highlights inside the silhouette.
    """

    rgba = image.convert("RGBA")
    width, height = rgba.size
    pixels = rgba.load()
    visited = bytearray(width * height)
    queue: deque[tuple[int, int]] = deque()

    def background_like(x: int, y: int) -> bool:
        red, green, blue, _ = pixels[x, y]
        return min(red, green, blue) >= 226 and max(red, green, blue) - min(red, green, blue) <= 18

    def enqueue(x: int, y: int) -> None:
        index = y * width + x
        if visited[index] or not background_like(x, y):
            return
        visited[index] = 1
        queue.append((x, y))

    for x in range(width):
        enqueue(x, 0)
        enqueue(x, height - 1)
    for y in range(height):
        enqueue(0, y)
        enqueue(width - 1, y)

    while queue:
        x, y = queue.popleft()
        pixels[x, y] = (*pixels[x, y][:3], 0)
        if x:
            enqueue(x - 1, y)
        if x + 1 < width:
            enqueue(x + 1, y)
        if y:
            enqueue(x, y - 1)
        if y + 1 < height:
            enqueue(x, y + 1)

    return rgba


def trim(image: Image.Image, padding: int = 14) -> Image.Image:
    bounds = image.getchannel("A").getbbox()
    if not bounds:
        raise ValueError("empty generated sprite")
    cropped = image.crop(bounds)
    result = Image.new(
        "RGBA",
        (cropped.width + padding * 2, cropped.height + padding * 2),
        (0, 0, 0, 0),
    )
    result.alpha_composite(cropped, (padding, padding))
    return result


def fit(image: Image.Image, max_width: int, max_height: int) -> Image.Image:
    scale = min(max_width / image.width, max_height / image.height, 1)
    if scale >= 1:
        return image.copy()
    return image.resize(
        (max(1, round(image.width * scale)), max(1, round(image.height * scale))),
        Image.Resampling.LANCZOS,
    )


def save_compact(image: Image.Image, path: Path, colors: int = 192) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    palette = image.quantize(
        colors=colors,
        method=Image.Quantize.FASTOCTREE,
        dither=Image.Dither.NONE,
    )
    palette.save(path, optimize=True)


def export_region(
    source: Image.Image,
    box: tuple[int, int, int, int],
    output: Path,
    max_size: tuple[int, int],
) -> None:
    sprite = trim(source.crop(box))
    save_compact(fit(sprite, *max_size), output)


def export_shoulder_cap(source_path: Path, output: Path, cutoff: int) -> None:
    source = Image.open(source_path).convert("RGBA")
    cap = source.crop((0, 0, source.width, min(cutoff, source.height)))
    save_compact(trim(cap), output)


def clean_pelvis(source_path: Path) -> None:
    """Discard the detached shoulder sliver left by the original 4x4 atlas."""
    source = Image.open(source_path).convert("RGBA")
    cropped = source.crop((45, 0, source.width, source.height))
    save_compact(trim(cropped), source_path)


def rebuild_atlas(output_dir: Path) -> None:
    columns = 5
    rows = 4
    cell = 320
    inset = 12
    atlas = Image.new("RGBA", (cell * columns, cell * rows), (0, 0, 0, 0))
    manifest: dict[str, dict[str, object]] = {}

    for index, name in enumerate(PART_ORDER):
        row, column = divmod(index, columns)
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
                "generated_atlas_size": [cell * columns, cell * rows],
                "grid": [columns, rows],
                "handedness": (
                    "Names are viewer/image-left and viewer/image-right. Torso and "
                    "both leg sets were generated independently from original-concept "
                    "crops; no side is mirrored at runtime."
                ),
                "parts": manifest,
            },
            indent=2,
        )
        + "\n"
    )


def main() -> None:
    if len(sys.argv) != 11:
        raise SystemExit(
            "usage: build-proportions-v3.py BODY_GENERATED LEFT_LEG_SHEET "
            "RIGHT_LEG_SHEET RIGHT_SHIN_GENERATED LEFT_THIGH_GENERATED "
            "RIGHT_THIGH_GENERATED BODY_CONTEXT LEFT_CONTEXT RIGHT_CONTEXT "
            "OUTPUT_DIR"
        )

    (
        body_path,
        left_sheet_path,
        right_sheet_path,
        right_shin_path,
        left_thigh_path,
        right_thigh_path,
        body_context_path,
        left_context_path,
        right_context_path,
        output_dir_path,
    ) = map(Path, sys.argv[1:])
    output_dir = output_dir_path
    parts_dir = output_dir / "parts"
    source_dir = output_dir / "source"

    body = checkerboard_to_alpha(Image.open(body_path))
    left_sheet = checkerboard_to_alpha(Image.open(left_sheet_path))
    right_sheet = checkerboard_to_alpha(Image.open(right_sheet_path))
    right_shin = checkerboard_to_alpha(Image.open(right_shin_path))
    left_thigh = checkerboard_to_alpha(Image.open(left_thigh_path))
    right_thigh = checkerboard_to_alpha(Image.open(right_thigh_path))

    save_compact(fit(trim(body), 760, 560), parts_dir / "body.png", 224)

    left_width, left_height = left_sheet.size
    right_width, right_height = right_sheet.size
    save_compact(fit(trim(left_thigh), 370, 390), parts_dir / "left_thigh.png")
    save_compact(fit(trim(right_thigh), 400, 390), parts_dir / "right_thigh.png")
    export_region(
        left_sheet,
        (0, round(left_height * 0.37), left_width, round(left_height * 0.66)),
        parts_dir / "left_shin.png",
        (350, 500),
    )
    save_compact(fit(trim(right_shin), 370, 520), parts_dir / "right_shin.png")
    export_region(
        left_sheet,
        (0, round(left_height * 0.75), left_width, left_height),
        parts_dir / "left_boot.png",
        (390, 260),
    )
    export_region(
        right_sheet,
        (0, round(right_height * 0.72), right_width, right_height),
        parts_dir / "right_boot.png",
        (410, 270),
    )

    export_shoulder_cap(
        parts_dir / "left_shoulder.png",
        parts_dir / "left_shoulder_cap.png",
        665,
    )
    export_shoulder_cap(
        parts_dir / "right_shoulder.png",
        parts_dir / "right_shoulder_cap.png",
        670,
    )
    clean_pelvis(parts_dir / "pelvis.png")

    for name, context_path in (
        ("character-05-body-context-v3.png", body_context_path),
        ("character-05-viewer-left-leg-context-v3.png", left_context_path),
        ("character-05-viewer-right-leg-context-v3.png", right_context_path),
    ):
        context = Image.open(context_path).convert("RGBA")
        save_compact(context, source_dir / name, 160)

    rebuild_atlas(output_dir)


if __name__ == "__main__":
    main()
