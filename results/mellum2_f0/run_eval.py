#!/usr/bin/env python3
"""Run Mellum2 F0 language smoke + isolated-coding suite on PC llama-cli.

Hard rules: -t 4 only. Never touch other inference processes. Resume-safe.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[1]
LANG = ROOT / "language"
SUITE = ROOT / "suite"
WORK = SUITE / "work"
DEFAULT_MODEL = REPO / "models" / "Mellum2-12B-A2.5B-Instruct-Q4_K_M.gguf"
DEFAULT_BIN = REPO / "build-llama-pc" / "bin" / "llama-cli.exe"

DIFF_MARK = re.compile(r"(?m)^(diff --git |--- |\+\+\+ |@@ )")
FENCE_RE = re.compile(r"```(?:[\w.+-]*)\n(.*?)```", re.S)
EVAL_RE = re.compile(
    r"eval time\s*=\s*([\d.]+)\s*ms\s*/\s*(\d+)\s*runs?\s*\(\s*([\d.]+)\s*ms per token,\s*([\d.]+)\s*tokens per second\)",
    re.I,
)
PROMPT_EVAL_RE = re.compile(
    r"prompt eval time\s*=\s*([\d.]+)\s*ms\s*/\s*(\d+)\s*tokens?\s*\(\s*([\d.]+)\s*ms per token,\s*([\d.]+)\s*tokens per second\)",
    re.I,
)
# some builds print " / N tokens" instead of " / N runs"
EVAL_RE2 = re.compile(
    r"eval time\s*=\s*([\d.]+)\s*ms\s*/\s*(\d+)\s*tokens?\s*\(\s*([\d.]+)\s*ms per token,\s*([\d.]+)\s*tokens per second\)",
    re.I,
)
# b9967 conversation banner: "[ Prompt: 14.8 t/s | Generation: 24.2 t/s ]"
BANNER_PERF_RE = re.compile(
    r"\[\s*Prompt:\s*([\d.]+)\s*t/s\s*\|\s*Generation:\s*([\d.]+)\s*t/s\s*\]",
    re.I,
)
ANSI_RE = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")
RESOURCE_RCS = {120, 0xC00000FD}  # 120 = busy/collision; STATUS_STACK_OVERFLOW-ish
COLLISION_HINTS = ("resource", "out of memory", "cannot allocate", "failed to allocate")


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def parse_perf(text: str) -> dict:
    out = {
        "gen_tokens": None,
        "gen_ms": None,
        "tok_s": None,
        "prompt_tokens": None,
        "prompt_tok_s": None,
    }
    m = EVAL_RE.search(text) or EVAL_RE2.search(text)
    if m:
        out["gen_ms"] = float(m.group(1))
        out["gen_tokens"] = int(m.group(2))
        out["tok_s"] = float(m.group(4))
    m = PROMPT_EVAL_RE.search(text)
    if m:
        out["prompt_tokens"] = int(m.group(2))
        out["prompt_tok_s"] = float(m.group(4))
    m = BANNER_PERF_RE.search(text)
    if m:
        if out["prompt_tok_s"] is None:
            out["prompt_tok_s"] = float(m.group(1))
        if out["tok_s"] is None:
            out["tok_s"] = float(m.group(2))
    return out


def extract_generation(stdout: str, prompt: str, assistant_file: str | None = None) -> str:
    """Pull the assistant turn out of llama-cli conversation chrome."""
    if assistant_file:
        cleaned = ANSI_RE.sub("", assistant_file)
        m = re.search(r"(?ms)^Assistant:\s*\n(.*)", cleaned.strip())
        if m:
            body = m.group(1).strip()
            if body:
                return body
    text = ANSI_RE.sub("", stdout or "")
    first = prompt.strip().splitlines()[0] if prompt.strip() else ""
    if first:
        marker = "> " + first
        idx = text.find(marker)
        if idx < 0:
            idx = text.find(first)
            if idx >= 0:
                # skip the echoed prompt line
                nl = text.find("\n", idx)
                text = text[nl + 1 :] if nl >= 0 else ""
            else:
                text = strip_cli_noise(text)
        else:
            nl = text.find("\n", idx)
            text = text[nl + 1 :] if nl >= 0 else ""
    else:
        text = strip_cli_noise(text)
    for stop in ("[ Prompt:", "\nExiting...", "\nExiting"):
        j = text.find(stop)
        if j >= 0:
            text = text[:j]
    return text.strip()


def strip_cli_noise(stdout: str) -> str:
    lines = []
    skip_prefixes = (
        "load_backend:",
        "ggml_",
        "llama_",
        "print_info:",
        "load:",
        "system_info:",
        "sampler",
        "generate:",
        "slot",
        "common_",
        "clip_",
        "init:",
        "warming up",
        "== running",
        "main:",
        "loading model",
        "available commands:",
        "/exit",
        "/regen",
        "/clear",
        "/read",
        "/glob",
        "build      :",
        "model      :",
        "ftype      :",
        "modalities :",
        "exiting",
    )
    banner_chars = set("▄▀█")
    for line in stdout.splitlines():
        s = line.strip()
        sl = s.lower()
        if any(sl.startswith(p) for p in skip_prefixes):
            continue
        if s.startswith("llama") or s.startswith("ggml"):
            continue
        if s and all(ch in banner_chars or ch.isspace() for ch in s):
            continue
        if BANNER_PERF_RE.search(s):
            continue
        lines.append(line)
    return "\n".join(lines).strip()


def _looks_like_collision(rc: int, combined: str) -> bool:
    if rc in RESOURCE_RCS:
        return True
    low = (combined or "").lower()
    return any(h in low for h in COLLISION_HINTS) and rc != 0


def run_llama(bin_path: Path, model: Path, prompt: str, out_prefix: Path, n_predict: int, ctx: int) -> dict:
    out_prefix.parent.mkdir(parents=True, exist_ok=True)
    prompt_path = out_prefix.with_suffix(".prompt.txt")
    stdout_path = out_prefix.with_suffix(".stdout.txt")
    stderr_path = out_prefix.with_suffix(".stderr.txt")
    meta_path = out_prefix.with_suffix(".meta.json")
    gen_path = out_prefix.with_suffix(".gen.txt")
    assistant_path = out_prefix.with_suffix(".assistant.txt")
    if gen_path.exists() and meta_path.exists():
        return json.loads(meta_path.read_text(encoding="utf-8"))

    prompt_path.write_text(prompt, encoding="utf-8")
    # cwd = bin dir so a stray NUL file in the repo root cannot shadow Windows NUL
    cmd = [
        str(bin_path),
        "-m", str(model),
        "-t", "4",
        "-tb", "4",
        "-ngl", "0",
        "-c", str(ctx),
        "-n", str(n_predict),
        "--temp", "0",
        "--top-k", "1",
        "--top-p", "1.0",
        "--min-p", "0.0",
        "-cnv",
        "-st",
        "--jinja",
        "--simple-io",
        "--color", "off",
        "--perf",
        "--no-display-prompt",
        "-f", str(prompt_path),
        "-o", str(assistant_path),
    ]
    last_proc = None
    wall = 0.0
    attempts = 0
    while attempts < 2:
        attempts += 1
        t0 = time.perf_counter()
        try:
            last_proc = subprocess.run(
                cmd,
                cwd=str(bin_path.parent),
                stdin=subprocess.DEVNULL,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=600,
            )
        except subprocess.TimeoutExpired as exc:
            last_proc = subprocess.CompletedProcess(
                cmd, 124, exc.stdout or "", (exc.stderr or "") + "\nTIMEOUT 600s\n"
            )
        wall = time.perf_counter() - t0
        combined = (last_proc.stdout or "") + "\n" + (last_proc.stderr or "")
        if attempts == 1 and _looks_like_collision(last_proc.returncode, combined):
            print(f"  collision rc={last_proc.returncode}; wait 60s and retry once", flush=True)
            time.sleep(60)
            continue
        break
    proc = last_proc
    stdout_path.write_text(proc.stdout or "", encoding="utf-8")
    stderr_path.write_text(proc.stderr or "", encoding="utf-8")
    combined = (proc.stdout or "") + "\n" + (proc.stderr or "")
    assistant_txt = ""
    if assistant_path.exists():
        assistant_txt = assistant_path.read_text(encoding="utf-8", errors="replace")
    gen = extract_generation(proc.stdout or "", prompt, assistant_txt)
    if not gen.strip():
        gen = strip_cli_noise(proc.stdout or "")
    gen_path.write_text(gen, encoding="utf-8")
    perf = parse_perf(combined)
    if perf.get("gen_tokens") is None and gen:
        # banner format has no token count; rough whitespace estimate as fallback
        perf["gen_tokens_est"] = max(1, len(gen.split()))
    meta = {
        "cmd": cmd,
        "returncode": proc.returncode,
        "wall_s": round(wall, 3),
        "binary": str(bin_path),
        "model": str(model),
        "n_predict": n_predict,
        "ctx": ctx,
        "threads": 4,
        "sampler": "greedy temp=0 top_k=1",
        "attempts": attempts,
        **perf,
    }
    meta_path.write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    return meta


def looks_like_diff(text: str) -> bool:
    return bool(DIFF_MARK.search(text))


def extract_fenced(text: str) -> list[str]:
    return [m.group(1) for m in FENCE_RE.finditer(text)]


def extract_code_candidate(text: str, lang: str) -> str | None:
    fences = extract_fenced(text)
    if fences:
        # prefer last fenced block that looks like source
        for block in reversed(fences):
            if lang == "python" and ("def " in block or "return " in block):
                return block
            if lang == "javascript" and ("function " in block or "=>" in block or "module.exports" in block):
                return block
        return fences[-1]
    # raw function
    if lang == "python":
        m = re.search(r"(def\s+\w+\s*\(.*)", text, re.S)
        if m:
            return m.group(0)
    if lang == "javascript":
        m = re.search(r"(function\s+\w+\s*\(.*)", text, re.S)
        if m:
            return m.group(0)
    return None


def apply_unified_diff(original: str, diff_text: str) -> str | None:
    """Minimal unified-diff applier for single-file patches."""
    # Drop markdown fences if the model wrapped the diff
    fences = extract_fenced(diff_text)
    candidate = diff_text
    for block in fences:
        if DIFF_MARK.search(block):
            candidate = block
            break
    lines = candidate.splitlines()
    hunks = []
    i = 0
    while i < len(lines):
        m = re.match(r"@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@", lines[i])
        if not m:
            i += 1
            continue
        old_start = int(m.group(1))
        old_len = int(m.group(2) or "1")
        body = []
        i += 1
        while i < len(lines) and not lines[i].startswith("@@"):
            row = lines[i]
            if row.startswith("\\"):  # "\ No newline at end of file"
                i += 1
                continue
            if row.strip().startswith("```"):
                i += 1
                continue
            if row.startswith("---") or row.startswith("+++") or row.startswith("diff "):
                break
            if row.startswith(" ") or row.startswith("+") or row.startswith("-") or row == "":
                body.append(row)
                i += 1
                continue
            # tolerate missing prefix as context
            body.append(" " + row)
            i += 1
        hunks.append((old_start, old_len, body))
    if not hunks:
        return None
    src = original.splitlines()
    out: list[str] = []
    cursor = 1  # 1-based
    for old_start, old_len, body in hunks:
        if old_start > cursor:
            out.extend(src[cursor - 1 : old_start - 1])
        consumed = 0
        for row in body:
            if row.startswith("+"):
                out.append(row[1:])
            elif row.startswith("-"):
                consumed += 1
            else:
                out.append(row[1:] if row.startswith(" ") else row)
                consumed += 1
        cursor = old_start + old_len
        # if hunk header old_len disagrees, still advance by consumed
        if consumed and old_len and consumed != old_len:
            cursor = old_start + consumed
    if cursor - 1 < len(src):
        out.extend(src[cursor - 1 :])
    text = "\n".join(out)
    if original.endswith("\n"):
        text += "\n"
    return text


def materialize_solution(task: dict, gen: str, dest: Path) -> tuple[str, str]:
    """Write patched entry file. Returns (method, format_ok)."""
    src_dir = ROOT / task["dir"]
    dest.mkdir(parents=True, exist_ok=True)
    for p in src_dir.iterdir():
        if p.name == "prompt.txt":
            continue
        if p.is_file():
            shutil.copy2(p, dest / p.name)
    entry = dest / task["entry"]
    original = entry.read_text(encoding="utf-8")
    format_ok = "yes" if looks_like_diff(gen) else "no"
    method = "none"
    patched = None
    if looks_like_diff(gen):
        patched = apply_unified_diff(original, gen)
        if patched is not None and patched != original:
            method = "diff"
    if method == "none":
        code = extract_code_candidate(gen, task.get("lang", "python"))
        if code:
            # If the model emitted a full module, use it; else splice function
            if task.get("lang") == "javascript" and "module.exports" not in code and "module.exports" in original:
                # keep export footer
                footer = "\nmodule.exports" + original.split("module.exports", 1)[1]
                if "module.exports" not in code:
                    code = code.rstrip() + "\n" + footer
            entry.write_text(_strip_fence_lines(code), encoding="utf-8")
            method = "extract"
            return method, format_ok
    if patched is not None:
        entry.write_text(_strip_fence_lines(patched), encoding="utf-8")
        return method, format_ok
    return method, format_ok


def _strip_fence_lines(text: str) -> str:
    lines = [ln for ln in text.splitlines() if not ln.strip().startswith("```")]
    out = "\n".join(lines)
    if not out.endswith("\n"):
        out += "\n"
    return out


def run_pytest(workdir: Path, testfile: str) -> tuple[bool, str]:
    proc = subprocess.run(
        [sys.executable, "-m", "pytest", "-q", testfile],
        cwd=str(workdir),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    log = (proc.stdout or "") + (proc.stderr or "")
    return proc.returncode == 0, log


def run_node(workdir: Path, testfile: str) -> tuple[bool, str]:
    node = shutil.which("node")
    if not node:
        return False, "node not found"
    proc = subprocess.run(
        [node, testfile],
        cwd=str(workdir),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    log = (proc.stdout or "") + (proc.stderr or "")
    return proc.returncode == 0, log


def structural_ok(source: str, spec: dict) -> tuple[bool, str]:
    reasons = []
    for needle in spec.get("must_contain") or []:
        if needle not in source:
            reasons.append(f"missing {needle!r}")
    for needle in spec.get("must_not_contain") or []:
        if needle in source:
            reasons.append(f"still has {needle!r}")
    if "max_indent_spaces" in spec:
        max_indent = 0
        for line in source.splitlines():
            if not line.strip() or line.lstrip().startswith("#"):
                continue
            max_indent = max(max_indent, len(line) - len(line.lstrip(" ")))
        if max_indent > spec["max_indent_spaces"]:
            reasons.append(f"indent {max_indent} > {spec['max_indent_spaces']}")
    return (not reasons), "; ".join(reasons) or "ok"


def review_hit(text: str, needles: list[str]) -> tuple[bool, str]:
    low = text.lower()
    hits = [n for n in needles if n.lower() in low]
    return bool(hits), ",".join(hits)


def score_language(item: dict, gen: str) -> tuple[int, str]:
    """Heuristic 0/1/2 plus one-line justification. Human can override in report."""
    text = gen.strip()
    if len(text) < 20:
        return 0, "empty or near-empty reply"
    # refuse / collapse
    low = text.lower()
    if any(p in low for p in ("i cannot", "i can't help", "as an ai")) and len(text) < 80:
        return 0, "refusal / collapse"
    lang = item["lang"]
    kind = item["kind"]
    italianish = len(re.findall(r"\b(che|non|per|una|come|questo|funziona|perché|perche|è|sono|della)\b", text, re.I))
    spanishish = len(re.findall(r"\b(que|una|para|esto|función|funcion|porque|es|los|las)\b", text, re.I))
    frenchish = len(re.findall(r"\b(que|une|pour|ceci|fonction|parce|est|les|des)\b", text, re.I))
    englishish = len(re.findall(r"\b(the|and|this|that|function|because|returns|wrong)\b", text, re.I))

    if lang == "it":
        if italianish < 2 and englishish >= 6:
            return 1, "coherent but mostly English (code-switch); usable for a coding SKU"
        if italianish >= 3:
            score = 2 if len(text) > 80 else 1
            return score, "replies in Italian, coherent"
        return 1, "mixed IT/EN, still coherent"
    if lang == "es":
        if spanishish >= 2:
            return 2 if len(text) > 60 else 1, "Spanish reply, coherent"
        if englishish >= 6:
            return 1, "answered in English; content ok, language miss"
        return 1, "weak Spanish signal but not unusable"
    if lang == "fr":
        if frenchish >= 2:
            return 2 if len(text) > 60 else 1, "French reply, coherent"
        if englishish >= 6:
            return 1, "answered in English; content ok, language miss"
        return 1, "weak French signal but not unusable"

    # EN
    if kind == "code-explain":
        # need to actually address the snippet
        keys = {
            "en_09": ["sort", "desc", "first", "key"],
            "en_10": ["or", "precedence", "zero", "=="],
            "en_11": ["unique", "set", "duplicate"],
            "en_12": ["pop", "skip", "index", "shift", "modif"],
            "en_13": ["group", "sum", "transform", "user"],
            "en_14": ["except", "silence", "true", "error", "fail"],
            "en_15": ["example", "domain", "lookbehind", "after @"],
        }
        needles = keys.get(item["id"], [])
        hits = sum(1 for n in needles if n in low)
        if hits >= 2 and len(text) > 60:
            return 2, "names the mechanism / the bug correctly"
        if hits >= 1 or len(text) > 80:
            return 1, "partially explains the snippet"
        return 0, "does not address the snippet"
    # general chat
    if len(text) > 80 and not text.lower().startswith("error"):
        return 2, "fluent English, on-topic"
    return 1, "short but on-topic"


def write_csv(path: Path, rows: list[dict], fieldnames: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        w.writeheader()
        for row in rows:
            w.writerow(row)


def cmd_language(args) -> None:
    prompts = json.loads((LANG / "prompts.json").read_text(encoding="utf-8"))
    rows = []
    for item in prompts:
        prefix = LANG / "generations" / item["id"]
        print(f"[lang] {item['id']} ...", flush=True)
        meta = run_llama(args.bin, args.model, item["prompt"], prefix, n_predict=args.n_lang, ctx=args.ctx)
        gen = prefix.with_suffix(".gen.txt").read_text(encoding="utf-8", errors="replace")
        score, why = score_language(item, gen)
        row = {
            "id": item["id"],
            "lang": item["lang"],
            "kind": item["kind"],
            "score": score,
            "why": why,
            "gen_tokens": meta.get("gen_tokens"),
            "tok_s": meta.get("tok_s"),
            "wall_s": meta.get("wall_s"),
            "returncode": meta.get("returncode"),
            "chars": len(gen),
        }
        rows.append(row)
        print(f"  score={score} tok/s={meta.get('tok_s')} n={meta.get('gen_tokens')} :: {why}", flush=True)
    write_csv(
        LANG / "scores.csv",
        rows,
        ["id", "lang", "kind", "score", "why", "gen_tokens", "tok_s", "wall_s", "returncode", "chars"],
    )
    (LANG / "scores.json").write_text(json.dumps(rows, indent=2) + "\n", encoding="utf-8")


def cmd_suite(args) -> None:
    tasks = json.loads((SUITE / "tasks.json").read_text(encoding="utf-8"))
    rows = []
    for task in tasks:
        tid = task["id"]
        prefix = SUITE / "generations" / tid
        prompt = (ROOT / task["dir"] / "prompt.txt").read_text(encoding="utf-8")
        print(f"[suite] {tid} ...", flush=True)
        meta = run_llama(args.bin, args.model, prompt, prefix, n_predict=args.n_code, ctx=args.ctx)
        gen = prefix.with_suffix(".gen.txt").read_text(encoding="utf-8", errors="replace")
        format_ok = "yes" if looks_like_diff(gen) else "no"
        passed = False
        detail = ""
        method = "n/a"
        if task["family"] == "review":
            ok, hits = review_hit(gen, task.get("review_strict_any") or task.get("review_needles") or [])
            passed = ok
            detail = f"needles={hits or 'NONE'}"
            method = "review-string"
        else:
            work = WORK / tid
            if work.exists():
                shutil.rmtree(work)
            method, format_ok = materialize_solution(task, gen, work)
            if task.get("pytest"):
                ok, log = run_pytest(work, task["pytest"])
                (work / "pytest.log").write_text(log, encoding="utf-8")
                passed = ok
                detail = "pytest " + ("PASS" if ok else "FAIL")
            elif task.get("node_test"):
                ok, log = run_node(work, task["node_test"])
                (work / "node.log").write_text(log, encoding="utf-8")
                passed = ok
                detail = "node " + ("PASS" if ok else "FAIL")
            if task.get("structural") and passed:
                src = (work / task["entry"]).read_text(encoding="utf-8")
                sok, swhy = structural_ok(src, task["structural"])
                if not sok:
                    passed = False
                    detail += f"; structural FAIL ({swhy})"
                else:
                    detail += "; structural PASS"
            elif task.get("structural") and not passed:
                detail += "; structural skipped (tests failed)"
        row = {
            "id": tid,
            "family": task["family"],
            "lang": task.get("lang"),
            "pass": int(passed),
            "format_diff": format_ok,
            "method": method,
            "detail": detail,
            "gen_tokens": meta.get("gen_tokens"),
            "tok_s": meta.get("tok_s"),
            "wall_s": meta.get("wall_s"),
            "returncode": meta.get("returncode"),
        }
        rows.append(row)
        print(f"  pass={int(passed)} fmt={format_ok} method={method} tok/s={meta.get('tok_s')} :: {detail}", flush=True)
    fields = ["id", "family", "lang", "pass", "format_diff", "method", "detail", "gen_tokens", "tok_s", "wall_s", "returncode"]
    write_csv(SUITE / "scores.csv", rows, fields)
    write_csv(ROOT / "suite.csv", rows, fields)
    (SUITE / "scores.json").write_text(json.dumps(rows, indent=2) + "\n", encoding="utf-8")
    npass = sum(r["pass"] for r in rows)
    print(f"SUITE {npass}/{len(rows)}")


def cmd_record_shas(args) -> None:
    lines = []
    for label, path in [("model", args.model), ("llama-cli", args.bin)]:
        if path.exists():
            digest = sha256_file(path)
            lines.append(f"{digest}  {path}  ({label}, {path.stat().st_size} bytes)")
        else:
            lines.append(f"MISSING  {path}  ({label})")
    impl = args.bin.parent / "llama-cli-impl.dll"
    if impl.exists():
        lines.append(f"{sha256_file(impl)}  {impl}  (llama-cli-impl.dll, {impl.stat().st_size} bytes)")
    llama_dll = args.bin.parent / "llama.dll"
    if llama_dll.exists():
        lines.append(f"{sha256_file(llama_dll)}  {llama_dll}  (llama.dll, {llama_dll.stat().st_size} bytes)")
    (ROOT / "shas.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", type=Path, default=DEFAULT_MODEL)
    ap.add_argument("--bin", type=Path, default=DEFAULT_BIN)
    ap.add_argument("--ctx", type=int, default=4096)
    ap.add_argument("--n-lang", type=int, default=384)
    ap.add_argument("--n-code", type=int, default=768)
    ap.add_argument("--only", choices=["language", "suite", "shas", "all"], default="all")
    args = ap.parse_args()
    if not args.model.exists():
        raise SystemExit(f"model missing: {args.model}")
    if not args.bin.exists():
        raise SystemExit(f"binary missing: {args.bin}")
    if args.only in ("shas", "all"):
        cmd_record_shas(args)
    if args.only in ("language", "all"):
        cmd_language(args)
    if args.only in ("suite", "all"):
        cmd_suite(args)


if __name__ == "__main__":
    main()
