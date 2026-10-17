#!/usr/bin/env bash
# usage: BOARD=x wipe-chats.sh — delete every saved conversation (index + messages), app force-stopped, read back 0 rows.
# Why: on 10-03 text_tokens grew between turns (3285 -> 3363 -> 3472 -> 3581) and the "New chat" tap was never verified.
# A pair is comparable only if both arms see the same prompt, so every turn starts from an empty conversation store.
set -u; . "$(dirname "$0")/env.sh"
CHAT_Q="SELECT count(*) FROM catalystLocalStorage WHERE key LIKE 'kalsa.messages.%' OR key='kalsa.conversations.v1';"
MEM_Q="SELECT count(*) FROM catalystLocalStorage WHERE key LIKE 'kalsa.memory.%' OR key LIKE 'kalsa.personas.%';"
pull() { local d=$1 f; rm -rf "$d"; mkdir -p "$d"; ADT=300 ad pull /data/data/$APP/databases/RKStorage "$d/RKStorage" >/dev/null 2>&1 || return 1
  for f in RKStorage-wal RKStorage-shm; do ad shell "test -f /data/data/$APP/databases/$f" >/dev/null 2>&1 && { ADT=120 ad pull /data/data/$APP/databases/$f "$d/$f" >/dev/null 2>&1 || return 1; }; done; return 0; }
ad shell am force-stop $APP >/dev/null; sleep 2
[ -z "$(ad shell pidof $APP | tr -d '\r')" ] || { echo "APP STILL RUNNING"; exit 1; }
D=$TMPD/chatdb; pull $D || { echo "PULL FAILED"; exit 1; }
before=$(sqlite3 "$D/RKStorage" "$CHAT_Q") || { echo "COUNT FAIL"; exit 1; }
mem=$(sqlite3 "$D/RKStorage" "$MEM_Q")
printf "DELETE FROM catalystLocalStorage WHERE key LIKE 'kalsa.messages.%%' OR key='kalsa.conversations.v1';\nPRAGMA wal_checkpoint(TRUNCATE);\n" | sqlite3 -bail "$D/RKStorage" >/dev/null || { echo "SQLITE FAIL"; exit 1; }
UID_=$(ad shell stat -c %u /data/data/$APP | tr -d '\r')
ADT=300 ad push "$D/RKStorage" /data/local/tmp/rkstorage.new >/dev/null 2>&1 || { echo PUSH FAIL; exit 1; }
ad shell "cp /data/local/tmp/rkstorage.new /data/data/$APP/databases/RKStorage && chown $UID_:$UID_ /data/data/$APP/databases/RKStorage && restorecon -RF /data/data/$APP/databases/RKStorage; rm -f /data/data/$APP/databases/RKStorage-wal /data/data/$APP/databases/RKStorage-shm /data/local/tmp/rkstorage.new" >/dev/null 2>&1
pull $TMPD/chatdb2 || { echo "READBACK PULL FAILED"; exit 1; }
after=$(sqlite3 "$TMPD/chatdb2/RKStorage" "$CHAT_Q")
echo "chat_rows before=$before after=$after memory_persona_rows=$mem"
[ "$after" = 0 ]