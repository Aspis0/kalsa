$ErrorActionPreference = 'Stop'

$phase = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\scratchpad\agents\q66-app-lifecycle-s23\phase3'
$source = 'C:\Users\gualt\kals-pin'
$build = 'C:\kq66-repack-v4'
$cmake = 'C:\Users\gualt\AppData\Local\Android\Sdk\cmake\3.22.1\bin\cmake.exe'
$ninja = 'C:\Users\gualt\AppData\Local\Android\Sdk\cmake\3.22.1\bin\ninja.exe'
$ndk = 'C:\Users\gualt\AppData\Local\Android\Sdk\ndk\27.1.12297006'
$toolchain = Join-Path $ndk 'build\cmake\android.toolchain.cmake'
$configureLog = Join-Path $phase 'engine-test-proven-v4-configure.log'
$buildLog = Join-Path $phase 'engine-test-proven-v4-build.log'
$resultFile = Join-Path $phase 'engine-test-proven-v4-result.txt'
$priorityLog = Join-Path $phase 'engine-test-proven-v4-priority.log'
$ramLog = Join-Path $phase 'engine-test-proven-v4-ram.log'

function Get-FreeGiB {
    $os = Get-CimInstance Win32_OperatingSystem
    return [math]::Round(([double]$os.FreePhysicalMemory * 1KB) / 1GB, 2)
}

function Write-RamSample([string]$label) {
    $os = Get-CimInstance Win32_OperatingSystem
    $free = [math]::Round(([double]$os.FreePhysicalMemory * 1KB) / 1GB, 2)
    $commit = [math]::Round((Get-Counter '\Memory\% Committed Bytes In Use').CounterSamples[0].CookedValue, 1)
    "$label`t$(Get-Date -Format o)`tfree_gib=$free`tcommit_pct=$commit" | Add-Content -LiteralPath $ramLog
    if ($free -lt 3 -or $commit -gt 95) {
        throw "Safety floor breached: free_gib=$free commit_pct=$commit"
    }
}

if (-not (Test-Path -LiteralPath $cmake)) { throw "Missing cmake: $cmake" }
if (-not (Test-Path -LiteralPath $ninja)) { throw "Missing ninja: $ninja" }
if (-not (Test-Path -LiteralPath $toolchain)) { throw "Missing NDK toolchain: $toolchain" }
if (-not (Test-Path -LiteralPath (Join-Path $source 'CMakeLists.txt'))) { throw "Missing fork source: $source" }
if (Test-Path -LiteralPath $build) { throw "Build directory already exists; refusing to overwrite: $build" }

$env:ANDROID_HOME = 'C:\Users\gualt\AppData\Local\Android\Sdk'
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:ANDROID_NDK_ROOT = $ndk
$env:ANDROID_NDK_HOME = $ndk
$env:CMAKE_BUILD_PARALLEL_LEVEL = '2'
$env:NINJAFLAGS = '-j2'

try {
    try { [System.Diagnostics.Process]::GetCurrentProcess().PriorityClass = [System.Diagnostics.ProcessPriorityClass]::Idle } catch {}
    New-Item -ItemType Directory -Force -Path $phase | Out-Null
    New-Item -ItemType Directory -Force -Path $build | Out-Null
    Set-Content -LiteralPath $configureLog -Value "START=$(Get-Date -Format o)`nSOURCE=$source`nBUILD=$build`nNDK=$ndk`nCMAKE=$cmake`nNINJA=$ninja`nTOOLCHAIN=$toolchain`n" -Encoding UTF8
    Set-Content -LiteralPath $buildLog -Value "START=$(Get-Date -Format o)`n" -Encoding UTF8
    Set-Content -LiteralPath $ramLog -Value "START=$(Get-Date -Format o)" -Encoding UTF8
    Write-RamSample 'pre-configure'
    if ((Get-FreeGiB) -lt 8) { throw "RAM gate failed: $((Get-FreeGiB)) GiB free; required >= 8 GiB" }

    $configureArgs = @(
        '-S', $source, '-B', $build, '-G', 'Ninja',
        "-DCMAKE_MAKE_PROGRAM=$ninja",
        "-DCMAKE_TOOLCHAIN_FILE=$toolchain",
        '-DANDROID_ABI=arm64-v8a',
        '-DANDROID_PLATFORM=android-29',
        '-DCMAKE_BUILD_TYPE=Release',
        '-DLLAMA_BUILD_COMMON=ON',
        '-DLLAMA_BUILD_TESTS=ON',
        '-DLLAMA_BUILD_TOOLS=OFF',
        '-DLLAMA_BUILD_EXAMPLES=OFF',
        '-DLLAMA_BUILD_SERVER=OFF',
        '-DLLAMA_OPENSSL=OFF',
        '-DGGML_BUILD_TESTS=OFF',
        '-DGGML_BUILD_EXAMPLES=OFF',
        '-DGGML_NATIVE=OFF',
        '-DGGML_OPENCL=OFF',
        '-DGGML_OPENMP=OFF',
        '-DGGML_CPU_ARM_ARCH=armv8.2-a+dotprod+fp16',
        '-DGGML_CPU_REPACK=ON',
        '-DLLAMA_CURL=OFF'
    )
    $previousErrorAction = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & $cmake @configureArgs *>> $configureLog
        $configureExit = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousErrorAction
    }
    Add-Content -LiteralPath $configureLog -Value "`nconfigure_exit=$configureExit`nEND=$(Get-Date -Format o)"
    if ($configureExit -ne 0) {
        "configure_exit=$configureExit`nbuild_exit=NOT_RUN" | Set-Content -LiteralPath $resultFile -Encoding UTF8
        exit $configureExit
    }

    Write-RamSample 'pre-build'
    $buildArgs = @('--build', $build, '--target', 'test-repack-q23k-load', '--parallel', '2')
    $previousErrorAction = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & $cmake @buildArgs *>> $buildLog
        $buildExit = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousErrorAction
    }
    Add-Content -LiteralPath $buildLog -Value "`nbuild_exit=$buildExit`nEND=$(Get-Date -Format o)"
    Write-RamSample 'post-build'
    "configure_exit=0`nbuild_exit=$buildExit" | Set-Content -LiteralPath $resultFile -Encoding UTF8
    exit $buildExit
}
catch {
    $message = ($_ | Out-String).TrimEnd()
    Add-Content -LiteralPath $configureLog -Value "`nWORKER_EXCEPTION`n$message"
    $message | Set-Content -LiteralPath $resultFile -Encoding UTF8
    exit 1
}
finally {
    try { Get-FreeGiB | ForEach-Object { "finally_free_gib=$_" | Add-Content -LiteralPath $ramLog } } catch {}
    Get-Process -ErrorAction SilentlyContinue |
        Where-Object { $_.ProcessName -match '^(cmake|ninja|clang|clang\+\+|lld|lld-link)$' } |
        Select-Object Id,ProcessName,PriorityClass,CPU,WorkingSet64 |
        Out-File -FilePath $priorityLog -Encoding UTF8
}
