$ErrorActionPreference = 'Stop'
$o = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\scratchpad\agents\q66-app-lifecycle-s23\phase2\ps-cmake-version.log'
$e = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\scratchpad\agents\q66-app-lifecycle-s23\phase2\ps-cmake-version.err'
$p = Start-Process -FilePath 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe' -ArgumentList @('--version') -RedirectStandardOutput $o -RedirectStandardError $e -Wait -PassThru
Write-Output "PS_CMAKE_EXIT=$($p.ExitCode)"
exit $p.ExitCode
