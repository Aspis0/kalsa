@echo off
setlocal EnableExtensions
set ROOT=C:\Users\gualt\Desktop\Kalsa\moe-experiments
set GATE=%ROOT%\results\requant1c\q8_gate.txt
set LOCK=%ROOT%\results\requant1c\quantize.lock
set EXPECTED_SHA=d1a395809f65a43a13ad119eb4e7acdef1ac6d68120f39902c8ab96e72794a59
set EXPECTED_SIZE=36903140320
set Q8=%ROOT%\models\Qwen3.6-35B-A3B-Q8_0.gguf
set IMX=%ROOT%\models\imatrix_unsloth.gguf_file
set RECIPE=%ROOT%\results\requant1c\tensor_types.txt
set OUT=%ROOT%\models\Qwen3.6-35B-A3B-KEXP.gguf
set LOG=%ROOT%\results\requant1c\quantize.log
set BIN=%ROOT%\build-pc-quantize\bin

findstr /B /C:"Q8_GATE=PASS" "%GATE%" >nul
if errorlevel 1 (
  echo REFUSED: q8 gate not PASS
  exit /b 99
)

mkdir "%LOCK%" 2>nul
if errorlevel 1 (
  echo REFUSED: quantize.lock exists
  exit /b 96
)

if exist "%OUT%" (
  echo REFUSED: output already exists
  rmdir "%LOCK%" 2>nul
  exit /b 98
)
if not exist "%BIN%\llama-quantize.exe" ( rmdir "%LOCK%" 2>nul & exit /b 97 )
if not exist "%Q8%" ( rmdir "%LOCK%" 2>nul & exit /b 95 )
if not exist "%IMX%" ( rmdir "%LOCK%" 2>nul & exit /b 94 )
if not exist "%RECIPE%" ( rmdir "%LOCK%" 2>nul & exit /b 93 )

for %%A in ("%Q8%") do set SZ=%%~zA
if not "%SZ%"=="%EXPECTED_SIZE%" (
  echo REFUSED: size %SZ%
  rmdir "%LOCK%" 2>nul
  exit /b 92
)

REM certutil hash (robust)
set GOTSHA=
for /f "usebackq tokens=*" %%H in (`certutil -hashfile "%Q8%" SHA256 ^| findstr /R /C:"^[0-9a-fA-F][0-9a-fA-F]*$"`) do set GOTSHA=%%H
if /I not "%GOTSHA%"=="%EXPECTED_SHA%" (
  echo REFUSED: sha got=%GOTSHA% expected=%EXPECTED_SHA%
  rmdir "%LOCK%" 2>nul
  exit /b 91
)

for /f "usebackq delims=" %%F in (`powershell -NoProfile -Command "[int64]((Get-PSDrive C).Free)"`) do set FREE=%%F
powershell -NoProfile -Command "if ([int64]%FREE% -lt 25GB) { exit 1 } else { exit 0 }"
if errorlevel 1 (
  echo REFUSED: disk
  rmdir "%LOCK%" 2>nul
  exit /b 90
)

call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" || ( rmdir "%LOCK%" 2>nul & exit /b 1 )
cd /d %ROOT%
set PATH=%BIN%;%PATH%

echo === quantize 1c SAFE start %DATE% %TIME% === > %LOG%
type "%GATE%" >> %LOG%
echo fresh_sha=%GOTSHA% size=%SZ% free=%FREE% >> %LOG%
echo cmd: llama-quantize --allow-requantize --imatrix models\imatrix_unsloth.gguf_file --tensor-type-file results\requant1c\tensor_types.txt models\Qwen3.6-35B-A3B-Q8_0.gguf models\Qwen3.6-35B-A3B-KEXP.gguf Q5_K >> %LOG%

start "quantize-1c" /WAIT /BELOWNORMAL "%BIN%\llama-quantize.exe" --allow-requantize --imatrix "%IMX%" --tensor-type-file "%RECIPE%" "%Q8%" "%OUT%" Q5_K >> %LOG% 2>&1
set EC=%ERRORLEVEL%
echo EXIT=%EC% >> %LOG%
echo === quantize 1c end %DATE% %TIME% exit=%EC% === >> %LOG%
rmdir "%LOCK%" 2>nul
exit /b %EC%
