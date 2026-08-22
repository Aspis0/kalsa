# S0.3-bis Road 2 launcher: load MSVC env then run build_vulkan_ndk.bat
$ErrorActionPreference = 'Stop'
$root = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\gpu_xiaomi'
$vcvars = 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat'
$bat = Join-Path $root 'build_vulkan_ndk.bat'
$stdout = Join-Path $root 'build_vulkan_ndk.stdout.txt'
$stderr = Join-Path $root 'build_vulkan_ndk.stderr.txt'

if (-not (Test-Path $vcvars)) { throw "vcvars missing: $vcvars" }
if (-not (Test-Path $bat)) { throw "bat missing: $bat" }

$env:JOBS = if ($env:JOBS) { $env:JOBS } else { '4' }

# Import vcvars into this process via a temporary cmd wrapper
$tmp = Join-Path $env:TEMP ("vcvars_export_{0}.cmd" -f [guid]::NewGuid().ToString('N'))
@"
@echo off
call "$vcvars"
if errorlevel 1 exit /b 1
set
"@ | Set-Content -Path $tmp -Encoding ASCII

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = 'cmd.exe'
$psi.Arguments = "/c `"$tmp`""
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true
$p = [System.Diagnostics.Process]::Start($psi)
$out = $p.StandardOutput.ReadToEnd()
$err = $p.StandardError.ReadToEnd()
$p.WaitForExit()
Remove-Item -Force $tmp -ErrorAction SilentlyContinue
if ($p.ExitCode -ne 0) { throw "vcvars failed: $err" }

foreach ($line in ($out -split "`r?`n")) {
  if ($line -match '^(.*?)=(.*)$') {
    $name = $Matches[1]
    $val = $Matches[2]
    # Skip junk / drive-letter pseudo vars that confuse .NET
    if ($name -match '^[A-Za-z_][A-Za-z0-9_]*$') {
      [System.Environment]::SetEnvironmentVariable($name, $val, 'Process')
    }
  }
}

Write-Output "cl=$(Get-Command cl -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source)"
Write-Output "JOBS=$env:JOBS"
Write-Output "START=$(Get-Date -Format o)"

$p2 = Start-Process -FilePath 'cmd.exe' `
  -ArgumentList '/c', "`"$bat`"" `
  -WorkingDirectory $root `
  -Wait -PassThru -NoNewWindow `
  -RedirectStandardOutput $stdout `
  -RedirectStandardError $stderr

Write-Output "BAT_EXIT=$($p2.ExitCode)"
Write-Output "END=$(Get-Date -Format o)"
exit $p2.ExitCode
