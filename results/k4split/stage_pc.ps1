$ErrorActionPreference = "Stop"
$root = "C:\Users\gualt\Desktop\Kalsa\moe-experiments"
$srcDir = Join-Path $root "build-pc-k4split"
$binDir = Join-Path $root "results\k4split\bin"
New-Item -ItemType Directory -Force -Path $binDir | Out-Null

$exe = Join-Path $srcDir "cli\bmoe-cli.exe"
if (-not (Test-Path $exe)) { throw "missing $exe" }

$copy = @(
    $exe,
    (Join-Path $srcDir "bin\llama.dll"),
    (Join-Path $srcDir "bin\ggml.dll"),
    (Join-Path $srcDir "bin\ggml-base.dll"),
    (Join-Path $srcDir "bin\ggml-cpu.dll"),
    (Join-Path $srcDir "third_party\llama.cpp\ggml\src\ggml.dll"),
    (Join-Path $srcDir "third_party\llama.cpp\ggml\src\ggml-base.dll"),
    (Join-Path $srcDir "third_party\llama.cpp\ggml\src\ggml-cpu.dll")
) | Where-Object { Test-Path $_ } | Select-Object -Unique

$lines = @()
foreach ($f in $copy) {
    $item = Get-Item $f
    $hash = (Get-FileHash -Algorithm SHA256 $item.FullName).Hash.ToLowerInvariant()
    $destName = if ($item.Name -eq "bmoe-cli.exe") { "bmoe-cli-pc.exe" } else { $item.Name }
    Copy-Item $item.FullName (Join-Path $binDir $destName) -Force
    $lines += ("{0}  {1}  {2}" -f $hash, $item.Length, $destName)
    Write-Host ("{0}  {1}  {2}" -f $hash, $item.Length, $destName)
}
$lines | Set-Content (Join-Path $root "results\k4split\SHA256SUMS_pc.txt")

$help = & $exe --help 2>&1 | Out-String
$help | Set-Content (Join-Path $root "results\k4split\bmoe_cli_pc_help.txt")
if ($help -notmatch "--ngl" -or $help -notmatch "anon-gpu" -or $help -notmatch "--moe-cpu-experts") {
    throw "PC bmoe-cli --help missing split flags"
}
Write-Host "PC --help flags OK"
