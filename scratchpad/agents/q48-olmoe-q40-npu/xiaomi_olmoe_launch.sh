#!/system/bin/sh
cd /data/local/tmp/kalsa_q48_x || exit 90
setsid sh -c 'nohup sh /data/local/tmp/kalsa_q48_x/driver.sh </dev/null >/data/local/tmp/kalsa_q48_x/driver.out 2>&1 & echo $! > /data/local/tmp/kalsa_q48_x/setsid.pid'
cat /data/local/tmp/kalsa_q48_x/setsid.pid
