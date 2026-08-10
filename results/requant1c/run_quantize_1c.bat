@echo off
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" || exit /b 1
cd /d C:\Users\gualt\Desktop\Kalsa\moe-experiments
set BIN=build-pc-quantize\bin
set PATH=%BIN%;%PATH%
set Q8=models\Qwen3.6-35B-A3B-Q8_0.gguf
set IMX=models\imatrix_unsloth.gguf_file
set RECIPE=results\requant1c\tensor_types.txt
set OUT=models\Qwen3.6-35B-A3B-KEXP.gguf
set LOG=results\requant1c\quantize.log
echo === quantize 1c start %DATE% %TIME% === > %LOG%
echo cmd: llama-quantize --allow-requantize --imatrix %IMX% --tensor-type-file %RECIPE% %Q8% %OUT% Q5_K >> %LOG%
"%BIN%\llama-quantize.exe" --allow-requantize --imatrix "%IMX%" --tensor-type-file "%RECIPE%" "%Q8%" "%OUT%" Q5_K >> %LOG% 2>&1
echo EXIT=%ERRORLEVEL% >> %LOG%
echo === quantize 1c end %DATE% %TIME% exit=%ERRORLEVEL% === >> %LOG%
exit /b %ERRORLEVEL%
