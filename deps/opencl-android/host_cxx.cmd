@echo off
setlocal EnableExtensions
REM cmake invokes: host_cxx.cmd -O2 -std=c++17 -o OUT.exe SRC.cpp
REM We copy a prebuilt MSVC llama-ui-embed-host.exe (same embed.cpp from the fork).
set "PREBUILT=C:\Users\gualt\Desktop\Kalsa\moe-experiments\deps\opencl-android\llama-ui-embed-host.exe"
:parse
if "%~1"=="" goto fail
if /I "%~1"=="-o" (
  if "%~2"=="" goto fail
  copy /Y "%PREBUILT%" "%~2" >nul
  exit /b %ERRORLEVEL%
)
shift
goto parse
:fail
echo host_cxx: usage: host_cxx.cmd -o OUT.exe SRC.cpp 1>&2
exit /b 1
