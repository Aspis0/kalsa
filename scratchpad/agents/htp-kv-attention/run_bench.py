#!/usr/bin/env python3
"""Bare-bench driver: HTP prefill with no_kv_offload on/off across KV depth.

Stages: stage (push kit + model, verify shas on device), run (the matrix),
pull (remote listing), cleanup (remove the device dir), all (the four in one
process — the flow for a --personal-device phone, whose cleanup runs in a
finally block at the end of every invocation). --dry-run prints every adb
command and touches no device. Per arm the run stage does one short verbose
route-proof run and then the clean timing run, both under the same per-run
gates; only clean runs feed the TSV. Kit: ~/kalsa-qdc/kit-5b596ce43 (see its
PROVENANCE.txt); the matrix lives in matrix.py, the gates in gates.py, one
gated invocation in invocation.py.
"""

import argparse
import hashlib
import re
import time
from pathlib import Path

import bench_tsv
import matrix
from device import KILL_BENCH, PersonalRefused
from device import Adb
from invocation import collect_rows, device_env, htp_op_counts, run_invocation
from session import Session

KIT_DIR = Path("/Users/marco/kalsa-qdc/kit-5b596ce43")
MODEL_PATH = Path("/Users/marco/Projects/kalsa-moe-experiments/scratchpad/"
                  "agents/qdc-8elite-newapk/raw/host-materials/"
                  "LFM2.5-2.6B-QAD-Q4_0.gguf")
PROFILE_ARMS = ("A-nkvo", "B-offload")
MIN_FREE_GB = 5.0


def parse_args():
    ap = argparse.ArgumentParser(description=__doc__)
    tgt = ap.add_mutually_exclusive_group(required=True)
    tgt.add_argument("--adb-port", help="QDC tunnel adb server port (e.g. 6037)")
    tgt.add_argument("--serial", help="direct device serial (e.g. R3CW406P8CV)")
    ap.add_argument("--dsp-arch", choices=("v73", "v75", "v79", "v81"),
                    default="v73")
    ap.add_argument("--stage", choices=("stage", "run", "pull", "cleanup",
                                        "all"), default="stage")
    ap.add_argument("--personal-device", action="store_true",
                    help="owner's daily driver: command guard (bench dir + "
                         "read-only probes only), /data free-space check, "
                         "cleanup in a finally block")
    ap.add_argument("--kit", type=Path, default=KIT_DIR)
    ap.add_argument("--model", type=Path, default=MODEL_PATH)
    ap.add_argument("--out", type=Path, default=None,
                    help="results dir (default: results-<utcstamp>)")
    ap.add_argument("--deadline-minutes", type=float, default=55,
                    help="run-stage budget, a few minutes under the session cap")
    ap.add_argument("--dry-run", action="store_true")
    return ap.parse_args()


def sha256_of(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 22), b""):
            h.update(chunk)
    return h.hexdigest()


def sha_mismatch(out_text, expected):
    """Every expected file must be listed with its expected hash: a failed
    sha256sum that prints nothing must not pass."""
    got = {}
    for line in out_text.splitlines():
        parts = line.split()
        if len(parts) == 2 and re.fullmatch(r"[0-9a-f]{64}", parts[0]):
            got[parts[1]] = parts[0]
    missing = sorted(set(expected) - set(got))
    if missing:
        return f"sha missing on device: {missing}"
    bad = [n for n in sorted(expected) if got[n] != expected[n]]
    if bad:
        return f"sha mismatch on device: {bad}"
    return None


def free_space_error(df_text, min_free_gb=MIN_FREE_GB):
    """Parse `df -k /data` before staging the 1.5 GB model."""
    for line in df_text.splitlines():
        f = line.split()
        if len(f) >= 4 and f[-1] == "/data":
            try:
                free_gb = int(f[3]) * 1024 / 1e9
            except ValueError:
                return f"df /data unparseable: {line!r}"
            if free_gb < min_free_gb:
                return f"/data free {free_gb:.1f} GB < {min_free_gb:g} GB"
            return None
    return "no /data row in df output"


def kit_sha(kit, rel):
    lines = Path(kit, "SHA256SUMS").read_text().splitlines()
    hit = [l for l in lines if l.strip().endswith(f"  {rel}")]
    return hit[0].split()[0] if hit else ""


def stage(adb, args, log, out_dir):
    rc, out = adb.shell(
        f"mkdir -p {matrix.DEVICE_DIR}/bin {matrix.DEVICE_DIR}/lib && "
        "getprop ro.product.model; getprop ro.soc.model; nproc", timeout=60)
    log(f"DEVICE_IDENTITY rc={rc} {out.strip()!r}")
    if args.personal_device:
        rc, out = adb.shell("df -k /data", timeout=30)
        if not args.dry_run:
            if rc != 0:
                return f"df /data rc={rc}"
            if err := free_space_error(out):
                return err
            log("FREE_SPACE_OK")
    model_sha = sha256_of(args.model)
    log(f"MODEL_SHA {model_sha}")
    pushes = [(args.kit / "bin/llama-bench", "bin/llama-bench"),
              (args.kit / "bin/llama-completion", "bin/llama-completion"),
              (args.kit / f"lib/libggml-htp-{args.dsp_arch}.so",
               f"lib/libggml-htp-{args.dsp_arch}.so"),
              (args.model, "ship.gguf")]
    for src, dst in pushes:
        rc, out = adb.push(src, f"{matrix.DEVICE_DIR}/{dst}")
        log(f"PUSH {src.name} -> {dst} rc={rc}")
        if rc != 0:
            return f"push failed rc={rc} {out.strip()}"
    rc, out = adb.shell(
        f"chmod 755 {matrix.DEVICE_DIR}/bin/*; cd {matrix.DEVICE_DIR} && "
        "sha256sum bin/* lib/* ship.gguf", timeout=300)
    log(f"DEVICE_SHAS rc={rc}")
    if args.dry_run:
        log("STAGE_SHAS_SKIPPED dry-run")
        return None
    if rc != 0:
        return f"on-device sha256sum rc={rc}"
    expected = {"bin/llama-bench": kit_sha(args.kit, "bin/llama-bench"),
                "bin/llama-completion": kit_sha(args.kit, "bin/llama-completion"),
                f"lib/libggml-htp-{args.dsp_arch}.so":
                    kit_sha(args.kit, f"lib/libggml-htp-{args.dsp_arch}.so"),
                "ship.gguf": model_sha}
    if err := sha_mismatch(out, expected):
        return err
    log("STAGE_SHAS_OK")
    return None


def cooldown(log, dry_run):
    if dry_run:
        return
    log(f"COOLDOWN {matrix.COOLDOWN_S}s between arms")
    time.sleep(matrix.COOLDOWN_S)


def run_arm(adb, args, log, out_dir, arm, rows):
    """Route proof first: a short verbose run whose log carries the HTP0
    model-buffer, execute-op and (per arm) KV-placement lines. Then the clean
    timing run without -v; only its rows enter the TSV."""
    rcmd = matrix.bench_cmd(arm, depths=matrix.ROUTE_DEPTH,
                            reps=matrix.ROUTE_REPS, verbose=True)
    renv = matrix.remote_env(args.dsp_arch, verbose=True)
    ok, _, _, _ = run_invocation(adb, args, log, out_dir, f"{arm.name}-route",
                                 rcmd, renv, route_arm=arm)
    if not ok:
        return f"arm {arm.name}: route proof failed"
    ccmd = matrix.bench_cmd(arm)
    cenv = matrix.remote_env(args.dsp_arch)
    ok, lp, snap0, snap1 = run_invocation(adb, args, log, out_dir,
                                          f"{arm.name}-clean", ccmd, cenv)
    if not ok:
        return f"arm {arm.name}: clean run failed"
    if args.dry_run:
        return None
    return collect_rows(arm, lp, rows, device=device_env(snap0, snap1))


def run(adb, args, log, out_dir):
    deadline = time.monotonic() + args.deadline_minutes * 60
    rows = []
    for i, arm in enumerate(matrix.ARMS):
        if time.monotonic() > deadline:
            log("DEADLINE_REACHED before arm " + arm.name)
            break
        if i:
            cooldown(log, args.dry_run)
        if err := run_arm(adb, args, log, out_dir, arm, rows):
            return err
    if time.monotonic() <= deadline:
        if err := profiled_repeats(adb, args, log, out_dir, deadline):
            return err
    tsv = out_dir / "bench.tsv"
    tsv.write_text("\t".join(bench_tsv.TSV_HEADER) + "\n"
                   + "\n".join(rows) + "\n")
    log(f"TSV_WRITTEN {tsv} rows={len(rows)}")
    return None


def profiled_repeats(adb, args, log, out_dir, deadline):
    """One repeat of A and B at the profile depth with per-op HTP profile and
    the scheduler placement log: attention nodes on CPU in A, HTP in B.
    Profile rows never enter the TSV (clean runs only)."""
    cooldown(log, args.dry_run)
    for i, name in enumerate(PROFILE_ARMS):
        if time.monotonic() > deadline:
            log("DEADLINE_REACHED before profile arm " + name)
            return None
        if i:
            cooldown(log, args.dry_run)
        arm = next(a for a in matrix.ARMS if a.name == name)
        cmd = matrix.bench_cmd(arm, depths=matrix.PROFILE_DEPTH, reps="1",
                               verbose=True)
        env = f"{matrix.remote_env(args.dsp_arch, verbose=True)} {matrix.profiled_env()}"
        ok, lp, _, _ = run_invocation(adb, args, log, out_dir,
                                      f"{name}-profile", cmd, env,
                                      route_arm=arm)
        if not ok:
            log(f"PROFILE_FAILED {name}")
            continue
        if args.dry_run:
            continue
        counts = htp_op_counts(lp.read_text(errors="replace"))
        summary = out_dir / "logs" / f"{name}-profile-placement.txt"
        summary.write_text("op\texecutions\n"
                           + "\n".join(f"{op}\t{n}"
                                       for op, n in sorted(counts.items())) + "\n")
        log(f"PLACEMENT {name} htp_ops={len(counts)} summary={summary.name}")
    return None


def run_all(adb, args, log, out_dir):
    """stage -> run -> pull -> cleanup in one process. The personal-device
    flow: its finally-block cleanup makes every invocation self-contained,
    so staging must not be a separate process on the owner's phone."""
    for do_stage in (stage, run, pull, cleanup):
        if err := do_stage(adb, args, log, out_dir):
            return err
    return None


def pull(adb, args, log, out_dir):
    rc, out = adb.shell(f"ls -la {matrix.DEVICE_DIR}", timeout=60)
    (out_dir / "remote-listing.txt").write_text(f"rc={rc}\n{out}")
    log(f"PULL_LISTING rc={rc}")
    return None


def cleanup(adb, args, log, out_dir):
    rc, out = adb.shell(f"rm -rf {matrix.DEVICE_DIR}; ls -d {matrix.DEVICE_DIR}",
                        timeout=60)
    (out_dir / "cleanup.txt").write_text(f"rc={rc}\n{out}")
    log(f"CLEANUP rc={rc} {out.strip()!r}")
    return None


def main():
    args = parse_args()
    out_dir = args.out or Path(time.strftime("results-%Y%m%d-%H%M%S"))
    (out_dir / "logs").mkdir(parents=True, exist_ok=True)
    log = Session(out_dir / "session-events.log").event
    adb = Adb(serial=args.serial, adb_port=args.adb_port, dry_run=args.dry_run,
              log=log, personal=args.personal_device,
              device_dir=matrix.DEVICE_DIR)
    est = matrix.estimate_minutes(adb.target_kind)
    log(f"SESSION_START target={adb.target_kind} arch={args.dsp_arch} "
        f"dry_run={args.dry_run} personal={args.personal_device} "
        f"estimated_device_minutes={est:.0f} "
        f"deadline_minutes={args.deadline_minutes}")
    stages = {"stage": stage, "run": run, "pull": pull, "cleanup": cleanup,
              "all": run_all}
    err = None
    try:
        err = stages[args.stage](adb, args, log, out_dir)
    except KeyboardInterrupt:
        err = "interrupted"
        log("INTERRUPTED: killing llama-bench; cleanup runs in finally")
        if not args.dry_run:
            try:
                adb.shell(KILL_BENCH, timeout=30)
            except OSError as e:
                log(f"KILL_FAILED {e}")
    except PersonalRefused as e:
        err = f"personal-device guard refused a command: {e}"
    finally:
        # The 1.5 GB model never stays on the owner's phone, whatever happened.
        if args.personal_device and not args.dry_run and args.stage != "cleanup":
            rc, out = adb.shell(f"rm -rf {matrix.DEVICE_DIR}", timeout=300)
            log(f"PERSONAL_CLEANUP rc={rc}")
    log(f"STAGE_END {args.stage} error={err!r}")
    raise SystemExit(1 if err else 0)


if __name__ == "__main__":
    main()
