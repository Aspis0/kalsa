#!/usr/bin/env python3
"""Bare-bench driver: HTP prefill with no_kv_offload on/off across KV depth.

Stages: stage (push kit + model, verify shas on device), run (the matrix),
pull (remote listing), cleanup (remove the device dir). --dry-run prints every
adb command and touches no device. Kit: ~/kalsa-qdc/kit-5b596ce43 (see its
PROVENANCE.txt); the matrix lives in matrix.py, the gates in gates.py.
"""

import argparse
import hashlib
import re
import shlex
import time
from pathlib import Path

import bench_tsv
import gates
import matrix
from device import Adb
from session import Session

KIT_DIR = Path("/Users/marco/kalsa-qdc/kit-5b596ce43")
MODEL_PATH = Path("/Users/marco/Projects/kalsa-moe-experiments/scratchpad/"
                  "agents/qdc-8elite-newapk/raw/host-materials/"
                  "LFM2.5-2.6B-QAD-Q4_0.gguf")
PROFILE_ARMS = ("A-nkvo", "B-offload")
LIVE_SAMPLE_S = 10
RUN_TIMEOUT_S = 900
EXIT_LINE = re.compile(r"^EXIT=(\d+)\s*$", re.M)
EXECUTE_OP = re.compile(r"ggml-hex: (\S+) execute-op (\S+)\|")


def parse_args():
    ap = argparse.ArgumentParser(description=__doc__)
    tgt = ap.add_mutually_exclusive_group(required=True)
    tgt.add_argument("--adb-port", help="QDC tunnel adb server port (e.g. 6037)")
    tgt.add_argument("--serial", help="direct device serial (e.g. R3CW406P8CV)")
    ap.add_argument("--dsp-arch", choices=("v73", "v75", "v79", "v81"),
                    default="v73")
    ap.add_argument("--stage", choices=("stage", "run", "pull", "cleanup"),
                    default="stage")
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


def stage(adb, args, log, out_dir, deadline):
    rc, out = adb.shell(
        f"mkdir -p {matrix.DEVICE_DIR}/bin {matrix.DEVICE_DIR}/lib && "
        "getprop ro.product.model; getprop ro.soc.model; nproc", timeout=60)
    log(f"DEVICE_IDENTITY rc={rc} {out.strip()!r}")
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
    expected = {"bin/llama-bench": kit_sha(args.kit, "bin/llama-bench"),
                "bin/llama-completion": kit_sha(args.kit, "bin/llama-completion"),
                f"lib/libggml-htp-{args.dsp_arch}.so":
                    kit_sha(args.kit, f"lib/libggml-htp-{args.dsp_arch}.so"),
                "ship.gguf": model_sha}
    for line in out.splitlines():
        parts = line.split()
        if len(parts) != 2:
            continue
        sha, name = parts
        if expected.get(name) != sha:
            return f"sha mismatch on device: {line}"
    log("STAGE_SHAS_OK")
    return None


def kit_sha(kit, rel):
    lines = Path(kit, "SHA256SUMS").read_text().splitlines()
    hit = [l for l in lines if l.strip().endswith(f"  {rel}")]
    return hit[0].split()[0] if hit else ""


def run_cli(adb, args, log, tag, cmd, env, out_dir, deadline):
    """Run one remote CLI with live gates; returns (ok, log_path)."""
    why = gates.gate_reason(gates.snapshot(adb, log),
                            adb.target_kind, args.dry_run)
    if why:
        log(f"SAFETY_STOP {tag}:pre:{why}")
        return False, None
    log_path = out_dir / "logs" / f"{tag}.log"
    # env is an `export ...` statement, so it must end before the command.
    remote = (f"cd '{matrix.DEVICE_DIR}' && {env}; {shlex.join(cmd)}; "
              "rc=$?; echo EXIT=$rc; exit $rc")
    log(f"CLI_START {tag} cmd={shlex.join(cmd)}")
    t0 = time.monotonic()
    if args.dry_run:
        adb.shell_stream(remote, None)
        return True, log_path
    with log_path.open("w", encoding="utf-8") as f:
        p = adb.shell_stream(remote, f)
        while p.poll() is None:
            time.sleep(LIVE_SAMPLE_S)
            if time.monotonic() - t0 > RUN_TIMEOUT_S:
                log(f"SAFETY_STOP {tag}:host_timeout")
                adb.shell("for p in $(pidof llama-bench); do kill -TERM $p; done")
                break
            why = gates.gate_reason(gates.snapshot(adb, log),
                                    adb.target_kind, args.dry_run)
            if why:
                log(f"SAFETY_STOP {tag}:live:{why}")
                adb.shell("for p in $(pidof llama-bench); do kill -TERM $p; done")
                break
        rc = p.wait(timeout=60)
    text = log_path.read_text(errors="replace")
    m = EXIT_LINE.search(text)
    if rc != 0 or not m or int(m.group(1)) != 0:
        log(f"CLI_FAILED {tag} adb_rc={rc} remote_exit={m.group(1) if m else '?'}")
        return False, log_path
    if not gates.route_proved(text, args.dsp_arch):
        log(f"PROOF_STOP {tag}: route proof missing")
        return False, log_path
    log(f"CLI_OK {tag} wall_s={time.monotonic() - t0:.0f}")
    return True, log_path


def collect_rows(arm, log_path, rows, dry_run=False):
    if dry_run:
        return None  # dry-run never runs the CLI, so there is no log to parse
    text = Path(log_path).read_text(errors="replace")
    parsed = bench_tsv.parse_markdown(text)
    if not parsed:
        return f"no benchmark rows parsed from {log_path.name}"
    for p in parsed:
        rows.append(bench_tsv.tsv_line(arm, p, matrix.FLASH_ATTN, arm.nkvo,
                                       arm.ctk, arm.ctv, Path(log_path).name,
                                       matrix.CHUNK_TOKENS))
    return None


def run(adb, args, log, out_dir, deadline):
    rows = []
    for arm in matrix.ARMS:
        if time.monotonic() > deadline:
            log("DEADLINE_REACHED before arm " + arm.name)
            break
        ok, lp = run_cli(adb, args, log, arm.name, matrix.bench_cmd(arm),
                         matrix.remote_env(args.dsp_arch), out_dir, deadline)
        if not ok:
            return f"arm {arm.name} failed"
        if err := collect_rows(arm, lp, rows, args.dry_run):
            return err
    if time.monotonic() <= deadline:
        err = profiled_repeats(adb, args, log, out_dir, deadline, rows)
        if err:
            return err
    tsv = out_dir / "bench.tsv"
    tsv.write_text("\t".join(bench_tsv.TSV_HEADER) + "\n"
                   + "\n".join(rows) + "\n")
    log(f"TSV_WRITTEN {tsv} rows={len(rows)}")
    return None


def profiled_repeats(adb, args, log, out_dir, deadline, rows):
    """One repeat of A and B at the profile depth with per-op HTP profile and
    the scheduler placement log: attention nodes on CPU in A, HTP in B."""
    for name in PROFILE_ARMS:
        if time.monotonic() > deadline:
            log("DEADLINE_REACHED before profile arm " + name)
            return None
        arm = next(a for a in matrix.ARMS if a.name == name)
        cmd = matrix.bench_cmd(arm, depths=matrix.PROFILE_DEPTH, reps="1")
        env = f"{matrix.remote_env(args.dsp_arch)} {matrix.profiled_env()}"
        ok, lp = run_cli(adb, args, log, f"{name}-profile", cmd, env,
                         out_dir, deadline)
        if not ok:
            log(f"PROFILE_FAILED {name} (matrix rows already collected)")
            continue
        if args.dry_run:
            collect_rows(arm, lp, rows, dry_run=True)
            continue
        text = lp.read_text(errors="replace")
        counts = {}
        for _, op in EXECUTE_OP.findall(text):
            counts[op] = counts.get(op, 0) + 1
        summary = out_dir / "logs" / f"{name}-profile-placement.txt"
        summary.write_text("op\texecutions\n"
                           + "\n".join(f"{op}\t{n}"
                                       for op, n in sorted(counts.items())) + "\n")
        log(f"PLACEMENT {name} htp_ops={len(counts)} summary={summary.name}")
        if err := collect_rows(arm, lp, rows, args.dry_run):
            return err
    return None


def pull(adb, args, log, out_dir, deadline):
    rc, out = adb.shell(f"ls -la {matrix.DEVICE_DIR}", timeout=60)
    (out_dir / "remote-listing.txt").write_text(f"rc={rc}\n{out}")
    log(f"PULL_LISTING rc={rc}")
    return None


def cleanup(adb, args, log, out_dir, deadline):
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
              log=log)
    est = matrix.estimate_minutes(adb.target_kind)
    log(f"SESSION_START target={adb.target_kind} arch={args.dsp_arch} "
        f"dry_run={args.dry_run} estimated_device_minutes={est:.0f} "
        f"deadline_minutes={args.deadline_minutes}")
    stages = {"stage": stage, "run": run, "pull": pull, "cleanup": cleanup}
    deadline = time.monotonic() + args.deadline_minutes * 60
    err = stages[args.stage](adb, args, log, out_dir, deadline)
    log(f"STAGE_END {args.stage} error={err!r}")
    raise SystemExit(1 if err else 0)


if __name__ == "__main__":
    main()
