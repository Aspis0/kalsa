# Shared helpers for W5. Dot-source from the other scripts. Do not run this file.
$ErrorActionPreference = "Stop"
$UsbSerial = "R3CW406P8CV"
$TlsSerial = "adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp"
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

function Resolve-S23Serial {
    $devs = (& $Adb devices | Out-String)
    if ($devs -match '(?m)^R3CW406P8CV\s+device') { return "R3CW406P8CV" }
    if ($devs -match [regex]::Escape($TlsSerial)) { return $TlsSerial }
    throw "S23 not in 'adb devices' (tried USB R3CW406P8CV and TLS). Jelly is forbidden."
}
$Serial = Resolve-S23Serial
Write-Host "S23 serial=$Serial"

function Invoke-S23([string[]]$A) {
    & $Adb -s $Serial @A
    if ($LASTEXITCODE -ne 0) { throw "adb failed: $A (exit $LASTEXITCODE)" }
}
function AdbOut([string]$ShellCmd) {
    $o = & $Adb -s $Serial shell $ShellCmd
    if ($LASTEXITCODE -ne 0) { throw "adb shell failed: $ShellCmd (exit $LASTEXITCODE)" }
    return ($o | Out-String).Trim()
}
function Assert-UsbS23 {
    $devs = & $Adb devices
    if ($devs -match [regex]::Escape($Jelly)) {
        Write-Host "NOTE: Jelly is visible — this script will not use it."
    }
    $script:Serial = Resolve-S23Serial
    Write-Host "S23 serial=$script:Serial"
}
function Assert-Unplugged {
    # Header lines only. The dumpsys event log still contains historical usb:true.
    $hdr = AdbOut "dumpsys battery | grep -E '^  (USB|AC) powered:'"
    Write-Host "UNPLUG_GATE: $hdr"
    if ($hdr -notmatch "USB powered:\s*false" -or $hdr -notmatch "AC powered:\s*false") {
        throw "Device is plugged (USB/AC). W5 is a thermal cell — wait for the owner to unplug, then re-run."
    }
    Write-Host "UNPLUG_GATE: PASS (USB=false AC=false)"
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
    $hdr = AdbOut "dumpsys battery | grep -E '^  (level|temperature):'"
    $lvl = ([regex]::Match($hdr, "level:\s*(\d+)")).Groups[1].Value
    $tempRaw = ([regex]::Match($hdr, "temperature:\s*(\d+)")).Groups[1].Value
    $tempC = if ($tempRaw) { [math]::Round([int]$tempRaw / 10.0, 1) } else { "" }
    $wake = AdbOut "dumpsys power | grep mWakefulness="
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
