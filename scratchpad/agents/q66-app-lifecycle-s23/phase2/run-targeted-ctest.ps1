$ErrorActionPreference = 'Stop'
$ctest = 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\ctest.exe'
$build = 'C:\Users\gualt\kals-pin\build-phase2-native-q63c'
$phase2 = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\scratchpad\agents\q66-app-lifecycle-s23\phase2'
$stdout = Join-Path $phase2 'ctest-targeted.log'
$stderr = Join-Path $phase2 'ctest-targeted.err'
$args = @('--test-dir', $build, '-R', '^(test-sampling|test-reasoning-budget|test-chat.*|test-arg-parser)$', '--output-on-failure')
$started = Get-Date
$p = Start-Process -FilePath $ctest -ArgumentList $args -WorkingDirectory $build -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru -Wait
$ended = Get-Date
Set-Content -LiteralPath (Join-Path $phase2 'ctest-targeted-result.txt') -Value @(
    "started=$($started.ToString('o'))"
    "ended=$($ended.ToString('o'))"
    "wall_seconds=$((($ended - $started).TotalSeconds))"
    "exit_code=$($p.ExitCode)"
    "regex=^(test-sampling|test-reasoning-budget|test-chat.*|test-arg-parser)$"
)
exit $p.ExitCode
