#!/data/data/com.termux/files/usr/bin/bash
# =============================================================================
# road1_coopmat2_off.sh — S0.3-bis Road 1 (PREPARE only; do NOT auto-run)
#
# On-device Termux rebuild of llama.cpp @ 5236140e5 with coopmat2 shaders
# DISABLED, bypassing shaderc "Invalid capability operand: 5447" on
# flash_attn_cm2 (S0_REPORT §6).
#
# ---------------------------------------------------------------------------
# FLAG NAME + EVIDENCE (pin 5236140e514d5ceef2b801815b3ba9330f19732e)
# ---------------------------------------------------------------------------
# In ggml/src/ggml-vulkan/CMakeLists.txt the flags are NOT ordinary cache
# options with a durable OFF default. They are set by
# test_shader_extension_support():
#
#   GL_KHR_cooperative_matrix           → GGML_VULKAN_COOPMAT_GLSLC_SUPPORT
#   GL_NV_cooperative_matrix2           → GGML_VULKAN_COOPMAT2_GLSLC_SUPPORT
#   GL_NV_cooperative_matrix_decode_vector
#                                       → GGML_VULKAN_COOPMAT2_DECODE_VECTOR_GLSLC_SUPPORT
#
# Detector logic (same file):
#   run glslc on feature-tests/coopmat2.comp
#   if stderr MATCHES "extension not supported: …" → OFF
#   else → ON + add_compile_definitions + forward -D…=ON to vulkan-shaders-gen
#
# Termux shaderc crashes with "Invalid capability operand: 5447" instead of
# printing "extension not supported", so the else-branch fires and
# flash_attn_cm2.comp is compiled → hard fail.
#
# Therefore: plain
#   -DGGML_VULKAN_COOPMAT2_GLSLC_SUPPORT=OFF
# is NOT sufficient at this pin (the test overwrites it). Mandate name is
# correct as the *macro*, but it must be forced OFF *after* the test, or
# glslc must report "extension not supported".
#
# This script does a one-shot CMakeLists patch (marker S0_3BIS_COOPMAT_FORCE_OFF)
# that forces the three flags OFF and strips them from VULKAN_SHADER_GEN_CMAKE_ARGS.
# =============================================================================
set -euo pipefail

export PREFIX=/data/data/com.termux/files/usr
export PATH="$PREFIX/bin:$PATH"
export LD_LIBRARY_PATH="/vendor/lib64:$PREFIX/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export HOME=/data/data/com.termux/files/home
export DEBIAN_FRONTEND=noninteractive

PIN=5236140e514d5ceef2b801815b3ba9330f19732e
SRC="${SRC:-$HOME/llama.cpp}"
BUILD="${BUILD:-$SRC/build-vulkan-nocoopmat}"
JOBS="${JOBS:-4}"

cd "$SRC"
CUR=$(git rev-parse HEAD)
if [ "$CUR" != "$PIN" ]; then
  echo "ERRORE: HEAD=$CUR atteso=$PIN" >&2
  exit 1
fi

VK_CMAKE=ggml/src/ggml-vulkan/CMakeLists.txt
if ! grep -q 'S0_3BIS_COOPMAT_FORCE_OFF' "$VK_CMAKE"; then
  cp -a "$VK_CMAKE" "${VK_CMAKE}.bak-s03bis"
  python3 - <<'PY'
from pathlib import Path
p = Path("ggml/src/ggml-vulkan/CMakeLists.txt")
t = p.read_text()
marker = "S0_3BIS_COOPMAT_FORCE_OFF"
if marker in t:
    raise SystemExit(0)
needle = "target_link_libraries(ggml-vulkan PRIVATE Vulkan::Vulkan)"
block = f"""# {marker}: Adreno has no coopmat2; Termux shaderc crashes on cap 5447
    # instead of reporting "extension not supported", which falsely enables
    # GGML_VULKAN_COOPMAT2_GLSLC_SUPPORT and then breaks flash_attn_cm2 compile.
    set(GGML_VULKAN_COOPMAT_GLSLC_SUPPORT OFF)
    set(GGML_VULKAN_COOPMAT2_GLSLC_SUPPORT OFF)
    set(GGML_VULKAN_COOPMAT2_DECODE_VECTOR_GLSLC_SUPPORT OFF)
    set(_s03_args "")
    foreach(_a IN LISTS VULKAN_SHADER_GEN_CMAKE_ARGS)
        if(NOT _a MATCHES "GGML_VULKAN_COOPMAT")
            list(APPEND _s03_args "${{_a}}")
        endif()
    endforeach()
    set(VULKAN_SHADER_GEN_CMAKE_ARGS "${{_s03_args}}")
    message(STATUS "{marker}: coopmat/coopmat2 glslc support FORCED OFF")

    {needle}"""
block = block.replace("${{_a}}", "${_a}").replace("${{_s03_args}}", "${_s03_args}")
if needle not in t:
    raise SystemExit("needle not found in CMakeLists.txt — pin layout changed?")
p.write_text(t.replace(needle, block, 1))
print("patched", p)
PY
fi

rm -rf "$BUILD"
cmake -S "$SRC" -B "$BUILD" -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DGGML_NATIVE=OFF \
  -DGGML_OPENCL=OFF \
  -DGGML_VULKAN=ON \
  -DGGML_CPU_ARM_ARCH=armv8.2-a+dotprod+i8mm+fp16 \
  -DLLAMA_CURL=OFF \
  -DGGML_CCACHE=OFF

# Configure log MUST contain:
#   -- S0_3BIS_COOPMAT_FORCE_OFF: coopmat/coopmat2 glslc support FORCED OFF
# Prefer also seeing glslc "not supported" lines, but the force block is the gate.

cmake --build "$BUILD" -j "$JOBS" --target llama-bench

# Presence check (do NOT trust BUILD_EXIT alone — S0 wrapper bug)
if [ ! -x "$BUILD/bin/llama-bench" ]; then
  echo "ERRORE: $BUILD/bin/llama-bench assente" >&2
  exit 1
fi

echo "OK: $BUILD/bin/llama-bench"
echo "VERIFY:"
echo "  grep -R 'S0_3BIS_COOPMAT_FORCE_OFF' $BUILD/CMakeFiles/CMakeOutput.log $BUILD/CMakeCache.txt 2>/dev/null || true"
echo "  # empty stubs only if any cm2 cpp exists:"
echo "  wc -c $BUILD/ggml/src/ggml-vulkan/flash_attn_cm2.comp.cpp 2>/dev/null || echo 'no cm2 cpp (good)'"
echo "  # should NOT see 'Enabling coopmat2 glslc support' without a later FORCED OFF"
echo "READY: smoke with -ngl 1 on a small GGUF (user does this tonight)"
