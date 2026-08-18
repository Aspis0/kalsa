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
