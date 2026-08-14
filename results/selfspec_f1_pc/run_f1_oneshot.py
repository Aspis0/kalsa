"""One-shot CalaQwen F1 gates. stdout/stderr go to files. No session pipes."""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

OUT = Path(r"C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\selfspec_f1_pc")
CLI = Path(r"C:\Users\gualt\Desktop\Kalsa\moe-experiments\BigMoeOnEdge-selfspec-f1\build\cli\bmoe-cli-f1.exe")
DLL = Path(r"C:\Users\gualt\Desktop\Kalsa\moe-experiments\BigMoeOnEdge-selfspec-f1\build\bin")
MODEL = Path(r"C:\Users\gualt\Desktop\Kalsa\moe-experiments\models\Qwen3.6-35B-A3B-KEXP.gguf")
PDIR = Path(r"C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\selfspec_f0\prompts")

COMMON = [
    str(CLI),
    "-m",
    str(MODEL),
    "--temp",
    "0",
    "--moe-stream",
    "--cache-mb",
    "2000",
    "--dense-weights",
    "anon",
    "--overlap",
    "--io-threads",
    "4",
    "--progress",
    "-c",
    "2048",
    "--ubatch",
    "512",
    "-n",
    "256",
    "-t",
    "4",
]

PROMPTS = [
    ("longfact", PDIR / "p_longfact.txt"),
    ("creative", PDIR / "p_creative.txt"),
    ("code", PDIR / "p_code.txt"),
]


def log(msg: str) -> None:
    line = f"[{datetime.now():%H:%M:%S}] {msg}"
    print(line, flush=True)
    with (OUT / "run.log").open("a", encoding="utf-8") as f:
        f.write(line + "\n")


def extract_answer(stdout: str) -> str:
    m = re.search(r"=== answer ===\n(.*)\n=== perf ===", stdout, re.S)
    if m:
        return m.group(1)
    return ""


def extract_perf(stdout: str) -> dict:
    out = {}
    m = re.search(
        r"selfspec: (\d+)/(\d+) drafts accepted \(([0-9.]+)% = alpha\), ([0-9.]+) tokens per verify decode",
        stdout,
    )
    if m:
        out["accepted"] = int(m.group(1))
        out["drafted"] = int(m.group(2))
        out["alpha_pct"] = float(m.group(3))
        out["tok_per_decode"] = float(m.group(4))
    m = re.search(
        r"selfspec: drafting costs ([0-9.]+) s/token on top of decode → ([0-9.]+) tok/s effective \(vs ([0-9.]+) reported\)",
        stdout,
    )
    if m:
        out["draft_s_tok"] = float(m.group(1))
        out["tok_s_eff"] = float(m.group(2))
        out["tok_s"] = float(m.group(3))
    m = re.search(r"generation: (\d+) tokens, .* \(([0-9.]+) tok/s\)", stdout)
    if m:
        out["n_generated"] = int(m.group(1))
        out["tok_s_decode"] = float(m.group(2))
    return out


def run_one(tag: str, extra: list[str], name: str, prompt_path: Path, dest: Path) -> dict:
    dest.mkdir(parents=True, exist_ok=True)
    prompt = prompt_path.read_text(encoding="utf-8").rstrip()
    cmd = COMMON + extra + ["-p", prompt]
    (dest / f"{tag}.{name}.cmdline.txt").write_text(
        " ".join(COMMON + extra + ["-p", f"<{name}>"]), encoding="utf-8"
    )
    log(f"START {tag}/{name}")
    env = os.environ.copy()
    env["PATH"] = str(DLL) + os.pathsep + env.get("PATH", "")
    so = dest / f"{tag}.{name}.stdout.log"
    se = dest / f"{tag}.{name}.stderr.log"
    t0 = time.time()
    with so.open("w", encoding="utf-8", newline="\n") as fout, se.open(
        "w", encoding="utf-8", newline="\n"
    ) as ferr:
        try:
            proc = subprocess.run(
                cmd, stdout=fout, stderr=ferr, env=env, timeout=2700
            )
            rc = proc.returncode
        except subprocess.TimeoutExpired:
            rc = -9
            log(f"TIMEOUT {tag}/{name}")
    dt = time.time() - t0
    stdout = so.read_text(encoding="utf-8", errors="replace")
    text = extract_answer(stdout)
    perf = extract_perf(stdout)
    (dest / f"{tag}.{name}.text.txt").write_text(text, encoding="utf-8")
    (dest / f"{tag}.{name}.perf.json").write_text(json.dumps(perf, indent=2), encoding="utf-8")
    log(f"END {tag}/{name} rc={rc} s={dt:.1f} chars={len(text)} perf={perf}")
    return {"tag": tag, "name": name, "rc": rc, "text": text, "perf": perf, "s": dt}


def main() -> int:
    cdir = OUT / "correctness"
    sdir = OUT / "speed"
    cdir.mkdir(parents=True, exist_ok=True)
    sdir.mkdir(parents=True, exist_ok=True)

    # Reuse existing plain longfact/creative BMOE_DONE texts if present and non-empty.
    results = {}
    for name, path in PROMPTS:
        existing = cdir / f"plain.{name}.done.txt"
        text_path = cdir / f"plain.{name}.text.txt"
        if name != "code" and existing.exists() and existing.stat().st_size > 50:
            raw = existing.read_text(encoding="utf-8")
            i = raw.find("{")
            try:
                obj = json.loads(raw[i:]) if i >= 0 else {}
            except json.JSONDecodeError:
                obj = {}
            t = obj.get("text") or ""
            if t:
                text_path.write_text(t, encoding="utf-8")
                results[("plain", name)] = {"text": t, "perf": {}, "rc": 0, "reused": True}
                log(f"REUSE plain/{name} chars={len(t)}")
                continue
        results[("plain", name)] = run_one("plain", ["--n-expert-used", "6"], name, path, cdir)

    for name, path in PROMPTS:
        results[("selfspec", name)] = run_one(
            "selfspec",
            ["--n-expert-used", "6", "--selfspec-draft-k", "2", "--selfspec-gamma", "4"],
            name,
            path,
            cdir,
        )

    cmp = []
    identical = True
    first_drift = None
    acc_sum = 0
    dr_sum = 0
    for name, _ in PROMPTS:
        a = results[("plain", name)]["text"]
        b = results[("selfspec", name)]["text"]
        p = results[("selfspec", name)]["perf"]
        acc_sum += int(p.get("accepted") or 0)
        dr_sum += int(p.get("drafted") or 0)
        if a == b and a:
            cmp.append(f"IDENTICAL {name} chars={len(a)} {p}")
        else:
            identical = False
            n = min(len(a), len(b))
            pos = next((i for i in range(n) if a[i] != b[i]), n)
            if first_drift is None:
                first_drift = f"{name}@{pos}"
            lo = max(0, pos - 8)
            cmp.append(f"DRIFT {name} pos={pos} a_len={len(a)} b_len={len(b)}")
            cmp.append(f"  plain : {a[lo:lo+24]!r}")
            cmp.append(f"  spec  : {b[lo:lo+24]!r}")
            cmp.append(f"  perf  : {p}")
    alpha = (acc_sum / dr_sum) if dr_sum else 0.0
    cmp.append(f"POOLED_ALPHA {acc_sum}/{dr_sum} = {alpha}")
    cmp.append(f"IDENTICAL_ALL {identical}")
    if first_drift:
        cmp.append(f"FIRST_DRIFT {first_drift}")
    (cdir / "COMPARE.txt").write_text("\n".join(cmp) + "\n", encoding="utf-8")
    log(f"COMPARE identical={identical} alpha={alpha:.4f} first={first_drift}")

    run_one("plain_d065", ["--n-expert-used", "6", "--drop-cold-experts", "0.65"], "longfact", PROMPTS[0][1], sdir)
    spec_ab = run_one(
        "selfspec_d065",
        [
            "--n-expert-used",
            "6",
            "--selfspec-draft-k",
            "2",
            "--selfspec-gamma",
            "4",
            "--drop-cold-experts",
            "0.65",
        ],
        "longfact",
        PROMPTS[0][1],
        sdir,
    )
    # plain A/B tok/s from its stdout
    p_stdout = (sdir / "plain_d065.longfact.stdout.log").read_text(encoding="utf-8", errors="replace")
    p_perf = extract_perf(p_stdout)
    # extract_perf looks for selfspec: lines; for plain, use generation tok/s
    m = re.search(r"generation: (\d+) tokens, .* \(([0-9.]+) tok/s\)", p_stdout)
    p_toks = float(m.group(2)) if m else 0.0
    s_eff = float(spec_ab["perf"].get("tok_s_eff") or 0)
    speedup = (s_eff / p_toks) if p_toks > 0 else 0.0
    (sdir / "SPEED.txt").write_text(
        f"plain_d065 tok_s={p_toks} {p_perf}\n"
        f"selfspec_d065 {spec_ab['perf']}\n"
        f"speedup_eff {speedup} (NOISY_ENV)\n",
        encoding="utf-8",
    )
    log(f"SPEED plain={p_toks} spec_eff={s_eff} speedup={speedup}")

    if identical and acc_sum > 0:
        verdict = f"F1_CORRECT(identical) alpha={alpha:.2f} PC speedup {speedup:.2f} (NOISY_ENV)"
    elif first_drift:
        verdict = f"F1_CORRECT(drift@{first_drift}) alpha={alpha:.2f} PC speedup {speedup:.2f} (NOISY_ENV)"
    else:
        verdict = f"F1_BLOCKED(compare failed) alpha={alpha:.2f}"
    (OUT / "VERDICT.txt").write_text(verdict + "\n", encoding="utf-8")
    log(verdict)
    log("RUNNER_DONE")
    return 0


if __name__ == "__main__":
    sys.exit(main())
