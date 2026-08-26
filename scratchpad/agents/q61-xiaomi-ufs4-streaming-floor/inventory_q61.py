from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
import re
import subprocess
from pathlib import Path


ROOT = Path(r"C:\Users\gualt\Desktop\Kalsa\moe-experiments")
CELL = ROOT / "scratchpad" / "agents" / "q61-xiaomi-ufs4-streaming-floor"
RAW = CELL / "raw"
ADB = r"C:\Users\gualt\AppData\Local\Android\Sdk\platform-tools\adb.exe"
SERIAL = "adb-625689a2-9xEOfw._adb-tls-connect._tcp"


class DeviceDrop(RuntimeError):
    pass


def adb(args: list[str], timeout: float = 60.0) -> str:
    env = os.environ.copy()
    env["MSYS_NO_PATHCONV"] = "1"
    try:
        result = subprocess.run([ADB, "-s", SERIAL, *args], text=True, capture_output=True, timeout=timeout, env=env)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise DeviceDrop(str(exc)) from exc
    text = result.stdout + result.stderr
    if result.returncode != 0:
        low = text.lower()
        if any(marker in low for marker in ("offline", "not found", "no devices", "connection refused", "closed")):
            raise DeviceDrop(text.strip())
        raise RuntimeError(text.strip())
    return text


def shell(command: str, timeout: float = 60.0) -> str:
    return adb(["shell", command], timeout=timeout)


def parse_ls(text: str, path: str) -> int | None:
    for line in text.splitlines():
        if line.rstrip().endswith(path):
            fields = line.split()
            if len(fields) >= 5 and fields[4].isdigit():
                return int(fields[4])
    return None


def sha_remote(path: str) -> str:
    text = shell(f"sha256sum '{path}'", timeout=300.0)
    match = re.search(r"^([0-9a-fA-F]{64})\s+", text, re.MULTILINE)
    if not match:
        raise RuntimeError(f"sha256sum missing for {path}: {text}")
    return match.group(1).lower()


def sha_local(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def main() -> None:
    RAW.mkdir(parents=True, exist_ok=True)
    state = adb(["get-state"], timeout=15.0).strip()
    if state != "device":
        raise DeviceDrop(f"unexpected state {state!r}")
    identity = {key: shell(f"getprop {key}").strip() for key in ("ro.serialno", "ro.product.model", "ro.product.device", "ro.product.name", "ro.soc.model")}
    meminfo = shell("cat /proc/meminfo")
    df_data = shell("df -k /data")
    df_tmp = shell("df -k /data/local/tmp")
    battery = shell("dumpsys battery")
    try:
        psi = shell("cat /proc/pressure/io")
        psi_readable = True
    except RuntimeError as exc:
        psi = f"UNREADABLE: {exc}\n"
        psi_readable = False
    (RAW / "inventory_meminfo.txt").write_text(meminfo, encoding="utf-8", newline="\n")
    (RAW / "inventory_df_data.txt").write_text(df_data, encoding="utf-8", newline="\n")
    (RAW / "inventory_df_tmp.txt").write_text(df_tmp, encoding="utf-8", newline="\n")
    (RAW / "inventory_battery.txt").write_text(battery, encoding="utf-8", newline="\n")
    (RAW / "inventory_psi_io.txt").write_text(psi, encoding="utf-8", newline="\n")

    mem_total = int(re.search(r"^MemTotal:\s+(\d+) kB", meminfo, re.MULTILINE).group(1))
    mem_available = int(re.search(r"^MemAvailable:\s+(\d+) kB", meminfo, re.MULTILINE).group(1))
    gguf_paths = [line.strip() for line in shell("find /data/local/tmp -type f -name '*.gguf'").splitlines() if line.strip()]
    bench_paths = [line.strip() for line in shell("find /data/local/tmp -type f -name llama-bench").splitlines() if line.strip()]
    ggufs: list[dict[str, object]] = []
    inventory_lines: list[str] = []
    for path in sorted(gguf_paths):
        size = parse_ls(shell(f"ls -ln '{path}'"), path)
        digest = sha_remote(path)
        item = {"path": path, "bytes": size, "sha256": digest, "is_moe_candidate": bool(re.search(r"KEXP|OLMoE|Marco|Mellum|Ornith|Qwen3\.6", path, re.I))}
        ggufs.append(item)
        inventory_lines.append(json.dumps(item, separators=(",", ":")))
    binaries: list[dict[str, object]] = []
    for path in sorted(bench_paths):
        size = parse_ls(shell(f"ls -ln '{path}'"), path)
        digest = sha_remote(path)
        binaries.append({"path": path, "bytes": size, "sha256": digest})
    impl_path = "/data/local/tmp/kalsa16/libllama-bench-impl.so"
    impl_size = parse_ls(shell(f"ls -ln '{impl_path}'"), impl_path)
    impl_sha = sha_remote(impl_path)
    (RAW / "inventory_ggufs.txt").write_text("\n".join(inventory_lines) + "\n", encoding="utf-8", newline="\n")
    (RAW / "inventory_binaries.txt").write_text(json.dumps({"binaries": binaries, "kalsa16_impl": {"path": impl_path, "bytes": impl_size, "sha256": impl_sha}}, indent=2) + "\n", encoding="utf-8", newline="\n")

    threshold_kb = mem_total * 1.2
    primary = [x for x in ggufs if x.get("is_moe_candidate") and isinstance(x.get("bytes"), int) and int(x["bytes"]) / 1024.0 >= threshold_kb]
    selected = next((x for x in ggufs if x["path"] == "/data/local/tmp/Marco-Mini-Instruct-KEXP-fromsrc-trunk-q8_0.gguf"), None)
    pc_candidates: list[dict[str, object]] = []
    for path in sorted((ROOT / "models").rglob("*.gguf")):
        size = path.stat().st_size
        if re.search(r"KEXP|OLMoE|Marco|Mellum|Ornith|Qwen3\.6", path.name, re.I):
            pc_candidates.append({"path": str(path), "bytes": size, "sha256": sha_local(path) if size <= 100 * 1024 * 1024 else None, "meets_primary_threshold": size / 1024.0 >= threshold_kb})
    report = {
        "completed_utc": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "device": identity,
        "serial": SERIAL,
        "mem_total_kb": mem_total,
        "mem_available_kb": mem_available,
        "primary_threshold": {"factor": 1.2, "kb": threshold_kb, "bytes_approx": threshold_kb * 1024},
        "storage": {"data_df": df_data, "tmp_df": df_tmp},
        "ggufs": ggufs,
        "llama_bench_binaries": binaries,
        "selected_binary": {"path": "/data/local/tmp/kalsa16/llama-bench", "sha256": next((x["sha256"] for x in binaries if x["path"] == "/data/local/tmp/kalsa16/llama-bench"), None), "impl_path": impl_path, "impl_bytes": impl_size, "impl_sha256": impl_sha},
        "pc_moe_candidates": pc_candidates,
        "primary_model_found_on_device": bool(primary),
        "primary_model_found_on_pc": any(bool(x["meets_primary_threshold"]) for x in pc_candidates),
        "selected_model": selected,
        "battery_raw": battery,
        "psi_io_raw": psi,
        "psi_io_readable": psi_readable,
    }
    (CELL / "inventory.json").write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps(report, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
