# Android arm64 test-backend-ops for MT6789 (A78/A55): fp16+dotprod, NO i8mm.
# Source: judge-exp1-plain-host @ dbf3f009. Does NOT touch build-android-hexagon-judge.
# PC-only. No adb. No push.

$ErrorActionPreference = 'Stop'

$RepoRoot  = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments'
$SrcDir    = Join-Path $RepoRoot 'upstream-hexagon\llama.cpp'
$BuildDir  = Join-Path $RepoRoot 'build-android-hexagon-judge-v82'
$NdkRoot   = 'C:\Users\gualt\AppData\Local\Android\Sdk\ndk\27.1.12297006'
$CmakeExe  = Join-Path $RepoRoot 'deps\cmake\cmake-3.31.7-windows-x86_64\bin\cmake.exe'
$NinjaExe  = 'C:\Users\gualt\AppData\Local\Android\Sdk\cmake\3.22.1\bin\ninja.exe'
$Toolchain = Join-Path $NdkRoot 'build\cmake\android.toolchain.cmake'
$PinnedSha = 'dbf3f009fa864df408f8a7208da6f129d8374f27'
$Sdk       = 'C:\Qualcomm\Hexagon_SDK\6.6.0.0'
$Tools     = Join-Path $Sdk 'tools\HEXAGON_Tools\19.0.07'

function Fail([string]$msg) {
    Write-Host "ERROR: $msg" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $SrcDir))    { Fail "src missing: $SrcDir" }
if (-not (Test-Path $CmakeExe))  { Fail "cmake missing: $CmakeExe" }
if (-not (Test-Path $NinjaExe))  { Fail "ninja missing: $NinjaExe" }
if (-not (Test-Path $Toolchain)) { Fail "toolchain missing: $Toolchain" }
if (-not (Test-Path $Sdk))       { Fail "HEXAGON_SDK_ROOT missing: $Sdk" }

Push-Location $SrcDir
try {
    $sha = (git rev-parse HEAD).Trim()
    $push = git config --get remote.origin.pushurl
    if ($sha -ne $PinnedSha) { Fail "HEAD $sha != pinned $PinnedSha" }
    if ($push -ne 'DISABLED') { Fail "origin.pushurl is '$push' (expected DISABLED)" }
} finally { Pop-Location }

$env:HEXAGON_SDK_ROOT   = $Sdk
$env:HEXAGON_TOOLS_ROOT = $Tools
$env:ANDROID_NDK_ROOT   = $NdkRoot
$env:ANDROID_NDK        = $NdkRoot
$env:PATH = (Split-Path $NinjaExe -Parent) + ';' + (Split-Path $CmakeExe -Parent) + ';' + $env:PATH

New-Item -ItemType Directory -Force -Path $BuildDir | Out-Null

# armv8.2-a + fp16 + dotprod: CPU_REPACK still engages; no i8mm, no v8.7.
$cFlags    = '-march=armv8.2-a+fp16+dotprod -fvectorize -ffp-model=fast -fno-finite-math-only -flto -D_GNU_SOURCE'
$cFlagsRel = '-O3 -DNDEBUG'

Write-Host "SRC=$SrcDir"
Write-Host "SHA=$sha"
Write-Host "BUILD=$BuildDir"
Write-Host "MARCH=armv8.2-a+fp16+dotprod"

& $CmakeExe -S $SrcDir -B $BuildDir -G Ninja `
    "-DCMAKE_MAKE_PROGRAM=$NinjaExe" `
    "-DCMAKE_TOOLCHAIN_FILE=$Toolchain" `
    "-DANDROID_ABI=arm64-v8a" `
    "-DANDROID_PLATFORM=android-31" `
    "-DCMAKE_BUILD_TYPE=Release" `
    "-DCMAKE_C_FLAGS=$cFlags" `
    "-DCMAKE_CXX_FLAGS=$cFlags" `
    "-DCMAKE_C_FLAGS_RELEASE=$cFlagsRel" `
    "-DCMAKE_CXX_FLAGS_RELEASE=$cFlagsRel" `
    "-DCMAKE_EXPORT_COMPILE_COMMANDS=ON" `
    "-DHEXAGON_SDK_ROOT=$Sdk" `
    "-DHEXAGON_TOOLS_ROOT=$Tools" `
    "-DPREBUILT_LIB_DIR=android_aarch64" `
    "-DGGML_OPENMP=OFF" `
    "-DGGML_LLAMAFILE=OFF" `
    "-DGGML_OPENCL=OFF" `
    "-DGGML_HEXAGON=ON" `
    "-DGGML_CPU_ARM_ARCH=armv8.2-a+fp16+dotprod" `
    "-DLLAMA_OPENSSL=OFF" `
    "-DLLAMA_BUILD_TESTS=ON" `
    "-DLLAMA_BUILD_TOOLS=ON" `
    "-DLLAMA_BUILD_SERVER=OFF"
if ($LASTEXITCODE -ne 0) { Fail "cmake configure failed (exit $LASTEXITCODE)" }

& $CmakeExe --build $BuildDir --target test-backend-ops -j
if ($LASTEXITCODE -ne 0) { Fail "cmake build failed (exit $LASTEXITCODE)" }

$manifest = Join-Path $BuildDir 'MANIFEST.txt'
$lines = @(
    "upstream_sha=$sha"
    "built_utc=$((Get-Date).ToUniversalTime().ToString('o'))"
    "march=armv8.2-a+fp16+dotprod"
    "GGML_CPU_ARM_ARCH=armv8.2-a+fp16+dotprod"
    ""
)

$want = @(
    'bin\test-backend-ops',
    'bin\libggml.so',
    'bin\libggml-base.so',
    'bin\libggml-cpu.so',
    'bin\libggml-hexagon.so',
    'bin\libllama.so',
    'bin\libllama-common.so'
)

foreach ($rel in $want) {
    $p = Join-Path $BuildDir $rel
    if (Test-Path $p) {
        $h = (Get-FileHash -Algorithm SHA256 $p).Hash.ToLower()
        $item = Get-Item $p
        $lines += ("{0}  {1}  {2}" -f $h, $item.Length, $rel)
        Write-Host ("SHA256 {0}  {1}  {2}" -f $h, $item.Length, $rel)
    } else {
        $lines += ("MISSING  {0}" -f $rel)
        Write-Host ("MISSING {0}" -f $rel) -ForegroundColor Yellow
    }
}

$lines | Set-Content -Encoding utf8 $manifest
Write-Host "WROTE $manifest"
Write-Host "OK"
