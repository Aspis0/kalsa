# push_and_run.ps1 — S23 ONLY. Default: stage scripts and write STATUS=SCRIPTS_READY. No SSH.
# Pass -Kickoff later to scp + nohup run_all.sh. Do not touch Xiaomi/Jelly. Do not kill PC jobs.
# Do not git push. Do not update PLAN.md. No GGUF writes. No llama-cli on the 13GB file.
param(
    [switch] $Kickoff,
    [int] $PollSeconds = 20,
    [int] $MaxWaitMinutes = 240
)

$ErrorActionPreference = "Stop"
$Root = "C:\Users\gualt\Desktop\Kalsa\moe-experiments"
$Here = Join-Path $Root "results\s23_123"
$Key = Join-Path $env:USERPROFILE ".ssh\moe_s23"
$SshHost = "u0_a344@192.168.1.152"
$SshPort = "8022"
$RemoteWs = "/data/data/com.termux/files/home/gdn_k2/s23_123"
$PullDir = Join-Path $Here "device_pull"
$HostLog = Join-Path $Here "push_and_run.log"
$HostStatus = Join-Path $Here "STATUS.txt"
$SshOpts = @(
    "-p", $SshPort, "-i", $Key,
    "-o", "BatchMode=yes",
    "-o", "IdentitiesOnly=yes",
    "-o", "ConnectTimeout=20",
    "-o", "ServerAliveInterval=30",
    "-o", "ServerAliveCountMax=20"
)
$ScpOpts = @(
    "-P", $SshPort, "-i", $Key,
    "-o", "BatchMode=yes",
    "-o", "IdentitiesOnly=yes",
    "-o", "ConnectTimeout=20"
)

function W([string] $m) {
    $line = "[{0}] {1}" -f (Get-Date -Format "s"), $m
    Add-Content -Path $HostLog -Value $line
    Write-Host $line
}

function Die([string] $code, [string] $m) {
    W "ABORT $code $m"
    Set-Content -Path $HostStatus -Value $code -Encoding ascii
    exit 2
}

function Write-UnixFile([string] $path) {
    $raw = [System.IO.File]::ReadAllText($path)
    $unix = $raw -replace "`r`n", "`n" -replace "`r", "`n"
    if (-not $unix.EndsWith("`n")) { $unix += "`n" }
    [System.IO.File]::WriteAllText($path, $unix, (New-Object System.Text.UTF8Encoding $false))
}

New-Item -ItemType Directory -Force -Path $Here | Out-Null
if (-not (Test-Path $HostLog)) { Set-Content -Path $HostLog -Value "" -Encoding ascii }

foreach ($n in @("run_all.sh", "p_fact.txt", "analyze_peakiness.py")) {
    $p = Join-Path $Here $n
    if (-not (Test-Path $p)) { Die "FAIL_SCRIPT" "missing $p" }
}

Write-UnixFile (Join-Path $Here "run_all.sh")
Write-UnixFile (Join-Path $Here "p_fact.txt")
Write-UnixFile (Join-Path $Here "analyze_peakiness.py")

Set-Content -Path $HostStatus -Value "SCRIPTS_READY" -Encoding ascii
W "STATUS=SCRIPTS_READY files=run_all.sh,p_fact.txt,analyze_peakiness.py,push_and_run.ps1"
W "remote would be $SshHost:$RemoteWs (S23). Xiaomi/Jelly not contacted. PC jobs not touched."

if (-not $Kickoff) {
    W "no SSH (omit -Kickoff). analyze_peakiness.py stays on PC; run it after pull on A/route_k6.csv"
    exit 0
}

if (-not (Test-Path $Key)) { Die "FAIL_KEY" "missing SSH key $Key" }

function Ssh([string] $remoteCmd) {
    & ssh @SshOpts $SshHost $remoteCmd 2>&1
}

Set-Content -Path $HostStatus -Value "PUSHING" -Encoding ascii
W "=== kickoff S23 $SshHost ws=$RemoteWs ==="

W "remote mkdir $RemoteWs"
$mk = Ssh "mkdir -p $RemoteWs/A $RemoteWs/B $RemoteWs/C $RemoteWs/D $RemoteWs/E $RemoteWs/batt $RemoteWs/mem"
if ($LASTEXITCODE -ne 0) { Die "FAIL_SSH" "mkdir failed: $mk" }

W "scp harness (not analyze_peakiness.py)"
foreach ($n in @("run_all.sh", "p_fact.txt")) {
    $src = Join-Path $Here $n
    & scp @ScpOpts $src "${SshHost}:${RemoteWs}/$n"
    if ($LASTEXITCODE -ne 0) { Die "FAIL_SCP" "scp $n failed" }
}

W "strip CR + chmod"
$fix = Ssh "sed -i 's/\r`$//' $RemoteWs/run_all.sh $RemoteWs/p_fact.txt && chmod 0755 $RemoteWs/run_all.sh && wc -c $RemoteWs/p_fact.txt $RemoteWs/run_all.sh && ls -l $RemoteWs"
W (($fix | Out-String).Trim())
if ($LASTEXITCODE -ne 0) { Die "FAIL_SSH" "chmod/sed failed" }

W "preflight battery + mem (MemAvail floor; do not abort on MemFree~100MiB)"
$pre = Ssh "export PREFIX=/data/data/com.termux/files/usr; export PATH=`$PREFIX/bin:`$PATH; echo '--- model ---'; getprop ro.product.model 2>/dev/null || echo unknown; echo '--- batt ---'; termux-battery-status 2>/dev/null || echo '{}'; echo '--- mem ---'; awk '/^MemFree:|^MemAvailable:/{print}' /proc/meminfo; echo '--- boot ---'; cat /proc/sys/kernel/random/boot_id 2>/dev/null; echo '--- pgrep ---'; pgrep -af bmoe-cli || true; pgrep -af llama-cli || true; echo '--- bin ---'; sha256sum `$HOME/src/BigMoeOnEdge/build-bmoe/cli/bmoe-cli.CAMPAIGN 2>/dev/null | awk '{print `$1}'; echo '--- wrapper ---'; echo STATUS:`$(cat $RemoteWs/STATUS.txt 2>/dev/null || echo NONE)"
$preText = ($pre | Out-String)
W ($preText.Trim())
if ($LASTEXITCODE -ne 0) { Die "FAIL_SSH" "preflight ssh failed" }

if ($preText -notmatch "SM-S911") { Die "ABORT_DEVICE" "not S23 SM-S911* in getprop" }

$plug = "?"
$pct = 0
$temp = 0.0
if ($preText -match '"plugged"\s*:\s*"([^"]+)"') { $plug = $Matches[1] }
if ($preText -match '"percentage"\s*:\s*(\d+)') { $pct = [int]$Matches[1] }
if ($preText -match '"temperature"\s*:\s*([0-9.]+)') { $temp = [double]$Matches[1] }
if ($preText -notmatch 'MemAvailable:\s+(\d+)') { Die "ABORT_MEM" "MemAvailable unreadable in preflight" }
$ma = [int]$Matches[1]
W "preflight parsed plugged=$plug batt=$pct temp=$temp MemAvail_kB=$ma"

if ($plug -ne "UNPLUGGED") { Die "ABORT_PLUGGED" "device plugged=$plug" }
if ($pct -lt 45) { Die "ABORT_BATT" "batt $pct < 45" }
if ($temp -gt 45) { Die "ABORT_THERMAL" "temp $temp > 45C" }
if ($ma -lt 400000) { Die "ABORT_MEM" "MemAvail_kB=$ma < 400000" }

if ($preText -match '(?s)--- bin ---\s*([0-9a-f]{64})') {
    $binSha = $Matches[1]
    if (-not $binSha.StartsWith("1ca51420")) { Die "FAIL_PIN" "expected 1ca51420* got $binSha" }
}

if ($preText -match "STATUS:RUNNING") { Die "FAIL_BUSY" "s23_123 already RUNNING; will not kill" }
$pgrepBlock = $preText
if ($preText -match '(?s)--- pgrep ---(.*?)--- bin ---') { $pgrepBlock = $Matches[1] }
$busy = $false
foreach ($line in ($pgrepBlock -split "`n")) {
    $t = $line.Trim()
    if ($t -eq "") { continue }
    if ($t -match "pgrep") { continue }
    if ($t -match "bmoe-cli" -or $t -match "llama-cli") { $busy = $true }
}
if ($busy) { Die "FAIL_BUSY" "bmoe-cli or llama-cli already running; will not kill" }

W "launch run_all.sh"
$launch = Ssh "export PREFIX=/data/data/com.termux/files/usr; export PATH=`$PREFIX/bin:`$PATH; export HOME=/data/data/com.termux/files/home; echo RUNNING > $RemoteWs/STATUS.txt; nohup bash $RemoteWs/run_all.sh >$RemoteWs/nohup.out 2>&1 & echo LAUNCHED:`$!"
W (($launch | Out-String).Trim())
if ($LASTEXITCODE -ne 0) { Die "FAIL_SSH" "launch failed" }

Set-Content -Path $HostStatus -Value "RUNNING" -Encoding ascii
New-Item -ItemType Directory -Force -Path $PullDir | Out-Null
$deadline = (Get-Date).AddMinutes($MaxWaitMinutes)
do {
    Start-Sleep -Seconds $PollSeconds
    $st = Ssh "cat $RemoteWs/STATUS.txt 2>/dev/null || echo NONE"
    $stText = (($st | Out-String).Trim())
    W "poll STATUS=$stText"
    if ($stText -eq "DONE" -or $stText -match "^BLOCKED" -or $stText -match "^FAIL" -or $stText -match "^ABORT") {
        break
    }
    if ((Get-Date) -gt $deadline) { Die "FAIL_TIMEOUT" "still $stText after $MaxWaitMinutes min" }
} while ($true)

W "pull $RemoteWs -> $PullDir"
& scp @ScpOpts -r "${SshHost}:${RemoteWs}/." $PullDir
if ($LASTEXITCODE -ne 0) { Die "FAIL_SCP" "pull failed" }

$route = Join-Path $PullDir "A\route_k6.csv"
$py = Join-Path $Here "analyze_peakiness.py"
$peak = Join-Path $Here "peakiness.json"
if (Test-Path $route) {
    W "analyze_peakiness.py $route"
    & python $py $route -o $peak
    if ($LASTEXITCODE -ne 0) { W "analyze exit $LASTEXITCODE (no invented json)" }
} else {
    W "no A/route_k6.csv in pull — skip peakiness.json"
}

Set-Content -Path $HostStatus -Value $stText -Encoding ascii
W "final STATUS=$stText"
exit 0
