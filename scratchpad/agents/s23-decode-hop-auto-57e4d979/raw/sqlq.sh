#!/usr/bin/env bash
# usage: sqlq.sh "SQL" — read-only query on the app AsyncStorage DB (pulled copy)
set -u
. /tmp/s23-auto/env.sh
dir=$(mktemp -d /tmp/kalsa-db.XXXXXX)
files="RKStorage"
adb -s $S shell "run-as $APP test -f databases/RKStorage-wal" >/dev/null 2>&1 && files="$files RKStorage-wal"
adb -s $S shell "run-as $APP test -f databases/RKStorage-shm" >/dev/null 2>&1 && files="$files RKStorage-shm"
if ! adb -s $S exec-out run-as $APP tar cf - -C databases $files 2>/dev/null | tar xf - -C $dir 2>/dev/null; then
  rm -f $dir/RKStorage*
  adb -s $S exec-out run-as $APP cat databases/RKStorage > $dir/RKStorage 2>/dev/null
fi
[ -f $dir/RKStorage ] || { echo "PULL FAILED"; rm -rf $dir; exit 1; }
sqlite3 $dir/RKStorage "$1" | tr -d '\r'
rc=$?
rm -rf $dir
exit $rc
