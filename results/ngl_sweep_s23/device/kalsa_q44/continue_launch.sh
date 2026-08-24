#!/system/bin/sh
# Detach q44 driver so adb hangup cannot SIGHUP it.
cd /data/local/tmp/kalsa_q44 || exit 90
nohup sh /data/local/tmp/kalsa_q44/continue_driver.sh </dev/null >/data/local/tmp/kalsa_q44/continue.out 2>&1 &
echo $!
