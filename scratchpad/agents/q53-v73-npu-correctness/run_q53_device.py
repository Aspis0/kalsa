from __future__ import annotations

import datetime as dt
import json
import re
import shlex
import subprocess
import sys
import time
from pathlib import Path


ROOT = Path(r"C:\Users\gualt\Desktop\Kalsa\moe-experiments")
HERE = ROOT / "scratchpad" / "agents" / "q53-v73-npu-correctness"
RAW = HERE / "raw"
ADB = r"C:\Users\gualt\AppData\Local\Android\Sdk\platform-tools\adb.exe"
SERIAL = "adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp"
DEV = "/data/local/tmp/kalsahtp"
MODEL_LFM = "/data/local/tmp/LFM2.5-8B-A1B-KEXP-fromsrc-trunk-q8_0.gguf"
MODEL_QWEN = "/data/local/tmp/kalsahtp/Qwen3.5-4B-Q4_0.gguf"
CORPUS = "/data/local/tmp/wiki.test.raw"
REMOTE_BASE = "/data/local/tmp/q53_v73_npu_correctness"


def adb(args: list[str], timeout: int = 120) -> subprocess.CompletedProcess[str]:
    return subprocess.run([ADB, "-s", SERIAL, *args], text=True, capture_output=True, timeout=timeout)


def shell(command: str, timeout: int = 7200) -> subprocess.CompletedProcess[str]:
    # adb shell accepts one command string and starts it under /system/bin/sh.
    # Passing a separate sh -c argument makes adb split the command at spaces.
    return adb(["shell", command], timeout=timeout)


def now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def battery(tag: str) -> dict[str, object]:
    p = adb(["shell", "dumpsys", "battery"], timeout=60)
    text = p.stdout
    (RAW / f"{tag}_battery.txt").write_text(text, encoding="utf-8", errors="replace")
    def val(pattern: str) -> str:
        m = re.search(pattern, text, re.I | re.M)
        return m.group(1) if m else ""
    return {
        "timestamp_utc": now(),
        "level_pct": int(val(r"^\s*level:\s*(\d+)") or -1),
        "temperature_c": int(val(r"^\s*temperature:\s*(\d+)") or -1) / 10.0,
        "temperature_raw": int(val(r"^\s*temperature:\s*(\d+)") or -1),
        "ac_powered": val(r"^\s*AC powered:\s*(\w+)").lower(),
        "usb_powered": val(r"^\s*USB powered:\s*(\w+)").lower(),
        "wireless_powered": val(r"^\s*Wireless powered:\s*(\w+)").lower(),
        "status": val(r"^\s*status:\s*(\d+)") or "",
    }


def wait_cool_start() -> dict[str, object]:
    while True:
        rec = battery("cool_start_last")
        print(json.dumps({"cool_start": rec}), flush=True)
        if rec["temperature_raw"] > 420:
            raise RuntimeError(f"battery temperature over 42C: {rec}")
        if rec["temperature_raw"] <= 350:
            return rec
        time.sleep(15)


def env_lines(htp: bool) -> str:
    lines = [
        f"export LD_LIBRARY_PATH={DEV}:/vendor/lib64:/system/vendor/lib64:/system/lib64",
        "unset GGML_OPENCL_LOG_ALLOC",
        "unset GGML_HEXAGON_HOSTBUF",
    ]
    if htp:
        lines += [
            f"export ADSP_LIBRARY_PATH={DEV}",
            f"export CDSP_LIBRARY_PATH={DEV}",
            "export GGML_HEXAGON_NDEV=1",
            "export GGML_HEXAGON_VERBOSE=1",
        ]
    else:
        lines += [
            "unset ADSP_LIBRARY_PATH",
            "unset CDSP_LIBRARY_PATH",
            "unset GGML_HEXAGON_NDEV",
            "unset GGML_HEXAGON_VERBOSE",
        ]
    return "\n".join(lines)


def run_one(tag: str, model: str, htp: bool, probe: bool = False, first_measured: bool = False) -> dict[str, object]:
    pre = wait_cool_start() if first_measured else battery(f"{tag}_pre")
    remote_log = f"{REMOTE_BASE}/{tag}.log"
    args = [
        "./llama-perplexity",
        "-m", model,
        "-f", CORPUS,
        "-c", "2048",
        "-b", "2048",
        "-ub", "1024",
        "-t", "8",
        "-ngl", "99" if htp else "0",
        "--chunks", "1" if probe else "32",
        "--ppl-stride", "0",
        "-fa", "on",
        "--load-mode", "none",
    ]
    if htp:
        args += ["-dev", "HTP0"]
    if probe:
        args += ["-v"]
    quoted = " ".join(shlex.quote(x) for x in args)
    command = "\n".join([
        f"mkdir -p {REMOTE_BASE}",
        f"cd {DEV}",
        env_lines(htp),
        f"{quoted} > {remote_log} 2>&1 &",
        "pid=$!",
        "echo BINARY_PID=$pid",
        "if [ -r /proc/$pid/cpuset ]; then echo CPUSET=$(cat /proc/$pid/cpuset); else echo CPUSET_UNAVAILABLE; fi",
        "wait $pid",
        "rc=$?",
        "echo RC=$rc",
        "exit $rc",
    ])
    print(json.dumps({"run": tag, "launch_utc": now(), "from": "adb shell", "htp": htp, "probe": probe, "args": args}), flush=True)
    p = shell(command)
    launcher = p.stdout + ("\nSTDERR\n" + p.stderr if p.stderr else "")
    (RAW / f"{tag}_launcher.txt").write_text(launcher, encoding="utf-8", errors="replace")
    pull = adb(["pull", remote_log, str(RAW / f"{tag}.log")], timeout=120)
    (RAW / f"{tag}_pull.txt").write_text(pull.stdout + pull.stderr, encoding="utf-8", errors="replace")
    post = battery(f"{tag}_post")
    rec = {
        "tag": tag,
        "model": model,
        "htp": htp,
        "probe": probe,
        "args": args,
        "pre_battery": pre,
        "launcher": launcher,
        "adb_rc": p.returncode,
        "post_battery": post,
        "remote_log": remote_log,
        "local_log": str(RAW / f"{tag}.log"),
        "timestamp_utc": now(),
    }
    (RAW / f"{tag}.json").write_text(json.dumps(rec, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps({"run_result": rec}, ensure_ascii=False), flush=True)
    return rec


def main() -> int:
    RAW.mkdir(parents=True, exist_ok=True)
    shell(f"mkdir -p {REMOTE_BASE}", timeout=60)
    records = []
    if len(sys.argv) > 1 and sys.argv[1] == "continue":
        records.append(run_one("lane1_lfm_cpuref_ppl", MODEL_LFM, False))
        records.append(run_one("lane2_qwen_htp_probe", MODEL_QWEN, True, probe=True))
        records.append(run_one("lane2_qwen_htp_ppl", MODEL_QWEN, True))
        records.append(run_one("lane2_qwen_cpuref_ppl", MODEL_QWEN, False))
    elif len(sys.argv) > 1 and sys.argv[1] == "lane2":
        records.append(run_one("lane2_qwen_htp_probe", MODEL_QWEN, True, probe=True))
        records.append(run_one("lane2_qwen_htp_ppl", MODEL_QWEN, True))
        records.append(run_one("lane2_qwen_cpuref_ppl", MODEL_QWEN, False))
    else:
        records.append(run_one("lane1_lfm_htp_probe", MODEL_LFM, True, probe=True))
        records.append(run_one("lane1_lfm_htp_ppl", MODEL_LFM, True, first_measured=True))
        records.append(run_one("lane1_lfm_cpuref_ppl", MODEL_LFM, False))
        records.append(run_one("lane2_qwen_htp_probe", MODEL_QWEN, True, probe=True))
        records.append(run_one("lane2_qwen_htp_ppl", MODEL_QWEN, True))
        records.append(run_one("lane2_qwen_cpuref_ppl", MODEL_QWEN, False))
    (HERE / "run_records.json").write_text(json.dumps(records, indent=2, ensure_ascii=False), encoding="utf-8")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise
