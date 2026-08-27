$ErrorActionPreference = 'Stop'

$stage = 'C:\Users\gualt\q66c'
$androidDir = Join-Path $stage 'android'
$gradlew = Join-Path $androidDir 'gradlew.bat'
$q = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\scratchpad\agents\q66-app-lifecycle-s23'
$logPath = Join-Path $q 'build-ci-parity.log'
$errPath = Join-Path $q 'build-ci-parity.err'
$snapshotPath = Join-Path $q 'build-ci-parity-snapshot.txt'

$os = Get-CimInstance Win32_OperatingSystem
$freeGiB = ([double]$os.FreePhysicalMemory * 1KB) / 1GB
$before = @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
    $_.ProcessName -in @('llama-perplexity','java','ninja','cmake','gradle')
} | Select-Object Id,ProcessName,PriorityClass,CPU,@{n='RAM_MB';e={[math]::Round($_.WorkingSet64 / 1MB, 1)}})
$snapshot = @(
    "BUILD_STAGE=$stage",
    "RAM_GATE_FREE_GIB=$([math]::Round($freeGiB, 2))",
    'PROCESS_GATE_BEGIN',
    ($before | Out-String).TrimEnd(),
    'PROCESS_GATE_END',
    "APP_SOURCE_HEAD=24deb114f79a2500e72ffffefcda4b0e0b0b8b0c",
    'APP_SOURCE_STATUS=?? docs/competitive-analysis-2026-08.md',
    "BUILD_START=$((Get-Date).ToString('o'))"
) -join [Environment]::NewLine
[IO.File]::WriteAllText($snapshotPath, $snapshot)
Write-Output ("RAM_GATE_FREE_GIB={0:N2}" -f $freeGiB)
Write-Output 'PROCESS_GATE_BEGIN'
$before | Format-Table -AutoSize | Out-String | Write-Output
Write-Output 'PROCESS_GATE_END'
if ($freeGiB -lt 8.0) {
    Write-Output 'RAM_GATE=FAIL_BELOW_8_GIB'
    exit 2
}
Write-Output 'RAM_GATE=PASS'

$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
$env:ANDROID_HOME = 'C:\Users\gualt\AppData\Local\Android\Sdk'
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:CMAKE_BUILD_PARALLEL_LEVEL = '2'
$env:NINJAFLAGS = '-j2'
$env:KALSA_LLAMA_FROM_SOURCE = '1'
$env:NODE_ENV = 'production'

$buildArgs = 'assembleRelease --console=plain --no-daemon -PreactNativeArchitectures=arm64-v8a -Dorg.gradle.workers.max=2'
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = 'cmd.exe'
$psi.Arguments = "/d /c call `"$gradlew`" $buildArgs"
$psi.WorkingDirectory = $androidDir
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true

$proc = New-Object System.Diagnostics.Process
$proc.StartInfo = $psi
$start = Get-Date
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
    $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $artifact).Hash
    Write-Output ("ARTIFACT={0}" -f $artifact)
    Write-Output ("ARTIFACT_BYTES={0}" -f $item.Length)
    Write-Output ("ARTIFACT_SHA256={0}" -f $hash)
} else {
    Write-Output 'ARTIFACT=ABSENT'
}
exit $exitCode
