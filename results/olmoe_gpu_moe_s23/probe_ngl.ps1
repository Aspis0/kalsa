# Feasibility probe: OLMoE experts-GPU at a given -ngl (default 4).
# NOEXTRA impl. -fa off. LOG_ALLOC off. REFUSES if plugged.
# Usage: pwsh probe_ngl.ps1 [-Ngl 4]
param([int]$Ngl = 4)
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $Root "_lib.ps1")
Assert-UsbS23
Assert-Unplugged
Assert-NoextraImpl
CheckSha $OlmoeName $PinOlmoe

Invoke-S23 @("push", (Join-Path $Root "one_cell.sh"), "$DevDir/one_cell.sh")
AdbOut "chmod 755 $DevDir/one_cell.sh" | Out-Null
AdbOut "mkdir -p $DevDir/logs" | Out-Null

Write-Host "PROBE ngl=$Ngl experts=GPU (no -ncmoe). Short -p 0 -n 16. Watch MemAvailable."
$pre = Write-Sensors "PROBE_PRE"
$errRemote = "$DevDir/logs/probe_ngl${Ngl}.err"
$outLog = Join-Path $Root "probe_ngl${Ngl}.stdout.txt"
$cmd = "sh $DevDir/one_cell.sh -ngl $Ngl -p 0 -n 16 -r 1 2>$errRemote"
& $Adb -s $UsbSerial shell $cmd 2>&1 | Tee-Object -FilePath $outLog
$rc = $LASTEXITCODE
$post = Write-Sensors "PROBE_POST"
Write-Host "probe rc=$rc ngl=$Ngl (0 = llama-bench lived). If power-off, STOP and do not raise ngl."
Write-Host "Suggested ladder if this lived: 4 -> 8 -> 12 -> 16. Do not jump to 99. Adreno scratch ~377 MiB plus the GPU slice."
Write-Host "Write chosen ngl to $Root\ngl.txt then run_ab.ps1"
if ($rc -eq 0) {
    Set-Content -Path (Join-Path $Root "ngl.txt") -Value "$Ngl" -Encoding ascii
}
exit $rc
