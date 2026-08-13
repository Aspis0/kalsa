@echo off
setlocal EnableExtensions
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" || exit /b 1
set ROOT=C:\Users\gualt\Desktop\Kalsa\moe-experiments
cmake --build "%ROOT%\build-pc-k4split" -j 4 --target bmoe-cli
exit /b %ERRORLEVEL%
