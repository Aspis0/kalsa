@echo off
setlocal
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
set "VCVARS_RC=%errorlevel%"
echo AFTER_VCVARS_ERRORLEVEL=%VCVARS_RC%
echo VCToolsInstallDir=%VCToolsInstallDir%
echo VCINSTALLDIR=%VCINSTALLDIR%
echo PATH=%PATH%
if exist "%VCToolsInstallDir%bin\Hostx64\x64\cl.exe" echo CL_ABSOLUTE_EXISTS
echo BEFORE_CMAKE
"C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe" --version
echo CMAKE_ERRORLEVEL=%errorlevel%
echo BEFORE_NINJA
"C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\IDE\CommonExtensions\Microsoft\CMake\Ninja\ninja.exe" --version
echo NINJA_ERRORLEVEL=%errorlevel%
echo AFTER_NINJA
exit /b 0
