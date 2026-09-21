#!/usr/bin/env python3
"""Rebuild bench-out/results.tsv from per-run artifacts.

Why: the in-run row builder is a single point of failure — a NameError in it
dropped rows for three arms while the runs themselves were fine (the evidence
was on disk). This reads each bench-out/<ARM>/rep<N>/ directory and reconstructs
the row, so the table is a pure function of the recorded evidence.

Sources per run:
  run.log          ARM/REP/model/norepack, start|end level+temp+wall
  reduced.json     engine mode, load wall, telemetry rounds, native variant, refusals
  peak.csv         3 s sampler: peak RssAnon/RssFile/Mlocked, majflt delta, MemAvailable
  daemon_*.txt     adsprpcd/cdsprpcd %CPU, loadavg, swap used
  maps_gguf_bytes.txt  loaded-model proof
"""
import csv, glob, json, os, re, sys

BASE = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "bench-out")
OUT = os.path.join(BASE, "results.tsv")

HEADER = ["arm", "rep", "model", "norepack", "mode_no_extra_bufts", "load_wall_s",
          "prompt_ms", "prompt_n", "predicted_per_s", "predicted_n",
          "peak_anon_kb", "peak_file_kb", "peak_mlocked_kb", "majflt_delta",
          "memavail_pre_kb", "memavail_post_kb", "level_pre", "level_post",
          "temp_pre_deciC", "temp_post_deciC", "wall_s", "gguf_vma",
          "refusedBy", "reasonKey", "adsprpcd_pct_start", "adsprpcd_pct_end",
          "cdsprpcd_pct_start", "cdsprpcd_pct_end", "loadavg_start", "loadavg_end",
          "swap_used_kb_start", "swap_used_kb_end",
          "prefill_deadline_abort", "turn_completed", "native_variant"]


def txt(p):
    try:
        return open(p, errors="replace").read()
    except OSError:
        return ""


def dnum(path, daemon):
    for line in txt(path).splitlines():
        p = line.replace("=", " ").replace("(", " ").split()
        if len(p) > 2 and p[0] == daemon and p[1] == "%CPU":
            return p[2]
    return ""


def swap_used(path):
    t = re.search(r"swap_total_kb=(\d+)", txt(path))
    f = re.search(r"swap_free_kb=(\d+)", txt(path))
    return int(t.group(1)) - int(f.group(1)) if (t and f) else ""


def loadavg(path):
    m = re.search(r"loadavg=([\d.]+)", txt(path))
    return m.group(1) if m else ""


def peak(csv_path):
    a = f = m = 0.0
    maj0 = maj1 = None
    mem0 = mem1 = ""
    try:
        rows = list(csv.reader(open(csv_path, errors="replace")))
    except OSError:
        return dict(anon="", file="", mlock="", majd="", mem0="", mem1="")
    for r in rows[1:]:
        if len(r) < 11 or not r[0]:
            continue
        try:
            a = max(a, float(r[3] or 0)); f = max(f, float(r[4] or 0)); m = max(m, float(r[5] or 0))
        except ValueError:
            pass
        if r[8]:
            if maj0 is None:
                maj0 = r[8]
            maj1 = r[8]
        if r[10]:
            if mem0 == "":
                mem0 = r[10]
            mem1 = r[10]
    mjd = int(maj1) - int(maj0) if (maj0 not in (None, "") and maj1 not in (None, "")) else ""
    return dict(anon=int(a), file=int(f), mlock=int(m), majd=mjd, mem0=mem0, mem1=mem1)


rows = []
for rundir in sorted(glob.glob(os.path.join(BASE, "*", "rep*"))):
    if not os.path.isdir(rundir):
        continue
    log = txt(os.path.join(rundir, "run.log"))
    m = re.search(r"=== ARM=(\S+) REP=(\S+) model=(\S+)/(\S+) norepack=(\S+) ===", log)
    if not m:
        continue
    arm, rep, model_dir, model_file, norepack = m.groups()
    arm = arm.replace("REP=1", "").strip()
    m2 = re.search(r"run start (\S+) level=(\S+) temp_deciC=(\S+)", log)
    m3 = re.search(r"run end (\S+) level=(\S+) temp_deciC=(\S+) wall=(\d+)s", log)
    reduced = {}
    try:
        reduced = json.load(open(os.path.join(rundir, "reduced.json")))
    except Exception:
        pass
    init = reduced.get("init") or {}
    rounds = reduced.get("rounds") or []
    first = rounds[0] if rounds else {}
    loads = reduced.get("kalsa_load") or []
    ref = next((l for l in loads if l.get("phase") == "fitGate"), {})
    pk = peak(os.path.join(rundir, "peak.csv"))
    ds, de = os.path.join(rundir, "daemon_start.txt"), os.path.join(rundir, "daemon_end.txt")
    vma = " | ".join(l.strip() for l in txt(os.path.join(rundir, "maps_gguf_bytes.txt")).splitlines() if l.strip())
    pn = first.get("prompt_n") if first.get("prompt_n") is not None else first.get("promptN", "")
    stalls = reduced.get("stalls") or []
    abort = 1 if any(s.get("reason") == "prefill" for s in stalls) else 0
    completed = 1 if rounds else 0
    nv = (reduced.get("native_variant") or {}).get("androidLib", "")
    rows.append([arm, rep, model_dir, norepack, init.get("no_extra_bufts", ""),
                 reduced.get("load_wall_s", ""), first.get("promptMs", ""), pn if pn is not None else "",
                 first.get("predictedPerSecond", ""), first.get("tokensPredicted", ""),
                 pk["anon"], pk["file"], pk["mlock"], pk["majd"], pk["mem0"], pk["mem1"],
                 (m2.group(2) if m2 else ""), (m3.group(2) if m3 else ""),
                 (m2.group(3) if m2 else ""), (m3.group(3) if m3 else ""),
                 (m3.group(4) if m3 else ""), vma,
                 ref.get("refusedBy", ""), ref.get("reasonKey", ""),
                 dnum(ds, "adsprpcd"), dnum(de, "adsprpcd"),
                 dnum(ds, "cdsprpcd"), dnum(de, "cdsprpcd"),
                 loadavg(ds), loadavg(de), swap_used(ds), swap_used(de),
                 abort, completed, nv])

with open(OUT, "w", newline="") as fh:
    w = csv.writer(fh, delimiter="\t", lineterminator="\n")
    w.writerow(HEADER)
    w.writerows(rows)
print(f"{OUT}: {len(rows)} rows")
