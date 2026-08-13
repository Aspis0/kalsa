@echo off
setlocal EnableExtensions
set ROOT=C:\Users\gualt\Desktop\Kalsa\moe-experiments
set NDK=C:\Users\gualt\AppData\Local\Android\Sdk\ndk\27.1.12297006
set CMAKE=C:\Users\gualt\AppData\Local\Android\Sdk\cmake\3.22.1\bin\cmake.exe
set NINJA=C:\Users\gualt\AppData\Local\Android\Sdk\cmake\3.22.1\bin\ninja.exe
set OCL=%ROOT%\deps\opencl-android

"%CMAKE%" -S "%ROOT%\BigMoeOnEdge" -B "%ROOT%\build-android-opencl-k4split" -G Ninja ^
  -DCMAKE_TOOLCHAIN_FILE="%NDK%\build\cmake\android.toolchain.cmake" ^
  -DANDROID_ABI=arm64-v8a ^
  -DANDROID_PLATFORM=android-29 ^
  -DANDROID_STL=c++_shared ^
  -DCMAKE_BUILD_TYPE=Release ^
  -DCMAKE_MAKE_PROGRAM="%NINJA%" ^
  -DBMOE_BUILD_TESTS=OFF ^
  -DBUILD_SHARED_LIBS=OFF ^
  -DGGML_BACKEND_DL=OFF ^
  -DGGML_NATIVE=OFF ^
  -DGGML_OPENCL=ON ^
  -DGGML_OPENCL_USE_ADRENO_KERNELS=ON ^
  -DGGML_OPENCL_EMBED_KERNELS=ON ^
  -DGGML_VULKAN=OFF ^
  -DGGML_OPENMP=OFF ^
  -DGGML_CPU_ARM_ARCH=armv8.2-a+dotprod+i8mm+fp16 ^
  -DLLAMA_CURL=OFF ^
  -DGGML_CCACHE=OFF ^
  -DOpenCL_INCLUDE_DIR="%OCL%\OpenCL-Headers" ^
  -DOpenCL_LIBRARY="%OCL%\icd-build-android\libOpenCL.so"
exit /b %ERRORLEVEL%
