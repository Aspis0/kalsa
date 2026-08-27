$ErrorActionPreference = 'Stop'

$os = Get-CimInstance Win32_OperatingSystem
$free = [math]::Round($os.FreePhysicalMemory / 1MB, 2)
$gate = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\scratchpad\agents\q66-app-lifecycle-s23\phase2\build-gate.txt'
$procs = Get-Process | Where-Object { $_.Name -match 'gradle|cmake|ninja|clang|g\+\+|make|PPL|llama' } |
    Select-Object Name, Id, CPU, WorkingSet64, PriorityClass
"timestamp=$(Get-Date -Format o)`nFreePhysicalMemory_GB=$free`nRequiredMinimum_GB=8`n" | Set-Content -LiteralPath $gate
$procs | Out-File -FilePath $gate -Append
if ($free -lt 8) {
    Write-Error "RAM gate failed: $free GiB free"
    exit 42
}

$cmake = 'C:\Users\gualt\AppData\Local\Android\Sdk\cmake\3.22.1\bin\cmake.exe'
$build = 'C:\Users\gualt\kals-pin\build-phase2'
$log = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\scratchpad\agents\q66-app-lifecycle-s23\phase2\build.log'
$err = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\scratchpad\agents\q66-app-lifecycle-s23\phase2\build.err'
$env:CMAKE_BUILD_PARALLEL_LEVEL = '2'
$env:NINJAFLAGS = '-j2'
$started = Get-Date
$p = Start-Process -FilePath $cmake `
    -ArgumentList "--build `"$build`" --parallel 2 --config Release --verbose" `
    -WorkingDirectory 'C:\Users\gualt\kals-pin' `
    -RedirectStandardOutput $log -RedirectStandardError $err -PassThru
$p.PriorityClass = [System.Diagnostics.ProcessPriorityClass]::Idle
$p.WaitForExit()
$ended = Get-Date
"started=$($started.ToString('o'))`nended=$($ended.ToString('o'))`nwall_seconds=$(($ended - $started).TotalSeconds)`nexit_code=$($p.ExitCode)`npriority=$($p.PriorityClass)" |
    Set-Content -LiteralPath 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\scratchpad\agents\q66-app-lifecycle-s23\phase2\build-result.txt'
Get-Content 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\scratchpad\agents\q66-app-lifecycle-s23\phase2\build-result.txt'
exit $p.ExitCode
