$ErrorActionPreference = 'Stop'

$phase2 = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\scratchpad\agents\q66-app-lifecycle-s23\phase2'
$cmake = 'C:\Users\gualt\AppData\Local\Android\Sdk\cmake\3.22.1\bin\cmake.exe'
$build = 'C:\Users\gualt\kals-pin\build-phase2'
$log = Join-Path $phase2 'build-detached.log'
$err = Join-Path $phase2 'build-detached.err'
$result = Join-Path $phase2 'build-detached-result.txt'

$env:CMAKE_BUILD_PARALLEL_LEVEL = '2'
$env:NINJAFLAGS = '-j2'
$started = Get-Date
$p = Start-Process -FilePath $cmake `
    -ArgumentList "--build `"$build`" --parallel 2 --config Release --verbose" `
    -WorkingDirectory 'C:\Users\gualt\kals-pin' `
    -RedirectStandardOutput $log -RedirectStandardError $err -PassThru
$p.PriorityClass = [System.Diagnostics.ProcessPriorityClass]::Idle
Set-Content -LiteralPath (Join-Path $phase2 'build-detached-worker.txt') -Value "pid=$($p.Id)`npriority=$($p.PriorityClass)`nstarted=$($started.ToString('o'))"
$p.WaitForExit()
$ended = Get-Date
"started=$($started.ToString('o'))`nended=$($ended.ToString('o'))`nwall_seconds=$(($ended - $started).TotalSeconds)`nexit_code=$($p.ExitCode)`npriority=$($p.PriorityClass)" |
    Set-Content -LiteralPath $result
