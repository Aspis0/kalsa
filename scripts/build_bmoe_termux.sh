#!/usr/bin/env bash
# =============================================================================
# build_bmoe_termux.sh — path A: build on-device BigMoeOnEdge su Termux (DEFAULT)
#
# Scopo: compilare bmoe-cli nativamente sul telefono (Samsung S23 / arm64),
#        con backend CPU e ISA esplicita (no GGML_NATIVE probes).
#
# Uso (da Termux, root del monorepo o ovunque):
#   bash scripts/build_bmoe_termux.sh
#   BMOE_ROOT=~/BigMoeOnEdge bash scripts/build_bmoe_termux.sh
#   JOBS=6 bash scripts/build_bmoe_termux.sh
#
# Canonico upstream (AGENTS.md + scripts/build-host.sh):
#   git submodule update --init --recursive
#   cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
#   cmake --build build -j
#   cd build && ctest --output-on-failure
#
# Qui aggiungiamo -G Ninja e le off-flag CPU-only richieste dalla campagna
# (LLAMA_CURL=OFF, GGML_OPENCL=OFF).
#
# SICUREZZA ISA (S23 / Android 16, 2026-08-03):
#   GGML_NATIVE=ON fa try_run con -mcpu=native+sve / +sme → SIGILL su 8 Gen 2
#   (tombstone CMakeScratch cmTC_*; v. reports/moe-f1-sigill.md).
#   Quindi: GGML_NATIVE=OFF + GGML_CPU_ARM_ARCH esplicito (come path NDK).
#   Default arch S23: armv8.2-a+dotprod+i8mm+fp16 (override ARM_ARCH=...).
#   CMAKE_EXPORT_COMPILE_COMMANDS=ON + preflight_llama_isa.sh su bmoe-cli.
#
# Pin monorepo: b0c4e5bfffd5b10ec636ad7edd7d5a0564c790a1
# Pin submodule llama.cpp: 5236140e514d5ceef2b801815b3ba9330f19732e
#
# Exit: 0=ok · 1=errore build/checkout · 2=dipendenze · 3=submodule/preflight
# =============================================================================

set -euo pipefail
export LC_ALL=C

# ---------------------------------------------------------------------------
# Pin e default
# ---------------------------------------------------------------------------
PIN_MONOREPO="b0c4e5bfffd5b10ec636ad7edd7d5a0564c790a1"
PIN_LLAMA="5236140e514d5ceef2b801815b3ba9330f19732e"
BUILD_DIR_IN="${BUILD_DIR:-build-termux}"
BUILD_TYPE="${BUILD_TYPE:-Release}"
# S23-safe explicit ISA (no native probes). Portable: armv8.2-a+dotprod+fp16
ARM_ARCH="${ARM_ARCH:-armv8.2-a+dotprod+i8mm+fp16}"
# Termux default __ANDROID_MIN_SDK_VERSION__=24; AHardwareBuffer needs API>=26
# (platform_io.cpp pinned_alloc / --dense-weights ahwb). Device S23 is API 36.
ANDROID_API="${ANDROID_API:-28}"
JOBS="${JOBS:-$(getconf _NPROCESSORS_ONLN 2>/dev/null || nproc 2>/dev/null || echo 4)}"
SKIP_PKG="${SKIP_PKG:-0}"
SKIP_CHECKOUT="${SKIP_CHECKOUT:-0}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib_isa_safe.sh"

DEFAULT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)/BigMoeOnEdge"
BMOE_ROOT_IN="${BMOE_ROOT:-$DEFAULT_ROOT}"

usage() {
    cat <<'EOF' >&2
Uso: build_bmoe_termux.sh [opzioni]

Path A (DEFAULT): build nativo Termux/arm64 di bmoe-cli.

Opzioni / env:
  BMOE_ROOT=DIR       path monorepo BigMoeOnEdge (default: <repo>/BigMoeOnEdge)
  BUILD_DIR=NAME      dir cmake (default: build-termux, relativa a BMOE_ROOT; solo nome)
  BUILD_TYPE=TYPE     Release|Debug|RelWithDebInfo (default: Release)
  ARM_ARCH=string     default: armv8.2-a+dotprod+i8mm+fp16
                      grammar: armv8.2-a[+dotprod][+i8mm][+fp16]
  ANDROID_API=N       default 28 (AHardwareBuffer needs >=26; Termux default is 24)
  JOBS=N              parallelismo (default: nproc)
  SKIP_PKG=1          non eseguire pkg install
  SKIP_CHECKOUT=1     non forzare checkout del pin monorepo
  -h, --help          questo aiuto

Riferimenti: BigMoeOnEdge/AGENTS.md, scripts/build-host.sh, README Quickstart.
EOF
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
    usage
    exit 0
fi

if ! isa_validate_arm_arch "$ARM_ARCH"; then
    exit 1
fi

if [ ! -d "$BMOE_ROOT_IN" ]; then
    echo "ERRORE: monorepo non trovato: $BMOE_ROOT_IN" >&2
    echo "Clona con: git clone --recursive https://github.com/Helldez/BigMoeOnEdge.git" >&2
    exit 1
fi
if ! isa_resolve_root "$BMOE_ROOT_IN"; then
    exit 1
fi
BMOE_ROOT="$ISA_ROOT"

if ! isa_resolve_build_dir "$BMOE_ROOT" "$BUILD_DIR_IN"; then
    exit 1
fi
BUILD_DIR_NAME="$BUILD_DIR_IN"
BUILD_DIR_ABS="$ISA_BUILD_DIR"

echo "=== build_bmoe_termux.sh (path A, on-device, safe ISA) ==="
echo "BMOE_ROOT=$BMOE_ROOT"
echo "BUILD_DIR=$BUILD_DIR_NAME ($BUILD_DIR_ABS) BUILD_TYPE=$BUILD_TYPE JOBS=$JOBS"
echo "ARM_ARCH=$ARM_ARCH (GGML_NATIVE=OFF) ANDROID_API=$ANDROID_API"
echo "PIN monorepo=$PIN_MONOREPO"
echo "PIN llama.cpp=$PIN_LLAMA"

# ---------------------------------------------------------------------------
# Dipendenze Termux
# ---------------------------------------------------------------------------
if [ "$SKIP_PKG" != "1" ]; then
    if ! command -v pkg >/dev/null 2>&1; then
        echo "ERRORE: 'pkg' non trovato — questo script è per Termux." >&2
        echo "Su Linux host usa scripts/build_bmoe_ndk.sh (path B) o BigMoeOnEdge/scripts/build-host.sh." >&2
        exit 2
    fi
    echo "--- pkg install dipendenze ---"
    pkg install -y clang cmake ninja git python binutils 2>&1 || {
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
echo "ninja:   $(ninja --version 2>/dev/null || echo present)"

# ---------------------------------------------------------------------------
# Checkout / verifica pin monorepo + submodule
# ---------------------------------------------------------------------------
cd "$BMOE_ROOT"

if [ ! -d .git ] && [ ! -f .git ]; then
    echo "ERRORE: $BMOE_ROOT non è un checkout git — impossibile verificare pin monorepo" >&2
    echo "        atteso pin monorepo=$PIN_MONOREPO" >&2
    exit 1
fi

if [ "$SKIP_CHECKOUT" != "1" ]; then
    CUR="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
    echo "HEAD monorepo: $CUR"
    if [ "$CUR" != "$PIN_MONOREPO" ]; then
        echo "--- checkout monorepo → $PIN_MONOREPO ---"
        if ! git cat-file -e "${PIN_MONOREPO}^{commit}" 2>/dev/null; then
            echo "oggetto pin assente in locale — git fetch (1 tentativo + 1 retry)"
            if ! git fetch --depth=1 origin "$PIN_MONOREPO"; then
                echo "fetch #1 fallito — retry una volta"
                sleep 2
                if ! git fetch --depth=1 origin "$PIN_MONOREPO"; then
                    echo "ERRORE: rete fallita, pin monorepo non raggiungibile." >&2
                    echo "        atteso=$PIN_MONOREPO  attuale=$CUR" >&2
                    exit 1
                fi
            fi
        fi
        if git cat-file -e "${PIN_MONOREPO}^{commit}" 2>/dev/null; then
            git checkout "$PIN_MONOREPO"
        fi
    else
        echo "pin monorepo già a posto"
    fi
fi

CUR="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
if [ "$CUR" != "$PIN_MONOREPO" ]; then
    echo "ERRORE: pin monorepo mismatch (fail-closed)" >&2
    echo "        atteso=$PIN_MONOREPO" >&2
    echo "        attuale=$CUR" >&2
    echo "        (SKIP_CHECKOUT=1 salta solo il force-checkout, non la verifica)" >&2
    exit 1
fi
echo "pin monorepo OK ($PIN_MONOREPO)"

echo "--- git submodule update --init --recursive ---"
if ! git submodule update --init --recursive; then
    echo "submodule update #1 fallito — retry una volta"
    sleep 2
    if ! git submodule update --init --recursive; then
        echo "ERRORE: submodule update fallito dopo retry (rete?)." >&2
        exit 3
    fi
fi

if [ ! -f third_party/llama.cpp/CMakeLists.txt ]; then
    echo "ERRORE: third_party/llama.cpp assente (submodule non inizializzato)" >&2
    echo "Esegui: git submodule update --init --recursive" >&2
    exit 3
fi

if [ ! -d third_party/llama.cpp/.git ] && [ ! -f third_party/llama.cpp/.git ]; then
    echo "ERRORE: third_party/llama.cpp non è un checkout git — impossibile verificare pin" >&2
    echo "        atteso pin llama.cpp=$PIN_LLAMA" >&2
    exit 1
fi
LLAMA_HEAD="$(git -C third_party/llama.cpp rev-parse HEAD 2>/dev/null || echo unknown)"
echo "HEAD llama.cpp: $LLAMA_HEAD"
if [ "$LLAMA_HEAD" != "$PIN_LLAMA" ]; then
    echo "ERRORE: pin llama.cpp mismatch (fail-closed)" >&2
    echo "        atteso=$PIN_LLAMA" >&2
    echo "        attuale=$LLAMA_HEAD" >&2
    exit 1
fi
echo "pin llama.cpp OK ($PIN_LLAMA)"

# ---------------------------------------------------------------------------
# Configure (Ninja + off-flag CPU-only + ISA esplicita, NO native probes)
# ---------------------------------------------------------------------------
echo "--- cmake configure (GGML_NATIVE=OFF, ARCH=$ARM_ARCH) ---"
mkdir -p "$BUILD_DIR_ABS"
CMAKE_LOG="$BUILD_DIR_ABS/cmake-configure.log"

# Wipe cache se un build precedente aveva NATIVE=ON o arch diversa
if [ -f "$BUILD_DIR_ABS/CMakeCache.txt" ]; then
    _old_native="$(grep -E '^GGML_NATIVE:BOOL=' "$BUILD_DIR_ABS/CMakeCache.txt" 2>/dev/null | head -n1 || true)"
    _old_arch="$(grep -E '^GGML_CPU_ARM_ARCH:STRING=' "$BUILD_DIR_ABS/CMakeCache.txt" 2>/dev/null | head -n1 || true)"
    if [ "$_old_native" = "GGML_NATIVE:BOOL=ON" ] || \
       { [ -n "$_old_arch" ] && [ "$_old_arch" != "GGML_CPU_ARM_ARCH:STRING=$ARM_ARCH" ]; }; then
        echo "AVVISO: cache non sicura ($_old_native; $_old_arch) — wipe $BUILD_DIR_NAME"
        if ! isa_assert_safe_rm_target "$BMOE_ROOT" "$BUILD_DIR_ABS"; then
            exit 1
        fi
        rm -rf "$BUILD_DIR_ABS"
        mkdir -p "$BUILD_DIR_ABS"
    fi
fi

# Raise min SDK so AHardwareBuffer_* is not marked unavailable (Termux default API 24).
# Toolchain flag only — no source patch. ahwb remains optional at runtime.
_BMOE_API_FLAGS="-D__ANDROID_API__=${ANDROID_API} -D__ANDROID_MIN_SDK_VERSION__=${ANDROID_API}"
echo "ANDROID_API=$ANDROID_API (AHardwareBuffer compile gate)"
cmake -S . -B "$BUILD_DIR_ABS" -G Ninja \
    -DCMAKE_BUILD_TYPE="$BUILD_TYPE" \
    -DCMAKE_EXPORT_COMPILE_COMMANDS=ON \
    -DCMAKE_C_FLAGS="$_BMOE_API_FLAGS" \
    -DCMAKE_CXX_FLAGS="$_BMOE_API_FLAGS" \
    -DLLAMA_CURL=OFF \
    -DGGML_OPENCL=OFF \
    -DGGML_NATIVE=OFF \
    -DGGML_CPU_ARM_ARCH="$ARM_ARCH" \
    2>&1 | tee "$CMAKE_LOG"

# Fail-closed: niente SIGILL / mcpu=native nel configure
if grep -E 'Illegal instruction|SIGILL|mcpu=native|march=native' "$CMAKE_LOG" >/dev/null 2>&1; then
    echo "ERRORE: configure non sicuro (SIGILL o mcpu=native nel log)" >&2
    grep -nE 'Illegal instruction|SIGILL|mcpu=native|march=native' "$CMAKE_LOG" | head -n 20 >&2 || true
    exit 1
fi

# Cache checks (equivalenti al preflight helper)
if [ ! -f "$BUILD_DIR_ABS/CMakeCache.txt" ]; then
    echo "ERRORE: CMakeCache.txt assente dopo configure" >&2
    exit 1
fi
_native_cache="$(grep -E '^GGML_NATIVE:BOOL=' "$BUILD_DIR_ABS/CMakeCache.txt" | head -n1 || true)"
_arch_cache="$(grep -E '^GGML_CPU_ARM_ARCH:STRING=' "$BUILD_DIR_ABS/CMakeCache.txt" | head -n1 || true)"
echo "cache: $_native_cache"
echo "cache: $_arch_cache"
if [ "$_native_cache" != "GGML_NATIVE:BOOL=OFF" ]; then
    echo "ERRORE: GGML_NATIVE non è OFF in CMakeCache" >&2
    exit 1
fi
if [ "$_arch_cache" != "GGML_CPU_ARM_ARCH:STRING=$ARM_ARCH" ]; then
    echo "ERRORE: GGML_CPU_ARM_ARCH cache mismatch" >&2
    echo "        atteso=GGML_CPU_ARM_ARCH:STRING=$ARM_ARCH" >&2
    echo "        attuale=$_arch_cache" >&2
    exit 1
fi

# ---------------------------------------------------------------------------
# Verifica feature ARM nel log (dotprod / i8mm)
# ---------------------------------------------------------------------------
echo "--- feature ARM (dotprod / i8mm) ---"
_feat_hit=0
if grep -iE 'dotprod|DOT_PROD|GGML_.*DOT' "$CMAKE_LOG" >/dev/null 2>&1; then
    echo "log configure: match DOTPROD:"
    grep -iE 'dotprod|DOT_PROD|GGML_.*DOT' "$CMAKE_LOG" | head -n 5 || true
    _feat_hit=1
fi
if grep -iE 'i8mm|I8MM|matmul_int8' "$CMAKE_LOG" >/dev/null 2>&1; then
    echo "log configure: match I8MM:"
    grep -iE 'i8mm|I8MM|matmul_int8' "$CMAKE_LOG" | head -n 5 || true
    _feat_hit=1
fi
if [ "$_feat_hit" -eq 0 ]; then
    cat <<'EOF'
AVVISO: nessuna riga DOTPROD/I8MM nel log cmake.
Come verificare a mano su Termux (S23 le supporta entrambe):
  1) cat /proc/cpuinfo | tr ' ' '\n' | grep -E 'asimddp|i8mm'
  2) ispezionare compile_commands.json per -march=...+dotprod+i8mm
  3) preflight_llama_isa.sh post-build (obbligatorio sotto)
EOF
fi

# ---------------------------------------------------------------------------
# Build target bmoe-cli
# ---------------------------------------------------------------------------
echo "--- cmake build bmoe-cli (jobs=$JOBS) ---"
BUILD_LOG="$BUILD_DIR_ABS/cmake-build.log"
cmake --build "$BUILD_DIR_ABS" -j "$JOBS" --target bmoe-cli 2>&1 | tee "$BUILD_LOG"

if grep -E 'mcpu=native|march=native' "$BUILD_LOG" >/dev/null 2>&1; then
    echo "ERRORE: build log contiene mcpu/march=native" >&2
    grep -nE 'mcpu=native|march=native' "$BUILD_LOG" | head -n 20 >&2 || true
    exit 1
fi

if grep -iE 'dotprod|\+i8mm|i8mm|asimddp' "$BUILD_LOG" >/dev/null 2>&1; then
    echo "log build: match feature ARM:"
    grep -iE 'dotprod|\+i8mm|i8mm|asimddp' "$BUILD_LOG" | head -n 8 || true
fi

# ---------------------------------------------------------------------------
# Locate binario
# ---------------------------------------------------------------------------
BIN=""
for cand in \
    "$BUILD_DIR_ABS/cli/bmoe-cli" \
    "$BUILD_DIR_ABS/bmoe-cli" \
    "$BUILD_DIR_ABS/bin/bmoe-cli"
do
    if [ -x "$cand" ] && [ -f "$cand" ]; then
        BIN="$cand"
        break
    fi
done

if [ -z "$BIN" ]; then
    BIN="$(find "$BUILD_DIR_ABS" -type f -name 'bmoe-cli' 2>/dev/null | head -n1 || true)"
fi

if [ -z "$BIN" ] || [ ! -e "$BIN" ]; then
    echo "ERRORE: binario bmoe-cli non trovato sotto $BUILD_DIR_ABS" >&2
    exit 1
fi

if [ ! -x "$BIN" ]; then
    chmod +x "$BIN" 2>/dev/null || true
fi
BIN_ABS="$(cd "$(dirname "$BIN")" && pwd -P)/$(basename "$BIN")"

# ---------------------------------------------------------------------------
# Smoke --help/--version: FAIL se entrambi falliscono
# ---------------------------------------------------------------------------
echo "--- smoke: bmoe-cli --help / --version ---"
_help_ok=0
if "$BIN_ABS" --help >/dev/null 2>&1; then
    _help_ok=1
    "$BIN_ABS" --help 2>&1 | head -n 30 || true
elif "$BIN_ABS" -h >/dev/null 2>&1; then
    _help_ok=1
    "$BIN_ABS" -h 2>&1 | head -n 30 || true
elif "$BIN_ABS" --version >/dev/null 2>&1; then
    _help_ok=1
    "$BIN_ABS" --version 2>&1 | head -n 10 || true
fi
if [ "$_help_ok" -ne 1 ]; then
    echo "ERRORE: bmoe-cli --help/-h/--version falliti tutti (binario non usabile)" >&2
    # mostra output per debug
    "$BIN_ABS" --help 2>&1 | head -n 20 || true
    exit 1
fi

# ---------------------------------------------------------------------------
# Preflight ISA OBBLIGATORIO su bmoe-cli (stesso helper mainline)
# ---------------------------------------------------------------------------
PREFLIGHT="$SCRIPT_DIR/preflight_llama_isa.sh"
if [ ! -f "$PREFLIGHT" ]; then
    echo "ERRORE: preflight_llama_isa.sh assente ($PREFLIGHT) — build non accettata" >&2
    exit 3
fi
echo "--- preflight_llama_isa.sh su bmoe-cli (mandatory) ---"
bash "$PREFLIGHT" \
    --binary "$BIN_ABS" \
    --build-dir "$BUILD_DIR_ABS" \
    --arm-arch "$ARM_ARCH" \
    || {
        echo "ERRORE: preflight ISA fallito su bmoe-cli" >&2
        exit 3
    }

echo ""
echo "=== BUILD OK ==="
echo "binario: $BIN_ABS"
echo "build_dir:     $BUILD_DIR_ABS"
echo "log configure: $CMAKE_LOG"
echo "log build:     $BUILD_LOG"
echo "pin monorepo:  $(git rev-parse HEAD 2>/dev/null || echo n/a)"
echo "pin llama.cpp: $(git -C third_party/llama.cpp rev-parse HEAD 2>/dev/null || echo n/a)"
echo "arch:          $ARM_ARCH (GGML_NATIVE=OFF)"
echo "Per i gate byte-identity (opzionale, serve python+gguf):"
echo "  (cd $BUILD_DIR_ABS && ctest --output-on-failure)"
exit 0
