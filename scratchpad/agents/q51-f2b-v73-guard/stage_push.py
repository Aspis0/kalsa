#!/usr/bin/env python3
"""Stage kalsahtp_f2b payload and record PC shas."""
from __future__ import annotations

import hashlib
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
STAGE = HERE / "stage_kalsahtp_f2b"
BIN = ROOT / "build-android-f2b" / "bin"
SKEL = ROOT / "build-android-hexagon" / "ggml" / "src" / "ggml-hexagon" / "libggml-htp-v73.so"
OMP = Path(r"C:\Users\gualt\AppData\Local\Android\Sdk\ndk\27.1.12297006\toolchains\llvm\prebuilt\windows-x86_64\lib\clang\18\lib\linux\aarch64\libomp.so")
LIBCXX = Path(r"C:\Users\gualt\AppData\Local\Android\Sdk\ndk\27.1.12297006\toolchains\llvm\prebuilt\windows-x86_64\sysroot\usr\lib\aarch64-linux-android\libc++_shared.so")
PIN_HTP = "c8f9d14a388455ec364e99d4f63dbee773a4bad6de204b61496fe128f125edd5"


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        while True:
            b = f.read(1 << 20)
            if not b:
                break
            h.update(b)
    return h.hexdigest()


def main() -> None:
    if STAGE.exists():
        shutil.rmtree(STAGE)
    STAGE.mkdir(parents=True)
    names = [
        "llama-bench",
        "libllama-bench-impl.so",
        "libllama.so",
        "libllama-common.so",
        "libggml.so",
        "libggml-base.so",
        "libggml-cpu.so",
        "libggml-hexagon.so",
    ]
    lines = ["# F2b PC-side shas (Python hashlib)", ""]
    for n in names:
        src = BIN / n
        dst = STAGE / n
        shutil.copy2(src, dst)
        d = sha256(dst)
        lines.append(f"{d}  {n}  {src.stat().st_size}")
        print(n, d)
    skel_d = sha256(SKEL)
    if skel_d != PIN_HTP:
        raise SystemExit(f"skel sha mismatch {skel_d}")
    shutil.copy2(SKEL, STAGE / "libggml-htp-v73.so")
    lines.append(f"{skel_d}  libggml-htp-v73.so  {SKEL.stat().st_size}  PINNED")
    shutil.copy2(OMP, STAGE / "libomp.so")
    shutil.copy2(LIBCXX, STAGE / "libc++_shared.so")
    lines.append(f"{sha256(STAGE / 'libomp.so')}  libomp.so")
    lines.append(f"{sha256(STAGE / 'libc++_shared.so')}  libc++_shared.so")
    (HERE / "pc_shas.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("staged", STAGE, "n", len(list(STAGE.iterdir())))


if __name__ == "__main__":
    main()
