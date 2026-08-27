$ErrorActionPreference = 'Stop'
$q = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\scratchpad\agents\q66-app-lifecycle-s23'
$stage = Join-Path $q 'app-build'
$gradlew = Join-Path $stage 'android\gradlew.bat'
$log = Join-Path $q 'build-fix.log'
$err = Join-Path $q 'build-fix.err'
$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
$env:ANDROID_HOME = 'C:\Users\gualt\AppData\Local\Android\Sdk'
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:CMAKE_BUILD_PARALLEL_LEVEL = '2'
$env:NINJAFLAGS = '-j2'
$env:KALSA_LLAMA_FROM_SOURCE = '1'
$env:NODE_ENV = 'production'

$os = Get-CimInstance Win32_OperatingSystem
$free = [math]::Round($os.FreePhysicalMemory / 1MB, 2)
Write-Output ("free_gb=" + $free)
if ($free -lt 8) {
    Write-Output 'RAM_GATE=FAIL'
    exit 2
}
Write-Output 'RAM_GATE=PASS'

Write-Output '--- app snapshot at real build start ---'
git -C 'C:\Users\gualt\Desktop\Kalsa\ai-chat' rev-parse HEAD
git -C 'C:\Users\gualt\Desktop\Kalsa\ai-chat' status --short

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = 'cmd.exe'
$psi.Arguments = "/d /c call `"$gradlew`" assembleRelease --console=plain --no-daemon -PreactNativeArchitectures=arm64-v8a -PrnllamaBuildFromSource=true -Dorg.gradle.workers.max=2"
$psi.WorkingDirectory = Join-Path $stage 'android'
$psi.UseShellExecute = $false
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$proc = New-Object System.Diagnostics.Process
$proc.StartInfo = $psi
$start = Get-Date
[void] $proc.Start()
$proc.PriorityClass = 'Idle'
Write-Output ("build_cmd_pid=" + $proc.Id + " priority=" + $proc.PriorityClass)
$outTask = $proc.StandardOutput.ReadToEndAsync()
$errTask = $proc.StandardError.ReadToEndAsync()
$proc.WaitForExit()
$out = $outTask.Result
$stderr = $errTask.Result
[System.IO.File]::WriteAllText($log, $out)
[System.IO.File]::WriteAllText($err, $stderr)
$end = Get-Date
Write-Output ("build_exit=" + $proc.ExitCode)
Write-Output ("build_started=" + $start.ToString('o'))
Write-Output ("build_finished=" + $end.ToString('o'))
Write-Output ("wall_seconds=" + [math]::Round(($end - $start).TotalSeconds, 1))
Write-Output ("stdout_bytes=" + [Text.Encoding]::UTF8.GetByteCount($out))
Write-Output ("stderr_bytes=" + [Text.Encoding]::UTF8.GetByteCount($stderr))
& $gradlew --stop 2>&1
Write-Output ("stop_exit=" + $LASTEXITCODE)
Write-Output ("artifact_exists=" + (Test-Path (Join-Path $stage 'android\app\build\outputs\apk\release\app-release.apk')))
exit $proc.ExitCode
