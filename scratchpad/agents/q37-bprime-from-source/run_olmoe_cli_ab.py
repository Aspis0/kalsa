#!/usr/bin/env python3
"""OLMoE A/B via llama-cli. bmoe-cli has no olmoe recipe in arch_registry.

UTF-8 via --file (not -p argv). temp 0, single-turn conversation so the GGUF
chat template wraps the prompt. Same prompt sets as run_q37_ab.py.
"""
from __future__ import annotations

import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(r"C:\Users\gualt\Desktop\Kalsa\moe-experiments")
HERE = ROOT / "scratchpad" / "agents" / "q37-bprime-from-source"
CLI = ROOT / "build-llama-pc" / "bin" / "llama-cli.exe"
BIN = CLI.parent
PREFIX = "OLMoE-1B-7B-0924-Instruct-KEXP-fromsrc"
ARMS = ("control", "q8_0", "iq4_nl", "q4_0")


def model_path(arm: str) -> Path:
    return HERE / "gguf" / "olmoe" / f"{PREFIX}-trunk-{arm}.gguf"


def say(log: Path, msg: str) -> None:
    line = f"[{time.strftime('%Y-%m-%dT%H:%M:%S%z')}] {msg}"
    log.parent.mkdir(parents=True, exist_ok=True)
    with log.open("a", encoding="utf-8") as f:
        f.write(line + "\n")
    print(line, flush=True)


def strip_chat(raw: str) -> str:
    marker = "Assistant:"
    if marker in raw:
        raw = raw.split(marker, 1)[1]
    return raw.strip()


def generate(arm: str, name: str, prompt: str, ngen: int, gen_dir: Path, log: Path) -> str | None:
    gguf = model_path(arm)
    pf = gen_dir / f"_prompt_{arm}_{name}.txt"
    of = gen_dir / f"_raw_{arm}_{name}.txt"
    pf.write_text(prompt, encoding="utf-8")
    if of.exists():
        of.unlink()
    err_path = gen_dir.parent / f"stderr_{arm}.log"
    env = os.environ.copy()
    env["PATH"] = f"{BIN}{os.pathsep}" + env.get("PATH", "")
    cmd = [
        str(CLI), "-m", str(gguf),
        "-f", str(pf),
        "-o", str(of),
        "-n", str(ngen),
        "--temp", "0",
        "-c", "4096",
        "-t", "16",
        "-cnv", "--single-turn",
        "--no-display-prompt",
        "--log-disable",
        "-ngl", "0",
        "--no-warmup",
    ]
    say(log, f"CMD {arm}/{name} n={ngen}")
    t0 = time.time()
    with err_path.open("a", encoding="utf-8", errors="replace") as errf:
        errf.write(f"\n===== {time.strftime('%Y-%m-%dT%H:%M:%S')} {name} =====\n")
        p = subprocess.run(
            cmd, cwd=str(ROOT), env=env,
            stdout=subprocess.DEVNULL, stderr=errf,
        )
    dt = time.time() - t0
    raw = of.read_text(encoding="utf-8", errors="replace") if of.exists() else ""
    text = strip_chat(raw)
    say(log, f"  rc={p.returncode} chars={len(text)} wall={dt:.1f}s")
    if p.returncode != 0 and not text:
        say(log, f"  FAIL {arm}/{name} rc={p.returncode} see {err_path.name}")
        return None
    return text


def main() -> int:
    suite = sys.argv[1] if len(sys.argv) > 1 else "sanity"
    tags = sys.argv[2:] or list(ARMS)
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
    cell = HERE / "ab" / "olmoe" / suite
    gen = cell / "gen"
    gen.mkdir(parents=True, exist_ok=True)
    log = HERE / "logs" / f"ab-olmoe-cli-{suite}.log"
    prompts = {n: (prompt_dir / f"{n}.txt").read_text(encoding="utf-8") for n in names}
    say(log, f"olmoe llama-cli A/B suite={suite} tags={tags} ngen={ngen}")
    if not CLI.exists():
        say(log, f"FAIL missing {CLI}")
        return 2
    for tag in tags:
        for name in names:
            out = gen / f"{name}__{tag}.txt"
            if out.exists() and out.stat().st_size > 0:
                say(log, f"SKIP {name}/{tag}")
                continue
            text = generate(tag, name, prompts[name], ngen, gen, log)
            if text is None:
                continue
            out.write_text(text, encoding="utf-8")
            say(log, f"  OK {name}/{tag} chars={len(text)}")
    # markdown
    md = [
        f"# q37 OLMoE llama-cli A/B — {suite}",
        "",
        "bmoe-cli refused architecture `olmoe` (no recipe in arch_registry). This run uses",
        "`build-llama-pc/bin/llama-cli.exe` `-f` + `-cnv --single-turn --temp 0`.",
        "",
    ]
    for name in names:
        md += ["", "---", "", f"## {name}", ""]
        base = gen / f"{name}__control.txt"
        base_body = base.read_text(encoding="utf-8") if base.exists() else None
        for t in tags:
            f = gen / f"{name}__{t}.txt"
            body = f.read_text(encoding="utf-8").rstrip() if f.exists() else "(mancante)"
            ident = ""
            if t != "control" and base_body is not None and f.exists():
                ident = " **IDENTICAL to control**" if body == base_body.rstrip() else " **DIFFERS from control**"
            md += [f"### {t}{ident}", "", "```", body or "(vuoto)", "```", ""]
    (cell / "ANSWERS_CLI.md").write_text("\n".join(md) + "\n", encoding="utf-8")
    say(log, f"wrote {cell / 'ANSWERS_CLI.md'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
