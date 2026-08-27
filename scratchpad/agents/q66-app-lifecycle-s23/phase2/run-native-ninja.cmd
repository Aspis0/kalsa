@echo off
setlocal
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat" -arch=x64
set "CMAKE_BUILD_PARALLEL_LEVEL=2"
set "NINJAFLAGS=-j2"
"C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\IDE\CommonExtensions\Microsoft\CMake\Ninja\ninja.exe" -C "C:\Users\gualt\kals-pin\build-phase2-native" -j2 -v > "C:\Users\gualt\Desktop\Kalsa\moe-experiments\scratchpad\agents\q66-app-lifecycle-s23\phase2\ninja-native.log" 2> "C:\Users\gualt\Desktop\Kalsa\moe-experiments\scratchpad\agents\q66-app-lifecycle-s23\phase2\ninja-native.err"
exit /b %errorlevel%
