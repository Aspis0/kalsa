#!/usr/bin/env bash
# usage: kset.sh KEY=VALUE|KEY=--del ... — several AsyncStorage keys in ONE pull/edit/push.
# The QDC cell used `adb root` + a raw /data/data pull; the S23 is not rooted and has no device
# sqlite3, so the DB is streamed out with exec-out run-as, edited on the Mac, and written back
# with push + `run-as cp`. Do not stream stdin into exec-out: adb never closes the pipe, `cat`
# blocks forever, and the target file is left truncated at 0 bytes.
set -u; . "$(dirname "$0")/env.sh"
DB=databases/RKStorage; TMPF=/data/local/tmp/rk.new
pull_db() { ad exec-out run-as $APP cat $DB 2>/dev/null > "$1" && [ -s "$1" ]; }
push_db() { ad push "$1" $TMPF >/dev/null 2>&1 && ad shell "chmod 644 $TMPF" >/dev/null 2>&1 \
  && ad shell "run-as $APP cp $TMPF $DB" >/dev/null 2>&1; ad shell "rm -f $TMPF" >/dev/null 2>&1; }
ad shell am force-stop $APP >/dev/null 2>&1; sleep 2
[ -z "$(ad shell pidof $APP | tr -d '\r')" ] || { echo "APP STILL RUNNING"; exit 1; }
D=$TMPD/kdb; rm -rf "$D"; mkdir -p "$D"
pull_db $D/RKStorage || { echo "PULL FAILED"; exit 1; }
cp $D/RKStorage $D/backup          # the AsyncStorage DB holds the owner's chats; never write without a copy
# Keep any sidecar out of the way: the app must re-create its own after the swap.
ad shell "rm -f $DB-journal $DB-wal $DB-shm" >/dev/null 2>&1
SQL=""
for kv in "$@"; do k=${kv%%=*}; v=${kv#*=}
  case $v in --del) SQL="$SQL DELETE FROM catalystLocalStorage WHERE key='$k';" ;;
    *) SQL="$SQL INSERT OR REPLACE INTO catalystLocalStorage(key,value) VALUES('$k','${v//\'/\'\'}');" ;; esac
done
printf "%s\n" "$SQL" | sqlite3 -bail "$D/RKStorage" >/dev/null || { echo "SQLITE FAIL"; exit 1; }
sqlite3 $D/RKStorage "PRAGMA integrity_check;" | grep -qx ok || { echo "LOCAL INTEGRITY FAIL"; exit 1; }
want=$(wc -c < $D/RKStorage | tr -d ' ')   # size of the EDITED db; the edit itself changes it
push_db $D/RKStorage || { echo "PUSH FAILED"; exit 1; }
pull_db $D/readback || { cp $D/backup $D/readback; echo "READBACK PULL EMPTY — restored from backup"; exit 1; }
got=$(wc -c < $D/readback | tr -d ' ')
[ "$got" = "$want" ] || { echo "SIZE CHANGED $want -> $got; restoring backup"; cp $D/backup $D/readback; push_db $D/backup; exit 1; }
rc=0
for kv in "$@"; do k=${kv%%=*}; v=${kv#*=}; g=$(sqlite3 "$D/readback" "SELECT value FROM catalystLocalStorage WHERE key='$k';")
  if [ "$v" = "--del" ]; then [ -z "$g" ] && echo "ABSENT $k" || { echo "VERIFY FAIL $k still '${g:0:60}'"; rc=1; }
  else [ "$g" = "$v" ] && echo "SET $k=${v:0:70}" || { echo "VERIFY FAIL $k got '${g:0:70}'"; rc=1; }; fi
done
exit $rc