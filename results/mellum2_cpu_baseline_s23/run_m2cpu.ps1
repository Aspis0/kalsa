# Queue #23 — Mellum2 llama-bench mmap CPU baseline. PLUGGED (owner). No SIGTERM.
$ErrorActionPreference = "Stop"
[System.Threading.Thread]::CurrentThread.CurrentCulture = [Globalization.CultureInfo]::InvariantCulture
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = [IO.Path]::GetFullPath((Join-Path $Root "..\.."))
$N10Root = Join-Path $RepoRoot "results\olmoe_gpu_moe_s23\n10"
. (Join-Path $N10Root "_lib_n10.ps1")

$PinImpl = "8adc148c0909e8ebbbf6ed41970b2c07ac0319db96454ad0dd7b2f281a9b8807"
$PinOpencl = "f432548328af0429fd0f885ccde70cae69f40666118836c713491602dedd6d6d"
$PinStub = "b2ae0fa6c413a5049a87b0706f2687cd7035ae5e43985fe40779dc0a7d225b2c"
$PinMellum = "b04281c27de5d968d577f310d982273b1b13bdbd8117b3ecffffeebfe222f0a7"
$ModelDev = "/data/local/tmp/_gguf_keep/Mellum2-12B-A2.5B-Instruct-Q4_K_M.gguf"
$Tag = "m2_ngl0_nr_n16"
$ProbeDir = Join-Path $Root "probes"
$CellDir = Join-Path $Root "cells"
$ReportPath = Join-Path $RepoRoot "scratchpad\agents\m2-cpu-baseline\REPORT.md"
$LogPath = Join-Path $Root "session.log"
$WallCapSec = 600
$StallSec = 900
$MemCliffKb = 2 * 1024 * 1024

New-Item -ItemType Directory -Force -Path $Root, $ProbeDir, $CellDir, (Split-Path $ReportPath) | Out-Null
function Log([string]$Msg) {
    $line = "{0} {1}" -f (Get-Date).ToString("o"), $Msg
    Write-Host $line
    Add-Content -Path $LogPath -Value $line -Encoding utf8
}
function Save-Probe([string]$Name, [string]$Text) {
    $p = Join-Path $ProbeDir $Name
    Set-Content -Path $p -Value $Text -Encoding utf8
    return $p
}
function AdbSoft([string]$ShellCmd) {
    $o = & $Adb -s $Serial shell $ShellCmd 2>&1
    return ($o | Out-String).Trim()
}

Assert-UsbS23
Log "M2 CPU BASELINE START serial=$Serial PLUGGED_RUN=owner_instruction"
Save-Probe "adb_devices.txt" ((& $Adb devices | Out-String)) | Out-Null

Invoke-S23 @("push", (Join-Path $Root "one_cell_m2cpu.sh"), "$DevDir/one_cell_m2cpu.sh")
Invoke-S23 @("push", (Join-Path $Root "launch_bg_m2cpu.sh"), "$DevDir/launch_bg_m2cpu.sh")
AdbOut "chmod 755 $DevDir/one_cell_m2cpu.sh $DevDir/launch_bg_m2cpu.sh" | Out-Null
AdbOut "mkdir -p $DevDir/logs" | Out-Null

$impl = Get-OnDeviceSha "libllama-bench-impl.so"
$ocl = Get-OnDeviceSha "libggml-opencl.so"
$stub = Get-OnDeviceSha "llama-bench"
Log "SHA impl=$($impl.sha) opencl=$($ocl.sha) stub=$($stub.sha)"
if ($impl.sha -ne $PinImpl) { throw "impl sha $($impl.sha) != $PinImpl" }
if ($ocl.sha -ne $PinOpencl) { throw "opencl sha $($ocl.sha) != $PinOpencl" }
if ($stub.sha -ne $PinStub) { throw "stub sha $($stub.sha) != $PinStub" }
Save-Probe "sha_binaries.txt" ("{0}`n{1}`n{2}" -f $impl.line, $ocl.line, $stub.line) | Out-Null

$ggufLine = AdbOut "sha256sum $ModelDev"
Log "MELLUM2 GGUF $ggufLine"
$ggufSha = (($ggufLine -split "\s+")[0]).ToLower()
if ($ggufSha -ne $PinMellum) { throw "Mellum2 sha $ggufSha != $PinMellum" }
Save-Probe "sha_mellum2.txt" $ggufLine | Out-Null

$envDump = AdbOut "printenv | grep GGML_OPENCL || echo NO_GGML_OPENCL_ENV_VARS"
Save-Probe "log_alloc_unset.env.txt" $envDump | Out-Null
if ($envDump -match "(?m)^GGML_OPENCL_LOG_ALLOC=") { throw "GGML_OPENCL_LOG_ALLOC is SET" }

$batt0 = Get-BattHeader
Log ("PLUGGED_DECLARE usb={0} ac={1} wireless={2} level={3} temp_c={4}" -f $batt0.usb, $batt0.ac, $batt0.wireless, $batt0.level, $batt0.temp_c)
Save-Probe "session_batt.txt" $batt0.raw | Out-Null
# Owner: run PLUGGED. Do not unplug-gate.

AdbOut "settings put system screen_off_timeout 900000" | Out-Null
AdbOut "settings put system screen_brightness_mode 0" | Out-Null
AdbOut "settings put system screen_brightness 128" | Out-Null
AdbSoft "input keyevent KEYCODE_WAKEUP" | Out-Null
Start-Sleep -Milliseconds 400
$wake = Get-WakeOnly
Save-Probe "wake_prelaunch.txt" $wake | Out-Null
if (-not (Test-WakeAwake $wake)) {
    AdbSoft "input keyevent KEYCODE_WAKEUP" | Out-Null
    Start-Sleep -Seconds 1
    $wake = Get-WakeOnly
    Save-Probe "wake_prelaunch_retry.txt" $wake | Out-Null
}
if (-not (Test-WakeAwake $wake)) { throw "wake not Awake: $wake" }

$alive0 = AdbSoft "pidof llama-bench 2>/dev/null || true"
if ($alive0 -and $alive0 -ne "true") { throw "llama-bench already running pids=$alive0 (no SIGTERM)" }

$preBatt = Get-BattHeader
$preMem = AdbOut "grep -E 'MemAvailable|MemFree' /proc/meminfo"
$preWake = Get-WakeOnly
Save-Probe "${Tag}_PRE_batt.txt" $preBatt.raw | Out-Null
Save-Probe "${Tag}_PRE_mem.txt" $preMem | Out-Null
Save-Probe "${Tag}_PRE_wake.txt" $preWake | Out-Null
$pre = Get-Sensors
Log ("PRE level={0} temp_c={1} MemAvailable={2} wake={3}" -f $pre.level, $pre.temp_c, $pre.mem_available_kb, $pre.wake)

$tLaunch = Get-Date
Log "LAUNCH_DETACH sh $DevDir/launch_bg_m2cpu.sh $Tag"
$wrap = AdbSoft "sh $DevDir/launch_bg_m2cpu.sh $Tag"
Log "LAUNCH_DETACH wrapper=$wrap"
Start-Sleep -Seconds 2

function Read-DeviceRc {
    $line = AdbSoft "cat $DevDir/logs/$Tag.rc 2>/dev/null || echo NOTYET"
    $line = ($line -replace "`r", "").Trim()
    if ($line -eq "NOTYET" -or $line -eq "") { return $null }
    if ($line -match '^(\d+)') { return $Matches[1] }
    return $null
}

$sw = [Diagnostics.Stopwatch]::StartNew()
$stall = $false
$devRc = $null
while ($null -eq $devRc) {
    Start-Sleep -Milliseconds 500
    $devRc = Read-DeviceRc
    if ($null -ne $devRc) { break }
    if ($sw.Elapsed.TotalSeconds -ge $StallSec) {
        $devRc = Read-DeviceRc
        if ($null -ne $devRc) { break }
        $stall = $true
        break
    }
}
$wall = $sw.Elapsed.TotalSeconds
Log ("RETURN stall={0} wall_s={1} device_rc={2} over_cap={3}" -f $stall, $wall, $devRc, ($wall -ge $WallCapSec))

if ($stall) {
    Save-Probe "${Tag}_stall_ps.txt" (AdbSoft "ps -A | grep -E 'llama-bench|PID' || true") | Out-Null
    throw "15 min stall on $Tag — leave process; no SIGTERM. wall_s=$wall"
}

$outLocal = Join-Path $CellDir "$Tag.stdout.txt"
$errLocal = Join-Path $ProbeDir "$Tag.err"
$rcLocal = Join-Path $ProbeDir "$Tag.rc"
& $Adb -s $Serial pull "$DevDir/logs/$Tag.out" $outLocal
& $Adb -s $Serial pull "$DevDir/logs/$Tag.err" $errLocal
& $Adb -s $Serial pull "$DevDir/logs/$Tag.rc" $rcLocal
if (Test-Path $outLocal) { Copy-Item $outLocal (Join-Path $ProbeDir "$Tag.out") -Force }

$rc = if (Test-Path $rcLocal) { (Get-Content $rcLocal -Raw).Trim() } else { "MISSING" }
Log "DEVICE_RC rc=$rc"

try { $post = Get-Sensors } catch { throw "sensors failed after $Tag — possible power-off" }
$postBatt = Get-BattHeader
$postMem = AdbOut "grep -E 'MemAvailable|MemFree' /proc/meminfo"
$postWake = Get-WakeOnly
Save-Probe "${Tag}_POST_batt.txt" $postBatt.raw | Out-Null
Save-Probe "${Tag}_POST_mem.txt" $postMem | Out-Null
Save-Probe "${Tag}_POST_wake.txt" $postWake | Out-Null
Log ("POST level={0} temp_c={1} MemAvailable={2} wake={3}" -f $post.level, $post.temp_c, $post.mem_available_kb, $post.wake)

if ($rc -eq "MISSING" -or $rc -eq "") { throw "missing device rc" }
if ($rc -ne "0") { throw "llama-bench rc=$rc (wall-class)" }
$drop = [int64]$pre.mem_available_kb - [int64]$post.mem_available_kb
Log "MemAvailable drop_kb=$drop cliff=$MemCliffKb"
if ($drop -ge $MemCliffKb) { throw "oomwall-class MemAvailable drop $drop kB" }
if (-not (Test-WakeAwake $post.wake)) { Log "WARN wake_post not Awake: $($post.wake)" }

$tg = $null
$nr = $null
$ngl = $null
$nth = $null
$fa = $null
if (Test-Path $outLocal) {
    Get-Content $outLocal | ForEach-Object {
        $t = $_.Trim()
        if ($t.StartsWith("{")) {
            try {
                $j = $t | ConvertFrom-Json
                if ($j.n_gen -eq 16 -and $j.n_prompt -eq 0) {
                    $tg = [double]$j.avg_ts
                    if ($j.PSObject.Properties.Name -contains "no_repack") { $nr = $j.no_repack }
                    $ngl = $j.n_gpu_layers
                    $nth = $j.n_threads
                    $fa = $j.flash_attn
                }
            } catch {}
        }
    }
}
if ($null -eq $tg) { throw "no tg jsonl n=16 in $outLocal" }
if ($nth -ne 4) { throw "n_threads=$nth != 4" }
if ($fa -ne 0) { throw "flash_attn=$fa != 0" }
if ($ngl -ne 0) { throw "n_gpu_layers=$ngl != 0" }
$nrOk = ($nr -eq $true -or [string]$nr -eq "True" -or [string]$nr -eq "true" -or [string]$nr -eq "1")
if (-not $nrOk) { throw "no_repack=$nr — -nr mandatory" }

$overCap = ($wall -ge $WallCapSec)
$rec = [ordered]@{
    tag = $Tag
    extra = "-ngl 0 -nr"
    n = 16
    rc = $rc
    tg = $tg
    no_repack = [string]$nr
    n_gpu_layers = $ngl
    n_threads = $nth
    flash_attn = $fa
    wall_s = $wall
    over_cap = $overCap
    plugged = $true
    ac = $postBatt.ac
    usb = $postBatt.usb
    wireless = $postBatt.wireless
    level_pre = $pre.level
    level_post = $post.level
    temp_c_pre = $pre.temp_c
    temp_c_post = $post.temp_c
    charge_counter_pre = $preBatt.charge_counter
    charge_counter_post = $postBatt.charge_counter
    mem_avail_pre = $pre.mem_available_kb
    mem_avail_post = $post.mem_available_kb
    wake_pre = $wake
    wake_post = $post.wake
    sha_impl = $impl.sha
    sha_opencl = $ocl.sha
    sha_stub = $stub.sha
    sha_gguf = $ggufSha
    iso_launch = $tLaunch.ToString("o")
    iso_return = (Get-Date).ToString("o")
    note = "PLUGGED (owner). Same harness as n10 load-sanity 0.222682 t/s (-ngl 2 -ncmoe 99, unplugged). Contrasts with 5.10 bmoe+recipe product number (DIFFERENT harness)."
}
($rec | ConvertTo-Json -Depth 6) | Set-Content -Path (Join-Path $Root "$Tag.json") -Encoding utf8
$rec | Export-Csv -Path (Join-Path $Root "runs.csv") -NoTypeInformation -Encoding utf8
Log ("RESULT tg={0} wall_s={1} over_cap={2} plugged=true" -f $tg, $wall, $overCap)

$tg3 = $tg.ToString("F3", [Globalization.CultureInfo]::InvariantCulture)
$wall3 = $wall.ToString("F1", [Globalization.CultureInfo]::InvariantCulture)
$report = @"
# Mellum2 CPU baseline — queue #23 (same-harness streaming-table CPU arm)

**PLUGGED.** Owner instruction: run anyway. AC powered true, USB false, Wireless false. Level $($pre.level)->$($post.level). The GPU arms of this comparison (n10 Mellum2 cells) were **unplugged**. At the expected ~20x effect size the plugged bias is cosmetic; it is on the record. **Do not quote this as an unplugged absolute.**

## Number

**tg n=16: $tg3 t/s** (full precision ``$tg``). wall_s=$wall3. over_cap=$overCap. rc=0. ``no_repack=true``. ``n_gpu_layers=0``. ``n_threads=4``. ``flash_attn=0``.

Command: ``llama-bench -m Mellum2-Q4_K_M -nr -fa off -t 4 -o jsonl -p 0 -n 16 -r 1 -ngl 0``.

## Cross-harness context

| cell | harness | ngl | n | tg t/s | plugged | what it is |
|---|---|---|---:|---:|---|---|
| this cell | llama-bench mmap HEAD ``-nr`` | 0 | 16 | **$tg3** | **yes (AC)** | pure CPU baseline, same harness as n10 |
| n10 load sanity | llama-bench mmap noextra (old pin) | 2 + ncmoe 99 | 16 | **0.223** | no | dense GPU / experts CPU |
| n10 experts-GPU | llama-bench mmap noextra | 2 | 512 | <0.11 (exploratory) | no | experts on GPU, streaming-class |
| lineup product card | **bmoe-cli + recipe** (DIFFERENT harness) | CPU stream | ~222 gen | **5.098** median | no | not comparable as a speedup of this cell |

This number pairs with the n10 **0.22 t/s** ``-ngl 2 -ncmoe 99`` cell **SAME harness**. Both contrast with the **5.10** bmoe+recipe product number **DIFFERENT harness**. Do not divide 5.10 / $tg3 and call it a llama-bench speedup.

## Conditions

- Serial: ``$Serial``
- Binaries (s3oracle, verified, no rebuild): impl ``8adc148c...``, opencl ``f4325483...`` (unused at ngl=0, noted), stub ``b2ae0fa6...``
- GGUF: ``$ModelDev`` sha ``$PinMellum``
- Awake pre: ``$wake``
- wake_post: ``$($post.wake)``
- temp_c: $($pre.temp_c) -> $($post.temp_c)
- MemAvailable kB: $($pre.mem_available_kb) -> $($post.mem_available_kb) (drop $drop; cliff 2097152)
- No SIGTERM. 10-min cap = exclude/wait (over_cap=$overCap).

Raw: ``results/mellum2_cpu_baseline_s23/``
"@
Set-Content -Path $ReportPath -Value $report -Encoding utf8
Set-Content -Path (Join-Path $Root "REPORT.md") -Value $report -Encoding utf8
Log "DONE tg=$tg"
Write-Host "M2 CPU baseline done tg=$tg. See $Root and $ReportPath"
