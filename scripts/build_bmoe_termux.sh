#!/usr/bin/env bash
# =============================================================================
# build_bmoe_termux.sh — path A: build on-device BigMoeOnEdge su Termux (DEFAULT)
#
# Scopo: compilare bmoe-cli nativamente sul telefono (Samsung S23 / arm64),
#        con backend CPU e rilevamento automatico dotprod/i8mm (Cortex-X3/A7xx).
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
# (LLAMA_CURL=OFF, GGML_OPENCL=OFF). GGML_NATIVE resta al default ON: su
# Termux/arm64 ggml auto-rileva DOTPROD e I8MM al configure.
#
# Pin monorepo: b0c4e5bfffd5b10ec636ad7edd7d5a0564c790a1
# Pin submodule llama.cpp: 5236140e514d5ceef2b801815b3ba9330f19732e
#
# Exit: 0=ok · 1=errore build/checkout · 2=dipendenze · 3=submodule assente
# =============================================================================

set -euo pipefail
export LC_ALL=C

# ---------------------------------------------------------------------------
# Pin e default
# ---------------------------------------------------------------------------
PIN_MONOREPO="b0c4e5bfffd5b10ec636ad7edd7d5a0564c790a1"
PIN_LLAMA="5236140e514d5ceef2b801815b3ba9330f19732e"
BUILD_DIR="${BUILD_DIR:-build-termux}"
BUILD_TYPE="${BUILD_TYPE:-Release}"
JOBS="${JOBS:-$(getconf _NPROCESSORS_ONLN 2>/dev/null || nproc 2>/dev/null || echo 4)}"
SKIP_PKG="${SKIP_PKG:-0}"
SKIP_CHECKOUT="${SKIP_CHECKOUT:-0}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Default: monorepo gitignored accanto a scripts/ → ../BigMoeOnEdge
DEFAULT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)/BigMoeOnEdge"
BMOE_ROOT="${BMOE_ROOT:-$DEFAULT_ROOT}"

usage() {
    cat <<'EOF' >&2
Uso: build_bmoe_termux.sh [opzioni]

Path A (DEFAULT): build nativo Termux/arm64 di bmoe-cli.

Opzioni / env:
  BMOE_ROOT=DIR       path monorepo BigMoeOnEdge (default: <repo>/BigMoeOnEdge)
  BUILD_DIR=NAME      dir cmake (default: build-termux, relativa a BMOE_ROOT)
  BUILD_TYPE=TYPE     Release|Debug|RelWithDebInfo (default: Release)
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

echo "=== build_bmoe_termux.sh (path A, on-device) ==="
echo "BMOE_ROOT=$BMOE_ROOT"
echo "BUILD_DIR=$BUILD_DIR BUILD_TYPE=$BUILD_TYPE JOBS=$JOBS"
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
    # clang = toolchain C/C++; cmake+ninja = build; git = pin/submodule;
    # python = ctest gates (opzionale qui, utile dopo); binutils = ar/ld
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
if [ ! -d "$BMOE_ROOT" ]; then
    echo "ERRORE: monorepo non trovato: $BMOE_ROOT" >&2
    echo "Clona con: git clone --recursive https://github.com/Helldez/BigMoeOnEdge.git" >&2
    exit 1
fi

cd "$BMOE_ROOT"

if [ ! -d .git ] && [ ! -f .git ]; then
    echo "AVVISO: $BMOE_ROOT non è un checkout git — salto verifica pin" >&2
else
    if [ "$SKIP_CHECKOUT" != "1" ]; then
        CUR="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
        echo "HEAD monorepo: $CUR"
        if [ "$CUR" != "$PIN_MONOREPO" ]; then
            echo "--- checkout monorepo → $PIN_MONOREPO ---"
            # fetch solo se manca l'oggetto (rete opzionale)
            if ! git cat-file -e "${PIN_MONOREPO}^{commit}" 2>/dev/null; then
                echo "oggetto pin assente in locale — git fetch (1 tentativo + 1 retry)"
                if ! git fetch --depth=1 origin "$PIN_MONOREPO"; then
                    echo "fetch #1 fallito — retry una volta"
                    sleep 2
                    if ! git fetch --depth=1 origin "$PIN_MONOREPO"; then
                        echo "ERRORE: rete fallita, pin monorepo non raggiungibile. Non forzo checkout." >&2
                        echo "Continuo con HEAD=$CUR (documentare in report F1)." >&2
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

    echo "--- git submodule update --init --recursive ---"
    if ! git submodule update --init --recursive; then
        echo "submodule update #1 fallito — retry una volta"
        sleep 2
        if ! git submodule update --init --recursive; then
            echo "ERRORE: submodule update fallito dopo retry (rete?). Non scarico altro." >&2
            if [ ! -f third_party/llama.cpp/CMakeLists.txt ]; then
                exit 3
            fi
            echo "CMakeLists.txt submodule presente — proseguo con lo stato locale." >&2
        fi
    fi
fi

if [ ! -f third_party/llama.cpp/CMakeLists.txt ]; then
    echo "ERRORE: third_party/llama.cpp assente (submodule non inizializzato)" >&2
    echo "Esegui: git submodule update --init --recursive" >&2
    exit 3
fi

# Verifica pin submodule
if [ -d third_party/llama.cpp/.git ] || [ -f third_party/llama.cpp/.git ]; then
    LLAMA_HEAD="$(git -C third_party/llama.cpp rev-parse HEAD 2>/dev/null || echo unknown)"
    echo "HEAD llama.cpp: $LLAMA_HEAD"
    case "$LLAMA_HEAD" in
        ${PIN_LLAMA}*)
            echo "pin llama.cpp OK ($PIN_LLAMA)"
            ;;
        *)
            echo "AVVISO: llama.cpp HEAD=$LLAMA_HEAD (atteso $PIN_LLAMA)" >&2
            echo "         proseguo comunque — documentare eventuale mismatch in F1." >&2
            ;;
    esac
fi

# ---------------------------------------------------------------------------
# Configure (canonico build-host.sh + Ninja + off-flag CPU-only)
# ---------------------------------------------------------------------------
# GGML_NATIVE non viene toccato (default ON): su arm64 Termux ggml stampa
# le feature CPU rilevate (DOTPROD, I8MM, …) nel log di configure/build.
# Su S23 (Cortex-X3 + A715/A710) entrambe devono risultare abilitate.
echo "--- cmake configure ---"
CMAKE_LOG="$BMOE_ROOT/$BUILD_DIR/cmake-configure.log"
mkdir -p "$BMOE_ROOT/$BUILD_DIR"

cmake -S . -B "$BUILD_DIR" -G Ninja \
    -DCMAKE_BUILD_TYPE="$BUILD_TYPE" \
    -DLLAMA_CURL=OFF \
    -DGGML_OPENCL=OFF \
    2>&1 | tee "$CMAKE_LOG"

# ---------------------------------------------------------------------------
# Verifica feature ARM nel log (dotprod / i8mm)
# ---------------------------------------------------------------------------
echo "--- feature ARM (dotprod / i8mm) ---"
# ggml/llama.cpp stampano cose tipo:
#   "ARM feature DOTPROD = 1" / "+dotprod" / "GGML_USE_DOTPROD"
# pattern larghi: non falliamo se il formato cambia, ma segnaliamo.
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
  1) getconf /proc o: cat /proc/cpuinfo | tr ' ' '\n' | grep -E '^(Features|flags)' -A1
     cerca "asimddp" (dotprod) e "i8mm"
  2) dopo il build, nm/objdump sul backend CPU:
       nm -C "$BUILD_DIR"/bin/libggml-cpu.so 2>/dev/null | grep -iE 'dotprod|i8mm' | head
     oppure ispezionare il log di build (tee sotto) per -march= / +dotprod / +i8mm
  3) bmoe-cli / llama stampano le feature a runtime su stderr all'avvio del modello
EOF
fi

# ---------------------------------------------------------------------------
# Build target bmoe-cli
# ---------------------------------------------------------------------------
echo "--- cmake build bmoe-cli (jobs=$JOBS) ---"
BUILD_LOG="$BMOE_ROOT/$BUILD_DIR/cmake-build.log"
cmake --build "$BUILD_DIR" -j "$JOBS" --target bmoe-cli 2>&1 | tee "$BUILD_LOG"

# Seconda passata feature sul log di build (flag -march spesso qui)
if grep -iE 'dotprod|\+i8mm|i8mm|asimddp' "$BUILD_LOG" >/dev/null 2>&1; then
    echo "log build: match feature ARM:"
    grep -iE 'dotprod|\+i8mm|i8mm|asimddp' "$BUILD_LOG" | head -n 8 || true
fi

# ---------------------------------------------------------------------------
# Smoke --help e path finale
# ---------------------------------------------------------------------------
# Path tipici: build/cli/bmoe-cli (host script) oppure build/cli/bmoe-cli sotto Ninja
BIN=""
for cand in \
    "$BUILD_DIR/cli/bmoe-cli" \
    "$BUILD_DIR/bmoe-cli" \
    "$BUILD_DIR/bin/bmoe-cli"
do
    if [ -x "$cand" ]; then
        BIN="$cand"
        break
    fi
done

if [ -z "$BIN" ]; then
    # fallback: cerca
    BIN="$(find "$BUILD_DIR" -type f -name 'bmoe-cli' 2>/dev/null | head -n1 || true)"
fi

if [ -z "$BIN" ] || [ ! -e "$BIN" ]; then
    echo "ERRORE: binario bmoe-cli non trovato sotto $BUILD_DIR" >&2
    exit 1
fi

# Rendi eseguibile se serve
chmod +x "$BIN" 2>/dev/null || true
BIN_ABS="$(cd "$(dirname "$BIN")" && pwd)/$(basename "$BIN")"

echo "--- smoke: bmoe-cli --help ---"
if ! "$BIN_ABS" --help >/dev/null 2>&1; then
    # alcuni cli usano -h / stampano help su stderr con exit != 0: riprova verbose
    if ! "$BIN_ABS" --help; then
        echo "AVVISO: --help ha exit non-zero; provo -h / --version" >&2
        "$BIN_ABS" -h 2>&1 | head -n 20 || true
        "$BIN_ABS" --version 2>&1 | head -n 5 || true
    fi
else
    "$BIN_ABS" --help 2>&1 | head -n 30 || true
fi

echo ""
echo "=== BUILD OK ==="
echo "binario: $BIN_ABS"
echo "log configure: $CMAKE_LOG"
echo "log build:     $BUILD_LOG"
echo "pin monorepo:  $(git rev-parse HEAD 2>/dev/null || echo n/a)"
echo "pin llama.cpp: $(git -C third_party/llama.cpp rev-parse HEAD 2>/dev/null || echo n/a)"
echo "Per i gate byte-identity (opzionale, serve python+gguf):"
echo "  (cd $BUILD_DIR && ctest --output-on-failure)"
exit 0
