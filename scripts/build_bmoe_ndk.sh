#!/usr/bin/env bash
# =============================================================================
# build_bmoe_ndk.sh — path B: cross-compile bmoe-cli con Android NDK (fallback)
#
# Scopo: build arm64-v8a di bmoe-cli su Linux box / RunPod quando il build
#        Termux (path A) fallisce o è troppo lento. Output: binario + .so
#        da pushare sul telefono.
#
# Uso:
#   ANDROID_NDK=$HOME/android-ndk-r27b bash scripts/build_bmoe_ndk.sh
#   ANDROID_NDK_HOME=/opt/ndk bash scripts/build_bmoe_ndk.sh
#
# Canonico upstream: BigMoeOnEdge/scripts/build-android.ps1
#   cmake -S . -B build-android -G Ninja \
#     -DCMAKE_TOOLCHAIN_FILE=$NDK/build/cmake/android.toolchain.cmake \
#     -DANDROID_ABI=arm64-v8a \
#     -DANDROID_PLATFORM=android-29 \
#     -DCMAKE_BUILD_TYPE=Release \
#     -DBMOE_BUILD_TESTS=OFF \
#     -DGGML_NATIVE=OFF \
#     -DGGML_OPENCL=OFF \
#     -DGGML_OPENMP=OFF \
#     -DGGML_CPU_ARM_ARCH=armv8.2-a+dotprod+fp16 \
#     -DLLAMA_CURL=OFF
#   cmake --build build-android -j
#
# Deviazioni note rispetto a una richiesta "android-31 + i8mm":
#   * API level = 29 (canonicodel PS1; non 31) — copre S23 e dispositivi più vecchi
#   * arch = armv8.2-a+dotprod+fp16, deliberatamente SENZA i8mm: i8mm (armv8.6)
#     SIGILL su SoC pre-2021; il PS1 documenta che un solo binario device-agnostic
#     con solo dotprod è la scelta di prodotto. Su S23 (che ha i8mm) il path A
#     Termux nativo può abilitarlo via GGML_NATIVE.
#
# Pin monorepo: b0c4e5bfffd5b10ec636ad7edd7d5a0564c790a1
# Pin submodule: 5236140e514d5ceef2b801815b3ba9330f19732e
#
# Exit: 0=ok · 1=build · 2=NDK/deps · 3=submodule
# =============================================================================

set -euo pipefail
export LC_ALL=C

PIN_MONOREPO="b0c4e5bfffd5b10ec636ad7edd7d5a0564c790a1"
PIN_LLAMA="5236140e514d5ceef2b801815b3ba9330f19732e"
BUILD_DIR="${BUILD_DIR:-build-android}"
BUILD_TYPE="${BUILD_TYPE:-Release}"
ABI="${ANDROID_ABI:-arm64-v8a}"
# Canonico build-android.ps1 = 29 (NON 31)
API_LEVEL="${ANDROID_API_LEVEL:-29}"
JOBS="${JOBS:-$(getconf _NPROCESSORS_ONLN 2>/dev/null || nproc 2>/dev/null || echo 4)}"
SKIP_CHECKOUT="${SKIP_CHECKOUT:-0}"
# Se 1, prova a scaricare NDK r27c in $NDK_DOWNLOAD_DIR quando assente
ALLOW_NDK_DOWNLOAD="${ALLOW_NDK_DOWNLOAD:-0}"
NDK_DOWNLOAD_DIR="${NDK_DOWNLOAD_DIR:-${HOME:-/tmp}/android-ndk}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)/BigMoeOnEdge"
BMOE_ROOT="${BMOE_ROOT:-$DEFAULT_ROOT}"

usage() {
    cat <<'EOF' >&2
Uso: build_bmoe_ndk.sh [opzioni]

Path B: cross-compile Android NDK (Linux/RunPod; funziona anche su macOS host).

Env:
  ANDROID_NDK / ANDROID_NDK_HOME   path NDK r27+ (obbligatorio se non scarichi)
  BMOE_ROOT=DIR                    monorepo (default: <repo>/BigMoeOnEdge)
  BUILD_DIR=NAME                   default: build-android
  BUILD_TYPE=Release
  ANDROID_ABI=arm64-v8a
  ANDROID_API_LEVEL=29             (canonico PS1; override esplicito se serve 31)
  JOBS=N
  SKIP_CHECKOUT=1
  ALLOW_NDK_DOWNLOAD=1             scarica NDK r27c se assente (solo se consenso)
  NDK_DOWNLOAD_DIR=DIR             destinazione download NDK
  -h, --help

Output: $BMOE_ROOT/$BUILD_DIR/cli/bmoe-cli  (ELF aarch64)
        + libggml*.so / libllama*.so nel tree di build
EOF
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
    usage
    exit 0
fi

echo "=== build_bmoe_ndk.sh (path B, NDK cross-compile) ==="
echo "BMOE_ROOT=$BMOE_ROOT"
echo "BUILD_DIR=$BUILD_DIR ABI=$ABI API=android-$API_LEVEL JOBS=$JOBS"

# ---------------------------------------------------------------------------
# Trova NDK
# ---------------------------------------------------------------------------
find_ndk() {
    if [ -n "${ANDROID_NDK:-}" ] && [ -f "${ANDROID_NDK}/build/cmake/android.toolchain.cmake" ]; then
        printf '%s\n' "$ANDROID_NDK"
        return 0
    fi
    if [ -n "${ANDROID_NDK_HOME:-}" ] && [ -f "${ANDROID_NDK_HOME}/build/cmake/android.toolchain.cmake" ]; then
        printf '%s\n' "$ANDROID_NDK_HOME"
        return 0
    fi
    # SDK default Linux / macOS / Windows (git-bash)
    for base in \
        "${ANDROID_SDK_ROOT:-}" \
        "${ANDROID_HOME:-}" \
        "${HOME}/Android/Sdk" \
        "${LOCALAPPDATA:-}/Android/Sdk" \
        "/c/Users/${USER:-}/AppData/Local/Android/Sdk"
    do
        [ -n "$base" ] || continue
        [ -d "$base/ndk" ] || continue
        # prendi la versione più alta
        _latest="$(ls -1 "$base/ndk" 2>/dev/null | sort -V | tail -n1 || true)"
        if [ -n "$_latest" ] && [ -f "$base/ndk/$_latest/build/cmake/android.toolchain.cmake" ]; then
            printf '%s\n' "$base/ndk/$_latest"
            return 0
        fi
    done
    return 1
}

NDK="$(find_ndk || true)"
if [ -z "${NDK:-}" ]; then
    if [ "$ALLOW_NDK_DOWNLOAD" = "1" ]; then
        echo "--- NDK assente: download r27c (ALLOW_NDK_DOWNLOAD=1) ---"
        mkdir -p "$NDK_DOWNLOAD_DIR"
        # r27c = 27.2.12479018 (r27+ richiesto)
        NDK_ZIP_URL="https://dl.google.com/android/repository/android-ndk-r27c-linux.zip"
        case "$(uname -s)" in
            Darwin) NDK_ZIP_URL="https://dl.google.com/android/repository/android-ndk-r27c-darwin.zip" ;;
            MINGW*|MSYS*|CYGWIN*|Windows_NT) NDK_ZIP_URL="https://dl.google.com/android/repository/android-ndk-r27c-windows.zip" ;;
        esac
        NDK_ZIP="$NDK_DOWNLOAD_DIR/android-ndk-r27c.zip"
        if [ ! -f "$NDK_ZIP" ]; then
            if command -v curl >/dev/null 2>&1; then
                curl -L --fail --retry 2 -o "$NDK_ZIP" "$NDK_ZIP_URL" || {
                    echo "ERRORE: download NDK fallito" >&2
                    exit 2
                }
            elif command -v wget >/dev/null 2>&1; then
                wget -O "$NDK_ZIP" "$NDK_ZIP_URL" || {
                    echo "ERRORE: download NDK fallito" >&2
                    exit 2
                }
            else
                echo "ERRORE: serve curl o wget per scaricare l'NDK" >&2
                exit 2
            fi
        fi
        if command -v unzip >/dev/null 2>&1; then
            unzip -q -o "$NDK_ZIP" -d "$NDK_DOWNLOAD_DIR"
        else
            echo "ERRORE: serve unzip" >&2
            exit 2
        fi
        NDK="$NDK_DOWNLOAD_DIR/android-ndk-r27c"
        if [ ! -f "$NDK/build/cmake/android.toolchain.cmake" ]; then
            echo "ERRORE: NDK scompattato ma toolchain assente in $NDK" >&2
            exit 2
        fi
    else
        echo "ERRORE: Android NDK non trovato." >&2
        echo "Imposta ANDROID_NDK o ANDROID_NDK_HOME (r27+), oppure ALLOW_NDK_DOWNLOAD=1." >&2
        exit 2
    fi
fi

TOOLCHAIN="$NDK/build/cmake/android.toolchain.cmake"
if [ ! -f "$TOOLCHAIN" ]; then
    echo "ERRORE: toolchain cmake assente: $TOOLCHAIN" >&2
    exit 2
fi
echo "Using NDK: $NDK"

for t in cmake; do
    if ! command -v "$t" >/dev/null 2>&1; then
        echo "ERRORE: tool mancante: $t" >&2
        exit 2
    fi
done
# Ninja preferito (come il PS1); fallback a generator default se assente
GEN_ARGS=()
if command -v ninja >/dev/null 2>&1; then
    GEN_ARGS=(-G Ninja)
    echo "generator: Ninja"
else
    echo "AVVISO: ninja non in PATH — uso generator cmake di default"
fi

# ---------------------------------------------------------------------------
# Monorepo + submodule
# ---------------------------------------------------------------------------
if [ ! -d "$BMOE_ROOT" ]; then
    echo "ERRORE: monorepo non trovato: $BMOE_ROOT" >&2
    exit 1
fi
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
        if ! git cat-file -e "${PIN_MONOREPO}^{commit}" 2>/dev/null; then
            echo "fetch pin monorepo (1+1 retry)"
            if ! git fetch --depth=1 origin "$PIN_MONOREPO"; then
                sleep 2
                if ! git fetch --depth=1 origin "$PIN_MONOREPO"; then
                    echo "ERRORE: fetch pin monorepo fallito (rete?)." >&2
                    echo "        atteso=$PIN_MONOREPO  attuale=$CUR" >&2
                    exit 1
                fi
            fi
        fi
        if git cat-file -e "${PIN_MONOREPO}^{commit}" 2>/dev/null; then
            git checkout "$PIN_MONOREPO"
        fi
    fi
fi

# FAIL-CLOSED: monorepo HEAD deve coincidere col pin prima del configure
CUR="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
if [ "$CUR" != "$PIN_MONOREPO" ]; then
    echo "ERRORE: pin monorepo mismatch (fail-closed)" >&2
    echo "        atteso=$PIN_MONOREPO" >&2
    echo "        attuale=$CUR" >&2
    echo "        (SKIP_CHECKOUT=1 salta solo il force-checkout, non la verifica)" >&2
    exit 1
fi
echo "pin monorepo OK ($PIN_MONOREPO)"

if ! git submodule update --init --recursive; then
    echo "submodule update retry"
    sleep 2
    if ! git submodule update --init --recursive; then
        echo "ERRORE: submodule update fallito dopo retry" >&2
        exit 3
    fi
fi

if [ ! -f third_party/llama.cpp/CMakeLists.txt ]; then
    echo "ERRORE: third_party/llama.cpp assente" >&2
    exit 3
fi

# FAIL-CLOSED: pin submodule llama.cpp
if [ ! -d third_party/llama.cpp/.git ] && [ ! -f third_party/llama.cpp/.git ]; then
    echo "ERRORE: third_party/llama.cpp non è un checkout git — impossibile verificare pin" >&2
    echo "        atteso pin llama.cpp=$PIN_LLAMA" >&2
    exit 1
fi
LLAMA_HEAD="$(git -C third_party/llama.cpp rev-parse HEAD 2>/dev/null || echo unknown)"
echo "HEAD llama.cpp: $LLAMA_HEAD (atteso $PIN_LLAMA)"
if [ "$LLAMA_HEAD" != "$PIN_LLAMA" ]; then
    echo "ERRORE: pin llama.cpp mismatch (fail-closed)" >&2
    echo "        atteso=$PIN_LLAMA" >&2
    echo "        attuale=$LLAMA_HEAD" >&2
    exit 1
fi
echo "pin llama.cpp OK ($PIN_LLAMA)"

# ---------------------------------------------------------------------------
# Configure — mirror esatto di scripts/build-android.ps1
# ---------------------------------------------------------------------------
echo "--- cmake configure (NDK $ABI, android-$API_LEVEL) ---"
# shellcheck disable=SC2086
cmake -S . -B "$BUILD_DIR" \
    "${GEN_ARGS[@]}" \
    -DCMAKE_TOOLCHAIN_FILE="$TOOLCHAIN" \
    -DANDROID_ABI="$ABI" \
    -DANDROID_PLATFORM="android-$API_LEVEL" \
    -DCMAKE_BUILD_TYPE="$BUILD_TYPE" \
    -DBMOE_BUILD_TESTS=OFF \
    -DGGML_NATIVE=OFF \
    -DGGML_OPENCL=OFF \
    -DGGML_OPENMP=OFF \
    -DGGML_CPU_ARM_ARCH="armv8.2-a+dotprod+fp16" \
    -DLLAMA_CURL=OFF

echo "--- cmake build bmoe-cli (jobs=$JOBS) ---"
cmake --build "$BUILD_DIR" -j "$JOBS" --target bmoe-cli

# ---------------------------------------------------------------------------
# Output path
# ---------------------------------------------------------------------------
BIN=""
for cand in \
    "$BUILD_DIR/cli/bmoe-cli" \
    "$BUILD_DIR/bmoe-cli"
do
    if [ -e "$cand" ]; then
        BIN="$cand"
        break
    fi
done
if [ -z "$BIN" ]; then
    BIN="$(find "$BUILD_DIR" -type f -name 'bmoe-cli' 2>/dev/null | head -n1 || true)"
fi
if [ -z "$BIN" ] || [ ! -e "$BIN" ]; then
    echo "ERRORE: bmoe-cli non prodotto in $BUILD_DIR" >&2
    exit 1
fi
BIN_ABS="$(cd "$(dirname "$BIN")" && pwd)/$(basename "$BIN")"

echo ""
echo "=== BUILD OK (NDK cross) ==="
echo "binario: $BIN_ABS"
if command -v file >/dev/null 2>&1; then
    file "$BIN_ABS" || true
fi
# Non possiamo eseguire --help su host x86_64 (ELF aarch64). Verifica con file/readelf.
if command -v readelf >/dev/null 2>&1; then
    readelf -h "$BIN_ABS" 2>/dev/null | grep -E 'Machine|Class' || true
fi
echo "ABI=$ABI platform=android-$API_LEVEL arch=armv8.2-a+dotprod+fp16 (no i8mm, canonico PS1)"
echo "Per stage jniLibs (come il PS1) copia a mano libbmoe-cli.so + libggml*.so + libllama*.so"
echo "Push su device: adb push $BIN_ABS /data/local/tmp/bmoe-cli && adb shell chmod 755 /data/local/tmp/bmoe-cli"
exit 0
