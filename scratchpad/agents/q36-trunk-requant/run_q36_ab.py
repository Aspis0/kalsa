#!/usr/bin/env python3
"""q36 trunk-requant answer A/B.

Same session-mode protocol as scripts/run_answer_quality_ab.py
(Windows UTF-8 stdin JSON, temp 0, --chatml, --no-think).

Compares GGUF variants at the shipped Marco runtime: k=6 drop=0.0.
Does NOT re-sweep drop/k.

Usage:
  python run_q36_ab.py sanity
  python run_q36_ab.py long
  python run_q36_ab.py sanity q8_0 iq4_nl    # subset of variant tags
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(r"C:\Users\gualt\Desktop\Kalsa\moe-experiments")
HERE = ROOT / "scratchpad" / "agents" / "q36-trunk-requant"
BINARY = ROOT / "build-pc-mellum-ppl" / "cli" / "bmoe-cli.exe"
BINDIR = BINARY.parent
LLAMA_BIN = ROOT / "build-pc-mellum-ppl" / "bin"

MODELS = {
    "baseline": ROOT / "models" / "Marco-Mini-Instruct-KEXP.gguf",
    "q8_0": HERE / "gguf" / "Marco-Mini-Instruct-KEXP-trunk-q8_0.gguf",
    "iq4_nl": HERE / "gguf" / "Marco-Mini-Instruct-KEXP-trunk-iq4_nl.gguf",
    "q4_0": HERE / "gguf" / "Marco-Mini-Instruct-KEXP-trunk-q4_0.gguf",
}

# Shipped Marco product config (PLAN.md + run_answer_quality_ab.py marco arm).
K = "6"
DROP = "0.0"
THINK = False


def say(log: Path, msg: str) -> None:
    line = f"[{time.strftime('%Y-%m-%dT%H:%M:%S%z')}] {msg}"
    log.parent.mkdir(parents=True, exist_ok=True)
    with log.open("a", encoding="utf-8") as f:
        f.write(line + "\n")
    print(line, flush=True)


def base_args(model: Path) -> list[str]:
    return [
        str(BINARY), "-m", str(model), "--session",
        "--moe-stream", "--cache-mb", "2000", "--dense-weights", "anon", "--overlap",
        "--io-threads", "4", "--ubatch", "512", "-t", "16", "-c", "4096",
        "--temp", "0", "--chatml",
        "--no-think",
        "--n-expert-used", K, "--drop-cold-experts", DROP,
        "--no-moe-fused-gemv", "--no-moe-fused-ffn",
    ]


def run_model(tag: str, model: Path, prompts: dict[str, str], ngen: int, gen_dir: Path, log: Path) -> None:
    todo = [p for p in prompts if not (gen_dir / f"{p}__{tag}.txt").exists()]
    if not todo:
        say(log, f"SKIP {tag} - all prompts already generated")
        return
    if not model.exists():
        say(log, f"FAIL {tag} missing model {model}")
        return
    say(log, f"START {tag} model={model.name} n={len(todo)} ngen={ngen}")
    env = os.environ.copy()
    env["PATH"] = f"{BINDIR}{os.pathsep}{LLAMA_BIN}{os.pathsep}" + env.get("PATH", "")
    # stderr MUST be a file or DEVNULL. PIPE deadlocks: llama/bmoe dumps load
    # logs on stderr and the 64KiB pipe fills before the first BMOE_DONE.
    err_path = gen_dir.parent / f"stderr_{tag}.log"
    err_f = err_path.open("w", encoding="utf-8", errors="replace")
    proc = subprocess.Popen(
        base_args(model), cwd=str(ROOT), env=env,
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=err_f,
        encoding="utf-8", errors="replace", bufsize=1,
    )
    try:
        for i, name in enumerate(todo, start=1):
            req = {
                "cmd": "generate",
                "prompt": prompts[name],
                "id": i,
                "n_predict": ngen,
                "think": THINK,
                "clear_kv": True,
            }
            t0 = time.time()
            proc.stdin.write(json.dumps(req, ensure_ascii=False) + "\n")
            proc.stdin.flush()
            text, done = None, None
            while True:
                line = proc.stdout.readline()
                if not line:
                    break
                line = line.rstrip("\n")
                if line.startswith("BMOE_DONE "):
                    done = json.loads(line[len("BMOE_DONE "):])
                    text = done.get("text", "")
                    break
                if line.startswith("BMOE_ERROR "):
                    err = json.loads(line[len("BMOE_ERROR "):])
                    say(log, f"  ERROR {name}/{tag}: {err.get('msg')}")
                    if err.get("fatal"):
                        return
                    break
            dt = time.time() - t0
            if text is None:
                say(log, f"  FAILED {name}/{tag} - no response (see stderr_{tag}.log)")
                continue
            (gen_dir / f"{name}__{tag}.txt").write_text(text, encoding="utf-8")
            (gen_dir / f"{name}__{tag}.json").write_text(
                json.dumps(done, ensure_ascii=False, indent=2), encoding="utf-8"
            )
            say(log, f"  OK {name}/{tag} chars={len(text)} tokens={done.get('tokens')} "
                     f"tok_s={done.get('tok_s')} wall={dt:.1f}s")
    finally:
        try:
            proc.stdin.write(json.dumps({"cmd": "close"}) + "\n")
            proc.stdin.flush()
        except Exception:
            pass
        try:
            proc.wait(timeout=120)
        except Exception:
            proc.kill()
        err_f.close()


def write_markdown(suite: str, prompts: dict[str, str], tags: list[str], cell: Path, log: Path) -> None:
    md = [
        f"# q36 trunk-requant answer A/B — {suite}",
        "",
        "Protocol clone of `scripts/run_answer_quality_ab.py`: temp 0, session-mode stdin JSON,",
        "chatml, no-think, k=6 drop=0.0 (Marco shipped). Differences are the GGUF, not drop/k.",
        "",
        "| tag | file |",
        "|---|---|",
    ]
    for t in tags:
        md.append(f"| `{t}` | `{MODELS[t].name}` |")
    md += ["", "Baseline texts from this run (not copied from results/answer_sanity_marco)."]
    gen = cell / "gen"
    for name in prompts:
        md += ["", "---", "", f"## {name}", "", "<details><summary>prompt</summary>", "", "```",
               prompts[name].rstrip(), "```", "", "</details>", ""]
        base_txt = gen / f"{name}__baseline.txt"
        base_body = base_txt.read_text(encoding="utf-8") if base_txt.exists() else None
        for t in tags:
            f = gen / f"{name}__{t}.txt"
            body = f.read_text(encoding="utf-8").rstrip() if f.exists() else "(mancante)"
            ident = ""
            if t != "baseline" and base_body is not None and f.exists():
                ident = " **IDENTICAL to baseline**" if body == base_body.rstrip() else " **DIFFERS from baseline**"
            md += [f"### {t}{ident}", "", "```", body or "(vuoto)", "```", ""]
    (cell / "ANSWERS.md").write_text("\n".join(md) + "\n", encoding="utf-8")
    say(log, f"ANSWERS.md written {cell / 'ANSWERS.md'}")


def main() -> int:
    suite = sys.argv[1] if len(sys.argv) > 1 else "sanity"
    tags = sys.argv[2:] if len(sys.argv) > 2 else list(MODELS)
    for t in tags:
        if t not in MODELS:
            print(f"unknown tag {t}", file=sys.stderr)
            return 2
    if suite == "sanity":
        prompt_dir = ROOT / "prompts" / "sanity"
        names = ["q1_f1_spa2000", "q2_tabellina9", "q3_regalo", "q4_vocali"]
        ngen = 300
    elif suite == "long":
        prompt_dir = ROOT / "prompts"
        names = [
            "f45_1_esplicativo",
            "f45_3_istruzioni",
            "f45_4_codice",
            "f45_5_ragionamento",
            "f45_2_scrittura",
            "long_conversational_it",
        ]
        ngen = 420
    else:
        print("suite must be sanity or long", file=sys.stderr)
        return 2

    cell = HERE / "ab" / suite
    gen = cell / "gen"
    gen.mkdir(parents=True, exist_ok=True)
    log = HERE / f"ab-{suite}.log"
    prompts = {}
    for name in names:
        p = prompt_dir / f"{name}.txt"
        if not p.exists():
            say(log, f"MISSING prompt {p}")
            continue
        prompts[name] = p.read_text(encoding="utf-8")
    say(log, f"q36 A/B suite={suite} tags={tags} prompts={list(prompts)} ngen={ngen} k={K} drop={DROP}")
    for tag in tags:
        run_model(tag, MODELS[tag], prompts, ngen, gen, log)
    write_markdown(suite, prompts, tags, cell, log)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
