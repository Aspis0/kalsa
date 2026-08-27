@echo off
setlocal
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat" -arch=x64
if errorlevel 1 exit /b 1
set "CMAKE_BUILD_PARALLEL_LEVEL=2"
set "NINJAFLAGS=-j2"
set "PHASE2=C:\Users\gualt\Desktop\Kalsa\moe-experiments\scratchpad\agents\q66-app-lifecycle-s23\phase2"
set "CMAKE=C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe"
set "NINJA=C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\IDE\CommonExtensions\Microsoft\CMake\Ninja\ninja.exe"
set "SRC=C:\Users\gualt\kals-pin"
set "BUILD=C:\Users\gualt\kals-pin\build-phase2-native-q63f"
echo VsDevCmd_errorlevel=%errorlevel%
echo VCToolsInstallDir=%VCToolsInstallDir%
"%CMAKE%" -S "%SRC%" -B "%BUILD%" -G Ninja -DCMAKE_MAKE_PROGRAM="%NINJA%" -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DLLAMA_BUILD_COMMON=ON -DLLAMA_BUILD_TOOLS=ON -DLLAMA_BUILD_EXAMPLES=OFF -DLLAMA_BUILD_TESTS=ON -DLLAMA_BUILD_SERVER=ON -DLLAMA_BUILD_APP=OFF -DLLAMA_BUILD_UI=OFF -DLLAMA_USE_PREBUILT_UI=OFF -DLLAMA_OPENSSL=OFF -DGGML_CPU=ON -DGGML_NATIVE=ON -DGGML_CUDA=OFF -DGGML_HIP=OFF -DGGML_VULKAN=OFF -DGGML_METAL=OFF -DGGML_SYCL=OFF -DGGML_RPC=OFF -DGGML_OPENCL=OFF -DGGML_HEXAGON=OFF > "%PHASE2%\cmake-native.log" 2> "%PHASE2%\cmake-native.err"
if errorlevel 1 exit /b 1
"%CMAKE%" --build "%BUILD%" --config Release --parallel 2 --verbose
exit /b %errorlevel%
