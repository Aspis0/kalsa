#!/usr/bin/env bash
# =============================================================================
# test_isa_safe.sh — test fail-closed per ISA/path/preflight/run_bench gates
#
# Portabile bash 5.x / Termux / Git Bash. Niente telefono, niente modello, niente adb.
#
# Copre:
#   1) lib_isa_safe: ARM_ARCH grammar, path BUILD_DIR, reserved EXTRA_FLAGS
#   2) preflight_llama_isa: cache/compile_commands assenti, NATIVE=ON, arch bad
#   3) run_bench: PREFLIGHT_ISA invalido, EXTRA_FLAGS riservati, PREFLIGHT_ISA=0 su F1
#   4) path malformati / symlink binario (best-effort)
#
# Uso: bash scripts/test_isa_safe.sh
# Exit: 0 se tutti PASS, 1 se FAIL
# =============================================================================

set -o pipefail
export LC_ALL=C

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PREFLIGHT="$SCRIPT_DIR/preflight_llama_isa.sh"
HARNESS="$SCRIPT_DIR/run_bench.sh"
LIB="$SCRIPT_DIR/lib_isa_safe.sh"

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

expect_rc() {
    # expect_rc <label> <expected_rc> <cmd...>
    _lab="$1"
    _exp="$2"
    shift 2
    set +e
    "$@" >/dev/null 2>"$TMP_ROOT/err.txt"
    _got=$?
    set -e
    if [ "$_got" -eq "$_exp" ]; then
        pass "$_lab (rc=$_exp)"
    else
        fail "$_lab" "rc=$_got atteso $_exp; stderr=$(head -c 240 "$TMP_ROOT/err.txt" | tr '\n' ' ')"
    fi
}

TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/test_isa_safe.XXXXXX")"
trap 'rm -rf "$TMP_ROOT"' EXIT

echo "=== 0) prerequisiti file ==="
for f in "$LIB" "$PREFLIGHT" "$HARNESS"; do
    if [ -f "$f" ]; then
        pass "presente $(basename "$f")"
    else
        fail "presente $(basename "$f")" "manca $f"
    fi
done

# shellcheck disable=SC1090
source "$LIB"

echo "=== 1) ARM_ARCH grammar ==="
if isa_validate_arm_arch "armv8.2-a+dotprod+i8mm+fp16"; then
    pass "arch default S23 ok"
else
    fail "arch default S23"
fi
if isa_validate_arm_arch "armv8.2-a+dotprod+fp16"; then
    pass "arch portable (no i8mm) ok"
else
    fail "arch portable"
fi
if isa_validate_arm_arch "armv8.2-a"; then
    pass "arch base only ok"
else
    fail "arch base only"
fi
if ! isa_validate_arm_arch "armv8.2-a+sve" 2>/dev/null; then
    pass "rifiuta +sve"
else
    fail "rifiuta +sve" "accettato"
fi
if ! isa_validate_arm_arch "armv8.2-a+native" 2>/dev/null; then
    pass "rifiuta +native"
else
    fail "rifiuta +native"
fi
if ! isa_validate_arm_arch "native" 2>/dev/null; then
    pass "rifiuta native bare"
else
    fail "rifiuta native bare"
fi
if ! isa_validate_arm_arch "armv8.4-a+dotprod" 2>/dev/null; then
    pass "rifiuta armv8.4-a"
else
    fail "rifiuta armv8.4-a"
fi
if ! isa_validate_arm_arch "armv8.2-a+dotprod+dotprod" 2>/dev/null; then
    pass "rifiuta feature duplicata"
else
    fail "rifiuta feature duplicata"
fi
if ! isa_validate_arm_arch "armv8.2-a+crypto" 2>/dev/null; then
    pass "rifiuta token arbitrario +crypto"
else
    fail "rifiuta +crypto"
fi

echo "=== 2) resolve root / BUILD_DIR path safety ==="
_FAKE_ROOT="$TMP_ROOT/proj"
mkdir -p "$_FAKE_ROOT"
if isa_resolve_root "$_FAKE_ROOT"; then
    pass "resolve_root ok"
    _ROOT="$ISA_ROOT"
else
    fail "resolve_root"
    _ROOT=""
fi

if [ -n "$_ROOT" ]; then
    if isa_resolve_build_dir "$_ROOT" "build-safe"; then
        pass "BUILD_DIR relativo semplice"
    else
        fail "BUILD_DIR relativo semplice"
    fi
    if ! isa_resolve_build_dir "$_ROOT" "." 2>/dev/null; then
        pass "rifiuta BUILD_DIR=."
    else
        fail "rifiuta BUILD_DIR=."
    fi
    if ! isa_resolve_build_dir "$_ROOT" ".." 2>/dev/null; then
        pass "rifiuta BUILD_DIR=.."
    else
        fail "rifiuta BUILD_DIR=.."
    fi
    if ! isa_resolve_build_dir "$_ROOT" "" 2>/dev/null; then
        pass "rifiuta BUILD_DIR vuoto"
    else
        fail "rifiuta BUILD_DIR vuoto"
    fi
    if ! isa_resolve_build_dir "$_ROOT" "/tmp/evil" 2>/dev/null; then
        pass "rifiuta BUILD_DIR assoluto"
    else
        fail "rifiuta BUILD_DIR assoluto"
    fi
    if ! isa_resolve_build_dir "$_ROOT" "foo/bar" 2>/dev/null; then
        pass "rifiuta BUILD_DIR con slash"
    else
        fail "rifiuta BUILD_DIR con slash"
    fi
    if ! isa_assert_safe_rm_target "$_ROOT" "$_ROOT" 2>/dev/null; then
        pass "rifiuta rm -rf del root"
    else
        fail "rifiuta rm -rf del root"
    fi
    mkdir -p "$_ROOT/build-safe"
    if isa_assert_safe_rm_target "$_ROOT" "$_ROOT/build-safe"; then
        pass "permette rm -rf di build-safe sotto root"
    else
        fail "permette rm -rf di build-safe"
    fi
fi

echo "=== 3) reserved EXTRA_FLAGS ==="
if isa_check_reserved_extra_flags "--moe-stream --cache-mb 2000"; then
    pass "EXTRA_FLAGS runtime bigmoe ammessi"
else
    fail "EXTRA_FLAGS bigmoe ammessi"
fi
if ! isa_check_reserved_extra_flags "-m model.gguf" 2>/dev/null; then
    pass "rifiuta -m in EXTRA_FLAGS"
else
    fail "rifiuta -m"
fi
if ! isa_check_reserved_extra_flags "--temp 0" 2>/dev/null; then
    pass "rifiuta --temp in EXTRA_FLAGS"
else
    fail "rifiuta --temp"
fi
if ! isa_check_reserved_extra_flags "-n 64 -t 4" 2>/dev/null; then
    pass "rifiuta -n/-t in EXTRA_FLAGS"
else
    fail "rifiuta -n/-t"
fi
if ! isa_check_reserved_extra_flags "--no-display-prompt" 2>/dev/null; then
    pass "rifiuta --no-display-prompt in EXTRA_FLAGS"
else
    fail "rifiuta --no-display-prompt"
fi

echo "=== 4) preflight fail-closed (build-dir mode) ==="

# 4a) binario assente
expect_rc "preflight binario assente" 2 \
    bash "$PREFLIGHT" --binary "$TMP_ROOT/no-such-bin" --build-dir "$TMP_ROOT"

# 4b) binario non eseguibile (file regolare) — su alcuni FS Windows chmod -x è no-op
_BIN_NE="$TMP_ROOT/not_exec"
echo '#!/bin/sh' > "$_BIN_NE"
echo 'echo version 0' >> "$_BIN_NE"
chmod a-x "$_BIN_NE" 2>/dev/null || true
if [ -x "$_BIN_NE" ]; then
    pass "preflight binario non eseguibile: host ignora chmod -x (skip)"
else
    expect_rc "preflight binario non eseguibile" 2         bash "$PREFLIGHT" --binary "$_BIN_NE" --build-dir "$TMP_ROOT"
fi

# 4c) binario fake ok ma build-dir senza cache
_BIN_OK="$TMP_ROOT/fake-cli"
cat > "$_BIN_OK" <<'EOF'
#!/bin/sh
if [ "$1" = "--version" ] || [ "$1" = "--help" ] || [ "$1" = "-h" ]; then
    echo "version: fake (test)"
    exit 0
fi
echo "unexpected: $*" >&2
exit 1
EOF
chmod +x "$_BIN_OK"

_BD_EMPTY="$TMP_ROOT/build-empty"
mkdir -p "$_BD_EMPTY"
expect_rc "preflight senza CMakeCache" 3 \
    bash "$PREFLIGHT" --binary "$_BIN_OK" --build-dir "$_BD_EMPTY" --arm-arch "armv8.2-a+dotprod+i8mm+fp16"

# 4d) NATIVE=ON
_BD_BAD="$TMP_ROOT/build-native-on"
mkdir -p "$_BD_BAD"
cat > "$_BD_BAD/CMakeCache.txt" <<'EOF'
GGML_NATIVE:BOOL=ON
GGML_CPU_ARM_ARCH:STRING=armv8.2-a+dotprod+i8mm+fp16
CMAKE_EXPORT_COMPILE_COMMANDS:BOOL=ON
EOF
echo '[{"command":"cc -march=armv8.2-a+dotprod+i8mm+fp16 -c x.c"}]' > "$_BD_BAD/compile_commands.json"
expect_rc "preflight NATIVE=ON" 3 \
    bash "$PREFLIGHT" --binary "$_BIN_OK" --build-dir "$_BD_BAD" --arm-arch "armv8.2-a+dotprod+i8mm+fp16"

# 4e) arch vuota
_BD_NOARCH="$TMP_ROOT/build-noarch"
mkdir -p "$_BD_NOARCH"
cat > "$_BD_NOARCH/CMakeCache.txt" <<'EOF'
GGML_NATIVE:BOOL=OFF
GGML_CPU_ARM_ARCH:STRING=
CMAKE_EXPORT_COMPILE_COMMANDS:BOOL=ON
EOF
echo '[{"command":"cc -c x.c"}]' > "$_BD_NOARCH/compile_commands.json"
expect_rc "preflight arch vuota" 3 \
    bash "$PREFLIGHT" --binary "$_BIN_OK" --build-dir "$_BD_NOARCH" --arm-arch "armv8.2-a+dotprod+i8mm+fp16"

# 4f) compile_commands assente
_BD_NOCC="$TMP_ROOT/build-nocc"
mkdir -p "$_BD_NOCC"
cat > "$_BD_NOCC/CMakeCache.txt" <<'EOF'
GGML_NATIVE:BOOL=OFF
GGML_CPU_ARM_ARCH:STRING=armv8.2-a+dotprod+i8mm+fp16
CMAKE_EXPORT_COMPILE_COMMANDS:BOOL=OFF
EOF
expect_rc "preflight senza compile_commands.json" 3 \
    bash "$PREFLIGHT" --binary "$_BIN_OK" --build-dir "$_BD_NOCC" --arm-arch "armv8.2-a+dotprod+i8mm+fp16"

# 4g) mcpu=native in compile_commands
_BD_NATIVE_FLAG="$TMP_ROOT/build-mcpu-native"
mkdir -p "$_BD_NATIVE_FLAG"
cat > "$_BD_NATIVE_FLAG/CMakeCache.txt" <<'EOF'
GGML_NATIVE:BOOL=OFF
GGML_CPU_ARM_ARCH:STRING=armv8.2-a+dotprod+i8mm+fp16
CMAKE_EXPORT_COMPILE_COMMANDS:BOOL=ON
EOF
echo '[{"command":"cc -mcpu=native+dotprod -c x.c"}]' > "$_BD_NATIVE_FLAG/compile_commands.json"
expect_rc "preflight mcpu=native in compile_commands" 3 \
    bash "$PREFLIGHT" --binary "$_BIN_OK" --build-dir "$_BD_NATIVE_FLAG" --arm-arch "armv8.2-a+dotprod+i8mm+fp16"

# 4h) -march mismatch
_BD_MISMATCH="$TMP_ROOT/build-mismatch"
mkdir -p "$_BD_MISMATCH"
cat > "$_BD_MISMATCH/CMakeCache.txt" <<'EOF'
GGML_NATIVE:BOOL=OFF
GGML_CPU_ARM_ARCH:STRING=armv8.2-a+dotprod+i8mm+fp16
CMAKE_EXPORT_COMPILE_COMMANDS:BOOL=ON
EOF
echo '[{"command":"cc -march=armv8.2-a+dotprod -c x.c"}]' > "$_BD_MISMATCH/compile_commands.json"
expect_rc "preflight -march mismatch vs ARM_ARCH" 3 \
    bash "$PREFLIGHT" --binary "$_BIN_OK" --build-dir "$_BD_MISMATCH" --arm-arch "armv8.2-a+dotprod+i8mm+fp16"

# 4h2) many identical -march entries must NOT concat (regression: tr -d newline)
# On non-ARM hosts expect rc=4 (cpu features); never rc=3 from march concat.
_BD_MULTI="$TMP_ROOT/build-multi-march"
mkdir -p "$_BD_MULTI"
cat > "$_BD_MULTI/CMakeCache.txt" <<'EOF'
GGML_NATIVE:BOOL=OFF
GGML_CPU_ARM_ARCH:STRING=armv8.2-a+dotprod+i8mm+fp16
CMAKE_EXPORT_COMPILE_COMMANDS:BOOL=ON
EOF
python - <<'PY' > "$_BD_MULTI/compile_commands.json"
import json
m = "-march=armv8.2-a+dotprod+i8mm+fp16"
print(json.dumps([{"command": f"cc {m} -c x{i}.c"} for i in range(40)]))
PY
set +e
SKIP_VERSION=1 bash "$PREFLIGHT" --binary "$_BIN_OK" --build-dir "$_BD_MULTI" \
    --arm-arch "armv8.2-a+dotprod+i8mm+fp16" >"$TMP_ROOT/multi.out" 2>"$TMP_ROOT/multi.err"
_rc=$?
set -e
if grep -E 'march inatteso.*-march=.*-march=' "$TMP_ROOT/multi.err" >/dev/null 2>&1; then
    fail "preflight multi-entry -march concat" "rc=$_rc concatenated -march in stderr"
elif grep -E 'OK: -march matcha ARM_ARCH' "$TMP_ROOT/multi.out" >/dev/null 2>&1 \
    && { [ "$_rc" -eq 0 ] || [ "$_rc" -eq 4 ]; }; then
    pass "preflight multi-entry compile_commands same -march (rc=$_rc)"
else
    fail "preflight multi-entry -march" "rc=$_rc out=$(tr '\n' ' ' <"$TMP_ROOT/multi.out" | head -c 200) err=$(tr '\n' ' ' <"$TMP_ROOT/multi.err" | head -c 200)"
fi

# 4i) ARM_ARCH non grammar
expect_rc "preflight ARM_ARCH con sve" 3 \
    bash "$PREFLIGHT" --binary "$_BIN_OK" --build-dir "$_BD_BAD" --arm-arch "armv8.2-a+sve"

# 4j) symlink binario → target non eseguibile / rotto
_BIN_LINK="$TMP_ROOT/link-cli"
if ln -s "$TMP_ROOT/no-such-target" "$_BIN_LINK" 2>/dev/null && [ -L "$_BIN_LINK" ]; then
    # su host che supportano symlink veri
    set +e
    bash "$PREFLIGHT" --binary "$_BIN_LINK" >/dev/null 2>"$TMP_ROOT/err.txt"
    _rc=$?
    set -e
    if [ "$_rc" -eq 2 ]; then
        pass "preflight symlink rotto → rc=2"
    else
        # alcuni FS Windows trattano ln -s come copy/junction
        if [ -e "$_BIN_LINK" ]; then
            pass "preflight symlink: host non crea symlink reali (skip soft)"
        else
            fail "preflight symlink rotto" "rc=$_rc"
        fi
    fi
else
    pass "preflight symlink: non supportato su host (skip)"
fi

# 4k) helper assente non testabile qui (file c'è); binary-only mode senza build-dir
#     deve poter passare se SKIP_VERSION=1 e binario ok (senza cpu check hard)
set +e
SKIP_VERSION=1 bash "$PREFLIGHT" --binary "$_BIN_OK" >/dev/null 2>"$TMP_ROOT/err.txt"
_rc=$?
set -e
if [ "$_rc" -eq 0 ]; then
    pass "binary-only mode (SKIP_VERSION=1) exit 0"
else
    fail "binary-only mode" "rc=$_rc stderr=$(head -c 200 "$TMP_ROOT/err.txt" | tr '\n' ' ')"
fi

echo "=== 5) run_bench PREFLIGHT_ISA / EXTRA_FLAGS ==="

# PATH ristretto senza termux-battery-status
_EMPTY_BIN="$TMP_ROOT/empty_bin"
mkdir -p "$_EMPTY_BIN"
# metti fake llama-cli in PATH per i test che superano print-cmd
_FAKE_PATH_BIN="$TMP_ROOT/pathbin"
mkdir -p "$_FAKE_PATH_BIN"
cp "$_BIN_OK" "$_FAKE_PATH_BIN/llama-cli"
chmod +x "$_FAKE_PATH_BIN/llama-cli"

_SAFE_PATH="$_EMPTY_BIN:$_FAKE_PATH_BIN"
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

_MODEL="$TMP_ROOT/fake.gguf"
_PROMPT="$TMP_ROOT/prompt.txt"
echo 'fake-gguf' > "$_MODEL"
echo 'hello' > "$_PROMPT"

_BASH="$(command -v bash)"
_OLD_PATH="$PATH"
export PATH="$_SAFE_PATH"

# 5a) PREFLIGHT_ISA invalido
set +e
PREFLIGHT_ISA=maybe "$_BASH" "$HARNESS" \
    -m "$_MODEL" -p "$_PROMPT" --runtime mainline --print-cmd --allow-no-battery \
    >/dev/null 2>"$TMP_ROOT/err.txt"
_rc=$?
set -e
if [ "$_rc" -eq 3 ]; then
    pass "run_bench PREFLIGHT_ISA invalido → exit 3"
else
    fail "PREFLIGHT_ISA invalido" "rc=$_rc"
fi

# 5b) EXTRA_FLAGS riservati via --flags
set +e
"$_BASH" "$HARNESS" \
    -m "$_MODEL" -p "$_PROMPT" --runtime mainline \
    --flags "-m other.gguf" \
    --print-cmd --allow-no-battery \
    >/dev/null 2>"$TMP_ROOT/err.txt"
_rc=$?
set -e
if [ "$_rc" -eq 3 ]; then
    pass "run_bench --flags '-m …' → exit 3"
else
    fail "EXTRA_FLAGS -m" "rc=$_rc stderr=$(head -c 200 "$TMP_ROOT/err.txt" | tr '\n' ' ')"
fi

set +e
"$_BASH" "$HARNESS" \
    -m "$_MODEL" -p "$_PROMPT" --runtime mainline \
    --flags "--temp 0.9" \
    --print-cmd --allow-no-battery \
    >/dev/null 2>"$TMP_ROOT/err.txt"
_rc=$?
set -e
if [ "$_rc" -eq 3 ]; then
    pass "run_bench --flags '--temp …' → exit 3"
else
    fail "EXTRA_FLAGS --temp" "rc=$_rc"
fi

# 5c) --flags ammessi (print-cmd)
set +e
_out="$("$_BASH" "$HARNESS" \
    -m "$_MODEL" -p "$_PROMPT" --runtime bigmoe \
    --flags "--moe-stream --cache-mb 2000" \
    --print-cmd --allow-no-battery 2>/dev/null)"
_rc=$?
set -e
if [ "$_rc" -eq 0 ] && printf '%s' "$_out" | grep -q 'moe-stream'; then
    pass "run_bench --flags bigmoe ammessi in print-cmd"
else
    fail "flags bigmoe ammessi" "rc=$_rc out=$_out"
fi

# 5d) PREFLIGHT_ISA=0 su fase F1 → rifiuto (serve binario, no print-cmd)
#     senza print-cmd: passa battery (allow), trova binario, poi gate preflight
set +e
PREFLIGHT_ISA=0 "$_BASH" "$HARNESS" \
    -m "$_MODEL" -p "$_PROMPT" \
    --phase F1 --runtime mainline \
    --allow-no-battery \
    >/dev/null 2>"$TMP_ROOT/err.txt"
_rc=$?
set -e
if [ "$_rc" -eq 6 ]; then
    pass "run_bench PREFLIGHT_ISA=0 + phase F1 → exit 6"
else
    fail "PREFLIGHT_ISA=0 F1" "rc=$_rc stderr=$(head -c 300 "$TMP_ROOT/err.txt" | tr '\n' ' ')"
fi

# 5e) PREFLIGHT_ISA=auto + F2 senza CMakeCache → exit 6
set +e
PREFLIGHT_ISA=auto "$_BASH" "$HARNESS" \
    -m "$_MODEL" -p "$_PROMPT" \
    --phase F2 --runtime mainline \
    --allow-no-battery \
    >/dev/null 2>"$TMP_ROOT/err.txt"
_rc=$?
set -e
if [ "$_rc" -eq 6 ]; then
    pass "run_bench F2 senza provenance CMakeCache → exit 6"
else
    fail "F2 no cache" "rc=$_rc stderr=$(head -c 300 "$TMP_ROOT/err.txt" | tr '\n' ' ')"
fi

# 5f) helper preflight assente: simula con PATH + PREFLIGHT forzato spostando script
#     (non spostiamo file repo: verifichiamo che run_bench fallisca se script non trovato
#      via env che non possiamo facilmente mockare — check statico del codice)
if grep -q 'preflight_llama_isa.sh assente' "$HARNESS"; then
    pass "run_bench ha fail-closed se helper assente (codice)"
else
    fail "run_bench helper assente fail-closed" "stringa assente in run_bench.sh"
fi

export PATH="$_OLD_PATH"

echo "=== 6) bash -n syntax ==="
for f in \
    "$LIB" \
    "$PREFLIGHT" \
    "$SCRIPT_DIR/build_llama_termux.sh" \
    "$SCRIPT_DIR/build_bmoe_termux.sh" \
    "$HARNESS" \
    "$SCRIPT_DIR/test_isa_safe.sh"
do
    if bash -n "$f" 2>"$TMP_ROOT/syn.txt"; then
        pass "bash -n $(basename "$f")"
    else
        fail "bash -n $(basename "$f")" "$(cat "$TMP_ROOT/syn.txt")"
    fi
done

echo ""
echo "=== SUMMARY: $PASS_N PASS, $FAIL_N FAIL ==="
if [ "$FAIL_N" -gt 0 ]; then
    exit 1
fi
exit 0
