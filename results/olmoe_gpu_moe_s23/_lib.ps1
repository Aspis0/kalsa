# Shared helpers for W5. Dot-source from the other scripts. Do not run this file.
$ErrorActionPreference = "Stop"
$UsbSerial = "R3CW406P8CV"
$Jelly = "192.168.1.82"
$DevDir = "/data/local/tmp/s3oracle"
$PinImplNoex = "d2030f23db3b4f62f6934c9de831050e71e87c7cfda6e5059d53099ec8b60346"
$PinImplStock = "bad179520546f8d5316cd98124e948d025e8acb2999bf92b94977879ce72c171"
$PinOpencl = "2ed2e48a98e50f324c2aaed0c8fa7ed5b1c0fb09bff8f9a153f79420a7d69a87"
$PinOlmoe = "3bd9ec48045f526508956ef663c5c11dbb3ef791a06f4e10a6be88379c40e1fe"
$OlmoeName = "OLMoE-1B-7B-0924-Instruct-Q4_K_M.gguf"

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

function Invoke-S23([string[]]$A) {
    & $Adb -s $UsbSerial @A
    if ($LASTEXITCODE -ne 0) { throw "adb failed: $A (exit $LASTEXITCODE)" }
}
function AdbOut([string]$ShellCmd) {
    $o = & $Adb -s $UsbSerial shell $ShellCmd
    if ($LASTEXITCODE -ne 0) { throw "adb shell failed: $ShellCmd (exit $LASTEXITCODE)" }
    return ($o | Out-String).Trim()
}
function Assert-UsbS23 {
    $devs = & $Adb devices
    if ($devs -match [regex]::Escape($Jelly)) {
        Write-Host "NOTE: Jelly is visible — this script will not use it."
    }
    if (-not ($devs | Select-String -Pattern "^$UsbSerial\s+device")) {
        throw "USB serial $UsbSerial not in 'adb devices'. Plug the S23. Do not use Jelly."
    }
}
function Assert-Unplugged {
    $batt = AdbOut "dumpsys battery"
    $usb = ($batt | Select-String -Pattern "USB powered:\s*(true|false)" | Select-Object -First 1).ToString()
    $ac  = ($batt | Select-String -Pattern "AC powered:\s*(true|false)" | Select-Object -First 1).ToString()
    Write-Host "batt: $usb / $ac"
    if ($usb -match "true" -or $ac -match "true") {
        throw "Device is plugged (USB/AC). W5 is a thermal cell — wait for the owner to unplug, then re-run."
    }
}
function CheckSha([string]$Rel, [string]$Expect) {
    $line = AdbOut "sha256sum $DevDir/$Rel"
    Write-Host $line
    $got = (($line -split "\s+")[0]).ToLower()
    if ($got -ne $Expect.ToLower()) {
        throw "SHA mismatch $Rel got=$got expect=$Expect"
    }
}
function Assert-NoextraImpl {
    CheckSha "libllama-bench-impl.so" $PinImplNoex
    $line = AdbOut "sha256sum $DevDir/libllama-bench-impl.so"
    if ($line -match $PinImplStock) {
        throw "stock extra_bufts impl is on device — refuse. W5 must use noextra $PinImplNoex"
    }
    CheckSha "libggml-opencl.so" $PinOpencl
}
function Get-Sensors {
    $batt = AdbOut "dumpsys battery"
    $lvl = ([regex]::Match($batt, "(?m)^\s*level:\s*(\d+)")).Groups[1].Value
    $tempRaw = ([regex]::Match($batt, "(?m)^\s*temperature:\s*(\d+)")).Groups[1].Value
    $tempC = if ($tempRaw) { [math]::Round([int]$tempRaw / 10.0, 1) } else { "" }
    $wake = (AdbOut "dumpsys power" | Select-String -Pattern "mWakefulness=" | Select-Object -First 1)
    $memA = ([regex]::Match((AdbOut "grep MemAvailable /proc/meminfo"), "(\d+)")).Groups[1].Value
    $memF = ([regex]::Match((AdbOut "grep MemFree /proc/meminfo"), "(\d+)")).Groups[1].Value
    return [pscustomobject]@{
        level = $lvl
        temp_c = $tempC
        wake = "$wake"
        mem_available_kb = $memA
        mem_free_kb = $memF
        iso = (Get-Date).ToString("o")
    }
}
function Write-Sensors([string]$Label) {
    $s = Get-Sensors
    Write-Host ("{0} level={1} temp_c={2} wake={3} MemAvailable={4}kB MemFree={5}kB" -f $Label, $s.level, $s.temp_c, $s.wake, $s.mem_available_kb, $s.mem_free_kb)
    return $s
}
