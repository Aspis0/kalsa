$ErrorActionPreference = 'Continue'
$status = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\marcokexp\QUALITY_STATUS.txt'
$watch = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\logs\marcokexp_quality_watch.log'
$log = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\logs\marcokexp_quality.log'
Add-Content $watch ('[watch-start ' + (Get-Date -Format o) + ']')
while ($true) {
    $st = if (Test-Path $status) { (Get-Content $status -Raw).Trim() } else { 'MISSING' }
    $bmoe = Get-Process -Name 'bmoe-cli' -ErrorAction SilentlyContinue
    $alive = if ($bmoe) { 'bmoe=' + $bmoe.Id } else { 'bmoe=NONE' }
    $tail = ''
    if (Test-Path $log) {
        $tail = ((Get-Content $log -Tail 3) -join ' | ') -replace '\s+', ' '
    }
    Add-Content $watch ('[watch {0}] status={1} {2} {3}' -f (Get-Date -Format o), $st, $alive, $tail)
    if ($st -eq 'DONE') {
        Write-Output 'DONE marcoKEXP quality'
        if (Test-Path 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\marcokexp\VERDICT.md') {
            Get-Content 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\marcokexp\VERDICT.md' -Raw
        }
        exit 0
    }
    if ($st -like 'FAIL*') {
        Write-Output ('FAILED quality status=' + $st)
        if (Test-Path $log) { Get-Content $log -Tail 30 }
        exit 2
    }
    # parent dead + no bmoe + still RUNNING = crash
    $parentAlive = Get-Process -Id 4568 -ErrorAction SilentlyContinue
    if ($st -eq 'RUNNING' -and -not $parentAlive -and -not $bmoe) {
        Write-Output 'FAILED quality parent and bmoe dead while RUNNING'
        if (Test-Path $log) { Get-Content $log -Tail 40 }
        exit 2
    }
    Start-Sleep -Seconds 180
}
