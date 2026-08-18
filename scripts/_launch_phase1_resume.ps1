$root = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments'
$script = Join-Path $root 'scripts\resume_marco_phase1_quality.ps1'
$outLog = Join-Path $root 'logs\marco_phase1_resume.out.log'
$errLog = Join-Path $root 'logs\marco_phase1_resume.err.log'
$pidFile = Join-Path $root 'logs\marco_phase1_resume.pid.txt'
$wrapper = Join-Path $root 'scripts\_run_phase1_resume_wrapper.ps1'

@'
$root = "C:\Users\gualt\Desktop\Kalsa\moe-experiments"
$script = Join-Path $root "scripts\resume_marco_phase1_quality.ps1"
$outLog = Join-Path $root "logs\marco_phase1_resume.out.log"
$errLog = Join-Path $root "logs\marco_phase1_resume.err.log"
$ErrorActionPreference = "Continue"
"=== relaunch $(Get-Date -Format o) ===" | Add-Content $outLog -Encoding utf8
try {
  & $script *>&1 | ForEach-Object {
    $line = "$_"
    Add-Content -Path $outLog -Value $line -Encoding utf8
    Write-Host $line
  }
} catch {
  $_ | Out-String | Add-Content $errLog -Encoding utf8
  throw
}
'@ | Set-Content $wrapper -Encoding utf8

$p = Start-Process -FilePath powershell.exe `
  -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $wrapper) `
  -WindowStyle Hidden `
  -PassThru

"resume_pid=$($p.Id)" | Set-Content $pidFile -Encoding utf8
Write-Output "started pid=$($p.Id)"
Start-Sleep -Seconds 3
if (Get-Process -Id $p.Id -ErrorAction SilentlyContinue) {
  Write-Output "parent ALIVE"
} else {
  Write-Output "parent EXITED early"
}
if (Test-Path $outLog) {
  Write-Output "--- out tail ---"
  Get-Content $outLog -Tail 15
}
