#!/usr/bin/env bash
# =============================================================================
# build_llama_termux.sh — build CONSERVATIVO di llama.cpp mainline su Termux/arm64
#
# Contesto (S23 Android 16, 2026-08-03):
#   La build F1 usava solo:
#     cmake -B build -DCMAKE_BUILD_TYPE=Release -DLLAMA_CURL=OFF -DGGML_OPENCL=OFF
#   con GGML_NATIVE default ON. Su aarch64 ggml esegue try_run con
#     -mcpu=native+sve  e  -mcpu=native+sme
#   che su Snapdragon 8 Gen 2 (no SVE/SME) generano SIGILL deliberati
#   (dropbox SYSTEM_TOMBSTONE su cmTC_* in CMakeScratch). Il binario finale
#   veniva comunque compilato con -mcpu=native+dotprod+i8mm+nosve+nosme.
#
# Questo script FORZA:
#   - pin tag b10244 / commit 67d5978bb1ba490070ddbd2a7c59c7ec5a60b7cc
#   - Release, LLAMA_CURL=OFF, GGML_OPENCL=OFF
#   - GGML_NATIVE=OFF  (niente try_run feature probes con mcpu=native+*)
#   - GGML_CPU_ARM_ARCH esplicito (default S23-safe: armv8.2-a+dotprod+i8mm+fp16)
#   - CMAKE_EXPORT_COMPILE_COMMANDS=ON (preflight ispeziona -march)
#   - preflight post-build OBBLIGATORIO (no fallback --version alone)
#
# Uso (da Termux):
#   bash scripts/build_llama_termux.sh
#   LLAMA_ROOT=~/src/llama.cpp bash scripts/build_llama_termux.sh
#   ARM_ARCH=armv8.2-a+dotprod+fp16 bash scripts/build_llama_termux.sh   # no i8mm
#   SKIP_CHECKOUT=1 bash scripts/build_llama_termux.sh
#
# Exit: 0=ok · 1=build/checkout · 2=deps · 3=preflight ISA fail · 4=pin mismatch
# =============================================================================

set -euo pipefail
export LC_ALL=C

# Pin campagna (PLAN F0.1 / F1): tag b10244
PIN_TAG="b10244"
PIN_COMMIT="67d5978bb1ba490070ddbd2a7c59c7ec5a60b7cc"
# Default arch S23 (Cortex-X3/A715/A710/A510): dotprod+i8mm+fp16, NO sve/sme.
ARM_ARCH="${ARM_ARCH:-armv8.2-a+dotprod+i8mm+fp16}"
BUILD_DIR_IN="${BUILD_DIR:-build-safe}"
BUILD_TYPE="${BUILD_TYPE:-Release}"
JOBS="${JOBS:-$(getconf _NPROCESSORS_ONLN 2>/dev/null || nproc 2>/dev/null || echo 4)}"
SKIP_PKG="${SKIP_PKG:-0}"
SKIP_CHECKOUT="${SKIP_CHECKOUT:-0}"
# Target minimi campagna F1/F2 (llama-perf non esiste su b10244)
TARGETS="${TARGETS:-llama-cli llama-bench}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib_isa_safe.sh"

REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEFAULT_ROOT="${HOME}/src/llama.cpp"
if [ -d "$DEFAULT_ROOT" ]; then
    :
elif [ -d "$REPO_ROOT/llama.cpp" ]; then
    DEFAULT_ROOT="$REPO_ROOT/llama.cpp"
fi
LLAMA_ROOT_IN="${LLAMA_ROOT:-$DEFAULT_ROOT}"

usage() {
    cat <<'EOF' >&2
Uso: build_llama_termux.sh

Build Termux/arm64 CONSERVATIVO di llama.cpp mainline (no GGML_NATIVE probes).

Env:
  LLAMA_ROOT=DIR       path llama.cpp (default: ~/src/llama.cpp)
  BUILD_DIR=NAME       default: build-safe (relativa a LLAMA_ROOT; solo nome)
  BUILD_TYPE=Release
  ARM_ARCH=string      default: armv8.2-a+dotprod+i8mm+fp16
                       grammar: armv8.2-a[+dotprod][+i8mm][+fp16]
  JOBS=N
  TARGETS="llama-cli llama-bench"
  SKIP_PKG=1
  SKIP_CHECKOUT=1      non forza pin; verifica comunque fail-closed
  -h, --help

Post-build: preflight_llama_isa.sh OBBLIGATORIO (fail se assente/fallisce).
EOF
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
    usage
    exit 0
fi

# ---------------------------------------------------------------------------
# Path resolution (una volta, fail-closed)
# ---------------------------------------------------------------------------
if ! isa_validate_arm_arch "$ARM_ARCH"; then
    exit 3
fi

if [ ! -d "$LLAMA_ROOT_IN" ]; then
    echo "ERRORE: llama.cpp non trovato: $LLAMA_ROOT_IN" >&2
    echo "Clona: git clone https://github.com/ggml-org/llama.cpp.git $LLAMA_ROOT_IN" >&2
    echo "       git -C $LLAMA_ROOT_IN checkout $PIN_COMMIT" >&2
    exit 1
fi
if ! isa_resolve_root "$LLAMA_ROOT_IN"; then
    exit 1
fi
LLAMA_ROOT="$ISA_ROOT"

if ! isa_resolve_build_dir "$LLAMA_ROOT" "$BUILD_DIR_IN"; then
    exit 1
fi
BUILD_DIR_NAME="$BUILD_DIR_IN"
BUILD_DIR_ABS="$ISA_BUILD_DIR"

echo "=== build_llama_termux.sh (conservative, no native probes) ==="
echo "LLAMA_ROOT=$LLAMA_ROOT"
echo "BUILD_DIR=$BUILD_DIR_NAME ($BUILD_DIR_ABS) BUILD_TYPE=$BUILD_TYPE JOBS=$JOBS"
echo "ARM_ARCH=$ARM_ARCH"
echo "PIN tag=$PIN_TAG commit=$PIN_COMMIT"
echo "TARGETS=$TARGETS"

# ---------------------------------------------------------------------------
# Dipendenze Termux
# ---------------------------------------------------------------------------
if [ "$SKIP_PKG" != "1" ]; then
    if ! command -v pkg >/dev/null 2>&1; then
        echo "ERRORE: 'pkg' non trovato — questo script è per Termux." >&2
        exit 2
    fi
    echo "--- pkg install dipendenze ---"
    pkg install -y clang cmake ninja git binutils 2>&1 || {
        echo "ERRORE: pkg install fallito" >&2
        exit 2
    }
fi

for t in clang++ cmake ninja git; do
    if ! command -v "$t" >/dev/null 2>&1; then
        echo "ERRORE: tool mancante: $t" >&2
        exit 2
    fi
done
echo "clang++: $(clang++ --version 2>/dev/null | head -n1)"
echo "cmake:   $(cmake --version | head -n1)"

# ---------------------------------------------------------------------------
# Checkout pin
# ---------------------------------------------------------------------------
cd "$LLAMA_ROOT"

if [ ! -d .git ] && [ ! -f .git ]; then
    echo "ERRORE: $LLAMA_ROOT non è un checkout git — impossibile verificare pin" >&2
    exit 4
fi

if [ "$SKIP_CHECKOUT" != "1" ]; then
    CUR="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
    echo "HEAD: $CUR"
    if [ "$CUR" != "$PIN_COMMIT" ]; then
        echo "--- checkout pin $PIN_COMMIT ($PIN_TAG) ---"
        if ! git cat-file -e "${PIN_COMMIT}^{commit}" 2>/dev/null; then
            echo "fetch pin (1+1 retry)"
            if ! git fetch --depth=1 origin "$PIN_TAG" && ! git fetch --depth=1 origin "$PIN_COMMIT"; then
                sleep 2
                if ! git fetch --depth=1 origin "$PIN_TAG" && ! git fetch --depth=1 origin "$PIN_COMMIT"; then
                    echo "ERRORE: fetch pin fallito (rete?)" >&2
                    exit 1
                fi
            fi
        fi
        if git cat-file -e "${PIN_COMMIT}^{commit}" 2>/dev/null; then
            git checkout "$PIN_COMMIT"
        fi
    else
        echo "pin già a posto"
    fi
fi

CUR="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
if [ "$CUR" != "$PIN_COMMIT" ]; then
    echo "ERRORE: pin mismatch (fail-closed)" >&2
    echo "        atteso=$PIN_COMMIT ($PIN_TAG)" >&2
    echo "        attuale=$CUR" >&2
    exit 4
fi
echo "pin OK ($PIN_COMMIT)"

# ---------------------------------------------------------------------------
# Configure — NO GGML_NATIVE, arch esplicita, compile_commands ON
# ---------------------------------------------------------------------------
echo "--- cmake configure (GGML_NATIVE=OFF, ARCH=$ARM_ARCH) ---"
mkdir -p "$BUILD_DIR_ABS"
CMAKE_LOG="$BUILD_DIR_ABS/cmake-configure.log"

# Pulisci cache se un build precedente aveva NATIVE=ON (evita flag stale)
if [ -f "$BUILD_DIR_ABS/CMakeCache.txt" ]; then
    _old_native="$(grep -E '^GGML_NATIVE:BOOL=' "$BUILD_DIR_ABS/CMakeCache.txt" 2>/dev/null | head -n1 || true)"
    _old_arch="$(grep -E '^GGML_CPU_ARM_ARCH:STRING=' "$BUILD_DIR_ABS/CMakeCache.txt" 2>/dev/null | head -n1 || true)"
    if [ "$_old_native" = "GGML_NATIVE:BOOL=ON" ] || \
       { [ -n "$_old_arch" ] && [ "$_old_arch" != "GGML_CPU_ARM_ARCH:STRING=$ARM_ARCH" ]; }; then
        echo "AVVISO: cache precedente non sicura ($_old_native; $_old_arch) — wipe $BUILD_DIR_NAME"
        if ! isa_assert_safe_rm_target "$LLAMA_ROOT" "$BUILD_DIR_ABS"; then
            exit 1
        fi
        rm -rf "$BUILD_DIR_ABS"
        mkdir -p "$BUILD_DIR_ABS"
    fi
fi

cmake -S . -B "$BUILD_DIR_ABS" -G Ninja \
    -DCMAKE_BUILD_TYPE="$BUILD_TYPE" \
    -DCMAKE_EXPORT_COMPILE_COMMANDS=ON \
    -DLLAMA_CURL=OFF \
    -DGGML_OPENCL=OFF \
    -DGGML_NATIVE=OFF \
    -DGGML_CPU_ARM_ARCH="$ARM_ARCH" \
    2>&1 | tee "$CMAKE_LOG"

# ---------------------------------------------------------------------------
# Preflight configure: vietati mcpu=native e Illegal instruction nei probe
# ---------------------------------------------------------------------------
echo "--- preflight configure log ---"
_fail=0
if grep -E 'mcpu=native|march=native' "$CMAKE_LOG" >/dev/null 2>&1; then
    echo "ERRORE preflight: configure ha usato mcpu/march=native" >&2
    grep -nE 'mcpu=native|march=native' "$CMAKE_LOG" | head -n 20 >&2 || true
    _fail=1
fi
if grep -E 'Illegal instruction|SIGILL' "$CMAKE_LOG" >/dev/null 2>&1; then
    echo "ERRORE preflight: SIGILL/Illegal instruction durante configure" >&2
    echo "        (con GGML_NATIVE=OFF non deve comparire; abort)" >&2
    grep -nE 'Illegal instruction|SIGILL' "$CMAKE_LOG" | head -n 20 >&2 || true
    _fail=1
fi
if grep -E 'GGML_MACHINE_SUPPORTS_(sve|sme)' "$CMAKE_LOG" >/dev/null 2>&1; then
    echo "ERRORE preflight: path NATIVE ancora attivo (GGML_MACHINE_SUPPORTS_sve/sme)" >&2
    _fail=1
fi
if [ ! -f "$BUILD_DIR_ABS/CMakeCache.txt" ]; then
    echo "ERRORE: CMakeCache.txt assente dopo configure" >&2
    exit 1
fi
_native_cache="$(grep -E '^GGML_NATIVE:BOOL=' "$BUILD_DIR_ABS/CMakeCache.txt" | head -n1 || true)"
_arch_cache="$(grep -E '^GGML_CPU_ARM_ARCH:STRING=' "$BUILD_DIR_ABS/CMakeCache.txt" | head -n1 || true)"
echo "cache: $_native_cache"
echo "cache: $_arch_cache"
if [ "$_native_cache" != "GGML_NATIVE:BOOL=OFF" ]; then
    echo "ERRORE preflight: GGML_NATIVE non è OFF in CMakeCache" >&2
    _fail=1
fi
if [ "$_arch_cache" != "GGML_CPU_ARM_ARCH:STRING=$ARM_ARCH" ]; then
    echo "ERRORE preflight: GGML_CPU_ARM_ARCH cache mismatch" >&2
    echo "        atteso=GGML_CPU_ARM_ARCH:STRING=$ARM_ARCH" >&2
    echo "        attuale=$_arch_cache" >&2
    _fail=1
fi
if [ "$_fail" -ne 0 ]; then
    exit 3
fi
echo "preflight configure OK"

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------
echo "--- cmake build ($TARGETS, jobs=$JOBS) ---"
BUILD_LOG="$BUILD_DIR_ABS/cmake-build.log"
# shellcheck disable=SC2086
cmake --build "$BUILD_DIR_ABS" -j "$JOBS" --target $TARGETS 2>&1 | tee "$BUILD_LOG"

if grep -E 'mcpu=native|march=native' "$BUILD_LOG" >/dev/null 2>&1; then
    echo "ERRORE preflight: build log contiene mcpu/march=native" >&2
    grep -nE 'mcpu=native|march=native' "$BUILD_LOG" | head -n 20 >&2 || true
    exit 3
fi

# ---------------------------------------------------------------------------
# Locate binario
# ---------------------------------------------------------------------------
BIN=""
for cand in \
    "$BUILD_DIR_ABS/bin/llama-cli" \
    "$BUILD_DIR_ABS/llama-cli"
do
    if [ -x "$cand" ] && [ -f "$cand" ]; then
        BIN="$cand"
        break
    fi
done
if [ -z "$BIN" ]; then
    BIN="$(find "$BUILD_DIR_ABS" -type f -name 'llama-cli' 2>/dev/null | head -n1 || true)"
fi
if [ -z "$BIN" ] || [ ! -e "$BIN" ]; then
    echo "ERRORE: llama-cli non prodotto in $BUILD_DIR_ABS" >&2
    exit 1
fi
# Non chmod automatico sul binario di input al preflight: se non eseguibile, fail
if [ ! -x "$BIN" ]; then
    chmod +x "$BIN" 2>/dev/null || true
fi
BIN_ABS="$(cd "$(dirname "$BIN")" && pwd -P)/$(basename "$BIN")"

# ---------------------------------------------------------------------------
# ISA preflight OBBLIGATORIO (no fallback --version alone)
# ---------------------------------------------------------------------------
PREFLIGHT="$SCRIPT_DIR/preflight_llama_isa.sh"
if [ ! -f "$PREFLIGHT" ]; then
    echo "ERRORE: preflight_llama_isa.sh assente ($PREFLIGHT) — build non accettata" >&2
    exit 3
fi
echo "--- preflight_llama_isa.sh (mandatory) ---"
bash "$PREFLIGHT" \
    --binary "$BIN_ABS" \
    --build-dir "$BUILD_DIR_ABS" \
    --arm-arch "$ARM_ARCH" \
    || {
        echo "ERRORE: preflight ISA fallito" >&2
        exit 3
    }

echo ""
echo "=== BUILD OK (safe ARM target) ==="
echo "binario:       $BIN_ABS"
echo "build_dir:     $BUILD_DIR_ABS"
echo "log configure: $CMAKE_LOG"
echo "log build:     $BUILD_LOG"
echo "pin:           $(git rev-parse HEAD)"
echo "arch:          $ARM_ARCH  (GGML_NATIVE=OFF)"
echo "NON usare il vecchio build/ con GGML_NATIVE=ON."
echo "Prossimo smoke (solo quando gualt autorizza e batteria UNPLUGGED ≤32°C):"
echo "  $BIN_ABS -m ~/models/Qwen3.5-4B-Q4_K_M.gguf -p 'Hello' -n 16 -t 4 --no-warmup"
exit 0
