#!/usr/bin/env python3
"""Answer-quality A/B: do the candidate configs still ANSWER well?

WHY THIS EXISTS (owner question, 2026-08-17)
--------------------------------------------
The campaign has only ever measured speed (tok/s, bytes) and bpb (how well the
model predicts held-out text). It has never measured whether the model still
answers well. bpb is a weak proxy for that: dropping experts removes capacity
unevenly, and a 5-language perplexity average is exactly the kind of metric that
hides a lost capability.

WHY NOT THE OBVIOUS `-p "<prompt>"` ON THE COMMAND LINE
-------------------------------------------------------
Because on Windows it silently corrupts the prompt, and a broken test is worse
than no test. Measured 2026-08-17: passing "perché città" through argv, the model
echoed back U+FFFD REPLACEMENT CHARACTER in place of both accented letters --
Windows converts the UTF-16 command line to the ANSI codepage (cp1252), so `é`
arrives as the single byte 0xE9, which is invalid UTF-8 and reaches the tokenizer
as a byte-fallback token. Every Italian prompt in the suite is affected. (The
campaign's older generations in results/dense2 are clean UTF-8 because they were
produced on the device, where the locale is UTF-8.)

So this drives the engine's `--session` mode instead: JSON request lines on stdin,
JSON responses on stdout. stdin is a byte stream, so nothing re-encodes the
prompt. It is also much faster -- the model is loaded once per config rather than
once per prompt.

WHAT TO LOOK FOR when reading ANSWERS.md, and it is not "which is prettier":
  - f45_3_istruzioni has checkable constraints (exactly three sentences, then
    exactly two questions, nothing else). A config that stops honouring them is
    degraded no matter what its bpb says.
  - f45_4_codice asks for one named function with a precise signature: it is
    either correct or it is not.
  - long_conversational_it is where collapse into repetition, or drifting out of
    Italian on long output, shows up -- the failure a perplexity number over short
    slices will not reveal.

Exploratory and qualitative BY DESIGN: it produces evidence to read, not a
p-value. No config is declared "equivalent" on the strength of this cell alone.
"""
from __future__ import annotations

import json
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(r"C:\Users\gualt\Desktop\Kalsa\moe-experiments")
BINARY = ROOT / "build-pc-mellum-ppl" / "cli" / "bmoe-cli.exe"
# Model is selectable: the quality batteries were run on CalaQwen first, but the
# Marco1c limitation was written into that report ("solo CalaQwen") and this closes it.
# argv[2] = model key; default keeps the original CalaQwen behaviour.
MODELS = {
    "calaqwen": ROOT / "models" / "Qwen3.6-35B-A3B-KEXP.gguf",
    "marco":    ROOT / "models" / "Marco-Mini-Instruct-KEXP.gguf",
}
MODEL_KEY = sys.argv[2] if len(sys.argv) > 2 else "calaqwen"
MODEL = MODELS[MODEL_KEY]

# Two suites. `long` is the original prose/code/instruction battery. `sanity` is the
# owner's follow-up (2026-08-17): "the problem is not that it writes badly, it is
# that it says things that make no sense" — four questions that each attack a
# different way of being confidently wrong: factual recall, arithmetic, practical
# judgement, and character counting (where LLMs fail systematically).
SUITE = sys.argv[1] if len(sys.argv) > 1 else "long"
if SUITE == "sanity":
    CELL = ROOT / "results" / f"answer_sanity_{MODEL_KEY}"
    PROMPT_DIR = ROOT / "prompts" / "sanity"
    NGEN = 300
else:
    CELL = ROOT / "results" / f"answer_quality_{MODEL_KEY}"
    PROMPT_DIR = ROOT / "prompts"
    NGEN = 420
GEN = CELL / "gen"
LOG = ROOT / "logs" / f"answer-{SUITE}-{MODEL_KEY}-ab.log"

# Marco's arms differ from CalaQwen's because Marco's verdict differs. Its own k8d0
# anchor (0.761332) puts d=1.0+no-renorm at +0.0490 against a 0.04 budget -- it FAILS,
# where the same config on CalaQwen sits at 50% of budget. So for Marco the shipped
# answer is d=0.0, and the interesting question is whether the gate's rejection of
# d=1.0 is VISIBLE in the answers or whether the gate is simply strict.
if MODEL_KEY == "marco":
    CONFIGS = [
        {"id": "stock",    "k": "8", "drop": "0.0", "noren": False, "label": "k=8, nessun drop — ancora (bpb 0.761332)"},
        {"id": "shipped",  "k": "6", "drop": "0.0", "noren": False, "label": "k=6, nessun drop — CONFIG DA SPEDIRE (bpb 0.766534, 13% del budget)"},
        {"id": "rejected", "k": "6", "drop": "1.0", "noren": True,  "label": "k=6, drop 1.0 + no-renorm — BOCCIATA dal gate (bpb 0.810295, 122%)"},
    ]
else:
    CONFIGS = [
        {"id": "stock",     "k": "8", "drop": "0.0",  "noren": False, "label": "k=8, nessun drop (riferimento)"},
        {"id": "k6d0",      "k": "6", "drop": "0.0",  "noren": False, "label": "k=6, nessun drop"},
        {"id": "shipped",   "k": "6", "drop": "0.65", "noren": False, "label": "k=6, drop 0.65 — ritirata 18/08"},
        {"id": "candidate", "k": "6", "drop": "1.0",  "noren": True,  "label": "k=6, drop 1.0 + no-renorm — SPEDITA"},
    ]
if SUITE == "sanity":
    PROMPTS = ["q1_f1_spa2000", "q2_tabellina9", "q3_regalo", "q4_vocali"]
else:
    PROMPTS = [
        "f45_1_esplicativo",
        "f45_3_istruzioni",
        "f45_4_codice",
        "f45_5_ragionamento",
        "f45_2_scrittura",
        "long_conversational_it",
    ]


def say(msg: str) -> None:
    line = f"[{time.strftime('%Y-%m-%dT%H:%M:%S%z')}] {msg}"
    LOG.parent.mkdir(parents=True, exist_ok=True)
    with LOG.open("a", encoding="utf-8") as f:
        f.write(line + "\n")
    with (CELL / "STATUS.txt").open("a", encoding="utf-8") as f:
        f.write(line + "\n")
    print(line, flush=True)


def base_args(cfg: dict) -> list[str]:
    a = [
        str(BINARY), "-m", str(MODEL), "--session",
        "--moe-stream", "--cache-mb", "2000", "--dense-weights", "anon", "--overlap",
        "--io-threads", "4", "--ubatch", "512", "-t", "16", "-c", "4096",
        "--temp", "0", "--chatml", "--no-think",
        "--n-expert-used", cfg["k"], "--drop-cold-experts", cfg["drop"],
        "--no-moe-fused-gemv", "--no-moe-fused-ffn",
    ]
    if cfg["noren"]:
        a.append("--drop-no-renorm")
    return a


def run_config(cfg: dict, prompts: dict[str, str]) -> None:
    todo = [p for p in PROMPTS if not (GEN / f"{p}__{cfg['id']}.txt").exists()]
    if not todo:
        say(f"SKIP config {cfg['id']} - all prompts already generated")
        return

    say(f"START config {cfg['id']} (k={cfg['k']} drop={cfg['drop']} noren={cfg['noren']}) for {len(todo)} prompts")
    import os
    env = os.environ.copy()
    env["PATH"] = f"{BINARY.parent}{os.pathsep}{ROOT / 'build-pc-mellum-ppl' / 'bin'}{os.pathsep}" + env.get("PATH", "")

    proc = subprocess.Popen(
        base_args(cfg), cwd=str(ROOT), env=env,
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        # Explicit UTF-8 on both pipes: this is the whole reason the cell uses
        # session mode instead of argv.
        encoding="utf-8", errors="replace", bufsize=1,
    )

    try:
        for i, name in enumerate(todo, start=1):
            req = {
                "cmd": "generate",
                "prompt": prompts[name],
                "id": i,
                "n_predict": NGEN,
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
                    say(f"  ERROR {name}/{cfg['id']}: {err.get('msg')}")
                    if err.get("fatal"):
                        return
                    break
                # anything else is a per-token progress line; ignore it

            dt = time.time() - t0
            if text is None:
                say(f"  FAILED {name}/{cfg['id']} - no response")
                continue
            out = GEN / f"{name}__{cfg['id']}.txt"
            out.write_text(text, encoding="utf-8")
            meta = GEN / f"{name}__{cfg['id']}.json"
            meta.write_text(json.dumps(done, ensure_ascii=False, indent=2), encoding="utf-8")
            say(f"  OK {name}/{cfg['id']} chars={len(text)} tokens={done.get('tokens')} "
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


def write_markdown(prompts: dict[str, str]) -> None:
    md: list[str] = [
        "# Qualità delle risposte — CalaQwen, quattro configurazioni, stesse domande",
        "",
        "Generato a **temperatura 0**: è deterministico, quindi ogni differenza fra due",
        "risposte è causata dalla configurazione, non dal campionamento.",
        "",
        "Prompt passati via **session mode (stdin JSON)**, non da riga di comando: su Windows",
        "`-p \"…\"` corrompe le accentate (misurato — il modello restituisce U+FFFD al posto di",
        "`é` e `à`), il che avrebbe falsato l'intero test italiano.",
        "",
        "| id | configurazione |",
        "|---|---|",
    ]
    for c in CONFIGS:
        md.append(f"| `{c['id']}` | {c['label']} |")
    md += [
        "",
        "**Cosa guardare:** in `f45_3_istruzioni` i vincoli sono verificabili (esattamente tre",
        "frasi, poi esattamente due domande, nient'altro); in `f45_4_codice` la funzione o è",
        "corretta o non lo è; in `long_conversational_it` si vede se la prosa collassa in",
        "ripetizioni o esce dall'italiano. Sono i guasti che una media di perplexity non mostra.",
        "",
    ]
    for name in PROMPTS:
        md += ["---", "", f"## {name}", "", "<details><summary>prompt</summary>", "", "```",
               prompts.get(name, "(mancante)").rstrip(), "```", "", "</details>", ""]
        for c in CONFIGS:
            f = GEN / f"{name}__{c['id']}.txt"
            body = f.read_text(encoding="utf-8").rstrip() if f.exists() else "(mancante)"
            if not body.strip():
                body = "(vuoto)"
            md += [f"### {c['id']} — {c['label']}", "", "```", body, "```", ""]
    body = "\n".join(md) + "\n"
    (CELL / "ANSWERS.md").write_text(body, encoding="utf-8")
    say(f"ANSWERS.md written ({len(body)} chars)")


def main() -> int:
    GEN.mkdir(parents=True, exist_ok=True)
    prompts = {}
    for name in PROMPTS:
        p = PROMPT_DIR / f"{name}.txt"
        if not p.exists():
            say(f"MISSING prompt {p}")
            continue
        prompts[name] = p.read_text(encoding="utf-8")
    say(f"answer-quality A/B: {len(CONFIGS)} configs x {len(prompts)} prompts, n={NGEN}, temp 0, session mode")
    for cfg in CONFIGS:
        run_config(cfg, prompts)
    write_markdown(prompts)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
