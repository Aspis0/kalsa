#!/usr/bin/env bash
# usage: BOARD=x kset.sh KEY VALUE|--del|--get  — AsyncStorage key edit, app force-stopped, root path, read-back verified.
set -u; . "$(dirname "$0")/env.sh"
KEY=$1; VAL=${2:---get}
pull() { local d=$1 f; rm -rf "$d"; mkdir -p "$d"; ADT=300 ad pull /data/data/$APP/databases/RKStorage "$d/RKStorage" >/dev/null 2>&1 || return 1
  for f in RKStorage-wal RKStorage-shm; do ad shell "test -f /data/data/$APP/databases/$f" >/dev/null 2>&1 && { ADT=120 ad pull /data/data/$APP/databases/$f "$d/$f" >/dev/null 2>&1 || return 1; }; done; return 0; }
ad shell am force-stop $APP >/dev/null; sleep 2
[ -z "$(ad shell pidof $APP | tr -d '\r')" ] || { echo "APP STILL RUNNING"; exit 1; }
D=$TMPD/db; pull $D || { echo "PULL FAILED"; exit 1; }
if [ "$VAL" = "--get" ]; then sqlite3 "$D/RKStorage" "SELECT value FROM catalystLocalStorage WHERE key='$KEY';"; exit 0; fi
if [ "$VAL" = "--del" ]; then SQL="DELETE FROM catalystLocalStorage WHERE key='$KEY';"
else SQL="INSERT OR REPLACE INTO catalystLocalStorage(key,value) VALUES('$KEY','$VAL');"; fi
printf "%s\nPRAGMA wal_checkpoint(TRUNCATE);\n" "$SQL" | sqlite3 -bail "$D/RKStorage" >/dev/null || { echo "SQLITE FAIL"; exit 1; }
UID_=$(ad shell stat -c %u /data/data/$APP | tr -d '\r')
ADT=300 ad push "$D/RKStorage" /data/local/tmp/rkstorage.new >/dev/null 2>&1 || { echo PUSH FAIL; exit 1; }
ad shell "cp /data/local/tmp/rkstorage.new /data/data/$APP/databases/RKStorage && chown $UID_:$UID_ /data/data/$APP/databases/RKStorage && restorecon -RF /data/data/$APP/databases/RKStorage; rm -f /data/data/$APP/databases/RKStorage-wal /data/data/$APP/databases/RKStorage-shm /data/local/tmp/rkstorage.new" >/dev/null 2>&1
pull $TMPD/db2 || { echo "READBACK PULL FAILED"; exit 1; }
got=$(sqlite3 "$TMPD/db2/RKStorage" "SELECT value FROM catalystLocalStorage WHERE key='$KEY';")
if [ "$VAL" = "--del" ]; then [ -z "$got" ] && echo "DELETED $KEY (absent)" || { echo "VERIFY FAIL still '$got'"; exit 1; }
else [ "$got" = "$VAL" ] && echo "WROTE $KEY=$VAL" || { echo "VERIFY FAIL got '$got' want '$VAL'"; exit 1; }; fi
