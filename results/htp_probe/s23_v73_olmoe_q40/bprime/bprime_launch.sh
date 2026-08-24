#!/system/bin/sh
cd /data/local/tmp/kalsa_q48/bprime || mkdir -p /data/local/tmp/kalsa_q48/bprime
cd /data/local/tmp/kalsa_q48/bprime || exit 90
setsid nohup sh /data/local/tmp/kalsa_q48/bprime/bprime_driver.sh </dev/null >/data/local/tmp/kalsa_q48/bprime/driver.out 2>&1 &
echo $!
