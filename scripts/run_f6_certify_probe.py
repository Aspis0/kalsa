#!/usr/bin/env python3
"""F6 certify-probe runner.

Kill-or-go measurement: teacher-forced argmax agreement of top-j experts
(j=1..5, d0) vs the F0 k=6 d0.65 gold streams on CalaQwen.

Reuses scripts/selfspec_f0_lib.py (EXACT-RESTART). Does not import
run_selfspec_f0.py — that module kills any bmoe-cli on Qwen3.6-35B-A3B-KEXP
and would murder the live CalaQwen drop curve.

Constraints:
  - never kill a process we did not start (pid file only)
  - never write under results/selfspec_f0/ or results/calaqwen_dropcurve/
  - never enter BigMoeOnEdge-selfspec-f1/build/
  - a truncated arm is invalid and is not tabled
  - no timings in the report (PC is contended)
"""

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
    PROMPT_IDS,
    PROMPT_SHA256,
    AcceptRow,
    RestartResult,
    dump_json,
    extract_done,
    pieces_from_progress,
    score_exact_restart,
    write_detail_csv,
)

OUT = ROOT / "results" / "f6_certify_probe"
F0 = ROOT / "results" / "selfspec_f0"
BIN = ROOT / "build-pc" / "cli" / "bmoe-cli.exe"
MODEL = ROOT / "models" / "Qwen3.6-35B-A3B-KEXP.gguf"
STATUS = OUT / "STATUS.txt"
MASTER = OUT / "run.master.log"
PIDFILE = OUT / "bmoe.pid.txt"
F0_K2_POOLED = 0.6904532304725168
F0_K2_N = 1037
EXPECTED_N = {"fact": 203, "creative": 234, "longfact": 300, "code": 300}
EXPECTED_TOTAL = 1037
HARNESS_ABS_TOL = 0.02
K2_PER_PROMPT = {
    "fact": 0.5615763546798029,
    "creative": 0.5256410256410257,
    "longfact": 0.8366666666666667,
    "code": 0.76,
}
PUBLISHED_MODEL_SHA = "ac44e20c1783b9105b83246fd8ce59892b47a265b84e1323a8a501929877721a"
EXPECTED_MODEL_BYTES = 13416430592
KS = (2, 3, 4, 5, 1)  # k=2 first: harness check. k=3 is the GO/DEAD number.

PROMPT_PATHS = {
    "fact": ROOT / "results" / "marco_phase1" / "speed_s23" / "prompts" / "p_fact.txt",
    "creative": F0 / "prompts" / "p_creative.txt",
    "longfact": F0 / "prompts" / "p_longfact.txt",
    "code": F0 / "prompts" / "p_code.txt",
}

# Match F0 campaign flags except -t 4 (METHOD_PLAN used -t 4 on a busy PC).
# Argmax is deterministic; threads do not enter the table.
THREADS = "4"
N_CTX = "4096"
UBATCH = "512"
CACHE_MB = "2000"
IO_THREADS = "4"
# Cap decode length per restart. Accept bits are prefix-of-greedy, so a cap
# does not change agreement — it only avoids generating the unused tail after
# the first mismatch (F0 requested n_gold-t and threw the tail away).
MAX_GEN = 16


def ts() -> str:
    return datetime.now().strftime("%Y-%m-%dT%H:%M:%S")


def log(msg: str) -> None:
    line = f"[{ts()}] {msg}"
    OUT.mkdir(parents=True, exist_ok=True)
    with MASTER.open("a", encoding="utf-8") as f:
        f.write(line + "\n")
    # Detached PowerShell *>> redirection makes flush() raise
    # OSError 22 (Invalid argument) on this box. The master log is ground truth.
    try:
        print(line, flush=True)
    except OSError:
        pass


def set_status(s: str) -> None:
    STATUS.write_text(s + "\n", encoding="utf-8")
    log(f"STATUS {s}")


def write_pid(pid: int) -> None:
    PIDFILE.write_text(str(pid) + "\n", encoding="utf-8")


def clear_pid() -> None:
    if PIDFILE.is_file():
        PIDFILE.unlink()


def kill_our_bmoe_only() -> None:
    """Kill only the pid we recorded. Never scan by model name."""
    if not PIDFILE.is_file():
        return
    raw = PIDFILE.read_text(encoding="utf-8").strip()
    if not raw.isdigit():
        return
    pid = int(raw)
    try:
        # Confirm it is still a bmoe-cli we started.
        r = subprocess.run(
            [
                "powershell",
                "-NoProfile",
                "-Command",
                f"(Get-Process -Id {pid} -ErrorAction SilentlyContinue).Name",
            ],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        name = (r.stdout or "").strip()
        if name.lower() != "bmoe-cli":
            log(f"pidfile {pid} is {name or 'gone'}; not killing")
            clear_pid()
            return
        log(f"killing our leftover bmoe-cli pid={pid}")
        subprocess.run(["taskkill", "/PID", str(pid), "/F"], capture_output=True)
    finally:
        clear_pid()


def campaign_flags(k: int) -> list[str]:
    return [
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
        "--progress",
        "--session",
    ]


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
        write_pid(self.proc.pid)
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
        timeout_s: float = 3600.0,
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
            f"DONE {self.tag} id={req_id} tokens={done.get('tokens')} "
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
        clear_pid()
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
        out[pid] = text
        log(f"prompt {pid} bytes={len(raw)} sha256={digest}")
    return out


def load_target_pieces(pid: str) -> dict[str, Any]:
    path = F0 / "streams" / f"{pid}_target.pieces.json"
    if not path.is_file():
        raise RuntimeError(f"missing F0 gold stream {path}")
    obj = json.loads(path.read_text(encoding="utf-8"))
    pieces = obj.get("pieces") or []
    if len(pieces) != EXPECTED_N[pid]:
        raise RuntimeError(
            f"gold {pid} n_pieces={len(pieces)} want {EXPECTED_N[pid]}"
        )
    return obj


def draft_paths(pid: str, k: int) -> dict[str, Path]:
    tag = f"{pid}_k{k}_d0"
    acc = OUT / "acceptance"
    return {"detail": acc / f"{tag}.csv", "ckpt": acc / f"{tag}.ckpt.json"}


def rows_from_ckpt(
    obj: dict[str, Any],
) -> tuple[list[AcceptRow], int, int, str, int | None]:
    rows = [AcceptRow(**r) for r in obj.get("rows", [])]
    return (
        rows,
        int(obj.get("t", 0)),
        int(obj.get("restart_id", 0)),
        str(obj.get("method", "EXACT-RESTART")),
        obj.get("prev_np"),
    )


def write_ckpt(path: Path, rows: list[AcceptRow], t: int, extra: dict[str, Any]) -> None:
    payload = {
        "t": t,
        "rows": [r.__dict__ for r in rows],
        "restart_id": (max((r.restart_id for r in rows), default=-1) + 1),
        "method": rows[-1].method if rows else "EXACT-RESTART",
        "prev_np": rows[-1].n_prompt if rows else None,
        **extra,
    }
    dump_json(path, payload)


def arm_complete(pid: str, k: int) -> bool:
    ck = draft_paths(pid, k)["ckpt"]
    if not ck.is_file():
        return False
    obj = json.loads(ck.read_text(encoding="utf-8"))
    rows = obj.get("rows") or []
    return int(obj.get("t", 0)) >= EXPECTED_N[pid] and len(rows) == EXPECTED_N[pid]


def load_arm_rows(k: int) -> list[AcceptRow]:
    rows: list[AcceptRow] = []
    for pid in PROMPT_IDS:
        ck = draft_paths(pid, k)["ckpt"]
        if not ck.is_file():
            continue
        obj = json.loads(ck.read_text(encoding="utf-8"))
        rows.extend(AcceptRow(**r) for r in obj.get("rows", []))
    return rows


def validate_arm(k: int, rows: list[AcceptRow]) -> dict[str, Any]:
    per: dict[str, Any] = {}
    ok = True
    reasons: list[str] = []
    for pid in PROMPT_IDS:
        sub = [r for r in rows if r.prompt == pid]
        n = len(sub)
        n_elig = sum(1 for r in sub if r.gate_eligible())
        want = EXPECTED_N[pid]
        pid_ok = n == want
        if not pid_ok:
            ok = False
            reasons.append(f"{pid}: n={n} want={want}")
        per[pid] = {
            "n_rows": n,
            "n_eligible": n_elig,
            "expected": want,
            "valid": pid_ok,
        }
    n_all = len(rows)
    n_elig = sum(1 for r in rows if r.gate_eligible())
    if n_all != EXPECTED_TOTAL:
        ok = False
        reasons.append(f"pooled n={n_all} want={EXPECTED_TOTAL}")
    acc = [r.accept for r in rows if r.gate_eligible()]
    alpha = (sum(acc) / len(acc)) if acc else None
    return {
        "k": k,
        "valid": ok,
        "n_rows": n_all,
        "n_eligible": n_elig,
        "n_accepted": sum(acc) if acc else 0,
        "alpha": alpha,
        "per_prompt": per,
        "reasons": reasons,
    }


def run_draft(
    session: BmoeSession, prompts: dict[str, str], k: int
) -> list[AcceptRow]:
    all_rows: list[AcceptRow] = []
    for pid in PROMPT_IDS:
        gold_obj = load_target_pieces(pid)
        gold: list[str] = list(gold_obj["pieces"])
        paths = draft_paths(pid, k)
        start_t = 0
        start_rows: list[AcceptRow] = []
        start_rid = 0
        start_method = "EXACT-RESTART"
        start_prev = None
        if paths["ckpt"].is_file():
            ck = json.loads(paths["ckpt"].read_text(encoding="utf-8"))
            start_rows, start_t, start_rid, start_method, start_prev = rows_from_ckpt(ck)
            if start_t >= len(gold) and len(start_rows) == len(gold):
                log(f"skip draft {pid} k={k} already done n={len(start_rows)}")
                all_rows.extend(start_rows)
                continue
            log(f"resume draft {pid} k={k} t={start_t} rows={len(start_rows)}")

        def gen(prefix: str, n_predict: int, _s=session) -> RestartResult:
            return _s.generate(prefix, min(int(n_predict), MAX_GEN), clear_kv=True)

        def on_update(rows: list[AcceptRow], t: int, _pid=pid, _paths=paths) -> None:
            write_detail_csv(_paths["detail"], rows)
            write_ckpt(
                _paths["ckpt"], rows, t, {"prompt": _pid, "k": k, "drop": 0.0}
            )
            (OUT / "heartbeat.txt").write_text(
                f"{ts()} k={k} prompt={_pid} t={t}/{EXPECTED_N[_pid]} rows={len(rows)}\n",
                encoding="utf-8",
            )

        rows = score_exact_restart(
            pid,
            prompts[pid],
            gold,
            k,
            0.0,
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
        write_ckpt(paths["ckpt"], rows, len(gold), {"prompt": pid, "k": k, "drop": 0.0})
        all_rows.extend(rows)
        eligible = [r for r in all_rows if r.gate_eligible()]
        if eligible:
            a = sum(r.accept for r in eligible) / len(eligible)
            log(f"draft running pooled k={k} n={len(eligible)} alpha={a:.4f}")
    return all_rows


def import_f0_k2() -> list[AcceptRow]:
    """Copy F0 k2_d0 ckpts into our outdir (bits only; no re-generation)."""
    rows: list[AcceptRow] = []
    for pid in PROMPT_IDS:
        src = F0 / "acceptance" / f"{pid}_k2_d0.ckpt.json"
        if not src.is_file():
            raise RuntimeError(f"missing F0 k2 ckpt {src}")
        obj = json.loads(src.read_text(encoding="utf-8"))
        imported = [AcceptRow(**r) for r in obj.get("rows", [])]
        if len(imported) != EXPECTED_N[pid]:
            raise RuntimeError(
                f"F0 k2 {pid} n={len(imported)} want {EXPECTED_N[pid]}"
            )
        paths = draft_paths(pid, 2)
        write_detail_csv(paths["detail"], imported)
        write_ckpt(
            paths["ckpt"],
            imported,
            EXPECTED_N[pid],
            {"prompt": pid, "k": 2, "drop": 0.0, "imported_from": str(src)},
        )
        rows.extend(imported)
        log(f"imported F0 k2_d0 {pid} n={len(imported)}")
    return rows


def alpha_of(rows: list[AcceptRow]) -> float | None:
    acc = [r.accept for r in rows if r.gate_eligible()]
    if not acc:
        return None
    return sum(acc) / len(acc)


def _aligned_tokens(
    by_k: dict[int, list[AcceptRow]], needed: tuple[int, ...]
) -> list[tuple[tuple[str, int], dict[int, str], str]]:
    index: dict[int, dict[tuple[str, int], AcceptRow]] = {}
    for k, rows in by_k.items():
        index[k] = {(r.prompt, r.pos): r for r in rows if r.gate_eligible()}
    gold_src = max(needed)
    gold_index = {
        (r.prompt, r.pos): r.gold_piece for r in by_k[gold_src] if r.gate_eligible()
    }
    out: list[tuple[tuple[str, int], dict[int, str], str]] = []
    for key, gold in gold_index.items():
        toks: dict[int, str] = {}
        missing = False
        for j in needed:
            row = index.get(j, {}).get(key)
            if row is None:
                missing = True
                break
            toks[j] = row.draft_piece
        if missing:
            continue
        out.append((key, toks, gold))
    return out


def fallback_policy(by_k: dict[int, list[AcceptRow]]) -> dict[str, Any]:
    """Certify at the first j where argmax was stable for one step, else 6."""
    needed = (1, 2, 3, 4, 5)
    if any(k not in by_k for k in needed):
        return {"available": False, "reason": "need valid arms k=1..5"}
    rows = _aligned_tokens(by_k, needed)
    if not rows:
        return {"available": False, "reason": "no aligned positions"}
    used: list[int] = []
    correct = 0
    hist = {j: 0 for j in (2, 3, 4, 5, 6)}
    for _key, toks, gold in rows:
        certified_j = 6
        certified_tok = gold
        for j in (2, 3, 4, 5):
            if toks[j] == toks[j - 1]:
                certified_j = j
                certified_tok = toks[j]
                break
        used.append(certified_j)
        hist[certified_j] += 1
        if certified_tok == gold:
            correct += 1
    n = len(rows)
    return {
        "available": True,
        "policy": "first j>=2 where argmax(j)==argmax(j-1), else 6",
        "n": n,
        "mean_experts": sum(used) / n,
        "beta_vs_k6": (sum(used) / n) / 6.0,
        "error_rate": 1.0 - (correct / n),
        "n_correct": correct,
        "hist_j": hist,
    }


def oracle_first_hit(by_k: dict[int, list[AcceptRow]]) -> dict[str, Any]:
    """Smallest j whose partial argmax already equals the k=6 gold token.

    Lower bound on experts for any sound certifier that only inspects the
    top-j-by-gate expert set (a bound cannot certify the gold token before
    it is the partial argmax). Not a runtime policy — it peeks at gold.
    """
    needed = (1, 2, 3, 4, 5)
    have = tuple(j for j in needed if j in by_k)
    if not have:
        return {"available": False, "reason": "no valid arms"}
    rows = _aligned_tokens(by_k, have)
    if not rows:
        return {"available": False, "reason": "no aligned positions"}
    used: list[int] = []
    hist = {j: 0 for j in list(have) + [6]}
    for _key, toks, gold in rows:
        hit = 6
        for j in have:
            if toks[j] == gold:
                hit = j
                break
        used.append(hit)
        hist[hit] += 1
    n = len(rows)
    return {
        "available": True,
        "policy": "min j in measured set whose argmax equals k=6 gold, else 6",
        "measured_js": list(have),
        "n": n,
        "mean_experts": sum(used) / n,
        "beta_vs_k6": (sum(used) / n) / 6.0,
        "hist_j": hist,
        "note": (
            "Peeks at gold. A real certifier cannot use this. It is the "
            "information-theoretic floor given only the top-j argmax sequence."
        ),
    }


def thresholded_generation_note(curve: list[dict[str, Any]]) -> dict[str, Any]:
    """Smallest j whose fixed-j agreement is already the 'certified' token."""
    by_j = {int(c["k"]): c for c in curve if c.get("valid")}
    return {
        "point": (
            "If expert skipping makes verification cheap, the same skip makes "
            "plain decoding cheap. Certification is only cheaper than "
            "thresholded generation when a bound lets you stop earlier than "
            "the j you would pick to *compute* the argmax. This probe has no "
            "top-2 logits, so it cannot show that bound. Fixed-j agreement "
            "is the same number for 'generate at k=j' and 'verify at k=j'."
        ),
        "agreement_is_shared": True,
        "curve_js": sorted(by_j),
    }


def build_report(
    validations: dict[int, dict[str, Any]],
    notes: dict[str, Any],
    fallback: dict[str, Any],
    oracle: dict[str, Any],
) -> str:
    curve = []
    for k in (1, 2, 3, 4, 5):
        v = validations.get(k)
        if v is None:
            curve.append({"k": k, "valid": False, "reason": "not run"})
        else:
            curve.append(v)

    j3 = validations.get(3)
    j3_alpha = j3.get("alpha") if j3 and j3.get("valid") else None
    mean_j = fallback.get("mean_experts") if fallback.get("available") else None
    beta = fallback.get("beta_vs_k6") if fallback.get("available") else None
    oracle_mean = oracle.get("mean_experts") if oracle.get("available") else None
    oracle_beta = oracle.get("beta_vs_k6") if oracle.get("available") else None

    # Verdict is against the 0.56 β line. Primary read is fixed-j=3 agreement
    # (the bands in the mandate). Oracle first-hit is the floor for any sound
    # top-j certifier; if even the oracle is ≥ 3.36, the technique is dead.
    if j3_alpha is None:
        verdict = "INCOMPLETE"
        verdict_why = "k=3 arm is not valid; no GO/DEAD."
    elif oracle_mean is not None and oracle_mean >= 3.36:
        verdict = "DEAD"
        verdict_why = (
            f"Even the gold-peeking oracle averages {oracle_mean:.2f} experts "
            f"(β={oracle_beta:.3f} ≥ 0.56). No sound top-j certifier can beat "
            f"the byte line. j=3 agreement={j3_alpha:.4f}."
        )
    elif j3_alpha >= 0.95:
        verdict = "GO"
        verdict_why = (
            f"j=3 agreement={j3_alpha:.4f} ≥ 0.95. Adaptive certification "
            "with fallback is plausible under the 3.3-expert / β<0.56 line."
        )
    elif j3_alpha <= 0.85:
        verdict = "DEAD"
        verdict_why = (
            f"j=3 agreement={j3_alpha:.4f} in/below the 0.75–0.85 band. "
            "Fallback to k=6 fires too often; average experts land near 4–5. "
            "DEAD on bytes."
        )
    else:
        if mean_j is not None and mean_j < 3.36 and fallback.get("error_rate", 1) <= 0.05:
            verdict = "GO"
            verdict_why = (
                f"j=3 agreement={j3_alpha:.4f} is between 0.85 and 0.95, but "
                f"the stability policy averages {mean_j:.2f} experts "
                f"(β={beta:.3f} < 0.56) with error {fallback['error_rate']:.3f}."
            )
        else:
            verdict = "DEAD"
            extra = (
                f" stability-policy mean j={mean_j:.2f} β={beta:.3f} "
                f"err={fallback.get('error_rate')}."
                if mean_j is not None
                else ""
            )
            verdict_why = (
                f"j=3 agreement={j3_alpha:.4f} is below 0.95 and not clearly "
                f"in the GO band.{extra} Not enough to beat β<0.56."
            )

    k2 = validations.get(2)
    harness = notes.get("harness") or {}

    lines = [
        "# F6 certify probe",
        "",
        "Kill-or-go measurement, not a cell. No pre-registration, no p-value, no claim.",
        "",
        f"**VERDICT: {verdict}**",
        "",
        verdict_why,
        "",
        "Break-even for the measured self-spec regime (γ=4, α=1/3, L≈3):",
        "",
        "    β < 1 − γα/L = 1 − (4/3)/3 ≈ 0.56  →  fewer than ~3.3 experts on average",
        "",
        "If β ≥ 1, speculation cannot beat plain decode even with free drafts.",
        "The only escape is β < 1, i.e. verification that reads fewer expert bytes",
        "than plain k=6 generation.",
        "",
        "## Method",
        "",
        "- Model: `models/Qwen3.6-35B-A3B-KEXP.gguf` (CalaQwen), published sha "
        f"`{PUBLISHED_MODEL_SHA}`.",
        f"- Binary: `{BIN}` (F0 campaign binary, not the drop-curve ppl binary).",
        "- Gold: F0 teacher-forced streams, k=6 drop 0.65, 1037 pieces "
        "(fact 203, creative 234, longfact 300, code 300). "
        "Same gold as `reports/moe-selfspec-f0.md` k2_d0.",
        "- Draft: `--n-expert-used j` d0 (no drop) for j=1,2,3,4,5. "
        "The flag already selects the top-j experts by router gate weight.",
        "- Scoring: EXACT-RESTART via `--session` (`scripts/selfspec_f0_lib.py`).",
        f"- Restart decode cap: {MAX_GEN} tokens (accept bits are the greedy prefix; "
        "the cap does not change agreement, it only drops the unused tail F0 discarded).",
        f"- Threads: -t {THREADS} (busy PC; argmax is deterministic; **no timings reported**).",
        "- Drop-curve process (PID in `results/calaqwen_dropcurve/orchestrator.pid.txt`) "
        "was left running. This runner never kills by model name.",
        "",
        "## Validity gate",
        "",
        "An arm is tabled only if it produced exactly the expected number of scored "
        "positions (1037 pooled). Truncated arms are listed as invalid and do not "
        "enter the curve or the verdict.",
        "",
        "```json",
        json.dumps({str(k): validations.get(k) for k in (1, 2, 3, 4, 5)}, indent=2),
        "```",
        "",
        "## Harness check (k=2 vs F0 k2_d0 = 0.6905 / 1037)",
        "",
        "```json",
        json.dumps(harness, indent=2),
        "```",
        "",
        "## Agreement curve vs k=6 gold",
        "",
        "| j | valid | n | n_accept | agreement |",
        "|---|-------|---|----------|-----------|",
    ]
    for k in (1, 2, 3, 4, 5):
        v = validations.get(k)
        if not v:
            lines.append(f"| {k} | no | — | — | — |")
            continue
        if not v.get("valid"):
            lines.append(
                f"| {k} | no | {v.get('n_rows')} | {v.get('n_accepted')} | INVALID |"
            )
            continue
        a = v.get("alpha")
        lines.append(
            f"| {k} | yes | {v.get('n_eligible')} | {v.get('n_accepted')} | {a:.6f} |"
        )
    lines += [
        "",
        "Per-prompt agreement (valid arms only):",
        "",
        "```json",
        json.dumps(
            {
                str(k): {
                    pid: (
                        None
                        if not validations[k]["per_prompt"][pid]["valid"]
                        else (
                            sum(
                                r.accept
                                for r in load_arm_rows(k)
                                if r.prompt == pid and r.gate_eligible()
                            )
                            / validations[k]["per_prompt"][pid]["n_eligible"]
                            if validations[k]["per_prompt"][pid]["n_eligible"]
                            else None
                        )
                    )
                    for pid in PROMPT_IDS
                }
                for k in (1, 2, 3, 4, 5)
                if k in validations and validations[k].get("valid")
            },
            indent=2,
        ),
        "```",
        "",
        "## Top-2 logit margins",
        "",
        "**The campaign engine cannot emit top-2 logits. Not measured. Not faked.**",
        "",
        "What `build-pc/cli/bmoe-cli.exe` (F0 session binary) can emit:",
        "",
        "- `BMOE_PROGRESS`: `delta_text` of the greedy token, plus I/O/timing fields. "
        "No logit, no logprob, no token id, no runner-up.",
        "- `BMOE_DONE`: aggregate counters and the full text. No per-token scores.",
        "- `--ppl-csv` (with `--ppl-file` / `--ppl-decode`): `pos,token_id,logprob` "
        "of the *gold* token only. That is P(gold | prefix, k=j), not "
        "top-1 − top-2 under the partial expert set.",
        "- No `--n-probs`, no top-k logprob dump, no session field for the runner-up.",
        "",
        "The adaptive certifier the algebra needs ('stop when the margin exceeds "
        "what the missing experts could contribute') is therefore not instantiated "
        "here. The stability policy below is a *heuristic* that does not need "
        "logits; it can be wrong, and its error rate is reported.",
        "",
        "## Implied average expert count (stability fallback)",
        "",
        "Policy: certify at the first j ∈ {2,3,4,5} where argmax(j) == argmax(j−1); "
        "else load all 6. The certified token is argmax(j) (or the gold token when "
        "falling back to 6). This is *not* a sound bound.",
        "",
        "```json",
        json.dumps(fallback, indent=2),
        "```",
        "",
    ]
    if fallback.get("available"):
        lines += [
            f"Mean experts = **{fallback['mean_experts']:.4f}**  "
            f"(β = {fallback['beta_vs_k6']:.4f} vs the 0.56 line).",
            f"Heuristic error rate vs k=6 gold = **{fallback['error_rate']:.4f}** "
            f"({fallback['n'] - fallback['n_correct']}/{fallback['n']}).",
            "",
        ]
        if fallback["error_rate"] > 0.05:
            lines += [
                "That error rate is the reason margins matter. A stability stop "
                "at j=2 fires whenever k=1 and k=2 agree, including the large "
                "slice where both disagree with k=6. Without a bound this is "
                "not certification.",
                "",
            ]

    lines += [
        "## Oracle first-hit (not a runtime policy)",
        "",
        "Smallest measured j whose partial argmax already equals the k=6 gold. "
        "A sound bound cannot certify the gold token before it is the partial "
        "argmax, so this is the floor on average experts for any top-j-by-gate "
        "certifier. It peeks at gold; it cannot be implemented as-is.",
        "",
        "```json",
        json.dumps(oracle, indent=2),
        "```",
        "",
    ]
    if oracle.get("available"):
        lines += [
            f"Oracle mean experts = **{oracle['mean_experts']:.4f}**  "
            f"(β = {oracle['beta_vs_k6']:.4f}).",
            "",
        ]

    note = thresholded_generation_note(curve)
    lines += [
        "## Baseline moves: certification vs thresholded generation",
        "",
        note["point"],
        "",
        "Read the curve twice:",
        "",
        "1. As *verification cost* against a frozen k=6 gold (the F6 question).",
        "2. As *generation quality* of a plain k=j decode. Same number.",
        "",
        "If you are willing to emit the k=3 argmax as the token, you do not need "
        "speculation: just decode at k=3. Speculation plus certification wins "
        "only if a candidate token can be *proven* cheaper than recomputing the "
        "argmax — which needs the missing-expert bound this engine cannot emit.",
        "",
        "## How to read the verdict",
        "",
        "- Agreement at j=3 ≥ ~0.95 → adaptive certification with fallback "
        "plausibly averages under 3.3 experts. **GO**: F6 is worth building.",
        "- Agreement at j=3 ≈ 0.75–0.85 → fallback fires too often, average "
        "lands near 4–5. **DEAD on bytes.**",
        "- The 0.56 β line is the numeric kill switch. DEAD retires the "
        "technique for this regime; that outcome is worth as much as GO.",
        "",
        f"**VERDICT: {verdict}**",
        "",
        verdict_why,
        "",
        "## Notes",
        "",
        "```json",
        json.dumps(notes, indent=2),
        "```",
        "",
        "No timings. Contended PC (CalaQwen drop curve held -t 16 on the same GGUF).",
        "",
    ]
    return "\n".join(lines)


def write_outputs(notes: dict[str, Any]) -> dict[str, Any]:
    validations: dict[int, dict[str, Any]] = {}
    by_k: dict[int, list[AcceptRow]] = {}
    for k in (1, 2, 3, 4, 5):
        rows = load_arm_rows(k)
        if not rows:
            continue
        v = validate_arm(k, rows)
        validations[k] = v
        if v["valid"]:
            by_k[k] = [r for r in rows if r.gate_eligible()]
    fallback = fallback_policy(by_k)
    oracle = oracle_first_hit(by_k)
    report = build_report(validations, notes, fallback, oracle)
    (OUT / "REPORT.md").write_text(report, encoding="utf-8")
    dump_json(
        OUT / "summary.json",
        {
            "validations": {str(k): v for k, v in validations.items()},
            "fallback": fallback,
            "oracle": oracle,
            "notes": notes,
        },
    )
    (OUT / "VERDICT.txt").write_text(
        next(
            (
                line.split("**VERDICT: ", 1)[1].split("**", 1)[0]
                for line in report.splitlines()
                if line.startswith("**VERDICT: ")
            ),
            "INCOMPLETE",
        )
        + "\n",
        encoding="utf-8",
    )
    return {"validations": validations, "fallback": fallback}


def execute(import_f0_k2: bool) -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "acceptance").mkdir(exist_ok=True)
    (OUT / "logs").mkdir(exist_ok=True)

    kill_our_bmoe_only()

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
    prompts = load_prompts()
    for pid in PROMPT_IDS:
        load_target_pieces(pid)

    notes: dict[str, Any] = {
        "started": ts(),
        "bin": str(BIN),
        "bin_size": BIN.stat().st_size,
        "model_bytes": model_bytes,
        "model_published_sha256": PUBLISHED_MODEL_SHA,
        "threads": int(THREADS),
        "max_gen": MAX_GEN,
        "gold": "results/selfspec_f0/streams/*_target.pieces.json (k=6 d0.65)",
        "drop": None,
        "ks": list(KS),
        "import_f0_k2": import_f0_k2,
        "dropcurve_left_alone": True,
        "engine_top2_logits": False,
        "engine_can_emit": [
            "BMOE_PROGRESS.delta_text (greedy piece)",
            "BMOE_DONE aggregates",
            "ppl-csv pos,token_id,logprob of gold only",
        ],
    }
    dump_json(OUT / "RUN_META.json", notes)

    if import_f0_k2 and not all(arm_complete(pid, 2) for pid in PROMPT_IDS):
        import_f0_k2()

    for k in KS:
        if all(arm_complete(pid, k) for pid in PROMPT_IDS):
            log(f"skip k={k} all prompts complete")
            rows = load_arm_rows(k)
        else:
            session: BmoeSession | None = None
            try:
                session = BmoeSession(campaign_flags(k), f"draft_k{k}_d0")
                session.start()
                notes[f"ready_k{k}"] = session.ready
                rows = run_draft(session, prompts, k)
            finally:
                if session is not None:
                    session.close()
        v = validate_arm(k, rows)
        notes[f"validate_k{k}"] = v
        dump_json(OUT / "RUN_META.json", notes)
        log(f"VALIDATE k={k} valid={v['valid']} n={v['n_rows']} alpha={v['alpha']}")
        if not v["valid"]:
            set_status(f"ARM_INVALID_k{k}")
            write_outputs(notes)
            return 2
        if k == 2:
            a = v["alpha"]
            harness = {
                "k2_alpha": a,
                "k2_n": v["n_eligible"],
                "f0_k2_d0_alpha": F0_K2_POOLED,
                "f0_k2_d0_n": F0_K2_N,
                "abs_delta": None if a is None else abs(a - F0_K2_POOLED),
                "tol": HARNESS_ABS_TOL,
                "pass": a is not None
                and v["n_eligible"] == F0_K2_N
                and abs(a - F0_K2_POOLED) <= HARNESS_ABS_TOL,
                "per_prompt": {},
            }
            for pid in PROMPT_IDS:
                sub = [r for r in rows if r.prompt == pid and r.gate_eligible()]
                aa = (sum(r.accept for r in sub) / len(sub)) if sub else None
                harness["per_prompt"][pid] = {
                    "alpha": aa,
                    "n": len(sub),
                    "f0": K2_PER_PROMPT[pid],
                    "abs_delta": None if aa is None else abs(aa - K2_PER_PROMPT[pid]),
                }
            notes["harness"] = harness
            dump_json(OUT / "RUN_META.json", notes)
            if not harness["pass"]:
                log(
                    f"HARNESS FAIL k=2 alpha={a} n={v['n_eligible']} "
                    f"want ~{F0_K2_POOLED} / {F0_K2_N}"
                )
                set_status("HARNESS_FAIL")
                write_outputs(notes)
                return 2
            log(f"HARNESS PASS k=2 alpha={a:.6f} delta={harness['abs_delta']:.6f}")

    notes["finished"] = ts()
    dump_json(OUT / "RUN_META.json", notes)
    write_outputs(notes)
    set_status("DONE")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--execute", action="store_true")
    ap.add_argument(
        "--summarize-only",
        action="store_true",
        help="rebuild REPORT.md from ckpts; no engine",
    )
    ap.add_argument(
        "--import-f0-k2",
        action="store_true",
        help="copy F0 k2_d0 ckpts instead of regenerating k=2",
    )
    args = ap.parse_args()
    if args.summarize_only:
        notes = {}
        meta = OUT / "RUN_META.json"
        if meta.is_file():
            notes = json.loads(meta.read_text(encoding="utf-8"))
        write_outputs(notes)
        return 0
    if not args.execute:
        print(
            "usage: run_f6_certify_probe.py --execute [--import-f0-k2] | --summarize-only",
            file=sys.stderr,
        )
        return 2
    try:
        return execute(import_f0_k2=args.import_f0_k2)
    except Exception as e:
        log(f"FATAL {type(e).__name__}: {e}")
        set_status("BLOCKED_ENGINE")
        raise


if __name__ == "__main__":
    sys.exit(main())
