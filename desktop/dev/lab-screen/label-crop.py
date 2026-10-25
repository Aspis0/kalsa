#!/usr/bin/env python3
# Lab-only labelling aid: a zoomed crop of a screenshot with native-pixel ticks,
# so a ground-truth bbox can be checked against the real edges.
# usage: label-crop.py <in.png> <out.png> <x0> <y0> <x1> <y1> <scale> <tick_px>
import sys
from PIL import Image, ImageDraw

src, dst = sys.argv[1], sys.argv[2]
x0, y0, x1, y1, scale, tick = (int(v) for v in sys.argv[3:9])
img = Image.open(src).convert("RGB").crop((x0, y0, x1, y1))
img = img.resize((img.width * scale, img.height * scale), Image.NEAREST)
draw = ImageDraw.Draw(img)
for x in range((x0 // tick + 1) * tick, x1, tick):
    px = (x - x0) * scale
    draw.line([(px, 0), (px, 8)], fill=(255, 0, 255), width=1)
    draw.text((px + 2, 10), str(x), fill=(255, 0, 255))
for y in range((y0 // tick + 1) * tick, y1, tick):
    py = (y - y0) * scale
    draw.line([(0, py), (8, py)], fill=(0, 200, 255), width=1)
    draw.text((10, py + 2), str(y), fill=(0, 200, 255))
img.save(dst)
print(f"OK {dst} native {x0},{y0}-{x1},{y1} x{scale}")
