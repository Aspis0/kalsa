# Watch marco phase1 resume until QUALITY_STATUS.txt (or fail if workers die).
$ErrorActionPreference = 'Continue'
$root = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\marco_phase1'
$status = Join-Path $root 'QUALITY_STATUS.txt'
$watch = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\logs\marco_phase1_watch.log'
$resumePidFile = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\logs\marco_phase1_resume.pid.txt'

function Get-ResumePid {
    if (-not (Test-Path $resumePidFile)) { return $null }
    $raw = (Get-Content $resumePidFile -Raw).Trim()
    if ($raw -match '(\d+)') { return [int]$Matches[1] }
    return $null
}

$parentId = Get-ResumePid
$n = 0
Add-Content $watch ("[watch-start " + (Get-Date -Format o) + "] parentId=$parentId")

while (-not (Test-Path $status)) {
    $n++
    $parts = @()

    $bmoe = Get-Process -Name 'bmoe-cli' -ErrorAction SilentlyContinue
    if ($bmoe) {
        $parts += ('bmoe=ALIVE pid=' + (($bmoe | ForEach-Object { $_.Id }) -join ','))
    } else {
        $parts += 'bmoe=NONE'
    }

    $cells = @(
        'A1\full\fr',
        'A1\full\it',
        'A1\full\zh',
        'A2\full',
        'A3\full'
    )
    foreach ($cell in $cells) {
        $csv = Join-Path $root ($cell + '\per_token.csv')
        if (-not (Test-Path $csv)) {
            $dir = Join-Path $root $cell
            if (Test-Path $dir) {
                $found = Get-ChildItem $dir -Recurse -Filter 'per_token.csv' -ErrorAction SilentlyContinue |
                    Sort-Object LastWriteTime -Descending |
                    Select-Object -First 1
                if ($found) { $csv = $found.FullName }
            }
        }
        if (Test-Path $csv) {
            $item = Get-Item $csv
            $parts += ($cell + ' csv=' + $item.Length + 'B @' + $item.LastWriteTime.ToString('HH:mm:ss'))
        }
    }

    $parentAlive = $false
    if ($parentId) {
        $parentAlive = [bool](Get-Process -Id $parentId -ErrorAction SilentlyContinue)
    }
    $parts += ('parent=' + $(if ($parentAlive) { 'ALIVE' } else { 'DEAD' }) + "($parentId)")

    if (-not $parentAlive -and -not $bmoe) {
        # Re-read parent id once in case pid file updated
        $parentId = Get-ResumePid
        $parentAlive = $parentId -and (Get-Process -Id $parentId -ErrorAction SilentlyContinue)
        $bmoe = Get-Process -Name 'bmoe-cli' -ErrorAction SilentlyContinue
        if (-not $parentAlive -and -not $bmoe -and -not (Test-Path $status)) {
            $msg = 'FAILED resume parent and bmoe both dead before QUALITY_STATUS'
            Add-Content $watch $msg
            Write-Output 'FAILED resume parent and bmoe both dead before QUALITY_STATUS'
            exit 2
        }
    }

    $snap = '[watch ' + (Get-Date -Format o) + '] ' + ($parts -join ' | ')
    # Progress only on disk — stdout is reserved for DONE/FAILED (monitor wake).
    Add-Content $watch $snap

    Start-Sleep -Seconds 120
}

Add-Content $watch ('[watch-done ' + (Get-Date -Format o) + ']')
Write-Output 'DONE marco phase1 quality'

$verdict = Join-Path $root 'VERDICT.md'
if (Test-Path $verdict) {
    Get-Content $verdict -Raw | ForEach-Object { Write-Output $_ }
}
Get-Content $status -Raw | ForEach-Object { Write-Output $_ }
exit 0
