# Kalsa MoE queue #15 — Android Vulkan build (S23 satellite prep)

Status: **complete — Android Vulkan build produced and statically verified; no device execution performed.**

## Approved unblock (in progress)

The NDK header reports Vulkan `1.3.275` (`VK_HEADER_VERSION 275`). The approved matching pins are:

- `KhronosGroup/Vulkan-Headers`, tag `vulkan-sdk-1.3.275.0`, commit `217e93c664ec6704ec2d8c36fa116c1a4a1e2d40`
- `KhronosGroup/SPIRV-Headers`, tag `vulkan-sdk-1.3.275.0`, commit `1c6bb2743599e6eb6f37b2969acc0aef812e32e3`

Both are vendored under `deps/vulkan-android`. `git remote -v` is empty in both clones. Each has the Kalsa blocking `.git/hooks/pre-push` hook installed and executable:

```sh
#!/bin/sh
echo "BLOCKED: never push from this tree (Kalsa policy)." >&2
exit 1
```

SPIRV-Headers was configured and locally installed to `deps/vulkan-android/spirv-install`; the package config is at `spirv-install/share/cmake/SPIRV-Headers/SPIRV-HeadersConfig.cmake`.

## Scope and safety

- Source: `BigMoeOnEdge/third_party/llama.cpp`
- Branch: `kalsa/kernel-s3-repack`
- HEAD: `c77fe1354` (verified before work)
- Existing source worktree was clean; no tracked files were modified.
- No commits, remotes, device access, or device execution.
- Existing `build-android-opencl-s3oracle` was read only and was not touched.
- New build directory reserved for this work: `build-android-vulkan-s15`.

## Reference configuration and intended Vulkan configuration

Mirrored from `build-android-opencl-s3oracle/CMakeCache.txt`:

- Generator: `Ninja`
- CMake: `C:/Users/gualt/AppData/Local/Android/Sdk/cmake/3.22.1/bin/cmake.exe`
- Ninja: `C:/Users/gualt/AppData/Local/Android/Sdk/cmake/3.22.1/bin/ninja.exe`
- Toolchain: `C:/Users/gualt/AppData/Local/Android/Sdk/ndk/27.1.12297006/build/cmake/android.toolchain.cmake`
- ABI/API: `arm64-v8a`, `android-29`
- STL: `c++_shared`
- Build type: `Release`
- `BUILD_SHARED_LIBS=ON`
- `GGML_VULKAN=ON`
- `GGML_OPENCL=OFF`
- Intended targets: `llama-bench`, `test-backend-ops`, `ggml-vulkan`

The reference cache also has `GGML_CPU_REPACK=ON`, `GGML_CPU_ARM_ARCH=armv8.2-a+dotprod+i8mm+fp16`, `LLAMA_BUILD_TOOLS=ON`, and `LLAMA_BUILD_TESTS=ON`; these were to be retained for the Vulkan configure.

The corrected configure cache confirms those values plus `Vulkan_GLSLC_EXECUTABLE` set to the NDK-bundled compiler and `Vulkan_INCLUDE_DIR` set to the NDK sysroot include directory. `SPIRV-Headers_DIR` remains `SPIRV-Headers_DIR-NOTFOUND`, which is the fatal blocker.

## Incremental obstacle log

1. The NDK contains the required host shader compiler at:
   `C:/Users/gualt/AppData/Local/Android/Sdk/ndk/27.1.12297006/shader-tools/windows-x86_64/glslc.exe`.
2. The same NDK contains target C Vulkan headers under
   `.../toolchains/llvm/prebuilt/windows-x86_64/sysroot/usr/include/vulkan`
   and arm64 API-29 `libvulkan.so` under
   `.../toolchains/llvm/prebuilt/windows-x86_64/sysroot/usr/lib/aarch64-linux-android/29`.
3. No `vulkan.hpp` was found on `C:/` and no Vulkan SDK install or `VULKAN_SDK` environment variable was present.
4. The NDK has SPIR-V header files from its shaderc sources, but no `SPIRV-HeadersConfig.cmake` package config.
5. This checkout's `ggml/src/ggml-vulkan/CMakeLists.txt` requires both `find_package(Vulkan COMPONENTS glslc REQUIRED)` and `find_package(SPIRV-Headers CONFIG REQUIRED)`; `ggml-vulkan.cpp` directly includes `<vulkan/vulkan.hpp>`.
6. First configure invocation failed before project discovery because PowerShell passed native-command arguments literally as `$tc`/`$ninja`/`$glslc`; the corrected invocation quoted the expanded `-D...=<path>` arguments.
7. Corrected configure reached the Android compiler, found Vulkan using the NDK loader/header paths and NDK `glslc`, then failed at `ggml/src/ggml-vulkan/CMakeLists.txt:14`:

   ```text
   Could not find a package configuration file provided by "SPIRV-Headers"
   SPIRV-HeadersConfig.cmake / spirv-headers-config.cmake
   ```

   The complete corrected configure transcript is in `build-android-vulkan-s15/configure-corrected.log`.
8. The host compiler needed for the external `vulkan-shaders-gen` project is present as Visual Studio Build Tools `cl.exe`, but it is not on the current PATH. This is an environment setup issue, not an additional package-install requirement; a VS Build Tools developer environment or an explicit host toolchain file would be needed after the header/package blocker is removed.
9. The first vendored-package build reached shader generation and Android compilation, then failed because this checkout calls `find_package(SPIRV-Headers)` without linking/including the package target. `ggml-vulkan.cpp` consequently could not find `spirv/unified1/spirv.hpp`. The package is present; the continuation adds its installed include root through `CMAKE_CXX_FLAGS` without modifying tracked source.
10. Local SPIRV-Headers install configure initially failed with `No CMAKE_CXX_COMPILER could be found`; retrying with a raw backslash `cl.exe` path triggered CMake 3.22 `Invalid character escape '\P'`; using forward slashes found MSVC but failed the link test because `rc`/manifest tools were not on PATH. Running CMake from the installed VS Build Tools developer environment resolved all three host-only issues. The developer prompt emitted a non-fatal `vswhere.exe` warning but configured successfully.
11. The NDK `glslc` reported the optional extensions `GL_KHR_cooperative_matrix`, `GL_NV_cooperative_matrix2`, `GL_NV_cooperative_matrix_decode_vector`, `GL_EXT_integer_dot_product`, and `GL_EXT_bfloat16` as unsupported. CMake handled these as feature-disable messages; they were not build errors. OpenSSL was also absent and HTTPS support was disabled, unrelated to this offline build.

## Final configure/build result

Final configure succeeded in `build-android-vulkan-s15` with the vendored packages and these additional integration settings:

- `Vulkan_INCLUDE_DIR=C:/Users/gualt/Desktop/Kalsa/moe-experiments/deps/vulkan-android/Vulkan-Headers/include`
- `SPIRV-Headers_DIR=C:/Users/gualt/Desktop/Kalsa/moe-experiments/deps/vulkan-android/spirv-install/share/cmake/SPIRV-Headers`
- `CMAKE_PREFIX_PATH=C:/Users/gualt/Desktop/Kalsa/moe-experiments/deps/vulkan-android/spirv-install`
- `CMAKE_CXX_FLAGS=-IC:/Users/gualt/Desktop/Kalsa/moe-experiments/deps/vulkan-android/spirv-install/include` (needed because this checkout finds, but does not consume, the SPIRV-Headers target)
- `Vulkan_LIBRARY` remains the NDK API-29 arm64 `libvulkan.so`.

Requested targets completed successfully: `ggml-vulkan`, `test-backend-ops`, and `llama-bench` (including `libllama-bench-impl.so`). The final Ninja pass ended with exit code 0; it emitted a non-fatal `premature end of file; recovering` warning.

No Android binary was executed.

## Artifacts and static checks

SHA-256 values from `build-android-vulkan-s15/bin`:

| Artifact | Size (bytes) | SHA-256 |
|---|---:|---|
| `libggml-base.so` | 6,103,488 | `5B4685C9B4564907DF918E1BF2CD71887C8EBFA8AD18CB2012F4F2F349F7C35D` |
| `libggml-cpu.so` | 5,165,048 | `652E311C73597EE7CD74B0DBEEF446567B337C07D25A5F05C942F8E2E86D8A3C` |
| `libggml-vulkan.so` | 47,011,288 | `5FF2DB3D669C51BEB9A6A6D0DAB99BDCCCBBBDCEAA49FD4BCC3A4A4D86AAF297` |
| `libggml.so` | 537,112 | `367CCF39E5D7BE6193331AA82CB1401582CD993E00F97217E9DF1FF86E7331BC` |
| `libllama-bench-impl.so` | 4,253,152 | `36B90CD131A2613D70F263F34A3721FFCDC86B6C9BBB5C9B5E103C9B0088FD35` |
| `llama-bench` | 7,592 | `B4E9476EE03F270C85D0E9EB2DD578089756075D131DD058456BB039182C7B21` |
| `test-backend-ops` | 10,182,432 | `C24B311132021A968AB0669A60ED60DC3604CA47166D89E778F6AD77726C6178` |

Supporting shared libraries also produced by this build:

| Artifact | Size (bytes) | SHA-256 |
|---|---:|---|
| `libllama.so` | 39,807,616 | `A14DBA6F891864EBC20C4EEBE99A9F33131F73293DC52F0C40BEA01F97E4123F` |
| `libllama-common.so` | 78,377,224 | `66E68B1BC372860D1D93DB298292A6C3395EFCF9AFAA546669AC9818C6B13212` |

## Static sanity checks

`file` and NDK `llvm-readelf -h` were run on all nine Android `.so`/binary artifacts listed above. Every one reports ELF64, `ARM aarch64` / `Machine: AArch64`, Android 29, NDK r27b. The PIE executables report ELF `DYN`, as expected; no file was executed.

`llvm-readelf --dyn-syms --wide build-android-vulkan-s15/bin/libggml-vulkan.so` confirms these exported global registration/backend symbols:

- `ggml_backend_vk_reg`
- `ggml_backend_vk_init`
- `ggml_backend_vk_buffer_type`

Its dynamic dependencies include `libvulkan.so`, `libc++_shared.so`, `libdl.so`, and `libc.so`.

## Source support-table check

The source tables do include all three requested types:

| `MUL_MAT_ID` source type | Backend source support | Runtime qualification |
|---|---|---|
| `Q4_K` | **Yes** | May be disabled if the selected Vulkan device fails the shared-memory checks. |
| `Q2_K` | **Yes** | Same qualification. |
| `Q3_K` | **Yes** | Same qualification. |

Evidence: `ggml-vulkan.cpp` registers `pipeline_dequant_mul_mat_mat_id[GGML_TYPE_Q2_K]`, `[GGML_TYPE_Q3_K]`, and `[GGML_TYPE_Q4_K]` in the cooperative-matrix-2, cooperative-matrix, and subgroup/non-cooperative `MUL_MAT_ID` pipeline tables (for example lines 4330–4332, 4453–4455, and 4580–4582). The `ggml_vk_is_supported_op` table also lists all three at lines 17254–17256. Runtime initialization can clear the corresponding `mul_mat_id_{s,m,l}` flags when `ggml_vk_matmul_shmem_support(..., true, type)` fails (lines 3990–4000). Therefore Q4_K is source-supported for OLMoE and Q2_K/Q3_K are source-supported for a possible KEXP arm, but S23 runtime capability still must be checked on-device.

## Proposed on-device satellite run plan (once a Vulkan build exists)

- Use the same on-device OLMoE-1B-7B `Q4_K_M` model for both backends (model SHA-256 prefix/reference: `3bd9ec48`, already on the S23).
- Keep `ngl` identical between Vulkan and OpenCL.
- Use plugged exploratory ABBA-interleaved measurements: Vulkan → OpenCL → OpenCL → Vulkan, repeated as appropriate.
- Deliverable: Vulkan/OpenCL performance ratio.
- Caveat: plugged absolute timings are not comparable with the prior unplugged sessions; compare the paired ratio, not plugged absolutes across sessions.
