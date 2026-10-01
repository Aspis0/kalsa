#!/usr/bin/env bash
# usage: sqlw.sh KEY VALUE — write one AsyncStorage key with the app force-stopped; verify.
set -u
. /tmp/s23-gov/env.sh
KEY=$1; VALUE=$2
adb -s $S shell am force-stop $APP >/dev/null; sleep 2
pid=$(adb -s $S shell pidof $APP | tr -d '\r')
[ -z "$pid" ] || { echo "APP STILL RUNNING pid=$pid"; exit 1; }
dir=$(mktemp -d /tmp/kalsa-db.XXXXXX)
if ! adb -s $S exec-out run-as $APP tar cf - -C databases RKStorage RKStorage-wal RKStorage-shm 2>/dev/null | tar xf - -C $dir 2>/dev/null; then
  rm -f $dir/RKStorage*
  adb -s $S exec-out run-as $APP cat databases/RKStorage > $dir/RKStorage 2>/dev/null
fi
[ -f $dir/RKStorage ] || { echo "PULL FAILED"; rm -rf $dir; exit 1; }
printf "INSERT OR REPLACE INTO catalystLocalStorage(key,value) VALUES('%s','%s');\nPRAGMA wal_checkpoint(TRUNCATE);\n" "$KEY" "$VALUE" \
  | sqlite3 -bail $dir/RKStorage >/dev/null || { echo "SQLITE FAIL"; rm -rf $dir; exit 1; }
adb -s $S push $dir/RKStorage /data/local/tmp/kalsa-rkstorage-sqlw >/dev/null \
  && adb -s $S shell run-as $APP cp /data/local/tmp/kalsa-rkstorage-sqlw databases/RKStorage >/dev/null \
  && adb -s $S shell run-as $APP rm -f databases/RKStorage-wal databases/RKStorage-shm >/dev/null
adb -s $S shell rm -f /data/local/tmp/kalsa-rkstorage-sqlw >/dev/null
rm -rf $dir
actual=$(bash /tmp/s23-gov/sqlq.sh "SELECT value FROM catalystLocalStorage WHERE key='$KEY';")
[ "$actual" = "$VALUE" ] || { echo "VERIFY FAIL got '$actual' want '$VALUE'"; exit 1; }
echo "WROTE $KEY=$VALUE"
