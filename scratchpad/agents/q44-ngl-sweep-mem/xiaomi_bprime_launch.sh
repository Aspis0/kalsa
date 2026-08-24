#!/system/bin/sh
# Detach so adb hangup cannot SIGHUP llama-bench.
cd /data/local/tmp/kalsa_bprime_x || exit 90
setsid sh -c 'nohup sh /data/local/tmp/kalsa_bprime_x/driver.sh </dev/null >/data/local/tmp/kalsa_bprime_x/driver.out 2>&1 & echo $! > /data/local/tmp/kalsa_bprime_x/setsid.pid'
cat /data/local/tmp/kalsa_bprime_x/setsid.pid
