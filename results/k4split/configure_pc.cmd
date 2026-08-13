@echo off
setlocal EnableExtensions
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" || exit /b 1
set ROOT=C:\Users\gualt\Desktop\Kalsa\moe-experiments
set NINJA=C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\IDE\CommonExtensions\Microsoft\CMake\Ninja\ninja.exe
cmake -S "%ROOT%\BigMoeOnEdge" -B "%ROOT%\build-pc-k4split" -G Ninja ^
  -DCMAKE_BUILD_TYPE=Release ^
  -DCMAKE_MAKE_PROGRAM="%NINJA%" ^
  -DBMOE_BUILD_TESTS=OFF ^
  -DGGML_NATIVE=OFF ^
  -DGGML_OPENCL=OFF ^
  -DGGML_OPENMP=OFF ^
  -DLLAMA_CURL=OFF
exit /b %ERRORLEVEL%
