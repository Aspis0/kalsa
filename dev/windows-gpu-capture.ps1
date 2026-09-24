# One read-only capture, in a single run, of the four Windows GPU facts
# docs/WHAT-IS-MISSING.md section 22 leaves unverified: the two wmic argvs
# and the two PowerShell fallback scripts, copied VERBATIM from the app so
# the bytes captured here are the bytes the app would read:
#   crates/kalsa-probe/src/detect.rs:48      WMIC_CONTROLLERS argv
#   crates/kalsa-probe/src/detect.rs:59      POWERSHELL_CONTROLLERS script
#   crates/kalsa-runtime/src/verdict.rs:57   WMIC_DRIVERS argv
#   crates/kalsa-runtime/src/verdict.rs:66   POWERSHELL_DRIVERS script
# Nothing outside the output folder is written; no admin rights, no network.
# Each step is independent and try/caught on its own; the script exits 0
# whatever the steps reported. Written for Windows PowerShell 5.1 and pwsh 7 alike; it
# ran under 5.1.26100 on a Surface Laptop 3 (Windows 11 26200) on 2026-09-24 with wmic
# absent, so the wmic and timeout paths never executed; pwsh 7 has not run it.
# ASCII throughout: a BOM-less .ps1 is read as ANSI by Windows PowerShell
# 5.1, so one non-ASCII byte in a string would reach the child wrong.

param([string]$OutDir)

# Exception messages run to several lines; a step line must stay one line.
function Get-Reason {
    param($ErrorRecord)
    return ("$($ErrorRecord.Exception.Message)" -replace '[\r\n]+', ' ')
}

# The standard Windows argv quoting, the algorithm Rust's Command runs when
# it joins an argv into one command line: backslash runs double before a
# quote, a trailing backslash doubles before the closing quote, and only an
# argument holding whitespace or a quote gets wrapped at all.
function ConvertTo-WindowsArgument {
    param([string]$Value)
    if ($Value.Length -gt 0 -and $Value -notmatch '[\s"]') { return $Value }
    $out = New-Object System.Text.StringBuilder
    [void]$out.Append('"')
    $pending = 0
    foreach ($ch in $Value.ToCharArray()) {
        if ($ch -eq '\') { $pending++; continue }
        if ($ch -eq '"') {
            [void]$out.Append((-join ('\' * ($pending * 2 + 1))))
            [void]$out.Append('"')
        } else {
            [void]$out.Append((-join ('\' * $pending)))
            [void]$out.Append($ch)
        }
        $pending = 0
    }
    [void]$out.Append((-join ('\' * ($pending * 2))))
    [void]$out.Append('"')
    return $out.ToString()
}

# Spawns one producer the way crates/kalsa-probe/src/run.rs does: stdout
# redirected and read as BYTES (BaseStream, never decoded - decoding here
# would destroy the encoding evidence this capture exists for), stderr
# read through a pipe and discarded - NOT Rust's Stdio::null()'s NUL;
# same 10 s deadline, expiry a best-effort kill (failure swallowed, reap
# wait bounded), never a guaranteed reap. stdout and stderr drain CONCURRENTLY: a
# child that fills the stderr pipe before closing its stdout would stall a
# sequential drain until the deadline. stdin is redirected and closed
# right after the spawn: the shipped app is a GUI process with no console
# stdin, and over SSH an inherited live channel would leave wmic waiting
# on it. Writes <Name>.bin and returns the record SUMMARY prints.
function Invoke-RawCapture {
    param([string]$Name, [string]$Exe, [string[]]$ArgumentList, [string]$OutFolder)
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $Exe
    $startInfo.Arguments = (($ArgumentList | ForEach-Object { ConvertTo-WindowsArgument $_ }) -join ' ')
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.RedirectStandardInput = $true
    $watch = [System.Diagnostics.Stopwatch]::StartNew()
    $process = [System.Diagnostics.Process]::Start($startInfo)
    $process.StandardInput.Close()
    $buffer = New-Object System.IO.MemoryStream
    $stdoutTask = $process.StandardOutput.BaseStream.CopyToAsync($buffer)
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $timedOut = $false
    if (-not $process.WaitForExit(10000)) {
        $timedOut = $true
        # Kill() is the API .NET Framework has; Kill($true) is .NET Core only.
        try { $process.Kill() } catch { }
        [void]$process.WaitForExit(2000)
    }
    # Every wait is bounded, and a drain faulted by the kill must not abort
    # the capture: whatever arrived is kept. Only stdout's outcome is a
    # field - a partial buffer is what SUMMARY would be reading.
    try {
        $stdoutDrain = if ($stdoutTask.Wait(2000)) { 'complete' } else { 'unfinished' }
    } catch {
        $stdoutDrain = "faulted: $(Get-Reason $_)"
    }
    try { [void]$stderrTask.Wait(2000) } catch { }
    $watch.Stop()
    $exitCode = $null
    if ($process.HasExited) { $exitCode = $process.ExitCode }
    $bytes = $buffer.ToArray()
    [System.IO.File]::WriteAllBytes((Join-Path $OutFolder ($Name + '.bin')), $bytes)
    return [pscustomobject]@{
        Name = $Name
        CommandLine = "$Exe $($startInfo.Arguments)"
        ExitCode = $exitCode
        TimedOut = $timedOut
        StdoutDrain = $stdoutDrain
        Bytes = $bytes
        ElapsedMs = $watch.ElapsedMilliseconds
    }
}

function Get-HexHead {
    param([byte[]]$Bytes, [int]$Count = 64)
    $take = [Math]::Min($Count, $Bytes.Length)
    if ($take -le 0) { return '(no bytes)' }
    $out = New-Object System.Text.StringBuilder
    for ($i = 0; $i -lt $take; $i++) {
        if ($i -gt 0) { [void]$out.Append(' ') }
        [void]$out.Append($Bytes[$i].ToString('X2'))
    }
    return $out.ToString()
}

# The section 22 question in one verdict: BOM FF FE, or every second byte 00
# in the first 32 (odd indexes hold the high byte of ASCII text in UTF-16LE).
function Get-Utf16Verdict {
    param([byte[]]$Bytes)
    if ($Bytes.Length -lt 2) { return 'no (fewer than 2 bytes)' }
    if ($Bytes[0] -eq 0xFF -and $Bytes[1] -eq 0xFE) { return 'yes (BOM FF FE)' }
    $limit = [Math]::Min(32, $Bytes.Length)
    $someEvenByte = $false
    for ($i = 0; $i -lt $limit; $i++) {
        if (($i % 2) -eq 1) {
            if ($Bytes[$i] -ne 0) { return 'no (a second byte in the first 32 is not 00)' }
        } elseif ($Bytes[$i] -ne 0) {
            $someEvenByte = $true
        }
    }
    if ($someEvenByte) { return 'yes (every second byte 00 in the first 32)' }
    return 'no (head carries no signal)'
}

# Single-quoted so PowerShell never expands $($_....) before the child sees
# it: the child must receive the script byte-identical to the Rust const.
$WmicControllersArgs = @('path', 'win32_VideoController', 'get', 'name,AdapterRAM')
$WmicDriversArgs = @('path', 'win32_VideoController', 'get', 'DriverVersion')
$FallbackControllersScript = 'Get-CimInstance Win32_VideoController | ForEach-Object { "$($_.AdapterRAM) $($_.Name)" }'
$FallbackDriversScript = 'Get-CimInstance Win32_VideoController | ForEach-Object { $_.DriverVersion }'

if ([string]::IsNullOrEmpty($OutDir)) {
    $OutDir = Join-Path $env:TEMP ('kalsa-gpu-capture-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
}
try {
    New-Item -ItemType Directory -Path $OutDir -Force -ErrorAction Stop | Out-Null
} catch {
    Write-Host "output folder not created: $OutDir - $(Get-Reason $_)"
    exit 0
}

$steps = @()
$captures = @()
$wmicPresence = 'not checked'

try {
    $os = Get-CimInstance Win32_OperatingSystem -OperationTimeoutSec 10 -ErrorAction Stop
    $osLines = @(
        "Caption: $($os.Caption)"
        "Version: $($os.Version)"
        "BuildNumber: $($os.BuildNumber)"
        "OSArchitecture: $($os.OSArchitecture)"
        "PSVersion: $($PSVersionTable.PSVersion)"
        "Is64BitProcess: $([Environment]::Is64BitProcess)"
        "PROCESSOR_ARCHITECTURE: $env:PROCESSOR_ARCHITECTURE"
        "PROCESSOR_ARCHITEW6432: $env:PROCESSOR_ARCHITEW6432"
    )
    Set-Content -Path (Join-Path $OutDir 'os.txt') -Value $osLines -Encoding UTF8 -ErrorAction Stop
    $steps += 'os.txt: ok'
} catch {
    $steps += "os.txt: failed ($(Get-Reason $_))"
}

try {
    $wmicCommand = Get-Command wmic -ErrorAction SilentlyContinue
    if (-not $wmicCommand) {
        $wmicPresence = 'not on PATH (the 24H2/25H2 case section 22 predicts)'
        $steps += 'wmic: skipped (wmic.exe not on PATH)'
    } else {
        $wmicPresence = if ($wmicCommand.Definition) { $wmicCommand.Definition } else { $wmicCommand.Name }
        $failures = @()
        foreach ($capture in @(
            @{ Name = 'wmic-controllers'; Args = $WmicControllersArgs }
            @{ Name = 'wmic-drivers'; Args = $WmicDriversArgs }
        )) {
            try {
                # The literal program name, as Rust's Command::new("wmic")
                # resolves it: same PATH lookup, same binary.
                $captures += Invoke-RawCapture -Name $capture.Name -Exe 'wmic' `
                    -ArgumentList $capture.Args -OutFolder $OutDir
            } catch {
                $failures += "$($capture.Name): $(Get-Reason $_)"
            }
        }
        if ($failures.Count -gt 0) {
            $steps += "wmic: failed ($($failures -join '; '))"
        } else {
            $steps += 'wmic: ok'
        }
    }
} catch {
    $steps += "wmic: failed ($(Get-Reason $_))"
}

# The child is the literal program name powershell - even from pwsh 7 - so
# the spawn takes the same binary path the app's command_text takes.
try {
    $failures = @()
    foreach ($capture in @(
        @{ Name = 'powershell-controllers'; Script = $FallbackControllersScript }
        @{ Name = 'powershell-drivers'; Script = $FallbackDriversScript }
    )) {
        try {
            $captures += Invoke-RawCapture -Name $capture.Name -Exe 'powershell' `
                -ArgumentList @('-NoProfile', '-NonInteractive', '-Command', $capture.Script) `
                -OutFolder $OutDir
        } catch {
            $failures += "$($capture.Name): $(Get-Reason $_)"
        }
    }
    if ($failures.Count -gt 0) {
        $steps += "powershell fallback: failed ($($failures -join '; '))"
    } else {
        $steps += 'powershell fallback: ok'
    }
} catch {
    $steps += "powershell fallback: failed ($(Get-Reason $_))"
}

try {
    Get-CimInstance Win32_VideoController -OperationTimeoutSec 10 -ErrorAction Stop |
        Select-Object Name, AdapterRAM, DriverVersion, VideoProcessor, PNPDeviceID |
        Format-List |
        Out-File -FilePath (Join-Path $OutDir 'cim.txt') -Encoding UTF8 -ErrorAction Stop
    $steps += 'cim.txt: ok'
} catch {
    $steps += "cim.txt: failed ($(Get-Reason $_))"
}

# The registry's own figures: HardwareInformation.qwMemorySize is the only
# source here that can size a card above AdapterRAM's 32-bit field (the
# value section 22 says was never verified).
$classKey = 'HKLM:\SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}'
try {
    $report = @()
    # Properties under this key is SYSTEM-only: a denied subkey must not
    # abort the enumeration; each numeric subkey is read in its own try.
    $subkeys = Get-ChildItem -LiteralPath $classKey -ErrorAction SilentlyContinue -ErrorVariable enumErrors |
        Where-Object { $_.PSChildName -match '^\d{4}$' } |
        Sort-Object -Property PSChildName
    foreach ($enumError in $enumErrors) { $report += "enumeration error: $(Get-Reason $enumError)" }
    foreach ($subkey in $subkeys) {
        try {
            $props = Get-ItemProperty -LiteralPath $subkey.PSPath -ErrorAction Stop
            $report += "[$($subkey.PSChildName)]"
            $report += "  DriverDesc: $($props.DriverDesc)"
            $report += "  DriverVersion: $($props.DriverVersion)"
            $qw = $props.PSObject.Properties['HardwareInformation.qwMemorySize']
            if ($qw) {
                # REG_BINARY can arrive here as byte[]: hex first, and the
                # decimal the summary needs when it is exactly 8 bytes.
                $qwRaw = $qw.Value
                if ($qwRaw -is [byte[]]) {
                    $qwText = '0x' + [System.BitConverter]::ToString($qwRaw)
                    if ($qwRaw.Length -eq 8) {
                        $qwText += ' (' + [System.BitConverter]::ToUInt64($qwRaw, 0) + ' decimal)'
                    }
                    $report += "  HardwareInformation.qwMemorySize: $qwText"
                } else {
                    try {
                        $report += "  HardwareInformation.qwMemorySize: $([System.Convert]::ToUInt64($qwRaw))"
                    } catch {
                        $report += "  HardwareInformation.qwMemorySize: unreadable value ($qwRaw)"
                    }
                }
            } else {
                $report += '  HardwareInformation.qwMemorySize: (absent)'
            }
            $mem = $props.PSObject.Properties['HardwareInformation.MemorySize']
            if ($mem) {
                # REG_BINARY: interpolating a byte[] would print System.Byte[].
                $memValue = $mem.Value
                if ($memValue -is [byte[]]) { $memValue = '0x' + [System.BitConverter]::ToString($memValue) }
                $report += "  HardwareInformation.MemorySize: $memValue"
            }
            $report += ''
        } catch {
            $report += "[$($subkey.PSChildName)] cannot read: $(Get-Reason $_)"
            $report += ''
        }
    }
    if ($report.Count -eq 0) { $report += '(no 0000-style subkeys found)' }
    Set-Content -Path (Join-Path $OutDir 'registry.txt') -Value $report -Encoding UTF8 -ErrorAction Stop
    $enumNote = if ($enumErrors.Count -gt 0) { " ($($enumErrors.Count) enumeration errors)" } else { '' }
    $steps += "registry.txt: ok$enumNote"
} catch {
    $steps += "registry.txt: failed ($(Get-Reason $_))"
}

$summaryLines = @()
$summaryLines += 'kalsa GPU capture - ' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
$summaryLines += 'wmic.exe: ' + $wmicPresence
$summaryLines += 'elapsed ms is spawn-to-drained-output of each command, spawn-to-stopped-waiting when it timed out: the fallback latency on real hardware'
foreach ($capture in $captures) {
    $summaryLines += ''
    $summaryLines += $capture.Name
    $summaryLines += '  command: ' + $capture.CommandLine
    $exitText = if ($null -eq $capture.ExitCode) {
        'unavailable (still running when the capture stopped waiting)'
    } else {
        "$($capture.ExitCode)"
    }
    $summaryLines += '  exit code: ' + $exitText
    $summaryLines += '  timed out: ' + $(if ($capture.TimedOut) { 'yes' } else { 'no' })
    $summaryLines += '  stdout drain: ' + $capture.StdoutDrain
    $summaryLines += '  stdout bytes: ' + $capture.Bytes.Length
    $summaryLines += '  elapsed ms: ' + $capture.ElapsedMs
    $summaryLines += '  first 64 bytes (hex): ' + (Get-HexHead -Bytes $capture.Bytes)
    $summaryLines += '  looks like UTF-16LE: ' + (Get-Utf16Verdict -Bytes $capture.Bytes)
}
$summaryLines += ''
$summaryLines += 'steps:'
foreach ($step in $steps) { $summaryLines += '  ' + $step }
# The facts themselves under their headers: SUMMARY.txt is not the whole
# run - its hex heads stop at 64 bytes and the .bin files hold the full
# output. One missing file is one line, never an abort.
foreach ($fact in @('os.txt', 'cim.txt', 'registry.txt')) {
    $summaryLines += ''
    $summaryLines += '--- ' + $fact + ' ---'
    try {
        $summaryLines += @(Get-Content -Path (Join-Path $OutDir $fact) -ErrorAction Stop)
    } catch {
        $summaryLines += "(not available: $(Get-Reason $_))"
    }
}
$summaryLines += 'output folder: ' + $OutDir

try {
    Set-Content -Path (Join-Path $OutDir 'SUMMARY.txt') -Value $summaryLines -Encoding UTF8 -ErrorAction Stop
} catch {
    Write-Host "SUMMARY.txt could not be written: $(Get-Reason $_)"
}
Write-Host ($summaryLines -join "`r`n")
exit 0
