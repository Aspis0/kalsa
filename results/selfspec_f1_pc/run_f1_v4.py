"""F1 v4: replay catch-up. longfact only, n=256, chatml."""
from __future__ import annotations
import json, os, subprocess, sys, threading, time
from pathlib import Path

ROOT = Path(r"C:\Users\gualt\Desktop\Kalsa\moe-experiments")
WT = ROOT / "BigMoeOnEdge-selfspec-f1"
OUT = ROOT / "results" / "selfspec_f1_pc"
MODEL = ROOT / "models" / "Qwen3.6-35B-A3B-KEXP.gguf"
PROMPT = (ROOT / "results" / "selfspec_f0" / "prompts" / "p_longfact.txt").read_text(encoding="utf-8")
CLI = WT / "build" / "cli" / "bmoe-cli.exe"
BIN = WT / "build" / "bin"
COMMON = [
    str(CLI), "-m", str(MODEL), "--temp", "0", "--moe-stream", "--cache-mb", "2000",
    "--dense-weights", "anon", "--overlap", "--io-threads", "4", "--progress",
    "--session", "--chatml", "--no-think", "-c", "2048", "--ubatch", "512", "-n", "256", "-t", "4",
]

def env():
    e = os.environ.copy(); e["PATH"] = str(BIN) + os.pathsep + e.get("PATH", ""); return e

def run_session(name, extra):
    d = OUT / name; d.mkdir(parents=True, exist_ok=True)
    cmd = COMMON + extra
    (d / "cmd.txt").write_text(" ".join(cmd) + "\n", encoding="utf-8")
    print("START", name, flush=True)
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            env=env(), cwd=str(WT), text=True, encoding="utf-8", errors="replace", bufsize=1)
    errc = []
    threading.Thread(target=lambda: errc.extend(proc.stderr), daemon=True).start()
    out_f = (d / "stdout.log").open("w", encoding="utf-8")
    rec = {}
    try:
        while True:
            line = proc.stdout.readline()
            if not line: raise RuntimeError("eof before READY")
            out_f.write(line); out_f.flush()
            if line.startswith("BMOE_READY "):
                print(" READY", line.strip(), flush=True); break
            if line.startswith("BMOE_ERROR "): raise RuntimeError(line.strip())
        proc.stdin.write(json.dumps({"cmd":"generate","id":1,"prompt":PROMPT,"n_predict":256,"think":False,"clear_kv":True}) + "\n")
        proc.stdin.flush()
        while True:
            line = proc.stdout.readline()
            if not line: raise RuntimeError("eof mid-generate")
            out_f.write(line); out_f.flush()
            if line.startswith("BMOE_DONE "):
                rec = json.loads(line[len("BMOE_DONE "):]); break
            if line.startswith("BMOE_ERROR "):
                rec = {"error": json.loads(line[len("BMOE_ERROR "):])}; break
        try:
            proc.stdin.write('{"cmd":"close"}\n'); proc.stdin.close(); proc.wait(timeout=60)
        except Exception:
            proc.kill()
    except Exception as ex:
        rec = {"error": str(ex)}; 
        try: proc.kill()
        except OSError: pass
    out_f.close()
    (d / "stderr.log").write_text("".join(errc), encoding="utf-8")
    (d / "done.json").write_text(json.dumps(rec, indent=2), encoding="utf-8")
    if "text" in rec: (d / "longfact.txt").write_text(rec["text"], encoding="utf-8")
    print(" DONE", name, "tok", rec.get("tokens"), "acc", rec.get("mtp_accepted"), "dft", rec.get("mtp_drafted"), flush=True)
    return rec

def main():
    plain = run_session("v4_plain", ["--n-expert-used", "6"])
    spec = run_session("v4_selfspec", ["--n-expert-used", "6", "--selfspec-draft-k", "2", "--selfspec-gamma", "4"])
    pa = plain.get("text") or ""
    sa = spec.get("text") or ""
    pos = next((i for i in range(min(len(pa), len(sa))) if pa[i] != sa[i]), None if pa == sa else min(len(pa), len(sa)))
    acc = int(spec.get("mtp_accepted") or 0); dft = int(spec.get("mtp_drafted") or 0)
    alpha = acc / dft if dft else 0
    out = {"identical": pa == sa and bool(pa), "diff_pos": pos, "alpha": alpha, "accepted": acc, "drafted": dft,
           "plain_n": plain.get("tokens"), "selfspec_n": spec.get("tokens"),
           "plain_head": pa[:80], "selfspec_head": sa[:80],
           "spec_tok_s": spec.get("tok_s"), "spec_draft_s": spec.get("mtp_draft_s_tok")}
    (OUT / "v4_correctness.json").write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(json.dumps(out, indent=2), flush=True)
    return 0 if out["identical"] else 1

if __name__ == "__main__":
    sys.exit(main())
