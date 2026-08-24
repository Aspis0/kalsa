@echo off
setlocal
set REPO=C:\Users\gualt\Desktop\Kalsa\moe-experiments
set BUILD=%REPO%\build-android-hexagon-q53
set CMAKE=C:\Users\gualt\AppData\Local\Android\Sdk\cmake\3.22.1\bin\cmake.exe
set LOG=%REPO%\scratchpad\agents\q53-v73-npu-correctness\build_q53_ppl.log
set RC=%REPO%\scratchpad\agents\q53-v73-npu-correctness\build_q53_ppl.rc
echo BUILD_START %date% %time% > "%LOG%"
"%CMAKE%" --build "%BUILD%" --target llama-perplexity -j 4 >> "%LOG%" 2>&1
echo %ERRORLEVEL% > "%RC%"
echo BUILD_END %date% %time% >> "%LOG%"
exit /b %ERRORLEVEL%
