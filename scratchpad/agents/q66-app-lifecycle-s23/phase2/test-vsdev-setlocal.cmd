@echo off
setlocal
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat" -arch=x64
set "VSDEV_RC=%errorlevel%"
echo AFTER_VSDEV_ERRORLEVEL=%VSDEV_RC%
where cl
exit /b 0
