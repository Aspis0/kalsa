@echo off
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
set CMAKE=C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe
set NINJA=C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\IDE\CommonExtensions\Microsoft\CMake\Ninja\ninja.exe
cd /d C:\Users\gualt\Desktop\Kalsa\moe-experiments
if not exist build-llama-pc mkdir build-llama-pc
"%CMAKE%" -S BigMoeOnEdge\third_party\llama.cpp -B build-llama-pc -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_MAKE_PROGRAM="%NINJA%" -DGGML_NATIVE=ON -DLLAMA_BUILD_SERVER=ON -DGGML_CUDA=OFF
if errorlevel 1 exit /b 1
"%CMAKE%" --build build-llama-pc --config Release -j 8 --target llama-server llama-cli llama-bench
