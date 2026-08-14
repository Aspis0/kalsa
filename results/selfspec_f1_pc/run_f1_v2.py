"""F1 CalaQwen correctness + noisy PC A/B, v2: chatml + n_rs_seq fix."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import time
from pathlib import Path

ROOT = Path(r"C:\Users\gualt\Desktop\Kalsa\moe-experiments")
WT = ROOT / "BigMoeOnEdge-selfspec-f1"
OUT = ROOT / "results" / "selfspec_f1_pc"
MODEL = ROOT / "models" / "Qwen3.6-35B-A3B-KEXP.gguf"
PROMPTS = ROOT / "results" / "selfspec_f0" / "prompts"
CLI = WT / "build" / "cli" / "bmoe-cli.exe"
BIN = WT / "build" / "bin"

PROMPT_FILES = {
    "longfact": PROMPTS / "p_longfact.txt",
    "creative": PROMPTS / "p_creative.txt",
    "code": PROMPTS / "p_code.txt",
}

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
    "--chatml",
    "--no-think",
    "-c",
    "2048",
    "--ubatch",
    "512",
    "-n",
    "256",
    "-t",
    "4",
]


def env_with_dlls() -> dict[str, str]:
    e = os.environ.copy()
    e["PATH"] = str(BIN) + os.pathsep + e.get("PATH", "")
    return e


def run_session(name: str, extra: list[str], prompt_names: list[str], n_predict: int = 256) -> dict:
    out_dir = OUT / name
    out_dir.mkdir(parents=True, exist_ok=True)
    stdout_path = out_dir / "stdout.log"
    stderr_path = out_dir / "stderr.log"
    cmd = COMMON + extra
    (out_dir / "cmd.txt").write_text(" ".join(cmd) + "\n", encoding="utf-8")
    print(f"START {name}", flush=True)

    t0 = time.time()
    proc = subprocess.Popen(
        cmd,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env_with_dlls(),
        cwd=str(WT),
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
    )
    assert proc.stdin and proc.stdout and proc.stderr

    stdout_f = stdout_path.open("w", encoding="utf-8")
    stderr_chunks: list[str] = []
    results: list[dict] = []
    ready = None
    err = None

    def _drain_err() -> None:
        assert proc.stderr
        for chunk in proc.stderr:
            stderr_chunks.append(chunk)

    err_th = threading.Thread(target=_drain_err, daemon=True)
    err_th.start()

    def send(obj: dict) -> None:
        proc.stdin.write(json.dumps(obj, ensure_ascii=False) + "\n")
        proc.stdin.flush()

    try:
        while True:
            line = proc.stdout.readline()
            if not line:
                err = "eof before BMOE_READY"
                break
            stdout_f.write(line)
            stdout_f.flush()
            if line.startswith("BMOE_READY "):
                ready = json.loads(line[len("BMOE_READY ") :])
                break
            if line.startswith("BMOE_ERROR "):
                err = line.strip()
                break
        if err:
            raise RuntimeError(err)
        if ready is None:
            raise RuntimeError("no BMOE_READY")
        print(f"  READY {name} {ready}", flush=True)

        for i, pname in enumerate(prompt_names, start=1):
            prompt = PROMPT_FILES[pname].read_text(encoding="utf-8")
            send(
                {
                    "cmd": "generate",
                    "id": i,
                    "prompt": prompt,
                    "n_predict": n_predict,
                    "think": False,
                    "clear_kv": True,
                }
            )
            rec: dict = {"id": i, "prompt": pname}
            while True:
                line = proc.stdout.readline()
                if not line:
                    rec["error"] = "eof mid-generate"
                    break
                stdout_f.write(line)
                stdout_f.flush()
                if line.startswith("BMOE_DONE "):
                    rec["done"] = json.loads(line[len("BMOE_DONE ") :])
                    break
                if line.startswith("BMOE_ERROR "):
                    rec["error"] = json.loads(line[len("BMOE_ERROR ") :])
                    break
            results.append(rec)
            payload = rec.get("done") or rec.get("error") or {}
            (out_dir / f"{pname}.done.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")
            if isinstance(rec.get("done"), dict) and "text" in rec["done"]:
                (out_dir / f"{pname}.txt").write_text(rec["done"]["text"], encoding="utf-8")
            ntok = (rec.get("done") or {}).get("tokens")
            print(f"  DONE {name}/{pname} tokens={ntok} err={rec.get('error')}", flush=True)
            if rec.get("error") and isinstance(rec["error"], dict) and rec["error"].get("fatal"):
                break

        try:
            send({"cmd": "close"})
            proc.stdin.close()
        except Exception:
            pass
        try:
            proc.wait(timeout=90)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=30)
    except Exception as ex:
        err = str(ex)
        print(f"  FAIL {name}: {err}", flush=True)
        try:
            proc.kill()
        except OSError:
            pass
    finally:
        err_th.join(timeout=30)
        stderr_path.write_text("".join(stderr_chunks), encoding="utf-8")
        stdout_f.close()

    meta = {
        "name": name,
        "cmd": cmd,
        "ready": ready,
        "error": err,
        "elapsed_s": time.time() - t0,
        "returncode": proc.returncode,
        "results": [
            {"prompt": r.get("prompt"), "id": r.get("id"), "error": r.get("error"), "done": r.get("done")}
            for r in results
        ],
    }
    (out_dir / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    return meta


def first_diff(a: str, b: str) -> dict | None:
    if a == b:
        return None
    n = min(len(a), len(b))
    i = 0
    while i < n and a[i] == b[i]:
        i += 1
    lo = max(0, i - 40)
    return {"pos": i, "plain_ctx": a[lo : i + 40], "selfspec_ctx": b[lo : i + 40], "plain_len": len(a), "selfspec_len": len(b)}


def done_of(meta: dict, pname: str) -> dict:
    for r in meta.get("results") or []:
        if r.get("prompt") == pname:
            return r.get("done") or {}
    return {}


def eff(meta: dict) -> dict:
    d = ((meta.get("results") or [{}])[0].get("done")) or {}
    tok_s = float(d.get("tok_s") or 0.0)
    draft = float(d.get("mtp_draft_s_tok") or 0.0)
    s_tok = 1.0 / tok_s if tok_s > 0 else 0.0
    eff_tps = 1.0 / (s_tok + draft) if (s_tok + draft) > 0 else 0.0
    return {
        "tok_s": tok_s,
        "mtp_draft_s_tok": draft,
        "tok_s_eff": eff_tps,
        "tokens": d.get("tokens"),
        "mtp_accepted": d.get("mtp_accepted"),
        "mtp_drafted": d.get("mtp_drafted"),
        "mtp_decodes": d.get("mtp_decodes"),
    }


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    names = ["longfact", "creative", "code"]

    plain = run_session("v2_correct_plain", ["--n-expert-used", "6"], names)
    spec = run_session(
        "v2_correct_selfspec",
        ["--n-expert-used", "6", "--selfspec-draft-k", "2", "--selfspec-gamma", "4"],
        names,
    )

    cmp: dict = {"prompts": {}, "chatml": True}
    acc = drafted = 0
    identical = True
    first = None
    for pname in names:
        pt = OUT / "v2_correct_plain" / f"{pname}.txt"
        st = OUT / "v2_correct_selfspec" / f"{pname}.txt"
        pa = pt.read_text(encoding="utf-8") if pt.exists() else ""
        sa = st.read_text(encoding="utf-8") if st.exists() else ""
        d = first_diff(pa, sa)
        done = done_of(spec, pname)
        acc += int(done.get("mtp_accepted") or 0)
        drafted += int(done.get("mtp_drafted") or 0)
        cmp["prompts"][pname] = {
            "identical": d is None and bool(pa),
            "diff": d,
            "plain_n": done_of(plain, pname).get("tokens"),
            "selfspec_n": done.get("tokens"),
            "mtp_accepted": done.get("mtp_accepted"),
            "mtp_drafted": done.get("mtp_drafted"),
            "mtp_decodes": done.get("mtp_decodes"),
            "tok_s": done.get("tok_s"),
            "mtp_draft_s_tok": done.get("mtp_draft_s_tok"),
        }
        if d is not None:
            identical = False
            if first is None:
                first = {"prompt": pname, **d}

    alpha = (acc / drafted) if drafted else 0.0
    cmp.update(
        {
            "identical": identical,
            "first_diff": first,
            "pooled_alpha": alpha,
            "pooled_accepted": acc,
            "pooled_drafted": drafted,
            "plain_error": plain.get("error"),
            "selfspec_error": spec.get("error"),
        }
    )
    (OUT / "v2_correctness.json").write_text(json.dumps(cmp, indent=2), encoding="utf-8")
    print("correctness identical", identical, "alpha", round(alpha, 4), flush=True)

    sp = run_session("v2_speed_plain_d065", ["--n-expert-used", "6", "--drop-cold-experts", "0.65"], ["longfact"])
    ss = run_session(
        "v2_speed_selfspec_d065",
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
        ["longfact"],
    )
    speed = {
        "plain": eff(sp),
        "selfspec": eff(ss),
        "plain_error": sp.get("error"),
        "selfspec_error": ss.get("error"),
        "label": "NOISY_ENV",
        "chatml": True,
    }
    if speed["plain"]["tok_s_eff"] and speed["selfspec"]["tok_s_eff"]:
        speed["speedup"] = speed["selfspec"]["tok_s_eff"] / speed["plain"]["tok_s_eff"]
    (OUT / "v2_speed.json").write_text(json.dumps(speed, indent=2), encoding="utf-8")
    print(json.dumps(speed, indent=2), flush=True)
    return 0 if identical and not spec.get("error") and not plain.get("error") else 1


if __name__ == "__main__":
    sys.exit(main())
