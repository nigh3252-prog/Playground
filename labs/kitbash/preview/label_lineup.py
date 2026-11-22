"""Add exact names and metric captions to the unchanged Blender lineup render."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import sys

HERE = Path(__file__).resolve().parent
image = Image.open(HERE / 'warden-boss-lineup.png').convert('RGB')
draw = ImageDraw.Draw(image)
fonts = Path('/usr/share/fonts/truetype/dejavu')


def font(size, bold=False):
    return ImageFont.truetype(str(fonts / ('DejaVuSans-Bold.ttf' if bold else 'DejaVuSans.ttf')), size)


def centered(text, x, y, size, fill, bold=False):
    f = font(size, bold)
    width = draw.textbbox((0, 0), text, font=f)[2]
    draw.text((x-width/2, y), text, font=f, fill=fill)


draw.text((65, 42), 'WARDEN  /  KITBASH STUDY 01', font=font(21, True), fill='#b9ccc5')
draw.text((62, 86), 'Three machines at 12 meters', font=font(49), fill='#f2f3e7')
draw.text((65, 156), 'Actual model render · one shared meter scale · neutral poses', font=font(23), fill='#c4d0c8')
labels = [
    (141, 'WARDEN', '4 m', 'Scale reference'),
    (667, 'BELLOWS', '12 m', 'Pressure beast'),
    (1557, 'BROOD LOOM', '12 m', 'Widow carrier'),
    (2300, 'SHUTTER WRAITH', '12 m', 'Floating reliquary'),
]
for x, name, height, role in labels:
    centered(name, x, 914, 24 if name == 'WARDEN' else 31, '#253d38', True)
    centered(height, x, 954, 34 if name == 'WARDEN' else 42, '#305b4e')
    centered(role, x, 1009, 19, '#50635d')
draw.line((65, 1062, 2535, 1062), fill='#768a81', width=1)
draw.text((65, 1083), '12 m ≈ 60% of Dreadmaw’s neutral body height (20.15 m), excluding its tall launcher pods.', font=font(22), fill='#354f44')
destination = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else HERE / 'warden-kitbash-lineup.png'
destination.parent.mkdir(parents=True, exist_ok=True)
image.save(destination, optimize=True)
print(destination)
