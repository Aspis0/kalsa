"""F1 v3: draft ctx created at draft_k. chatml. Sequential. Abort session on eof."""
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
PDIR = ROOT / "results" / "selfspec_f0" / "prompts"
CLI = WT / "build" / "cli" / "bmoe-cli.exe"
BIN = WT / "build" / "bin"
PROMPTS = {
    "longfact": PDIR / "p_longfact.txt",
    "creative": PDIR / "p_creative.txt",
    "code": PDIR / "p_code.txt",
}
COMMON = [
    str(CLI), "-m", str(MODEL),
    "--temp", "0", "--moe-stream", "--cache-mb", "2000",
    "--dense-weights", "anon", "--overlap", "--io-threads", "4",
    "--progress", "--session", "--chatml", "--no-think",
    "-c", "2048", "--ubatch", "512", "-n", "256", "-t", "4",
]


def env() -> dict[str, str]:
    e = os.environ.copy()
    e["PATH"] = str(BIN) + os.pathsep + e.get("PATH", "")
    return e


def run_session(name: str, extra: list[str], names: list[str]) -> dict:
    d = OUT / name
    d.mkdir(parents=True, exist_ok=True)
    cmd = COMMON + extra
    (d / "cmd.txt").write_text(" ".join(cmd) + "\n", encoding="utf-8")
    print(f"START {name}", flush=True)
    t0 = time.time()
    proc = subprocess.Popen(
        cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        env=env(), cwd=str(WT), text=True, encoding="utf-8", errors="replace", bufsize=1,
    )
    assert proc.stdin and proc.stdout and proc.stderr
    out_f = (d / "stdout.log").open("w", encoding="utf-8")
    err_chunks: list[str] = []

    def drain() -> None:
        for c in proc.stderr:
            err_chunks.append(c)

    th = threading.Thread(target=drain, daemon=True)
    th.start()
    ready = None
    err = None
    results: list[dict] = []

    def send(o: dict) -> None:
        proc.stdin.write(json.dumps(o, ensure_ascii=False) + "\n")
        proc.stdin.flush()

    try:
        while True:
            line = proc.stdout.readline()
            if not line:
                raise RuntimeError("eof before BMOE_READY")
            out_f.write(line)
            out_f.flush()
            if line.startswith("BMOE_READY "):
                ready = json.loads(line[len("BMOE_READY "):])
                break
            if line.startswith("BMOE_ERROR "):
                raise RuntimeError(line.strip())
        print(f"  READY {name} {ready}", flush=True)
        for i, pn in enumerate(names, 1):
            send({"cmd": "generate", "id": i, "prompt": PROMPTS[pn].read_text(encoding="utf-8"),
                  "n_predict": 256, "think": False, "clear_kv": True})
            rec: dict = {"id": i, "prompt": pn}
            while True:
                line = proc.stdout.readline()
                if not line:
                    rec["error"] = "eof mid-generate"
                    break
                out_f.write(line)
                out_f.flush()
                if line.startswith("BMOE_DONE "):
                    rec["done"] = json.loads(line[len("BMOE_DONE "):])
                    break
                if line.startswith("BMOE_ERROR "):
                    rec["error"] = json.loads(line[len("BMOE_ERROR "):])
                    break
            results.append(rec)
            payload = rec.get("done") or rec.get("error") or {}
            (d / f"{pn}.done.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")
            if isinstance(rec.get("done"), dict):
                (d / f"{pn}.txt").write_text(rec["done"].get("text") or "", encoding="utf-8")
            print(f"  DONE {name}/{pn} tokens={(rec.get('done') or {}).get('tokens')} err={rec.get('error')}", flush=True)
            if rec.get("error"):
                break
        try:
            send({"cmd": "close"})
            proc.stdin.close()
        except Exception:
            pass
        proc.wait(timeout=90)
    except Exception as ex:
        err = str(ex)
        print(f"  FAIL {name}: {err}", flush=True)
        try:
            proc.kill()
        except OSError:
            pass
    finally:
        th.join(timeout=20)
        (d / "stderr.log").write_text("".join(err_chunks), encoding="utf-8")
        out_f.close()
    meta = {"name": name, "cmd": cmd, "ready": ready, "error": err,
            "elapsed_s": time.time() - t0, "returncode": proc.returncode,
            "results": [{"prompt": r.get("prompt"), "error": r.get("error"), "done": r.get("done")} for r in results]}
    (d / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    return meta


def first_diff(a: str, b: str):
    if a == b:
        return None
    n = min(len(a), len(b))
    i = next((i for i in range(n) if a[i] != b[i]), n)
    lo = max(0, i - 40)
    return {"pos": i, "plain_ctx": a[lo:i + 40], "selfspec_ctx": b[lo:i + 40],
            "plain_len": len(a), "selfspec_len": len(b)}


def done_of(m, pn):
    for r in m.get("results") or []:
        if r.get("prompt") == pn:
            return r.get("done") or {}
    return {}


def main() -> int:
    names = ["longfact", "creative", "code"]
    plain = run_session("v3_correct_plain", ["--n-expert-used", "6"], names)
    spec = run_session("v3_correct_selfspec",
                       ["--n-expert-used", "6", "--selfspec-draft-k", "2", "--selfspec-gamma", "4"], names)
    acc = drafted = 0
    identical = True
    first = None
    rows = {}
    for pn in names:
        pa = (OUT / "v3_correct_plain" / f"{pn}.txt").read_text(encoding="utf-8") if (OUT / "v3_correct_plain" / f"{pn}.txt").exists() else ""
        sa = (OUT / "v3_correct_selfspec" / f"{pn}.txt").read_text(encoding="utf-8") if (OUT / "v3_correct_selfspec" / f"{pn}.txt").exists() else ""
        df = first_diff(pa, sa)
        dn = done_of(spec, pn)
        acc += int(dn.get("mtp_accepted") or 0)
        drafted += int(dn.get("mtp_drafted") or 0)
        rows[pn] = {"identical": df is None and bool(pa), "diff": df,
                    "plain_n": done_of(plain, pn).get("tokens"), "selfspec_n": dn.get("tokens"),
                    "mtp_accepted": dn.get("mtp_accepted"), "mtp_drafted": dn.get("mtp_drafted"),
                    "mtp_decodes": dn.get("mtp_decodes"), "tok_s": dn.get("tok_s"),
                    "mtp_draft_s_tok": dn.get("mtp_draft_s_tok")}
        if df is not None:
            identical = False
            if first is None:
                first = {"prompt": pn, **df}
    alpha = acc / drafted if drafted else 0.0
    cmp = {"identical": identical, "first_diff": first, "pooled_alpha": alpha,
           "pooled_accepted": acc, "pooled_drafted": drafted, "prompts": rows,
           "plain_error": plain.get("error"), "selfspec_error": spec.get("error")}
    (OUT / "v3_correctness.json").write_text(json.dumps(cmp, indent=2), encoding="utf-8")
    print("correctness", json.dumps(cmp, indent=2), flush=True)

    sp = run_session("v3_speed_plain_d065", ["--n-expert-used", "6", "--drop-cold-experts", "0.65"], ["longfact"])
    ss = run_session("v3_speed_selfspec_d065",
                     ["--n-expert-used", "6", "--selfspec-draft-k", "2", "--selfspec-gamma", "4",
                      "--drop-cold-experts", "0.65"], ["longfact"])

    def eff(m):
        d = done_of(m, "longfact")
        tok_s = float(d.get("tok_s") or 0)
        draft = float(d.get("mtp_draft_s_tok") or 0)
        st = 1 / tok_s if tok_s else 0
        e = 1 / (st + draft) if (st + draft) else 0
        return {"tok_s": tok_s, "mtp_draft_s_tok": draft, "tok_s_eff": e, "tokens": d.get("tokens"),
                "mtp_accepted": d.get("mtp_accepted"), "mtp_drafted": d.get("mtp_drafted"),
                "mtp_decodes": d.get("mtp_decodes")}

    speed = {"plain": eff(sp), "selfspec": eff(ss), "label": "NOISY_ENV"}
    if speed["plain"]["tok_s_eff"] and speed["selfspec"]["tok_s_eff"]:
        speed["speedup"] = speed["selfspec"]["tok_s_eff"] / speed["plain"]["tok_s_eff"]
    (OUT / "v3_speed.json").write_text(json.dumps(speed, indent=2), encoding="utf-8")
    print("speed", json.dumps(speed, indent=2), flush=True)
    return 0 if identical and drafted and not spec.get("error") and not plain.get("error") else 1


if __name__ == "__main__":
    sys.exit(main())
