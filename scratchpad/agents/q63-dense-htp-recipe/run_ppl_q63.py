from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

from q63_common import (
    ACTIVE, CHILD_FLAGS, CORPORA, CORPUS_SHA, EXPECTED_CHUNKS, HERE, PPLBIN,
    sha256, cmd_text, ignore_console_signals, parse_ppl, set_idle, write_json,
)


def main() -> int:
    ignore_console_signals()
    args = sys.argv[1:]
    if len(args) != 6 or args[0] != "--arm" or args[2] != "--corpus" or args[4] != "--output":
        print("usage: run_ppl_q63.py --arm ARM --corpus CORPUS --output JSON", file=sys.stderr)
        return 2
    arm, corpus, output_path = args[1], args[3], Path(args[5])
    if corpus not in CORPORA:
        return 2
    model_by_arm = {
        "control-validity": HERE.parent.parent.parent / "scratchpad" / "agents" / "q59-dense-quant-gate" / "gguf" / "Qwen3.5-4B-fromsrc-Q4_K_M.gguf",
        "control-recheck": HERE.parent.parent.parent / "scratchpad" / "agents" / "q59-dense-quant-gate" / "gguf" / "Qwen3.5-4B-fromsrc-Q4_K_M.gguf",
        "candidate1": HERE / "CANDIDATE_1.gguf",
        "candidate2": HERE / "CANDIDATE_2.gguf",
    }
    model = model_by_arm.get(arm)
    data = CORPORA[corpus]
    if model is None or not model.exists() or not data.exists() or not PPLBIN.exists():
        print("missing model, corpus, or PPL binary", file=sys.stderr)
        return 1
    model_sha = sha256(model)
    file_sha = sha256(data)
    if file_sha != CORPUS_SHA[corpus]:
        print(f"corpus sha mismatch {corpus}: {file_sha}", file=sys.stderr)
        return 1
    output_path.parent.mkdir(parents=True, exist_ok=True)
    log_path = output_path.with_suffix(".log")
    chunk_arg = "64" if corpus == "wiki" else "-1"
    command = [str(PPLBIN), "-m", str(model), "-f", str(data), "-c", "2048", "-b", "512", "-ub", "512", "-t", "8", "-ngl", "0", "--chunks", chunk_arg, "--ppl-stride", "0"]
    env = os.environ.copy()
    env["PATH"] = str(PPLBIN.parent) + os.pathsep + env.get("PATH", "")
    record = {
        "arm": arm, "corpus": corpus, "model": str(model), "model_bytes": model.stat().st_size,
        "model_sha256": model_sha, "file": str(data), "file_bytes": data.stat().st_size,
        "file_sha256": file_sha, "expected_chunks": EXPECTED_CHUNKS[corpus], "cmd": command,
        "ppl": None, "ppl_err": None, "n_chunks": None, "rc": None, "wall_s": None,
        "log": str(log_path), "status": "RUNNING",
    }
    write_json(output_path, record)
    start = time.perf_counter()
    with log_path.open("w", encoding="utf-8", errors="replace") as output:
        output.write("CMD " + cmd_text(command) + "\n")
        output.flush()
        process = subprocess.Popen(
            command, cwd=str(HERE.parent.parent.parent), env=env, stdin=subprocess.DEVNULL,
            stdout=output, stderr=subprocess.STDOUT, close_fds=False, creationflags=CHILD_FLAGS,
        )
        write_json(ACTIVE, {"cell": f"{arm}/{corpus}", "pid": process.pid, "command": command, "started_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())})
        try:
            set_idle(process)
            rc = process.wait()
        finally:
            current = None
            try:
                current = json.loads(ACTIVE.read_text(encoding="utf-8"))
            except Exception:
                pass
            if current and current.get("pid") == process.pid:
                ACTIVE.unlink(missing_ok=True)
    wall = time.perf_counter() - start
    parsed = parse_ppl(log_path.read_text(encoding="utf-8", errors="replace"))
    record.update(parsed)
    record["rc"] = rc
    record["wall_s"] = wall
    record["status"] = "COMPLETE" if rc == 0 and "ppl" in parsed and "n_chunks" in parsed else "FAILED"
    if record["status"] != "COMPLETE":
        record["error"] = "nonzero return code or missing PPL/chunk parse"
    write_json(output_path, record)
    print(json.dumps(record, indent=2), flush=True)
    return 0 if record["status"] == "COMPLETE" else (rc or 1)


if __name__ == "__main__":
    raise SystemExit(main())
