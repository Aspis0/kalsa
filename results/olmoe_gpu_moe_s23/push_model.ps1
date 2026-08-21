# Push OLMoE Q4_K_M + confirm noextra impl. Does NOT run llama-bench.
# Safe while plugged (I/O only). Green-light runs still wait for unplugged.
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $Root "_lib.ps1")
Assert-UsbS23

$PcGguf = [IO.Path]::GetFullPath((Join-Path $Root "..\..\models\$OlmoeName"))
if (-not (Test-Path $PcGguf)) { throw "missing PC GGUF: $PcGguf" }

Write-Host "PC GGUF $PcGguf"
$h = (Get-FileHash -Algorithm SHA256 $PcGguf).Hash.ToLower()
if ($h -ne $PinOlmoe) { throw "PC GGUF sha $h != $PinOlmoe" }

Write-Host "=== push GGUF (may take a few minutes) ==="
Invoke-S23 @("push", $PcGguf, "$DevDir/$OlmoeName")
CheckSha $OlmoeName $PinOlmoe

$implPc = [IO.Path]::GetFullPath((Join-Path $Root "..\oomwall_s23\staging\noextra\libllama-bench-impl.so"))
if (-not (Test-Path $implPc)) { throw "missing noextra impl: $implPc" }
Write-Host "=== ensure noextra impl $PinImplNoex ==="
Invoke-S23 @("push", $implPc, "$DevDir/libllama-bench-impl.so")
Assert-NoextraImpl
Write-Host "push_model done. Device has OLMoE + noextra impl. Do not run speed cells until unplugged."
