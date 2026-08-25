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
Q53B_HERE = ROOT / "scratchpad" / "agents" / "q53b-v73-batch-discriminator"
Q53B_RAW = Q53B_HERE / "raw"
ADB = r"C:\Users\gualt\AppData\Local\Android\Sdk\platform-tools\adb.exe"
SERIAL = "adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp"
DEV = "/data/local/tmp/kalsahtp"
MODEL_LFM = "/data/local/tmp/LFM2.5-8B-A1B-KEXP-fromsrc-trunk-q8_0.gguf"
MODEL_QWEN = "/data/local/tmp/kalsahtp/Qwen3.5-4B-Q4_0.gguf"
CORPUS = "/data/local/tmp/wiki.test.raw"
REMOTE_BASE = "/data/local/tmp/q53_v73_npu_correctness"

# Selected by main() so the same launcher writes q53b evidence into its own
# preregistration directory without changing the q53 lane's existing records.
OUT_HERE = HERE
OUT_RAW = RAW


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
    (OUT_RAW / f"{tag}_battery.txt").write_text(text, encoding="utf-8", errors="replace")
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


def run_one(
    tag: str,
    model: str,
    htp: bool,
    probe: bool = False,
    first_measured: bool = False,
    batch_size: int = 2048,
    ubatch_size: int = 1024,
) -> dict[str, object]:
    pre = wait_cool_start() if first_measured else battery(f"{tag}_pre")
    remote_log = f"{REMOTE_BASE}/{tag}.log"
    args = [
        "./llama-perplexity",
        "-m", model,
        "-f", CORPUS,
        "-c", "2048",
        "-b", str(batch_size),
        "-ub", str(ubatch_size),
        "-t", "8",
        "-ngl", "99" if htp else "0",
        "--chunks", "1" if probe else "32",
        "--ppl-stride", "0",
        "-fa", "on",
        "--load-mode", "none",
    ]
    if htp:
        args += ["-dev", "HTP0"]
    # The measured HTP arms carry execute-op proof too; q53b and the q53
    # lane-2 preregistration require -v on the measured arm, not probes only.
    if htp:
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
    (OUT_RAW / f"{tag}_launcher.txt").write_text(launcher, encoding="utf-8", errors="replace")
    pull = adb(["pull", remote_log, str(OUT_RAW / f"{tag}.log")], timeout=120)
    (OUT_RAW / f"{tag}_pull.txt").write_text(pull.stdout + pull.stderr, encoding="utf-8", errors="replace")
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
        "local_log": str(OUT_RAW / f"{tag}.log"),
        "timestamp_utc": now(),
    }
    (OUT_RAW / f"{tag}.json").write_text(json.dumps(rec, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps({"run_result": rec}, ensure_ascii=False), flush=True)
    return rec


def main() -> int:
    global OUT_HERE, OUT_RAW
    OUT_HERE = HERE
    OUT_RAW = RAW
    mode = sys.argv[1] if len(sys.argv) > 1 else "all"
    if mode in {"q53b-b512", "q53b-b1024"}:
        OUT_HERE = Q53B_HERE
        OUT_RAW = Q53B_RAW
    OUT_RAW.mkdir(parents=True, exist_ok=True)
    shell(f"mkdir -p {REMOTE_BASE}", timeout=60)
    records = []
    if mode == "q53b-b512":
        records.append(run_one("q53b_b512_htp_ppl", MODEL_LFM, True, first_measured=True, batch_size=512, ubatch_size=512))
    elif mode == "q53b-b1024":
        records.append(run_one("q53b_b1024_htp_ppl", MODEL_LFM, True, first_measured=True, batch_size=1024, ubatch_size=512))
    elif mode == "continue":
        records.append(run_one("lane1_lfm_cpuref_ppl", MODEL_LFM, False, first_measured=True))
        records.append(run_one("lane2_qwen_htp_probe", MODEL_QWEN, True, probe=True))
        records.append(run_one("lane2_qwen_htp_ppl", MODEL_QWEN, True, first_measured=True))
        records.append(run_one("lane2_qwen_cpuref_ppl", MODEL_QWEN, False, first_measured=True))
    elif mode == "lane2":
        records.append(run_one("lane2_s2_qwen_htp_probe", MODEL_QWEN, True, probe=True, first_measured=True))
        records.append(run_one("lane2_s2_qwen_htp_ppl", MODEL_QWEN, True, first_measured=True))
        records.append(run_one("lane2_s2_qwen_cpuref_ppl", MODEL_QWEN, False, first_measured=True))
    elif mode == "lane2-retry":
        records.append(run_one("lane2_s2_retry_qwen_htp_ppl", MODEL_QWEN, True, first_measured=True))
        records.append(run_one("lane2_s2_retry_qwen_cpuref_ppl", MODEL_QWEN, False, first_measured=True))
    else:
        records.append(run_one("lane1_lfm_htp_probe", MODEL_LFM, True, probe=True))
        records.append(run_one("lane1_lfm_htp_ppl", MODEL_LFM, True, first_measured=True))
        records.append(run_one("lane1_lfm_cpuref_ppl", MODEL_LFM, False, first_measured=True))
        records.append(run_one("lane2_qwen_htp_probe", MODEL_QWEN, True, probe=True))
        records.append(run_one("lane2_qwen_htp_ppl", MODEL_QWEN, True, first_measured=True))
        records.append(run_one("lane2_qwen_cpuref_ppl", MODEL_QWEN, False, first_measured=True))
    records_name = "run_records_session2.json" if mode in {"lane2", "lane2-retry"} else "run_records.json"
    (OUT_HERE / records_name).write_text(json.dumps(records, indent=2, ensure_ascii=False), encoding="utf-8")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise
