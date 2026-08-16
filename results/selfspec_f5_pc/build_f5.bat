@echo off
REM Rebuild the F5 CLI. The round-5 build silently produced no new bmoe-cli.exe
REM because a 35B probe held the file open (Windows locks a running exe), while
REM ctest stayed green because the tests relink against the libs. Always verify
REM the exe sha after building, never assume a green ctest means a new binary.
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" >nul
if errorlevel 1 exit /b 1
cd /d "C:\Users\gualt\Desktop\Kalsa\moe-experiments\BigMoeOnEdge-selfspec-f1"
"C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe" --build build-f5 --target bmoe-cli
exit /b %errorlevel%
