$ErrorActionPreference = 'SilentlyContinue'
$status = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\f6_certify_probe\STATUS.txt'
$pidfile = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\f6_certify_probe\orchestrator.pid.txt'
while ($true) {
    if (Test-Path $status) {
        $s = (Get-Content $status -Raw).Trim()
        if ($s -eq 'DONE') { Write-Output 'DONE'; exit 0 }
        if ($s -match '^(HARNESS_FAIL|ARM_INVALID|BLOCKED)') { Write-Output 'FAILED'; exit 1 }
    }
    if (Test-Path $pidfile) {
        $opid = (Get-Content $pidfile -Raw).Trim()
        if ($opid -match '^\d+$') {
            $alive = Get-Process -Id ([int]$opid) -ErrorAction SilentlyContinue
            if (-not $alive) {
                Start-Sleep -Seconds 8
                $s = if (Test-Path $status) { (Get-Content $status -Raw).Trim() } else { '' }
                if ($s -eq 'DONE') { Write-Output 'DONE'; exit 0 }
                if ($s -match '^(HARNESS_FAIL|ARM_INVALID|BLOCKED)') { Write-Output 'FAILED'; exit 1 }
                Write-Output 'FAILED'
                exit 1
            }
        }
    }
    Start-Sleep -Seconds 60
}
