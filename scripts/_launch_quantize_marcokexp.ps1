$root = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments'
$script = Join-Path $root 'scripts\quantize_marcokexp_both.ps1'
$outLog = Join-Path $root 'logs\quantize-marcokexp.outer.log'
$errLog = Join-Path $root 'logs\quantize-marcokexp.outer.err.log'
$pidFile = Join-Path $root 'logs\quantize-marcokexp.pid.txt'
try { powercfg /change standby-timeout-ac 0 | Out-Null } catch {}
$p = Start-Process -FilePath powershell.exe `
    -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $script) `
    -RedirectStandardOutput $outLog `
    -RedirectStandardError $errLog `
    -WindowStyle Hidden `
    -PassThru
"quantize_pid=$($p.Id)" | Set-Content $pidFile -Encoding utf8
Write-Output "started pid=$($p.Id)"
Start-Sleep -Seconds 5
if (Get-Process -Id $p.Id -ErrorAction SilentlyContinue) { Write-Output 'parent ALIVE' } else { Write-Output 'parent EXITED' }
if (Test-Path (Join-Path $root 'logs\quantize-marcokexp.log')) {
    Get-Content (Join-Path $root 'logs\quantize-marcokexp.log') -Tail 20
}
Get-Content $outLog -Tail 15 -ErrorAction SilentlyContinue
