$ErrorActionPreference = 'Stop'

$phase = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\scratchpad\agents\q66-app-lifecycle-s23\phase3'
$source = 'C:\Users\gualt\kals-pin'
$build = 'C:\kq66-engine-test'
$cmake = 'C:\Users\gualt\AppData\Local\Android\Sdk\cmake\3.22.1\bin\cmake.exe'
$ninja = 'C:\Users\gualt\AppData\Local\Android\Sdk\cmake\3.22.1\bin\ninja.exe'
$ndk = 'C:\Users\gualt\AppData\Local\Android\Sdk\ndk\27.1.12297006'
$toolchain = Join-Path $ndk 'build\cmake\android.toolchain.cmake'
$configureLog = Join-Path $phase 'engine-test-cmake-configure.log'
$buildLog = Join-Path $phase 'engine-test-cmake-build.log'
$resultFile = Join-Path $phase 'engine-test-build-result.txt'
$priorityLog = Join-Path $phase 'engine-test-priority.log'

function Set-IdleTree {
    $names = @('cmake', 'ninja', 'clang', 'clang++', 'lld', 'lld-link', 'cmd')
    foreach ($p in @(Get-Process -ErrorAction SilentlyContinue)) {
        if ($names -contains $p.ProcessName) {
            try { $p.PriorityClass = [System.Diagnostics.ProcessPriorityClass]::Idle } catch {}
        }
    }
}

function Invoke-LoggedCommand([string]$commandLine, [string]$logPath) {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = 'cmd.exe'
    $psi.Arguments = "/d /c $commandLine > $logPath 2>&1"
    $psi.WorkingDirectory = $build
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $p = [System.Diagnostics.Process]::Start($psi)
    try { $p.PriorityClass = [System.Diagnostics.ProcessPriorityClass]::Idle } catch {}
    while (-not $p.HasExited) {
        Set-IdleTree
        Start-Sleep -Seconds 2
    }
    Set-IdleTree
    return $p.ExitCode
}

$env:ANDROID_HOME = 'C:\Users\gualt\AppData\Local\Android\Sdk'
$env:ANDROID_NDK_ROOT = $ndk
$env:ANDROID_NDK_HOME = $ndk
$env:CMAKE_BUILD_PARALLEL_LEVEL = '2'
$env:NINJAFLAGS = '-j2'

New-Item -ItemType Directory -Force -Path $build | Out-Null
Set-IdleTree

$configureArgs = @(
    "$cmake -S $source -B $build -G Ninja",
    "-DCMAKE_MAKE_PROGRAM=$ninja",
    "-DCMAKE_TOOLCHAIN_FILE=$toolchain",
    '-DANDROID_ABI=arm64-v8a',
    '-DANDROID_PLATFORM=android-35',
    '-DCMAKE_BUILD_TYPE=Release',
    '-DBUILD_SHARED_LIBS=OFF',
    '-DCMAKE_ANDROID_STL_TYPE=c++_static',
    '-DLLAMA_BUILD_COMMON=ON',
    '-DLLAMA_BUILD_TESTS=ON',
    '-DLLAMA_BUILD_TOOLS=OFF',
    '-DLLAMA_BUILD_EXAMPLES=OFF',
    '-DLLAMA_BUILD_SERVER=OFF',
    '-DLLAMA_BUILD_APP=OFF',
    '-DLLAMA_BUILD_UI=OFF',
    '-DLLAMA_OPENSSL=OFF',
    '-DGGML_BUILD_TESTS=OFF',
    '-DGGML_BUILD_EXAMPLES=OFF',
    '-DGGML_NATIVE=OFF',
    '-DGGML_OPENMP=OFF',
    '-DGGML_CPU_ARM_ARCH=armv8.2-a+dotprod',
    '-DGGML_CPU_REPACK=ON',
    '-DLLAMA_TESTS_INSTALL=OFF'
) -join ' '

try {
    $configureExit = Invoke-LoggedCommand $configureArgs $configureLog
    if ($configureExit -ne 0) {
        "configure_exit=$configureExit`nbuild_exit=NOT_RUN" | Set-Content -LiteralPath $resultFile -Encoding UTF8
        exit $configureExit
    }

    $buildCommand = "$cmake --build $build --target test-repack-q23k-load --parallel 2"
    $buildExit = Invoke-LoggedCommand $buildCommand $buildLog
    "configure_exit=0`nbuild_exit=$buildExit" | Set-Content -LiteralPath $resultFile -Encoding UTF8
    exit $buildExit
}
catch {
    $_ | Out-String | Set-Content -LiteralPath $resultFile -Encoding UTF8
    exit 1
}
finally {
    Get-Process -ErrorAction SilentlyContinue |
        Where-Object { @('cmake','ninja','clang','clang++','lld','lld-link','cmd') -contains $_.ProcessName } |
        ForEach-Object { try { $_.PriorityClass = [System.Diagnostics.ProcessPriorityClass]::Idle } catch {} } |
        Out-File -FilePath $priorityLog -Encoding UTF8
}
