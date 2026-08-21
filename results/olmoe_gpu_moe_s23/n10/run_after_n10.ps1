# After OLMoE N>=5 (v1.2) is in the bag: Mellum2 exploratory then KEXP #14.
# Do not run this if n10 aborted (ABORT.md present). Mellum2 failure must not touch OLMoE files.
$ErrorActionPreference = "Stop"
$N10 = Split-Path -Parent $MyInvocation.MyCommand.Path
$Kexp = [IO.Path]::GetFullPath((Join-Path $N10 "..\..\kexp_speed_s23"))
$Report = [IO.Path]::GetFullPath((Join-Path $N10 "..\..\scratchpad\agents\n10-kexp-session\REPORT.md"))

if (Test-Path (Join-Path $N10 "ABORT.md")) {
    throw "OLMoE N>=5 aborted — not starting Mellum2 or KEXP"
}

Write-Host "=== Mellum2 exploratory (best-effort; stop on wall) ==="
$mellumOk = $false
try {
    & pwsh -NoProfile -ExecutionPolicy Bypass -File (Join-Path $N10 "run_mellum2.ps1")
    if ($LASTEXITCODE -eq 0) { $mellumOk = $true }
} catch {
    Write-Host "Mellum2 stopped: $($_.Exception.Message)"
    Add-Content -Path $Report -Value "`n## Mellum2 (exploratory) STOP`n`n$($_.Exception.Message)`nOLMoE dataset untouched.`n" -Encoding utf8
}

Write-Host "=== KEXP #14 exploratory (3 ABBA if battery allows) ==="
& pwsh -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Kexp "run_kexp.ps1") -TargetComplete 3
exit $LASTEXITCODE
