#!/system/bin/sh
cd /data/local/tmp/kalsa_q48 || exit 90
setsid nohup sh /data/local/tmp/kalsa_q48/phase2_driver.sh </dev/null >/data/local/tmp/kalsa_q48/driver.out 2>&1 &
echo $!
