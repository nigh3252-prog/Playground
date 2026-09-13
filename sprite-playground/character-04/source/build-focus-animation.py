#!/usr/bin/env python3
"""Build transparent, wrist-aligned Character 04 focus animation strips."""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage


HERE = Path(__file__).resolve().parent
SOURCE = HERE / "character-04-focus-animation-source.png"
PARTS = HERE.parent / "parts"


ANIMATIONS = {
    "right_focus": {
        "centers": [(252, 329), (609, 329), (968, 330), (1312, 331)],
        "grips": [(109, 362), (468, 363), (828, 363), (1180, 364)],
        "target_offset": (216, -52),
        "pivot": (63, 500),
        "frame_size": (536, 840),
    },
    "left_focus": {
        "centers": [(252, 812), (611, 813), (970, 814), (1310, 815)],
        "grips": [(61, 1016), (420, 1016), (772, 1017), (1114, 1017)],
        "target_offset": (375, -155),
        "pivot": (70, 438),
        "frame_size": (780, 640),
    },
}


def frame_region(name: str, index: int, shape: tuple[int, int]) -> np.ndarray:
    """Select one drawing without borrowing pixels from its close neighbors."""
    height, width = shape
    region = np.zeros((height, width), dtype=bool)

    if name == "right_focus":
        bounds = [(60, 430), (430, 790), (790, 1145), (1145, 1515)]
        x0, x1 = bounds[index]
        region[24:570, x0:x1] = True
        return region

    upper_bounds = [(15, 430), (430, 790), (790, 1145), (1145, 1515)]
    handle_bounds = [(15, 220), (380, 620), (720, 970), (1070, 1515)]
    x0, x1 = upper_bounds[index]
    region[600:990, x0:x1] = True
    x0, x1 = handle_bounds[index]
    region[990:1065, x0:x1] = True
    return region


def foreground_alpha(rgb: np.ndarray, region: np.ndarray) -> np.ndarray:
    """Key out black while retaining the painted black outlines around the art."""
    bright = np.max(rgb, axis=2) > 11
    alpha = ndimage.binary_dilation(bright, iterations=2) & region
    labels, _ = ndimage.label(alpha)
    sizes = np.bincount(labels.ravel())
    keep = sizes >= 10
    keep[0] = False
    return (keep[labels] * 255).astype(np.uint8)


def similarity_inverse(
    grip: tuple[float, float],
    center: tuple[float, float],
    pivot: tuple[float, float],
    target_offset: tuple[float, float],
) -> tuple[float, float, float, float, float, float]:
    """Return Pillow's output-to-input affine map for a two-point alignment."""
    source = complex(center[0] - grip[0], center[1] - grip[1])
    target = complex(*target_offset)
    transform = target / source
    a = transform.real
    b = transform.imag
    determinant = a * a + b * b
    inverse_a = a / determinant
    inverse_b = b / determinant

    # src = grip + inverse(transform) * (out - pivot)
    c = grip[0] - inverse_a * pivot[0] - inverse_b * pivot[1]
    f = grip[1] + inverse_b * pivot[0] - inverse_a * pivot[1]
    return (inverse_a, inverse_b, c, -inverse_b, inverse_a, f)


def remove_neighbor_fragments(name: str, frame: Image.Image) -> Image.Image:
    """Drop handle slivers from adjacent bottom-row drawings in the source."""
    if name != "left_focus":
        return frame

    rgba = np.asarray(frame).copy()
    labels, count = ndimage.label(rgba[:, :, 3] > 0)
    for label in range(1, count + 1):
        ys, xs = np.where(labels == label)
        if len(xs) and ys.min() > 540:
            rgba[labels == label] = 0
    return Image.fromarray(rgba, "RGBA")


def build_strip(source: Image.Image, name: str, definition: dict) -> Image.Image:
    rgb = np.asarray(source.convert("RGB"))
    frames: list[Image.Image] = []
    frame_size = tuple(definition["frame_size"])

    for index, (center, grip) in enumerate(zip(definition["centers"], definition["grips"])):
        region = frame_region(name, index, rgb.shape[:2])
        alpha = foreground_alpha(rgb, region)
        rgba = np.dstack((rgb, alpha))
        keyed = Image.fromarray(rgba, "RGBA")
        inverse = similarity_inverse(grip, center, definition["pivot"], definition["target_offset"])
        frame = keyed.transform(
            frame_size,
            Image.Transform.AFFINE,
            inverse,
            resample=Image.Resampling.BICUBIC,
        )
        frames.append(remove_neighbor_fragments(name, frame))

    strip = Image.new("RGBA", (frame_size[0] * len(frames), frame_size[1]), (0, 0, 0, 0))
    for index, frame in enumerate(frames):
        strip.alpha_composite(frame, (index * frame_size[0], 0))
    return strip


def main() -> None:
    source = Image.open(SOURCE)
    if source.size != (1536, 1152):
        raise ValueError(f"Expected a 1536x1152 source sheet, received {source.size}")

    PARTS.mkdir(parents=True, exist_ok=True)
    for name, definition in ANIMATIONS.items():
        strip = build_strip(source, name, definition)
        paletted = strip.quantize(
            colors=256,
            method=Image.Quantize.FASTOCTREE,
            dither=Image.Dither.NONE,
        )
        paletted.convert("RGBA").save(
            PARTS / f"{name}-frames.png",
            optimize=True,
            compress_level=9,
        )


if __name__ == "__main__":
    main()
