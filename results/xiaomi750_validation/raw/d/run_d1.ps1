$ErrorActionPreference = "Continue"
$adb = "C:\Users\gualt\AppData\Local\Android\Sdk\platform-tools\adb.exe"
$s = "adb-625689a2-9xEOfw._adb-tls-connect._tcp"
$raw = "C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\xiaomi750_validation\raw\d"
$plan = Join-Path $raw "cells.csv"
$runs = Join-Path $raw "d1_runs.csv"
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

# Load ONLY d1 rows from the locked plan. No glob.
$d1 = @()
Get-Content $plan | Select-Object -Skip 1 | ForEach-Object {
    if ($_ -match "^d1,") {
        $p = $_.Split(",")
        $d1 += @{ phase=$p[0]; idx=[int]$p[1]; tag=$p[2]; arm=$p[3]; flags=$p[4]; model=$p[5] }
    }
}
if ($d1.Count -ne 10) { throw "cells.csv d1 count $($d1.Count) != 10" }

"idx,tag,arm,flags,level_pre,level_post,temp_pre_c,temp_post_c,quiet_pre,gpu_pre,quiet_post,gpu_post,wake_pre,wake_post,sha_impl,sha_opencl,sha_gguf,rc,wall_s,pp_ts,tg_ts" | Set-Content -Encoding ascii $runs

$n = $d1.Count
$i = 0
foreach ($c in $d1) {
    $i++
    $tag = $c.tag
    Write-Host ("===== D1 {0}/{1} {2} {3} =====" -f $i, $n, $tag, $c.flags)
    $pre = Batt-Snap (Join-Path $raw "probes\${tag}_batt_pre.txt")
    if ($pre.level -ge 0 -and $pre.level -lt 40) {
        "STOP battery=$($pre.level) cell=$tag" | Set-Content -Encoding ascii (Join-Path $raw "STOP.txt")
        Write-Host "BATTERY FLOOR STOP"
        break
    }
    ADB "sh /data/local/tmp/kalsa16/_thermal_dump.sh" | Set-Content -Encoding ascii (Join-Path $raw "probes\${tag}_therm_pre.txt")
    ADB "input keyevent KEYCODE_WAKEUP" | Out-Null
    Start-Sleep -Seconds 1
    $wakePre = ADB "dumpsys power | grep mWakefulness="
    $wakePre | Set-Content -Encoding ascii (Join-Path $raw "probes\${tag}_wake_pre.txt")
    $sha = ADB "cd /data/local/tmp/kalsa16 && sha256sum llama-bench libllama-bench-impl.so libggml-opencl.so LFM2.5-8B-A1B-KEXP.gguf"
    $sha | Set-Content -Encoding ascii (Join-Path $raw "probes\${tag}_sha.txt")
    $shaImpl = ""; $shaOcl = ""; $shaGguf = ""
    foreach ($ln in $sha) {
        if ($ln -match "^([0-9a-f]{64})\s+libllama-bench-impl") { $shaImpl = $Matches[1] }
        if ($ln -match "^([0-9a-f]{64})\s+libggml-opencl") { $shaOcl = $Matches[1] }
        if ($ln -match "^([0-9a-f]{64})\s+LFM") { $shaGguf = $Matches[1] }
    }
    $t0 = Get-Date
    ADB ("sh /data/local/tmp/kalsa16/one_cell.sh {0} {1}" -f $tag, $c.flags)
    $t1 = Get-Date
    $wall = ($t1 - $t0).TotalSeconds
    & $adb -s $s pull ("/data/local/tmp/kalsa16/logs/{0}.out" -f $tag) (Join-Path $raw ("cells\{0}.out" -f $tag))
    & $adb -s $s pull ("/data/local/tmp/kalsa16/logs/{0}.err" -f $tag) (Join-Path $raw ("cells\{0}.err" -f $tag))
    & $adb -s $s pull ("/data/local/tmp/kalsa16/logs/{0}.rc"  -f $tag) (Join-Path $raw ("cells\{0}.rc"  -f $tag))
    $post = Batt-Snap (Join-Path $raw "probes\${tag}_batt_post.txt")
    ADB "sh /data/local/tmp/kalsa16/_thermal_dump.sh" | Set-Content -Encoding ascii (Join-Path $raw "probes\${tag}_therm_post.txt")
    $wakePost = ADB "dumpsys power | grep mWakefulness="
    $wakePost | Set-Content -Encoding ascii (Join-Path $raw "probes\${tag}_wake_post.txt")
    $rc = "missing"
    $rcPath = Join-Path $raw ("cells\{0}.rc" -f $tag)
    if (Test-Path $rcPath) { $rc = (Get-Content $rcPath -Raw).Trim() }
    $pp = ""; $tg = ""
    $outPath = Join-Path $raw ("cells\{0}.out" -f $tag)
    if (Test-Path $outPath) {
        foreach ($line in (Get-Content $outPath)) {
            if ($line -notmatch '"avg_ts"\s*:\s*([0-9.eE+-]+)') { continue }
            $ts = $Matches[1]
            if ($line -match '"n_prompt"\s*:\s*128' -and $line -match '"n_gen"\s*:\s*0') { $pp = $ts }
            if ($line -match '"n_prompt"\s*:\s*0' -and $line -match '"n_gen"\s*:\s*128') { $tg = $ts }
        }
    }
    $qPre = ZoneVal (Join-Path $raw "probes\${tag}_therm_pre.txt") "quiet_therm"
    $gPre = ZoneVal (Join-Path $raw "probes\${tag}_therm_pre.txt") "gpuss-0"
    $qPost = ZoneVal (Join-Path $raw "probes\${tag}_therm_post.txt") "quiet_therm"
    $gPost = ZoneVal (Join-Path $raw "probes\${tag}_therm_post.txt") "gpuss-0"
    $wp = (($wakePre | Out-String).Trim() -replace ",", ";")
    $wpo = (($wakePost | Out-String).Trim() -replace ",", ";")
    $row = "{0},{1},{2},{3},{4},{5},{6},{7},{8},{9},{10},{11},{12},{13},{14},{15},{16},{17},{18:N1},{19},{20}" -f `
        $c.idx, $tag, $c.arm, ($c.flags -replace " ", ";"), `
        $pre.level, $post.level, $pre.temp, $post.temp, `
        $qPre, $gPre, $qPost, $gPost, $wp, $wpo, $shaImpl, $shaOcl, $shaGguf, $rc, $wall, $pp, $tg
    Add-Content -Encoding ascii $runs $row
    Write-Host $row
    if (Test-Path $outPath) { Get-Content $outPath | Write-Host }
    if ($i -lt $n) {
        Write-Host "cooldown 90s"
        Start-Sleep -Seconds 90
    }
}
Write-Host "===== D1 DONE ====="
Get-Content $runs
