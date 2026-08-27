@echo off
setlocal
set "LOG=C:\Users\gualt\Desktop\Kalsa\moe-experiments\scratchpad\agents\q66-app-lifecycle-s23\phase2\vsdev-redirect-test.log"
set "ERR=C:\Users\gualt\Desktop\Kalsa\moe-experiments\scratchpad\agents\q66-app-lifecycle-s23\phase2\vsdev-redirect-test.err"
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat" -arch=x64 > "%LOG%" 2> "%ERR%"
set "VSDEV_RC=%errorlevel%"
echo VsDevCmd_errorlevel=%VSDEV_RC%>> "%LOG%"
where cl >> "%LOG%" 2>> "%ERR%"
echo AFTER_WHERE_ERRORLEVEL=%errorlevel%>> "%LOG%"
exit /b 0
