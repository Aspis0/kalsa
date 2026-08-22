# Build phase only — configure already succeeded for pin 5236140e5 Vulkan NDK.
$ErrorActionPreference = 'Stop'
$root = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\gpu_xiaomi'
$build = Join-Path $root 'build\build-vulkan-ndk'
$log = Join-Path $root 'build_vulkan_ndk.log'
$cmake = 'C:\Users\gualt\AppData\Local\Android\Sdk\cmake\3.22.1\bin\cmake.exe'
$vcvars = 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat'
$jobs = if ($env:JOBS) { $env:JOBS } else { '4' }

# Import vcvars env
$tmp = Join-Path $env:TEMP ("vcvars_export_{0}.cmd" -f [guid]::NewGuid().ToString('N'))
@(
  '@echo off'
  "call `"$vcvars`""
  'if errorlevel 1 exit /b 1'
  'set'
) | Set-Content -Path $tmp -Encoding ASCII

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = 'cmd.exe'
$psi.Arguments = "/c `"$tmp`""
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true
$p = [System.Diagnostics.Process]::Start($psi)
$out = $p.StandardOutput.ReadToEnd()
$null = $p.StandardError.ReadToEnd()
$p.WaitForExit()
Remove-Item -Force $tmp -ErrorAction SilentlyContinue
if ($p.ExitCode -ne 0) { throw "vcvars failed" }

foreach ($line in ($out -split "`r?`n")) {
  if ($line -match '^(.*?)=(.*)$') {
    $name = $Matches[1]
    $val = $Matches[2]
    if ($name -match '^[A-Za-z_][A-Za-z0-9_]*$') {
      [System.Environment]::SetEnvironmentVariable($name, $val, 'Process')
    }
  }
}

Write-Output "cl=$((Get-Command cl).Source)"
Write-Output "jobs=$jobs"
Write-Output "START=$(Get-Date -Format o)"
Add-Content -Path $log -Value "--- cmake build llama-bench only jobs=$jobs ---"

$stdout = Join-Path $root 'build_phase.stdout.txt'
$stderr = Join-Path $root 'build_phase.stderr.txt'
$p2 = Start-Process -FilePath $cmake `
  -ArgumentList @('--build', $build, '-j', $jobs, '--target', 'llama-bench') `
  -NoNewWindow -Wait -PassThru `
  -RedirectStandardOutput $stdout `
  -RedirectStandardError $stderr

if (Test-Path $stdout) { Get-Content $stdout | Add-Content $log }
if (Test-Path $stderr) { Get-Content $stderr | Add-Content $log }
Add-Content -Path $log -Value "CMAKE_BUILD_EXIT=$($p2.ExitCode)"

$bin = Join-Path $build 'bin\llama-bench'
if (Test-Path $bin) {
  Add-Content -Path $log -Value 'BINARY_PRESENT=1'
  $outdir = Join-Path $root 'bin'
  New-Item -ItemType Directory -Force -Path $outdir | Out-Null
  Copy-Item -Force $bin (Join-Path $outdir 'llama-bench')
  # Also copy any companion .so if produced (static build expected)
  Get-ChildItem (Join-Path $build 'bin') -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Output "OUT=$($_.FullName) size=$($_.Length)"
  }
  Write-Output "BINARY_OK path=$bin size=$((Get-Item $bin).Length)"
} else {
  Add-Content -Path $log -Value 'BINARY_PRESENT=0'
  Write-Output 'BINARY_MISSING'
}

Write-Output "BUILD_EXIT=$($p2.ExitCode)"
Write-Output "END=$(Get-Date -Format o)"
exit $p2.ExitCode
