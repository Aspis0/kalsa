#!/system/bin/sh
mkdir -p /data/local/tmp/kalsa_q51_f2b
cd /data/local/tmp/kalsa_q51_f2b || exit 90
setsid nohup sh /data/local/tmp/kalsa_q51_f2b/f2b_driver.sh </dev/null >/data/local/tmp/kalsa_q51_f2b/driver.out 2>&1 &
echo $!
