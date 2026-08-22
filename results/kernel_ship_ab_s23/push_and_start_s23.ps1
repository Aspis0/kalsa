# Push ONLY the harness + prompt to S23 and start the config-only A/B.
# Never writes the campaign binary. Do not run this from the build step.
$ErrorActionPreference = "Stop"
$key = "C:\Users\gualt\.ssh\moe_s23"
$ssh = @("-p","8022","-i",$key,"-o","BatchMode=yes","-o","ConnectTimeout=15")
$scp = @("-P","8022","-i",$key,"-o","BatchMode=yes","-o","ConnectTimeout=15")
$host_ = "u0_a344@192.168.1.152"
$root = "C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\kernel_ship_ab_s23"
$remote = "~/experiments/results/kernel_ship_ab_s23"

function L($m) {
    $line = "[{0}] {1}" -f (Get-Date -Format o), $m
    Add-Content -Path "$root\push.log" -Value $line -Encoding utf8
    Write-Host $line
}

$harness = Join-Path $root "run_ship_ab_s23.sh"
$prompt = Join-Path $root "prompts\p_fact.txt"
if (-not (Test-Path $harness)) { throw "missing $harness" }
if (-not (Test-Path $prompt)) { throw "missing $prompt" }

L "hash campaign pin BEFORE push (read-only; must not change)"
ssh @ssh $host_ "timeout 20 sha256sum ~/bin/mellum2/bmoe-cli ~/bin/bmoe-cli-mellum2 2>/dev/null" | Tee-Object -FilePath "$root\campaign.sha256.before_push"

L "mkdir remote dirs"
ssh @ssh $host_ "timeout 20 mkdir -p $remote/logs $remote/prompts $remote/mem $remote/gen $remote/power"

L "scp harness + prompt (no binaries)"
scp @scp $harness "${host_}:${remote}/run_ship_ab_s23.sh"
scp @scp $prompt "${host_}:${remote}/prompts/p_fact.txt"

L "chmod + verify pins (read-only)"
ssh @ssh $host_ @"
chmod 755 $remote/run_ship_ab_s23.sh
chmod 644 $remote/prompts/p_fact.txt
echo '--- campaign pin (must match before) ---'
timeout 20 sha256sum ~/bin/mellum2/bmoe-cli ~/bin/bmoe-cli-mellum2
echo '--- prompt ---'
timeout 20 sha256sum $remote/prompts/p_fact.txt
"@ | Tee-Object -FilePath "$root\install_remote.txt"

L "pre-check battery + UNPLUGGED"
$batt = ssh @ssh $host_ "timeout 10 termux-battery-status"
L ("battery: {0}" -f $batt)
$battFile = Join-Path $root "batt_precheck.json"
Set-Content -Path $battFile -Value $batt -Encoding utf8
$pct = -1
$plugged = "UNKNOWN"
try {
    $j = $batt | ConvertFrom-Json
    if ($null -ne $j.percentage) { $pct = [int]$j.percentage }
    elseif ($null -ne $j.level) { $pct = [int]$j.level }
    if ($null -ne $j.plugged) { $plugged = [string]$j.plugged }
} catch {
    L "WARN could not parse termux-battery-status JSON"
}
if ($plugged -notmatch "UNPLUGGED") {
    throw "device is $plugged — refuse to start (need UNPLUGGED)"
}
if ($pct -ge 0 -and $pct -lt 45) {
    throw "battery $pct% < hard floor 45 — refuse to start"
}
if ($pct -ge 0 -and $pct -lt 50) {
    L "WARN battery $pct% < 50 suggested for a full 24-run cycle; starting anyway (hard floor 45)"
} else {
    L "battery $pct% UNPLUGGED — precheck OK"
}

L "start harness in nohup"
ssh @ssh $host_ "export PATH=/data/data/com.termux/files/usr/bin:`$HOME/bin:`$PATH; termux-wake-lock >/dev/null 2>&1 || true; nohup bash $remote/run_ship_ab_s23.sh > $remote/nohup.out 2>&1 & echo PID=`$!; sleep 1; cat $remote/STATUS.txt 2>/dev/null; tail -8 $remote/SHIP.master.log 2>/dev/null"
L "PUSH+START done"
