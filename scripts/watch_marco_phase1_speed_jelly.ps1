# Poll Jelly phase1 speed STATUS until DONE/FAIL. Stdout only terminal lines.
$ErrorActionPreference = 'Continue'
$watch = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\logs\marco_phase1_speed_jelly_watch.log'
$sshKey = Join-Path $env:USERPROFILE '.ssh\id_ed25519'
$ssh = @(
    'ssh', '-p', '18022', '-i', $sshKey,
    '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes',
    '-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=NUL',
    '-o', 'ConnectTimeout=10',
    'u0_a225@127.0.0.1'
)
$remote = 'cat ~/experiments/results/marco_phase1/speed_jelly/STATUS.txt 2>/dev/null; echo ---; tail -n 8 ~/experiments/results/marco_phase1/speed_jelly/SPEED.master.log 2>/dev/null'

Add-Content $watch ("[watch-start " + (Get-Date -Format o) + "]")

while ($true) {
    $out = & ssh -p 18022 -i $sshKey -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=NUL -o ConnectTimeout=10 u0_a225@127.0.0.1 $remote 2>$null
    $text = if ($out) { ($out | Out-String) } else { '' }
    $snap = '[watch ' + (Get-Date -Format o) + '] ' + ($text -replace '\s+', ' ').Trim()
    Add-Content $watch $snap

    if ($text -match 'FAIL') {
        Write-Output 'FAILED jelly phase1 speed'
        Write-Output $text
        exit 2
    }
    if ($text -match '(?m)^DONE' -or $text -match 'SPEED DONE') {
        Write-Output 'DONE jelly phase1 speed'
        $ver = & ssh -p 18022 -i $sshKey -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=NUL -o ConnectTimeout=15 u0_a225@127.0.0.1 'cat ~/experiments/results/marco_phase1/speed_jelly/SPEED_VERDICT.md 2>/dev/null; echo ===; cat ~/experiments/results/marco_phase1/speed_jelly/speed_summary.json 2>/dev/null' 2>$null
        if ($ver) { Write-Output ($ver | Out-String) }
        exit 0
    }
    Start-Sleep -Seconds 120
}
