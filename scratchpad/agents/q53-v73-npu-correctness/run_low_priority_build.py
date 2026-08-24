from __future__ import annotations

import ctypes
import pathlib
import subprocess
import sys


ROOT = pathlib.Path(r"C:\Users\gualt\Desktop\Kalsa\moe-experiments")
BUILD = ROOT / "build-android-hexagon-q53"
NINJA = pathlib.Path(r"C:\Users\gualt\AppData\Local\Android\Sdk\cmake\3.22.1\bin\ninja.exe")
TARGET = sys.argv[1] if len(sys.argv) > 1 else "llama-perplexity"
ATTEMPT = sys.argv[2] if len(sys.argv) > 2 else ""
SUFFIX = f"_{ATTEMPT}" if ATTEMPT else ""
LOG = ROOT / "scratchpad" / "agents" / "q53-v73-npu-correctness" / f"build_{TARGET}{SUFFIX}.log"
RC = ROOT / "scratchpad" / "agents" / "q53-v73-npu-correctness" / f"build_{TARGET}{SUFFIX}.rc"

CREATE_NO_WINDOW = 0x08000000
PROCESS_SET_INFORMATION = 0x0200
BELOW_NORMAL_PRIORITY_CLASS = 0x4000


def set_below_normal(pid: int) -> None:
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.OpenProcess.argtypes = [ctypes.c_ulong, ctypes.c_int, ctypes.c_ulong]
    kernel32.OpenProcess.restype = ctypes.c_void_p
    kernel32.SetPriorityClass.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
    kernel32.SetPriorityClass.restype = ctypes.c_int
    kernel32.CloseHandle.argtypes = [ctypes.c_void_p]
    handle = kernel32.OpenProcess(PROCESS_SET_INFORMATION, False, pid)
    if not handle:
        raise OSError(ctypes.get_last_error(), "OpenProcess")
    try:
        if not kernel32.SetPriorityClass(handle, BELOW_NORMAL_PRIORITY_CLASS):
            raise OSError(ctypes.get_last_error(), "SetPriorityClass")
    finally:
        kernel32.CloseHandle(handle)


with LOG.open("w", encoding="utf-8") as log:
    log.write(f"BUILD_START target={TARGET} low_priority=BELOW_NORMAL jobs=4\n")
    log.flush()
    proc = subprocess.Popen(
        [str(NINJA), "-C", str(BUILD), "-j", "4", TARGET],
        cwd=str(ROOT),
        stdout=log,
        stderr=subprocess.STDOUT,
        creationflags=CREATE_NO_WINDOW,
    )
    set_below_normal(proc.pid)
    log.write(f"NINJA_PID={proc.pid} priority=BELOW_NORMAL\n")
    log.flush()
    rc = proc.wait()
    log.write(f"BUILD_END rc={rc}\n")
RC.write_text(str(rc) + "\n", encoding="ascii")
sys.exit(rc)
