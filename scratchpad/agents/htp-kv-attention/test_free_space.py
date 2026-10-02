"""The /data free-space gate must read the partition through MIUI's
/data/user/0 bind-mount name (Xiaomi 14) and still fail closed otherwise."""

import run_bench

STOCK = ("Filesystem     1K-blocks     Used Available Use% Mounted on\n"
         "/dev/block/dm-55 505068524 190445432 314492020  38% /data\n")
MIUI = ("Filesystem       1K-blocks      Used Available Use% Mounted on\n"
        "/dev/block/dm-55 505068524 190445432 314492020  38% /data/user/0\n")


def test_stock_mount_passes():
    assert run_bench.free_space_error(STOCK) is None


def test_miui_bind_mount_passes():
    assert run_bench.free_space_error(MIUI) is None


def test_miui_low_space_fails():
    low = MIUI.replace("314492020", "4000000")
    err = run_bench.free_space_error(low)
    assert err and "GB <" in err


def test_missing_row_still_fails():
    assert run_bench.free_space_error("no rows here") == \
        "no /data row in df output"


def test_other_mount_names_do_not_pass():
    assert run_bench.free_space_error(
        "/dev/block/dm-9 100 90 10 90% /mnt/media\n") == \
        "no /data row in df output"
