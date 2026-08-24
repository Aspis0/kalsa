#!/system/bin/sh
# Detach q44 driver so adb hangup cannot SIGHUP it.
cd /data/local/tmp/kalsa_q44 || exit 90
nohup sh /data/local/tmp/kalsa_q44/driver.sh </dev/null >/data/local/tmp/kalsa_q44/driver.out 2>&1 &
echo $!
