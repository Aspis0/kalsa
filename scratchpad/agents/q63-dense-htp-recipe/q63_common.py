from __future__ import annotations

import hashlib
import json
import os
import re
import signal
import subprocess
import time
from pathlib import Path

ROOT = Path(r"C:\Users\gualt\Desktop\Kalsa\moe-experiments")
HERE = ROOT / "scratchpad" / "agents" / "q63-dense-htp-recipe"
PPL_DIR = HERE / "ppl"
CELL_DIR = HERE / "cells"
ACTIVE = HERE / "ACTIVE_CHILD.json"
PPLBIN = ROOT / "build-llama-pc" / "bin" / "llama-perplexity.exe"
QUANTBIN = ROOT / "build-pc-quantize" / "bin" / "llama-quantize.exe"
BF16 = ROOT / "scratchpad" / "agents" / "q59-dense-quant-gate" / "gguf" / "Qwen3.5-4B-fromsrc-BF16.gguf"
CONTROL = ROOT / "scratchpad" / "agents" / "q59-dense-quant-gate" / "gguf" / "Qwen3.5-4B-fromsrc-Q4_K_M.gguf"
CORPORA = {
    "wiki": ROOT / "scratchpad" / "agents" / "q41-ppl-gate" / "corpus" / "wikitext-2-raw" / "wiki.test.raw",
    "it": ROOT / "scratchpad" / "agents" / "q43-q8trunk-ppl-gate" / "corpus" / "it.txt",
    "es": ROOT / "scratchpad" / "agents" / "q43-q8trunk-ppl-gate" / "corpus" / "es.txt",
    "fr": ROOT / "scratchpad" / "agents" / "q43-q8trunk-ppl-gate" / "corpus" / "fr.txt",
    "zh": ROOT / "scratchpad" / "agents" / "q43-q8trunk-ppl-gate" / "corpus" / "zh.txt",
}
EXPECTED_CHUNKS = {"wiki": 64, "it": 60, "es": 59, "fr": 59, "zh": 61}
CORPUS_SHA = {
    "wiki": "173c87a53759e0201f33e0ccf978e510c2042d7f2cb78229d9a50d79b9e7dd08",
    "it": "fddf963377e1a90cd02dde9baf1fbe95a003e86f9ec0eebfda6e9b3652027aac",
    "es": "45b4bdbf62de82f8640d259368572553b07240dae7f42eb8c0bdfaa762146915",
    "fr": "c477f06d166a387f937784742eb4ac04ac9b4f268f663618f8e28fee8a924f0e",
    "zh": "234fe0fdfa8785838f995a9681ea3e1871bcb7c8ca74bf2180e4c90310a5c606",
}
CONTROL_SHA = "a7d67feff949041d766c910f2faa641016a5dad6d8c5f7fada05d61b84eb1887"
BF16_SHA = "9ba85223a9db256879b525d747090407a4b9aad3d920e4098519a401bba0149b"
HTP_TYPES = {"Q4_0", "Q4_1", "Q8_0", "IQ4_NL", "MXFP4", "F16", "F32"}
CREATE_NEW_PROCESS_GROUP = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0x00000200)
CREATE_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000)
DETACHED_PROCESS = getattr(subprocess, "DETACHED_PROCESS", 0x00000008)
IDLE_PRIORITY_CLASS = getattr(subprocess, "IDLE_PRIORITY_CLASS", 0x00000040)
CHILD_FLAGS = CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW


def now_utc() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def ignore_console_signals() -> None:
    signal.signal(signal.SIGINT, signal.SIG_IGN)
    sigbreak = getattr(signal, "SIGBREAK", None)
    if sigbreak is not None:
        signal.signal(sigbreak, signal.SIG_IGN)
    if os.name == "nt":
        try:
            import ctypes
            ctypes.windll.kernel32.SetConsoleCtrlHandler(None, True)
        except Exception:
            pass


def set_idle(process: subprocess.Popen) -> None:
    if os.name == "nt":
        import ctypes
        if not ctypes.windll.kernel32.SetPriorityClass(int(process._handle), IDLE_PRIORITY_CLASS):
            raise RuntimeError("SetPriorityClass(IDLE) failed")


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(8 * 1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def windows_arg(value: str) -> str:
    if value and not any(char in value for char in ' \t"^$+?*|()[]{}'):
        return value
    return '"' + value.replace('"', '\\"') + '"'


def cmd_text(command: list[str]) -> str:
    return " ".join(windows_arg(str(item)) for item in command)


def parse_ppl(text: str) -> dict:
    out: dict = {}
    match = re.search(r"Final estimate:\s*PPL\s*=\s*([0-9.]+)\s*\+/-\s*([0-9.]+)", text, re.I)
    if match:
        out["ppl"], out["ppl_err"] = float(match.group(1)), float(match.group(2))
    chunks = re.search(r"over\s+(\d+)\s+chunks", text, re.I)
    if chunks:
        out["n_chunks"] = int(chunks.group(1))
    return out


def read_json(path: Path) -> dict | None:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else None
    except (OSError, UnicodeError, json.JSONDecodeError):
        return None


def write_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def complete_ppl(path: Path, expected_chunks: int) -> dict | None:
    rec = read_json(path)
    if not rec or rec.get("status", "").startswith("SKIPPED"):
        return rec if rec and rec.get("status", "").startswith("SKIPPED") else None
    if rec.get("rc") != 0 or not isinstance(rec.get("ppl"), (int, float)):
        return None
    if not isinstance(rec.get("ppl_err"), (int, float)) or rec.get("n_chunks") != expected_chunks:
        return None
    return rec


def python_exe() -> str:
    current = Path(os.sys.executable)
    if current.name.lower() == "pythonw.exe":
        sibling = current.with_name("python.exe")
        if sibling.exists():
            return str(sibling)
    return str(current)
