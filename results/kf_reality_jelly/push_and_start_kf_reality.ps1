# Push ONLY the KF REALITY harness + prompt to Jelly and start it.
# Never writes the campaign pin. Never writes ~/bin/kernel_kf/bmoe-cli.
# Do NOT run this from the build step — owner starts it.
#
# v2 long-generation invocation (defaults remain v1-compatible):
#   .\push_and_start_kf_reality.ps1 `
#     -PromptFile prompts/p_long.txt `
#     -ExpectedPromptSha 5c3f4113908b1b615fe879d3b895d348b1db3ab5fe26a2bacffaa780f044c9a9 `
#     -OutDir ~/experiments/results/kf_reality_v2 `
#     -NGen 1500
# Width sweep:
#   .\push_and_start_kf_reality.ps1 `
#     -PromptFile prompts/p_long.txt `
#     -ExpectedPromptSha 5c3f4113908b1b615fe879d3b895d348b1db3ab5fe26a2bacffaa780f044c9a9 `
#     -OutDir ~/experiments/results/kf_sweep `
#     -NGen 1000 `
#     -BlockPlan "OFF ON:6 ON:4 ON:3 ON:2 OFF"
# Equivalent env:
#   $env:PROMPT_FILE='prompts/p_long.txt'
#   $env:EXPECTED_PROMPT_SHA='5c3f4113908b1b615fe879d3b895d348b1db3ab5fe26a2bacffaa780f044c9a9'
#   $env:OUTDIR='~/experiments/results/kf_reality_v2'
#   $env:N_GEN='1500'
#   $env:BLOCK_PLAN='OFF ON:6 ON:6 OFF'
#   .\push_and_start_kf_reality.ps1

param(
    [string]$PromptFile,
    [string]$ExpectedPromptSha,
    [string]$OutDir,
    [string]$NGen,
    [string]$BlockPlan
)

$ErrorActionPreference = "Stop"
if (-not $PromptFile) { $PromptFile = $env:PROMPT_FILE }
if (-not $ExpectedPromptSha) { $ExpectedPromptSha = $env:EXPECTED_PROMPT_SHA }
if (-not $OutDir) { $OutDir = $env:OUTDIR }
if (-not $NGen) { $NGen = $env:N_GEN }
if (-not $BlockPlan) { $BlockPlan = $env:BLOCK_PLAN }
if (-not $PromptFile) { $PromptFile = "prompts/p_fact.txt" }
if (-not $ExpectedPromptSha) { $ExpectedPromptSha = "b5301c32c0bd8aae4cf5c25d667a52eef05b940a459a2e9c82b1b6134cf0dcbd" }
if (-not $OutDir) { $OutDir = "~/experiments/results/kf_reality_jelly" }
if (-not $NGen) { $NGen = "1000" }
if (-not $BlockPlan) { $BlockPlan = "OFF ON:6 ON:6 OFF" }

$ssh = @("-p","8022","-o","BatchMode=yes","-o","ConnectTimeout=15")
$scp = @("-P","8022","-o","BatchMode=yes","-o","ConnectTimeout=15")
$host_ = "u0_a225@192.168.1.82"
$root = "C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\kf_reality_jelly"
$remote = $OutDir
$protoPrompt = "C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\kernel_kf_proto\prompts\p_fact.txt"
$expectedKf = "77a94640a56a904301de93ee4c7d74cc7fbb1cc884c2302901d8f173fe3e713e"
$expectedCamp = "36b01966ba0f471d17f8fcb29ab49f64f760999c4256f612f959a7a0b178ce81"
$expectedFact = $ExpectedPromptSha

function L($m) {
    $line = "[{0}] {1}" -f (Get-Date -Format o), $m
    Add-Content -Path "$root\push.log" -Value $line -Encoding utf8
    Write-Host $line
}

# CRLF killed two starts today. Refuse to push any file that still has CR.
function Assert-LF([string]$path) {
    if (-not (Test-Path $path)) { throw "missing $path" }
    $bytes = [System.IO.File]::ReadAllBytes($path)
    foreach ($b in $bytes) {
        if ($b -eq 13) {
            throw "CR/CRLF found in $path — refuse to push (CRLF killed two starts today)"
        }
    }
    L ("LF_OK {0} ({1} bytes)" -f $path, $bytes.Length)
}

if ([System.IO.Path]::IsPathRooted($PromptFile)) {
    $prompt = $PromptFile
    $promptRel = "prompts/" + [System.IO.Path]::GetFileName($PromptFile)
} else {
    $promptRel = ($PromptFile -replace "\\", "/")
    $prompt = Join-Path $root ($PromptFile -replace "/", "\")
}
$remotePrompt = "$remote/$promptRel"

$harness = Join-Path $root "run_kf_reality_jelly.sh"
if (-not (Test-Path $harness)) { throw "missing $harness" }
if (-not (Test-Path $prompt)) {
    $promptBase = [System.IO.Path]::GetFileName($prompt)
    if ($promptBase -ne "p_fact.txt") { throw "missing prompt $prompt" }
    if (-not (Test-Path $protoPrompt)) { throw "missing prompt $prompt and proto fallback $protoPrompt" }
    New-Item -ItemType Directory -Force -Path (Join-Path $root "prompts") | Out-Null
    $raw = [System.IO.File]::ReadAllBytes($protoPrompt)
    # Rewrite as LF-only so the push check cannot fail on a Windows checkout.
    $text = [System.Text.Encoding]::UTF8.GetString($raw) -replace "`r`n","`n" -replace "`r","`n"
    $utf8 = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText($prompt, $text, $utf8)
    L "copied p_fact.txt from proto (LF)"
}

Assert-LF $harness
Assert-LF $prompt

L "hash pins BEFORE push (read-only; must not change)"
ssh @ssh $host_ "export PATH=/data/data/com.termux/files/usr/bin:`$HOME/bin:`$PATH; sha256sum ~/bin/kernel_kf/bmoe-cli ~/bin/bmoe-cli.JELLY" | Tee-Object -FilePath "$root\campaign.sha256.before_push"
if ($LASTEXITCODE -ne 0) { throw "ssh failed (pre-push pin hash) LASTEXITCODE=$LASTEXITCODE" }
$before = Get-Content "$root\campaign.sha256.before_push" -Raw
if ($before -notmatch $expectedKf) { throw "kf bin sha mismatch before push:`n$before" }
if ($before -notmatch $expectedCamp) { throw "campaign pin sha mismatch before push:`n$before" }
L "pins OK before push"

L "mkdir remote dirs"
ssh @ssh $host_ "mkdir -p $remote/logs $remote/prompts $remote/gen $remote/power $remote/per_token"
if ($LASTEXITCODE -ne 0) { throw "ssh failed (mkdir remote dirs) LASTEXITCODE=$LASTEXITCODE" }

L "scp harness + prompt (no binaries)"
scp @scp $harness "${host_}:${remote}/run_kf_reality_jelly.sh"
if ($LASTEXITCODE -ne 0) { throw "scp failed (harness) LASTEXITCODE=$LASTEXITCODE" }
scp @scp $prompt "${host_}:${remotePrompt}"
if ($LASTEXITCODE -ne 0) { throw "scp failed (prompt) LASTEXITCODE=$LASTEXITCODE" }

L "remote LF check + chmod + re-hash pins"
ssh @ssh $host_ @"
export PATH=/data/data/com.termux/files/usr/bin:`$HOME/bin:`$PATH
chmod 755 $remote/run_kf_reality_jelly.sh
chmod 644 $remotePrompt
echo '--- remote CR check (must be empty) ---'
if grep -l `$'\r' $remote/run_kf_reality_jelly.sh $remotePrompt; then
  echo 'FAIL_CRLF'
  exit 20
fi
echo 'LF_OK remote'
echo '--- kf bin + campaign pin (must match before) ---'
sha256sum ~/bin/kernel_kf/bmoe-cli ~/bin/bmoe-cli.JELLY
echo '--- prompt ---'
sha256sum $remotePrompt
"@ | Tee-Object -FilePath "$root\install_remote.txt"
if ($LASTEXITCODE -ne 0) { throw "ssh failed (remote LF check + re-hash) LASTEXITCODE=$LASTEXITCODE" }
$install = Get-Content "$root\install_remote.txt" -Raw
if ($install -match "FAIL_CRLF") { throw "remote CRLF check failed" }
if ($install -notmatch $expectedKf) { throw "kf bin sha mismatch after push" }
if ($install -notmatch $expectedCamp) { throw "campaign pin sha mismatch after push — abort, pin must never change" }
if ($install -notmatch $expectedFact) { throw "remote prompt sha256 mismatch after scp — expected $expectedFact`n$install" }

L "termux-api-start + battery JSON verify (STOP_BATT false-alarm guard)"
ssh @ssh $host_ @"
export PATH=/data/data/com.termux/files/usr/bin:`$HOME/bin:`$PATH
timeout 10 termux-api-start >/dev/null 2>&1 || true
sleep 3
timeout 10 termux-battery-status
"@ | Tee-Object -FilePath "$root\batt_precheck.json"
if ($LASTEXITCODE -ne 0) { throw "ssh failed (termux-api battery precheck) LASTEXITCODE=$LASTEXITCODE" }
$battRaw = Get-Content "$root\batt_precheck.json" -Raw
L ("battery: {0}" -f ($battRaw -replace "`r","").Trim())
$pct = -1
$plugged = "UNKNOWN"
$temp = -1.0
try {
    $j = $battRaw | ConvertFrom-Json
    if ($null -ne $j.percentage) { $pct = [int]$j.percentage }
    elseif ($null -ne $j.level) { $pct = [int]$j.level }
    if ($null -ne $j.plugged) { $plugged = [string]$j.plugged }
    if ($null -ne $j.temperature) { $temp = [double]$j.temperature }
} catch {
    throw "termux-battery-status did not return JSON after termux-api-start — refuse to start (STOP_BATT false alarm)"
}
if ($plugged -notmatch "UNPLUGGED") {
    throw "device is $plugged — refuse to start (need UNPLUGGED)"
}
if ($pct -ge 0 -and $pct -lt 35) {
    throw "battery $pct% < hard floor 35 — refuse to start"
}
if ($temp -gt 43) {
    throw "battery temp $temp C > abort 43 — refuse to start"
}
if ($pct -ge 0 -and $pct -lt 50) {
    L "WARN battery $pct% < 50 suggested for a 4x1000-token cell; starting anyway (hard floor 35, budget ~30 points)"
} else {
    L "battery $pct% UNPLUGGED temp=$temp — precheck OK"
}

L "refuse a second nohup if STATUS=RUNNING (unless FORCE=1)"
$st = ssh @ssh $host_ "cat $remote/STATUS.txt 2>/dev/null || true"
if ($LASTEXITCODE -ne 0) { throw "ssh failed (STATUS read) LASTEXITCODE=$LASTEXITCODE" }
$st = ($st | Out-String).Trim()
if ($st -eq "RUNNING" -and -not $env:FORCE) {
    throw "remote STATUS=RUNNING — refuse to start a second nohup (set FORCE=1 to override)"
}
if ($st -eq "DONE" -and -not $env:FORCE -and -not $env:RESUME_FROM) {
    throw "remote STATUS=DONE — refuse to restart (set FORCE=1 or RESUME_FROM=N)"
}

L "start harness in nohup + wake-lock"
$startEnv = "OUTDIR=$remote N_GEN=$NGen PROMPT_FILE=$promptRel EXPECTED_PROMPT_SHA=$ExpectedPromptSha BLOCK_PLAN=`"$BlockPlan`""
if ($env:RESUME_FROM) { $startEnv = "$startEnv RESUME_FROM=$($env:RESUME_FROM)" }
if ($env:FORCE) { $startEnv = "$startEnv FORCE=1" }
L ("start cmdline: {0} nohup bash {1}/run_kf_reality_jelly.sh > {1}/nohup.out 2>&1 &" -f $startEnv, $remote)
ssh @ssh $host_ "export PATH=/data/data/com.termux/files/usr/bin:`$HOME/bin:`$PATH; termux-wake-lock >/dev/null 2>&1 || true; $startEnv nohup bash $remote/run_kf_reality_jelly.sh > $remote/nohup.out 2>&1 & echo PID=`$!; sleep 1; cat $remote/STATUS.txt 2>/dev/null; tail -8 $remote/KF_REALITY.master.log 2>/dev/null"
if ($LASTEXITCODE -ne 0) { throw "ssh failed (start harness) LASTEXITCODE=$LASTEXITCODE" }
L "PUSH+START done"
