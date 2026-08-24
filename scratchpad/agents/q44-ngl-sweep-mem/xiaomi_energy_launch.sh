#!/system/bin/sh
cd /data/local/tmp/kalsa_bprime_x || exit 90
setsid sh -c 'nohup sh /data/local/tmp/kalsa_bprime_x/energy_driver.sh </dev/null >/data/local/tmp/kalsa_bprime_x/energy/driver.out 2>&1 & echo $! > /data/local/tmp/kalsa_bprime_x/energy/setsid.pid'
cat /data/local/tmp/kalsa_bprime_x/energy/setsid.pid
