#!/system/bin/sh
cd /data/local/tmp/kalsa_q44/phase2 || exit 90
nohup sh /data/local/tmp/kalsa_q44/phase2/phase2_driver.sh </dev/null >/data/local/tmp/kalsa_q44/phase2/driver.out 2>&1 &
echo $!
