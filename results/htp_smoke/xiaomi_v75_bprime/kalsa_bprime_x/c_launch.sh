#!/system/bin/sh
cd /data/local/tmp/kalsa_bprime_x || exit 90
setsid sh -c 'nohup sh /data/local/tmp/kalsa_bprime_x/c_driver.sh </dev/null >/data/local/tmp/kalsa_bprime_x/c_driver.out 2>&1 & echo $! > /data/local/tmp/kalsa_bprime_x/c_setsid.pid'
cat /data/local/tmp/kalsa_bprime_x/c_setsid.pid
