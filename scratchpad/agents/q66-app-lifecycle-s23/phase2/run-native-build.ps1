$ErrorActionPreference = 'Stop'
$cmake = 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe'
$build = 'C:\Users\gualt\kals-pin\build-phase2-native-q63b'
$work = 'C:\Users\gualt\kals-pin'
$phase2 = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\scratchpad\agents\q66-app-lifecycle-s23\phase2'
$configureOut = Join-Path $phase2 'cmake-native.log'
$configureErr = Join-Path $phase2 'cmake-native.err'
$buildOut = Join-Path $phase2 'build-native-msvc.log'
$buildErr = Join-Path $phase2 'build-native-msvc.err'
$status = Join-Path $phase2 'native-worker-status.log'
$env:CMAKE_BUILD_PARALLEL_LEVEL = '2'
$env:NINJAFLAGS = '-j2'

function Invoke-BoundedCMake([string[]]$arguments, [string]$stdout, [string]$stderr, [string]$label) {
    $started = Get-Date
    Add-Content -LiteralPath $status -Value "[$($started.ToString('o'))] START $label"
    $p = Start-Process -FilePath $cmake -ArgumentList $arguments -WorkingDirectory $work -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru -Wait
    $exit = $p.ExitCode
    $ended = Get-Date
    Add-Content -LiteralPath $status -Value "[$($ended.ToString('o'))] END $label exit=$exit wall_seconds=$(($ended - $started).TotalSeconds) pid=$($p.Id) priority=Idle-inherited"
    return $exit
}

$configureArgs = @(
    '-S', 'C:\Users\gualt\kals-pin', '-B', $build, '-G', 'Ninja',
    '-DCMAKE_MAKE_PROGRAM="C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\IDE\CommonExtensions\Microsoft\CMake\Ninja\ninja.exe"',
    '-DCMAKE_BUILD_TYPE=Release', '-DCMAKE_C_FLAGS=/DWIN32;/D_WINDOWS',
    '-DCMAKE_CXX_FLAGS=/DWIN32;/D_WINDOWS;/EHsc',
    '-DCMAKE_C_FLAGS_RELEASE=/O2;/Ob2;/DNDEBUG',
    '-DCMAKE_CXX_FLAGS_RELEASE=/O2;/Ob2;/DNDEBUG',
    '-DCMAKE_EXE_LINKER_FLAGS=/machine:x64',
    '-DCMAKE_EXE_LINKER_FLAGS_RELEASE=/INCREMENTAL:NO',
    '-DBUILD_SHARED_LIBS=OFF', '-DLLAMA_BUILD_COMMON=ON',
    '-DLLAMA_BUILD_TOOLS=ON', '-DLLAMA_BUILD_EXAMPLES=OFF', '-DLLAMA_BUILD_TESTS=ON',
    '-DLLAMA_BUILD_SERVER=ON', '-DLLAMA_BUILD_APP=OFF', '-DLLAMA_BUILD_UI=OFF',
    '-DLLAMA_USE_PREBUILT_UI=OFF', '-DLLAMA_OPENSSL=OFF', '-DGGML_CPU=ON', '-DGGML_NATIVE=ON',
    '-DGGML_CUDA=OFF', '-DGGML_HIP=OFF', '-DGGML_VULKAN=OFF', '-DGGML_METAL=OFF',
    '-DGGML_SYCL=OFF', '-DGGML_RPC=OFF', '-DGGML_OPENCL=OFF', '-DGGML_HEXAGON=OFF'
)

$configureExit = Invoke-BoundedCMake $configureArgs $configureOut $configureErr 'configure'
if ($configureExit -ne 0) { exit $configureExit }
$buildExit = Invoke-BoundedCMake @('--build', $build, '--config', 'Release', '--parallel', '2', '--verbose') $buildOut $buildErr 'build'
exit $buildExit
