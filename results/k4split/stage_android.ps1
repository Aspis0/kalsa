$ErrorActionPreference = "Stop"
$root = "C:\Users\gualt\Desktop\Kalsa\moe-experiments"
$binDir = Join-Path $root "results\k4split\bin"
New-Item -ItemType Directory -Force -Path $binDir | Out-Null

$elf = Join-Path $root "build-android-opencl-k4split\cli\bmoe-cli"
if (-not (Test-Path $elf)) { throw "missing Android ELF $elf" }

$stl = "C:\Users\gualt\AppData\Local\Android\Sdk\ndk\27.1.12297006\toolchains\llvm\prebuilt\windows-x86_64\sysroot\usr\lib\aarch64-linux-android\libc++_shared.so"
$readelf = "C:\Users\gualt\AppData\Local\Android\Sdk\ndk\27.1.12297006\toolchains\llvm\prebuilt\windows-x86_64\bin\llvm-readelf.exe"

Copy-Item $elf (Join-Path $binDir "bmoe-cli") -Force
Copy-Item $stl (Join-Path $binDir "libc++_shared.so") -Force

$needed = & $readelf -d $elf | Select-String "NEEDED"
$needed | ForEach-Object { $_.Line } | Set-Content (Join-Path $root "results\k4split\bmoe_cli_android_dtneeded.txt")
Write-Host "==== DT_NEEDED ===="
$needed | ForEach-Object { $_.Line }

$out = @()
foreach ($name in @("bmoe-cli", "libc++_shared.so")) {
    $f = Get-Item (Join-Path $binDir $name)
    $h = (Get-FileHash -Algorithm SHA256 $f.FullName).Hash.ToLowerInvariant()
    $line = "{0}  {1}  {2}" -f $h, $f.Length, $name
    $out += $line
    Write-Host $line
}
$out | Set-Content (Join-Path $root "results\k4split\SHA256SUMS_android.txt")
