$ErrorActionPreference = "Continue"
$adb = "C:\Users\gualt\AppData\Local\Android\Sdk\platform-tools\adb.exe"
$s = "adb-625689a2-9xEOfw._adb-tls-connect._tcp"
$raw = "C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\xiaomi750_validation\raw\c"
$csv = Join-Path $raw "cells.csv"
New-Item -ItemType Directory -Force -Path (Join-Path $raw "probes") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $raw "cells") | Out-Null

function ADB([string]$cmd) { & $adb -s $s shell $cmd }

function Parse-Level([string]$line) {
    if ($null -ne $line -and $line -match "level:\s+(\d+)") { return [int]$Matches[1] }
    return -1
}
function Parse-TempC([string]$line) {
    if ($null -ne $line -and $line -match "temperature:\s+(\d+)") { return [double]$Matches[1] / 10.0 }
    return -1
}
function Batt-Snap([string]$path) {
    $t = ADB "dumpsys battery"
    $t | Set-Content -Encoding ascii $path
    $level = ($t | Select-String "^\s+level:").Line
    $temp  = ($t | Select-String "^\s+temperature:").Line
    return @{ level = (Parse-Level $level); temp = (Parse-TempC $temp) }
}
function ZoneVal([string]$path, [string]$name) {
    if (-not (Test-Path $path)) { return "" }
    $hit = Select-String -Path $path -Pattern $name | Select-Object -First 1
    if ($hit -and $hit.Line -match "(\d+)\s*$") { return $Matches[1] }
    return ""
}

$header = "idx,tag,kind,flags,level_pre,level_post,temp_pre_c,temp_post_c,quiet_pre,gpu_pre,quiet_post,gpu_post,sha_impl,sha_opencl,rc,wall_s"
Set-Content -Encoding ascii $csv $header

$cells = @(
    @{ idx=1; tag="c_gpu_pp128"; kind="GPU_pp128"; flags="-ngl 99 -p 128 -n 0 -r 3" },
    @{ idx=2; tag="c_cpu_pp128"; kind="CPU_pp128"; flags="-ngl 0 -p 128 -n 0 -r 3" },
    @{ idx=3; tag="c_gpu_pp512"; kind="GPU_pp512"; flags="-ngl 99 -p 512 -n 0 -r 3" },
    @{ idx=4; tag="c_cpu_pp512"; kind="CPU_pp512"; flags="-ngl 0 -p 512 -n 0 -r 3" }
)

Write-Host "initial 90s cooldown after phase b"
Start-Sleep -Seconds 90

foreach ($c in $cells) {
    $tag = $c.tag
    Write-Host ("===== CELL {0} {1} {2} =====" -f $c.idx, $tag, $c.flags)
    $pre = Batt-Snap (Join-Path $raw "probes\${tag}_batt_pre.txt")
    ADB "sh /data/local/tmp/kalsa16/_thermal_dump.sh" | Set-Content -Encoding ascii (Join-Path $raw "probes\${tag}_therm_pre.txt")
    if ($pre.level -ge 0 -and $pre.level -lt 40) {
        Write-Host ("BATTERY FLOOR {0} STOP" -f $pre.level)
        break
    }
    ADB "input keyevent KEYCODE_WAKEUP" | Out-Null
    Start-Sleep -Seconds 1
    $sha = ADB "cd /data/local/tmp/kalsa16 && sha256sum llama-bench libllama-bench-impl.so libggml-opencl.so"
    $sha | Set-Content -Encoding ascii (Join-Path $raw "probes\${tag}_sha.txt")
    $shaImpl = ""; $shaOcl = ""
    foreach ($ln in $sha) {
        if ($ln -match "^([0-9a-f]{64})\s+libllama-bench-impl") { $shaImpl = $Matches[1] }
        if ($ln -match "^([0-9a-f]{64})\s+libggml-opencl") { $shaOcl = $Matches[1] }
    }
    $t0 = Get-Date
    ADB ("sh /data/local/tmp/kalsa16/one_cell_c.sh {0} {1}" -f $tag, $c.flags)
    $t1 = Get-Date
    $wall = ($t1 - $t0).TotalSeconds
    & $adb -s $s pull ("/data/local/tmp/kalsa16/logs/{0}.out" -f $tag) (Join-Path $raw ("cells\{0}.out" -f $tag))
    & $adb -s $s pull ("/data/local/tmp/kalsa16/logs/{0}.err" -f $tag) (Join-Path $raw ("cells\{0}.err" -f $tag))
    & $adb -s $s pull ("/data/local/tmp/kalsa16/logs/{0}.rc"  -f $tag) (Join-Path $raw ("cells\{0}.rc"  -f $tag))
    $post = Batt-Snap (Join-Path $raw "probes\${tag}_batt_post.txt")
    ADB "sh /data/local/tmp/kalsa16/_thermal_dump.sh" | Set-Content -Encoding ascii (Join-Path $raw "probes\${tag}_therm_post.txt")
    $rc = "missing"
    $rcPath = Join-Path $raw ("cells\{0}.rc" -f $tag)
    if (Test-Path $rcPath) { $rc = (Get-Content $rcPath -Raw).Trim() }
    $qPre = ZoneVal (Join-Path $raw "probes\${tag}_therm_pre.txt") "quiet_therm"
    $gPre = ZoneVal (Join-Path $raw "probes\${tag}_therm_pre.txt") "gpuss-0"
    $qPost = ZoneVal (Join-Path $raw "probes\${tag}_therm_post.txt") "quiet_therm"
    $gPost = ZoneVal (Join-Path $raw "probes\${tag}_therm_post.txt") "gpuss-0"
    $row = "{0},{1},{2},{3},{4},{5},{6},{7},{8},{9},{10},{11},{12},{13},{14},{15:N1}" -f `
        $c.idx, $tag, $c.kind, ($c.flags -replace " ", ";"), `
        $pre.level, $post.level, $pre.temp, $post.temp, `
        $qPre, $gPre, $qPost, $gPost, $shaImpl, $shaOcl, $rc, $wall
    Add-Content -Encoding ascii $csv $row
    Write-Host $row
    Get-Content (Join-Path $raw ("cells\{0}.out" -f $tag)) -ErrorAction SilentlyContinue | Write-Host
    if ($c.idx -lt 4) {
        Write-Host "cooldown 90s"
        Start-Sleep -Seconds 90
    }
}
Write-Host "===== PHASE C DONE ====="
Get-Content $csv
