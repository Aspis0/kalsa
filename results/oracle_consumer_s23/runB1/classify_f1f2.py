#!/usr/bin/env python3
"""Row-resolved classification of Session B f1 (OpenCL) vs f2 (CPU) dumps."""
from pathlib import Path
import re
import math
import statistics

p = Path(__file__).with_name("runB1.log")
lines = p.read_text(encoding="utf-8", errors="replace").splitlines()

name_re = re.compile(r"MUL_MAT_ID\(([^)]+)\)")
dump_re = re.compile(
    r"ERR = ([0-9.]+) > .*DUMP ne=\[(\d+),(\d+),(\d+),(\d+)\] "
    r"nb=\[(\d+),(\d+),(\d+),(\d+)\] n=(\d+)"
)
row_re = re.compile(
    r"^\s*(\d+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+), diff =\s+([-+0-9.eE]+)"
)

cases = []
i = 0
while i < len(lines):
    md = dump_re.search(lines[i])
    if md:
        err = float(md.group(1))
        ne = tuple(int(md.group(k)) for k in range(2, 6))
        f1, f2, diff = [], [], []
        i += 1
        while i < len(lines):
            mr = row_re.match(lines[i])
            if not mr:
                break
            f1.append(float(mr.group(2)))
            f2.append(float(mr.group(3)))
            diff.append(float(mr.group(4)))
            i += 1
        # harness prints the case name AFTER the dump, on the FAIL line
        name = None
        j = i
        while j < len(lines) and j < i + 8:
            mname = name_re.search(lines[j])
            if mname and "type_a=" in lines[j]:
                name = mname.group(0)
                break
            j += 1
        cases.append(
            dict(name=name, err=err, ne=ne, f1=f1, f2=f2, diff=diff)
        )
        continue
    i += 1


def nmse(a, b):
    num = sum((x - y) ** 2 for x, y in zip(a, b))
    den = sum(x * x for x in a)
    return num / den if den else float("inf")


def cosine(a, b):
    num = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return num / (na * nb) if na and nb else 0.0


def corr(a, b):
    n = len(a)
    ma = sum(a) / n
    mb = sum(b) / n
    num = sum((x - ma) * (y - mb) for x, y in zip(a, b))
    da = math.sqrt(sum((x - ma) ** 2 for x in a))
    db = math.sqrt(sum((y - mb) ** 2 for y in b))
    return num / (da * db) if da and db else 0.0


def mae(d):
    return sum(abs(x) for x in d) / len(d)


out_lines = []


def emit(s=""):
    print(s)
    out_lines.append(s)


emit("=== SESSION B row-resolved classification (f1=OpenCL, f2=CPU) ===")
emit("Proxy: Branch C DST_READBACK 12/12 (1,1) => f1 == GPU dst == semantic want_sem")
emit("So f2 vs f1 is f2 vs semantic under that proxy.")
emit(f"parsed {len(cases)} dumps")
emit()

QK = 32  # q4_0 block
for ci, c in enumerate(cases):
    f1, f2, d = c["f1"], c["f2"], c["diff"]
    ne0 = c["ne"][0]
    nrows = len(f1) // ne0
    emit(f"--- case{ci} {c['name']}")
    emit(
        f"    ERR={c['err']:.9f} ne={c['ne']} n={len(f1)} "
        f"nrows={nrows} (row=ne0={ne0})"
    )
    emit(
        f"    nmse(f1,f2)={nmse(f1, f2):.6f}  cosine={cosine(f1, f2):.4f}  "
        f"corr={corr(f1, f2):.4f}"
    )
    emit(
        f"    mae={mae(d):.4f}  max|diff|={max(abs(x) for x in d):.4f}  "
        f"mean_f1={sum(f1)/len(f1):.4f} mean_f2={sum(f2)/len(f2):.4f}"
    )
    same_sign = sum(
        1 for x, y in zip(f1, f2) if (x == 0 and y == 0) or x * y > 0
    )
    emit(f"    same_sign={same_sign}/{len(f1)} ({100 * same_sign / len(f1):.1f}%)")

    row_nmse, row_cos, row_mae = [], [], []
    for r in range(nrows):
        a = f1[r * ne0 : (r + 1) * ne0]
        b = f2[r * ne0 : (r + 1) * ne0]
        dd = d[r * ne0 : (r + 1) * ne0]
        row_nmse.append(nmse(a, b))
        row_cos.append(cosine(a, b))
        row_mae.append(mae(dd))
    emit(
        f"    per-row nmse: min={min(row_nmse):.4f} med={statistics.median(row_nmse):.4f} "
        f"max={max(row_nmse):.4f}"
    )
    emit(
        f"    per-row cos : min={min(row_cos):.4f} med={statistics.median(row_cos):.4f} "
        f"max={max(row_cos):.4f}"
    )
    n_good = sum(1 for x in row_nmse if x < 5e-4)
    n_bad = sum(1 for x in row_nmse if x > 0.05)
    emit(
        f"    rows nmse<5e-4 (PASS-class)={n_good}/{nrows}  "
        f"rows nmse>0.05={n_bad}/{nrows}"
    )

    nblk = ne0 // QK
    blk_mae = [[] for _ in range(nblk)]
    for r in range(nrows):
        for b in range(nblk):
            sl = d[r * ne0 + b * QK : r * ne0 + (b + 1) * QK]
            blk_mae[b].append(mae(sl))
    blk_mean = [statistics.mean(x) for x in blk_mae]
    mu = statistics.mean(blk_mean)
    sd = statistics.pstdev(blk_mean)
    cv = sd / mu if mu else 0
    emit(
        f"    block32 mae along ne0: min={min(blk_mean):.4f} max={max(blk_mean):.4f} "
        f"cv={cv:.3f} (cv~0 => uniform)"
    )

    mod32 = [0.0] * QK
    cnt = [0] * QK
    for idx, val in enumerate(d):
        pos = idx % ne0
        mod32[pos % QK] += abs(val)
        cnt[pos % QK] += 1
    m32 = [mod32[k] / cnt[k] for k in range(QK)]
    cv32 = statistics.pstdev(m32) / statistics.mean(m32)
    emit(
        f"    |diff| by offset%32: [0]={m32[0]:.4f} [1]={m32[1]:.4f} "
        f"[15]={m32[15]:.4f} [16]={m32[16]:.4f} [31]={m32[31]:.4f}  cv={cv32:.3f}"
    )

    if nrows > 1:
        best_roll = 0
        best_c = -2.0
        for roll in range(nrows):
            rolled = f1[roll * ne0 :] + f1[: roll * ne0]
            cs = cosine(rolled, f2)
            if cs > best_c:
                best_c = cs
                best_roll = roll
        emit(
            f"    best row-roll of f1 vs f2: roll={best_roll} cosine={best_c:.4f}"
        )

    best_b = 0
    best_bc = -2.0
    a0 = f1[:ne0]
    b0 = f2[:ne0]
    for sh in range(0, ne0, QK):
        rolled = a0[sh:] + a0[:sh]
        cs = cosine(rolled, b0)
        if cs > best_bc:
            best_bc = cs
            best_b = sh
    emit(
        f"    best block-roll of row0 f1 vs f2: shift={best_b} cosine={best_bc:.4f}"
    )

    denom = sum(x * x for x in f1)
    s = sum(x * y for x, y in zip(f1, f2)) / denom if denom else 0.0
    emit(
        f"    best scale s s.t. f2~s*f1: s={s:.4f}  "
        f"nmse_after={nmse([s * x for x in f1], f2):.6f}"
    )

    tags = []
    if n_good == 0 and min(row_nmse) > 0.05:
        tags.append("ALL_ROWS_BAD")
    elif n_good and n_bad:
        tags.append("MIXED_ROWS")
    elif n_good == nrows:
        tags.append("ALL_ROWS_OK")
    if cv < 0.15 and cv32 < 0.15:
        tags.append("UNIFORM")
    else:
        tags.append("STRUCTURED")
        mean32 = statistics.mean(m32)
        if m32[0] > 2 * mean32 or m32[31] > 2 * mean32:
            tags.append("BOUNDARY_SPIKE")
    cs = cosine(f1, f2)
    if abs(s) < 0.2 and cs < 0.2:
        tags.append("UNCORRELATED")
    elif cs < 0.5:
        tags.append("WEAK_CORR")
    else:
        tags.append("ALIGNED_SHAPE")
    emit(f"    CLASS {'+'.join(tags)}")
    emit()

outp = Path(__file__).with_name("CLASSIFY.txt")
outp.write_text("\n".join(out_lines) + "\n", encoding="utf-8")
print("WROTE", outp)
