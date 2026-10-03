#!/usr/bin/env bash
# usage: sqld.sh KEY — delete one AsyncStorage key with the app force-stopped; verify.
# Same as the baseline copy except the verify step calls THIS lab's sqlq.sh
# (the baseline pointed at the older /tmp/s23-gov copy) and sources this lab's env.
set -u
. /tmp/s23-esd/env.sh
KEY=$1
adb -s $S shell am force-stop $APP >/dev/null; sleep 2
pid=$(adb -s $S shell pidof $APP | tr -d '\r')
[ -z "$pid" ] || { echo "APP STILL RUNNING pid=$pid"; exit 1; }
dir=$(mktemp -d /tmp/kalsa-db.XXXXXX)
if ! adb -s $S exec-out run-as $APP tar cf - -C databases RKStorage RKStorage-wal RKStorage-shm 2>/dev/null | tar xf - -C $dir 2>/dev/null; then
  rm -f $dir/RKStorage*
  adb -s $S exec-out run-as $APP cat databases/RKStorage > $dir/RKStorage 2>/dev/null
fi
[ -f $dir/RKStorage ] || { echo "PULL FAILED"; rm -rf $dir; exit 1; }
printf "DELETE FROM catalystLocalStorage WHERE key='%s';\nPRAGMA wal_checkpoint(TRUNCATE);\n" "$KEY" \
  | sqlite3 -bail $dir/RKStorage >/dev/null || { echo "SQLITE FAIL"; rm -rf $dir; exit 1; }
adb -s $S push $dir/RKStorage /data/local/tmp/kalsa-rkstorage-sqlw >/dev/null \
  && adb -s $S shell run-as $APP cp /data/local/tmp/kalsa-rkstorage-sqlw databases/RKStorage >/dev/null \
  && adb -s $S shell run-as $APP rm -f databases/RKStorage-wal databases/RKStorage-shm >/dev/null
adb -s $S shell rm -f /data/local/tmp/kalsa-rkstorage-sqlw >/dev/null
rm -rf $dir
actual=$(bash $LAB/raw/sqlq.sh "SELECT count(*) FROM catalystLocalStorage WHERE key='$KEY';")
[ "$actual" = "0" ] || { echo "VERIFY FAIL count $actual"; exit 1; }
echo "DELETED $KEY"
