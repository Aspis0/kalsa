#!/usr/bin/env bash
# =============================================================================
# preflight_llama_isa.sh — verifica ISA/build SICURA prima di qualsiasi run -m
#
# Scopo (fail-closed con --build-dir):
#   1) binario = file regolare eseguibile (symlink risolti; mai chmod)
#   2) CMakeCache leggibile: GGML_NATIVE=OFF + GGML_CPU_ARM_ARCH esplicito match
#   3) compile_commands.json (o CMAKE_EXPORT_COMPILE_COMMANDS) ispezionato:
#      vietati -mcpu=native / -march=native / +sve / +sme; -march deve matchare
#   4) /proc/cpuinfo leggibile: feature richieste da ARM_ARCH (dotprod/i8mm/fp16)
#   5) scan statico istruzioni vietate → FAIL (non warning)
#   6) --version only (MAI -m); exit 0 atteso
#
# Modalità:
#   --build-dir DIR   → controlli completi (OBBLIGATORIO per run scientifici)
#   solo --binary     → binary-only (meno controlli; NON usabile da run_bench F1–F4)
#
# Uso:
#   bash scripts/preflight_llama_isa.sh \
#     --binary ~/src/llama.cpp/build-safe/bin/llama-cli \
#     --build-dir ~/src/llama.cpp/build-safe \
#     --arm-arch armv8.2-a+dotprod+i8mm+fp16
#
# Exit: 0=ok · 1=usage · 2=binario · 3=ISA/build unsafe · 4=cpu features
# =============================================================================

set -euo pipefail
export LC_ALL=C

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib_isa_safe.sh"

BINARY=""
BUILD_DIR=""
ARM_ARCH=""
SKIP_VERSION="${SKIP_VERSION:-0}"
# binary-only: senza --build-dir (meno controlli)
BINARY_ONLY=0

usage() {
    cat <<'EOF' >&2
Uso: preflight_llama_isa.sh --binary PATH [--build-dir DIR] [--arm-arch STR]

Con --build-dir: fail-closed su cache/compile_commands/cpuinfo/ISA.
Senza --build-dir: binary-only (solo binario + --version); non per F1–F4.

Env:
  SKIP_VERSION=1   non eseguire --version (solo static)
EOF
}

while [ $# -gt 0 ]; do
    case "$1" in
        --binary|-b)
            BINARY="${2:-}"
            shift 2
            ;;
        --build-dir)
            BUILD_DIR="${2:-}"
            shift 2
            ;;
        --arm-arch)
            ARM_ARCH="${2:-}"
            shift 2
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo "ERRORE: arg sconosciuto: $1" >&2
            usage
            exit 1
            ;;
    esac
done

if [ -z "$BINARY" ]; then
    echo "ERRORE: --binary obbligatorio" >&2
    usage
    exit 1
fi

if [ -z "$BUILD_DIR" ]; then
    BINARY_ONLY=1
fi

echo "=== preflight_llama_isa ==="
echo "binary=$BINARY"
echo "build_dir=${BUILD_DIR:-<binary-only>}"
echo "arm_arch=${ARM_ARCH:-<none>}"
if [ "$BINARY_ONLY" -eq 1 ]; then
    echo "MODE: binary-only (NON valido per run scientifici F1–F4)"
fi

_fail=0
_cpu_rc=0
_build_fail=0

# ---------------------------------------------------------------------------
# 0) ARM_ARCH grammar (se fornita)
# ---------------------------------------------------------------------------
if [ -n "$ARM_ARCH" ]; then
    if ! isa_validate_arm_arch "$ARM_ARCH"; then
        _fail=1
        _build_fail=1  # grammar ISA = errore di config, non CPU
    else
        echo "OK: ARM_ARCH grammar ($ARM_ARCH)"
    fi
fi

# ---------------------------------------------------------------------------
# 1) Binary: regolare, eseguibile; risolve symlink; MAI chmod
# ---------------------------------------------------------------------------
if [ ! -e "$BINARY" ]; then
    echo "FAIL: binario assente: $BINARY" >&2
    exit 2
fi

# Risolvi symlink → target reale
_bin_resolved="$BINARY"
if [ -L "$BINARY" ]; then
    _bin_resolved="$(isa_realpath "$BINARY")"
    if [ -z "$_bin_resolved" ] || [ ! -e "$_bin_resolved" ]; then
        echo "FAIL: symlink binario non risolvibile: $BINARY" >&2
        exit 2
    fi
    echo "INFO: symlink $BINARY → $_bin_resolved"
fi

# Deve essere file regolare (non dir, non pipe)
if [ ! -f "$_bin_resolved" ]; then
    echo "FAIL: binario non è un file regolare: $_bin_resolved" >&2
    exit 2
fi
if [ ! -x "$_bin_resolved" ]; then
    echo "FAIL: binario non eseguibile: $_bin_resolved (nessun chmod automatico)" >&2
    exit 2
fi
BINARY="$_bin_resolved"
_bindir="$(cd "$(dirname "$BINARY")" && pwd -P)"
export LD_LIBRARY_PATH="${_bindir}${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
echo "OK: binario regolare eseguibile ($BINARY)"

# ---------------------------------------------------------------------------
# 2) Build-dir mode: fail-closed su cache + compile_commands + logs
# ---------------------------------------------------------------------------
if [ "$BINARY_ONLY" -eq 0 ]; then
    if [ ! -d "$BUILD_DIR" ]; then
        echo "FAIL: build-dir assente o non directory: $BUILD_DIR" >&2
        exit 3
    fi
    BUILD_DIR="$(cd "$BUILD_DIR" && pwd -P)" || {
        echo "FAIL: impossibile risolvere build-dir" >&2
        exit 3
    }

    CACHE="$BUILD_DIR/CMakeCache.txt"
    if [ ! -f "$CACHE" ] || [ ! -r "$CACHE" ]; then
        echo "FAIL: CMakeCache.txt assente/non leggibile in $BUILD_DIR" >&2
        echo "      serve provenance di build (GGML_NATIVE=OFF + arch esplicita)" >&2
        exit 3
    fi

    # strip CR (CMakeCache scritto su Windows / mount misto)
    _native="$(grep -E '^GGML_NATIVE:BOOL=' "$CACHE" | head -n1 | tr -d '\r' || true)"
    _arch="$(grep -E '^GGML_CPU_ARM_ARCH:STRING=' "$CACHE" | head -n1 | tr -d '\r' || true)"
    _export_cc="$(grep -E '^CMAKE_EXPORT_COMPILE_COMMANDS:BOOL=' "$CACHE" | head -n1 | tr -d '\r' || true)"
    echo "cache: $_native"
    echo "cache: $_arch"

    if [ "$_native" != "GGML_NATIVE:BOOL=OFF" ]; then
        echo "FAIL: GGML_NATIVE deve essere OFF (got: ${_native:-<missing>})" >&2
        echo "      rebuild: scripts/build_llama_termux.sh / build_bmoe_termux.sh" >&2
        _fail=1
    else
        echo "OK: GGML_NATIVE=OFF"
    fi

    if [ -z "$_arch" ] || [ "$_arch" = "GGML_CPU_ARM_ARCH:STRING=" ]; then
        echo "FAIL: GGML_CPU_ARM_ARCH assente o vuoto in CMakeCache" >&2
        _fail=1
    else
        _cache_arch="${_arch#GGML_CPU_ARM_ARCH:STRING=}"
        if ! isa_validate_arm_arch "$_cache_arch"; then
            echo "FAIL: arch in cache non nella grammar sicura: $_cache_arch" >&2
            _fail=1
        fi
        # Compare arch values (not full cache key line) after CR strip above.
        if [ -n "$ARM_ARCH" ] && [ "$_cache_arch" != "$ARM_ARCH" ]; then
            echo "FAIL: arch cache ($_cache_arch) != richiesta ($ARM_ARCH)" >&2
            _fail=1
        else
            # se ARM_ARCH non passato, usa quella in cache per check successivi
            if [ -z "$ARM_ARCH" ]; then
                ARM_ARCH="$_cache_arch"
            fi
            echo "OK: GGML_CPU_ARM_ARCH=$_cache_arch"
        fi
    fi

    # CMAKE_EXPORT_COMPILE_COMMANDS / compile_commands.json obbligatori
    CCJSON="$BUILD_DIR/compile_commands.json"
    if [ ! -f "$CCJSON" ] || [ ! -r "$CCJSON" ]; then
        echo "FAIL: compile_commands.json assente/non leggibile in $BUILD_DIR" >&2
        echo "      rebuild con -DCMAKE_EXPORT_COMPILE_COMMANDS=ON" >&2
        if [ -n "$_export_cc" ]; then
            echo "      cache: $_export_cc" >&2
        fi
        _fail=1
    else
        echo "OK: compile_commands.json presente"
        if grep -E 'mcpu=native|march=native' "$CCJSON" >/dev/null 2>&1; then
            echo "FAIL: compile_commands.json contiene mcpu/march=native" >&2
            grep -oE '(-mcpu=native[^" ]*|-march=native[^" ]*)' "$CCJSON" | sort -u | head -n 20 >&2 || true
            _fail=1
        fi
        if grep -E '\+sve|\+sme|-march=[^" ]*sve|-march=[^" ]*sme|-mcpu=[^" ]*sve|-mcpu=[^" ]*sme' "$CCJSON" >/dev/null 2>&1; then
            echo "FAIL: compile_commands.json abilita sve/sme" >&2
            _fail=1
        fi
        # -march effettivi devono matchare ARM_ARCH se presente.
        # Keep newlines so sort -u dedupes lines; never tr -d '\n' (that
        # concatenates hundreds of identical -march tokens into one string).
        _marches="$(grep -oE -- '-march=[^" ]+' "$CCJSON" 2>/dev/null | tr -d '\r' | sort -u || true)"
        if [ -z "$_marches" ]; then
            echo "FAIL: nessun -march= in compile_commands.json" >&2
            _fail=1
        else
            echo "compile flags -march:"
            printf '%s\n' "$_marches" | sed 's/^/  /'
            if [ -n "$ARM_ARCH" ]; then
                _expected="-march=$ARM_ARCH"
                _match=0
                while IFS= read -r _m; do
                    [ -z "$_m" ] && continue
                    if [ "$_m" = "$_expected" ]; then
                        _match=1
                    else
                        # qualsiasi -march diverso dall'atteso è FAIL
                        echo "FAIL: -march inatteso '$_m' (atteso $_expected)" >&2
                        _fail=1
                    fi
                done <<EOF
$_marches
EOF
                if [ "$_match" -eq 0 ]; then
                    echo "FAIL: -march=$ARM_ARCH assente in compile_commands.json" >&2
                    _fail=1
                else
                    echo "OK: -march matcha ARM_ARCH ($ARM_ARCH)"
                fi
            fi
        fi
    fi

    # Configure / cmake logs
    for log in \
        "$BUILD_DIR/cmake-configure.log" \
        "$BUILD_DIR/CMakeFiles/CMakeConfigureLog.yaml"
    do
        if [ -f "$log" ]; then
            if grep -E 'Illegal instruction|SIGILL' "$log" >/dev/null 2>&1; then
                echo "FAIL: $log contiene Illegal instruction/SIGILL" >&2
                grep -nE 'Illegal instruction|SIGILL|GGML_MACHINE_SUPPORTS_sve|GGML_MACHINE_SUPPORTS_sme|mcpu=native' "$log" | head -n 15 >&2 || true
                _fail=1
            fi
            if grep -E 'mcpu=native|march=native' "$log" >/dev/null 2>&1; then
                echo "FAIL: $log usa mcpu/march=native" >&2
                grep -nE 'mcpu=native|march=native' "$log" | head -n 10 >&2 || true
                _fail=1
            fi
        fi
    done
    # qualsiasi fail sollevato in questo blocco è provenance/build (exit 3 > exit 4)
    if [ "$_fail" -ne 0 ]; then
        # se l'unico fail era ARM_ARCH grammar pre-blocco, resta 3 comunque in build-dir mode
        _build_fail=1
    fi
fi

# ---------------------------------------------------------------------------
# 3) CPU features: solo quelle richieste da ARM_ARCH; /proc obbligatorio
#    in build-dir mode (scientifico)
# ---------------------------------------------------------------------------
if [ -r /proc/cpuinfo ]; then
    _feat="$(grep -m1 '^Features' /proc/cpuinfo || true)"
    echo "cpu Features: $_feat"
    if [ -n "$ARM_ARCH" ]; then
        # dotprod → asimddp
        if printf '%s' "$ARM_ARCH" | grep -E 'dotprod' >/dev/null 2>&1; then
            if ! printf '%s\n' "$_feat" | grep -E '(^| )asimddp( |$)' >/dev/null 2>&1; then
                echo "FAIL: ARM_ARCH richiede dotprod ma CPU senza asimddp" >&2
                _fail=1
                _cpu_rc=4
            else
                echo "OK: asimddp (dotprod) in /proc/cpuinfo"
            fi
        fi
        if printf '%s' "$ARM_ARCH" | grep -E 'i8mm' >/dev/null 2>&1; then
            if ! printf '%s\n' "$_feat" | grep -E '(^| )i8mm( |$)' >/dev/null 2>&1; then
                echo "FAIL: ARM_ARCH richiede i8mm ma /proc/cpuinfo non lo ha" >&2
                _fail=1
                _cpu_rc=4
            else
                echo "OK: i8mm in /proc/cpuinfo"
            fi
        fi
        if printf '%s' "$ARM_ARCH" | grep -E 'fp16' >/dev/null 2>&1; then
            # fp16 half-precision: fphp o asimdhp tipici
            if ! printf '%s\n' "$_feat" | grep -E '(^| )(fphp|asimdhp)( |$)' >/dev/null 2>&1; then
                echo "FAIL: ARM_ARCH richiede fp16 ma CPU senza fphp/asimdhp" >&2
                _fail=1
                _cpu_rc=4
            else
                echo "OK: fp16 (fphp/asimdhp) in /proc/cpuinfo"
            fi
        fi
    fi
else
    if [ "$BINARY_ONLY" -eq 0 ]; then
        echo "FAIL: /proc/cpuinfo non leggibile (obbligatorio con --build-dir)" >&2
        _fail=1
        _cpu_rc=4
    else
        echo "AVVISO: /proc/cpuinfo non leggibile (binary-only: non bloccante)"
    fi
fi

# ---------------------------------------------------------------------------
# 4) --version only (no -m)
# ---------------------------------------------------------------------------
if [ "$SKIP_VERSION" != "1" ]; then
    echo "--- $BINARY --version (no model) ---"
    _ver_out=""
    _ver_rc=0
    set +e
    _ver_out="$("$BINARY" --version 2>&1)"
    _ver_rc=$?
    set -e
    printf '%s\n' "$_ver_out"
    if [ "$_ver_rc" -ne 0 ]; then
        # bmoe-cli può non supportare --version: prova --help / -h
        _is_bmoe=0
        case "$BINARY" in
            *bmoe-cli*) _is_bmoe=1 ;;
        esac
        if [ "$_is_bmoe" -eq 1 ]; then
            set +e
            _ver_out="$("$BINARY" --help 2>&1 | head -n 20)"
            _ver_rc=$?
            set -e
            printf '%s\n' "$_ver_out"
            if [ "$_ver_rc" -ne 0 ]; then
                set +e
                _ver_out="$("$BINARY" -h 2>&1 | head -n 20)"
                _ver_rc=$?
                set -e
            fi
        fi
    fi
    if [ "$_ver_rc" -ne 0 ]; then
        echo "FAIL: --version/--help exit=$_ver_rc (atteso 0)" >&2
        _fail=1
    else
        echo "OK: version/help exit=0"
    fi
    if printf '%s\n' "$_ver_out" | grep -E 'Illegal instruction|SIGILL|Segmentation fault' >/dev/null 2>&1; then
        echo "FAIL: version/help ha stampato crash signal" >&2
        _fail=1
    fi
fi

# ---------------------------------------------------------------------------
# 5) Static scan: positive hit → FAIL (non warning)
# ---------------------------------------------------------------------------
_lib=""
for cand in \
    "$_bindir/libggml-cpu.so" \
    "$_bindir/libggml-cpu.so.0" \
    "$_bindir/libggml-cpu.so.0.18.0"
do
    if [ -e "$cand" ]; then
        _lib="$cand"
        break
    fi
done

_scan_hit=0
if [ -n "$_lib" ]; then
    echo "--- static scan $_lib (sve/sme) ---"
    if command -v llvm-objdump >/dev/null 2>&1; then
        if llvm-objdump -d "$_lib" 2>/dev/null | grep -E '[[:space:]](smstart|smstop)([[:space:]]|$)' | head -n 3 | grep -q .; then
            echo "FAIL: mnemomic SME (smstart/smstop) in $_lib" >&2
            _scan_hit=1
        fi
    elif command -v objdump >/dev/null 2>&1; then
        if objdump -d "$_lib" 2>/dev/null | grep -E 'smstart|smstop' | head -n 3 | grep -q .; then
            echo "FAIL: mnemomic SME (smstart/smstop) in $_lib" >&2
            _scan_hit=1
        fi
    else
        echo "INFO: objdump non disponibile — skip scan statico"
    fi
    if [ "$_scan_hit" -eq 1 ]; then
        _fail=1
    elif command -v llvm-objdump >/dev/null 2>&1 || command -v objdump >/dev/null 2>&1; then
        echo "OK: nessun smstart/smstop in $_lib"
    fi
fi

if [ "$_fail" -ne 0 ]; then
    echo "=== PREFLIGHT FAIL ===" >&2
    # exit 4 solo se l'unico problema è CPU; provenance/build/ISA → 3
    if [ "${_build_fail:-0}" -eq 1 ]; then
        exit 3
    fi
    if [ "${_cpu_rc:-0}" -eq 4 ]; then
        exit 4
    fi
    exit 3
fi

echo "=== PREFLIGHT OK ==="
exit 0
