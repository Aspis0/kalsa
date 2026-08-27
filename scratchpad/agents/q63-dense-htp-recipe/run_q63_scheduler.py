from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

from q63_common import (
    ACTIVE, BF16, BF16_SHA, CELL_DIR, CHILD_FLAGS, CONTROL, CONTROL_SHA, CORPORA,
    CORPUS_SHA, EXPECTED_CHUNKS, HERE, HTP_TYPES, PPLBIN, PPL_DIR, QUANTBIN,
    ROOT, cmd_text, complete_ppl, ignore_console_signals, now_utc, python_exe,
    read_json, set_idle, sha256, write_json,
)

RUN_LOG = HERE / "RUN_LOG.md"
STATUS = HERE / "STATUS.txt"
MANIFEST_PATH = HERE / "manifest.json"
EXEC_WORKER = HERE / "run_q63_exec.py"
PPL_WORKER = HERE / "run_ppl_q63.py"
DUMP_SCRIPT = HERE / "dump_q63.py"
PAIRED_SCRIPT = HERE / "paired_chunks_q63.py"
Q59_PPL = ROOT / "scratchpad" / "agents" / "q59-dense-quant-gate" / "gguf" / "ppl"
Q59_CONTROL_JSON = {corpus: Q59_PPL / f"ppl-control-{corpus}.json" for corpus in CORPORA}
Q59_CONTROL_LOG = {corpus: Q59_PPL / f"ppl-control-{corpus}.log" for corpus in CORPORA}
Q59_CONTROL_PPL = ROOT / "build-llama-pc" / "bin" / "llama-perplexity.exe"

C1 = HERE / "CANDIDATE_1.gguf"
C2 = HERE / "CANDIDATE_2.gguf"
C1_PATTERNS = [
    r'^blk\.(?:0|1|2|6|9|12|18|21|24|28|29|30)\.attn_qkv\.weight$=Q8_0',
    r'^blk\.(?:3|15|27|31|32)\.attn_v\.weight$=Q8_0',
    r'^blk\.(?:0|1|2|3|6|9|12|15|18|21|24|27|28|29|30|31|32)\.ffn_down\.weight$=Q8_0',
    r'^blk\.\d+\.attn_qkv\.weight$=IQ4_NL',
    r'^blk\.\d+\.attn_v\.weight$=IQ4_NL',
    r'^blk\.\d+\.ffn_down\.weight$=IQ4_NL',
]


def log(message: str) -> None:
    line = f"[{now_utc()}] {message}"
    print(line, flush=True)
    with RUN_LOG.open("a", encoding="utf-8") as handle:
        handle.write(line + "\n")


def write_status(phase: str, state: str, **fields: object) -> None:
    rows = [f"UPDATED_UTC={now_utc()}", f"RUNNER_PID={os.getpid()}", f"PHASE={phase}", f"STATE={state}"]
    for key, value in fields.items():
        rows.append(f"{key.upper()}={value}")
    STATUS.write_text("\n".join(rows) + "\n", encoding="utf-8")


def load_manifest() -> dict:
    current = read_json(MANIFEST_PATH)
    if current:
        current["status"] = "RUNNING"
        current["resumed_utc"] = now_utc()
        return current
    return {
        "cell": "q63", "prereg_lock": "7477247a", "status": "RUNNING", "started_utc": now_utc(),
        "protocol": "locked q63 IQ4_NL-M readable recipe gate", "htp_types": sorted(HTP_TYPES),
        "expected_chunks": EXPECTED_CHUNKS, "corpora": {key: str(value) for key, value in CORPORA.items()},
        "corpus_sha256": CORPUS_SHA, "bf16": {"path": str(BF16), "bytes": BF16.stat().st_size if BF16.exists() else None, "sha256": BF16_SHA},
        "control_model": {"path": str(CONTROL), "sha256": CONTROL_SHA},
        "toolchain": {
            "quantizer": {"path": str(QUANTBIN), "commit": "e5605f3bd3545867b2eb2581c96fd7042e243541", "sha256": "63583b81162bbe1ae3b74ae2adac2cf79466edd52213ce088bc000b0e195d9c5"},
            "perplexity": {"path": str(PPLBIN), "commit": "1882bf8cd99659246f4ddecb99c268669d7bb3c9", "sha256": "d4b31c42195f1d0e1b586ae4544ece6203ba2fd13d814fcefca170e6667707d7"},
        },
        "control_selection": {}, "validity": {}, "quantization": {}, "dumps": {}, "ppl": {}, "gates": {},
    }


def save_manifest(manifest: dict) -> None:
    write_json(MANIFEST_PATH, manifest)


def read_active_pid() -> str:
    active = read_json(ACTIVE)
    return str(active.get("pid")) if active and active.get("pid") else ""


def run_worker(cell: str, phase: str, worker: Path, args: list[str]) -> int:
    command = [python_exe(), str(worker), *args]
    log(f"WORKER_CMD {cmd_text(command)}")
    write_status(phase, "STARTING", CELL=cell)
    process = subprocess.Popen(
        command, cwd=str(ROOT), stdin=subprocess.DEVNULL, stdout=None, stderr=subprocess.STDOUT,
        close_fds=False, creationflags=CHILD_FLAGS,
    )
    set_idle(process)
    for _ in range(30):
        active_pid = read_active_pid()
        write_status(phase, "RUNNING", CELL=cell, WORKER_PID=process.pid, CHILD_PID=active_pid or "starting")
        if active_pid:
            break
        time.sleep(0.1)
    rc = process.wait()
    write_status(phase, "CHILD_DONE", CELL=cell, WORKER_PID=process.pid, RC=rc)
    return rc


def ppl_model(arm: str) -> Path:
    return {"control-validity": CONTROL, "control-recheck": CONTROL, "candidate1": C1, "candidate2": C2}[arm]


def ppl_output(arm: str, corpus: str) -> Path:
    return PPL_DIR / f"{arm}-{corpus}.json"


def ppl_command(arm: str, corpus: str) -> list[str]:
    model, data = ppl_model(arm), CORPORA[corpus]
    return [str(PPLBIN), "-m", str(model), "-f", str(data), "-c", "2048", "-b", "512", "-ub", "512", "-t", "8", "-ngl", "0", "--chunks", "64" if corpus == "wiki" else "-1", "--ppl-stride", "0"]


def run_ppl_cell(manifest: dict, arm: str, corpus: str) -> dict | None:
    PPL_DIR.mkdir(parents=True, exist_ok=True)
    target = ppl_output(arm, corpus)
    existing = complete_ppl(target, EXPECTED_CHUNKS[corpus])
    if existing:
        log(f"SKIP complete {arm}/{corpus} ppl={existing.get('ppl')} chunks={existing.get('n_chunks')}")
        write_status(f"PPL {arm} {corpus}", "DONE", CELL=f"{arm}/{corpus}", RC=0, SKIP="complete")
        return existing
    command = ppl_command(arm, corpus)
    log(f"CMD {cmd_text(command)}")
    rc = run_worker(f"{arm}/{corpus}", f"PPL {arm} {corpus}", PPL_WORKER, ["--arm", arm, "--corpus", corpus, "--output", str(target)])
    rec = read_json(target)
    if rec is None:
        rec = {"arm": arm, "corpus": corpus, "cmd": command, "rc": rc, "ppl": None, "ppl_err": None, "n_chunks": None, "wall_s": None, "status": "FAILED"}
        write_json(target, rec)
    manifest.setdefault("ppl", {}).setdefault(arm, {})[corpus] = rec
    save_manifest(manifest)
    log(f"CELL_DONE {arm}/{corpus} rc={rec.get('rc')} ppl={rec.get('ppl')} chunks={rec.get('n_chunks')} wall_s={rec.get('wall_s')}")
    return rec


def quant_command(label: str) -> list[str]:
    if label == "C1":
        return [str(QUANTBIN), "--tensor-type", C1_PATTERNS[0], "--tensor-type", C1_PATTERNS[1], "--tensor-type", C1_PATTERNS[2], "--tensor-type", C1_PATTERNS[3], "--tensor-type", C1_PATTERNS[4], "--tensor-type", C1_PATTERNS[5], "--output-tensor-type", "Q8_0", "--token-embedding-type", "Q8_0", str(BF16), str(C1), "IQ4_NL", "8"]
    return [str(QUANTBIN), "--pure", "--output-tensor-type", "Q8_0", "--token-embedding-type", "Q8_0", str(BF16), str(C2), "IQ4_NL", "8"]


def run_quant(manifest: dict, label: str, output: Path) -> dict:
    target = CELL_DIR / f"quant-{label.lower()}.json"
    existing = read_json(target)
    if existing and existing.get("status") == "COMPLETE" and output.exists():
        log(f"SKIP complete QUANT {label} sha256={existing.get('sha256', {}).get('output')}")
        write_status(f"QUANT {label}", "DONE", SKIP="complete")
        return existing
    if output.exists():
        log(f"REMOVE partial output {output}")
        output.unlink()
    command = quant_command(label)
    log(f"CMD {cmd_text(command)}")
    log_path = HERE / f"quantize-{label.lower()}.log"
    rc = run_worker(f"QUANT {label}", f"QUANT {label}", EXEC_WORKER, ["--cell", f"QUANT-{label}", "--log", str(log_path), *command])
    result = {
        "phase": f"QUANT {label}", "status": "COMPLETE" if rc == 0 and output.exists() else "FAILED", "cmd": command,
        "input": str(BF16), "input_bytes": BF16.stat().st_size if BF16.exists() else None, "input_sha256": BF16_SHA,
        "output": str(output), "output_bytes": output.stat().st_size if output.exists() else None,
        "sha256": {"input": BF16_SHA, "output": sha256(output) if output.exists() else None},
        "ppl": None, "ppl_err": None, "n_chunks": None, "rc": rc, "wall_s": None, "log": str(log_path),
    }
    write_json(target, result)
    manifest.setdefault("quantization", {})[label] = result
    save_manifest(manifest)
    write_status(f"QUANT {label}", "DONE" if result["status"] == "COMPLETE" else "FAILED", RC=rc)
    return result


def run_dump(manifest: dict, label: str, model: Path) -> dict:
    target = CELL_DIR / f"dump-{label.lower()}.json"
    existing = read_json(target)
    if existing and existing.get("status") == "COMPLETE":
        log(f"SKIP complete DUMP {label} readability={existing.get('readability')}")
        write_status(f"DUMP {label}", "DONE", READABILITY=existing.get("readability"), SKIP="complete")
        manifest.setdefault("dumps", {})[label] = existing
        return existing
    if target.exists():
        target.unlink()
    command = [python_exe(), str(DUMP_SCRIPT), str(model), "--out", str(target), "--label", label]
    log(f"CMD {cmd_text(command)}")
    log_path = HERE / f"dump-{label.lower()}.log"
    if not model.exists():
        result = {"label": label, "model": str(model), "status": "FAILED", "readability": "INVALID", "unexpected_types": [], "sha256": None, "ppl": None, "ppl_err": None, "n_chunks": None, "rc": 1, "wall_s": 0.0, "cmd": command, "log": str(log_path), "error": "candidate missing"}
        write_json(target, result)
    else:
        rc = run_worker(f"DUMP {label}", f"DUMP {label}", EXEC_WORKER, ["--cell", f"DUMP-{label}", "--log", str(log_path), *command])
        result = read_json(target) or {"label": label, "status": "FAILED", "readability": "INVALID", "unexpected_types": []}
        result.update({"cmd": command, "log": str(log_path), "runner_rc": rc, "ppl": None, "ppl_err": None, "n_chunks": None, "wall_s": result.get("wall_s", 0.0)})
        if result.get("status") == "COMPLETE":
            result["rc"] = 0
        write_json(target, result)
    manifest.setdefault("dumps", {})[label] = result
    save_manifest(manifest)
    write_status(f"DUMP {label}", "DONE" if result.get("status") == "COMPLETE" else "FAILED", READABILITY=result.get("readability"))
    log(f"DUMP_DONE {label} status={result.get('status')} readability={result.get('readability')} unexpected={result.get('unexpected_types')}")
    return result


def skip_ppl_cell(manifest: dict, arm: str, corpus: str, model: Path, dump: dict) -> dict:
    target = ppl_output(arm, corpus)
    command = ppl_command(arm, corpus)
    result = {
        "arm": arm, "corpus": corpus, "model": str(model), "model_bytes": model.stat().st_size if model.exists() else None,
        "model_sha256": dump.get("sha256"), "file": str(CORPORA[corpus]), "file_bytes": CORPORA[corpus].stat().st_size if CORPORA[corpus].exists() else None,
        "file_sha256": CORPUS_SHA[corpus], "expected_chunks": EXPECTED_CHUNKS[corpus], "cmd": command,
        "ppl": None, "ppl_err": None, "n_chunks": None, "rc": None, "wall_s": 0.0, "log": None,
        "status": "SKIPPED_INVALID_READABILITY", "reason": "frozen HTP type check failed",
    }
    write_json(target, result)
    manifest.setdefault("ppl", {}).setdefault(arm, {})[corpus] = result
    save_manifest(manifest)
    log(f"SKIP {arm}/{corpus} invalid readability")
    write_status(f"PPL {arm} {corpus}", "SKIPPED", REASON="invalid readability")
    return result


def run_candidate_ppl(manifest: dict, label: str, model: Path, dump: dict) -> None:
    arm = {"C1": "candidate1", "C2": "candidate2"}[label]
    readable = dump.get("status") == "COMPLETE" and dump.get("readability") == "PASS"
    for corpus in CORPORA:
        if readable:
            run_ppl_cell(manifest, arm, corpus)
        else:
            skip_ppl_cell(manifest, arm, corpus, model, dump)


def valid_control_record(path: Path, corpus: str) -> dict | None:
    rec = read_json(path)
    if not rec or rec.get("rc") != 0 or not isinstance(rec.get("ppl"), (int, float)) or rec.get("n_chunks") != EXPECTED_CHUNKS[corpus]:
        return None
    return rec


def select_controls(manifest: dict, use_recheck: bool) -> dict:
    selection = {}
    for corpus in CORPORA:
        if use_recheck:
            path = ppl_output("control-recheck", corpus)
            rec = valid_control_record(path, corpus)
            selection[corpus] = {"json": str(path), "log": str(path.with_suffix(".log")), "sha256": rec.get("model_sha256") if rec else CONTROL_SHA, "ppl": rec.get("ppl") if rec else None, "n_chunks": rec.get("n_chunks") if rec else None, "source": "q63 control recheck"}
        else:
            path = Q59_CONTROL_JSON[corpus]
            rec = valid_control_record(path, corpus)
            selection[corpus] = {"json": str(path), "log": str(Q59_CONTROL_LOG[corpus]), "sha256": rec.get("model_sha256") if rec else CONTROL_SHA, "ppl": rec.get("ppl") if rec else None, "n_chunks": rec.get("n_chunks") if rec else None, "source": "q59 reused"}
    manifest["control_selection"] = selection
    save_manifest(manifest)
    return selection


def run_validity(manifest: dict) -> bool:
    write_status("VALIDITY", "STARTING", CELL="control-validity/fr")
    rec = run_ppl_cell(manifest, "control-validity", "fr")
    passed = bool(rec and rec.get("n_chunks") == 59 and isinstance(rec.get("ppl"), (int, float)) and abs(float(rec["ppl"]) - 7.1786) <= 0.0005)
    manifest["validity"] = {"json": str(ppl_output("control-validity", "fr")), "ppl": rec.get("ppl") if rec else None, "expected": 7.1786, "tolerance": 0.0005, "n_chunks": rec.get("n_chunks") if rec else None, "pass": passed}
    log(f"VALIDITY {'PASS' if passed else 'FAIL'} ppl={manifest['validity']['ppl']} expected=7.1786 tolerance=0.0005 chunks={manifest['validity']['n_chunks']}")
    if passed:
        select_controls(manifest, False)
        log("REUSE q59 control JSONs by path+sha256; no q59 file modified")
        write_status("VALIDITY", "PASS", CELL="control-validity/fr", PPL=rec.get("ppl"), CHUNKS=rec.get("n_chunks"))
        return True
    log("VALIDITY FAIL; rerun all five controls with rebuilt PPL before continuing")
    for corpus in CORPORA:
        run_ppl_cell(manifest, "control-recheck", corpus)
    select_controls(manifest, True)
    write_status("VALIDITY", "FAIL_RECHECKED", CELL="control-validity/fr")
    return False


def gate(manifest: dict) -> dict:
    controls = manifest.get("control_selection", {})
    gates = {}
    for arm in ("candidate1", "candidate2"):
        dump = manifest.get("dumps", {}).get(arm.replace("candidate", "C"), {})
        row = {}
        readable = dump.get("readability") == "PASS"
        for corpus in CORPORA:
            candidate = read_json(ppl_output(arm, corpus))
            control = read_json(Path(controls.get(corpus, {}).get("json", ""))) if controls.get(corpus) else None
            item = {"candidate": str(ppl_output(arm, corpus)), "control": controls.get(corpus, {}).get("json"), "chunks": candidate.get("n_chunks") if candidate else None, "ppl": candidate.get("ppl") if candidate else None, "ppl_err": candidate.get("ppl_err") if candidate else None, "control_ppl": control.get("ppl") if control else None, "delta_pct": None, "status": "SKIPPED_INVALID_READABILITY" if not readable else "MISSING"}
            if readable and candidate and control and candidate.get("rc") == 0 and control.get("rc") == 0 and candidate.get("n_chunks") == EXPECTED_CHUNKS[corpus] and control.get("n_chunks") == EXPECTED_CHUNKS[corpus]:
                item["delta_pct"] = 100.0 * (float(candidate["ppl"]) / float(control["ppl"]) - 1.0)
                item["status"] = "PASS" if item["delta_pct"] <= 1.0 else "FAIL"
            row[corpus] = item
        values = [item for item in row.values() if item["status"] in {"PASS", "FAIL"}]
        gates[arm] = {"corpora": row, "all_five": bool(len(values) == 5 and all(item["status"] == "PASS" for item in values)), "readability": "PASS" if readable else "INVALID"}
    manifest["gates"] = gates
    save_manifest(manifest)
    return gates


def write_report(manifest: dict) -> None:
    controls = manifest.get("control_selection", {})
    lines = ["# q63 REPORT — numbers-only", "", "| arm | corpus | chunks | PPL | err | control PPL | delta % | gate |", "|---|---|---:|---:|---:|---:|---:|---|"]
    for arm in ("candidate1", "candidate2"):
        for corpus in CORPORA:
            item = manifest.get("gates", {}).get(arm, {}).get("corpora", {}).get(corpus, {})
            def fmt(value: object, digits: int = 4) -> str:
                return "—" if value is None else f"{float(value):.{digits}f}"
            delta = "—" if item.get("delta_pct") is None else f"{float(item['delta_pct']):+.4f}%"
            lines.append(f"| {arm} | {corpus} | {item.get('chunks', '—')} | {fmt(item.get('ppl'))} | {fmt(item.get('ppl_err'))} | {fmt(item.get('control_ppl'))} | {delta} | {item.get('status', '—')} |")
    lines += ["", "| arm | bytes | sha256 | readability | all five gate |", "|---|---:|---|---|---|"]
    for arm, path in (("candidate1", C1), ("candidate2", C2)):
        quant = manifest.get("quantization", {}).get("C1" if arm == "candidate1" else "C2", {})
        dump = manifest.get("dumps", {}).get("C1" if arm == "candidate1" else "C2", {})
        lines.append(f"| {arm} | {quant.get('output_bytes', '—')} | {quant.get('sha256', {}).get('output', '—')} | {dump.get('readability', '—')} | {manifest.get('gates', {}).get(arm, {}).get('all_five', False)} |")
    (HERE / "REPORT.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def run_paired(manifest: dict) -> None:
    command = [python_exe(), str(PAIRED_SCRIPT)]
    log(f"CMD {cmd_text(command)}")
    run_worker("PAIRED", "PAIRED", EXEC_WORKER, ["--cell", "PAIRED", "--log", str(HERE / "paired-q63.log"), *command])


def main() -> int:
    ignore_console_signals()
    HERE.mkdir(parents=True, exist_ok=True)
    PPL_DIR.mkdir(parents=True, exist_ok=True)
    CELL_DIR.mkdir(parents=True, exist_ok=True)
    manifest = load_manifest()
    save_manifest(manifest)
    RUN_LOG.touch(exist_ok=True)
    log("START q63 locked scheduler; one child at a time; Idle; no q59 writes")
    write_status("VALIDITY", "STARTING", CELL="control-validity/fr")
    run_validity(manifest)
    log("PHASE QUANT C1")
    run_quant(manifest, "C1", C1)
    log("PHASE DUMP C1")
    dump1 = run_dump(manifest, "C1", C1)
    log("PHASE PPL C1")
    run_candidate_ppl(manifest, "C1", C1, dump1)
    log("PHASE QUANT C2")
    run_quant(manifest, "C2", C2)
    log("PHASE DUMP C2")
    dump2 = run_dump(manifest, "C2", C2)
    log("PHASE PPL C2")
    run_candidate_ppl(manifest, "C2", C2, dump2)
    log("PHASE GATE")
    write_status("GATE", "STARTING")
    gates = gate(manifest)
    write_report(manifest)
    log("PHASE PAIRED post-hoc non-gating")
    run_paired(manifest)
    log("PHASE REPORT")
    write_report(manifest)
    manifest["status"] = "DONE"
    manifest["finished_utc"] = now_utc()
    save_manifest(manifest)
    write_status("DONE", "COMPLETE", C1_GATE=gates.get("candidate1", {}).get("all_five"), C2_GATE=gates.get("candidate2", {}).get("all_five"))
    log("DONE q63")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        try:
            log(f"FATAL {type(exc).__name__}: {exc}")
            write_status("ERROR", "FAILED", ERROR=repr(exc))
        finally:
            raise
