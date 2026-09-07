#!/usr/bin/env bash
set -u
export LC_ALL=C

readonly CELL_DIR="/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/adreno-acc-type"
readonly CORPUS_TOKEN_TARGET=3500
readonly KIT_TGZ="$HOME/kalsa-qdc/adreno-acc-type/kit-gemm-acc-probe.tgz"
readonly MODEL="$HOME/kalsa-qdc/models/LFM2.5-2.6B-QAD-Q4_0.gguf"
readonly EXPECTED_MODEL_SHA="a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03"
readonly MODEL_FILE="LFM2.5-2.6B-QAD-Q4_0.gguf"
readonly CORPUS="$CELL_DIR/../adreno-precision-bisect/corpus.txt"
readonly CONTEXT_SIZE=256
readonly BATCH_SIZE=256
readonly DEVICE_ROOT=/data/local/tmp/kalsa-acc-type
readonly DEVICE_KIT_TGZ="$DEVICE_ROOT/kit-gemm-acc-probe.tgz"
readonly DEVICE_KIT_DIR="$DEVICE_ROOT/kit-gemm-acc-probe"
readonly DEVICE_MODEL="$DEVICE_ROOT/$MODEL_FILE"
readonly DEVICE_CORPUS="$DEVICE_ROOT/corpus.txt"
readonly DEVICE_CPU_KLD="$DEVICE_ROOT/cpu.kld"

usage() { echo "usage: $0 [--bench] [--cool <seconds>] [--bench-seed <n>] <job_id> <deadline_minutes> <variant_list> | $0 --self-test" >&2; }
die() { echo "d_run.sh: $*" >&2; exit 1; }

SELF_TEST=0
BENCH=0
COOL_SECONDS=0
BENCH_SEED=""
BENCH_SEED_SET=0
BENCH_ORDER=()
BENCH_TSV=""
BENCH_ORDER_FILE=""
PREV_BENCH_END_EPOCH=0
while [ "$#" -gt 0 ]; do
    case "$1" in
        --self-test) SELF_TEST=1; shift; break ;;
        --bench) BENCH=1; shift ;;
        --cool)
            [ "$#" -ge 2 ] || { echo "--cool requires seconds" >&2; exit 2; }
            COOL_SECONDS="$2"; shift 2 ;;
        --bench-seed)
            [ "$#" -ge 2 ] || { echo "--bench-seed requires n" >&2; exit 2; }
            BENCH_SEED="$2"; BENCH_SEED_SET=1; shift 2 ;;
        *) break ;;
    esac
done
if [ "$SELF_TEST" -eq 1 ]; then
    [ "$#" -eq 0 ] || { echo "--self-test takes no arguments" >&2; exit 2; }
else
    [ "$#" -ge 3 ] || { usage; exit 2; }
    JOB="$1"
    DEADLINE_MINUTES="$2"
    VARIANT_LIST="$3"
    shift 3
    while [ "$#" -gt 0 ]; do
        case "$1" in
            --bench) BENCH=1; shift ;;
            --cool)
                [ "$#" -ge 2 ] || { echo "--cool requires seconds" >&2; exit 2; }
                COOL_SECONDS="$2"; shift 2 ;;
            --bench-seed)
                [ "$#" -ge 2 ] || { echo "--bench-seed requires n" >&2; exit 2; }
                BENCH_SEED="$2"; BENCH_SEED_SET=1; shift 2 ;;
            *) usage; exit 2 ;;
        esac
    done
    case "$JOB" in ''|*[!A-Za-z0-9._-]*) echo "invalid job_id" >&2; exit 2;; esac
    case "$DEADLINE_MINUTES" in ''|*[!0-9]*) echo "deadline_minutes must be an integer from 20 to 110" >&2; exit 2;; esac
    [ "$DEADLINE_MINUTES" -ge 20 ] && [ "$DEADLINE_MINUTES" -le 110 ] || { echo "deadline_minutes must be an integer from 20 to 110" >&2; exit 2; }
    case "$COOL_SECONDS" in ''|*[!0-9]*) echo "cool seconds must be a non-negative integer" >&2; exit 2;; esac
    [ "$BENCH" -eq 0 ] || [ "$BENCH_SEED_SET" -eq 1 ] || { echo "--bench requires --bench-seed <n>" >&2; exit 2; }
    if [ "$BENCH_SEED_SET" -eq 1 ]; then
        case "$BENCH_SEED" in ''|*[!0-9]*) echo "bench seed must be a non-negative integer" >&2; exit 2;; esac
    fi
fi

REQUESTED_VARIANTS=()
validate_variants() {
    local list="$1" variant math prec
    [ -n "$list" ] || { echo "variant_list must contain at least one math:prec pair" >&2; return 2; }
    case "$list" in *$'\n'*|*$'\r'*) echo "variant_list must be space-separated" >&2; return 2;; esac
    read -r -a REQUESTED_VARIANTS <<< "$list"
    [ "${#REQUESTED_VARIANTS[@]}" -gt 0 ] || { echo "variant_list must contain at least one math:prec pair" >&2; return 2; }
    for variant in "${REQUESTED_VARIANTS[@]}"; do
        case "$variant" in
            *:*) math="${variant%%:*}"; prec="${variant#*:}" ;;
            *) echo "invalid variant: $variant" >&2; return 2;;
        esac
        case "$math" in stock|strict) ;; *) echo "invalid math in variant: $variant" >&2; return 2;; esac
        case "$prec" in half|acc|mul|deq) ;; *) echo "invalid precision in variant: $variant" >&2; return 2;; esac
        [ "$variant" = "$math:$prec" ] || { echo "invalid variant: $variant" >&2; return 2; }
    done
}
if [ "$SELF_TEST" -eq 0 ]; then
    validate_variants "$VARIANT_LIST" || exit $?
fi

if [ "$SELF_TEST" -eq 0 ]; then
    [ -n "${ANDROID_ADB_SERVER_PORT:-}" ] || die "ANDROID_ADB_SERVER_PORT must be exported"
    RAW="$CELL_DIR/raw/$JOB"
    mkdir -p "$RAW" || die "could not create raw output directory: $RAW"
    ADB_LOG="$RAW/adb-exit.log"
    STATUS_LOG="$RAW/status.log"
    END_FILE="$RAW/END.txt"
    VARIANTS_TSV="$RAW/variants.tsv"
    : > "$ADB_LOG"
    : > "$STATUS_LOG"
    printf 'variant\treported_prec\treported_math\tmean_kld\tmedian_kld\tsame_top_p\tppl_delta\telapsed_seconds\trc\tstatus\treason\n' > "$VARIANTS_TSV"
    END_WRITTEN=0
    START_EPOCH=$(date +%s)
    DEADLINE_EPOCH=$((START_EPOCH + DEADLINE_MINUTES * 60))
    SERIAL=""
    REMOTE_SHA=""
    ADB_BIN="$(command -v adb 2>/dev/null || true)"
fi

write_end() {
    local reason="$1"
    [ "$END_WRITTEN" -eq 1 ] || { printf 'END reason=%s\n' "$reason" > "$END_FILE"; END_WRITTEN=1; }
}

on_exit() {
    local rc=$?
    write_end "exit_$rc"
    exit "$rc"
}

if [ "$SELF_TEST" -eq 0 ]; then
    trap on_exit EXIT
fi

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
    local name="$1" output="$2" started rc elapsed
    shift 2
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
    if command -v shasum >/dev/null 2>&1; then
        text=$(shasum -a 256 "$1")
        rc=$?
    elif command -v sha256sum >/dev/null 2>&1; then
        text=$(sha256sum "$1")
        rc=$?
    else
        return 127
    fi
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
    printf 'expected_product_board=pineapple product_board=%s board_platform=%s\n' "$product_board" "$board_platform"
    [ "$product_board" = pineapple ] || { echo "BOARD_GATE_FAIL"; return 6; }
}

prepare_remote() {
    adbT 60 -s "$SERIAL" shell "mkdir -p '$DEVICE_ROOT'"
}

remote_sha() {
    local path="$1" file="$2" rc
    REMOTE_SHA=""
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

extract_tag() {
    local line="$1" key="$2"
    awk -v key="$key" '{
        prefix=key "="
        for (i = 1; i <= NF; i++) {
            if (index($i, prefix) == 1) {
                value=substr($i, length(prefix) + 1)
                sub(/[^A-Za-z0-9_-].*$/, "", value)
                print value
                exit
            }
        }
        exit 1
    }' <<< "$line"
}

extract_metric() {
    local log="$1" label="$2"
    awk -v label="$label" '
        {
            matches = (label == "Mean KLD" && $0 ~ /^[[:space:]]*Mean[[:space:]]+KLD[[:space:]]*:/) ||
                (label == "Median KLD" && $0 ~ /^[[:space:]]*Median[[:space:]]+KLD[[:space:]]*:/) ||
                (label == "Same top p" && $0 ~ /^[[:space:]]*Same[[:space:]]+top[[:space:]]+p[[:space:]]*:/) ||
                (label == "Mean PPL(Q)-PPL(base)" && $0 ~ /^[[:space:]]*Mean[[:space:]]+PPL\(Q\)-PPL\(base\)[[:space:]]*:/)
            if (matches) {
                value=$0
                sub(/^[^:]*:[[:space:]]*/, "", value)
                if (match(value, /[-+]?[0-9]+([.][0-9]*)?([eE][-+]?[0-9]+)?/)) {
                    print substr(value, RSTART, RLENGTH)
                    found=1
                    exit
                }
            }
        }
        END { if (!found) exit 1 }
    ' "$log"
}

extract_bench_pp512() {
    local log="$1"
    awk -F'|' '
        /\|[[:space:]]*pp512[[:space:]]*\|/ {
            value=$(NF - 1)
            if (match(value, /[-+]?[0-9]+([.][0-9]*)?([eE][-+]?[0-9]+)?/)) {
                mean=substr(value, RSTART, RLENGTH)
                rest=substr(value, RSTART + RLENGTH)
                if (match(rest, /[-+]?[0-9]+([.][0-9]*)?([eE][-+]?[0-9]+)?/)) {
                    print mean "\t" substr(rest, RSTART, RLENGTH)
                    found=1
                    exit
                }
            }
        }
        END { if (!found) exit 1 }
    ' "$log"
}

split_variant() {
    local variant math prec key
    variant="$1"
    math="${variant%%:*}"
    prec="${variant#*:}"
    key="${variant/:/-}"
    printf '%s\t%s\t%s\n' "$math" "$prec" "$key"
}

self_test_metric() {
    local name="$1" log="$2" label="$3" expected="$4" actual rc
    actual=$(extract_metric "$log" "$label"); rc=$?
    if [ "$rc" -eq 0 ] && [ "$actual" = "$expected" ]; then
        printf 'PASS %s=%s\n' "$name" "$actual"
        return 0
    fi
    printf 'FAIL %s expected=%s actual=%s rc=%s\n' "$name" "$expected" "$actual" "$rc"
    return 1
}

self_test_variant_split() {
    local parts math prec key
    parts=$(split_variant "strict:acc")
    IFS='	' read -r math prec key <<< "$parts"
    if [ "$math" = strict ] && [ "$prec" = acc ] && [ "$key" = strict-acc ]; then
        printf 'PASS variant split strict:acc math=%s prec=%s key=%s\n' "$math" "$prec" "$key"
        return 0
    fi
    printf 'FAIL variant split strict:acc math=%s prec=%s key=%s\n' "$math" "$prec" "$key"
    return 1
}

self_test_bench_metric() {
    local log="$CELL_DIR/raw/sa812265/bench-stock-half.log" actual mean std rc
    actual=$(extract_bench_pp512 "$log"); rc=$?
    mean=""
    std=""
    [ "$rc" -eq 0 ] && IFS='	' read -r mean std <<< "$actual"
    if [ "$rc" -eq 0 ] && [ "$mean" = 286.30 ] && [ "$std" = 0.61 ]; then
        printf 'PASS bench pp512=%s stddev=%s\n' "$mean" "$std"
        return 0
    fi
    printf 'FAIL bench expected=286.30/0.61 actual=%s rc=%s\n' "$actual" "$rc"
    return 1
}

self_test_provenance() {
    local provenance_log="$CELL_DIR/raw/provenance/provenance-lines.txt" candidates="$CELL_DIR/.d-run-self-test-provenance-candidates.$$"
    local line reported_prec reported_math find_rc prec_rc math_rc cleanup_rc compile_opts_present
    line=$(find_provenance "$provenance_log" "$candidates"); find_rc=$?
    reported_prec=$(extract_tag "$line" prec); prec_rc=$?
    reported_math=$(extract_tag "$line" math); math_rc=$?
    rm -f "$candidates"
    cleanup_rc=$?
    case "$line" in
        *compile_opts=*) compile_opts_present=1 ;;
        *) compile_opts_present=0 ;;
    esac
    if [ "$find_rc" -eq 0 ] && [ "$prec_rc" -eq 0 ] && [ "$math_rc" -eq 0 ] && [ "$reported_prec" = half ] && [ "$reported_math" = stock ] && [ "$compile_opts_present" -eq 1 ] && [ "$cleanup_rc" -eq 0 ]; then
        printf 'PASS provenance prec=%s math=%s\n' "$reported_prec" "$reported_math"
        return 0
    fi
    printf 'FAIL provenance prec=%s math=%s find_rc=%s tag_rc=%s/%s cleanup_rc=%s\n' "$reported_prec" "$reported_math" "$find_rc" "$prec_rc" "$math_rc" "$cleanup_rc"
    return 1
}

self_test_negative_provenance() {
    local probe_log="$CELL_DIR/.d-run-self-test-probe.$$" candidates="$CELL_DIR/.d-run-self-test-probe-candidates.$$"
    local line reported_prec find_rc tag_rc cleanup_rc
    printf "gemm_noshuffle_q4_0_f32 prec=half math=stock compile_opts='-cl-std=CL3.0'\n" > "$probe_log"
    find_rc=0
    tag_rc=0
    line=$(find_provenance "$probe_log" "$candidates"); find_rc=$?
    reported_prec=$(extract_tag "$line" prec); tag_rc=$?
    rm -f "$probe_log" "$candidates"
    cleanup_rc=$?
    if [ "$find_rc" -eq 0 ] && [ "$tag_rc" -eq 0 ] && [ "$reported_prec" != acc ] && [ "$cleanup_rc" -eq 0 ]; then
        printf 'PASS negative provenance requested_prec=acc reported_prec=%s\n' "$reported_prec"
        return 0
    fi
    printf 'FAIL negative provenance reported_prec=%s find_rc=%s tag_rc=%s cleanup_rc=%s\n' "$reported_prec" "$find_rc" "$tag_rc" "$cleanup_rc"
    return 1
}

self_test_negative_metric() {
    local negative_log="$CELL_DIR/.d-run-self-test-negative.$$" actual rc cleanup_rc
    printf 'Maximum KLD:   8.292806\n' > "$negative_log"
    rc=$?
    if [ "$rc" -eq 0 ]; then
        actual=$(extract_metric "$negative_log" "Mean KLD"); rc=$?
    else
        actual=""
    fi
    rm -f "$negative_log"
    cleanup_rc=$?
    if [ "$rc" -ne 0 ] && [ -z "$actual" ] && [ "$cleanup_rc" -eq 0 ]; then
        printf 'PASS negative Mean KLD excludes Maximum KLD\n'
        return 0
    fi
    printf 'FAIL negative Mean KLD returned=%s rc=%s cleanup_rc=%s\n' "$actual" "$rc" "$cleanup_rc"
    return 1
}

self_test() {
    local failed=0 faoff_log="$CELL_DIR/../adreno-precision-bisect/raw/sa812121-faoff/gpu-kld.log"
    local b1_log="$CELL_DIR/../adreno-precision-bisect/raw/sa812121-b1/gpu-kld.log"
    self_test_metric "sa812121-faoff Mean KLD" "$faoff_log" "Mean KLD" "0.638627" || failed=1
    self_test_metric "sa812121-faoff Median KLD" "$faoff_log" "Median KLD" "0.453822" || failed=1
    self_test_metric "sa812121-faoff Same top p" "$faoff_log" "Same top p" "62.823" || failed=1
    self_test_metric "sa812121-faoff Mean PPL(Q)-PPL(base)" "$faoff_log" "Mean PPL(Q)-PPL(base)" "8.400806" || failed=1
    self_test_metric "sa812121-b1 Mean KLD" "$b1_log" "Mean KLD" "0.002607" || failed=1
    self_test_metric "sa812121-b1 Median KLD" "$b1_log" "Median KLD" "0.000962" || failed=1
    self_test_metric "sa812121-b1 Same top p" "$b1_log" "Same top p" "98.031" || failed=1
    self_test_metric "sa812121-b1 Mean PPL(Q)-PPL(base)" "$b1_log" "Mean PPL(Q)-PPL(base)" "0.274311" || failed=1
    self_test_variant_split || failed=1
    self_test_bench_metric || failed=1
    self_test_provenance || failed=1
    self_test_negative_provenance || failed=1
    self_test_negative_metric || failed=1
    return "$failed"
}

find_provenance() {
    local log="$1" candidates="$2" rc
    grep -E '(^|[[:space:]])(prec|math)=' "$log" > "$candidates"; rc=$?
    [ "$rc" -le 1 ] || return "$rc"
    awk '
        /(^|[[:space:]])prec=(half|acc|mul|deq)([^[:alnum:]_-]|$)/ && /(^|[[:space:]])math=(stock|strict)([^[:alnum:]_-]|$)/ { print; found=1; exit }
        /(^|[[:space:]])math=(stock|strict)([^[:alnum:]_-]|$)/ && /(^|[[:space:]])prec=(half|acc|mul|deq)([^[:alnum:]_-]|$)/ { print; found=1; exit }
        END { if (!found) exit 1 }
    ' "$candidates"
}

variant_row() {
    local variant math prec key parts
    local probe_step probe_log probe_remote probe_cmd probe_candidates platform_file probe_rc platform_rc
    local step log provenance="-"
    local provenance_rc reported_prec="-" reported_math="-" prec_rc math_rc error_file error_rc
    local mean="-" median="-" same_top="-" ppl_delta="-" mean_rc median_rc same_rc ppl_rc
    local started rc elapsed status reason
    variant="$1"
    parts=$(split_variant "$variant")
    IFS='	' read -r math prec key <<< "$parts"
    probe_step="probe-$key"
    probe_log="$RAW/$probe_step.log"
    probe_remote="$DEVICE_ROOT/$probe_step.log"
    probe_cmd="cd '$DEVICE_KIT_DIR' && export LD_LIBRARY_PATH='$DEVICE_KIT_DIR/lib' && export KALSA_GEMM_MATH='$math' KALSA_GEMM_PREC='$prec' && rm -f '$probe_remote' && ./bin/llama-bench -v -m '$DEVICE_MODEL' -p 8 -n 0 -ngl 99 -fa 0 -r 1 > '$probe_remote' 2>&1; probe_rc=\$?; cat '$probe_remote'; exit \$probe_rc"
    run_step "$probe_step" "$probe_log" adbT 300 -s "$SERIAL" shell "$probe_cmd"; probe_rc=$?
    platform_file="$RAW/$probe_step.platform"
    grep -F "selected platform: 'QUALCOMM" "$probe_log" > "$platform_file"; platform_rc=$?
    probe_candidates="$RAW/$probe_step.provenance-candidates"
    provenance=$(find_provenance "$probe_log" "$probe_candidates"); provenance_rc=$?
    if [ "$provenance_rc" -eq 0 ]; then
        printf '%s\n' "$provenance" > "$RAW/$probe_step.provenance"
        reported_prec=$(extract_tag "$provenance" prec); prec_rc=$?
        reported_math=$(extract_tag "$provenance" math); math_rc=$?
        [ "$prec_rc" -eq 0 ] || reported_prec="-"
        [ "$math_rc" -eq 0 ] || reported_math="-"
    else
        : > "$RAW/$probe_step.provenance"
        prec_rc=1
        math_rc=1
    fi
    step="variant-$key"
    log="$RAW/$step.log"
    error_file="$RAW/$step.errors"
    started=$(date +%s)
    GPU_CMD="cd '$DEVICE_KIT_DIR' && export LD_LIBRARY_PATH='$DEVICE_KIT_DIR/lib' && export KALSA_GEMM_MATH='$math' KALSA_GEMM_PREC='$prec' && ./bin/llama-perplexity -m '$DEVICE_MODEL' -f '$DEVICE_CORPUS' -c '$CONTEXT_SIZE' -b '$BATCH_SIZE' -ngl 99 -fa off -s 42 --temp 0 --kl-divergence --kl-divergence-base '$DEVICE_CPU_KLD'"
    run_step "$step" "$log" adbT 1800 -s "$SERIAL" shell "$GPU_CMD"; rc=$?
    elapsed=$(( $(date +%s) - started ))
    grep -E 'error:|CL_BUILD_PROGRAM_FAILURE|clBuildProgram[^[:alnum:]]+failed|build program[^[:alnum:]]+failed' "$log" > "$error_file"; error_rc=$?
    [ "$error_rc" -le 1 ] || error_rc=2
    mean=$(extract_metric "$log" "Mean KLD"); mean_rc=$?
    median=$(extract_metric "$log" "Median KLD"); median_rc=$?
    same_top=$(extract_metric "$log" "Same top p"); same_rc=$?
    ppl_delta=$(extract_metric "$log" "Mean PPL(Q)-PPL(base)"); ppl_rc=$?
    status=OK
    reason=-
    if [ "$platform_rc" -ne 0 ]; then
        status=VOID
        reason=not_gpu
    elif [ "$probe_rc" -ne 0 ]; then
        status=VOID
        reason="probe_rc_$probe_rc"
    elif [ "$rc" -ne 0 ]; then
        status=VOID
        reason="gpu_rc_$rc"
    elif [ "$provenance_rc" -gt 1 ]; then
        status=VOID
        reason=provenance_scan_failed
    elif [ "$provenance_rc" -ne 0 ] || [ "$prec_rc" -ne 0 ] || [ "$math_rc" -ne 0 ]; then
        status=VOID
        reason="provenance_missing"
    elif [ "$reported_prec" != "$prec" ] || [ "$reported_math" != "$math" ]; then
        status=VOID
        reason="provenance_mismatch_requested_${math}:${prec}"
    elif [ "$error_rc" -eq 0 ]; then
        status=VOID
        reason=kernel_build_error
    elif [ "$error_rc" -gt 1 ]; then
        status=VOID
        reason=error_scan_failed
    elif [ "$mean_rc" -ne 0 ] || [ "$median_rc" -ne 0 ] || [ "$same_rc" -ne 0 ] || [ "$ppl_rc" -ne 0 ]; then
        status=VOID
        reason=summary_missing
    fi
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
        "$variant" "$reported_prec" "$reported_math" "$mean" "$median" "$same_top" "$ppl_delta" "$elapsed" "$rc" "$status" "$reason" >> "$VARIANTS_TSV"
    [ "$rc" -eq 0 ]
}

run_variants() {
    local variant variant_rc overall_rc=0
    for variant in "${REQUESTED_VARIANTS[@]}"; do
        variant_row "$variant"; variant_rc=$?
        [ "$variant_rc" -eq 0 ] || overall_rc="$variant_rc"
    done
    return "$overall_rc"
}

read_temperature() {
    local name output rc skin
    name="$1"
    output="$RAW/$name.log"
    adbT 90 -s "$SERIAL" shell dumpsys thermalservice > "$output" 2>&1
    rc=$?
    printf 'thermal_read_rc=%s\n' "$rc" >> "$output"
    if [ "$rc" -ne 0 ]; then
        printf '%s' '-'
        return 0
    fi
    skin=$(awk '
        /Current temperatures from HAL/ { live=1; next }
        /Current cooling devices from HAL/ { live=0 }
        live && /mName=skin/ {
            value=$0
            sub(/^.*mValue=/, "", value)
            sub(/,.*/, "", value)
            if (value ~ /^[0-9]+([.][0-9]+)?$/) {
                print value
                found=1
                exit
            }
        }
        END { if (!found) exit 1 }
    ' "$output")
    rc=$?
    if [ "$rc" -eq 0 ]; then
        printf '%s' "$skin"
    else
        printf '%s' '-'
    fi
    return 0
}

build_bench_order() {
    local i j tmp
    BENCH_ORDER=("${REQUESTED_VARIANTS[@]}")
    RANDOM="$BENCH_SEED"
    for ((i=${#BENCH_ORDER[@]} - 1; i > 0; i--)); do
        j=$((RANDOM % (i + 1)))
        tmp="${BENCH_ORDER[$i]}"
        BENCH_ORDER[$i]="${BENCH_ORDER[$j]}"
        BENCH_ORDER[$j]="$tmp"
    done
    printf 'bench_seed=%s\n' "$BENCH_SEED" > "$BENCH_ORDER_FILE"
    for ((i=0; i<${#BENCH_ORDER[@]}; i++)); do
        printf '%s\t%s\n' "$((i + 1))" "${BENCH_ORDER[$i]}" >> "$BENCH_ORDER_FILE"
    done
}

bench_variant() {
    local variant math prec key parts order_index
    local step log bench_cmd temp_before temp_after host_gap bench_start bench_end bench_rc cool_rc
    local pp_values pp512 pp_std pp_rc
    variant="$1"
    order_index="$2"
    parts=$(split_variant "$variant")
    IFS='	' read -r math prec key <<< "$parts"
    step="bench-$key"
    log="$RAW/$step.log"
    if [ "$PREV_BENCH_END_EPOCH" -gt 0 ]; then
        sleep "$COOL_SECONDS"
        cool_rc=$?
    else
        cool_rc=0
    fi
    temp_before=$(read_temperature "$step-before")
    bench_start=$(date +%s)
    if [ "$PREV_BENCH_END_EPOCH" -gt 0 ]; then
        host_gap=$((bench_start - PREV_BENCH_END_EPOCH))
    else
        host_gap=0
    fi
    bench_cmd="cd '$DEVICE_KIT_DIR' && export LD_LIBRARY_PATH='$DEVICE_KIT_DIR/lib' && export KALSA_GEMM_MATH='$math' KALSA_GEMM_PREC='$prec' && ./bin/llama-bench -m '$DEVICE_MODEL' -p 512 -n 0 -ngl 99 -fa 0 -r 3"
    run_step "$step" "$log" adbT 1800 -s "$SERIAL" shell "$bench_cmd"
    bench_rc=$?
    bench_end=$(date +%s)
    temp_after=$(read_temperature "$step-after")
    PREV_BENCH_END_EPOCH="$bench_end"
    pp_values=$(extract_bench_pp512 "$log")
    pp_rc=$?
    pp512="-"
    pp_std="-"
    if [ "$pp_rc" -eq 0 ]; then
        IFS='	' read -r pp512 pp_std <<< "$pp_values"
    fi
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
        "$variant" "$order_index" "$temp_before" "$temp_after" "$host_gap" "$pp512" "$pp_std" "$bench_rc" >> "$BENCH_TSV"
    [ "$cool_rc" -eq 0 ] || return "$cool_rc"
    return "$bench_rc"
}

run_bench() {
    local order_index variant bench_rc overall_rc=0
    BENCH_TSV="$RAW/bench.tsv"
    BENCH_ORDER_FILE="$RAW/bench-order.tsv"
    PREV_BENCH_END_EPOCH=0
    printf 'variant\trealised_order_index\ttemperature_before\ttemperature_after\thost_gap_seconds\tpp512\tpp512_stddev\trc\n' > "$BENCH_TSV"
    build_bench_order
    for ((order_index=1; order_index<=${#BENCH_ORDER[@]}; order_index++)); do
        variant="${BENCH_ORDER[$((order_index - 1))]}"
        bench_variant "$variant" "$order_index"; bench_rc=$?
        [ "$bench_rc" -eq 0 ] || overall_rc="$bench_rc"
    done
    return "$overall_rc"
}

if [ "$SELF_TEST" -eq 1 ]; then
    self_test
    exit $?
fi

must_step verify-model "$RAW/verify-model.txt" verify_model
must_step device-select "$RAW/device-select.txt" select_device
must_step verify-board "$RAW/verify-board.txt" verify_board
must_step prepare-remote "$RAW/prepare-remote.txt" prepare_remote
must_step transfer-kit "$RAW/transfer-kit.txt" transfer_kit
must_step transfer-model "$RAW/transfer-model.txt" transfer_model
must_step push-corpus "$RAW/push-corpus.txt" push_corpus

deadline_check
CPU_CMD="cd '$DEVICE_KIT_DIR' && export LD_LIBRARY_PATH='$DEVICE_KIT_DIR/lib' && rm -f '$DEVICE_CPU_KLD' && ./bin/llama-perplexity -m '$DEVICE_MODEL' -f '$DEVICE_CORPUS' -c '$CONTEXT_SIZE' -b '$BATCH_SIZE' -ngl 0 -fa off -s 42 --temp 0 --kl-divergence-base '$DEVICE_CPU_KLD'"
must_step cpu-kld "$RAW/cpu-kld.log" adbT 1800 -s "$SERIAL" shell "$CPU_CMD"

deadline_check
run_variants; overall_rc=$?
if [ "$BENCH" -eq 1 ]; then
    deadline_check
    run_bench; bench_rc=$?
    [ "$overall_rc" -eq 0 ] && [ "$bench_rc" -ne 0 ] && overall_rc="$bench_rc"
fi
exit "$overall_rc"
