$ErrorActionPreference = "Continue"
$adb = "C:\Users\gualt\AppData\Local\Android\Sdk\platform-tools\adb.exe"
$s = "adb-625689a2-9xEOfw._adb-tls-connect._tcp"
$raw = "C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\xiaomi750_validation\raw\b"
$csv = Join-Path $raw "cells.csv"
New-Item -ItemType Directory -Force -Path (Join-Path $raw "probes") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $raw "cells") | Out-Null

function ADB([string]$cmd) {
    & $adb -s $s shell $cmd
}

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

$header = "idx,tag,arm,flags,level_pre,level_post,temp_pre_c,temp_post_c,quiet_pre,gpu_pre,quiet_post,gpu_post,memavail_pre_kib,memavail_post_kib,wake_pre,wake_post,sha_impl,sha_opencl,rc,wall_s"
Set-Content -Encoding ascii $csv $header

$cells = @(
    @{ idx=1; tag="c01_A"; arm="A"; flags="-ngl 99" },
    @{ idx=2; tag="c02_B"; arm="B"; flags="-ngl 99 -ncmoe 99" },
    @{ idx=3; tag="c03_C"; arm="C"; flags="-ngl 0" },
    @{ idx=4; tag="c04_C"; arm="C"; flags="-ngl 0" },
    @{ idx=5; tag="c05_B"; arm="B"; flags="-ngl 99 -ncmoe 99" },
    @{ idx=6; tag="c06_A"; arm="A"; flags="-ngl 99" },
    @{ idx=7; tag="c07_A"; arm="A"; flags="-ngl 99" },
    @{ idx=8; tag="c08_B"; arm="B"; flags="-ngl 99 -ncmoe 99" },
    @{ idx=9; tag="c09_C"; arm="C"; flags="-ngl 0" }
)

ADB "sh -c 'env | grep GGML_OPENCL || echo GGML_OPENCL_LOG_ALLOC is unset'" | Set-Content -Encoding ascii (Join-Path $raw "probes\env_ggml.txt")

foreach ($c in $cells) {
    $tag = $c.tag
    Write-Host ("===== CELL {0} {1} {2} =====" -f $c.idx, $tag, $c.flags)

    $pre = Batt-Snap (Join-Path $raw "probes\${tag}_batt_pre.txt")
    ADB "sh /data/local/tmp/kalsa16/_thermal_dump.sh" | Set-Content -Encoding ascii (Join-Path $raw "probes\${tag}_therm_pre.txt")
    $memPreLine = ADB "grep MemAvailable /proc/meminfo"
    $memPreLine | Set-Content -Encoding ascii (Join-Path $raw "probes\${tag}_mem_pre.txt")
    ADB "input keyevent KEYCODE_WAKEUP" | Out-Null
    Start-Sleep -Seconds 1
    $wakePre = ADB "dumpsys power | grep mWakefulness="
    $wakePre | Set-Content -Encoding ascii (Join-Path $raw "probes\${tag}_wake_pre.txt")
    $sha = ADB "cd /data/local/tmp/kalsa16 && sha256sum llama-bench libllama-bench-impl.so libggml-opencl.so"
    $sha | Set-Content -Encoding ascii (Join-Path $raw "probes\${tag}_sha.txt")
    $shaImpl = ""
    $shaOcl = ""
    foreach ($ln in $sha) {
        if ($ln -match "^([0-9a-f]{64})\s+libllama-bench-impl") { $shaImpl = $Matches[1] }
        if ($ln -match "^([0-9a-f]{64})\s+libggml-opencl") { $shaOcl = $Matches[1] }
    }

    if ($pre.level -ge 0 -and $pre.level -lt 40) {
        Write-Host ("BATTERY FLOOR {0} STOP" -f $pre.level)
        ("STOP battery={0} cell={1}" -f $pre.level, $tag) | Set-Content -Encoding ascii (Join-Path $raw "STOP.txt")
        break
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
    $memPostLine = ADB "grep MemAvailable /proc/meminfo"
    $memPostLine | Set-Content -Encoding ascii (Join-Path $raw "probes\${tag}_mem_post.txt")
    $wakePost = ADB "dumpsys power | grep mWakefulness="
    $wakePost | Set-Content -Encoding ascii (Join-Path $raw "probes\${tag}_wake_post.txt")

    $rcPath = Join-Path $raw ("cells\{0}.rc" -f $tag)
    $rc = "missing"
    if (Test-Path $rcPath) { $rc = (Get-Content $rcPath -Raw).Trim() }

    $qPre = ZoneVal (Join-Path $raw "probes\${tag}_therm_pre.txt") "quiet_therm"
    $gPre = ZoneVal (Join-Path $raw "probes\${tag}_therm_pre.txt") "gpuss-0"
    $qPost = ZoneVal (Join-Path $raw "probes\${tag}_therm_post.txt") "quiet_therm"
    $gPost = ZoneVal (Join-Path $raw "probes\${tag}_therm_post.txt") "gpuss-0"
    $maPre = ""
    $maPost = ""
    if ($memPreLine -match "(\d+)") { $maPre = $Matches[1] }
    if ($memPostLine -match "(\d+)") { $maPost = $Matches[1] }
    $wp = (($wakePre | Out-String).Trim() -replace ",", ";")
    $wpo = (($wakePost | Out-String).Trim() -replace ",", ";")

    $row = "{0},{1},{2},{3},{4},{5},{6},{7},{8},{9},{10},{11},{12},{13},{14},{15},{16},{17},{18},{19:N1}" -f `
        $c.idx, $tag, $c.arm, ($c.flags -replace " ", ";"), `
        $pre.level, $post.level, $pre.temp, $post.temp, `
        $qPre, $gPre, $qPost, $gPost, $maPre, $maPost, `
        $wp, $wpo, $shaImpl, $shaOcl, $rc, $wall
    Add-Content -Encoding ascii $csv $row
    Write-Host $row
    Get-Content (Join-Path $raw ("cells\{0}.out" -f $tag)) -ErrorAction SilentlyContinue | Write-Host

    if ($c.idx -lt 9) {
        Write-Host "cooldown 90s"
        Start-Sleep -Seconds 90
    }
}
Write-Host "===== PHASE B DONE ====="
Get-Content $csv
