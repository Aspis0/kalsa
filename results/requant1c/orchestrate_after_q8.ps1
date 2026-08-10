# orchestrate_after_q8.ps1 - certutil only (no Get-FileHash)
$ErrorActionPreference = "Continue"
$root = "C:\Users\gualt\Desktop\Kalsa\moe-experiments"
Set-Location $root
$gate = Join-Path $root "results\requant1c\q8_gate.txt"
$log = Join-Path $root "logs\orchestrate-postcrash.log"
$expectedSha = "d1a395809f65a43a13ad119eb4e7acdef1ac6d68120f39902c8ab96e72794a59"
$expectedSize = [int64]36903140320
$q8 = Join-Path $root "models\Qwen3.6-35B-A3B-Q8_0.gguf"
$kexp = Join-Path $root "models\Qwen3.6-35B-A3B-KEXP.gguf"

function L($m){ $x = "{0} {1}" -f (Get-Date -Format o), $m; Add-Content $log $x }
function Write-Utf8NoBom([string]$path, [string[]]$lines) {
    $enc = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllLines($path, $lines, $enc)
}
function Get-Sha256Certutil([string]$path) {
    $tmp = Join-Path $env:TEMP ("sha_" + [guid]::NewGuid().ToString() + ".txt")
    $p = Start-Process -FilePath "certutil.exe" -ArgumentList @("-hashfile", $path, "SHA256") -Wait -PassThru -NoNewWindow -RedirectStandardOutput $tmp -RedirectStandardError "$tmp.err"
    if ($p.ExitCode -ne 0) { throw "certutil exit $($p.ExitCode)" }
    $got = $null
    foreach ($line in (Get-Content $tmp)) {
        $t = ($line -replace '\s','').Trim()
        if ($t -match '^[0-9a-fA-F]{64}$') { $got = $t.ToLowerInvariant(); break }
    }
    Remove-Item $tmp,"$tmp.err" -Force -EA SilentlyContinue
    if (-not $got) { throw "no hash from certutil" }
    return $got
}
function Get-AcIndex($sub,$set) {
  $o = powercfg /query SCHEME_CURRENT $sub $set 2>&1 | Out-String
  if ($o -match 'Current AC Power Setting Index:\s*0x([0-9a-fA-F]+)') {
    return [Convert]::ToInt64($Matches[1], 16)
  }
  return -1
}

Write-Utf8NoBom (Join-Path $root "results\requant1c\orch.pid") @("$PID")
L "orchestrator start pid=$PID (certutil)"

$vid = Get-AcIndex SUB_VIDEO VIDEOIDLE
$sb = Get-AcIndex SUB_SLEEP STANDBYIDLE
L "power video_ac=$vid standby_ac=$sb"
if ($vid -ne 0 -or $sb -ne 0) {
  powercfg /change standby-timeout-ac 0 | Out-Null
  powercfg /change monitor-timeout-ac 0 | Out-Null
  powercfg /change hibernate-timeout-ac 0 | Out-Null
}
if ((Get-AcIndex SUB_VIDEO VIDEOIDLE) -ne 0) { L "ABORT monitor not 0"; exit 15 }

L "wait PASS"
while ($true) {
  if (Test-Path $gate) {
    $t = Get-Content $gate -Raw
    if ($t -match '(?m)^Q8_GATE=PASS\b') { L "gate PASS"; break }
    if ($t -match '(?m)^Q8_GATE=FAIL') { L "gate FAIL $t"; exit 10 }
  }
  Start-Sleep -Seconds 15
}

if (-not (Test-Path $q8)) { L "missing Q8"; exit 11 }
$sz = (Get-Item $q8).Length
if ($sz -ne $expectedSize) { L "ABORT size $sz"; exit 11 }
L "re-hash with certutil..."
$got = Get-Sha256Certutil $q8
if ($got -ne $expectedSha) { L "ABORT sha $got"; exit 12 }
L "re-sha OK $got"

$free = [int64](Get-PSDrive C).Free
L "free=$free"
if ($free -lt 25GB) { L "ABORT disk"; exit 13 }
if (Test-Path $kexp) { L "ABORT KEXP exists"; exit 14 }
if (Get-Process llama-quantize -EA SilentlyContinue) { L "ABORT quantize running"; exit 16 }

L "START quantize"
$p = Start-Process -FilePath "cmd.exe" -ArgumentList "/c","$root\results\requant1c\run_quantize_1c_safe.bat" -Wait -PassThru -WindowStyle Hidden -WorkingDirectory $root -RedirectStandardOutput "$root\logs\quantize-safe-stdout.log" -RedirectStandardError "$root\logs\quantize-safe-stderr.log"
L ("quantize exit={0}" -f $p.ExitCode)
if ($p.ExitCode -ne 0) {
  if (Test-Path "$root\results\requant1c\quantize.log") { Get-Content "$root\results\requant1c\quantize.log" -Tail 40 | ForEach-Object { L $_ } }
  exit $p.ExitCode
}
if (-not (Test-Path $kexp)) { L "KEXP missing"; exit 17 }
L ("KEXP size={0}" -f (Get-Item $kexp).Length)

$vp = Start-Process -FilePath "python" -ArgumentList @("$root\results\requant1c\verify_kexp.py", "$kexp") -Wait -PassThru -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput "$root\results\requant1c\verify_kexp.out" -RedirectStandardError "$root\results\requant1c\verify_kexp.err"
L ("verify exit={0}" -f $vp.ExitCode)
Get-Content "$root\results\requant1c\verify_kexp.out" -EA SilentlyContinue | ForEach-Object { L $_ }
if ($vp.ExitCode -ne 0) { Write-Utf8NoBom (Join-Path $root "results\requant1c\orch_done.txt") @("ORCH=VERIFY_FAIL"); exit 18 }
$vout = Get-Content "$root\results\requant1c\verify_kexp.out" -Raw -EA SilentlyContinue
if ($vout -match 'EXP_BAD|VERIFY_FAIL|dens_bad|missing_in_kexp') {
  Write-Utf8NoBom (Join-Path $root "results\requant1c\orch_done.txt") @("ORCH=VERIFY_CONTENT_FAIL"); exit 19
}

$kh = Get-Sha256Certutil $kexp
("$kh *models/Qwen3.6-35B-A3B-KEXP.gguf") | Set-Content "$root\results\requant1c\kexp.sha256"
L "kexp sha=$kh"
$st = Get-Content "$root\results\requant1c\status_A.txt" | ForEach-Object { if ($_ -match '^phase=') { "phase=A_QUANTIZE_DONE" } else { $_ } }
Set-Content "$root\results\requant1c\status_A.txt" $st
Write-Utf8NoBom (Join-Path $root "results\requant1c\orch_done.txt") @("ORCH=DONE")
L "PHASE A complete"
exit 0
