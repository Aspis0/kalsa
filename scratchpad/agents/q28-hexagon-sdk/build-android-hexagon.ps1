# Ready-to-run Android ggml-hexagon build for upstream llama.cpp.
# Does NOT touch BigMoeOnEdge. Does NOT deploy to any device.
#
# After owner installs Hexagon SDK 6.6.0.0:
#   $env:HEXAGON_SDK_ROOT   = 'C:\Qualcomm\Hexagon_SDK\6.6.0.0'
#   $env:HEXAGON_TOOLS_ROOT = 'C:\Qualcomm\Hexagon_SDK\6.6.0.0\tools\HEXAGON_Tools\19.0.07'
#   powershell -NoProfile -ExecutionPolicy Bypass -File <this script>
#
# CMake 3.22.1 cannot consume docs/backend/snapdragon/CMakeUserPresets.json (schema v5).
# This script passes the equivalent -D flags instead of --preset.

$ErrorActionPreference = 'Stop'

$RepoRoot   = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments'
$SrcDir     = Join-Path $RepoRoot 'upstream-hexagon\llama.cpp'
$BuildDir   = Join-Path $RepoRoot 'build-android-hexagon'
$NdkRoot    = 'C:\Users\gualt\AppData\Local\Android\Sdk\ndk\27.1.12297006'
$CmakeDir   = 'C:\Users\gualt\AppData\Local\Android\Sdk\cmake\3.22.1\bin'
$CmakeExe   = Join-Path $CmakeDir 'cmake.exe'
$NinjaExe   = Join-Path $CmakeDir 'ninja.exe'
$Toolchain  = Join-Path $NdkRoot 'build\cmake\android.toolchain.cmake'
$PinnedSha  = '3f545beccee69d9975f466ec7e45fd9aacd8ba90'

function Fail([string]$msg) {
    Write-Host "ERROR: $msg" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $SrcDir)) { Fail "upstream clone missing: $SrcDir" }
if (-not (Test-Path $CmakeExe)) { Fail "cmake missing: $CmakeExe" }
if (-not (Test-Path $NinjaExe)) { Fail "ninja missing: $NinjaExe" }
if (-not (Test-Path $Toolchain)) { Fail "NDK toolchain missing: $Toolchain" }

Push-Location $SrcDir
try {
    $sha = (git rev-parse HEAD).Trim()
    $push = git config --get remote.origin.pushurl
    if ($sha -ne $PinnedSha) {
        Write-Host "WARN: clone SHA $sha != pinned $PinnedSha (report/rebuild anyway)" -ForegroundColor Yellow
    }
    if ($push -ne 'DISABLED') { Fail "origin.pushurl is '$push' (expected DISABLED). Refusing to continue." }
} finally { Pop-Location }

$sdk = $env:HEXAGON_SDK_ROOT
if (-not $sdk) { $sdk = 'C:\Qualcomm\Hexagon_SDK\6.6.0.0' }
$tools = $env:HEXAGON_TOOLS_ROOT
if (-not $tools) { $tools = Join-Path $sdk 'tools\HEXAGON_Tools\19.0.07' }

if (-not (Test-Path $sdk)) {
    Fail @"
HEXAGON_SDK_ROOT not found: $sdk

Owner unblock:
  1. qsc-cli login -u <qualcomm-username>
  2. QIK.exe INSTALL Hexagon_SDK -version 6.6.0.0 -Silent
  3. Expected tree: C:\Qualcomm\Hexagon_SDK\6.6.0.0
  4. HEXAGON_TOOLS_ROOT usually: C:\Qualcomm\Hexagon_SDK\6.6.0.0\tools\HEXAGON_Tools\19.0.07
  Catalog: https://softwarecenter.qualcomm.com/catalog/item/Hexagon_SDK?version=6.6.0.0
"@
}

if (-not (Test-Path $tools)) {
    $json = Join-Path $sdk 'hexagon_sdk.json'
    if (Test-Path $json) {
        Write-Host "HEXAGON_TOOLS_ROOT missing at $tools ; cmake will try hexagon_sdk.json"
    } else {
        Fail "HEXAGON_TOOLS_ROOT not found: $tools (and no hexagon_sdk.json under SDK)"
    }
}

$env:HEXAGON_SDK_ROOT = $sdk
$env:HEXAGON_TOOLS_ROOT = $tools
$env:ANDROID_NDK_ROOT = $NdkRoot
$env:ANDROID_NDK = $NdkRoot

New-Item -ItemType Directory -Force -Path $BuildDir | Out-Null

$cFlags = '-march=armv8.7a+fp16+dotprod+i8mm -fvectorize -ffp-model=fast -fno-finite-math-only -flto -D_GNU_SOURCE'
$cFlagsRel = '-O3 -DNDEBUG'

$opencl = 'OFF'
if ($env:OPENCL_SDK_ROOT -and (Test-Path $env:OPENCL_SDK_ROOT)) { $opencl = 'ON' }

Write-Host "SRC=$SrcDir"
Write-Host "SHA=$sha"
Write-Host "BUILD=$BuildDir"
Write-Host "NDK=$NdkRoot"
Write-Host "CMAKE=$CmakeExe"
Write-Host "HEXAGON_SDK_ROOT=$sdk"
Write-Host "HEXAGON_TOOLS_ROOT=$tools"
Write-Host "GGML_OPENCL=$opencl"

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
    "-DHEXAGON_SDK_ROOT=$sdk" `
    "-DHEXAGON_TOOLS_ROOT=$tools" `
    "-DPREBUILT_LIB_DIR=android_aarch64" `
    "-DGGML_OPENMP=OFF" `
    "-DGGML_LLAMAFILE=OFF" `
    "-DGGML_OPENCL=$opencl" `
    "-DGGML_HEXAGON=ON" `
    "-DLLAMA_OPENSSL=OFF" `
    "-DLLAMA_BUILD_TESTS=ON" `
    "-DLLAMA_BUILD_TOOLS=ON"
if ($LASTEXITCODE -ne 0) { Fail "cmake configure failed (exit $LASTEXITCODE)" }

& $CmakeExe --build $BuildDir --target llama-bench test-backend-ops llama-cli ggml-hexagon -j
if ($LASTEXITCODE -ne 0) { Fail "cmake build failed (exit $LASTEXITCODE)" }

$manifest = Join-Path $BuildDir 'MANIFEST.txt'
$lines = @()
$lines += "upstream_sha=$sha"
$lines += "built_utc=$((Get-Date).ToUniversalTime().ToString('o'))"
$lines += "ndk=$NdkRoot"
$lines += "cmake=$CmakeExe"
$lines += "HEXAGON_SDK_ROOT=$sdk"
$lines += "HEXAGON_TOOLS_ROOT=$tools"
$lines += ""

$want = @(
    'bin\llama-bench',
    'bin\llama-cli',
    'bin\test-backend-ops',
    'bin\libggml-hexagon.so',
    'bin\libggml.so',
    'ggml\src\ggml-hexagon\libggml-hexagon.so',
    'ggml\src\ggml-hexagon\libggml-htp-v73.so',
    'ggml\src\ggml-hexagon\libggml-htp-v75.so',
    'ggml\src\ggml-hexagon\libggml-htp-v79.so',
    'ggml\src\ggml-hexagon\libggml-htp-v81.so'
)

$foundAny = $false
foreach ($rel in $want) {
    $p = Join-Path $BuildDir $rel
    if (Test-Path $p) {
        $foundAny = $true
        $h = (certutil -hashfile $p SHA256 | Select-Object -Skip 1 -First 1).Trim()
        $item = Get-Item $p
        $lines += ("{0}  {1}  {2}" -f $h, $item.Length, $rel)
        Write-Host ("SHA256 {0}  {1}  {2}" -f $h, $item.Length, $rel)
    } else {
        $lines += ("MISSING  {0}" -f $rel)
        Write-Host ("MISSING {0}" -f $rel) -ForegroundColor Yellow
    }
}

# catch HTP skels wherever cmake dropped them
Get-ChildItem $BuildDir -Recurse -File -Filter 'libggml-htp-*.so' -ErrorAction SilentlyContinue | ForEach-Object {
    $rel = $_.FullName.Substring($BuildDir.Length).TrimStart('\')
    if ($want -notcontains $rel) {
        $h = (certutil -hashfile $_.FullName SHA256 | Select-Object -Skip 1 -First 1).Trim()
        $lines += ("{0}  {1}  {2}" -f $h, $_.Length, $rel)
    }
}

$lines | Set-Content -Encoding utf8 $manifest
Write-Host "WROTE $manifest"
if (-not $foundAny) { Fail "build produced no expected artifacts" }
Write-Host "OK"
