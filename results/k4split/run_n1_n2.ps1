# k4split night-close helper — DOCUMENT + PUSH only.
# Does not start bmoe-cli / llama-cli. Does not kill remote jobs.
# Does not git push. Does not touch Xiaomi or Jelly.
#
#   powershell -File results/k4split/run_n1_n2.ps1           # print plan
#   powershell -File results/k4split/run_n1_n2.ps1 -Push     # scp after checks
#
# Inference commands live in MORNING.md. Do not add a -Run switch.
param(
    [switch] $Push,
    [switch] $Force   # push even if remote llama-cli is still alive (not recommended)
)

$ErrorActionPreference = "Stop"
$Root = "C:\Users\gualt\Desktop\Kalsa\moe-experiments"
$BinDir = Join-Path $Root "results\k4split\bin"
$Elf = Join-Path $Root "build-android-opencl-k4split\cli\bmoe-cli"
$Staged = Join-Path $BinDir "bmoe-cli"
$Stl = Join-Path $BinDir "libc++_shared.so"
$Key = Join-Path $env:USERPROFILE ".ssh\moe_s23"
$SshHost = "u0_a344@192.168.1.152"
$SshPort = "8022"
$RemoteWs = "~/gdn_k2/k4split"
$PromptDir = Join-Path $Root "results\marco_phase1\speed_s23\prompts"
$KexpSha = "ac44e20c1783b9105b83246fd8ce59892b47a265b84e1323a8a501929877721a"
$KexpSize = 13416430592
$KexpPath = "~/experiments/models/Qwen3.6-35B-A3B-KEXP.gguf"
$CampaignSha = "1ca51420476d4a979552448f1c0b5bc48a04ed2e43643543ce43fa7566bb022f"

function Info([string] $m) { Write-Host $m }
function Die([string] $m) { Write-Host "ERROR: $m" -ForegroundColor Red; exit 2 }

$K6 = "-t 4 --moe-stream --cache-mb 2000 --overlap --io-threads 4 --ubatch 512 --n-expert-used 6 --drop-cold-experts 0.65"

Info "=== k4split run_n1_n2.ps1 (document/push only) ==="
Info "ELF expected: $Elf"
Info "staged:       $Staged"
Info "remote:       ${SshHost}:$RemoteWs  (ssh -p $SshPort -i $Key)"
Info ""

$elfOk = Test-Path $Elf
$stagedOk = Test-Path $Staged
Info ("Android ELF present:  {0}" -f $elfOk)
Info ("Staged bmoe-cli:      {0}" -f $stagedOk)

if (-not $elfOk -and -not $stagedOk) {
    Info ""
    Info "N0 Android link is not done. Resume -j4 (do not raise -j, do not kill other PC jobs):"
    Info "  $Root\results\k4split\build_android.cmd"
    Info "then:"
    Info "  powershell -File $Root\results\k4split\stage_android.ps1"
    if ($Push) { Die "refusing -Push: no Android bmoe-cli to copy" }
}

if ($elfOk) {
    $h = (Get-FileHash -Algorithm SHA256 $Elf).Hash.ToLowerInvariant()
    $len = (Get-Item $Elf).Length
    Info ("ELF sha256: {0}  ({1} B)" -f $h, $len)
}

Info ""
Info "KEXP pin (on device, do this before any load):"
Info "  path $KexpPath"
Info "  size $KexpSize"
Info "  sha  $KexpSha"
Info "Campaign CPU pin (reference only):"
Info "  ~/src/BigMoeOnEdge/build-bmoe/cli/bmoe-cli.CAMPAIGN"
Info "  sha  $CampaignSha"
Info ""
Info "WAIT first:  ssh ... 'pgrep -af llama-cli'   # do not kill"
Info "ABORT:       MemFree < 300 MiB sustained"
Info "Correctness: PLUGGED OK. Speed: UNPLUGGED batt>=45"
Info ""
Info "ARM_CPU   $K6 --dense-weights anon     --ngl 0  --flash-attn off --moe-cpu-experts off"
Info "ARM_A     $K6 --dense-weights anon     --ngl 99 --flash-attn off --moe-cpu-experts off"
Info "ARM_B     $K6 --dense-weights anon     --ngl 99 --flash-attn off --moe-cpu-experts on"
Info "ARM_AUTO  $K6 --dense-weights anon-gpu --ngl 99 --flash-attn off --moe-cpu-experts auto"
Info ""
Info "Full typed commands: $Root\results\k4split\MORNING.md"
Info ""

if (-not $Push) {
    Info "No -Push: nothing copied. Re-run with -Push after the ELF exists and llama-cli is dead."
    exit 0
}

if (-not (Test-Path $Key)) { Die "missing SSH key $Key" }

$srcCli = $Staged
if (-not (Test-Path $srcCli)) {
    if (-not $elfOk) { Die "no staged bmoe-cli and no ELF" }
    Info "staging ELF via stage_android.ps1"
    & powershell -NoProfile -File (Join-Path $Root "results\k4split\stage_android.ps1")
    if ($LASTEXITCODE -ne 0) { Die "stage_android.ps1 failed" }
    if (-not (Test-Path $Staged)) { Die "stage_android.ps1 did not produce $Staged" }
    $srcCli = $Staged
}
if (-not (Test-Path $Stl)) { Die "missing $Stl" }
foreach ($p in @("p_fact.txt", "p_creative.txt")) {
    if (-not (Test-Path (Join-Path $PromptDir $p))) { Die "missing prompt $p" }
}

Info "checking remote llama-cli (must be dead unless -Force)"
$pgrep = & ssh -p $SshPort -i $Key $SshHost "pgrep -af llama-cli || true"
if ($LASTEXITCODE -ne 0) { Die "ssh pgrep failed (is the S23 up?)" }
if ($pgrep -and ($pgrep -match "llama-cli") -and -not $Force) {
    Info $pgrep
    Die "remote llama-cli is alive — wait, do not kill. Re-run -Push when pgrep is empty."
}
if ($pgrep -and ($pgrep -match "llama-cli") -and $Force) {
    Info "WARNING: llama-cli still alive; -Force set, pushing into $RemoteWs anyway"
}

$shaCli = (Get-FileHash -Algorithm SHA256 $srcCli).Hash.ToLowerInvariant()
$shaStl = (Get-FileHash -Algorithm SHA256 $Stl).Hash.ToLowerInvariant()
Info ("pushing bmoe-cli {0}  libc++ {1}" -f $shaCli, $shaStl)

& ssh -p $SshPort -i $Key $SshHost "mkdir -p $RemoteWs/bin $RemoteWs/logs $RemoteWs/prompts"
if ($LASTEXITCODE -ne 0) { Die "remote mkdir failed" }

& scp -P $SshPort -i $Key $srcCli $Stl "${SshHost}:$RemoteWs/bin/"
if ($LASTEXITCODE -ne 0) { Die "scp binaries failed" }

& scp -P $SshPort -i $Key `
    (Join-Path $PromptDir "p_fact.txt") `
    (Join-Path $PromptDir "p_creative.txt") `
    "${SshHost}:$RemoteWs/prompts/"
if ($LASTEXITCODE -ne 0) { Die "scp prompts failed" }

$morning = Join-Path $Root "results\k4split\MORNING.md"
if (Test-Path $morning) {
    & scp -P $SshPort -i $Key $morning "${SshHost}:$RemoteWs/MORNING.md"
}

$verify = @"
set -e
cd $RemoteWs
echo BIN=`$(sha256sum bin/bmoe-cli)
echo STL=`$(sha256sum bin/libc++_shared.so)
echo MODEL_SIZE=`$(stat -c%s $KexpPath)
echo 'expected KEXP sha $KexpSha size $KexpSize'
echo 'hash KEXP yourself: sha256sum $KexpPath  (13 GiB, minutes)'
test -x bin/bmoe-cli
bin/bmoe-cli --help | grep -E 'ngl|flash-attn|moe-cpu-experts|anon-gpu'
echo PUSH_OK
"@
& ssh -p $SshPort -i $Key $SshHost $verify
if ($LASTEXITCODE -ne 0) { Die "remote verify failed" }

Info "PUSH_OK. Do not start inference from this script. Open MORNING.md on the phone."
exit 0
