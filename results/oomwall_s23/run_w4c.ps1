# W4c host launcher — NOEXTRA llama-bench (use_extra_bufts=false), Mellum2
# -ngl 2 -ncmoe 99 (W1 config). Crash-risk. USB only. Owner at the power button.
# Pushes ONLY libllama-bench-impl.so (+ identical llama-bench stub) from staging/noextra.
# NEVER pushes libggml-* or libllama.so (cmake re-run drifted libggml-base.so /
# libllama-common.so in the build dir; those must not land on the device).
$ErrorActionPreference = "Stop"
$UsbSerial = "R3CW406P8CV"
$Jelly = "192.168.1.82"
$DevDir = "/data/local/tmp/s3oracle"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Noextra = Join-Path $Root "staging\noextra"

$Adb = $null
foreach ($c in @(
    "adb",
    "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe",
    "$env:ANDROID_HOME\platform-tools\adb.exe"
)) {
    if ($c -eq "adb") {
        $cmd = Get-Command adb -ErrorAction SilentlyContinue
        if ($cmd) { $Adb = $cmd.Source; break }
    } elseif (Test-Path $c) { $Adb = $c; break }
}
if (-not $Adb) { throw "adb not found" }

$PinOpencl     = "2ed2e48a98e50f324c2aaed0c8fa7ed5b1c0fb09bff8f9a153f79420a7d69a87"
$PinLlama      = "f8b11fc34be81291c01cc77a657d267eaf7f102ed6cb6ef708bbaab7730a667d"
$PinBench      = "b2ae0fa6c413a5049a87b0706f2687cd7035ae5e43985fe40779dc0a7d225b2c"
$PinImplNoex   = "d2030f23db3b4f62f6934c9de831050e71e87c7cfda6e5059d53099ec8b60346"
$PinImplStock  = "bad179520546f8d5316cd98124e948d025e8acb2999bf92b94977879ce72c171"

function Invoke-S23([string[]]$A) {
    & $Adb -s $UsbSerial @A
    if ($LASTEXITCODE -ne 0) { throw "adb failed: $A (exit $LASTEXITCODE)" }
}
function AdbOut([string]$ShellCmd) {
    $o = & $Adb -s $UsbSerial shell $ShellCmd
    if ($LASTEXITCODE -ne 0) { throw "adb shell failed: $ShellCmd (exit $LASTEXITCODE)" }
    return ($o | Out-String).Trim()
}

Write-Host "W4c USB serial=$UsbSerial adb=$Adb"
$devs = & $Adb devices
Write-Host $devs
if ($devs -match [regex]::Escape($Jelly)) {
    Write-Host "NOTE: Jelly is visible — this script will not use it."
}
if (-not ($devs | Select-String -Pattern "^$UsbSerial\s+device")) {
    throw "USB serial $UsbSerial not in 'adb devices' as device. Plug the S23 after power-on. Do not use wireless/Jelly."
}

$implPc = Join-Path $Noextra "libllama-bench-impl.so"
$benchPc = Join-Path $Noextra "llama-bench"
if (-not (Test-Path $implPc)) { throw "missing $implPc" }
if (-not (Test-Path $benchPc)) { throw "missing $benchPc" }

Write-Host "=== pre-check ==="
$batt = AdbOut "dumpsys battery"
$batt | Select-String -Pattern "USB powered|AC powered|^  status:|^  level:|^  temperature:" | ForEach-Object { Write-Host $_ }
$wake = AdbOut "dumpsys power" | Select-String -Pattern "mWakefulness=" | Select-Object -First 1
Write-Host $wake
Write-Host (AdbOut "grep MemAvailable /proc/meminfo")
Write-Host ("uptime " + (AdbOut "uptime"))

Write-Host "=== sha-verify OPENCL/llama still stock (must not have drifted) ==="
function CheckSha([string]$Rel, [string]$Expect) {
    $line = AdbOut "sha256sum $DevDir/$Rel"
    Write-Host $line
    $got = (($line -split "\s+")[0]).ToLower()
    if ($got -ne $Expect) {
        throw "SHA mismatch $Rel got=$got expect=$Expect — abort."
    }
}
CheckSha "libggml-opencl.so" $PinOpencl
CheckSha "libllama.so" $PinLlama

Write-Host "=== push NOEXTRA impl (the W4c payload) + llama-bench stub ==="
Write-Host "PC impl sha must be $PinImplNoex (NOT stock $PinImplStock)"
Invoke-S23 @("push", $implPc, "$DevDir/libllama-bench-impl.so")
Invoke-S23 @("push", $benchPc, "$DevDir/llama-bench")
AdbOut "chmod 755 $DevDir/llama-bench" | Out-Null
CheckSha "libllama-bench-impl.so" $PinImplNoex
CheckSha "llama-bench" $PinBench
CheckSha "libggml-opencl.so" $PinOpencl

Write-Host "=== push w4c.sh ==="
Invoke-S23 @("push", (Join-Path $Root "w4c.sh"), "$DevDir/w4c.sh")
AdbOut "chmod 755 $DevDir/w4c.sh" | Out-Null

$outLog = Join-Path $Root "w4c.adb.log"
Write-Host "=== RUN W4c — streaming to $outLog ==="
Write-Host "OWNER AT POWER BUTTON. Mellum2 -ngl 2 -ncmoe 99, extra_bufts=false. S0-repack predicts LIVE."
& $Adb -s $UsbSerial shell "sh $DevDir/w4c.sh" 2>&1 | Tee-Object -FilePath $outLog
Write-Host "adb shell exit=$LASTEXITCODE"

Write-Host "=== try pull mem_poll/pre ==="
try {
    Invoke-S23 @("pull", "$DevDir/logs/w4c.mem_poll", (Join-Path $Root "w4c.mem_poll"))
    Invoke-S23 @("pull", "$DevDir/logs/w4c.pre", (Join-Path $Root "w4c.pre"))
} catch {
    Write-Host "pull failed: $_"
}
Write-Host "W4c host script done. Verdict: LIVE + no MemAvailable cliff => S0-repack confirmed. DIE => extra_bufts is not sufficient, run W4b."
