#!/usr/bin/env bash
set -u
export LC_ALL=C
# About 3,500 tokens keeps KLD statistically useful while keeping both arms
# within a practical QRD device runtime; this is a measurement cell, not a corpus benchmark.
readonly CELL_DIR="/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/adreno-precision-bisect"
readonly CORPUS_TOKEN_TARGET=3500
readonly KIT_TGZ="$HOME/kalsa-qdc/adreno-precision-bisect/kit-2f3b24dee.tgz"
readonly MODEL="$HOME/kalsa-qdc/models/LFM2.5-2.6B-QAD-Q4_0.gguf"
readonly EXPECTED_MODEL_SHA="a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03"
readonly MODEL_FILE="LFM2.5-2.6B-QAD-Q4_0.gguf"
readonly CORPUS="$CELL_DIR/corpus.txt"
readonly CONTEXT_SIZE=256
readonly BATCH_SIZE=256
readonly DEVICE_ROOT=/data/local/tmp/kalsa-bisect
readonly DEVICE_KIT_TGZ="$DEVICE_ROOT/kit-2f3b24dee.tgz"
readonly DEVICE_KIT_DIR="$DEVICE_ROOT/kit-2f3b24dee"
readonly DEVICE_MODEL="$DEVICE_ROOT/$MODEL_FILE"
readonly DEVICE_CORPUS="$DEVICE_ROOT/corpus.txt"
# PROMPT is exactly 32 words; it is not a 32-token claim.
readonly PROMPT="The careful engineer measured the model answer twice, compared every layer, and wrote a clear note about numerical precision before changing any kernel code on the device during a quiet afternoon session."
usage() { echo "usage: $0 <job_id> <kld|dump> [deadline_minutes] [expected_board]" >&2; }
die() { echo "d_run.sh: $*" >&2; exit 1; }

[ "$#" -ge 2 ] && [ "$#" -le 4 ] || { usage; exit 2; }
JOB="$1"
MODE="$2"
DEADLINE_MINUTES=40
[ "$#" -ge 3 ] && DEADLINE_MINUTES="$3"
EXPECTED_BOARD=pineapple
[ "$#" -eq 4 ] && EXPECTED_BOARD="$4"
case "$JOB" in ''|*[!A-Za-z0-9._-]*) echo "invalid job_id" >&2; exit 2;; esac
case "$MODE" in kld|dump) ;; *) echo "mode must be kld or dump" >&2; usage; exit 2;; esac
case "$DEADLINE_MINUTES" in ''|*[!0-9]*) echo "deadline_minutes must be an integer from 20 to 110" >&2; exit 2;; esac
[ "$DEADLINE_MINUTES" -ge 20 ] && [ "$DEADLINE_MINUTES" -le 110 ] || { echo "deadline_minutes must be an integer from 20 to 110" >&2; exit 2; }
case "$EXPECTED_BOARD" in ''|*[!A-Za-z0-9._-]*) echo "invalid expected_board" >&2; exit 2;; esac
[ -n "${ANDROID_ADB_SERVER_PORT:-}" ] || die "ANDROID_ADB_SERVER_PORT must be exported"
RAW="$CELL_DIR/raw/$JOB"
mkdir -p "$RAW" || die "could not create raw output directory: $RAW"
ADB_LOG="$RAW/adb-exit.log"
STATUS_LOG="$RAW/status.log"
END_FILE="$RAW/END.txt"
: > "$ADB_LOG"
: > "$STATUS_LOG"
END_WRITTEN=0
START_EPOCH=$(date +%s)
DEADLINE_EPOCH=$((START_EPOCH + DEADLINE_MINUTES * 60))
SERIAL=""
REMOTE_SHA=""
ADB_BIN="$(command -v adb 2>/dev/null || true)"
write_end() {
    [ "$END_WRITTEN" -eq 1 ] || { printf 'END reason=%s\n' "$1" > "$END_FILE"; END_WRITTEN=1; }
}
on_exit() { local rc=$?; write_end "exit_$rc"; exit "$rc"; }
trap on_exit EXIT
deadline_check() {
    [ "$(date +%s)" -lt "$DEADLINE_EPOCH" ] || { echo "DEADLINE_${DEADLINE_MINUTES}_MIN" >&2; write_end "deadline_${DEADLINE_MINUTES}_min"; exit 124; }
}
adbT() {
    local seconds="$1" rc argline="" arg remaining now
    shift
    [ -n "$ADB_BIN" ] || return 127
    remaining=$((DEADLINE_EPOCH - $(date +%s)))
    [ "$remaining" -gt 0 ] || { write_end "deadline_${DEADLINE_MINUTES}_min"; return 124; }
    [ "$seconds" -le "$remaining" ] || seconds="$remaining"
    /usr/bin/perl -e 'alarm shift; exec @ARGV or exit 127' "$seconds" "$ADB_BIN" "$@"
    rc=$?
    now=$(date +%s)
    for arg in "$@"; do printf -v argline '%s %q' "$argline" "$arg"; done
    printf 'rc=%s%s\n' "$rc" "$argline" >> "$ADB_LOG"
    [ "$now" -lt "$DEADLINE_EPOCH" ] || return 124
    return "$rc"
}
run_step() {
    local name="$1" output="$2"; shift 2
    local started rc elapsed
    started=$(date +%s)
    {
        printf '=== START %s %s ===\n' "$name" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
        printf 'command:'; printf ' %q' "$@"; printf '\n'
        "$@"
    } > "$output" 2>&1
    rc=$?
    elapsed=$(( $(date +%s) - started ))
    printf '=== END %s rc=%s elapsed_seconds=%s %s ===\n' "$name" "$rc" "$elapsed" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$output"
    printf '%s rc=%s elapsed_seconds=%s\n' "$name" "$rc" "$elapsed" > "$RAW/$name.status"
    printf '%s rc=%s elapsed_seconds=%s\n' "$name" "$rc" "$elapsed" >> "$STATUS_LOG"
    printf 'STEP %s rc=%s elapsed_seconds=%s\n' "$name" "$rc" "$elapsed"
    return "$rc"
}
must_step() {
    local name="$1" output="$2" rc
    shift 2
    deadline_check
    run_step "$name" "$output" "$@"; rc=$?
    [ "$rc" -eq 0 ] || exit "$rc"
}
sha256_file() {
    local text rc
    if command -v shasum >/dev/null 2>&1; then text=$(shasum -a 256 "$1"); rc=$?
    elif command -v sha256sum >/dev/null 2>&1; then text=$(sha256sum "$1"); rc=$?
    else return 127; fi
    [ "$rc" -eq 0 ] || return "$rc"
    set -- $text
    printf '%s\n' "$1"
}
verify_model() {
    local actual
    [ -f "$MODEL" ] || { echo "MODEL_MISSING=$MODEL"; return 6; }
    actual=$(sha256_file "$MODEL") || return 6
    printf 'model_sha256=%s expected=%s\n' "$actual" "$EXPECTED_MODEL_SHA"
    [ "$actual" = "$EXPECTED_MODEL_SHA" ] || { echo "MODEL_SHA_FAIL"; return 6; }
}
select_device() {
    local list="$RAW/device-list.txt" entries="$RAW/device-entries.txt" rc count state
    adbT 60 devices > "$list" 2>&1; rc=$?
    cat "$list"
    [ "$rc" -eq 0 ] || return "$rc"
    awk 'NR > 1 && NF >= 2 && $1 !~ /^\*/ && $1 != "List" { print $1 "\t" $2 }' "$list" > "$entries"; rc=$?
    [ "$rc" -eq 0 ] || return "$rc"
    count=$(wc -l < "$entries")
    printf 'device_count=%s\n' "$count"
    [ "$count" -eq 1 ] || { echo "DEVICE_COUNT_FAIL count=$count"; return 2; }
    IFS='	' read -r SERIAL state < "$entries"
    printf 'serial=%s state=%s\n' "$SERIAL" "$state"
    [ "$state" = device ] || { echo "DEVICE_STATE_FAIL state=$state"; return 2; }
    adbT 60 -s "$SERIAL" wait-for-device
}
verify_board() {
    local properties="$RAW/board-properties.txt" product_board board_platform rc
    adbT 60 -s "$SERIAL" shell "printf 'ro.product.board='; getprop ro.product.board; printf 'ro.board.platform='; getprop ro.board.platform" > "$properties" 2>&1
    rc=$?
    cat "$properties"
    [ "$rc" -eq 0 ] || return "$rc"
    product_board=$(awk -F= '$1 == "ro.product.board" { gsub(/\r/, "", $2); print $2; exit }' "$properties")
    board_platform=$(awk -F= '$1 == "ro.board.platform" { gsub(/\r/, "", $2); print $2; exit }' "$properties")
    printf 'expected_board=%s product_board=%s board_platform=%s\n' "$EXPECTED_BOARD" "$product_board" "$board_platform"
    [ "$product_board" = "$EXPECTED_BOARD" ] && [ "$board_platform" = "$EXPECTED_BOARD" ] || { echo "BOARD_GATE_FAIL"; return 6; }
}
prepare_remote() {
    adbT 60 -s "$SERIAL" shell "mkdir -p '$DEVICE_ROOT'"
}
remote_sha() {
    local path="$1" file="$2" rc
    adbT 300 -s "$SERIAL" shell "if [ -f '$path' ]; then sha256sum '$path'; else echo MISSING; fi" > "$file" 2>&1
    rc=$?
    cat "$file"
    [ "$rc" -eq 0 ] || return "$rc"
    REMOTE_SHA=$(awk 'length($1) == 64 && $1 !~ /[^[:xdigit:]]/ { print $1; exit }' "$file")
}
transfer_kit() {
    local local_sha rc
    [ -f "$KIT_TGZ" ] || { echo "KIT_MISSING=$KIT_TGZ"; return 1; }
    local_sha=$(sha256_file "$KIT_TGZ") || return 1
    printf 'kit_local_sha256=%s\n' "$local_sha"
    remote_sha "$DEVICE_KIT_TGZ" "$RAW/kit-device-sha.txt"; rc=$?
    [ "$rc" -eq 0 ] || return "$rc"
    if [ "$REMOTE_SHA" = "$local_sha" ]; then
        echo "kit_push=skipped reason=on_device_sha256_matches"
    else
        echo "kit_push=performed reason=sha256_mismatch_or_missing"
        adbT 1200 -s "$SERIAL" push "$KIT_TGZ" "$DEVICE_KIT_TGZ" || return $?
    fi
    adbT 180 -s "$SERIAL" shell "rm -rf '$DEVICE_KIT_DIR' && mkdir -p '$DEVICE_KIT_DIR' && tar -xzf '$DEVICE_KIT_TGZ' -C '$DEVICE_KIT_DIR'"
    rc=$?
    [ "$rc" -eq 0 ] || { echo "KIT_EXTRACT_FAIL rc=$rc"; return "$rc"; }
    echo "kit_extract=ok"
}
transfer_model() {
    local local_sha rc
    [ -f "$MODEL" ] || { echo "MODEL_MISSING=$MODEL"; return 1; }
    local_sha=$(sha256_file "$MODEL") || return 1
    printf 'model_local_sha256=%s\n' "$local_sha"
    remote_sha "$DEVICE_MODEL" "$RAW/model-device-sha.txt"; rc=$?
    [ "$rc" -eq 0 ] || return "$rc"
    if [ "$REMOTE_SHA" = "$local_sha" ]; then
        echo "model_push=skipped reason=on_device_sha256_matches"
    else
        echo "model_push=performed reason=sha256_mismatch_or_missing"
        adbT 1200 -s "$SERIAL" push "$MODEL" "$DEVICE_MODEL" || return $?
    fi
    adbT 60 -s "$SERIAL" shell "chmod 644 '$DEVICE_MODEL'"
}
push_corpus() {
    local words
    [ -f "$CORPUS" ] || { echo "CORPUS_MISSING=$CORPUS"; return 1; }
    words=$(wc -w < "$CORPUS")
    printf 'corpus_token_target=%s approximate_word_count=%s\n' "$CORPUS_TOKEN_TARGET" "$words"
    adbT 300 -s "$SERIAL" push "$CORPUS" "$DEVICE_CORPUS"
}
run_kld() {
    local cpu_cmd gpu_cmd rc
    printf 'host_cpu_kld=%s\n' "$RAW/cpu.kld"
    cpu_cmd="cd '$DEVICE_KIT_DIR' && export LD_LIBRARY_PATH='$DEVICE_KIT_DIR/lib' && ./bin/llama-perplexity -m '$DEVICE_MODEL' -f '$DEVICE_CORPUS' -c '$CONTEXT_SIZE' -b '$BATCH_SIZE' -ngl 0 -s 42 --temp 0 --kl-divergence-base '$DEVICE_ROOT/cpu.kld'"
    gpu_cmd="cd '$DEVICE_KIT_DIR' && export LD_LIBRARY_PATH='$DEVICE_KIT_DIR/lib' && ./bin/llama-perplexity -m '$DEVICE_MODEL' -f '$DEVICE_CORPUS' -c '$CONTEXT_SIZE' -b '$BATCH_SIZE' -ngl 99 -s 42 --temp 0 --kl-divergence --kl-divergence-base '$DEVICE_ROOT/cpu.kld'"
    run_step cpu-kld "$RAW/cpu-kld.log" adbT 1800 -s "$SERIAL" shell "$cpu_cmd"; rc=$?; [ "$rc" -eq 0 ] || return "$rc"
    run_step pull-cpu-kld "$RAW/pull-cpu-kld.txt" adbT 300 -s "$SERIAL" pull "$DEVICE_ROOT/cpu.kld" "$RAW/cpu.kld"; rc=$?; [ "$rc" -eq 0 ] || return "$rc"
    run_step gpu-kld "$RAW/gpu-kld.log" adbT 1800 -s "$SERIAL" shell "$gpu_cmd"; rc=$?; [ "$rc" -eq 0 ] || return "$rc"
    run_step extract-results "$RAW/results.txt" extract_results
}
extract_results() {
    awk '
        /^[[:space:]]*Mean[[:space:]]+KLD:/ { print "mean_kld\traw=" $0; seen_mean=1 }
        /^[[:space:]]*Median[[:space:]]+KLD:/ { print "median_kld\traw=" $0; seen_median=1 }
        /^[[:space:]]*Same top p:/ { print "same_top_p\traw=" $0; seen_top=1 }
        /Mean PPL\(Q\)-PPL\(base\)/ { print "ppl_delta\traw=" $0; seen_ppl=1 }
        END {
            if (!seen_mean || !seen_median || !seen_top || !seen_ppl) {
                print "KLD summary extraction failed" > "/dev/stderr"; exit 1
            }
        }
    ' "$RAW/gpu-kld.log"
}
run_dump() {
    local cpu_cmd gpu_cmd rc
    cpu_cmd="cd '$DEVICE_KIT_DIR' && export LD_LIBRARY_PATH='$DEVICE_KIT_DIR/lib' && ./bin/llama-eval-callback -m '$DEVICE_MODEL' --prompt '$PROMPT' --seed 42 -ngl 0 -n 1 --temp 0 -c '$CONTEXT_SIZE'"
    gpu_cmd="cd '$DEVICE_KIT_DIR' && export LD_LIBRARY_PATH='$DEVICE_KIT_DIR/lib' && ./bin/llama-eval-callback -m '$DEVICE_MODEL' --prompt '$PROMPT' --seed 42 -ngl 99 -n 1 --temp 0 -c '$CONTEXT_SIZE'"
    run_step cpu-dump "$RAW/cpu-dump.txt" adbT 1800 -s "$SERIAL" shell "$cpu_cmd"; rc=$?; [ "$rc" -eq 0 ] || return "$rc"
    run_step gpu-dump "$RAW/gpu-dump.txt" adbT 1800 -s "$SERIAL" shell "$gpu_cmd"; rc=$?; [ "$rc" -eq 0 ] || return "$rc"
}
must_step verify-model "$RAW/verify-model.txt" verify_model
must_step device-select "$RAW/device-select.txt" select_device
must_step verify-board "$RAW/verify-board.txt" verify_board
must_step prepare-remote "$RAW/prepare-remote.txt" prepare_remote
must_step transfer-kit "$RAW/transfer-kit.txt" transfer_kit
must_step transfer-model "$RAW/transfer-model.txt" transfer_model
must_step push-corpus "$RAW/push-corpus.txt" push_corpus
if [ "$MODE" = kld ]; then
    deadline_check
    run_kld; rc=$?
else
    deadline_check
    run_dump; rc=$?
fi
exit "$rc"
