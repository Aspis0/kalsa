#!/usr/bin/env python3
"""PC orchestrator: REAP-50 resident speed cells on Jelly via SSH.

Battery/temp via adb dumpsys battery. Screen via dumpsys power mWakefulness.
Timed cells never run while AC/USB powered. Temp abort 43 C, batt floor 35%.
"""
from __future__ import annotations

import datetime as dt
import re
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import jelly_battery_poll as batt

SSH = [
    "ssh",
    "-o",
    "ConnectTimeout=15",
    "-o",
    "ServerAliveInterval=10",
    "-p",
    "8022",
    "u0_a225@192.168.1.82",
]
SCP = ["scp", "-o", "ConnectTimeout=15", "-P", "8022"]
ADB = batt.ADB
SERIAL = batt.SERIAL
ROOT = Path(r"C:\Users\gualt\Desktop\Kalsa\moe-experiments")
LOCAL = ROOT / "results" / "reap50_jelly"
SCRIPTS = ROOT / "scripts"
REMOTE_DIR = "bench_reap50"
MODEL = "$HOME/models/LFM2.5-8B-A1B-REAP50-Q4_K_M.gguf"
BIN_SHA_PIN = "36b01966ba0f471d17f8fcb29ab49f64f760999c4256f612f959a7a0b178ce81"
MODEL_SHA_PIN = "2d027f33f134e5d17637430b881be7bdc29e4c78bdab3262e348cd5a745732a5"
MODEL_BYTES = 2821302016
TEMP_MAX = 43.0
BATT_MIN = 35

# k=4 cold x2, k=4 hot x1 (no fadvise, after r2), k=3 x1, k=2 x1
CELLS = [
    ("K4_COLD", 1, MODEL, "--n-expert-used 4", "cold"),
    ("K4_COLD", 2, MODEL, "--n-expert-used 4", "cold"),
    ("K4_HOT", 1, MODEL, "--n-expert-used 4", "hot"),
    ("K3", 1, MODEL, "--n-expert-used 3", "cold"),
    ("K2", 1, MODEL, "--n-expert-used 2", "cold"),
]

COMPETING = [
    "$HOME/models/LFM2.5-8B-A1B-Q4_K_M.gguf",
    "$HOME/models/LFM2.5-8B-A1B-KEXP.gguf",
    "$HOME/models/Marco-Mini-Instruct-KEXP.gguf",
    "$HOME/models/Qwen3.5-4B-Q4_K_M.gguf",
    "$HOME/models/Qwen3.5-2B-Q4_K_M.gguf",
]


def log(msg: str) -> None:
    line = f"[{dt.datetime.now().astimezone().strftime('%Y-%m-%dT%H:%M:%S%z')}] {msg}"
    print(line, flush=True)
    LOCAL.mkdir(parents=True, exist_ok=True)
    with (LOCAL / "ORCH.log").open("a", encoding="utf-8") as f:
        f.write(line + "\n")


def ssh(cmd: str, timeout: int = 300) -> subprocess.CompletedProcess:
    return subprocess.run(SSH + [cmd], capture_output=True, text=True, timeout=timeout)


def pull(remote: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        SCP + [f"u0_a225@192.168.1.82:{remote}", str(dest)],
        check=False,
        timeout=120,
    )


def wakefulness() -> str:
    r = subprocess.run(
        [str(ADB), "-s", SERIAL, "shell", "dumpsys", "power"],
        capture_output=True,
        text=True,
        timeout=20,
    )
    if r.returncode != 0:
        raise RuntimeError(f"adb dumpsys power rc={r.returncode} {r.stderr}")
    m = re.search(r"mWakefulness=(\S+)", r.stdout)
    return m.group(1).strip() if m else "UNKNOWN"


def gate() -> dict:
    info = batt.parse(batt.dumpsys())
    screen = wakefulness()
    info["screen"] = screen
    if info["plugged"]:
        raise RuntimeError(f"PLUGGED mid-session AC={info['ac']} USB={info['usb']}")
    if info["level"] >= 0 and info["level"] < BATT_MIN:
        raise RuntimeError(f"battery {info['level']} < {BATT_MIN}")
    if info["temp_c"] > 0 and info["temp_c"] > TEMP_MAX:
        raise RuntimeError(f"temp {info['temp_c']} > {TEMP_MAX}")
    return info


def sha_bin() -> str:
    r = ssh("sha256sum $HOME/bin/bmoe-cli")
    return (r.stdout or "").split()[0].strip()


def write_host_csv_header() -> None:
    p = LOCAL / "runs.csv"
    if not p.exists():
        p.write_text(
            "ts,cell,run,mode,tok_s,majflt_tok,rss_kib,res_pages,res_pct,"
            "mapped_mib,n_expert_used,batt,temp,screen,plugged,load_s,rc\n",
            encoding="utf-8",
        )


def append_host_row(cell: str, run: int, mode: str, info: dict, ssh_out: str, rc: int) -> None:
    tok = maj = rss = pages = pct = mapped = nexp = load = ""
    m = re.search(
        r"PARSE tok=(\S+) majflt=(\S+) rss_kib=(\S+) res_pages=(\S*) "
        r"hit_pct=(\S*) mapped_mib=(\S*) n_expert_used=(\S*)",
        ssh_out,
    )
    if m:
        tok, maj, rss, pages, pct, mapped, nexp = m.groups()
    lm = re.search(r"load_s=(\S+)", ssh_out)
    if lm:
        load = lm.group(1)
    ts = dt.datetime.now().astimezone().strftime("%Y-%m-%dT%H:%M:%S%z")
    with (LOCAL / "runs.csv").open("a", encoding="utf-8") as f:
        f.write(
            f"{ts},{cell},{run},{mode},{tok},{maj},{rss},{pages},{pct},"
            f"{mapped},{nexp},{info['level']},{info['temp_c']:.1f},"
            f"{info['screen']},{str(info['plugged']).lower()},{load},{rc}\n"
        )


def run_cell(cell: str, run: int, model: str, extra: str, mode: str) -> None:
    info = gate()
    log(
        f"START {cell} r{run} mode={mode} batt={info['level']} "
        f"temp={info['temp_c']:.1f} screen={info['screen']} extra=[{extra}]"
    )
    snap = LOCAL / "logs" / f"{cell}_r{run}.batt"
    snap.parent.mkdir(parents=True, exist_ok=True)
    snap.write_text(
        f"level={info['level']}\ntemp_c={info['temp_c']:.1f}\n"
        f"plugged={info['plugged']}\nscreen={info['screen']}\n",
        encoding="utf-8",
    )
    remote = (
        f"export HOME=/data/data/com.termux/files/home; "
        f"export PATH=$HOME/bin:/data/data/com.termux/files/usr/bin:$PATH; "
        f"termux-wake-lock >/dev/null 2>&1 || true; "
        f"bash $HOME/{REMOTE_DIR}/run_one.sh {cell} {model} {run} '{extra}' {mode}"
    )
    proc = ssh(remote, timeout=480)
    stdout = proc.stdout or ""
    stderr = proc.stderr or ""
    (LOCAL / "logs" / f"{cell}_r{run}.ssh.out").write_text(
        stdout + "\n---STDERR---\n" + stderr,
        encoding="utf-8",
    )
    log(f"SSH rc={proc.returncode} {cell} r{run}")
    if stdout:
        log("STDOUT " + stdout.strip().replace("\n", " | ")[:600])
    if stderr:
        log("STDERR " + stderr.strip().replace("\n", " | ")[:400])
    for name in (
        f"logs/{cell}_r{run}.log",
        f"logs/{cell}_r{run}.rss",
        f"logs/{cell}_r{run}.residency",
        "runs.csv",
        "REAP50.master.log",
        "mem.log",
    ):
        pull(f"{REMOTE_DIR}/{name}", LOCAL / name)
    append_host_row(cell, run, mode, info, stdout, proc.returncode)
    if proc.returncode != 0:
        raise RuntimeError(f"{cell} r{run} remote rc={proc.returncode}")
    # hot must follow r2 immediately; keep a short pull gap only
    time.sleep(2 if mode == "hot" or cell == "K4_COLD" and run == 2 else 8)


def push_helpers() -> None:
    ssh(f"mkdir -p $HOME/{REMOTE_DIR}/logs")
    subprocess.run(
        SCP + [str(SCRIPTS / "run_reap50_jelly_one.sh"), f"u0_a225@192.168.1.82:{REMOTE_DIR}/run_one.sh"],
        check=True,
        timeout=30,
    )
    subprocess.run(
        SCP + [str(SCRIPTS / "residency.py"), f"u0_a225@192.168.1.82:{REMOTE_DIR}/residency.py"],
        check=True,
        timeout=30,
    )
    prompt = LOCAL / "prompt.txt"
    if not prompt.exists():
        prompt.write_text(
            "You are a helpful technical assistant. Answer clearly, in plain English, "
            "with one short paragraph and then two bullet points.\n"
            "\n"
            "User: Explain what a Mixture-of-Experts language model is, and why activating "
            "only a few experts per token can reduce compute while still needing a large "
            "on-disk weight file on a phone. Mention routing and flash streaming.\n"
            "Assistant:\n",
            encoding="utf-8",
        )
    subprocess.run(
        SCP + [str(prompt), f"u0_a225@192.168.1.82:{REMOTE_DIR}/prompt.txt"],
        check=True,
        timeout=30,
    )
    ssh(f"chmod +x $HOME/{REMOTE_DIR}/run_one.sh")


def evict_competitors() -> None:
    files = " ".join(COMPETING)
    r = ssh(
        f"if [ -x $HOME/bin/cold_model.sh ]; then $HOME/bin/cold_model.sh {files}; "
        f"else echo NO_COLD_MODEL; fi",
        timeout=180,
    )
    log("EVICT competitors stdout=" + (r.stdout or "").strip().replace("\n", " | ")[:400])
    if r.stderr:
        log("EVICT stderr=" + r.stderr.strip().replace("\n", " | ")[:300])


def record_shas(tag: str) -> None:
    r = ssh(
        f"echo BIN; sha256sum $HOME/bin/bmoe-cli; "
        f"echo MODEL; ls -l {MODEL}; sha256sum {MODEL}; "
        f"echo BYTES; stat -c%s {MODEL}"
    )
    text = (r.stdout or "") + (r.stderr or "")
    log(f"SHA {tag}\n{text.strip()}")
    rec = LOCAL / "SHA_RECORDS.txt"
    prev = rec.read_text(encoding="utf-8") if rec.exists() else ""
    rec.write_text(prev + f"\n=== {tag} {dt.datetime.now().astimezone().isoformat()} ===\n{text}\n", encoding="utf-8")
    if tag.startswith("before"):
        if BIN_SHA_PIN not in text:
            raise RuntimeError(f"binary sha mismatch: {text}")
        if MODEL_SHA_PIN not in text:
            raise RuntimeError(f"model sha mismatch: {text}")
        if str(MODEL_BYTES) not in text:
            raise RuntimeError(f"model size mismatch: {text}")


def main() -> int:
    batt.LOG = LOCAL / "battery_poll.log"
    LOCAL.mkdir(parents=True, exist_ok=True)
    (LOCAL / "logs").mkdir(exist_ok=True)
    write_host_csv_header()
    log("orchestrator start REAP-50 Jelly")
    info = gate()
    log(
        f"preflight UNPLUGGED batt={info['level']} temp={info['temp_c']:.1f} "
        f"screen={info['screen']}"
    )
    push_helpers()
    record_shas("before")
    evict_competitors()
    ssh("termux-wake-lock >/dev/null 2>&1 || true")
    completed = []
    try:
        for cell, run, model, extra, mode in CELLS:
            run_cell(cell, run, model, extra, mode)
            completed.append(f"{cell}_r{run}")
            (LOCAL / "STATUS.txt").write_text("PARTIAL " + ",".join(completed) + "\n", encoding="utf-8")
        sha_after = sha_bin()
        log(f"binary sha after={sha_after}")
        if sha_after != BIN_SHA_PIN:
            raise RuntimeError(f"binary sha changed after cells: {sha_after}")
        record_shas("after")
        (LOCAL / "STATUS.txt").write_text("DONE " + ",".join(completed) + "\n", encoding="utf-8")
        log("DONE all cells")
        return 0
    except Exception as e:
        log(f"ABORT {type(e).__name__}: {e}")
        (LOCAL / "STATUS.txt").write_text(
            "PARTIAL " + ",".join(completed) + f" ABORT {e}\n", encoding="utf-8"
        )
        return 2
    finally:
        ssh("termux-wake-unlock >/dev/null 2>&1 || true", timeout=20)


if __name__ == "__main__":
    sys.exit(main())
