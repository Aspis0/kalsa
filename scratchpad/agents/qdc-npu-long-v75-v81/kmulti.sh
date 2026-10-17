#!/usr/bin/env bash
# usage: BOARD=x kmulti.sh KEY=VALUE|KEY=--del ... — several AsyncStorage keys in ONE pull/push, app force-stopped, read-back verified.
set -u; . "$(dirname "$0")/env.sh"
pull() { local d=$1 f; rm -rf "$d"; mkdir -p "$d"; ADT=300 ad pull /data/data/$APP/databases/RKStorage "$d/RKStorage" >/dev/null 2>&1 || return 1
  for f in RKStorage-wal RKStorage-shm; do ad shell "test -f /data/data/$APP/databases/$f" >/dev/null 2>&1 && { ADT=120 ad pull /data/data/$APP/databases/$f "$d/$f" >/dev/null 2>&1 || return 1; }; done; return 0; }
ad shell am force-stop $APP >/dev/null; sleep 2
[ -z "$(ad shell pidof $APP | tr -d '\r')" ] || { echo "APP STILL RUNNING"; exit 1; }
D=$TMPD/dbm; pull $D || { echo "PULL FAILED"; exit 1; }
SQL=""
for kv in "$@"; do k=${kv%%=*}; v=${kv#*=}
  if [ "$v" = "--del" ]; then SQL="$SQL DELETE FROM catalystLocalStorage WHERE key='$k';"
  else SQL="$SQL INSERT OR REPLACE INTO catalystLocalStorage(key,value) VALUES('$k','${v//\'/\'\'}');"; fi; done
printf "%s\nPRAGMA wal_checkpoint(TRUNCATE);\n" "$SQL" | sqlite3 -bail "$D/RKStorage" >/dev/null || { echo "SQLITE FAIL"; exit 1; }
UID_=$(ad shell stat -c %u /data/data/$APP | tr -d '\r')
ADT=300 ad push "$D/RKStorage" /data/local/tmp/rkstorage.new >/dev/null 2>&1 || { echo PUSH FAIL; exit 1; }
ad shell "cp /data/local/tmp/rkstorage.new /data/data/$APP/databases/RKStorage && chown $UID_:$UID_ /data/data/$APP/databases/RKStorage && restorecon -RF /data/data/$APP/databases/RKStorage; rm -f /data/data/$APP/databases/RKStorage-wal /data/data/$APP/databases/RKStorage-shm /data/local/tmp/rkstorage.new" >/dev/null 2>&1
pull $TMPD/dbm2 || { echo "READBACK PULL FAILED"; exit 1; }
rc=0
for kv in "$@"; do k=${kv%%=*}; v=${kv#*=}; got=$(sqlite3 "$TMPD/dbm2/RKStorage" "SELECT value FROM catalystLocalStorage WHERE key='$k';")
  if [ "$v" = "--del" ]; then [ -z "$got" ] && echo "ABSENT $k" || { echo "VERIFY FAIL $k still '$got'"; rc=1; }
  else [ "$got" = "$v" ] && echo "SET $k=${v:0:60}" || { echo "VERIFY FAIL $k got '${got:0:60}'"; rc=1; }; fi; done
exit $rc
