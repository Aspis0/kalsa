@echo off
setlocal
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat" -arch=x64
if errorlevel 1 exit /b 1
set "CTEST=C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\ctest.exe"
set "BUILD=C:\Users\gualt\kals-pin\build-phase2-native-q63g"
set "PHASE2=C:\Users\gualt\Desktop\Kalsa\moe-experiments\scratchpad\agents\q66-app-lifecycle-s23\phase2"
"%CTEST%" --test-dir "%BUILD%" --output-on-failure -j1 > "%PHASE2%\ctest-all.log" 2> "%PHASE2%\ctest-all.err"
exit /b %errorlevel%
