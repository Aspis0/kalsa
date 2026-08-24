@echo off
setlocal
set REPO=C:\Users\gualt\Desktop\Kalsa\moe-experiments
set SRC=%REPO%\upstream-hexagon\llama-q53-3f545be
set BUILD=%REPO%\build-android-hexagon-q53
set CMAKE=C:\Users\gualt\AppData\Local\Android\Sdk\cmake\3.22.1\bin\cmake.exe
set NINJA=C:\Users\gualt\AppData\Local\Android\Sdk\cmake\3.22.1\bin\ninja.exe
set TOOLCHAIN=C:\Users\gualt\AppData\Local\Android\Sdk\ndk\27.1.12297006\build\cmake\android.toolchain.cmake
set SDK=C:\Qualcomm\Hexagon_SDK\6.6.0.0
set TOOLS=%SDK%\tools\HEXAGON_Tools\19.0.07
"%CMAKE%" -S "%SRC%" -B "%BUILD%" -G Ninja -DCMAKE_MAKE_PROGRAM="%NINJA%" -DCMAKE_TOOLCHAIN_FILE="%TOOLCHAIN%" -DANDROID_ABI=arm64-v8a -DANDROID_PLATFORM=android-31 -DCMAKE_BUILD_TYPE=Release -DCMAKE_C_FLAGS="-march=armv8.7a+fp16+dotprod+i8mm -fvectorize -ffp-model=fast -fno-finite-math-only -flto -D_GNU_SOURCE" -DCMAKE_CXX_FLAGS="-march=armv8.7a+fp16+dotprod+i8mm -fvectorize -ffp-model=fast -fno-finite-math-only -flto -D_GNU_SOURCE" -DCMAKE_C_FLAGS_RELEASE="-O3 -DNDEBUG" -DCMAKE_CXX_FLAGS_RELEASE="-O3 -DNDEBUG" -DCMAKE_EXPORT_COMPILE_COMMANDS=ON -DHEXAGON_SDK_ROOT="%SDK%" -DHEXAGON_TOOLS_ROOT="%TOOLS%" -DPREBUILT_LIB_DIR=android_aarch64 -DGGML_OPENMP=OFF -DGGML_LLAMAFILE=OFF -DGGML_OPENCL=OFF -DGGML_HEXAGON=ON -DLLAMA_OPENSSL=OFF -DLLAMA_BUILD_TESTS=ON -DLLAMA_BUILD_TOOLS=ON
exit /b %ERRORLEVEL%
