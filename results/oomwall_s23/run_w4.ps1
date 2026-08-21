# W4 host launcher — STOCK llama-bench (extra_bufts=true), Mellum2 -ngl 0.
# Crash-risk. USB only. Do NOT run without the owner at the power button.
# Does not push binaries. Verifies the device still holds the W1/W2 pins.
$ErrorActionPreference = "Stop"
$UsbSerial = "R3CW406P8CV"
$Jelly = "192.168.1.82"
$DevDir = "/data/local/tmp/s3oracle"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path

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

# Pins: stock extra_bufts=true (c8f4fc05e). See staging/SHA256.txt.
$PinOpencl = "2ed2e48a98e50f324c2aaed0c8fa7ed5b1c0fb09bff8f9a153f79420a7d69a87"
$PinImpl   = "bad179520546f8d5316cd98124e948d025e8acb2999bf92b94977879ce72c171"
$PinLlama  = "f8b11fc34be81291c01cc77a657d267eaf7f102ed6cb6ef708bbaab7730a667d"
$PinBench  = "b2ae0fa6c413a5049a87b0706f2687cd7035ae5e43985fe40779dc0a7d225b2c"

function Invoke-S23([string[]]$A) {
    & $Adb -s $UsbSerial @A
    if ($LASTEXITCODE -ne 0) { throw "adb failed: $A (exit $LASTEXITCODE)" }
}
function AdbOut([string]$ShellCmd) {
    $o = & $Adb -s $UsbSerial shell $ShellCmd
    if ($LASTEXITCODE -ne 0) { throw "adb shell failed: $ShellCmd (exit $LASTEXITCODE)" }
    return ($o | Out-String).Trim()
}

Write-Host "W4 USB serial=$UsbSerial adb=$Adb"
$devs = & $Adb devices
Write-Host $devs
if ($devs -match [regex]::Escape($Jelly)) {
    Write-Host "NOTE: Jelly is visible — this script will not use it."
}
if (-not ($devs | Select-String -Pattern "^$UsbSerial\s+device")) {
    throw "USB serial $UsbSerial not in 'adb devices' as device. Plug the S23. Do not use wireless/Jelly."
}

Write-Host "=== pre-check ==="
$batt = AdbOut "dumpsys battery"
$batt | Select-String -Pattern "USB powered|AC powered|^  status:|^  level:|^  temperature:" | ForEach-Object { Write-Host $_ }
$wake = AdbOut "dumpsys power" | Select-String -Pattern "mWakefulness=" | Select-Object -First 1
Write-Host $wake
Write-Host (AdbOut "grep MemAvailable /proc/meminfo")
Write-Host ("uptime " + (AdbOut "uptime"))

Write-Host "=== sha-verify device (STOCK pins; refuse mismatch) ==="
function CheckSha([string]$Rel, [string]$Expect) {
    $line = AdbOut "sha256sum $DevDir/$Rel"
    Write-Host $line
    $got = (($line -split "\s+")[0]).ToLower()
    if ($got -ne $Expect) {
        throw "SHA mismatch $Rel got=$got expect=$Expect — abort. W4 needs the W1/W2 stock binaries."
    }
}
CheckSha "libggml-opencl.so" $PinOpencl
CheckSha "libllama-bench-impl.so" $PinImpl
CheckSha "libllama.so" $PinLlama
CheckSha "llama-bench" $PinBench

Write-Host "=== push w4.sh (script only, no binaries) ==="
Invoke-S23 @("push", (Join-Path $Root "w4.sh"), "$DevDir/w4.sh")
AdbOut "chmod 755 $DevDir/w4.sh" | Out-Null

$outLog = Join-Path $Root "w4.adb.log"
Write-Host "=== RUN W4 — streaming to $outLog ==="
Write-Host "OWNER AT POWER BUTTON. Mellum2 -ngl 0, extra_bufts=true. Expected: POWER OFF under S0-repack."
& $Adb -s $UsbSerial shell "sh $DevDir/w4.sh" 2>&1 | Tee-Object -FilePath $outLog
Write-Host "adb shell exit=$LASTEXITCODE (power-off may look like a disconnect)"

Write-Host "=== try pull mem_poll/pre if the phone came back ==="
try {
    Invoke-S23 @("pull", "$DevDir/logs/w4.mem_poll", (Join-Path $Root "w4.mem_poll"))
    Invoke-S23 @("pull", "$DevDir/logs/w4.pre", (Join-Path $Root "w4.pre"))
} catch {
    Write-Host "pull failed (likely still down): $_"
}
Write-Host "W4 host script done. If it powered off: owner powers on, then run_w4c.ps1"
