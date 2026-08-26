#!/usr/bin/env python3
"""Resume q59 Amendment 1's PPL matrix sequentially and finalize the gate."""
from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(r"C:\Users\gualt\Desktop\Kalsa\moe-experiments")
HERE = ROOT / "scratchpad" / "agents" / "q59-dense-quant-gate"
GGUF = HERE / "gguf"
RUNNER = HERE / "run_ppl_q59.py"
FINALIZER = HERE / "finalize_q59.py"
CORPORA = ("wiki", "it", "es", "fr", "zh")
PRIMARY_ORDER = [(arm, corpus) for corpus in CORPORA for arm in ("control", "iq4_nl")]
Q4_ORDER = [("q4_0", corpus) for corpus in CORPORA]
ESTIMATED_CHUNKS = {"wiki": 64, "it": 71, "es": 67, "fr": 65, "zh": 67}
CREATE_NEW_PROCESS_GROUP = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0x00000200)
CREATE_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000)
IDLE_PRIORITY_CLASS = getattr(subprocess, "IDLE_PRIORITY_CLASS", 0x00000040)


def out_json(arm: str, corpus: str) -> Path:
    return GGUF / "ppl" / f"ppl-{arm}-{corpus}.json"


def log(msg: str) -> None:
    line = time.strftime("[%Y-%m-%dT%H:%M:%S] ") + msg
    print(line, flush=True)
    with (GGUF / "ppl" / "pipeline_q59.log").open("a", encoding="utf-8") as f:
        f.write(line + "\n")


def ignore_console_signals() -> None:
    signal.signal(signal.SIGINT, signal.SIG_IGN)
    sigbreak = getattr(signal, "SIGBREAK", None)
    if sigbreak is not None:
        signal.signal(sigbreak, signal.SIG_IGN)
    if os.name == "nt":
        try:
            import ctypes
            ctypes.windll.kernel32.SetConsoleCtrlHandler(None, True)
        except Exception:
            pass


def chunks_arg(corpus: str) -> str:
    return "64" if corpus == "wiki" else "-1"


def valid_record(target: Path) -> dict | None:
    try:
        rec = json.loads(target.read_text(encoding="utf-8"))
        if rec.get("rc") == 0 and "ppl" in rec and "ppl_err" in rec and "n_chunks" in rec:
            return rec
    except Exception:
        return None
    return None


def run_cell(arm: str, corpus: str) -> int:
    log(f"RUN {arm}/{corpus} chunks={chunks_arg(corpus)}")
    cell_log = GGUF / "ppl" / f"pipeline-{arm}-{corpus}.log"
    with cell_log.open("a", encoding="utf-8") as output:
        output.write(f"\n===== {time.strftime('%Y-%m-%dT%H:%M:%S')} RUN {arm}/{corpus} =====\n")
        output.flush()
        p = subprocess.Popen(
            [sys.executable, str(RUNNER), arm, corpus, chunks_arg(corpus)],
            cwd=str(ROOT), stdin=subprocess.DEVNULL, stdout=output,
            stderr=subprocess.STDOUT, close_fds=False,
            creationflags=IDLE_PRIORITY_CLASS | CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP,
        )
        rc = p.wait()
    log(f"DONE {arm}/{corpus} rc={rc}")
    return rc


def estimate_after_first_cell() -> None:
    first = valid_record(out_json("control", "wiki"))
    if not first:
        return
    sec_per_chunk = float(first["wall_s"]) / 64.0
    total_chunks = 2 * sum(ESTIMATED_CHUNKS.values())
    remaining_s = max(0.0, (total_chunks - 64) * sec_per_chunk)
    log(
        "ETA_AFTER_FIRST_CELL "
        f"first_wall_s={first['wall_s']:.1f} sec_per_chunk={sec_per_chunk:.3f} "
        f"estimated_total_chunks={total_chunks} remaining_s={remaining_s:.1f} "
        f"remaining_h={remaining_s / 3600:.2f}"
    )


def main() -> int:
    ignore_console_signals()
    (GGUF / "ppl").mkdir(parents=True, exist_ok=True)
    log("START q59 Amendment 1; one PPL child at a time; wiki=64 chunks; Q8_0=SKIPPED")
    for index, (arm, corpus) in enumerate(PRIMARY_ORDER):
        target = out_json(arm, corpus)
        rec = valid_record(target)
        if rec:
            log(f"SKIP complete {arm}/{corpus} ppl={rec['ppl']} chunks={rec['n_chunks']}")
        else:
            if run_cell(arm, corpus) != 0:
                return 1
        if index == 0:
            estimate_after_first_cell()
    log("PRIMARY_10_DONE")
    primary = {(arm, corpus): valid_record(out_json(arm, corpus)) for arm, corpus in PRIMARY_ORDER}
    iq_failed = False
    for corpus in CORPORA:
        control = primary[("control", corpus)]
        iq = primary[("iq4_nl", corpus)]
        if not control or not iq:
            log(f"STOP missing primary result {corpus}")
            return 1
        delta = 100.0 * (iq["ppl"] / control["ppl"] - 1.0)
        log(f"IQ4_NL_DELTA corpus={corpus} pct={delta:.6f} gate={'PASS' if delta <= 1.0 else 'FAIL'}")
        iq_failed = iq_failed or delta > 1.0
    if iq_failed:
        log("IQ4_NL_GATE_FAIL run Q4_0 fallback cells")
        for arm, corpus in Q4_ORDER:
            target = out_json(arm, corpus)
            if valid_record(target):
                rec = valid_record(target)
                log(f"SKIP complete {arm}/{corpus} ppl={rec['ppl']} chunks={rec['n_chunks']}")
                continue
            if run_cell(arm, corpus) != 0:
                return 1
    else:
        log("IQ4_NL_GATE_PASS Q4_0=SKIPPED Q8_0=SKIPPED")
        (GGUF / "ppl" / "q4_0-skipped.json").write_text(
            json.dumps({"reason": "IQ4_NL passed all five corpora", "q4_0": "SKIPPED", "q8_0": "SKIPPED"}, indent=2),
            encoding="utf-8",
        )
    subprocess.run([sys.executable, str(FINALIZER)], cwd=str(ROOT), check=False)
    log("DONE q59 Amendment 1")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
