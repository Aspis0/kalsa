#!/system/bin/sh
mkdir -p /data/local/tmp/kalsa_q48/hostbuf1
cd /data/local/tmp/kalsa_q48/hostbuf1 || exit 90
setsid nohup sh /data/local/tmp/kalsa_q48/hostbuf1/hostbuf1_driver.sh </dev/null >/data/local/tmp/kalsa_q48/hostbuf1/driver.out 2>&1 &
echo $!
