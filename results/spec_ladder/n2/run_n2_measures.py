#!/usr/bin/env python3
"""N2 measure driver - run AFTER 1c phase A (serial)."""
from __future__ import annotations
import json, re, subprocess, time, sys
from pathlib import Path

ROOT = Path(r"C:\Users\gualt\Desktop\Kalsa\moe-experiments")
BIN = ROOT / "build-llama-pc" / "bin"
SERVER = BIN / "llama-server.exe"
CLI = BIN / "llama-cli.exe"
OUT = ROOT / "results" / "spec_ladder" / "n2"
GENS = sorted((ROOT / "results" / "f5.5" / "b").glob("*-k8.gen.txt"))
# Prefer short IT campaign texts first for timebox
PROMPTS = [
    # use gen text as reference completions; for live server we use short prompts
]

def read_gens():
    items = []
    for g in GENS:
        text = g.read_text(encoding="utf-8", errors="replace").strip()
        items.append({"name": g.stem, "text": text, "n_chars": len(text)})
    return items

def run_server_spec(tag: str, model: Path, spec_type: str, draft: Path | None, n_predict: int = 64, prompt: str = "Spiega in italiano cos'e un MoE."):
    """Start llama-server, one completion, capture acceptance from logs, stop."""
    logd = OUT / tag
    logd.mkdir(parents=True, exist_ok=True)
    port = 18080
    args = [
        str(SERVER),
        "-m", str(model),
        "--port", str(port),
        "-c", "2048",
        "-t", "8",
        "-ngl", "0",
        "--spec-type", spec_type,
        "--spec-draft-n-max", "4",
        "--jinja",
    ]
    if draft is not None:
        args += ["--spec-draft-model", str(draft)]
    # For MTP the draft head is usually embedded; some builds want --spec-draft-model = mtp file
    if spec_type == "draft-mtp" and draft is not None:
        args += []  # already added
    stderr = (logd / "server.stderr").open("w", encoding="utf-8")
    stdout = (logd / "server.stdout").open("w", encoding="utf-8")
    meta = {"cmd": args, "start": time.time()}
    (logd / "cmd.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    proc = subprocess.Popen(args, stdout=stdout, stderr=stderr, cwd=str(ROOT))
    try:
        # wait ready
        import urllib.request
        ready = False
        for _ in range(120):
            if proc.poll() is not None:
                break
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=2)
                ready = True
                break
            except Exception:
                time.sleep(2)
        result = {"ready": ready, "pid": proc.pid}
        if not ready:
            result["error"] = "server not ready"
            (logd / "result.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
            return result
        # completion
        body = json.dumps({
            "prompt": prompt,
            "n_predict": n_predict,
            "temperature": 0.0,
            "cache_prompt": False,
        }).encode()
        req = urllib.request.Request(
            f"http://127.0.0.1:{port}/completion",
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        t0 = time.time()
        with urllib.request.urlopen(req, timeout=600) as resp:
            data = json.loads(resp.read().decode("utf-8", "replace"))
        t1 = time.time()
        (logd / "completion.json").write_text(json.dumps(data, indent=2)[:200000], encoding="utf-8")
        result.update({
            "elapsed_s": t1 - t0,
            "content_preview": (data.get("content") or data.get("content") or "")[:500],
            "tokens_predicted": data.get("tokens_predicted") or data.get("tokens_evaluated"),
            "timings": data.get("timings"),
        })
        # parse acceptance from stderr log after stop
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=30)
        except Exception:
            proc.kill()
        stderr.close(); stdout.close()
    # parse acceptance rate from logs
    text = ""
    for p in (logd / "server.stderr", logd / "server.stdout"):
        if p.exists():
            text += p.read_text(encoding="utf-8", errors="replace")
    m = re.search(r"draft acceptance rate\s*=\s*([0-9.]+)", text, re.I)
    if m:
        result["acceptance_rate"] = float(m.group(1))
    m2 = re.search(r"accepted\s+(\d+)\s*/\s*(\d+)", text, re.I)
    if m2:
        result["accepted"] = int(m2.group(1))
        result["drafted"] = int(m2.group(2))
    # also search common patterns
    for pat in [
        r"accept[^\n]{0,40}([0-9.]+)\s*%",
        r"n_draft[^\n]+",
        r"spec[^\n]*accept[^\n]+",
    ]:
        mm = re.findall(pat, text, re.I)
        if mm:
            result.setdefault("log_hits", []).append({pat: mm[:5]})
    (logd / "result.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    return result

def main():
    gens = read_gens()
    (OUT / "gens_index.json").write_text(json.dumps(gens, indent=2), encoding="utf-8")
    target_iq1 = ROOT / "models" / "mtp" / "Qwen3.6-35B-A3B-UD-IQ1_M.gguf"
    mtp_head = ROOT / "models" / "mtp" / "mtp-Qwen3.6-35B-A3B-Q4_0.gguf"
    dflash = ROOT / "models" / "draft" / "Qwen3.6-35B-A3B-DFlash-Q4_K_M.gguf"
    draft4b = ROOT / "models" / "draft" / "Qwen3.5-4B-Q4_K_M.gguf"
    draft2b = ROOT / "models" / "draft" / "Qwen3.5-2B-Q4_K_M.gguf"
    draft08 = ROOT / "models" / "draft" / "Qwen3.5-0.8B-Q4_K_M.gguf"

    summary = []
    # 1) ngram floor (no extra model)
    if target_iq1.exists():
        print("N2 ngram-mod floor...", flush=True)
        try:
            r = run_server_spec("ngram", target_iq1, "ngram-mod", None, n_predict=48)
            summary.append({"tag": "ngram-mod", **{k: r.get(k) for k in ("acceptance_rate","accepted","drafted","elapsed_s","error","ready")}})
        except Exception as e:
            summary.append({"tag": "ngram-mod", "error": str(e)})

    # 2) MTP - try with embedded + separate head as -md
    if target_iq1.exists() and mtp_head.exists():
        print("N2 draft-mtp...", flush=True)
        try:
            r = run_server_spec("mtp", target_iq1, "draft-mtp", mtp_head, n_predict=48)
            summary.append({"tag": "draft-mtp", **{k: r.get(k) for k in ("acceptance_rate","accepted","drafted","elapsed_s","error","ready")}})
        except Exception as e:
            summary.append({"tag": "draft-mtp", "error": str(e)})

    # 3) DFlash
    if target_iq1.exists() and dflash.exists():
        print("N2 draft-dflash...", flush=True)
        try:
            r = run_server_spec("dflash", target_iq1, "draft-dflash", dflash, n_predict=48)
            summary.append({"tag": "draft-dflash", **{k: r.get(k) for k in ("acceptance_rate","accepted","drafted","elapsed_s","error","ready")}})
        except Exception as e:
            summary.append({"tag": "draft-dflash", "error": str(e)})

    # 4) draft-simple with tokenizer-matched Qwen3.5
    for name, path in [("draft_4b", draft4b), ("draft_2b", draft2b), ("draft_0.8b", draft08)]:
        if target_iq1.exists() and path.exists():
            print(f"N2 draft-simple {name}...", flush=True)
            try:
                r = run_server_spec(name, target_iq1, "draft-simple", path, n_predict=48)
                summary.append({"tag": name, **{k: r.get(k) for k in ("acceptance_rate","accepted","drafted","elapsed_s","error","ready")}})
            except Exception as e:
                summary.append({"tag": name, "error": str(e)})

    (OUT / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))
    print("DONE N2")

if __name__ == "__main__":
    main()
