$root = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments'
$script = Join-Path $root 'scripts\dl_marco_q8_imatrix.ps1'
$outLog = Join-Path $root 'logs\dl-marco-q8.outer.log'
$errLog = Join-Path $root 'logs\dl-marco-q8.outer.err.log'
$pidFile = Join-Path $root 'logs\dl-marco-q8.pid.txt'
# Best-effort keep awake (may fail without admin)
try { powercfg /change standby-timeout-ac 0 | Out-Null } catch {}
try { powercfg /change hibernate-timeout-ac 0 | Out-Null } catch {}
$p = Start-Process -FilePath powershell.exe `
    -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $script) `
    -RedirectStandardOutput $outLog `
    -RedirectStandardError $errLog `
    -WindowStyle Hidden `
    -PassThru
"dl_pid=$($p.Id)" | Set-Content $pidFile -Encoding utf8
Write-Output "started pid=$($p.Id)"
Start-Sleep -Seconds 4
if (Get-Process -Id $p.Id -ErrorAction SilentlyContinue) { Write-Output 'parent ALIVE' } else { Write-Output 'parent EXITED' }
if (Test-Path (Join-Path $root 'logs\dl-marco-q8.log')) {
    Get-Content (Join-Path $root 'logs\dl-marco-q8.log') -Tail 15
}
Get-Item (Join-Path $root 'models\Marco-Mini-Instruct.Q8_0.gguf') -ErrorAction SilentlyContinue |
    Select-Object Length, LastWriteTime
