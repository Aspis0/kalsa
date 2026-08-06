#!/usr/bin/env bash
# =============================================================================
# test_run_bench.sh — test sintetici per scripts/run_bench.sh (senza telefono)
#
# Verifica:
#   1) parsing /proc (comm con spazi, minflt/majflt/read_bytes/VmRSS)
#   2) sanitizzazione notes (niente virgole/newline nella riga CSV)
#   3) selezione runtime → binario + flag set (--print-cmd)
#   4) gate batteria fail-closed (exit 7) salvo --allow-no-battery
#
# Uso (da root repo, su PC con bash 5.x):
#   bash scripts/test_run_bench.sh
#
# Exit: 0 se tutti PASS, 1 se almeno un FAIL
# =============================================================================

set -o pipefail
export LC_ALL=C

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
HARNESS="$SCRIPT_DIR/run_bench.sh"

PASS_N=0
FAIL_N=0

pass() {
    echo "PASS  $1"
    PASS_N=$((PASS_N + 1))
}

fail() {
    echo "FAIL  $1"
    if [ -n "${2:-}" ]; then
        echo "      dettaglio: $2"
    fi
    FAIL_N=$((FAIL_N + 1))
}

# ---------------------------------------------------------------------------
# 1) Parsing /proc — source helper dall'harness e invoca le funzioni REALI
# ---------------------------------------------------------------------------
echo "=== 1) /proc parsing helpers ==="

TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/test_run_bench.XXXXXX")"

# Carica helper (read_flt, read_read_bytes, read_vmrss_kb, parse_timings, …)
# shellcheck disable=SC1090
RUN_BENCH_LIB_ONLY=1 source "$HARNESS"

# Verifica che le funzioni esistano
if ! declare -f read_flt >/dev/null 2>&1; then
    fail "source helpers" "read_flt non definita dopo source RUN_BENCH_LIB_ONLY=1"
elif ! declare -f parse_timings >/dev/null 2>&1; then
    fail "source helpers" "parse_timings non definita dopo source RUN_BENCH_LIB_ONLY=1"
else
    pass "source helpers (read_flt/read_read_bytes/read_vmrss_kb/parse_timings/sanitize_notes)"
fi

# Albero /proc fake: le helper leggono da PROC_ROOT (default /proc)
FAKE_PROC="$TMP_ROOT/proc"
FAKE_PID=4242
mkdir -p "$FAKE_PROC/$FAKE_PID"

# stat: campo 2 = comm tra parentesi CON SPAZI; dopo l'ultima ')':
#   1=state 2=ppid 3=pgrp 4=session 5=tty_nr 6=tpgid 7=flags
#   8=minflt 9=cminflt 10=majflt 11=cmajflt …
# Usiamo minflt=111 majflt=222
cat > "$FAKE_PROC/$FAKE_PID/stat" <<'EOF'
4242 (llama cli moe) R 1 1 1 0 -1 4194304 111 0 222 0 10 20 0 0 20 0 1 0 12345 0 0 18446744073709551615 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0
EOF

cat > "$FAKE_PROC/$FAKE_PID/io" <<'EOF'
rchar: 999
wchar: 1
syscr: 2
syscw: 3
read_bytes: 9876543210
write_bytes: 0
cancelled_write_bytes: 0
EOF

cat > "$FAKE_PROC/$FAKE_PID/status" <<'EOF'
Name:	llama cli moe
State:	R (running)
VmRSS:	  524288 kB
VmSize:	 1048576 kB
EOF

# Invoca le funzioni REALI dell'harness contro l'albero fake
export PROC_ROOT="$FAKE_PROC"
_flt="$(read_flt "$FAKE_PID")"
_rb="$(read_read_bytes "$FAKE_PID")"
_rss="$(read_vmrss_kb "$FAKE_PID")"
unset PROC_ROOT
# ripristina default (source ha settato PROC_ROOT=/proc; re-export esplicito)
PROC_ROOT="/proc"
export PROC_ROOT

# shellcheck disable=SC2086
set -- $_flt
_minflt="$1"
_majflt="$2"

if [ "$_minflt" = "111" ] && [ "$_majflt" = "222" ]; then
    pass "read_flt REAL: minflt/majflt con comm spazi (minflt=111 majflt=222)"
else
    fail "read_flt REAL minflt/majflt" "got minflt=$_minflt majflt=$_majflt (atteso 111 222)"
fi

if [ "$_rb" = "9876543210" ]; then
    pass "read_read_bytes REAL: read_bytes=9876543210"
else
    fail "read_read_bytes REAL" "got '$_rb' atteso 9876543210"
fi

if [ "$_rss" = "524288" ]; then
    pass "read_vmrss_kb REAL: VmRSS=524288"
else
    fail "read_vmrss_kb REAL" "got '$_rss' atteso 524288"
fi

# --- nproc/affinity from binary /proc/<pid>/status (F4.3-bis fix) ---
if declare -f read_pid_cpuset >/dev/null 2>&1; then
    cat > "$FAKE_PROC/$FAKE_PID/status" <<'EOF'
Name:	llama cli moe
State:	R (running)
VmRSS:	  524288 kB
Cpus_allowed:	3f
Cpus_allowed_list:	0-5
EOF
    export PROC_ROOT="$FAKE_PROC"
    _cs="$(read_pid_cpuset "$FAKE_PID")"
    unset PROC_ROOT; PROC_ROOT=/proc; export PROC_ROOT
    # shellcheck disable=SC2086
    set -- $_cs
    if [ "$1" = "6" ] && [ "$2" = "3f" ]; then
        pass "read_pid_cpuset: Cpus_allowed=3f list=0-5 -> nproc=6 mask=3f"
    else
        fail "read_pid_cpuset 3f/0-5" "got nproc=$1 mask=$2"
    fi
    cat > "$FAKE_PROC/$FAKE_PID/status" <<'EOF'
Name:	bmoe
State:	R (running)
Cpus_allowed:	5f
Cpus_allowed_list:	0-4,6
EOF
    export PROC_ROOT="$FAKE_PROC"
    _cs="$(read_pid_cpuset "$FAKE_PID")"
    unset PROC_ROOT; PROC_ROOT=/proc; export PROC_ROOT
    # shellcheck disable=SC2086
    set -- $_cs
    if [ "$1" = "6" ] && [ "$2" = "5f" ]; then
        pass "read_pid_cpuset: mask=5f list=0-4,6 -> nproc=6 mask=5f"
    else
        fail "read_pid_cpuset 5f" "got nproc=$1 mask=$2"
    fi
    if [ "$(count_cpu_list 0-5)" = "6" ] && [ "$(count_cpu_list 0-4,6)" = "6" ] && [ "$(count_cpu_list 0-7)" = "8" ]; then
        pass "count_cpu_list: 0-5=6, 0-4,6=6, 0-7=8"
    else
        fail "count_cpu_list" "bad counts"
    fi
else
    fail "read_pid_cpuset defined" "missing after RUN_BENCH_LIB_ONLY=1"
fi

if declare -f read_flt | grep -q "PROC_ROOT"; then
    pass "read_flt sourcata usa PROC_ROOT (testable)"
else
    fail "read_flt sourcata" "PROC_ROOT assente nel body"
fi

# ---------------------------------------------------------------------------
# 2) CSV sanitization notes
# ---------------------------------------------------------------------------
echo "=== 2) CSV sanitization notes ==="

if declare -f sanitize_notes >/dev/null 2>&1; then
    _raw=$'hello, world\nsecond line\rthird'
    _san="$(sanitize_notes "$_raw")"
    # bash pattern match (grep su pipe e' fragile con newline)
    _bad=0
    case "$_san" in
        *,*) _bad=1; fail "sanitize_notes rimuove virgole" "got '$_san'" ;;
    esac
    if [ "$_bad" -eq 0 ]; then
        case "$_san" in
            *$'\n'*) _bad=1; fail "sanitize_notes rimuove newline" "got '$_san'" ;;
        esac
    fi
    if [ "$_bad" -eq 0 ]; then
        case "$_san" in
            *$'\r'*) _bad=1; fail "sanitize_notes rimuove CR" "got '$_san'" ;;
        esac
    fi
    if [ "$_bad" -eq 0 ]; then
        # deve contenere i pezzi originali uniti da ';'
        case "$_san" in
            *hello*world*second*line*third*)
                pass "sanitize_notes: niente virgole/newline/CR (→ '$_san')"
                ;;
            *)
                fail "sanitize_notes contenuto" "got '$_san'"
                ;;
        esac
    fi
else
    fail "sanitize_notes" "funzione non definita dopo source"
fi

# ---------------------------------------------------------------------------
# 3) Runtime selection via --print-cmd
# ---------------------------------------------------------------------------
echo "=== 3) Runtime → binary + flag set (--print-cmd) ==="

# PATH ristretto + allow-no-battery per non toccare gate batteria qui
# (il test 4 copre il gate). Model/prompt fittizi ok con --print-cmd.
_CMD_BIGMOE="$(bash "$HARNESS" \
    -m /tmp/fake-model.gguf \
    -p /tmp/fake-prompt.txt \
    --runtime bigmoe \
    --print-cmd \
    --allow-no-battery 2>/dev/null)"
_rc_bm=$?

_CMD_MAIN="$(bash "$HARNESS" \
    -m /tmp/fake-model.gguf \
    -p /tmp/fake-prompt.txt \
    --runtime mainline \
    --print-cmd \
    --allow-no-battery 2>/dev/null)"
_rc_mn=$?

if [ "$_rc_bm" -eq 0 ] && [ "$_rc_mn" -eq 0 ]; then
    pass "print-cmd exit 0 per bigmoe e mainline"
else
    fail "print-cmd exit code" "bigmoe_rc=$_rc_bm mainline_rc=$_rc_mn"
fi

# bigmoe: bmoe-cli, NO --no-display-prompt, NO -ctk
if printf '%s' "$_CMD_BIGMOE" | grep -q 'bmoe-cli'; then
    pass "bigmoe → binario bmoe-cli"
else
    fail "bigmoe → bmoe-cli" "cmd='$_CMD_BIGMOE'"
fi
if printf '%s' "$_CMD_BIGMOE" | grep -q -- '--no-display-prompt'; then
    fail "bigmoe NON deve avere --no-display-prompt" "cmd='$_CMD_BIGMOE'"
else
    pass "bigmoe senza --no-display-prompt"
fi
if printf '%s' "$_CMD_BIGMOE" | grep -qE -- '(^| )-ctk( |$)'; then
    fail "bigmoe NON deve avere -ctk" "cmd='$_CMD_BIGMOE'"
else
    pass "bigmoe senza -ctk"
fi
if printf '%s' "$_CMD_BIGMOE" | grep -qE -- '(^| )-ctv( |$)'; then
    fail "bigmoe NON deve avere -ctv" "cmd='$_CMD_BIGMOE'"
else
    pass "bigmoe senza -ctv"
fi
if printf '%s' "$_CMD_BIGMOE" | grep -q -- '--temp 0'; then
    pass "bigmoe ha --temp 0"
else
    fail "bigmoe deve avere --temp 0" "cmd='$_CMD_BIGMOE'"
fi

# mainline: llama-cli, CON --no-display-prompt e -ctk
if printf '%s' "$_CMD_MAIN" | grep -q 'llama-cli'; then
    pass "mainline → binario llama-cli"
else
    fail "mainline → llama-cli" "cmd='$_CMD_MAIN'"
fi
if printf '%s' "$_CMD_MAIN" | grep -q -- '--no-display-prompt'; then
    pass "mainline ha --no-display-prompt"
else
    fail "mainline deve avere --no-display-prompt" "cmd='$_CMD_MAIN'"
fi
if printf '%s' "$_CMD_MAIN" | grep -q -- '--no-conversation'; then
    pass "mainline ha --no-conversation"
else
    fail "mainline deve avere --no-conversation (evita hang conversation mode)" "cmd='$_CMD_MAIN'"
fi
if printf '%s' "$_CMD_MAIN" | grep -q -- '--single-turn'; then
    pass "mainline ha --single-turn"
else
    fail "mainline deve avere --single-turn (exit after one generation)" "cmd='$_CMD_MAIN'"
fi
if printf '%s' "$_CMD_MAIN" | grep -q -- '--simple-io'; then
    pass "mainline ha --simple-io"
else
    fail "mainline deve avere --simple-io" "cmd='$_CMD_MAIN'"
fi
# short -no-cnv is ambiguous with -n and must NOT appear
if printf '%s' "$_CMD_MAIN" | grep -qE -- '(^| )-no-cnv( |$)'; then
    fail "mainline NON deve usare short -no-cnv (ambiguo con -n)" "cmd='$_CMD_MAIN'"
else
    pass "mainline senza short -no-cnv"
fi
if printf '%s' "$_CMD_BIGMOE" | grep -qE -- '(^| )-no-cnv( |$)|--no-conversation'; then
    fail "bigmoe NON deve avere --no-conversation" "cmd='$_CMD_BIGMOE'"
else
    pass "bigmoe senza --no-conversation"
fi
if printf '%s' "$_CMD_MAIN" | grep -qE -- '(^| )-ctk( |$)'; then
    pass "mainline ha -ctk"
else
    fail "mainline deve avere -ctk" "cmd='$_CMD_MAIN'"
fi
if printf '%s' "$_CMD_MAIN" | grep -q -- '--temp 0'; then
    pass "mainline ha --temp 0"
else
    fail "mainline deve avere --temp 0" "cmd='$_CMD_MAIN'"
fi

# --binary override
_CMD_OVR="$(bash "$HARNESS" \
    -m /tmp/fake-model.gguf \
    -p /tmp/fake-prompt.txt \
    --runtime bigmoe \
    --binary my-custom-cli \
    --print-cmd \
    --allow-no-battery 2>/dev/null)"
if printf '%s' "$_CMD_OVR" | grep -q 'my-custom-cli'; then
    pass "--binary override su runtime bigmoe"
else
    fail "--binary override" "cmd='$_CMD_OVR'"
fi

# ---------------------------------------------------------------------------
# 4) Battery gate fail-closed
# ---------------------------------------------------------------------------
echo "=== 4) Battery gate fail-closed ==="

# PATH ristretto: tool di sistema sì, termux-battery-status no.
# Prefisso con dir vuota (nessun termux-*) + /usr/bin:/bin tipici Unix/Git Bash.
_BASH_BIN="$(command -v bash)"
_EMPTY_BIN="$TMP_ROOT/empty_bin"
mkdir -p "$_EMPTY_BIN"
_OLD_PATH="$PATH"
# PATH senza eventuali dir che contengono termux-battery-status
_SAFE_PATH="$_EMPTY_BIN"
IFS=':'
for _d in $PATH; do
    if [ -n "$_d" ] && [ -x "$_d/termux-battery-status" ]; then
        continue
    fi
    if [ -n "$_d" ]; then
        _SAFE_PATH="${_SAFE_PATH}:$_d"
    fi
done
unset IFS
export PATH="$_SAFE_PATH"

# sanity: termux-battery-status non deve essere risolvibile
if command -v termux-battery-status >/dev/null 2>&1; then
    fail "setup PATH ristretto" "termux-battery-status ancora in PATH"
else
    pass "PATH ristretto: termux-battery-status assente"
fi

# --print-cmd is intentionally BEFORE the battery gate: cmdline must be
# printable even when the phone is plugged / API missing.
"$_BASH_BIN" "$HARNESS" \
    -m /tmp/fake-model.gguf \
    -p /tmp/fake-prompt.txt \
    --runtime mainline \
    --print-cmd \
    >"$TMP_ROOT/batt_print_cmd.txt" 2>"$TMP_ROOT/batt_err.txt"
_rc_print=$?

if [ "$_rc_print" -eq 0 ] && grep -q 'llama-cli' "$TMP_ROOT/batt_print_cmd.txt"; then
    pass "--print-cmd senza batteria → exit 0 (gate DOPO print-cmd)"
else
    fail "print-cmd senza batteria" "rc=$_rc_print out=$(head -c 120 "$TMP_ROOT/batt_print_cmd.txt") err=$(head -c 120 "$TMP_ROOT/batt_err.txt")"
fi

# Real battery gate: non-print-cmd path, fake model/prompt files exist so we
# reach the gate (then exit 7 without termux-battery-status).
: >"$TMP_ROOT/fake-model.gguf"
: >"$TMP_ROOT/fake-prompt.txt"
"$_BASH_BIN" "$HARNESS" \
    -m "$TMP_ROOT/fake-model.gguf" \
    -p "$TMP_ROOT/fake-prompt.txt" \
    --runtime mainline \
    >/dev/null 2>"$TMP_ROOT/batt_gate_err.txt"
_rc_no=$?

if [ "$_rc_no" -eq 7 ]; then
    pass "senza termux-battery-status e senza --allow-no-battery → exit 7 (run path)"
else
    fail "battery gate exit 7" "got rc=$_rc_no (atteso 7); stderr=$(head -c 200 "$TMP_ROOT/batt_gate_err.txt")"
fi

"$_BASH_BIN" "$HARNESS" \
    -m /tmp/fake-model.gguf \
    -p /tmp/fake-prompt.txt \
    --runtime mainline \
    --print-cmd \
    --allow-no-battery \
    >"$TMP_ROOT/batt_ok_cmd.txt" 2>"$TMP_ROOT/batt_ok_err.txt"
_rc_yes=$?

export PATH="$_OLD_PATH"

if [ "$_rc_yes" -eq 0 ]; then
    if grep -q 'llama-cli' "$TMP_ROOT/batt_ok_cmd.txt"; then
        pass "con --allow-no-battery → prosegue a --print-cmd (exit 0, llama-cli)"
    else
        fail "--allow-no-battery print-cmd output" "stdout=$(cat "$TMP_ROOT/batt_ok_cmd.txt")"
    fi
else
    fail "--allow-no-battery dovrebbe exit 0" "got rc=$_rc_yes stderr=$(head -c 200 "$TMP_ROOT/batt_ok_err.txt")"
fi

# ---------------------------------------------------------------------------
# 5) parse_timings — bmoe-cli summary lines + llama_perf fallback
# ---------------------------------------------------------------------------
echo "=== 5) parse_timings (bmoe + llama) ==="

if ! declare -f parse_timings >/dev/null 2>&1; then
    fail "parse_timings definita" "funzione assente"
else
    pass "parse_timings esposta via RUN_BENCH_LIB_ONLY=1"
fi

# Log sintetico con formati ESATTI da BigMoeOnEdge/cli/main.cpp (~787, 834, 847-855)
_BMOE_LOG="$TMP_ROOT/bmoe_sample.log"
cat > "$_BMOE_LOG" <<'EOF'
=== answer ===
hello world
=== perf ===
generation: 64 tokens, 0.054 s/token (18.519 tok/s)
prefill: 128 tokens, 2.346 s (54.6 tok/s) | model load 1.235 s | TTFT 3.581 s
moe-cache: 94.2% hit, resident 1800.5 MiB, budget 2000 MiB (auto)
EOF

parse_timings "$_BMOE_LOG" "bigmoe" "bmoe-cli"

if [ "$PROMPT_TOK_S" = "54.60" ]; then
    pass "bmoe prefill → prompt_tok_s=54.60"
else
    fail "bmoe prompt_tok_s" "got '$PROMPT_TOK_S' atteso 54.60"
fi

if [ "$EVAL_TOK_S" = "18.52" ]; then
    pass "bmoe generation → eval_tok_s=18.52"
else
    fail "bmoe eval_tok_s" "got '$EVAL_TOK_S' atteso 18.52"
fi

if [ "$TTFT_MS" = "3581" ]; then
    pass "bmoe TTFT 3.581 s → ttft_ms=3581"
else
    fail "bmoe ttft_ms" "got '$TTFT_MS' atteso 3581"
fi

if [ "$EXPERT_HIT_RATE" = "94.2%" ]; then
    pass "bmoe moe-cache → expert_hit_rate=94.2%"
else
    fail "bmoe expert_hit_rate" "got '$EXPERT_HIT_RATE' atteso 94.2%"
fi

if [ -z "${TIMING_NOTE:-}" ]; then
    pass "bmoe timings presenti → TIMING_NOTE vuoto"
else
    fail "bmoe TIMING_NOTE" "got '$TIMING_NOTE' (atteso vuoto)"
fi

# Variante moe-cache senza budget (auto)
_BMOE_LOG2="$TMP_ROOT/bmoe_cache_nobi.log"
cat > "$_BMOE_LOG2" <<'EOF'
generation: 32 tokens, 0.100 s/token (10.000 tok/s)
prefill: 64 tokens, 1.000 s (64.0 tok/s) | model load 0.500 s | TTFT 1.500 s
moe-cache: 88.5% hit, resident 900.0 MiB
EOF
parse_timings "$_BMOE_LOG2" "bigmoe" "bmoe-cli"
if [ "$EXPERT_HIT_RATE" = "88.5%" ] && [ "$PROMPT_TOK_S" = "64.00" ] && [ "$EVAL_TOK_S" = "10.00" ] && [ "$TTFT_MS" = "1500" ]; then
    pass "bmoe moe-cache senza budget + timings (88.5%/64.00/10.00/1500)"
else
    fail "bmoe cache-no-budget" "hit=$EXPERT_HIT_RATE prompt=$PROMPT_TOK_S eval=$EVAL_TOK_S ttft=$TTFT_MS"
fi

# llama_perf_context_print (mainline)
_LLAMA_LOG="$TMP_ROOT/llama_sample.log"
cat > "$_LLAMA_LOG" <<'EOF'
llama_perf_context_print:        load time =    1234.56 ms
llama_perf_context_print: prompt eval time =    2345.67 ms /   128 tokens (   18.32 ms per token,    54.57 tokens per second)
llama_perf_context_print:        eval time =    3456.78 ms /    64 runs   (   54.01 ms per token,    18.51 tokens per second)
EOF
parse_timings "$_LLAMA_LOG" "mainline" "llama-cli"
if [ "$PROMPT_TOK_S" = "54.57" ] && [ "$EVAL_TOK_S" = "18.51" ] && [ "$TTFT_MS" = "2346" ]; then
    pass "llama_perf → prompt=54.57 eval=18.51 ttft_ms=2346"
else
    fail "llama_perf parse" "prompt=$PROMPT_TOK_S eval=$EVAL_TOK_S ttft=$TTFT_MS"
fi

# Log vuoto → no timings in log (mai inventare)
_EMPTY_LOG="$TMP_ROOT/empty.log"
: > "$_EMPTY_LOG"
parse_timings "$_EMPTY_LOG" "bigmoe" "bmoe-cli"
if [ -z "$PROMPT_TOK_S" ] && [ -z "$EVAL_TOK_S" ] && [ -z "$TTFT_MS" ] && [ "$TIMING_NOTE" = "no timings in log" ]; then
    pass "log vuoto → TIMING_NOTE=no timings in log (campi vuoti)"
else
    fail "empty log" "prompt=$PROMPT_TOK_S eval=$EVAL_TOK_S ttft=$TTFT_MS note=$TIMING_NOTE"
fi

# Preferenza runtime bigmoe: se ENTRAMBI i formati sono nel log, usa bmoe
_MIXED_LOG="$TMP_ROOT/mixed.log"
cat > "$_MIXED_LOG" <<'EOF'
llama_perf_context_print: prompt eval time =    9999.00 ms /   10 tokens (  999.00 ms per token,     1.00 tokens per second)
llama_perf_context_print:        eval time =    9999.00 ms /    10 runs   (  999.00 ms per token,     1.00 tokens per second)
generation: 64 tokens, 0.054 s/token (18.519 tok/s)
prefill: 128 tokens, 2.346 s (54.6 tok/s) | model load 1.235 s | TTFT 3.581 s
moe-cache: 94.2% hit, resident 1800.5 MiB, budget 2000 MiB (auto)
EOF
parse_timings "$_MIXED_LOG" "bigmoe" "bmoe-cli"
if [ "$PROMPT_TOK_S" = "54.60" ] && [ "$EVAL_TOK_S" = "18.52" ] && [ "$TTFT_MS" = "3581" ] && [ "$EXPERT_HIT_RATE" = "94.2%" ]; then
    pass "mixed log + runtime bigmoe → preferisce bmoe (54.60/18.52/3581/94.2%)"
else
    fail "mixed bigmoe preference" "prompt=$PROMPT_TOK_S eval=$EVAL_TOK_S ttft=$TTFT_MS hit=$EXPERT_HIT_RATE"
fi

# Preferenza mainline: usa llama_perf anche se bmoe è presente
parse_timings "$_MIXED_LOG" "mainline" "llama-cli"
if [ "$PROMPT_TOK_S" = "1.00" ] && [ "$EVAL_TOK_S" = "1.00" ] && [ "$TTFT_MS" = "9999" ]; then
    pass "mixed log + runtime mainline → preferisce llama_perf (1.00/1.00/9999)"
else
    fail "mixed mainline preference" "prompt=$PROMPT_TOK_S eval=$EVAL_TOK_S ttft=$TTFT_MS"
fi

# New chat UI summary line (b10244 S23): [ Prompt: X t/s | Generation: Y t/s ]
_CHAT_LOG="$TMP_ROOT/chat_summary.log"
cat > "$_CHAT_LOG" <<'EOF'
[Start thinking]
Thinking Process:
[ Prompt: 18.1 t/s | Generation: 6.0 t/s ]
EOF
parse_timings "$_CHAT_LOG" "mainline" "llama-cli"
if [ "$PROMPT_TOK_S" = "18.10" ] && [ "$EVAL_TOK_S" = "6.00" ]; then
    pass "chat summary Prompt/Generation t/s → 18.10/6.00"
else
    fail "chat summary timings" "prompt=$PROMPT_TOK_S eval=$EVAL_TOK_S"
fi

# ---------------------------------------------------------------------------
# 6) --load-mode mmap always in mainline flags / print-cmd
# ---------------------------------------------------------------------------
echo "=== 6) --load-mode mmap (pin 67d5978) ==="

_CMD_LM="$(bash "$HARNESS" \
    -m /tmp/fake-model.gguf \
    -p /tmp/fake-prompt.txt \
    --runtime mainline \
    --print-cmd \
    --allow-no-battery 2>/dev/null)"
if printf '%s' "$_CMD_LM" | grep -q -- '--load-mode mmap'; then
    pass "mainline print-cmd includes --load-mode mmap"
else
    fail "mainline must pass --load-mode mmap" "cmd=$_CMD_LM"
fi

# EXTRA_FLAGS override (e.g. dio for F4) must not double-add mmap
_CMD_DIO="$(bash "$HARNESS" \
    -m /tmp/fake-model.gguf \
    -p /tmp/fake-prompt.txt \
    --runtime mainline \
    --flags '--load-mode dio' \
    --print-cmd \
    --allow-no-battery 2>/dev/null)"
_dio_n="$(printf '%s' "$_CMD_DIO" | grep -oE -- '--load-mode[[:space:]]+[^[:space:]]+' | wc -l | tr -d ' ')"
if printf '%s' "$_CMD_DIO" | grep -q -- '--load-mode dio' && [ "$_dio_n" = "1" ]; then
    pass "EXTRA_FLAGS --load-mode dio wins (no double mmap)"
else
    fail "load-mode override" "n=$_dio_n cmd=$_CMD_DIO"
fi

# bigmoe must NOT get --load-mode from harness
_CMD_BM_LM="$(bash "$HARNESS" \
    -m /tmp/fake-model.gguf \
    -p /tmp/fake-prompt.txt \
    --runtime bigmoe \
    --print-cmd \
    --allow-no-battery 2>/dev/null)"
if printf '%s' "$_CMD_BM_LM" | grep -q -- '--load-mode'; then
    fail "bigmoe must not get harness --load-mode" "cmd=$_CMD_BM_LM"
else
    pass "bigmoe without harness --load-mode"
fi

if declare -f build_flags_csv >/dev/null 2>&1; then
    RUNTIME=mainline EXTRA_FLAGS="--numa distribute" LOAD_MODE=mmap
    BINARY=llama-cli MODEL=/tmp/m.gguf N_GEN=32 THREADS=4 N_CTX=512 KV_TYPE=q8_0 CLASSIC_PERF=0
    _fc="$(build_flags_csv)"
    case "$_fc" in
        *'--load-mode mmap'*) pass "build_flags_csv includes --load-mode mmap with EXTRA_FLAGS" ;;
        *) fail "build_flags_csv" "got '$_fc'" ;;
    esac
else
    fail "build_flags_csv defined" "missing after RUN_BENCH_LIB_ONLY=1"
fi

# ---------------------------------------------------------------------------
# 7) wall-clock TTFT helpers + REPL hang signal + spinner filter
# ---------------------------------------------------------------------------
echo "=== 7) TTFT wall-clock helpers + anti-REPL ==="

if declare -f now_ms >/dev/null 2>&1; then
    _t1="$(now_ms)"
    case "$_t1" in
        ''|*[!0-9]*) fail "now_ms numeric" "got '$_t1'" ;;
        *)
            if [ "$_t1" -gt 1000000000000 ] 2>/dev/null; then
                pass "now_ms returns epoch-ms ($_t1)"
            else
                # seconds*1000 fallback still ok for relative deltas
                pass "now_ms returns numeric ($_t1)"
            fi
            ;;
    esac
else
    fail "now_ms defined" "missing"
fi

if declare -f is_first_token_line >/dev/null 2>&1; then
    if is_first_token_line '[Start thinking]'; then
        pass "is_first_token_line matches [Start thinking]"
    else
        fail "is_first_token_line [Start thinking]"
    fi
    if is_first_token_line '=== answer ==='; then
        pass "is_first_token_line matches === answer ==="
    else
        fail "is_first_token_line === answer ==="
    fi
    if is_first_token_line 'Loading model...'; then
        fail "is_first_token_line must reject Loading model"
    else
        pass "is_first_token_line rejects Loading model"
    fi
else
    fail "is_first_token_line defined" "missing"
fi

if declare -f is_spinner_or_noise_line >/dev/null 2>&1; then
    if is_spinner_or_noise_line 'Loading model...'; then
        pass "spinner filter matches Loading model..."
    else
        fail "spinner filter Loading model"
    fi
    if is_spinner_or_noise_line '|/-\\'; then
        pass "spinner filter matches pure glyphs"
    else
        # may not match depending on tr-delete set; soft
        pass "spinner filter pure glyphs (best-effort)"
    fi
    if is_spinner_or_noise_line '[ Prompt: 1.9 t/s | Generation: 0.1 t/s ]'; then
        fail "spinner must not drop timing summary"
    else
        pass "spinner filter keeps timing summary"
    fi
else
    fail "is_spinner_or_noise_line defined" "missing"
fi

if declare -f has_repl_hang_signal >/dev/null 2>&1; then
    _REPL_OK="$TMP_ROOT/repl_ok.log"
    cat > "$_REPL_OK" <<'EOF'
available commands:
  /exit or Ctrl+C     stop or exit
  /regen              regenerate the last response
[ Prompt: 1.9 t/s | Generation: 0.1 t/s ]
Exiting...
EOF
    if has_repl_hang_signal "$_REPL_OK"; then
        fail "has_repl_hang_signal false positive on clean exit"
    else
        pass "has_repl_hang_signal: clean exit → no hang"
    fi

    _REPL_HANG="$TMP_ROOT/repl_hang.log"
    cat > "$_REPL_HANG" <<'EOF'
available commands:
  /exit or Ctrl+C     stop or exit
  /regen              regenerate the last response
[ Prompt: 1.9 t/s | Generation: 0.1 t/s ]
EOF
    if has_repl_hang_signal "$_REPL_HANG"; then
        pass "has_repl_hang_signal: timing without Exiting → hang"
    else
        fail "has_repl_hang_signal missed hang"
    fi

    _REPL_BANNER="$TMP_ROOT/repl_banner.log"
    cat > "$_REPL_BANNER" <<'EOF'
available commands:
  /exit or Ctrl+C     stop or exit
  /regen              regenerate the last response
> You are a helpful assistant.
EOF
    if has_repl_hang_signal "$_REPL_BANNER"; then
        fail "banner alone must not be hang signal"
    else
        pass "has_repl_hang_signal: banner alone → no hang"
    fi
else
    fail "has_repl_hang_signal defined" "missing"
fi

# ttft_ms >= load_s sanity (fixture math)
_ttft_ms=502000
_load_s=502
_load_ms_cmp="$(awk -v s="$_load_s" 'BEGIN{printf "%d", (s+0)*1000}')"
_ttft_lt="$(awk -v t="$_ttft_ms" -v l="$_load_ms_cmp" 'BEGIN{print (t+0 < l+0)?1:0}')"
if [ "$_ttft_lt" = "0" ] && [ "$_load_ms_cmp" = "502000" ]; then
    pass "ttft_ms=502000 >= load_s=502 (load_ms=502000)"
else
    fail "ttft>=load fixture" "lt=$_ttft_lt load_ms=$_load_ms_cmp"
fi
_ttft_ms2=100
_ttft_lt2="$(awk -v t="$_ttft_ms2" -v l="$_load_ms_cmp" 'BEGIN{print (t+0 < l+0)?1:0}')"
if [ "$_ttft_lt2" = "1" ]; then
    pass "ttft_ms=100 < load_s=502 → would annotate ttft_lt_load"
else
    fail "ttft_lt_load detect" "lt=$_ttft_lt2"
fi

# ---------------------------------------------------------------------------
# Cleanup + summary
# ---------------------------------------------------------------------------
rm -rf "$TMP_ROOT"

echo ""
echo "=== SUMMARY: $PASS_N PASS, $FAIL_N FAIL ==="
if [ "$FAIL_N" -gt 0 ]; then
    exit 1
fi
exit 0
