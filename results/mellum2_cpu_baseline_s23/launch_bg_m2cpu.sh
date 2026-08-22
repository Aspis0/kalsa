#!/system/bin/sh
# Detach so a local adb/PowerShell teardown cannot SIGHUP llama-bench. NEVER SIGTERM.
cd /data/local/tmp/s3oracle || exit 90
nohup sh /data/local/tmp/s3oracle/one_cell_m2cpu.sh "$@" </dev/null >/dev/null 2>&1 &
echo $!
