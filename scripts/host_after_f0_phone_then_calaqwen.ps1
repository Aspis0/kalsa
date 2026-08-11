# After phone F0 smoke PASS: pull, commit (no RunPod), launch calaqwen S23.
$ErrorActionPreference = "Continue"
$Root = "C:\Users\gualt\Desktop\Kalsa\moe-experiments"
$key = "C:\Users\gualt\.ssh\moe_s23"
$hostLog = Join-Path $Root "logs\host_after_f0_calaqwen.log"
New-Item -ItemType Directory -Force -Path (Join-Path $Root "logs") | Out-Null

function W([string]$m) {
  $line = "[{0}] {1}" -f (Get-Date -Format "s"), $m
  Add-Content -Path $hostLog -Value $line
  Write-Output $line
}

function SshPhone([string]$remoteCmd) {
  & ssh -p 8022 -i $key -o BatchMode=yes -o IdentitiesOnly=yes -o ConnectTimeout=20 u0_a344@192.168.1.152 $remoteCmd 2>&1
}

W "WAIT phone F0 STATUS=PASS"
$prev = ""
$failStreak = 0
while ($true) {
  Start-Sleep -Seconds 20
  $raw = SshPhone "export HOME=/data/data/com.termux/files/home; S=`$HOME/experiments/results/reap/f0; echo STATUS:`$(cat `$S/STATUS.txt 2>/dev/null || echo NONE); if [ -f `$S/f0_phone.pid ]; then ps -p `$(cat `$S/f0_phone.pid) >/dev/null 2>&1 && echo ALIVE || echo DEAD; fi; tail -1 `$S/f0.master.log 2>/dev/null"
  $line = ($raw | Out-String).Trim() -replace "[\r\n]+", " | "
  if ($line -ne $prev) { W "F0_PHONE $line"; $prev = $line }
  if ($line -match "STATUS:PASS") { W "F0_PHONE_PASS"; break }
  if ($line -match "STATUS:FAIL") {
    $aliveCheck = SshPhone "export HOME=/data/data/com.termux/files/home; pgrep -af run_reap_f0_bpb_only; pgrep -af bmoe-cli"
    $ac = ($aliveCheck | Out-String)
    if ($ac -match "bpb_only" -or $ac -match "ppl-decode" -or $ac -match "bmoe-cli") {
      W "saw FAIL but work still running - ignore"
      continue
    }
    $failStreak++
    if ($failStreak -ge 3) { W "F0_PHONE_FAIL"; break }
  } else {
    $failStreak = 0
  }
}

$pull = Join-Path $Root "results\reap\f0_phone"
New-Item -ItemType Directory -Force -Path $pull | Out-Null
W "PULL f0 phone"
& scp -P 8022 -i $key -o BatchMode=yes -o IdentitiesOnly=yes -r "u0_a344@192.168.1.152:experiments/results/reap/f0/*" "$pull/" 2>&1 | ForEach-Object { W "$_" }

$rep = Join-Path $Root "reports\moe-reap-multilingua.md"
if (Test-Path $rep) {
  $txt = Get-Content $rep -Raw -Encoding UTF8
  if ($line -match "STATUS:PASS") {
    $txt = $txt -replace "Smoke CAMPAIGN phone \| \*\*[^*]+\*\*[^\r\n]*", "Smoke CAMPAIGN phone | **PASS** (results/reap/f0_phone/)"
  } else {
    $txt = $txt -replace "Smoke CAMPAIGN phone \| \*\*[^*]+\*\*[^\r\n]*", "Smoke CAMPAIGN phone | **FAIL/partial** (results/reap/f0_phone/)"
  }
  Set-Content $rep $txt -Encoding UTF8
}

Set-Location $Root
git add reports/moe-reap-multilingua.md scripts/run_reap_f0_pc.py scripts/run_reap_f0_pc.ps1 scripts/run_reap_f0_smoke.sh scripts/run_calaqwen_s23.sh scripts/host_after_f0_phone_then_calaqwen.ps1 scripts/_launch_calaqwen_remote.sh corpus/multi5/en_slice.txt corpus/multi5/it_slice.txt 2>$null
git add results/reap/f0/ results/reap/f0_phone/ 2>$null
git status -sb | Select-Object -First 30 | ForEach-Object { W "$_" }
git commit -m "feat(reap): F0 phone community REAP20 results; no RunPod; calaqwen next" 2>&1 | ForEach-Object { W "$_" }

if ($line -notmatch "STATUS:PASS") {
  W "STOP no calaqwen after F0 non-PASS"
  Write-Output "DONE_NO_CALAQWEN"
  exit 1
}

W "DELETE phone REAP gguf"
SshPhone "rm -f /data/data/com.termux/files/home/experiments/models/Qwen3.6-28B-REAP20-A3B-Q2_K.gguf; df -h /data/user/0 | tail -1" | ForEach-Object { W "$_" }

W "SCP calaqwen driver"
& scp -P 8022 -i $key -o BatchMode=yes (Join-Path $Root "scripts\run_calaqwen_s23.sh") "u0_a344@192.168.1.152:experiments/scripts/run_calaqwen_s23.sh"
& scp -P 8022 -i $key -o BatchMode=yes (Join-Path $Root "scripts\lib_guardrails.sh") "u0_a344@192.168.1.152:experiments/scripts/lib_guardrails.sh"
& scp -P 8022 -i $key -o BatchMode=yes (Join-Path $Root "scripts\_launch_calaqwen_remote.sh") "u0_a344@192.168.1.152:experiments/scripts/_launch_calaqwen_remote.sh"

W "battery gate for calaqwen"
for ($i = 0; $i -lt 240; $i++) {
  $bj = SshPhone "export PATH=/data/data/com.termux/files/usr/bin:`$PATH; termux-battery-status"
  $s = ($bj | Out-String)
  $pct = 0
  $plug = "unknown"
  if ($s -match '"percentage"\s*:\s*(\d+)') { $pct = [int]$Matches[1] }
  if ($s -match '"plugged"\s*:\s*"(\w+)"') { $plug = $Matches[1] }
  W "batt i=$i plugged=$plug pct=$pct"
  if ($plug -eq "UNPLUGGED" -and $pct -ge 50) { W "GO calaqwen"; break }
  if ($i -eq 239) { W "TIMEOUT batt gate - launch with device preflight"; break }
  Start-Sleep -Seconds 30
}

W "LAUNCH calaqwen"
SshPhone "bash /data/data/com.termux/files/home/experiments/scripts/_launch_calaqwen_remote.sh" | ForEach-Object { W "$_" }
Write-Output "DONE_LAUNCHED_CALAQWEN"
W "DONE_LAUNCHED_CALAQWEN"
