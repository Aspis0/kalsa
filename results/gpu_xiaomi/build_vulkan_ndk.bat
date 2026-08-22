@echo off
setlocal EnableExtensions EnableDelayedExpansion

REM =============================================================================
REM build_vulkan_ndk.bat — S0.3-bis Road 2: NDK cross-build llama.cpp @ 5236140e5
REM GGML_VULKAN=ON, arm64-v8a. Host glslc = NDK shader-tools (shaderc v2022.3).
REM Coopmat2 auto-detects OFF (NDK glslc prints "extension not supported").
REM Pattern: lab/llamabench/configure-vulkan.bat (proven).
REM Pin: 5236140e514d5ceef2b801815b3ba9330f19732e
REM =============================================================================

REM Expect vcvars already applied by the launcher (build_vulkan_ndk.ps1).
REM If cl.exe is not on PATH, try to load vcvars64 here with safe quoting.
where cl >nul 2>&1
if errorlevel 1 (
  set "VCVARS=C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
  if not exist "!VCVARS!" (
    echo ERRORE: cl.exe not on PATH and vcvars64.bat missing
    exit /b 2
  )
  call "!VCVARS!"
  if errorlevel 1 (
    echo ERRORE: vcvars64 failed
    exit /b 2
  )
)

set "NDK=C:/Users/gualt/AppData/Local/Android/Sdk/ndk/27.1.12297006"
set "CMAKE=C:/Users/gualt/AppData/Local/Android/Sdk/cmake/3.22.1/bin/cmake.exe"
set "NINJA=C:/Users/gualt/AppData/Local/Android/Sdk/cmake/3.22.1/bin/ninja.exe"
set "SRC=C:/Users/gualt/Desktop/Kalsa/moe-experiments/results/gpu_xiaomi/build/llama.cpp"
set "BUILD=C:/Users/gualt/Desktop/Kalsa/moe-experiments/results/gpu_xiaomi/build/build-vulkan-ndk"
set "GLSLC=%NDK%/shader-tools/windows-x86_64/glslc.exe"
set "SPIRV=C:/Users/gualt/Desktop/Kalsa/lab/llamabench/deps/install"
set "SPIRV_DIR=%SPIRV%/share/cmake/SPIRV-Headers"
set "OUTDIR=C:/Users/gualt/Desktop/Kalsa/moe-experiments/results/gpu_xiaomi"
set "LOG=%OUTDIR%/build_vulkan_ndk.log"
if "%JOBS%"=="" set "JOBS=4"

echo === build_vulkan_ndk.bat entry %DATE% %TIME% === > "%LOG%"
echo PIN=5236140e514d5ceef2b801815b3ba9330f19732e>> "%LOG%"
echo NDK=%NDK%>> "%LOG%"
echo GLSLC=%GLSLC%>> "%LOG%"
echo SRC=%SRC%>> "%LOG%"
echo BUILD=%BUILD%>> "%LOG%"
echo JOBS=%JOBS%>> "%LOG%"
where cl >> "%LOG%" 2>&1
"%GLSLC%" --version >> "%LOG%" 2>&1

if not exist "%SRC%/CMakeLists.txt" (
  echo ERRORE: source tree missing: %SRC% >> "%LOG%"
  exit /b 1
)
if not exist "%GLSLC%" (
  echo ERRORE: glslc missing: %GLSLC% >> "%LOG%"
  exit /b 2
)
if not exist "%SPIRV_DIR%/SPIRV-HeadersConfig.cmake" (
  echo ERRORE: SPIRV-HeadersConfig.cmake missing >> "%LOG%"
  exit /b 2
)

if exist "%BUILD%/CMakeCache.txt" del /f "%BUILD%/CMakeCache.txt"

echo --- cmake configure --- >> "%LOG%"
"%CMAKE%" -S "%SRC%" -B "%BUILD%" -G Ninja ^
  -DCMAKE_TOOLCHAIN_FILE=%NDK%/build/cmake/android.toolchain.cmake ^
  -DANDROID_ABI=arm64-v8a ^
  -DANDROID_PLATFORM=android-29 ^
  -DANDROID_STL=c++_shared ^
  -DCMAKE_BUILD_TYPE=Release ^
  -DCMAKE_MAKE_PROGRAM=%NINJA% ^
  -DBUILD_SHARED_LIBS=OFF ^
  -DLLAMA_CURL=OFF ^
  -DGGML_OPENMP=OFF ^
  -DGGML_NATIVE=OFF ^
  -DGGML_OPENCL=OFF ^
  -DGGML_VULKAN=ON ^
  "-DGGML_CPU_ARM_ARCH=armv8.2-a+dotprod+i8mm+fp16" ^
  -DVulkan_GLSLC_EXECUTABLE=%GLSLC% ^
  -DSPIRV-Headers_DIR=%SPIRV_DIR% ^
  -DCMAKE_PREFIX_PATH=%SPIRV% ^
  "-DCMAKE_CXX_FLAGS=-I%SPIRV%/include" ^
  "-DCMAKE_C_FLAGS=-I%SPIRV%/include" ^
  -DLLAMA_BUILD_TESTS=OFF ^
  -DLLAMA_BUILD_EXAMPLES=OFF ^
  -DLLAMA_BUILD_SERVER=OFF ^
  -DLLAMA_BUILD_TOOLS=ON ^
  -DLLAMA_BUILD_COMMON=ON ^
  -DGGML_CCACHE=OFF >> "%LOG%" 2>&1
set CFG_EXIT=!ERRORLEVEL!
echo CMAKE_CONFIGURE_EXIT=!CFG_EXIT! >> "%LOG%"
if not "!CFG_EXIT!"=="0" (
  echo ERRORE: cmake configure failed EXIT=!CFG_EXIT!
  exit /b 1
)

REM llama-cli is only registered when LLAMA_BUILD_SERVER=ON at pin 5236140e5
echo --- cmake build llama-bench jobs=%JOBS% --- >> "%LOG%"
"%CMAKE%" --build "%BUILD%" -j %JOBS% --target llama-bench >> "%LOG%" 2>&1
set BLD_EXIT=!ERRORLEVEL!
echo CMAKE_BUILD_EXIT=!BLD_EXIT! >> "%LOG%"

if not exist "%BUILD%/bin/llama-bench" (
  echo ERRORE: bin/llama-bench missing BUILD_EXIT=!BLD_EXIT! >> "%LOG%"
  echo BINARY_PRESENT=0 >> "%LOG%"
  exit /b 1
)
echo BINARY_PRESENT=1 >> "%LOG%"

if not exist "%OUTDIR%/bin" mkdir "%OUTDIR%/bin"
copy /Y "%BUILD%\bin\llama-bench" "%OUTDIR%\bin\llama-bench" >nul
if exist "%BUILD%\bin\llama-cli" copy /Y "%BUILD%\bin\llama-cli" "%OUTDIR%\bin\llama-cli" >nul

echo === BUILD OK === >> "%LOG%"
echo bin=%OUTDIR%/bin/llama-bench >> "%LOG%"
exit /b 0
