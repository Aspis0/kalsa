#!/usr/bin/env python
"""F5 multi-turn chat probe on the REAL hybrid (CalaQwen 35B).

Closes the verification gap the host gates cannot: tiny-moe is qwen3moe (not
hybrid), so the freeze branch of the wipe decision, the cancel-mid-cycle wipe and
the chat-prefix-divergence wipe are unverifiable there. This drives them on the
real model through `bmoe-cli --session` (JSON requests on stdin).

What it detects: if the draft context is poisoned after turn 1 (the F1/F2 class
of defect), the emitted text stays correct because the target context governs —
but the per-turn selfspec acceptance collapses. So alpha-per-turn is the probe,
not the text.

Arms: freeze ON and freeze OFF, three turns each, turn 2 and 3 with
clear_kv=false (continue the conversation).
"""
import json, os, re, subprocess, sys, time
from pathlib import Path

ROOT = Path(r"C:\Users\gualt\Desktop\Kalsa\moe-experiments")
EXE = ROOT / "BigMoeOnEdge-selfspec-f1" / "build-f5" / "cli" / "bmoe-cli.exe"
DLLS = ROOT / "BigMoeOnEdge-selfspec-f1" / "build-f5" / "bin"
MODEL = ROOT / "models" / "Qwen3.6-35B-A3B-KEXP.gguf"
OUT = ROOT / "results" / "selfspec_f5_pc"

TURNS = [
    "Explain in three sentences what a mixture-of-experts router does.",
    "Now explain what changes when only 2 of the experts are activated instead of 6.",
    "Given that, why does the on-disk file stay large even when few experts run?",
]
N_PREDICT = 96
MIN_TOKENS = 40  # validity gate: a turn under this measured nothing

BASE = ["-m", str(MODEL), "-t", "4", "-c", "4096", "--ubatch", "512",
        "--temp", "0", "--moe-stream", "--cache-mb", "2000",
        "--dense-weights", "anon", "--overlap", "--io-threads", "4",
        "--n-expert-used", "6", "--chatml", "--no-think", "--session"]
ARMS = [("freeze_off", ["--selfspec-draft-k", "2", "--selfspec-gamma", "4"]),
        ("freeze_on", ["--selfspec-draft-k", "2", "--selfspec-gamma", "4",
                       "--selfspec-freeze-recurrent"])]

ALPHA = re.compile(r"selfspec: (\d+)/(\d+) drafts accepted")
DONE = re.compile(r"BMOE_DONE\s+(\{.*\})")


def run_arm(name, extra, log):
    env = dict(os.environ)
    env["PATH"] = str(DLLS) + os.pathsep + env.get("PATH", "")
    p = subprocess.Popen([str(EXE)] + BASE + extra, stdin=subprocess.PIPE,
                         stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                         text=True, bufsize=1, env=env, cwd=str(EXE.parent))
    turns = []
    cur_alpha = None
    try:
        for i, prompt in enumerate(TURNS):
            req = {"cmd": "generate", "id": i + 1, "prompt": prompt,
                   "n_predict": N_PREDICT, "think": False,
                   "clear_kv": (i == 0)}
            p.stdin.write(json.dumps(req) + "\n")
            p.stdin.flush()
            while True:
                line = p.stdout.readline()
                if not line:
                    raise RuntimeError(f"{name}: process died during turn {i+1}")
                log.write(line)
                m = ALPHA.search(line)
                if m:
                    cur_alpha = (int(m.group(1)), int(m.group(2)))
                d = DONE.search(line)
                if d:
                    info = json.loads(d.group(1))
                    # Session mode does not print the end-of-run "selfspec:" line,
                    # but BMOE_DONE carries the loop's own draft counters (named
                    # mtp_* for any draft source). Those are the measurement.
                    acc, drafted = info.get("mtp_accepted"), info.get("mtp_drafted")
                    if cur_alpha is None and drafted:
                        cur_alpha = (acc, drafted)
                    turns.append({"turn": i + 1, "tokens": info.get("tokens", 0),
                                  "cancelled": info.get("cancelled", False),
                                  "decodes": info.get("mtp_decodes"),
                                  "alpha": cur_alpha})
                    cur_alpha = None
                    break
        p.stdin.write(json.dumps({"cmd": "close"}) + "\n")
        p.stdin.flush()
    finally:
        try:
            p.stdin.close()
        except Exception:
            pass
        p.wait(timeout=120)
    return turns


def main():
    results = {}
    for name, extra in ARMS:
        print(f"=== {name}", flush=True)
        with open(OUT / f"chat_{name}.log", "w", encoding="utf-8") as log:
            t0 = time.time()
            turns = run_arm(name, extra, log)
        results[name] = turns
        for t in turns:
            a = t["alpha"]
            frac = (a[0] / a[1]) if a and a[1] else None
            flag = "" if t["tokens"] >= MIN_TOKENS else "  INVALID_TOO_FEW_TOKENS"
            print("  turn %d: tokens=%d alpha=%s (%.3f)%s" %
                  (t["turn"], t["tokens"], a,
                   frac if frac is not None else float("nan"), flag), flush=True)
        print("  wall %.1fs" % (time.time() - t0), flush=True)
    (OUT / "chat_multiturn.json").write_text(json.dumps(results, indent=2))

    # The verdict this probe exists for: does acceptance survive past turn 1?
    for name, turns in results.items():
        fr = [(t["alpha"][0] / t["alpha"][1]) if t["alpha"] and t["alpha"][1] else None
              for t in turns]
        if any(f is None for f in fr):
            print(f"{name}: NO_ALPHA_REPORTED"); continue
        drop = "COLLAPSE" if fr[0] > 0 and min(fr[1:]) < 0.25 * fr[0] else "STABLE"
        print(f"{name}: alpha per turn {[round(f,3) for f in fr]} -> {drop}")


if __name__ == "__main__":
    main()
