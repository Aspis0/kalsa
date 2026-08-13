# Push KEXP 35B + campaign bmoe-cli + prompts + Task B harness. NOT a measurement.
# Do NOT run this while Task A cells are live — Wi-Fi push would contaminate I/O.
$ErrorActionPreference = 'Stop'
$ADB = 'C:/Users/gualt/AppData/Local/Android/Sdk/platform-tools/adb.exe'
$X = '192.168.1.193:39643'
$PC = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\models\Qwen3.6-35B-A3B-KEXP.gguf'
$EXPECT = 'ac44e20c1783b9105b83246fd8ce59892b47a265b84e1323a8a501929877721a'
$DEV = '/data/local/tmp/gdn_750/Qwen3.6-35B-A3B-KEXP.gguf'
$ROOT = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\xiaomi_ab'
$BIN_PC = "$ROOT\bmoe-cli.CAMPAIGN"
$BIN_DEV = '/data/local/tmp/gdn_750/bin/bmoe-cli'
$BIN_EXPECT = '1ca51420476d4a979552448f1c0b5bc48a04ed2e43643543ce43fa7566bb022f'

Write-Host '=== df before ==='
& $ADB -s $X shell "df -h /data"
Write-Host '=== battery (push is not a measurement) ==='
& $ADB -s $X shell "dumpsys battery | grep -E 'AC powered|USB powered|^  level:|^  temperature:'"

Write-Host '=== push campaign bmoe-cli + SONAME libs ==='
if (-not (Test-Path $BIN_PC)) { throw "missing $BIN_PC" }
$binSha = (Get-FileHash -Algorithm SHA256 $BIN_PC).Hash.ToLower()
if ($binSha -ne $BIN_EXPECT) { throw "PC bmoe-cli sha mismatch: $binSha" }
& $ADB -s $X push $BIN_PC $BIN_DEV
if ($LASTEXITCODE -ne 0) { throw "adb push bmoe-cli failed" }
& $ADB -s $X shell "chmod 755 $BIN_DEV"
$gotBin = (& $ADB -s $X shell "sha256sum $BIN_DEV").ToString().Trim()
Write-Host $gotBin
if ($gotBin -notmatch "^$BIN_EXPECT") { throw "device bmoe-cli sha mismatch: $gotBin" }

$libDir = "$ROOT\bmoe_libs"
$libs = @(
  @{ src = 'libggml-base.so.0.16.0';     dest = 'libggml-base.so.0' },
  @{ src = 'libggml-cpu.so.0.16.0';      dest = 'libggml-cpu.so.0' },
  @{ src = 'libggml.so.0.16.0';          dest = 'libggml.so.0' },
  @{ src = 'libllama-common.so.0.0.9965'; dest = 'libllama-common.so.0' },
  @{ src = 'libllama.so.0.0.9965';       dest = 'libllama.so.0' }
)
foreach ($l in $libs) {
  $src = Join-Path $libDir $l.src
  if (-not (Test-Path $src)) { throw "missing $src" }
  $dev = "/data/local/tmp/gdn_750/bin/$($l.dest)"
  Write-Host "push $($l.src) -> $($l.dest)"
  & $ADB -s $X push $src $dev
  if ($LASTEXITCODE -ne 0) { throw "adb push $($l.dest) failed" }
}
# also keep versioned names so DT_SONAME lookups that follow the real file work
foreach ($l in $libs) {
  $src = Join-Path $libDir $l.src
  & $ADB -s $X push $src "/data/local/tmp/gdn_750/bin/$($l.src)"
}

Write-Host '=== push 35B (~12.5 GiB, ~20 min Wi-Fi) ==='
$t0 = Get-Date
& $ADB -s $X push $PC $DEV
if ($LASTEXITCODE -ne 0) { throw "adb push 35B failed" }
$t1 = Get-Date
Write-Host ("push wall_s={0:N0}" -f ($t1-$t0).TotalSeconds)

Write-Host '=== on-device sha256 (few min) ==='
$got = (& $ADB -s $X shell "sha256sum $DEV").ToString().Trim()
Write-Host $got
if ($got -notmatch "^$EXPECT") { throw "35B sha mismatch: $got" }
Set-Content -Path "$ROOT\sha_kexp_device.txt" -Value $got -Encoding ascii

# LF-convert task B harness (Android sh rejects CRLF)
$script = Get-Content -Raw "$ROOT\run_task_b.sh"
$script = $script -replace "`r`n","`n" -replace "`r","`n"
$tmp = "$env:TEMP\run_task_b.lf.sh"
[IO.File]::WriteAllText($tmp, $script, (New-Object System.Text.UTF8Encoding $false))

& $ADB -s $X push "$ROOT\prompts\p_fact.txt" /data/local/tmp/gdn_750/prompts/p_fact.txt
& $ADB -s $X push "$ROOT\prompts\p_creative.txt" /data/local/tmp/gdn_750/prompts/p_creative.txt
& $ADB -s $X push $tmp /data/local/tmp/gdn_750/run_task_b.sh
& $ADB -s $X shell "chmod 755 /data/local/tmp/gdn_750/run_task_b.sh"
Write-Host '=== 35B push+verify done ==='
