#!/usr/bin/env python3
"""Host-side parse of one qdc-8elite-hopping-heat session (PREREG A and B).

Usage: analyze.py <device-out dir>
Writes <dir>/../units.tsv (A), <dir>/../decode.tsv (B) and prints the report
tables in markdown.
"""
import bisect
import re
import statistics
import sys
from pathlib import Path

TAIL_S = 60
STOP_WORDS = ("CDSP0 CRASHED", "dspqueue_read failed", "dspqueue_write failed",
              "ggml_abort", "GGML_ASSERT", "Segmentation")
FAMILIES = {"cpu": ("cpu",), "gpu": ("gpuss",), "nsp": ("nsp",)}


def read_markers(path):
    ev = []
    for line in path.read_text().splitlines():
        p = line.split()
        if len(p) >= 3:
            ev.append((p[0], p[1], p[2:-1], int(p[-1])))
    return ev


class Series:
    """Time series with 'last sample at or before t' and 'first at or after t'."""

    def __init__(self, pts):
        self.pts = sorted(pts)
        self.t = [t for t, _ in self.pts]

    def at_or_before(self, t):
        i = bisect.bisect_right(self.t, t) - 1
        return self.pts[i][1] if i >= 0 else None

    def at_or_after(self, t):
        i = bisect.bisect_left(self.t, t)
        return self.pts[i][1] if i < len(self.pts) else None

    def window(self, t0, t1):
        return [(t, v) for t, v in self.pts if t0 <= t <= t1]


def read_samples(path):
    skin, status, kills = [], [], []
    fam = {k: [] for k in FAMILIES}
    inventory = []
    for line in path.read_text(errors="replace").splitlines():
        p = line.split()
        if not p:
            continue
        if p[0] == "S" and len(p) >= 3 and re.fullmatch(r"[\d.]+", p[2]):
            skin.append((int(p[1]), float(p[2])))
            if len(p) >= 4 and p[3].isdigit():
                status.append((int(p[1]), int(p[3])))
        elif p[0] == "Z":
            t = int(p[1])
            vals = {}
            for kv in p[2:]:
                name, _, v = kv.partition("=")
                if v.lstrip("-").isdigit():
                    vals[name] = int(v) / 1000.0
            for f, prefixes in FAMILIES.items():
                v = [x for n, x in vals.items() if n.startswith(prefixes)]
                if v:
                    fam[f].append((t, max(v)))
        elif p[0] == "K":
            kills.append(int(p[1]))
        elif p[0] == "I":
            inventory.append(" ".join(p[1:]))
    return Series(skin), Series(status), {f: Series(v) for f, v in fam.items()}, kills, inventory


def area_above(series, t0, t1, base):
    pts = [(t0, base)] + [(t, v) for t, v in series.window(t0, t1) if t > t0]
    a = 0.0
    for (ta, va), (tb, vb) in zip(pts, pts[1:]):
        a += (tb - ta) * (max(0.0, va - base) + max(0.0, vb - base)) / 2
    return a


def peak(series, t0, t1):
    v = [x for _, x in series.window(t0, t1)]
    return max(v) if v else None


def prefill(text):
    m = re.search(r"prompt eval time =\s+([\d.]+) ms /\s+(\d+) tokens.*?([\d.]+) tokens per second", text)
    return (float(m.group(1)), int(m.group(2)), float(m.group(3))) if m else (None, None, None)


def bufs(text):
    return set(re.findall(r"(\S+) model buffer size", text))


def qcom(text):
    return "selected platform: 'QUALCOMM" in text or "OpenCL 3.0 QUALCOMM" in text


def proof_ok(backend, text):
    b = bufs(text)
    if backend == "cpu":
        return bool(b) and b <= {"CPU", "CPU_REPACK"}
    if backend == "gpu":
        return qcom(text) and "OpenCL" in b
    return "HTP0" in b


def fmt(v, nd=1):
    return "NA" if v is None else (f"{v:.{nd}f}" if isinstance(v, float) else str(v))


def med(vals):
    v = [x for x in vals if x is not None]
    return statistics.median(v) if v else None


def part_a(out, ev, skin, fam, kills):
    blocks, units = {}, []
    for kind, tag, rest, t in ev:
        if kind == "B_START":
            blocks.setdefault(tag, {})["start"] = t
        elif kind == "T_END" and tag.startswith("A-"):
            blocks.setdefault(tag, {})["tail_end"] = t
        elif kind == "B_END":
            blocks.setdefault(tag, {})["end"] = t
        elif kind == "V" and tag.startswith("A-"):
            blocks.setdefault(tag, {})["void"] = rest[0]
        elif kind == "U_START":
            units.append({"u": tag, "start": t})
        elif kind == "U_END":
            u = next(x for x in units if x["u"] == tag)
            u["end"], u["rc"] = t, rest[0].split("=")[1]
    rows = []
    for u in units:
        blk = u["u"].rsplit("-u", 1)[0]
        b = blk.split("-")[1]
        bs = blocks[blk]["start"]
        text = (out / f"{u['u']}.log").read_text(errors="replace")
        ms, n, tps = prefill(text)
        base = {"skin": skin.at_or_before(bs), **{f: fam[f].at_or_before(bs) for f in fam}}
        r = {"unit": u["u"], "block": blk, "k": int(u["u"].rsplit("u", 1)[1]), "rc": u.get("rc"),
             "start": u["start"], "end": u.get("end", u["start"]),
             "wall_s": u.get("end", u["start"]) - u["start"], "prefill_ms": ms, "prompt_n": n, "prefill_tps": tps}
        for name, s in (("skin", skin), *fam.items()):
            v0, v1 = s.at_or_before(u["start"]), s.at_or_after(u.get("end", u["start"]))
            r[f"{name}_start"], r[f"{name}_end"] = v0, v1
            r[f"{name}_rise_end"] = (v1 - base[name]) if (v1 is not None and base[name] is not None) else None
        hits = [w for w in STOP_WORDS if w in text]
        if r["rc"] != "0":
            r["status"] = f"VOID rc={r['rc']}"
        elif any(u["start"] <= k <= u.get("end", u["start"]) + 1 for k in kills):
            r["status"] = "VOID watchdog"
        elif hits:
            r["status"] = "VOID stop:" + hits[0]
        elif not proof_ok(b, text):
            r["status"] = "VOID proof bufs=" + ",".join(sorted(bufs(text)))
        else:
            r["status"] = "OK"
        rows.append(r)
    return blocks, rows


def crossover(rows):
    npu = {r["k"]: r["skin_rise_end"] for r in rows if r["block"] == "A-npu" and r["status"] == "OK"}
    gpu = {r["k"]: r["skin_rise_end"] for r in rows if r["block"] == "A-gpu" and r["status"] == "OK"}
    for k in range(1, 12):
        pair = [(npu.get(j), gpu.get(j)) for j in (k, k + 1)]
        if all(a is not None and b is not None and a > b for a, b in pair):
            return k
    return None


def part_b(out, ev, skin, status, fam, kills):
    arms, order = {}, []
    for kind, tag, rest, t in ev:
        if not tag.startswith("B") or tag.startswith("B-"):
            continue
        a = arms.setdefault(tag, {"tag": tag})
        if kind == "C":
            a["cool"] = " ".join(rest)
        elif kind == "A_START":
            a["start"] = t
            order.append(tag)
        elif kind == "A_END":
            a["end"], a["rc"] = t, rest[0].split("=")[1]
        elif kind == "V":
            a["void"] = rest[0]
    rows = []
    for tag in arms:
        a = arms[tag]
        b = tag.split("-")[1]
        r = {"tag": tag, "backend": b, "pos": ((int(tag[1:].split("-")[0]) - 1) % 3) + 1}
        if "start" not in a or "end" not in a:
            r["status"] = "VOID " + a.get("void", "not_run")
            rows.append(r)
            continue
        text = (out / f"{tag}.log").read_text(errors="replace")
        m = re.search(r"\|\s*tg256\s*\|\s*([\d.]+)\s*±", text)
        r["tps"] = float(m.group(1)) if m else None
        t0, t1 = a["start"], a["end"] + TAIL_S
        s0 = skin.at_or_before(t0)
        r["dur_s"] = a["end"] - a["start"]
        r["skin_start"], r["skin_peak"], r["skin_end"] = s0, peak(skin, t0, t1), skin.at_or_before(t1)
        r["area"] = area_above(skin, t0, t1, s0) if s0 is not None else None
        r["per_tok"] = r["area"] / 256 if r["area"] is not None else None
        r["status_peak"] = peak(status, t0, t1)
        for f in fam:
            r[f"{f}_peak"] = peak(fam[f], t0, a["end"])
        hits = [w for w in STOP_WORDS if w in text]
        if a.get("rc") != "0" or r["tps"] is None:
            r["status"] = f"VOID rc={a.get('rc')}"
        elif any(t0 <= k <= t1 for k in kills):
            r["status"] = "VOID watchdog"
        elif hits:
            r["status"] = "VOID stop:" + hits[0]
        elif not proof_ok(b.replace("-nkvo", ""), text):
            r["status"] = "VOID proof bufs=" + ",".join(sorted(bufs(text)))
        else:
            r["status"] = "OK"
        rows.append(r)
    return rows


def write_tsv(path, rows, cols):
    lines = ["\t".join(cols)] + ["\t".join(fmt(r.get(c), 2) for c in cols) for r in rows]
    path.write_text("\n".join(lines) + "\n")


def main(out):
    ev = read_markers(out / "markers.txt")
    skin, status, fam, kills, inventory = read_samples(out / "samples.txt")
    blocks, units = part_a(out, ev, skin, fam, kills)
    ucols = ["unit", "status", "rc", "wall_s", "prompt_n", "prefill_ms", "prefill_tps"] + \
        [f"{n}_{s}" for n in ("skin", "cpu", "gpu", "nsp") for s in ("start", "end", "rise_end")]
    write_tsv(out.parent / "units.tsv", units, ucols)
    dec = part_b(out, ev, skin, status, fam, kills)
    dcols = ["tag", "backend", "pos", "status", "tps", "dur_s", "skin_start", "skin_peak", "skin_end",
             "area", "per_tok", "status_peak", "cpu_peak", "gpu_peak", "nsp_peak"]
    write_tsv(out.parent / "decode.tsv", dec, dcols)

    print(f"zones inventoried: {len(inventory)}; unreadable: "
          f"{sum('UNREADABLE' in i for i in inventory)}; watchdog kills: {len(kills)}\n")
    print("## A. Blocks\n")
    print("| block | units OK | start skin | end-of-block skin rise | peak skin (block+tail) | skin area block+tail °C·s | area per prefill | median prefill ms | first/last prefill ms | NSP start→end | GPU start→end | CPU start→end |")
    print("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|")
    for blk in ("A-cpu", "A-npu", "A-gpu"):
        info = blocks.get(blk, {})
        us = [u for u in units if u["block"] == blk]
        ok = [u for u in us if u["status"] == "OK"]
        if "start" not in info or not us:
            print(f"| {blk} | VOID {info.get('void', 'not_run')} |" + " |" * 11)
            continue
        bs, be, te = info["start"], info.get("end", us[-1]["end"]), info.get("tail_end", info.get("end", 0) + TAIL_S)
        s0 = skin.at_or_before(bs)
        a = area_above(skin, bs, te, s0)
        fams = []
        for f in ("nsp", "gpu", "cpu"):
            fams.append(f"{fmt(fam[f].at_or_before(bs))}→{fmt(fam[f].at_or_after(be))}")
        print(f"| {blk} | {len(ok)}/{len(us)} | {fmt(s0)} | {fmt(skin.at_or_after(be) - s0 if skin.at_or_after(be) else None, 2)} | "
              f"{fmt(peak(skin, bs, te))} | {a:.0f} | {a / max(1, len(us)):.1f} | {fmt(med([u['prefill_ms'] for u in ok]), 0)} | "
              f"{fmt(ok[0]['prefill_ms'], 0) if ok else 'NA'}/{fmt(ok[-1]['prefill_ms'], 0) if ok else 'NA'} | " + " | ".join(fams) + " |")
    print("\n### A. Per-unit block-relative rise at unit end (skin / NSP / GPU zone)\n")
    print("| k | NPU skin | NPU NSP | NPU prefill ms | GPU skin | GPU gpuss | GPU prefill ms | CPU skin | CPU prefill ms |")
    print("|---:|---:|---:|---:|---:|---:|---:|---:|---:|")
    by = {(u["block"], u["k"]): u for u in units}
    for k in range(1, 13):
        n, g, c = by.get(("A-npu", k), {}), by.get(("A-gpu", k), {}), by.get(("A-cpu", k), {})
        print(f"| {k} | {fmt(n.get('skin_rise_end'), 2)} | {fmt(n.get('nsp_rise_end'), 1)} | {fmt(n.get('prefill_ms'), 0)} | "
              f"{fmt(g.get('skin_rise_end'), 2)} | {fmt(g.get('gpu_rise_end'), 1)} | {fmt(g.get('prefill_ms'), 0)} | "
              f"{fmt(c.get('skin_rise_end'), 2)} | {fmt(c.get('prefill_ms'), 0)} |")
    k = crossover(units)
    print(f"\nskin crossover (NPU rise > GPU rise, two consecutive k): "
          f"{'k=' + str(k) if k else 'no crossover observed through 12 prefills'}")
    for blk, key in (("A-npu", "skin_rise_end"), ("A-npu", "nsp_rise_end"), ("A-gpu", "skin_rise_end"), ("A-gpu", "gpu_rise_end")):
        seq = [u[key] for u in units if u["block"] == blk and u[key] is not None]
        if seq:
            steps = [b - a for a, b in zip(seq, seq[1:])]
            mono = all(s >= 0 for s in steps)
            print(f"{blk} {key}: monotonic={mono} largest unit-to-unit rise={max(steps, default=0):.2f}")

    print("\n## B. Decode tg256\n")
    print("| arm | pos | status | tok/s | skin start | skin peak | area °C·s | °C·s/token | CPU peak | GPU peak | NSP peak |")
    print("|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|")
    for r in dec:
        print(f"| {r['tag']} | {r['pos']} | {r['status']} | {fmt(r.get('tps'))} | {fmt(r.get('skin_start'))} | "
              f"{fmt(r.get('skin_peak'))} | {fmt(r.get('area'), 0)} | {fmt(r.get('per_tok'), 3)} | "
              f"{fmt(r.get('cpu_peak'))} | {fmt(r.get('gpu_peak'))} | {fmt(r.get('nsp_peak'))} |")
    print("\n| backend | n OK | median tok/s | median °C·s/token (reps) | median skin Δ | median CPU/GPU/NSP peak |")
    print("|---|---:|---:|---:|---:|---:|")
    for b in ("cpu", "gpu", "npu"):
        ok = [r for r in dec if r["backend"].startswith(b) and r["status"] == "OK"]
        reps = "/".join(f"{r['per_tok']:.3f}" for r in ok)
        dsk = med([r["skin_peak"] - r["skin_start"] for r in ok])
        print(f"| {b} | {len(ok)} | {fmt(med([r['tps'] for r in ok]))} | {fmt(med([r['per_tok'] for r in ok]), 3)} ({reps}) | "
              f"{fmt(dsk, 2)} | {fmt(med([r['cpu_peak'] for r in ok]))}/{fmt(med([r['gpu_peak'] for r in ok]))}/{fmt(med([r['nsp_peak'] for r in ok]))} |")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
