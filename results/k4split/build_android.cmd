@echo off
setlocal EnableExtensions
set ROOT=C:\Users\gualt\Desktop\Kalsa\moe-experiments
set CMAKE=C:\Users\gualt\AppData\Local\Android\Sdk\cmake\3.22.1\bin\cmake.exe
"%CMAKE%" --build "%ROOT%\build-android-opencl-k4split" -j 4 --target bmoe-cli
exit /b %ERRORLEVEL%
