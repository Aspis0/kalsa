#!/system/bin/sh
# Detach an arm-C cell so a local adb/PowerShell teardown cannot SIGHUP llama-bench.
# Usage: launch_bg_armc.sh TAG [arm flags...]
# Prints wrapper PID then exits; one_cell_armc.sh writes logs/TAG.{out,err,rc}.
cd /data/local/tmp/s3oracle || exit 90
nohup sh /data/local/tmp/s3oracle/one_cell_armc.sh "$@" </dev/null >/dev/null 2>&1 &
echo $!
