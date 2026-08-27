$ErrorActionPreference = 'Stop'
$stage = 'C:\q66p3'
$phase = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\scratchpad\agents\q66-app-lifecycle-s23\phase3'
$android = Join-Path $stage 'android'
$gradlew = Join-Path $android 'gradlew.bat'
$outPath = Join-Path $phase 'gradle-assemble-release.log'
$errPath = Join-Path $phase 'gradle-assemble-release.err'

$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
$env:ANDROID_HOME = 'C:\Users\gualt\AppData\Local\Android\Sdk'
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:CMAKE_BUILD_PARALLEL_LEVEL = '2'
$env:NINJAFLAGS = '-j2'
$env:KALSA_LLAMA_FROM_SOURCE = '1'
$env:NODE_ENV = 'production'

try { (Get-Process -Id $PID).PriorityClass = [System.Diagnostics.ProcessPriorityClass]::Idle } catch {}

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = 'cmd.exe'
$psi.Arguments = "/d /c call `"$gradlew`" assembleRelease --console=plain --no-daemon -PreactNativeArchitectures=arm64-v8a -PrnllamaBuildFromSource=true -Dorg.gradle.workers.max=2"
$psi.WorkingDirectory = $android
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$proc = New-Object System.Diagnostics.Process
$proc.StartInfo = $psi
$start = Get-Date
[void]$proc.Start()
$gradlePid = $proc.Id
$priority = 'UNSET'
try { $proc.PriorityClass = [System.Diagnostics.ProcessPriorityClass]::Idle; $priority = $proc.PriorityClass.ToString() } catch { $priority = 'SET_FAILED: ' + $_.Exception.Message }
$stdoutTask = $proc.StandardOutput.ReadToEndAsync()
$stderrTask = $proc.StandardError.ReadToEndAsync()
$proc.WaitForExit()
$stdout = $stdoutTask.Result
$stderr = $stderrTask.Result
[IO.File]::WriteAllText($outPath, $stdout)
[IO.File]::WriteAllText($errPath, $stderr)
$end = Get-Date
@(
  "START=$($start.ToString('o'))",
  "END=$($end.ToString('o'))",
  "WALL_SECONDS=$([math]::Round(($end-$start).TotalSeconds,1))",
  "GRADLE_PID=$gradlePid",
  "GRADLE_PRIORITY=$priority",
  "EXIT=$($proc.ExitCode)",
  "STDOUT=$outPath",
  "STDERR=$errPath"
) | Set-Content -LiteralPath (Join-Path $phase 'gradle-worker-result.txt')
exit $proc.ExitCode
