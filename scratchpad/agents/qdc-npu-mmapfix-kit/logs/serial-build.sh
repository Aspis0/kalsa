#!/bin/sh
# Serial HTP then host then install. One docker process. Records per-step exit codes.
set -u
LOG=/logs
run() {
    name=$1
    shift
    echo "=== START $name $(date -u +%Y-%m-%dT%H:%M:%SZ) ===" >> "$LOG/${name}.log"
    "$@" >> "$LOG/${name}.log" 2>&1
    ec=$?
    echo "$ec" > "$LOG/${name}.exit"
    echo "=== END $name exit=$ec $(date -u +%Y-%m-%dT%H:%M:%SZ) ===" >> "$LOG/${name}.log"
    if [ "$ec" != 0 ]; then
        echo "$ec" > "$LOG/ALL.exit"
        exit "$ec"
    fi
}

cd /workspace
# 02-htp-v73 already completed (exit 0) before the previous docker was SIGKILL'd.
run 03-htp-v75 cmake --build build-snapdragon --target htp-v75
run 04-htp-v79 cmake --build build-snapdragon --target htp-v79
run 05-htp-v81 cmake --build build-snapdragon --target htp-v81
run 06-host-build cmake --build build-snapdragon
run 07-install cmake --install build-snapdragon --prefix pkg-snapdragon/llama.cpp
echo 0 > "$LOG/ALL.exit"
exit 0
