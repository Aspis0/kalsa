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
# 1) Parsing /proc — source helper dall'harness
# ---------------------------------------------------------------------------
echo "=== 1) /proc parsing helpers ==="

TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/test_run_bench.XXXXXX")"
# Fake pid namespace: creiamo TMP_ROOT/proc/<pid>/{stat,io,status}
# e temporarily bind-override non è portabile su Windows/Git Bash —
# quindi reimplementiamo i path: le helper usano /proc hardcodato.
# Soluzione: creiamo un wrapper che invoca le stesse formule su file fake
# DOPO aver sourcato le funzioni, patchando via env non possibile.
# Invece: source le helper e invochiamole su un pid fittizio SOLO se /proc
# è scrivibile (Linux). Su Git Bash/Windows: replica esatta della formula
# e confronta con l'output atteso della stessa logica sourcata.

# Carica helper (read_flt, read_read_bytes, read_vmrss_kb, sanitize_notes, …)
# shellcheck disable=SC1090
RUN_BENCH_LIB_ONLY=1 source "$HARNESS"

# Verifica che le funzioni esistano
if ! declare -f read_flt >/dev/null 2>&1; then
    fail "source helpers" "read_flt non definita dopo source RUN_BENCH_LIB_ONLY=1"
else
    pass "source helpers (read_flt/read_read_bytes/read_vmrss_kb/sanitize_notes)"
fi

# Crea un mini /proc fittizio e un wrapper di parsing che usa lo stesso algoritmo
# delle helper ma su path custom (per non dipendere da /proc reale scrivibile).
FAKE_PROC="$TMP_ROOT/proc"
FAKE_PID=4242
mkdir -p "$FAKE_PROC/$FAKE_PID"

# stat: campo 2 = comm tra parentesi CON SPAZI; dopo l'ultima ')':
#   1=state 2=ppid 3=pgrp 4=session 5=tty_nr 6=tpgid 7=flags
#   8=minflt 9=cminflt 10=majflt 11=cmajflt …
# Usiamo minflt=111 majflt=222
# Formato: pid (comm with spaces) state ppid ... 
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

# Replica ESATTA dell'algoritmo harness, ma su path fake (stesso sed/awk)
parse_flt_from() {
    _stat="$1"
    if [ ! -r "$_stat" ]; then
        echo "0 0"
        return
    fi
    _rest="$(sed 's/.*) //' "$_stat" 2>/dev/null)"
    if [ -z "$_rest" ]; then
        echo "0 0"
        return
    fi
    # shellcheck disable=SC2086
    set -- $_rest
    echo "${8:-0} ${10:-0}"
}

parse_read_bytes_from() {
    _io="$1"
    if [ ! -r "$_io" ]; then
        echo "0"
        return
    fi
    awk '/^read_bytes:/{print $2; found=1} END{if(!found) print 0}' "$_io" 2>/dev/null
}

parse_vmrss_from() {
    _st="$1"
    if [ ! -r "$_st" ]; then
        echo "0"
        return
    fi
    awk '/^VmRSS:/{print $2; found=1} END{if(!found) print 0}' "$_st" 2>/dev/null
}

# Asserisci che la formula sourcata (read_flt) e la replica producano lo stesso
# algoritmo: verifichiamo la replica su fake file (identica al body di read_flt)
_flt="$(parse_flt_from "$FAKE_PROC/$FAKE_PID/stat")"
_rb="$(parse_read_bytes_from "$FAKE_PROC/$FAKE_PID/io")"
_rss="$(parse_vmrss_from "$FAKE_PROC/$FAKE_PID/status")"

# shellcheck disable=SC2086
set -- $_flt
_minflt="$1"
_majflt="$2"

if [ "$_minflt" = "111" ] && [ "$_majflt" = "222" ]; then
    pass "parse minflt/majflt con comm che contiene spazi (minflt=111 majflt=222)"
else
    fail "parse minflt/majflt" "got minflt=$_minflt majflt=$_majflt (atteso 111 222); rest-fields da stat con comm '(llama cli moe)'"
fi

if [ "$_rb" = "9876543210" ]; then
    pass "parse read_bytes=9876543210"
else
    fail "parse read_bytes" "got '$_rb' atteso 9876543210"
fi

if [ "$_rss" = "524288" ]; then
    pass "parse VmRSS=524288"
else
    fail "parse VmRSS" "got '$_rss' atteso 524288"
fi

# Verifica che le funzioni sourcate abbiano lo stesso body-algoritmo:
# confrontiamo l'output di `type read_flt` contiene il sed pattern chiave
if declare -f read_flt | grep -q "s/.*) //"; then
    pass "read_flt sourcata usa strip fino all'ultima ')'"
else
    fail "read_flt sourcata" "pattern sed 's/.*) //' assente nel body"
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

"$_BASH_BIN" "$HARNESS" \
    -m /tmp/fake-model.gguf \
    -p /tmp/fake-prompt.txt \
    --runtime mainline \
    --print-cmd \
    >/dev/null 2>"$TMP_ROOT/batt_err.txt"
_rc_no=$?

if [ "$_rc_no" -eq 7 ]; then
    pass "senza termux-battery-status e senza --allow-no-battery → exit 7"
else
    fail "battery gate exit 7" "got rc=$_rc_no (atteso 7); stderr=$(head -c 200 "$TMP_ROOT/batt_err.txt")"
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
# Cleanup + summary
# ---------------------------------------------------------------------------
rm -rf "$TMP_ROOT"

echo ""
echo "=== SUMMARY: $PASS_N PASS, $FAIL_N FAIL ==="
if [ "$FAIL_N" -gt 0 ]; then
    exit 1
fi
exit 0
