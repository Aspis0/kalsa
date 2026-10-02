"""One gated llama-bench invocation: gates before, live gates while it runs,
the after-snapshot, the HTP route proof, and what the logs yield for the TSV."""

import re
import shlex
import time
from pathlib import Path

import bench_tsv
import gates
import matrix
from device import KILL_BENCH

LIVE_SAMPLE_S = 10
RUN_TIMEOUT_S = 900
EXIT_LINE = re.compile(r"^EXIT=(\d+)\s*$", re.M)
EXECUTE_OP = re.compile(r"ggml-hex: (\S+) execute-op (\S+)\|")


def run_invocation(adb, args, log, out_dir, tag, cmd, env, route_arm=None):
    """Run cmd under the target's gates and return (ok, log_path,
    snap_before, snap_after). With route_arm set, the HTP route proof is
    checked on this run's log, which must therefore be a verbose run."""
    why, snap0 = gates.ensure_gates(adb, log, tag, args.dry_run)
    if why:
        log(f"SAFETY_STOP {tag}:pre:{why}")
        return False, None, snap0, snap0
    log_path = out_dir / "logs" / f"{tag}.log"
    # env is an `export ...` statement, so it must end before the command.
    remote = (f"cd '{matrix.DEVICE_DIR}' && {env}; {shlex.join(cmd)}; "
              "rc=$?; echo EXIT=$rc; exit $rc")
    log(f"CLI_START {tag} cmd={shlex.join(cmd)}")
    t0 = time.monotonic()
    if args.dry_run:
        adb.shell_stream(remote, None)
        return True, log_path, snap0, snap0
    with log_path.open("w", encoding="utf-8") as f:
        p = adb.shell_stream(remote, f)
        while p.poll() is None:
            time.sleep(LIVE_SAMPLE_S)
            if time.monotonic() - t0 > RUN_TIMEOUT_S:
                log(f"SAFETY_STOP {tag}:host_timeout")
                adb.shell(KILL_BENCH)
                break
            why = gates.gate_reason(gates.snapshot(adb, log),
                                    adb.target_kind)
            if why:
                log(f"SAFETY_STOP {tag}:live:{why}")
                adb.shell(KILL_BENCH)
                break
        rc = p.wait(timeout=60)
    snap1 = gates.snapshot(adb, log)
    text = log_path.read_text(errors="replace")
    m = EXIT_LINE.search(text)
    if rc != 0 or not m or int(m.group(1)) != 0:
        log(f"CLI_FAILED {tag} adb_rc={rc} remote_exit={m.group(1) if m else '?'}")
        return False, log_path, snap0, snap1
    if route_arm and not gates.route_proved(text, args.dsp_arch, route_arm.nkvo):
        log(f"PROOF_STOP {tag}: route proof missing")
        return False, log_path, snap0, snap1
    log(f"CLI_OK {tag} wall_s={time.monotonic() - t0:.0f}")
    return True, log_path, snap0, snap1


def device_env(snap0, snap1):
    """Per-run device state for the TSV, from the gate snapshots."""
    return {"model": snap0["model"], "soc": snap0["soc"],
            "battery_level": snap0["battery_level"],
            "battery_temp_c": snap0["battery_temp_c"],
            "thermal_before": snap0["thermal_status"],
            "thermal_after": snap1["thermal_status"]}


def collect_rows(arm, log_path, rows, device):
    """TSV rows from a clean run's markdown table; None on success."""
    text = Path(log_path).read_text(errors="replace")
    parsed = bench_tsv.parse_markdown(text)
    if not parsed:
        return f"no benchmark rows parsed from {log_path.name}"
    for p in parsed:
        rows.append(bench_tsv.tsv_line(arm, p, matrix.FLASH_ATTN, arm.nkvo,
                                       arm.ctk, arm.ctv, Path(log_path).name,
                                       matrix.CHUNK_TOKENS, device=device))
    return None


def htp_op_counts(log_text):
    """Per-op execution counts from a profiled run's execute-op lines."""
    counts = {}
    for _, op in EXECUTE_OP.findall(log_text):
        counts[op] = counts.get(op, 0) + 1
    return counts
