"""The personal-device command guard (Xiaomi daily-driver rules, item 4a)
and the /data free-space gate before staging (4b)."""

from pathlib import Path

import pytest

import device
import gates
import run_bench
from device import guard_violation

DIR = "/data/local/tmp/htp-kv-attention"


def test_read_only_probes_pass():
    assert guard_violation("dumpsys battery", DIR) is None
    assert guard_violation("getprop persist.traced.enable", DIR) is None
    assert guard_violation("settings get global stay_on", DIR) is None
    assert guard_violation("df -k /data", DIR) is None
    assert guard_violation("nproc", DIR) is None
    # the full multi-section probe must pass as one command
    assert guard_violation(gates.PROBE, DIR) is None


def test_bench_dir_operations_pass():
    assert guard_violation(f"mkdir -p {DIR}/bin {DIR}/lib", DIR) is None
    assert guard_violation(
        f"chmod 755 {DIR}/bin/*; cd {DIR} && sha256sum bin/* lib/* ship.gguf",
        DIR) is None
    assert guard_violation(
        f"cd '{DIR}' && export LD_LIBRARY_PATH='{DIR}/lib' "
        "GGML_HEXAGON_NDEV=1 GGML_HEXAGON_VERBOSE=1; "
        "./bin/llama-bench -m ship.gguf -d 0,512 -r 3 -ctk q8_0 -nkvo 1",
        DIR) is None
    assert guard_violation(f"rm -rf {DIR}; ls -d {DIR}", DIR) is None
    assert guard_violation(device.KILL_BENCH, DIR) is None
    assert guard_violation("input keyevent 224", DIR) is None
    assert guard_violation("rc=$?; echo EXIT=$rc; exit $rc", DIR) is None


def test_owner_hazards_are_refused():
    assert guard_violation("settings put global stay_on true", DIR)
    assert guard_violation("input keyevent 26", DIR)
    assert guard_violation("input keyevent KEYCODE_SLEEP", DIR)
    assert guard_violation("am start -n com.instagram.android/.Main", DIR)
    assert guard_violation("pm uninstall com.whatsapp", DIR)
    assert guard_violation("content insert --uri content://x", DIR)
    assert guard_violation("svc power stayon true", DIR)
    assert guard_violation("reboot", DIR)
    assert guard_violation("cat /data/data/com.other/databases/x", DIR)


def test_paths_must_stay_in_the_bench_dir():
    assert guard_violation("rm -rf /sdcard/Download", DIR)
    assert guard_violation(f"ls /data/local/tmp/other-kit", DIR)
    # a sibling directory sharing the prefix is still outside
    assert guard_violation(f"rm -rf {DIR}-old", DIR)
    assert guard_violation("cd / && ls", DIR)
    # and no redirection can smuggle writes out
    assert guard_violation(f"echo hi > /sdcard/x", DIR)


def test_free_space_gate():
    ok = ("Filesystem      1K-blocks     Used Available Use% Mounted on\n"
          "/dev/block/dm-45 118004524 98123232 19870124   17% /data\n")
    assert run_bench.free_space_error(ok) is None
    low = ("Filesystem 1K-blocks Used Available Use% Mounted on\n"
           "/dev/block/dm-45 118004524 116000000 2004524   98% /data\n")
    assert "free 2.1 GB < 5 GB" in run_bench.free_space_error(low)
    assert run_bench.free_space_error("no /data here")
    assert run_bench.free_space_error(
        "/dev/dm-45 118004524 98123232 not-a-number 17% /data\n")


def test_guard_is_enforced_on_the_transport():
    adb = device.Adb(serial="X", personal=True, device_dir=DIR)
    with pytest.raises(device.PersonalRefused):
        adb.shell("settings put global stay_on true")
    with pytest.raises(device.PersonalRefused):
        adb.push(Path("/tmp/x.gguf"), "/sdcard/x.gguf")
    with pytest.raises(device.PersonalRefused):
        adb.shell_stream("reboot", None)
    # and the same commands print instead of running on a dry-run target
    plain = device.Adb(serial="X", dry_run=True)
    assert plain.shell("settings put global stay_on true") == (0, "[dry-run]")
