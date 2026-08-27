$ErrorActionPreference = 'Stop'

$stage = 'C:\kq66'
$androidDir = Join-Path $stage 'android'
$gradlew = Join-Path $androidDir 'gradlew.bat'
$logPath = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\scratchpad\agents\q66-app-lifecycle-s23\build-short.log'
$errPath = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\scratchpad\agents\q66-app-lifecycle-s23\build-short.err'
$snapshotPath = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\scratchpad\agents\q66-app-lifecycle-s23\build-short-snapshot.txt'

$os = Get-CimInstance Win32_OperatingSystem
$freeGiB = ([double]$os.FreePhysicalMemory * 1KB) / 1GB
Write-Output ("RAM_GATE_FREE_GIB={0:N2}" -f $freeGiB)
if ($freeGiB -lt 8.0) {
    Write-Output 'RAM_GATE=FAIL_BELOW_8_GIB'
    exit 2
}
Write-Output 'RAM_GATE=PASS'

$appRepo = 'C:\Users\gualt\Desktop\Kalsa\ai-chat'
$head = ((& git -C $appRepo rev-parse HEAD 2>&1) | Out-String).Trim()
$status = ((& git -C $appRepo status --short 2>&1) | Out-String).Trim()
$snapshot = @(
    "BUILD_START=$((Get-Date).ToString('o'))",
    "APP_HEAD=$head",
    'APP_STATUS_BEGIN',
    $status,
    'APP_STATUS_END'
) -join [Environment]::NewLine
[IO.File]::WriteAllText($snapshotPath, $snapshot)
Write-Output ('APP_HEAD=' + $head)
Write-Output 'APP_STATUS_BEGIN'
Write-Output $status
Write-Output 'APP_STATUS_END'

$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
$env:ANDROID_HOME = 'C:\Users\gualt\AppData\Local\Android\Sdk'
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:CMAKE_BUILD_PARALLEL_LEVEL = '2'
$env:NINJAFLAGS = '-j2'
$env:KALSA_LLAMA_FROM_SOURCE = '1'
$env:NODE_ENV = 'production'

$buildArgs = 'assembleRelease --console=plain --no-daemon -PreactNativeArchitectures=arm64-v8a -PrnllamaBuildFromSource=true -Dorg.gradle.workers.max=2'
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = 'cmd.exe'
$psi.Arguments = "/d /c call `"$gradlew`" $buildArgs"
$psi.WorkingDirectory = $androidDir
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true

$start = Get-Date
$proc = New-Object System.Diagnostics.Process
$proc.StartInfo = $psi
[void]$proc.Start()
$launcherPid = $proc.Id
$priority = 'UNSET'
try {
    $proc.PriorityClass = [System.Diagnostics.ProcessPriorityClass]::Idle
    $priority = $proc.PriorityClass.ToString()
} catch {
    $priority = 'SET_FAILED: ' + $_.Exception.Message
}
Write-Output ("BUILD_PID={0} PRIORITY={1}" -f $launcherPid, $priority)
$stdoutTask = $proc.StandardOutput.ReadToEndAsync()
$stderrTask = $proc.StandardError.ReadToEndAsync()
$proc.WaitForExit()
$stdout = $stdoutTask.Result
$stderr = $stderrTask.Result
$exitCode = $proc.ExitCode
$end = Get-Date
[IO.File]::WriteAllText($logPath, $stdout)
[IO.File]::WriteAllText($errPath, $stderr)
Write-Output ("BUILD_START={0}" -f $start.ToString('o'))
Write-Output ("BUILD_END={0}" -f $end.ToString('o'))
Write-Output ("BUILD_WALL_SECONDS={0:N1}" -f ($end - $start).TotalSeconds)
Write-Output ("BUILD_EXIT={0}" -f $exitCode)
Write-Output ("BUILD_LOG={0}" -f $logPath)
Write-Output ("BUILD_ERR={0}" -f $errPath)

$stopOutput = & $gradlew --stop 2>&1
$stopCode = $LASTEXITCODE
Write-Output 'GRADLE_STOP_BEGIN'
Write-Output ($stopOutput | Out-String)
Write-Output ("GRADLE_STOP_EXIT={0}" -f $stopCode)

$artifact = Join-Path $stage 'android\app\build\outputs\apk\release\app-release.apk'
if (Test-Path -LiteralPath $artifact -PathType Leaf) {
    $item = Get-Item -LiteralPath $artifact
    Write-Output ("ARTIFACT={0}" -f $artifact)
    Write-Output ("ARTIFACT_BYTES={0}" -f $item.Length)
} else {
    Write-Output 'ARTIFACT=ABSENT'
}
exit $exitCode
