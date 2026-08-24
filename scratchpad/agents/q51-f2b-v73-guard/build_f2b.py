#!/usr/bin/env python3
"""LOW-priority cmake + ninja -j4 for F2b host lib only."""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SRC = Path(__file__).resolve().parent / "llama.cpp"
BDIR = ROOT / "build-android-f2b"
CMAKE = ROOT / "deps/cmake/cmake-3.31.7-windows-x86_64/bin/cmake.exe"
NINJA = Path(r"C:\Users\gualt\AppData\Local\Android\Sdk\cmake\3.22.1\bin\ninja.exe")
NDK_TC = Path(r"C:\Users\gualt\AppData\Local\Android\Sdk\ndk\27.1.12297006\build\cmake\android.toolchain.cmake")
HEX = Path(r"C:\Qualcomm\Hexagon_SDK\6.6.0.0")
IDLE = 0x00000040
HERE = Path(__file__).resolve().parent


def run(cmd: list[str], log_name: str, timeout: int) -> int:
    print("CMD", " ".join(str(c) for c in cmd), flush=True)
    r = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        creationflags=IDLE,
        timeout=timeout,
    )
    (HERE / log_name).write_text(
        r.stdout + "\n---STDERR---\n" + (r.stderr or ""),
        encoding="utf-8",
        errors="replace",
    )
    print("rc", r.returncode, "log", log_name, flush=True)
    if r.returncode != 0:
        print((r.stderr or r.stdout or "")[-2000:], flush=True)
    return r.returncode


def main() -> int:
    action = sys.argv[1] if len(sys.argv) > 1 else "cmake"
    BDIR.mkdir(parents=True, exist_ok=True)
    if action == "cmake":
        cmd = [
            str(CMAKE),
            "-S", str(SRC),
            "-B", str(BDIR),
            "-G", "Ninja",
            f"-DCMAKE_MAKE_PROGRAM={NINJA}",
            f"-DCMAKE_TOOLCHAIN_FILE={NDK_TC}",
            "-DANDROID_ABI=arm64-v8a",
            "-DANDROID_PLATFORM=android-31",
            "-DCMAKE_BUILD_TYPE=Release",
            "-DGGML_HEXAGON=ON",
            f"-DHEXAGON_SDK_ROOT={HEX}",
            f"-DHEXAGON_TOOLS_ROOT={HEX / 'tools' / 'HEXAGON_Tools' / '19.0.07'}",
            "-DGGML_CCACHE=OFF",
            "-DPREBUILT_LIB_DIR=host_unused",
            "-DBUILD_SHARED_LIBS=ON",
            "-DGGML_NATIVE=OFF",
            "-DLLAMA_BUILD_TOOLS=ON",
            "-DLLAMA_BUILD_TESTS=OFF",
            "-DLLAMA_BUILD_EXAMPLES=OFF",
            "-DLLAMA_BUILD_SERVER=OFF",
            "-DLLAMA_BUILD_COMMON=ON",
        ]
        return run(cmd, "cmake.log", 300)
    if action == "ninja":
        cmd = [
            str(NINJA),
            "-C", str(BDIR),
            "-j", "4",
            "ggml-hexagon",
            "llama-bench",
        ]
        return run(cmd, "ninja.log", 1800)
    print("unknown", action)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
