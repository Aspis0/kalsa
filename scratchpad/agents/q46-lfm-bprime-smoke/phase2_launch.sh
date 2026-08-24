#!/system/bin/sh
cd /data/local/tmp/kalsa_q46 || exit 90
setsid nohup sh /data/local/tmp/kalsa_q46/phase2_driver.sh </dev/null >/data/local/tmp/kalsa_q46/driver.out 2>&1 &
echo $!
