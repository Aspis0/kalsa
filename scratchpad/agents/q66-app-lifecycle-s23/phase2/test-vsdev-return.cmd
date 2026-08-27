@echo off
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat" -arch=x64
echo AFTER_VSDEV_ERRORLEVEL=%errorlevel%
where cl
exit /b 0
