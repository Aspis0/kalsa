# Push ONLY the harness to Xiaomi 14 and start the ship A/B cell.
# Never writes a campaign binary, library, model, or prompt.
# Verifies 7 runtime shas + model sha + prompt sha; refuses on any mismatch.
# Do not run this from a build step.
$ErrorActionPreference = "Stop"
$ADB = "C:\Users\gualt\AppData\Local\Android\Sdk\platform-tools\adb.exe"
$Serial = "adb-625689a2-9xEOfw._adb-tls-connect._tcp"
$Repo = "C:\Users\gualt\Desktop\Kalsa\moe-experiments"
$Root = Join-Path $Repo "results\kernel_ship_ab_xiaomi"
$ShaFile = Join-Path $Repo "models_staging\ship_runtime_s23_0ac612de\DEVICE.sha256"
$Dev = "/data/local/tmp/ship_ab"
$DevBin = "$Dev/bin"
$UptimeMaxS = 1800
$ExpectedModelSha = "b04281c27de5d968d577f310d982273b1b13bdbd8117b3ecffffeebfe222f0a7"
$ExpectedModelSize = "8071293600"
$ExpectedFactSha = "b5301c32c0bd8aae4cf5c25d667a52eef05b940a459a2e9c82b1b6134cf0dcbd"
$RuntimeNames = @(
    "bmoe-cli",
    "libc++_shared.so",
    "libggml-base.so",
    "libggml-cpu.so",
    "libggml.so",
    "libllama-common.so",
    "libllama.so"
)

function L([string]$m) {
    $line = "[{0}] {1}" -f (Get-Date -Format o), $m
    Add-Content -Path (Join-Path $Root "push.log") -Value $line -Encoding utf8
    Write-Host $line
}

function Adb([string]$cmd) {
    $out = & $ADB -s $Serial shell $cmd 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "adb shell failed ($LASTEXITCODE): $cmd`n$out"
    }
    return $out
}

function AdbRaw([string]$cmd) {
    return & $ADB -s $Serial shell $cmd 2>&1
}

$harness = Join-Path $Root "run_ship_ab_xiaomi.sh"
if (-not (Test-Path $harness)) { throw "missing $harness" }
if (-not (Test-Path $ShaFile)) { throw "missing $ShaFile" }

$bytes = [System.IO.File]::ReadAllBytes($harness)
$crlf = $false
for ($i = 0; $i -lt $bytes.Length - 1; $i++) {
    if ($bytes[$i] -eq 13 -and $bytes[$i + 1] -eq 10) { $crlf = $true; break }
}
if ($crlf) {
    throw "harness has CRLF line endings — refuse to push (device sh dies silently)"
}
if ($bytes.Length -eq 0) { throw "harness is empty" }

$expected = @{}
Get-Content -LiteralPath $ShaFile | ForEach-Object {
    if ($_ -match '^([0-9a-fA-F]{64})\s+(\S+)\s*$') {
        $expected[$Matches[2]] = $Matches[1].ToLowerInvariant()
    }
}
foreach ($n in $RuntimeNames) {
    if (-not $expected.ContainsKey($n)) {
        throw "DEVICE.sha256 missing entry for $n"
    }
}

L "adb devices"
$devs = & $ADB devices -l
L ($devs | Out-String).Trim()
$state = & $ADB -s $Serial get-state
if (($state | Out-String).Trim() -ne "device") {
    throw "serial $Serial is not in state device (got $state)"
}

L "verify 7 runtime shas on device (read-only; never push binaries)"
$runtimeGot = @()
foreach ($n in $RuntimeNames) {
    $path = "$DevBin/$n"
    $exists = (Adb "test -f $path && echo YES || echo NO" | Out-String).Trim()
    if ($exists -ne "YES") {
        throw "missing runtime file $path — refuse (will not push a binary)"
    }
    $line = (Adb "sha256sum $path" | Out-String).Trim()
    $got = (($line -split '\s+')[0]).ToLowerInvariant()
    $want = $expected[$n]
    L "RUNTIME $n $got"
    $runtimeGot += $line
    if ($got -ne $want) {
        throw "SHA mismatch $n want $want got $got — refuse to start"
    }
}
Set-Content -Path (Join-Path $Root "runtime.sha256.on_device") -Value ($runtimeGot -join "`n") -Encoding ascii
L "RUNTIME PIN OK 7/7 (no binary written)"

L "chmod 755 on existing runtime (content untouched)"
Adb "chmod 755 $DevBin/bmoe-cli $DevBin/libc++_shared.so $DevBin/libggml-base.so $DevBin/libggml-cpu.so $DevBin/libggml.so $DevBin/libllama-common.so $DevBin/libllama.so" | Out-Null

L "verify model size + sha (read-only; never push the gguf)"
$modelPath = "$Dev/Mellum2-12B-A2.5B-Instruct-Q4_K_M.gguf"
$msize = (Adb "stat -c%s $modelPath" | Out-String).Trim()
L "MODEL size=$msize"
if ($msize -ne $ExpectedModelSize) {
    throw "MODEL size $msize != $ExpectedModelSize — refuse to start"
}
L "MODEL sha256 (8 GiB; may take a minute)..."
$mline = (Adb "sha256sum $modelPath" | Out-String).Trim()
$msha = (($mline -split '\s+')[0]).ToLowerInvariant()
L "MODEL $mline"
Set-Content -Path (Join-Path $Root "model.sha256.on_device") -Value $mline -Encoding ascii
if ($msha -ne $ExpectedModelSha) {
    throw "MODEL sha mismatch want $ExpectedModelSha got $msha — refuse to start"
}

L "verify prompt sha (read-only; never push the prompt)"
$pline = (Adb "sha256sum $Dev/prompts/p_fact.txt" | Out-String).Trim()
$psha = (($pline -split '\s+')[0]).ToLowerInvariant()
L "PROMPT $pline"
Set-Content -Path (Join-Path $Root "prompt.sha256.on_device") -Value $pline -Encoding ascii
if ($psha -ne $ExpectedFactSha) {
    throw "PROMPT sha mismatch want $ExpectedFactSha got $psha — refuse to start"
}

L "fresh-reboot gate (uptime <= $UptimeMaxS s on a NEW session)"
$up = (Adb "awk '{print int(`$1)}' /proc/uptime" | Out-String).Trim()
L "uptime_s=$up"
if (-not ($up -match '^\d+$')) { throw "could not parse uptime: $up" }
$resumeAt = (Adb "test -f $Dev/RESUME_AT && echo YES || echo NO" | Out-String).Trim()
$devStatus = (AdbRaw "cat $Dev/STATUS.txt 2>/dev/null || echo NONE" | Out-String).Trim()
L "device STATUS=$devStatus RESUME_AT=$resumeAt"
if ([int]$up -gt $UptimeMaxS) {
    $continuation = ($resumeAt -eq "YES") -or ($devStatus -match '^(RUNNING|STOP_BATT|STOP_PLUGGED|STOP_THERMAL|STOP_VOID|STOP_RAM)$')
    if ($continuation) {
        L "WARN uptime ${up}s > ${UptimeMaxS}s but continuation detected (STATUS=$devStatus RESUME_AT=$resumeAt) — starting harness; PREREG continuation does not re-require reboot"
    } else {
        throw "uptime ${up}s > ${UptimeMaxS}s (30 min). PREREG requires a fresh reboot. Reboot the phone, reconnect wireless adb, re-run this script."
    }
}

L "pre-check battery + UNPLUGGED + thermal"
$batt = (Adb "dumpsys battery" | Out-String)
Set-Content -Path (Join-Path $Root "batt_precheck.txt") -Value $batt -Encoding utf8
$level = -1
$temp10 = -1
if ($batt -match '(?m)^\s+level:\s+(\d+)') { $level = [int]$Matches[1] }
if ($batt -match '(?m)^\s+temperature:\s+(\d+)') { $temp10 = [int]$Matches[1] }
$ac = $batt -match '(?m)^\s+AC powered:\s+true'
$usb = $batt -match '(?m)^\s+USB powered:\s+true'
$wl = $batt -match '(?m)^\s+Wireless powered:\s+true'
$dock = $batt -match '(?m)^\s+Dock powered:\s+true'
$plugged = $ac -or $usb -or $wl -or $dock
$tempC = if ($temp10 -ge 0) { [math]::Round($temp10 / 10.0, 1) } else { -1 }
L ("battery level={0} tempC={1} plugged={2}" -f $level, $tempC, $plugged)
if ($plugged) { throw "device is PLUGGED — refuse to start (need UNPLUGGED)" }
if ($level -ge 0 -and $level -lt 45) { throw "battery $level% < hard floor 45 — refuse to start" }
if ($temp10 -gt 430) { throw "temp $tempC C > 43 — refuse to start" }
if ($level -ge 0 -and $level -lt 50) {
    L "WARN battery $level% < 50 suggested for a full 24-run cycle; starting anyway (hard floor 45)"
}

$mem = (Adb "grep -E 'MemTotal|MemAvailable|SwapTotal|SwapFree' /proc/meminfo" | Out-String).Trim()
L "meminfo $mem"

L "mkdir remote log dirs (no binaries)"
Adb "mkdir -p $Dev/logs $Dev/prompts $Dev/mem $Dev/gen $Dev/power" | Out-Null

L "adb push harness only"
& $ADB -s $Serial push $harness "$Dev/run_ship_ab_xiaomi.sh"
if ($LASTEXITCODE -ne 0) { throw "adb push harness failed" }
Adb "chmod 755 $Dev/run_ship_ab_xiaomi.sh" | Out-Null

L "start harness in nohup (device-side sh)"
$startCmd = "cd $Dev && nohup sh $Dev/run_ship_ab_xiaomi.sh > $Dev/nohup.out 2>&1 & echo PID:`$!; sleep 2; echo ---STATUS---; cat $Dev/STATUS.txt 2>/dev/null || true; echo ---TAIL---; tail -16 $Dev/SHIP.master.log 2>/dev/null || true"
$start = AdbRaw $startCmd
L ($start | Out-String).Trim()
L "PUSH+START done"
