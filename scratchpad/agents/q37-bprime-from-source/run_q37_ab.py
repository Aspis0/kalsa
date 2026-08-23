#!/usr/bin/env python3
"""q37 from-source trunk A/B. Same session-mode protocol as q36 / run_answer_quality_ab.py.

temp 0, stderr to file (PIPE deadlocks). Per-model k/drop/chatml — drop always 0.0
so the GGUF is the only variable.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(r"C:\Users\gualt\Desktop\Kalsa\moe-experiments")
HERE = ROOT / "scratchpad" / "agents" / "q37-bprime-from-source"
BINARY = ROOT / "build-pc-mellum-ppl" / "cli" / "bmoe-cli.exe"
BINDIR = BINARY.parent
LLAMA_BIN = ROOT / "build-pc-mellum-ppl" / "bin"

PREFIX = {
    "marco": "Marco-Mini-Instruct-KEXP-fromsrc",
    "olmoe": "OLMoE-1B-7B-0924-Instruct-KEXP-fromsrc",
    "lfm": "LFM2.5-8B-A1B-KEXP-fromsrc",
}
# Runtime matches the campaign's own A/B for that family, drop forced 0.
# Marco: q36 / run_answer_quality_ab.py "shipped" arm (k=6 drop=0, chatml, no-think).
# OLMoE: architecture top-8. LFM2.5-8B-A1B: architecture top-4.
RUNTIME = {
    "marco": {"k": "6", "drop": "0.0", "chatml": True, "no_think": True},
    # --chatml on this binary = "model family's chat turn (gemma/chatml)", not a
    # hard ChatML override. Use it on every family so the prompt is wrapped.
    "olmoe": {"k": "8", "drop": "0.0", "chatml": True, "no_think": True},
    "lfm": {"k": "4", "drop": "0.0", "chatml": True, "no_think": True},
}
ARMS = ("control", "q8_0", "iq4_nl", "q4_0")


def model_path(model: str, arm: str) -> Path:
    return HERE / "gguf" / model / f"{PREFIX[model]}-trunk-{arm}.gguf"


def say(log: Path, msg: str) -> None:
    line = f"[{time.strftime('%Y-%m-%dT%H:%M:%S%z')}] {msg}"
    log.parent.mkdir(parents=True, exist_ok=True)
    with log.open("a", encoding="utf-8") as f:
        f.write(line + "\n")
    print(line, flush=True)


def base_args(model: str, gguf: Path) -> list[str]:
    rt = RUNTIME[model]
    a = [
        str(BINARY), "-m", str(gguf), "--session",
        "--moe-stream", "--cache-mb", "2000", "--dense-weights", "anon", "--overlap",
        "--io-threads", "4", "--ubatch", "512", "-t", "16", "-c", "4096",
        "--temp", "0",
    ]
    if rt["chatml"]:
        a.append("--chatml")
    if rt["no_think"]:
        a.append("--no-think")
    a += [
        "--n-expert-used", rt["k"], "--drop-cold-experts", rt["drop"],
        "--no-moe-fused-gemv", "--no-moe-fused-ffn",
    ]
    return a


def run_model(model: str, tag: str, gguf: Path, prompts: dict[str, str], ngen: int, gen_dir: Path, log: Path) -> None:
    todo = [p for p in prompts if not (gen_dir / f"{p}__{tag}.txt").exists()]
    if not todo:
        say(log, f"SKIP {model}/{tag} - all prompts already generated")
        return
    if not gguf.exists():
        say(log, f"FAIL {model}/{tag} missing {gguf}")
        return
    say(log, f"START {model}/{tag} file={gguf.name} n={len(todo)} ngen={ngen}")
    env = os.environ.copy()
    env["PATH"] = f"{BINDIR}{os.pathsep}{LLAMA_BIN}{os.pathsep}" + env.get("PATH", "")
    err_path = gen_dir.parent / f"stderr_{tag}.log"
    err_f = err_path.open("w", encoding="utf-8", errors="replace")
    proc = subprocess.Popen(
        base_args(model, gguf), cwd=str(ROOT), env=env,
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
                "think": False,
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
                say(log, f"  FAILED {name}/{tag} - no response (see {err_path.name})")
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


def write_markdown(model: str, suite: str, prompts: dict[str, str], tags: list[str], cell: Path, log: Path) -> None:
    rt = RUNTIME[model]
    md = [
        f"# q37 from-source A/B — {model} / {suite}",
        "",
        f"temp 0, session JSON, k={rt['k']} drop={rt['drop']} chatml={rt['chatml']} no_think={rt['no_think']}.",
        "GGUF is the only variable. Control is KEXP-from-source, not the shipped file.",
        "",
        "| tag | file |",
        "|---|---|",
    ]
    for t in tags:
        md.append(f"| `{t}` | `{model_path(model, t).name}` |")
    md += ["", "Texts from this run."]
    gen = cell / "gen"
    for name in prompts:
        md += ["", "---", "", f"## {name}", "", "<details><summary>prompt</summary>", "", "```",
               prompts[name].rstrip(), "```", "", "</details>", ""]
        base_txt = gen / f"{name}__control.txt"
        base_body = base_txt.read_text(encoding="utf-8") if base_txt.exists() else None
        for t in tags:
            f = gen / f"{name}__{t}.txt"
            body = f.read_text(encoding="utf-8").rstrip() if f.exists() else "(mancante)"
            ident = ""
            if t != "control" and base_body is not None and f.exists():
                ident = " **IDENTICAL to control**" if body == base_body.rstrip() else " **DIFFERS from control**"
            md += [f"### {t}{ident}", "", "```", body or "(vuoto)", "```", ""]
    (cell / "ANSWERS.md").write_text("\n".join(md) + "\n", encoding="utf-8")
    say(log, f"ANSWERS.md written {cell / 'ANSWERS.md'}")


def main() -> int:
    if len(sys.argv) < 3:
        print("usage: run_q37_ab.py marco|olmoe|lfm sanity|long [arms...]", file=sys.stderr)
        return 2
    model = sys.argv[1]
    suite = sys.argv[2]
    tags = sys.argv[3:] or list(ARMS)
    if model not in PREFIX:
        print("unknown model", model, file=sys.stderr)
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
    cell = HERE / "ab" / model / suite
    gen = cell / "gen"
    gen.mkdir(parents=True, exist_ok=True)
    log = HERE / "logs" / f"ab-{model}-{suite}.log"
    prompts = {}
    for name in names:
        p = prompt_dir / f"{name}.txt"
        if not p.exists():
            say(log, f"MISSING prompt {p}")
            continue
        prompts[name] = p.read_text(encoding="utf-8")
    rt = RUNTIME[model]
    say(log, f"q37 A/B model={model} suite={suite} tags={tags} ngen={ngen} k={rt['k']} drop={rt['drop']}")
    for tag in tags:
        run_model(model, tag, model_path(model, tag), prompts, ngen, gen, log)
    write_markdown(model, suite, prompts, tags, cell, log)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
