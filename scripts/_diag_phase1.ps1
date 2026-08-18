$root = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\marco_phase1'
Write-Output '=== STATUS ==='
foreach ($f in @('QUALITY_STATUS.txt', 'VERDICT.md')) {
    $p = Join-Path $root $f
    if (Test-Path $p) {
        Write-Output "FOUND $f"
        Get-Content $p -Raw
    } else {
        Write-Output "MISSING $f"
    }
}
Write-Output '=== PROCS bmoe ==='
Get-Process -Name 'bmoe-cli' -ErrorAction SilentlyContinue | Format-Table Id, StartTime, CPU -AutoSize
$raw = Get-Content 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\logs\marco_phase1_resume.pid.txt' -Raw -ErrorAction SilentlyContinue
Write-Output "pidfile=$raw"
if ($raw -match '(\d+)') {
    $id = [int]$Matches[1]
    try {
        Get-Process -Id $id | Format-List Id, ProcessName, StartTime
    } catch {
        Write-Output "parent $id DEAD"
    }
}
Write-Output '=== WATCH TAIL ==='
Get-Content 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\logs\marco_phase1_watch.log' -Tail 20
Write-Output '=== RESUME OUT ==='
Get-Content 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\logs\marco_phase1_resume.out.log' -Tail 50
Write-Output '=== RESUME ERR ==='
Get-Content 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\logs\marco_phase1_resume.err.log' -Tail 40 -ErrorAction SilentlyContinue
Write-Output '=== A1 full files ==='
Get-ChildItem (Join-Path $root 'A1\full') -Recurse -File -ErrorAction SilentlyContinue |
    Select-Object FullName, Length, LastWriteTime |
    Format-Table -AutoSize
Write-Output '=== A2/A3 full ==='
foreach ($c in @('A2\full', 'A3\full')) {
    $d = Join-Path $root $c
    if (Test-Path $d) {
        Write-Output "HAS $c"
        Get-ChildItem $d -Recurse -File | Select-Object FullName, Length, LastWriteTime | Format-Table -AutoSize
    } else {
        Write-Output "NO $c"
    }
}
