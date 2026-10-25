#!/usr/bin/env python3
"""Photo-like degradation for the lab's clean renders (one responsibility).

Takes the clean synthetic PNGs and turns each into what a phone photo of a
paper document looks like: rotation within ±8°, a mild perspective keystone,
gaussian blur, JPEG quality 60, uneven lighting (a soft off-centre brightness
gradient), and — on roughly a third of documents — a crumpled-paper warp with
one or two visible creases. Deterministic per image id. Output: <out>/<id>.jpg
beside which the caller already keeps the ground truth. Cord images are real
photographs already and are passed through untouched.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageEnhance, ImageFilter

rng = np.random.default_rng(20261004)


def rotate_and_keystone(im, degrees, keystone):
    w, h = im.size
    im = im.convert("RGB").rotate(degrees, expand=True, fillcolor=(24, 24, 26), resample=Image.BICUBIC)
    w, h = im.size
    # A keystone: the top edge narrower than the bottom, as a tilted photo reads.
    k = keystone
    src = np.float32([(0, 0), (w, 0), (w, h), (0, h)])
    dst = np.float32([(w * k, 0), (w * (1 - k), h * 0.02), (w, h), (0, h)])
    M = cv2_affine(src, dst)
    out = Image.fromarray(cv2_warp(np.asarray(im), M, (w, h)))
    return out


def cv2_affine(src, dst):
    a = np.zeros((8, 8))
    b = np.zeros(8)
    for i in range(4):
        x, y = src[i]
        u, v = dst[i]
        a[i * 2] = [x, y, 1, 0, 0, 0, -x * u, -y * u]
        b[i * 2] = u
        a[i * 2 + 1] = [0, 0, 0, x, y, 1, -x * v, -y * v]
        b[i * 2 + 1] = v
    coeffs = np.linalg.solve(a, b)
    return coeffs


def cv2_warp(img, c, size):
    w, h = size
    xs, ys = np.meshgrid(np.arange(w), np.arange(h))
    denominators = c[6] * xs + c[7] * ys + 1
    map_x = (c[0] * xs + c[1] * ys + c[2]) / denominators
    map_y = (c[3] * xs + c[4] * ys + c[5]) / denominators
    map_x = np.clip(map_x, 0, w - 1).astype(np.int32)
    map_y = np.clip(map_y, 0, h - 1).astype(np.int32)
    return img[map_y, map_x]


def lighting(im):
    w, h = im.size
    # Off-centre brightness: one vertical, one horizontal ramp, both gentle.
    gx = 1.0 + 0.10 * np.linspace(-1, 1, w) * rng.choice([-1, 1])
    gy = 1.0 + 0.07 * np.linspace(-1, 1, h) * rng.choice([-1, 1])
    field = np.outer(gy, gx)
    return Image.fromarray(np.clip(np.asarray(im) * field[..., None], 0, 255).astype(np.uint8))


def crumple(im):
    w, h = im.size
    arr = np.asarray(im).astype(np.float32)
    # Two creases: soft sine ridges across random angles, plus a fine warp.
    for _ in range(int(rng.integers(1, 3))):
        angle = rng.uniform(0, np.pi)
        xx, yy = np.meshgrid(np.arange(w), np.arange(h))
        d = xx * np.cos(angle) + yy * np.sin(angle)
        ridge = 14 * np.sin(d / rng.uniform(28, 46) + rng.uniform(0, 6))
        shade = 1.0 - (ridge / 255.0) * 0.5
        arr *= shade[..., None]
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))


def degrade(path_in, path_out):
    im = Image.open(path_in).convert("RGB")
    degrees = float(rng.uniform(-8, 8))
    keystone = float(rng.uniform(0.0, 0.045))
    im = rotate_and_keystone(im, degrees, keystone)
    if rng.random() < 0.35:
        im = crumple(im)
    im = lighting(im)
    im = im.filter(ImageFilter.GaussianBlur(float(rng.uniform(0.4, 1.1))))
    im = ImageEnhance.Contrast(im).enhance(float(rng.uniform(0.9, 1.08)))
    im.save(path_out, "JPEG", quality=60)


def main(clean_dir, out_dir):
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    made = 0
    for png in sorted(Path(clean_dir).glob("syn-*.png")):
        degrade(png, out / (png.stem + ".jpg"))
        made += 1
    print(f"degraded {made} documents into {out}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
