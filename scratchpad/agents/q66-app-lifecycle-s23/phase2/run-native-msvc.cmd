@echo off
setlocal
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat" -arch=x64
set "VSDEV_RC=%errorlevel%"
echo VsDevCmd_errorlevel=%VSDEV_RC%
echo VCToolsInstallDir=%VCToolsInstallDir%
if not exist "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC\14.44.35207\bin\Hostx64\x64\cl.exe" exit /b 1
set "CMAKE_BUILD_PARALLEL_LEVEL=2"
set "NINJAFLAGS=-j2"
"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "C:\Users\gualt\Desktop\Kalsa\moe-experiments\scratchpad\agents\q66-app-lifecycle-s23\phase2\run-native-build.ps1"
exit /b %errorlevel%
