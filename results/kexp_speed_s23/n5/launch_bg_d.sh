#!/system/bin/sh
# Detach optional arm D. Never writes into s3oracle.
cd /data/local/tmp/s18stock || exit 90
nohup sh /data/local/tmp/s18stock/one_cell_d.sh "$@" </dev/null >/dev/null 2>&1 &
echo $!
