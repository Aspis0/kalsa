# push_and_run.ps1 — S23 ONLY. scp harnesses, run typeahead THEN phase2b, pull logs.
# Do not touch Xiaomi 192.168.1.193 or Jelly 192.168.1.82.
# Do not kill PC jobs. Do not git push. Do not update PLAN.md. No GGUFs.
# This script is the device kickoff. Do not launch it from the scripts-only agent.
param(
    [int] $PollSeconds = 20,
    [int] $MaxWaitMinutes = 240
)

$ErrorActionPreference = "Stop"
$Root = "C:\Users\gualt\Desktop\Kalsa\moe-experiments"
$Here = Join-Path $Root "results\s23_idle_ideas"
$Key = Join-Path $env:USERPROFILE ".ssh\moe_s23"
$SshHost = "u0_a344@192.168.1.152"
$SshPort = "8022"
$RemoteWs = "/data/data/com.termux/files/home/gdn_k2/idle_ideas"
$PullDir = Join-Path $Here "device_pull"
$HostLog = Join-Path $Here "push_and_run.log"
$HostStatus = Join-Path $Here "HOST_STATUS.txt"
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

function Ssh([string] $remoteCmd) {
    & ssh @SshOpts $SshHost $remoteCmd 2>&1
}

function Write-UnixFile([string] $path, [string] $content) {
    $unix = $content -replace "`r`n", "`n" -replace "`r", "`n"
    if (-not $unix.EndsWith("`n")) { $unix += "`n" }
    [System.IO.File]::WriteAllText($path, $unix, (New-Object System.Text.UTF8Encoding $false))
}

if (-not (Test-Path $Key)) { Die "FAIL_KEY" "missing SSH key $Key" }
foreach ($n in @("run_typeahead.sh", "run_phase2b.sh")) {
    if (-not (Test-Path (Join-Path $Here $n))) { Die "FAIL_SCRIPT" "missing $n" }
}

New-Item -ItemType Directory -Force -Path $Here | Out-Null
Set-Content -Path $HostStatus -Value "PUSHING" -Encoding ascii
W "=== push_and_run S23 $SshHost ws=$RemoteWs ==="
W "PC jobs are not touched. Xiaomi/Jelly are not contacted."

$wrapper = @'
#!/data/data/com.termux/files/usr/bin/bash
# Sequential wrapper: typeahead THEN phase2b. Written by push_and_run.ps1.
set -u
export HOME="${HOME:-/data/data/com.termux/files/home}"
export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:$PATH"
export TMPDIR="${TMPDIR:-$PREFIX/tmp}"
export LC_ALL=C
WS="${WS:-$HOME/gdn_k2/idle_ideas}"
cd "$WS" || exit 2
echo "RUNNING" > "$WS/ALL.STATUS"
echo $$ > "$WS/ALL.pid"
{
  echo "[$(date '+%Y-%m-%dT%H:%M:%S%z')] wrapper start"
  echo "[$(date '+%Y-%m-%dT%H:%M:%S%z')] TYPEAHEAD begin"
  bash "$WS/run_typeahead.sh"
  ec1=$?
  echo "[$(date '+%Y-%m-%dT%H:%M:%S%z')] TYPEAHEAD exit=$ec1 status=$(cat "$WS/typeahead/STATUS.txt" 2>/dev/null)"
  echo "[$(date '+%Y-%m-%dT%H:%M:%S%z')] PHASE2B begin"
  bash "$WS/run_phase2b.sh"
  ec2=$?
  echo "[$(date '+%Y-%m-%dT%H:%M:%S%z')] PHASE2B exit=$ec2 status=$(cat "$WS/phase2b/STATUS.txt" 2>/dev/null)"
  echo "TYPEAHEAD_EC=$ec1" > "$WS/ALL.exit"
  echo "PHASE2B_EC=$ec2" >> "$WS/ALL.exit"
  echo "DONE" > "$WS/ALL.STATUS"
  echo "[$(date '+%Y-%m-%dT%H:%M:%S%z')] wrapper done"
} >> "$WS/ALL.master.log" 2>&1
'@
Write-UnixFile (Join-Path $Here "run_all.sh") $wrapper

W "remote mkdir $RemoteWs"
$mk = Ssh "mkdir -p $RemoteWs/typeahead $RemoteWs/phase2b"
if ($LASTEXITCODE -ne 0) { Die "FAIL_SSH" "mkdir failed: $mk" }

W "scp scripts"
foreach ($n in @("run_typeahead.sh", "run_phase2b.sh", "run_all.sh")) {
    $src = Join-Path $Here $n
    & scp @ScpOpts $src "${SshHost}:${RemoteWs}/$n"
    if ($LASTEXITCODE -ne 0) { Die "FAIL_SCP" "scp $n failed" }
}

W "strip CR + chmod"
$fix = Ssh "sed -i 's/\r`$//' $RemoteWs/run_typeahead.sh $RemoteWs/run_phase2b.sh $RemoteWs/run_all.sh && chmod 0755 $RemoteWs/run_typeahead.sh $RemoteWs/run_phase2b.sh $RemoteWs/run_all.sh && ls -l $RemoteWs/*.sh"
W (($fix | Out-String).Trim())
if ($LASTEXITCODE -ne 0) { Die "FAIL_SSH" "chmod/sed failed" }

W "preflight battery + mem (no start if unsafe)"
$pre = Ssh "export PREFIX=/data/data/com.termux/files/usr; export PATH=`$PREFIX/bin:`$PATH; echo '--- batt ---'; termux-battery-status 2>/dev/null || echo '{}'; echo '--- mem ---'; awk '/^MemFree:/{print `$2}' /proc/meminfo; echo '--- pgrep ---'; pgrep -af bmoe-cli || true; pgrep -af llama-cli || true; echo '--- wrapper ---'; echo ALL:`$(cat $RemoteWs/ALL.STATUS 2>/dev/null || echo NONE); if [ -f $RemoteWs/ALL.pid ]; then ps -p `$(cat $RemoteWs/ALL.pid) >/dev/null 2>&1 && echo WRAPPER:ALIVE || echo WRAPPER:DEAD; else echo WRAPPER:NONE; fi"
$preText = ($pre | Out-String)
W ($preText.Trim())
if ($LASTEXITCODE -ne 0) { Die "FAIL_SSH" "preflight ssh failed" }

$plug = "?"
$pct = 0
$temp = 0.0
if ($preText -match '"plugged"\s*:\s*"([^"]+)"') { $plug = $Matches[1] }
if ($preText -match '"percentage"\s*:\s*(\d+)') { $pct = [int]$Matches[1] }
if ($preText -match '"temperature"\s*:\s*([0-9.]+)') { $temp = [double]$Matches[1] }
$mf = 0
if ($preText -match '--- mem ---\s+(\d+)') { $mf = [int]$Matches[1] }
W "preflight parsed plugged=$plug batt=$pct temp=$temp MemFree_kB=$mf"

if ($plug -ne "UNPLUGGED") { Die "ABORT_PLUGGED" "device plugged=$plug (speed only UNPLUGGED)" }
if ($pct -lt 45) { Die "ABORT_BATT" "batt $pct < 45" }
if ($temp -gt 45) { Die "ABORT_THERMAL" "temp $temp > 45C" }
if ($mf -gt 0 -and $mf -lt 300000) { Die "ABORT_MEM" "MemFree_kB=$mf < 300000" }

if ($preText -match "WRAPPER:ALIVE") {
    Die "FAIL_BUSY" "idle_ideas wrapper already running; will not kill it"
}
$busy = $false
foreach ($line in ($preText -split "`n")) {
    $t = $line.Trim()
    if ($t -match "bmoe-cli" -or $t -match "llama-cli") {
        if ($t -notmatch "pgrep") { $busy = $true }
    }
}
if ($busy) { Die "FAIL_BUSY" "bmoe-cli or llama-cli already running; will not kill" }

W "launch wrapper (typeahead THEN phase2b)"
$launch = Ssh "export PREFIX=/data/data/com.termux/files/usr; export PATH=`$PREFIX/bin:`$PATH; export HOME=/data/data/com.termux/files/home; : > $RemoteWs/ALL.master.log; echo RUNNING > $RemoteWs/ALL.STATUS; nohup bash $RemoteWs/run_all.sh >/dev/null 2>&1 & echo LAUNCHED:`$!"
W (($launch | Out-String).Trim())
if ($LASTEXITCODE -ne 0) { Die "FAIL_SSH" "launch failed" }
Set-Content -Path $HostStatus -Value "RUNNING" -Encoding ascii

$deadline = (Get-Date).AddMinutes($MaxWaitMinutes)
$prev = ""
$sshFail = 0
$ended = "unknown"
do {
    Start-Sleep -Seconds $PollSeconds
    $raw = Ssh "export PREFIX=/data/data/com.termux/files/usr; export PATH=`$PREFIX/bin:`$PATH; export HOME=/data/data/com.termux/files/home; echo ALL:`$(cat $RemoteWs/ALL.STATUS 2>/dev/null || echo NONE); echo TA:`$(cat $RemoteWs/typeahead/STATUS.txt 2>/dev/null || echo NONE); echo P2:`$(cat $RemoteWs/phase2b/STATUS.txt 2>/dev/null || echo NONE); if [ -f $RemoteWs/ALL.pid ]; then ps -p `$(cat $RemoteWs/ALL.pid) >/dev/null 2>&1 && echo WRAPPER:ALIVE || echo WRAPPER:DEAD; else echo WRAPPER:NONE; fi; echo EXIT:`$(tr '\n' ' ' < $RemoteWs/ALL.exit 2>/dev/null); echo LOG:`$(tail -n 1 $RemoteWs/ALL.master.log 2>/dev/null); echo TA_LOG:`$(tail -n 1 $RemoteWs/typeahead/TYPEAHEAD.master.log 2>/dev/null); echo P2_LOG:`$(tail -n 1 $RemoteWs/phase2b/PHASE2B.master.log 2>/dev/null)"
    if ($LASTEXITCODE -ne 0) {
        $sshFail++
        W "ssh poll fail #$sshFail : $raw"
        if ($sshFail -ge 6) { Die "FAIL_SSH" "lost S23 after $sshFail poll failures" }
        continue
    }
    $sshFail = 0
    $line = (($raw | Out-String).Trim() -replace "[\r\n]+", " | ")
    if ($line -ne $prev) { W "poll $line"; $prev = $line }

    if ($line -match "ALL:DONE") { W "wrapper DONE"; $ended = "DONE"; break }
    if ($line -match "WRAPPER:DEAD" -and $line -notmatch "ALL:DONE") {
        W "wrapper dead before ALL=DONE — pulling whatever is on disk"
        $ended = "WRAPPER_DEAD"
        break
    }
    if ((Get-Date) -gt $deadline) {
        W "TIMEOUT ${MaxWaitMinutes}min — not killing remote; pulling partial logs"
        $ended = "TIMEOUT"
        break
    }
} while ($true)

W "pull $RemoteWs -> $PullDir"
New-Item -ItemType Directory -Force -Path $PullDir | Out-Null
Set-Content -Path $HostStatus -Value "PULLING" -Encoding ascii
& scp @ScpOpts -r "${SshHost}:${RemoteWs}/." "$PullDir/"
if ($LASTEXITCODE -ne 0) { Die "FAIL_SCP" "pull failed" }

$allSt = "NONE"
$allPath = Join-Path $PullDir "ALL.STATUS"
if (Test-Path $allPath) { $allSt = ((Get-Content $allPath -Raw) -replace "\s+", "") }
W "pulled ALL.STATUS=$allSt ended=$ended -> $PullDir"
if ($ended -eq "TIMEOUT") {
    Set-Content -Path $HostStatus -Value "TIMEOUT_PULLED" -Encoding ascii
    exit 3
}
if ($ended -eq "WRAPPER_DEAD" -and $allSt -ne "DONE") {
    Set-Content -Path $HostStatus -Value "WRAPPER_DEAD_PULLED" -Encoding ascii
    exit 4
}
Set-Content -Path $HostStatus -Value "DONE" -Encoding ascii
exit 0
