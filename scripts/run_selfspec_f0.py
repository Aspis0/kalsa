#!/usr/bin/env python3
"""SELFSPEC F0 PC runner. No phones, no GGUF writes, does not kill LFM/Marco."""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any, TextIO

ROOT = Path(__file__).resolve().parents[1]
if str(Path(__file__).resolve().parent) not in sys.path:
    sys.path.insert(0, str(Path(__file__).resolve().parent))

from selfspec_f0_lib import (  # noqa: E402
    EARLY_POOR_ALPHA,
    GATE_ALPHA,
    METHOD_EXACT,
    PROMPT_IDS,
    PROMPT_SHA256,
    AcceptRow,
    RestartResult,
    dump_json,
    extract_done,
    pieces_from_progress,
    score_exact_restart,
    summarize_rows,
    write_acceptance_csv,
    write_detail_csv,
)

OUT = ROOT / "results" / "selfspec_f0"
BIN = ROOT / "build-pc" / "cli" / "bmoe-cli.exe"
MODEL = ROOT / "models" / "Qwen3.6-35B-A3B-KEXP.gguf"
STATUS = OUT / "STATUS.txt"
VERDICT = OUT / "VERDICT.txt"
MASTER = OUT / "run.master.log"
PC_BUSY = OUT / "PC_BUSY.txt"

PROMPT_PATHS = {
    "fact": ROOT / "results" / "marco_phase1" / "speed_s23" / "prompts" / "p_fact.txt",
    "creative": ROOT
    / "results"
    / "marco_phase1"
    / "speed_s23"
    / "prompts"
    / "p_creative.txt",
    "longfact": OUT / "prompts" / "p_longfact.txt",
    "code": OUT / "prompts" / "p_code.txt",
}

THREADS = "8"
N_CTX = "4096"
UBATCH = "512"
CACHE_MB = "2000"
IO_THREADS = "4"
N_TARGET = 300
N_SPEED = 128
SPEED_PROMPT = "longfact"
PUBLISHED_MODEL_SHA = "ac44e20c1783b9105b83246fd8ce59892b47a265b84e1323a8a501929877721a"
PUBLISHED_MODEL_SHA_SRC = "quality/ppl_baseline.json:111"
EXPECTED_MODEL_BYTES = 13416430592


def ts() -> str:
    return datetime.now().strftime("%Y-%m-%dT%H:%M:%S")


def log(msg: str) -> None:
    line = f"[{ts()}] {msg}"
    OUT.mkdir(parents=True, exist_ok=True)
    with MASTER.open("a", encoding="utf-8") as f:
        f.write(line + "\n")
    print(line, flush=True)


def set_status(s: str) -> None:
    STATUS.write_text(s + "\n", encoding="utf-8")
    log(f"STATUS {s}")


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def campaign_flags(k: int, drop: float | None) -> list[str]:
    flags = [
        str(BIN),
        "-m",
        str(MODEL),
        "-t",
        THREADS,
        "-c",
        N_CTX,
        "--ubatch",
        UBATCH,
        "--temp",
        "0",
        "--moe-stream",
        "--cache-mb",
        CACHE_MB,
        "--dense-weights",
        "anon",
        "--overlap",
        "--io-threads",
        IO_THREADS,
        "--n-expert-used",
        str(k),
        "--flash-attn",
        "off",
        "--ngl",
        "0",
        "--progress",
        "--session",
    ]
    if drop is not None:
        flags.extend(["--drop-cold-experts", f"{drop:g}"])
    return flags


def list_busy(exclude_pids: set[int] | None = None) -> list[str]:
    exclude = set(exclude_pids or ())
    exclude.add(os.getpid())
    ps = r"""
$busy = New-Object System.Collections.Generic.List[string]
Get-CimInstance Win32_Process | ForEach-Object {
  $n = $_.Name
  $c = [string]$_.CommandLine
  $id = $_.ProcessId
  $hit = $false
  if ($n -eq 'llama-quantize.exe' -or $n -eq 'llama-imatrix.exe') { $hit = $true }
  elseif ($n -eq 'bmoe-cli.exe') { $hit = $true }
  elseif ($n -eq 'python.exe' -and $c -match 'run_multi5_ppl_host\\.py') { $hit = $true }
  elseif ($n -match '^(pwsh|powershell)\\.exe$' -and $c -match '-File\\s+\\S*run_lfm25_kexp_when_idle\\.ps1') { $hit = $true }
  elseif ($n -match '^(pwsh|powershell)\\.exe$' -and $c -match '-File\\s+\\S*run_marcokexp_quality') { $hit = $true }
  if ($hit) { [void]$busy.Add(('{0}|{1}|{2}' -f $id, $n, $c.Substring(0, [Math]::Min(240, $c.Length)))) }
}
$busy -join "`n"
"""
    r = subprocess.run(
        ["powershell", "-NoProfile", "-Command", ps],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    out: list[str] = []
    for line in (r.stdout or "").splitlines():
        line = line.strip()
        if not line or "|" not in line:
            continue
        pid_s, name, rest = line.split("|", 2)
        try:
            pid = int(pid_s)
        except ValueError:
            continue
        if pid in exclude:
            continue
        out.append(f"{pid}:{name}:{rest}")
    return out


def kill_stale_selfspec() -> None:
    """Only our leftover KEXP session. Never LFM / Marco / quantize."""
    ps = r"""
Get-CimInstance Win32_Process | Where-Object {
  $_.Name -eq 'bmoe-cli.exe' -and [string]$_.CommandLine -match 'Qwen3.6-35B-A3B-KEXP' -and
  [string]$_.CommandLine -notmatch 'LFM2\.5' -and [string]$_.CommandLine -notmatch 'Marco-Mini'
} | ForEach-Object { $_.ProcessId }
"""
    r = subprocess.run(
        ["powershell", "-NoProfile", "-Command", ps],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    for line in (r.stdout or "").splitlines():
        line = line.strip()
        if not line.isdigit():
            continue
        pid = int(line)
        log(f"killing stale selfspec bmoe-cli pid={pid}")
        subprocess.run(["taskkill", "/PID", str(pid), "/F"], capture_output=True)


def write_busy_snapshot(reasons: list[str], header: str) -> None:
    mem = subprocess.run(
        [
            "powershell",
            "-NoProfile",
            "-Command",
            "Get-CimInstance Win32_OperatingSystem | Select-Object -ExpandProperty FreePhysicalMemory",
        ],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    free_kb = (mem.stdout or "").strip()
    lines = [
        header,
        f"time={ts()}",
        f"free_physical_memory_kb={free_kb}",
        "busy:",
    ]
    lines.extend("  " + r for r in reasons)
    lines.append("Do not kill LFM / Marco / quantize. Grid waits.")
    PC_BUSY.write_text("\n".join(lines) + "\n", encoding="utf-8")


class BmoeSession:
    def __init__(self, cmd: list[str], tag: str) -> None:
        self.cmd = cmd
        self.tag = tag
        self.proc: subprocess.Popen[bytes] | None = None
        self.stdin: TextIO | None = None
        self.stdout: TextIO | None = None
        self.ready: dict[str, Any] | None = None
        self.next_id = 1
        self.log_path = OUT / "logs" / f"{tag}.stdout.jsonl"
        self.err_path = OUT / "logs" / f"{tag}.stderr.log"
        self.log_path.parent.mkdir(parents=True, exist_ok=True)
        self._logf: TextIO | None = None

    def start(self, load_timeout_s: float = 1800.0) -> None:
        log("START " + " ".join(self.cmd))
        err = self.err_path.open("w", encoding="utf-8", errors="replace")
        self._logf = self.log_path.open("a", encoding="utf-8")
        self.proc = subprocess.Popen(
            self.cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=err,
            cwd=str(BIN.parent),
            bufsize=0,
        )
        assert self.proc.stdin is not None and self.proc.stdout is not None
        self.stdin = io.TextIOWrapper(
            self.proc.stdin,
            encoding="utf-8",
            errors="replace",
            line_buffering=True,
            write_through=True,
        )
        self.stdout = io.TextIOWrapper(
            self.proc.stdout, encoding="utf-8", errors="replace", newline=""
        )
        deadline = time.time() + load_timeout_s
        while time.time() < deadline:
            line = self._readline(deadline)
            if line is None:
                break
            if line.startswith("BMOE_READY "):
                parsed = json.loads(line[len("BMOE_READY ") :])
                self.ready = parsed
                log(f"READY {self.tag} {json.dumps(parsed, ensure_ascii=False)}")
                return
            if line.startswith("BMOE_ERROR "):
                raise RuntimeError(f"session error during load: {line}")
        raise RuntimeError(f"timeout waiting for BMOE_READY tag={self.tag}")

    def _readline(self, deadline: float) -> str | None:
        assert self.stdout is not None and self.proc is not None
        remain = deadline - time.time()
        if remain <= 0:
            return None
        # Blocking readline; the engine fflush-es every protocol line (cli/main.cpp:109).
        line = self.stdout.readline()
        if line == "" and self.proc.poll() is not None:
            return None
        if self._logf is not None:
            self._logf.write(line)
            self._logf.flush()
        return line

    def generate(
        self,
        prompt: str,
        n_predict: int,
        clear_kv: bool = True,
        timeout_s: float = 7200.0,
    ) -> RestartResult:
        if self.proc is None or self.stdin is None or self.stdout is None:
            raise RuntimeError("session not started")
        req_id = self.next_id
        self.next_id += 1
        req = {
            "cmd": "generate",
            "id": req_id,
            "prompt": prompt,
            "n_predict": int(n_predict),
            "think": False,
            "clear_kv": bool(clear_kv),
        }
        payload = json.dumps(req, ensure_ascii=False)
        log(
            f"GEN {self.tag} id={req_id} n_predict={n_predict} prefix_chars={len(prompt)}"
        )
        self.stdin.write(payload + "\n")
        self.stdin.flush()
        lines: list[str] = []
        deadline = time.time() + timeout_s
        while time.time() < deadline:
            line = self._readline(deadline)
            if line is None:
                rc = self.proc.poll()
                raise RuntimeError(f"session died during generate id={req_id} rc={rc}")
            lines.append(line.rstrip("\n"))
            if line.startswith("BMOE_DONE ") or line.startswith("BMOE_ERROR "):
                break
        else:
            raise RuntimeError(f"timeout generate id={req_id} tag={self.tag}")
        err = None
        for line in lines:
            if line.startswith("BMOE_ERROR "):
                err = line
        if err:
            raise RuntimeError(err)
        pieces, reset = pieces_from_progress(lines)
        done = extract_done(lines, req_id) or {}
        n_prompt = int(done.get("n_prompt", -1))
        log(
            f"DONE {self.tag} id={req_id} tokens={done.get('tokens')} tok_s={done.get('tok_s')} "
            f"n_prompt={n_prompt} pieces={len(pieces)} reset={int(reset)}"
        )
        return RestartResult(
            pieces=pieces, n_prompt=n_prompt, done=done, raw_lines=lines, reset=reset
        )

    def close(self) -> None:
        try:
            if (
                self.stdin is not None
                and self.proc is not None
                and self.proc.poll() is None
            ):
                self.stdin.write(json.dumps({"cmd": "close"}) + "\n")
                self.stdin.flush()
        except Exception as e:
            log(f"close write failed {self.tag}: {e}")
        if self.proc is not None:
            try:
                self.proc.wait(timeout=90)
            except subprocess.TimeoutExpired:
                log(f"killing hung session {self.tag} pid={self.proc.pid}")
                self.proc.kill()
                self.proc.wait(timeout=30)
        if self._logf is not None:
            self._logf.close()
            self._logf = None
        log(f"CLOSED {self.tag}")


def load_prompts() -> dict[str, str]:
    out: dict[str, str] = {}
    for pid in PROMPT_IDS:
        path = PROMPT_PATHS[pid]
        raw = path.read_bytes()
        text = raw.decode("utf-8")
        digest = hashlib.sha256(raw).hexdigest()
        expect = PROMPT_SHA256[pid]
        if digest != expect:
            raise RuntimeError(
                f"prompt sha mismatch {pid}: got {digest} want {expect} path={path}"
            )
        if not text.endswith("\n"):
            # Keep bytes as on disk; METHOD_PLAN hashes include the file as stored.
            pass
        out[pid] = text
        log(f"prompt {pid} bytes={len(raw)} sha256={digest}")
    return out


def save_target(pid: str, prompt: str, result: RestartResult) -> None:
    streams = OUT / "streams"
    streams.mkdir(parents=True, exist_ok=True)
    (streams / f"{pid}_target.jsonl").write_text(
        "\n".join(result.raw_lines) + "\n", encoding="utf-8"
    )
    text = ""
    if result.done:
        text = str(result.done.get("text", ""))
    if not text:
        text = "".join(result.pieces)
    (streams / f"{pid}_target.txt").write_text(text, encoding="utf-8")
    dump_json(
        streams / f"{pid}_target.pieces.json",
        {
            "prompt_id": pid,
            "n_prompt": result.n_prompt,
            "n_pieces": len(result.pieces),
            "pieces": result.pieces,
            "reset": result.reset,
            "done": result.done,
        },
    )
    dump_json(streams / f"{pid}_target.done.json", result.done)


def load_target_pieces(pid: str) -> dict[str, Any] | None:
    path = OUT / "streams" / f"{pid}_target.pieces.json"
    if not path.is_file():
        return None
    obj = json.loads(path.read_text(encoding="utf-8"))
    if not obj.get("pieces"):
        return None
    return obj


def drop_tag(drop: float | None) -> str:
    if drop is None:
        return "d0"
    return f"d{drop:g}".replace(".", "")


def draft_paths(pid: str, k: int, drop: float | None) -> dict[str, Path]:
    tag = f"{pid}_k{k}_{drop_tag(drop)}"
    acc = OUT / "acceptance"
    return {
        "detail": acc / f"{tag}.csv",
        "ckpt": acc / f"{tag}.ckpt.json",
    }


def rows_from_ckpt(
    obj: dict[str, Any],
) -> tuple[list[AcceptRow], int, int, str, int | None]:
    rows = [AcceptRow(**r) for r in obj.get("rows", [])]
    return (
        rows,
        int(obj.get("t", 0)),
        int(obj.get("restart_id", 0)),
        str(obj.get("method", METHOD_EXACT)),
        obj.get("prev_np"),
    )


def write_ckpt(
    path: Path, rows: list[AcceptRow], t: int, extra: dict[str, Any]
) -> None:
    payload = {
        "t": t,
        "rows": [r.__dict__ for r in rows],
        "restart_id": (max((r.restart_id for r in rows), default=-1) + 1),
        "method": rows[-1].method if rows else METHOD_EXACT,
        "prev_np": rows[-1].n_prompt if rows else None,
        **extra,
    }
    dump_json(path, payload)


def collect_all_rows() -> list[AcceptRow]:
    rows: list[AcceptRow] = []
    acc = OUT / "acceptance"
    if not acc.is_dir():
        return rows
    for p in sorted(acc.glob("*.ckpt.json")):
        obj = json.loads(p.read_text(encoding="utf-8"))
        rows.extend(AcceptRow(**r) for r in obj.get("rows", []))
    return rows


def write_outputs(
    rows: list[AcceptRow], notes: dict[str, Any], speed: dict[str, Any]
) -> dict[str, Any]:
    write_acceptance_csv(OUT / "acceptance.csv", rows)
    summary = summarize_rows(
        rows,
        pc_k2_toks=speed.get("k2_toks"),
        pc_k6_toks=speed.get("k6_toks"),
        pc_speed_n=speed.get("n"),
        pc_speed_prompt=speed.get("prompt"),
        notes=notes,
    )
    dump_json(OUT / "summary.json", summary)
    VERDICT.write_text(summary["verdict"] + "\n", encoding="utf-8")
    write_report(summary, notes, speed)
    return summary


def write_report(
    summary: dict[str, Any], notes: dict[str, Any], speed: dict[str, Any]
) -> None:
    primary = summary.get("primary_alpha")
    npos = summary.get("primary_n_positions")
    verdict = summary.get("verdict")
    lines = [
        "# moe-selfspec-f0",
        "",
        "**Mandate:** `mandates/selfspec-f0-acceptance.md`",
        "**Method:** `results/selfspec_f0/METHOD_PLAN.md` (EXACT-RESTART, WINDOWED-W16 fallback)",
        "**Host:** PC only. No phones.",
        "**STATUS:** see `results/selfspec_f0/STATUS.txt`",
        f"**VERDICT:** `{verdict}`",
        "",
        "## Gate",
        "",
        f"Primary: pooled teacher-forced token acceptance k=2 drop 0.65 "
        f">= {GATE_ALPHA:.2f} (`mandates/selfspec-f0-acceptance.md:29-30`).",
        f"Measured primary alpha = {primary} over n={npos} eligible positions.",
        f"MTP-style accept_rate at gamma=4 (empirical) = {summary.get('primary_mtp_style_accept_rate_gamma4')}.",
        "",
        "## Assets",
        "",
        f"- binary: `{BIN}` sha256={notes.get('bin_sha256')}",
        f"- model: `{MODEL}` size={notes.get('model_bytes')} published_sha={PUBLISHED_MODEL_SHA} ({PUBLISHED_MODEL_SHA_SRC})",
        f"- threads: -t {THREADS} (PC idle; METHOD_PLAN.md used -t 4 only while LFM held -t 8)",
        f"- flags: `{notes.get('flag_line')}`",
        "",
        "## Pooled acceptance",
        "",
        "```json",
        json.dumps(summary.get("pooled"), indent=2),
        "```",
        "",
        "## Per prompt",
        "",
        "```json",
        json.dumps(summary.get("per_prompt"), indent=2),
        "```",
        "",
        "## PC speed (one prompt, same n)",
        "",
        f"prompt={speed.get('prompt')} n={speed.get('n')} "
        f"k2={speed.get('k2_toks')} tok/s  k6={speed.get('k6_toks')} tok/s  "
        f"ratio={summary.get('pc_speed', {}).get('ratio_k2_over_k6')}",
        "",
        "Device k6 numbers are **not** PC measurements:",
        "- 5.861 tok/s S23 CPU k6d065 cache-2000 (`reports/moe-adopt-kexp.md:59`)",
        "- 2.901 tok/s S23 CPU k6 cache-1000 (`reports/moe-k4-split.md:311`)",
        "- 2.025 tok/s S23 GPU-split k6 cache-1000 (`reports/moe-k4-split.md:311`)",
        "",
        "Speedup arithmetic is STAND-IN (no batched verify): "
        "`t_step = gamma*t_k2 + (gamma+1)*t_k6`. Device k2 estimated from the PC ratio; "
        "device ratios will differ (`mandates/selfspec-f0-acceptance.md:28`).",
        "",
        "```json",
        json.dumps(summary.get("speedup_model"), indent=2),
        "```",
        "",
        "## Notes",
        "",
        "```json",
        json.dumps(notes, indent=2),
        "```",
        "",
    ]
    (ROOT / "reports" / "moe-selfspec-f0.md").write_text(
        "\n".join(lines), encoding="utf-8"
    )


def run_targets(session: BmoeSession, prompts: dict[str, str]) -> dict[str, Any]:
    meta: dict[str, Any] = {}
    for pid in PROMPT_IDS:
        existing = load_target_pieces(pid)
        if existing is not None:
            log(f"skip target {pid} n_pieces={existing['n_pieces']}")
            meta[pid] = {
                "skipped": True,
                "n_pieces": existing["n_pieces"],
                "n_prompt": existing.get("n_prompt"),
            }
            continue
        result = session.generate(prompts[pid], N_TARGET, clear_kv=True)
        save_target(pid, prompts[pid], result)
        meta[pid] = {
            "skipped": False,
            "n_pieces": len(result.pieces),
            "n_prompt": result.n_prompt,
            "tok_s": result.done.get("tok_s"),
            "tokens": result.done.get("tokens"),
        }
    return meta


def run_speed(session: BmoeSession, prompts: dict[str, str], k: int) -> dict[str, Any]:
    path = OUT / "streams" / f"speed_k{k}_n{N_SPEED}.json"
    if path.is_file():
        return json.loads(path.read_text(encoding="utf-8"))
    result = session.generate(prompts[SPEED_PROMPT], N_SPEED, clear_kv=True)
    rec = {
        "k": k,
        "n_predict": N_SPEED,
        "prompt": SPEED_PROMPT,
        "tok_s": result.done.get("tok_s"),
        "tokens": result.done.get("tokens"),
        "prefill_s": result.done.get("prefill_s"),
        "n_prompt": result.n_prompt,
        "done": result.done,
    }
    dump_json(path, rec)
    (OUT / "streams" / f"speed_k{k}_n{N_SPEED}.jsonl").write_text(
        "\n".join(result.raw_lines) + "\n", encoding="utf-8"
    )
    return rec


def run_draft(
    session: BmoeSession,
    prompts: dict[str, str],
    k: int,
    drop: float | None,
) -> list[AcceptRow]:
    all_rows: list[AcceptRow] = []
    drop_v = 0.0 if drop is None else drop
    for pid in PROMPT_IDS:
        gold_obj = load_target_pieces(pid)
        if gold_obj is None:
            raise RuntimeError(f"missing target stream for {pid}")
        gold: list[str] = list(gold_obj["pieces"])
        paths = draft_paths(pid, k, drop)
        start_t = 0
        start_rows: list[AcceptRow] = []
        start_rid = 0
        start_method = METHOD_EXACT
        start_prev = None
        if paths["ckpt"].is_file():
            ck = json.loads(paths["ckpt"].read_text(encoding="utf-8"))
            start_rows, start_t, start_rid, start_method, start_prev = rows_from_ckpt(
                ck
            )
            if start_t >= len(gold) and start_rows:
                log(
                    f"skip draft {pid} k={k} drop={drop} already done n={len(start_rows)}"
                )
                all_rows.extend(start_rows)
                continue
            log(
                f"resume draft {pid} k={k} drop={drop} t={start_t} rows={len(start_rows)}"
            )

        def gen(prefix: str, n_predict: int, _s=session) -> RestartResult:
            return _s.generate(prefix, n_predict, clear_kv=True)

        def on_update(rows: list[AcceptRow], t: int, _pid=pid, _paths=paths) -> None:
            write_detail_csv(_paths["detail"], rows)
            write_ckpt(
                _paths["ckpt"], rows, t, {"prompt": _pid, "k": k, "drop": drop_v}
            )

        rows = score_exact_restart(
            pid,
            prompts[pid],
            gold,
            k,
            drop_v,
            gen,
            n_prompt_0=int(gold_obj.get("n_prompt") or 0) or None,
            start_t=start_t,
            start_rows=start_rows,
            start_restart_id=start_rid,
            start_method=start_method,
            start_prev_np=start_prev,
            on_update=on_update,
        )
        write_detail_csv(paths["detail"], rows)
        write_ckpt(
            paths["ckpt"], rows, len(gold), {"prompt": pid, "k": k, "drop": drop_v}
        )
        all_rows.extend(rows)
        eligible = [r for r in all_rows if r.gate_eligible()]
        if eligible:
            a = sum(r.accept for r in eligible) / len(eligible)
            log(
                f"draft running pooled k={k} drop={drop} n={len(eligible)} alpha={a:.4f}"
            )
    return all_rows


def execute() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "streams").mkdir(exist_ok=True)
    (OUT / "acceptance").mkdir(exist_ok=True)
    (OUT / "logs").mkdir(exist_ok=True)

    kill_stale_selfspec()
    busy = list_busy()
    if busy:
        write_busy_snapshot(busy, "PC_BUSY — selfspec-f0 execute refused")
        set_status("BLOCKED_PC")
        log("busy: " + " || ".join(busy))
        return 3

    if not BIN.is_file():
        set_status("BLOCKED_NO_BIN")
        return 2
    if not MODEL.is_file():
        set_status("BLOCKED_NO_MODEL")
        return 2
    model_bytes = MODEL.stat().st_size
    if model_bytes != EXPECTED_MODEL_BYTES:
        set_status("BLOCKED_MODEL_SIZE")
        log(f"model size {model_bytes} != {EXPECTED_MODEL_BYTES}")
        return 2

    set_status("RUNNING")
    bin_sha = sha256_file(BIN)
    log(f"bin sha256={bin_sha} size={BIN.stat().st_size}")
    prompts = load_prompts()

    notes: dict[str, Any] = {
        "started": ts(),
        "bin_sha256": bin_sha,
        "bin_version_expected": "0.19.0",
        "model_bytes": model_bytes,
        "model_published_sha256": PUBLISHED_MODEL_SHA,
        "model_published_sha_source": PUBLISHED_MODEL_SHA_SRC,
        "model_hashed_this_run": False,
        "threads": int(THREADS),
        "n_target": N_TARGET,
        "n_speed": N_SPEED,
        "method": "EXACT-RESTART with WINDOWED-W16 fallback",
        "method_plan": "results/selfspec_f0/METHOD_PLAN.md",
        "chatml": False,
        "flag_line": (
            f"-t {THREADS} -c {N_CTX} --ubatch {UBATCH} --temp 0 --moe-stream "
            f"--cache-mb {CACHE_MB} --dense-weights anon --overlap --io-threads {IO_THREADS} "
            "--flash-attn off --ngl 0 --progress --session"
        ),
        "thread_note": (
            "METHOD_PLAN.md:103 used -t 4 while LFM PPL held -t 8. "
            "This execute uses -t 8 as specified for idle PC "
            "(mandates/selfspec-f0-acceptance.md campaign flags this turn)."
        ),
    }
    dump_json(OUT / "RUN_META.json", notes)

    speed: dict[str, Any] = {
        "n": N_SPEED,
        "prompt": SPEED_PROMPT,
        "k2_toks": None,
        "k6_toks": None,
    }

    target_session: BmoeSession | None = None
    try:
        target_session = BmoeSession(campaign_flags(6, 0.65), "target_k6_d065")
        target_session.start()
        notes["target_ready"] = target_session.ready
        notes["targets"] = run_targets(target_session, prompts)
        sp6 = run_speed(target_session, prompts, 6)
        speed["k6_toks"] = sp6.get("tok_s")
        notes["speed_k6"] = {
            k: sp6[k]
            for k in (
                "k",
                "n_predict",
                "prompt",
                "tok_s",
                "tokens",
                "prefill_s",
                "n_prompt",
            )
        }
    finally:
        if target_session is not None:
            target_session.close()

    draft_rows: list[AcceptRow] = []
    d065: BmoeSession | None = None
    try:
        d065 = BmoeSession(campaign_flags(2, 0.65), "draft_k2_d065")
        d065.start()
        notes["draft_k2_d065_ready"] = d065.ready
        sp2 = run_speed(d065, prompts, 2)
        speed["k2_toks"] = sp2.get("tok_s")
        notes["speed_k2"] = {
            k: sp2[k]
            for k in (
                "k",
                "n_predict",
                "prompt",
                "tok_s",
                "tokens",
                "prefill_s",
                "n_prompt",
            )
        }
        draft_rows.extend(run_draft(d065, prompts, 2, 0.65))
    finally:
        if d065 is not None:
            d065.close()

    early = [
        r
        for r in draft_rows
        if r.k_draft == 2 and abs(r.drop - 0.65) < 1e-9 and r.gate_eligible()
    ]
    if early:
        a = sum(r.accept for r in early) / len(early)
        notes["k2_d065_after_primary"] = {"n": len(early), "alpha": a}
        if a < EARLY_POOR_ALPHA:
            log(
                f"k=2 d0.65 alpha={a:.4f} < 0.50; finishing drop-0 then k=3 on same streams"
            )

    d0: BmoeSession | None = None
    try:
        d0 = BmoeSession(campaign_flags(2, None), "draft_k2_d0")
        d0.start()
        notes["draft_k2_d0_ready"] = d0.ready
        draft_rows.extend(run_draft(d0, prompts, 2, None))
    finally:
        if d0 is not None:
            d0.close()

    primary = [
        r
        for r in draft_rows
        if r.k_draft == 2 and abs(r.drop - 0.65) < 1e-9 and r.gate_eligible()
    ]
    primary_alpha = (sum(r.accept for r in primary) / len(primary)) if primary else None
    notes["k2_d065_pooled"] = {"n": len(primary), "alpha": primary_alpha}
    if primary_alpha is not None and primary_alpha < GATE_ALPHA:
        log(f"k=2 d0.65 alpha={primary_alpha:.4f} < {GATE_ALPHA}; running k=3 d0.65")
        d3: BmoeSession | None = None
        try:
            d3 = BmoeSession(campaign_flags(3, 0.65), "draft_k3_d065")
            d3.start()
            notes["draft_k3_d065_ready"] = d3.ready
            draft_rows.extend(run_draft(d3, prompts, 3, 0.65))
        finally:
            if d3 is not None:
                d3.close()

    notes["finished"] = ts()
    dump_json(OUT / "RUN_META.json", notes)
    summary = write_outputs(draft_rows, notes, speed)
    set_status("DONE")
    log(
        f"VERDICT {summary['verdict']} alpha={summary.get('primary_alpha')} n={summary.get('primary_n_positions')}"
    )
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--execute", action="store_true", help="run the grid (requires idle PC)"
    )
    ap.add_argument(
        "--summarize-only", action="store_true", help="rebuild csv/summary from ckpts"
    )
    args = ap.parse_args()
    if args.summarize_only:
        rows = collect_all_rows()
        notes = {}
        meta = OUT / "RUN_META.json"
        if meta.is_file():
            notes = json.loads(meta.read_text(encoding="utf-8"))
        speed = {"n": N_SPEED, "prompt": SPEED_PROMPT, "k2_toks": None, "k6_toks": None}
        for k, key in ((2, "k2_toks"), (6, "k6_toks")):
            p = OUT / "streams" / f"speed_k{k}_n{N_SPEED}.json"
            if p.is_file():
                speed[key] = json.loads(p.read_text(encoding="utf-8")).get("tok_s")
        write_outputs(rows, notes, speed)
        return 0
    if not args.execute:
        print("usage: run_selfspec_f0.py --execute | --summarize-only", file=sys.stderr)
        return 2
    try:
        return execute()
    except Exception as e:
        log(f"FATAL {type(e).__name__}: {e}")
        set_status("BLOCKED_ENGINE")
        raise


if __name__ == "__main__":
    sys.exit(main())
