#!/usr/bin/env python3
# Lab-only labelling aid: draws a pixel grid on a screenshot so the ground-truth
# bbox can be read off in native pixels. Also draws an optional candidate box.
# usage: label-grid.py <in.png> <out.png> <step_px> [x0 y0 x1 y1]
import sys
from PIL import Image, ImageDraw

src, dst, step = sys.argv[1], sys.argv[2], int(sys.argv[3])
img = Image.open(src).convert("RGB")
draw = ImageDraw.Draw(img)
w, h = img.size
for x in range(0, w, step):
    draw.line([(x, 0), (x, h)], fill=(255, 0, 255), width=1)
    draw.text((x + 2, 2), str(x), fill=(255, 0, 255))
for y in range(0, h, step):
    draw.line([(0, y), (w, y)], fill=(0, 200, 255), width=1)
    draw.text((2, y + 2), str(y), fill=(0, 200, 255))
if len(sys.argv) >= 8:
    box = [int(v) for v in sys.argv[4:8]]
    draw.rectangle(box, outline=(255, 0, 0), width=3)
img.save(dst)
print(f"OK {dst} {w}x{h}")
