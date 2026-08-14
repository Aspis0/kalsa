"""F1 CalaQwen correctness + noisy PC A/B. Does not kill other processes."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

OUT = Path(r"C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\selfspec_f1_pc")
CLI = Path(r"C:\Users\gualt\Desktop\Kalsa\moe-experiments\BigMoeOnEdge-selfspec-f1\build\cli\bmoe-cli.exe")
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
    "--session",
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


def run_session(tag: str, out_dir: Path, extra: list[str], jobs: list[tuple[str, Path]]) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    cmd = COMMON + extra
    (out_dir / f"{tag}.cmdline.txt").write_text(" ".join(cmd), encoding="utf-8")
    log(f"START {tag} :: {' '.join(cmd)}")
    env = os.environ.copy()
    env["PATH"] = str(DLL) + os.pathsep + env.get("PATH", "")
    stdout_path = out_dir / f"{tag}.stdout.log"
    stderr_path = out_dir / f"{tag}.stderr.log"
    fout = stdout_path.open("w", encoding="utf-8", newline="\n")
    ferr = stderr_path.open("w", encoding="utf-8", newline="\n")
    try:
        proc = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=ferr,
            env=env,
            text=True,
            bufsize=1,
        )
    except Exception as e:
        log(f"{tag} Popen failed: {e}")
        fout.close()
        ferr.close()
        return

    assert proc.stdin is not None and proc.stdout is not None
    ready = False
    t0 = time.time()
    while time.time() - t0 < 600:
        line = proc.stdout.readline()
        if line == "" and proc.poll() is not None:
            break
        if not line:
            time.sleep(0.05)
            continue
        fout.write(line)
        fout.flush()
        if line.startswith("BMOE_READY"):
            ready = True
            log(f"{tag} READY: {line.strip()}")
            break
        if line.startswith("BMOE_ERROR"):
            log(f"{tag} ERROR load: {line.strip()}")
            break
    if not ready:
        log(f"{tag} FAILED ready rc={proc.poll()}")
        try:
            proc.stdin.close()
        except Exception:
            pass
        fout.close()
        ferr.close()
        return

    results = []
    for i, (name, path) in enumerate(jobs, start=1):
        prompt = path.read_text(encoding="utf-8").rstrip()
        payload = json.dumps(
            {
                "cmd": "generate",
                "id": i,
                "prompt": prompt,
                "n_predict": 256,
                "think": False,
                "clear_kv": True,
            },
            ensure_ascii=False,
        )
        log(f"{tag} SEND id={i} name={name} bytes={len(payload)}")
        proc.stdin.write(payload + "\n")
        proc.stdin.flush()
        done = None
        t1 = time.time()
        while time.time() - t1 < 2700:
            if proc.poll() is not None and done is None:
                log(f"{tag} process exited mid-generate id={i} rc={proc.returncode}")
                break
            line = proc.stdout.readline()
            if line == "" and proc.poll() is not None:
                break
            if not line:
                time.sleep(0.05)
                continue
            fout.write(line)
            fout.flush()
            if line.startswith("BMOE_DONE") or line.startswith("BMOE_ERROR"):
                done = line.strip()
                break
        (out_dir / f"{tag}.{name}.done.txt").write_text(done or "", encoding="utf-8")
        results.append({"name": name, "done": done})
        log(f"{tag} DONE id={i} name={name} len={len(done or '')}")

    try:
        proc.stdin.write('{"cmd":"close"}\n')
        proc.stdin.flush()
        proc.stdin.close()
    except Exception:
        pass
    try:
        proc.wait(timeout=20)
    except subprocess.TimeoutExpired:
        log(f"{tag} close timed out; leaving process")
    fout.close()
    ferr.close()
    (out_dir / f"{tag}.meta.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
    log(f"END {tag} rc={proc.returncode}")


def parse_done(line: str | None) -> dict:
    if not line:
        return {}
    i = line.find("{")
    if i < 0:
        return {}
    try:
        return json.loads(line[i:])
    except json.JSONDecodeError:
        return {}


def main() -> int:
    (OUT / "correctness").mkdir(parents=True, exist_ok=True)
    (OUT / "speed").mkdir(parents=True, exist_ok=True)
    cdir = OUT / "correctness"
    run_session("plain", cdir, ["--n-expert-used", "6"], PROMPTS)
    run_session(
        "selfspec",
        cdir,
        ["--n-expert-used", "6", "--selfspec-draft-k", "2", "--selfspec-gamma", "4"],
        PROMPTS,
    )

    cmp_lines = []
    identical = True
    first_drift = None
    acc_sum = 0
    dr_sum = 0
    for name, _ in PROMPTS:
        a = parse_done((cdir / f"plain.{name}.done.txt").read_text(encoding="utf-8") if (cdir / f"plain.{name}.done.txt").exists() else "")
        b = parse_done((cdir / f"selfspec.{name}.done.txt").read_text(encoding="utf-8") if (cdir / f"selfspec.{name}.done.txt").exists() else "")
        ta, tb = a.get("text") or "", b.get("text") or ""
        (cdir / f"plain.{name}.text.txt").write_text(ta, encoding="utf-8")
        (cdir / f"selfspec.{name}.text.txt").write_text(tb, encoding="utf-8")
        acc_sum += int(b.get("mtp_accepted") or 0)
        dr_sum += int(b.get("mtp_drafted") or 0)
        if ta == tb:
            cmp_lines.append(
                f"IDENTICAL {name} chars={len(ta)} tokens={b.get('tokens')} "
                f"drafted={b.get('mtp_drafted')} accepted={b.get('mtp_accepted')} "
                f"decodes={b.get('mtp_decodes')} tok_s={b.get('tok_s')} draft_s_tok={b.get('mtp_draft_s_tok')}"
            )
        else:
            identical = False
            n = min(len(ta), len(tb))
            pos = next((i for i in range(n) if ta[i] != tb[i]), n)
            if first_drift is None:
                first_drift = f"{name}@{pos}"
            lo = max(0, pos - 8)
            cmp_lines.append(f"DRIFT {name} pos={pos}")
            cmp_lines.append(f"  plain : {ta[lo:lo+24]!r}")
            cmp_lines.append(f"  spec  : {tb[lo:lo+24]!r}")
    alpha = (acc_sum / dr_sum) if dr_sum else 0.0
    cmp_lines.append(f"POOLED_ALPHA {acc_sum}/{dr_sum} = {alpha}")
    cmp_lines.append(f"IDENTICAL_ALL {identical}")
    if first_drift:
        cmp_lines.append(f"FIRST_DRIFT {first_drift}")
    (cdir / "COMPARE.txt").write_text("\n".join(cmp_lines) + "\n", encoding="utf-8")
    log(f"COMPARE identical={identical} alpha={alpha:.4f} first={first_drift}")

    sdir = OUT / "speed"
    run_session("plain_d065", sdir, ["--n-expert-used", "6", "--drop-cold-experts", "0.65"], [PROMPTS[0]])
    run_session(
        "selfspec_d065",
        sdir,
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
        [PROMPTS[0]],
    )
    pd = parse_done((sdir / "plain_d065.longfact.done.txt").read_text(encoding="utf-8") if (sdir / "plain_d065.longfact.done.txt").exists() else "")
    sd = parse_done((sdir / "selfspec_d065.longfact.done.txt").read_text(encoding="utf-8") if (sdir / "selfspec_d065.longfact.done.txt").exists() else "")
    p_toks = float(pd.get("tok_s") or 0)
    s_toks = float(sd.get("tok_s") or 0)
    s_draft = float(sd.get("mtp_draft_s_tok") or 0)
    s_eff = 0.0
    if s_toks > 0:
        den = (1.0 / s_toks) + s_draft
        s_eff = (1.0 / den) if den > 0 else 0.0
    speedup = (s_eff / p_toks) if p_toks > 0 else 0.0
    (sdir / "SPEED.txt").write_text(
        "\n".join(
            [
                f"plain_d065 tok_s={p_toks} (decode-only; no draft)",
                f"selfspec_d065 tok_s={s_toks} draft_s_tok={s_draft} eff={s_eff} "
                f"accepted={sd.get('mtp_accepted')} drafted={sd.get('mtp_drafted')} decodes={sd.get('mtp_decodes')}",
                f"speedup_eff {speedup} (NOISY_ENV)",
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    log(f"SPEED plain={p_toks} spec_eff={s_eff} speedup={speedup}")

    if identical:
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
