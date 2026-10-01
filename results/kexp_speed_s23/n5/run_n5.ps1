# KEXP N>=5 confirmatory ship session -- queue #18. Protocol v1.2. Lock 618323c.
# DO NOT SIGTERM llama-bench. DO NOT rebuild. DO NOT redeploy ship binaries into s3oracle.
# Arms: A -ngl 99; B -ngl 99 -ncmoe 99; C -ngl 0. ALL: -nr -fa off -t 4. tg512 only.
param([int]$TargetComplete = 5)
$ErrorActionPreference = "Stop"
[System.Threading.Thread]::CurrentThread.CurrentCulture = [Globalization.CultureInfo]::InvariantCulture
[System.Threading.Thread]::CurrentThread.CurrentUICulture = [Globalization.CultureInfo]::InvariantCulture

$N5Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$KexpRoot = Split-Path -Parent $N5Root
$RepoRoot = [IO.Path]::GetFullPath((Join-Path $KexpRoot "..\.."))
$N10Root = Join-Path $RepoRoot "results\olmoe_gpu_moe_s23\n10"
. (Join-Path $N10Root "_lib_n10.ps1")

$LockCommit = "618323c77e45d275746b1aa5df023a0cc6bc6056"
$LockShort = "618323c"
$Protocol = "v1.2"
$PinImplShip = "8adc148c0909e8ebbbf6ed41970b2c07ac0319db96454ad0dd7b2f281a9b8807"
$PinOpenclShip = "f432548328af0429fd0f885ccde70cae69f40666118836c713491602dedd6d6d"
$PinStub = "b2ae0fa6c413a5049a87b0706f2687cd7035ae5e43985fe40779dc0a7d225b2c"
$PinKexpGguf = "b07c80870f8a864549f4a419ccbfb4d4282ba2d55a2e8d808b7c377d3fc6c3f4"
$PinImplStock = "bad179520546f8d5316cd98124e948d025e8acb2999bf92b94977879ce72c171"
$KexpGgufName = "LFM2.5-8B-A1B-KEXP.gguf"
$KexpGgufDev = "/data/local/tmp/$KexpGgufName"
$StockDevDir = "/data/local/tmp/s18stock"
$PcStockImpl = Join-Path $RepoRoot "results\oomwall_s23\staging\stock\libllama-bench-impl.so"
$ReportPath = Join-Path $RepoRoot "scratchpad\agents\kexp-n5-session\REPORT.md"
$ReportN5 = Join-Path $N5Root "REPORT.md"
$CsvPath = Join-Path $N5Root "runs.csv"
$PauseDir = Join-Path $KexpRoot "pauses"
$ProbeDir = Join-Path $N5Root "probes"
$CellDir = Join-Path $N5Root "cells"
$KexpProbeDir = Join-Path $KexpRoot "probes"
$ArmDRoot = Join-Path $N5Root "arm_d"
$LogPath = Join-Path $N5Root "session.log"
$StatePath = Join-Path $N5Root "state.json"
$ShaSums = Join-Path $ProbeDir "SHA256SUMS"
$WifiPin = $null
$COverCapCount = 0
$SessionStopKind = $null
$LiveAdbProc = $null

$WallCapSec = 600
$StallSec = 900

function Log([string]$Msg) {
    $line = "{0} lock={1} {2}" -f (Get-Date).ToString("o"), $LockShort, $Msg
    Write-Host $line
    Add-Content -Path $LogPath -Value $line -Encoding utf8
}

function Fmt3($x) {
    if ($null -eq $x) { return "n/a" }
    return ([double]$x).ToString("F3", [Globalization.CultureInfo]::InvariantCulture)
}

function FmtG($x) {
    if ($null -eq $x) { return "" }
    return ([double]$x).ToString("G17", [Globalization.CultureInfo]::InvariantCulture)
}

function Write-AbortFiles([string]$Kind, [string]$Reason) {
    $body = @"
# KEXP N>=5 $Kind
lock_commit: $LockCommit
protocol: $Protocol
iso: $((Get-Date).ToString("o"))
reason: $Reason
"@
    Set-Content -Path (Join-Path $N5Root "$Kind.md") -Value $body -Encoding utf8
    Log "$Kind $Reason"
}

function Abort-N5([string]$Reason) {
    Write-AbortFiles "ABORT" $Reason
    Update-N5Report -ForceNote $Reason
    throw "KEXP N5 ABORT: $Reason"
}

function Stop-N5([string]$Kind, [string]$Reason) {
    $script:SessionStopKind = $Kind
    Write-AbortFiles $Kind $Reason
    Update-N5Report -ForceNote "$Kind $Reason"
    throw "KEXP N5 $Kind : $Reason"
}

function Add-ProbeSha([string]$Path) {
    if (-not (Test-Path $Path)) { return }
    $h = (Get-FileHash -Algorithm SHA256 $Path).Hash.ToLower()
    $rel = Split-Path $Path -Leaf
    Add-Content -Path $ShaSums -Value ("{0}  {1}" -f $h, $rel) -Encoding ascii
}

function Save-Probe([string]$Name, [string]$Text) {
    $p = Join-Path $ProbeDir $Name
    Set-Content -Path $p -Value $Text -Encoding utf8
    Add-ProbeSha $p
    return $p
}

function Pull-Remote([string]$Remote, [string]$Local, [switch]$BestEffort) {
    $pullOut = & $Adb -s $Serial pull $Remote $Local 2>&1
    $prc = $LASTEXITCODE
    if ($prc -ne 0) {
        if ($BestEffort) { Log "pull best-effort failed $Remote rc=$prc out=$pullOut"; return $false }
        throw "adb pull failed $Remote -> $Local rc=$prc out=$pullOut"
    }
    if (Test-Path $Local) { Add-ProbeSha $Local }
    return $true
}

function AdbSoft([string]$ShellCmd) {
    $o = & $Adb -s $Serial shell $ShellCmd 2>&1
    return ($o | Out-String).Trim()
}

function Assert-UnpluggedN5 {
    $hdr = AdbSoft "dumpsys battery | grep -E '^  (USB|AC|Wireless) powered:'"
    Log "UNPLUG_GATE: $hdr"
    if ($hdr -notmatch "USB powered:\s*false" -or $hdr -notmatch "AC powered:\s*false") {
        Abort-N5 "unplug gate fail (USB/AC): $hdr"
    }
    if ($hdr -match "Wireless powered:\s*true") {
        Abort-N5 "unplug gate fail (Wireless true): $hdr"
    }
    Log "UNPLUG_GATE: PASS (USB=false AC=false Wireless!=true)"
}

function Get-LlamaBenchPids {
    $o = AdbSoft "pidof llama-bench 2>/dev/null || true"
    $o = ($o -replace "`r", "").Trim()
    if ($o -eq "" -or $o -eq "true") { return "" }
    return $o
}

function Test-JsonProp($obj, [string]$Name) {
    return ($null -ne $obj -and $obj.PSObject.Properties.Name -contains $Name -and $null -ne $obj.$Name)
}

function Get-CountedRows {
    if (-not (Test-Path $CsvPath)) { return @() }
    $rows = @(Import-Csv $CsvPath)
    $complete = Get-CompleteBlockIds
    return @($rows | Where-Object {
        $complete -contains [int]$_.block -and
        $_.excluded -ne "True" -and $_.excluded -ne "true" -and
        $_.rc -eq "0"
    })
}

function Get-CompleteBlockIds {
    if (-not (Test-Path $CsvPath)) { return @() }
    $ids = @()
    foreach ($g in (Import-Csv $CsvPath | Group-Object block)) {
        $cells = @($g.Group)
        $ok = @($cells | Where-Object {
            $_.rc -eq "0" -and
            $_.excluded -ne "True" -and $_.excluded -ne "true" -and
            $_.over_cap -ne "True" -and $_.over_cap -ne "true" -and
            $_.tg512 -ne ""
        })
        $order = (@($cells | Sort-Object { [int]$_.cell_in_block } | ForEach-Object { $_.arm }) -join ",")
        if ($cells.Count -eq 6 -and $ok.Count -eq 6 -and $order -eq "A,B,C,C,B,A") { $ids += [int]$g.Name }
    }
    return @($ids | Sort-Object -Unique)
}

function Parse-CellJsonl([string]$Path) {
    if (-not (Test-Path $Path)) { return $null }
    $hits = @()
    Get-Content -Path $Path -ErrorAction SilentlyContinue | ForEach-Object {
        $t = $_.Trim()
        if ($t.StartsWith("{")) {
            try { $hits += ($t | ConvertFrom-Json) } catch { }
        }
    }
    $row = $hits | Where-Object { $_.n_gen -eq 512 -and $_.n_prompt -eq 0 } | Select-Object -Last 1
    if (-not $row) { $row = $hits | Select-Object -Last 1 }
    if (-not $row) { return $null }
    $nr = $null
    if ($row.PSObject.Properties.Name -contains "no_repack") { $nr = $row.no_repack }
    elseif ($row.PSObject.Properties.Name -contains "repack") { $nr = -not [bool]$row.repack }
    return [pscustomobject]@{
        avg_ts = [double]$row.avg_ts
        no_repack = $nr
        n_gpu_layers = $row.n_gpu_layers
        n_cpu_moe = $row.n_cpu_moe
        flash_attn = $row.flash_attn
        n_threads = $row.n_threads
    }
}

function Test-NoRepackTrue($v) {
    if ($null -eq $v) { return $false }
    if ($v -is [bool]) { return $v }
    $s = [string]$v
    return ($s -eq "True" -or $s -eq "true" -or $s -eq "1")
}

function Archive-CellSensors([string]$Tag, [string]$Suffix) {
    $batt = AdbOut "dumpsys battery | grep -E '^  (USB|AC|Wireless) powered:|^  status:|^  level:|^  temperature:|^  Charge counter:'"
    $wake = AdbOut "dumpsys power | grep mWakefulness="
    $mem = AdbOut "grep -E 'MemAvailable|MemFree' /proc/meminfo"
    Save-Probe "${Tag}_${Suffix}_batt.txt" $batt | Out-Null
    Save-Probe "${Tag}_${Suffix}_wake.txt" $wake | Out-Null
    Save-Probe "${Tag}_${Suffix}_mem.txt" $mem | Out-Null
    $s = Get-Sensors
    return $s
}

function Invoke-N5Pins {
    Log "session pins protocol=$Protocol lock=$LockCommit"
    AdbOut "settings put system screen_off_timeout 900000" | Out-Null
    AdbOut "settings put system screen_brightness_mode 0" | Out-Null
    AdbOut "settings put system screen_brightness 128" | Out-Null
    $timeout = (AdbOut "settings get system screen_off_timeout").Trim()
    $bright = (AdbOut "settings get system screen_brightness").Trim()
    $bmode = (AdbOut "settings get system screen_brightness_mode").Trim()
    $wifi = (AdbOut "settings get global wifi_on").Trim()
    $gov = Get-GovernorVector
    if ($timeout -ne "900000") {
        Abort-N5 "screen_off_timeout readback $timeout != 900000"
    }
    if ($bright -ne "128") {
        Log "brightness readback $bright != 128 -- retry mode=0 put 128"
        AdbOut "settings put system screen_brightness_mode 0" | Out-Null
        AdbOut "settings put system screen_brightness 128" | Out-Null
        $bright = (AdbOut "settings get system screen_brightness").Trim()
        if ($bright -ne "128") {
            Abort-N5 "brightness readback $bright != 128 after retry (must be 128 before block 1)"
        }
    }
    $script:WifiPin = $wifi
    $obj = [ordered]@{
        iso = (Get-Date).ToString("o")
        lock_commit = $LockCommit
        protocol = $Protocol
        screen_off_timeout = $timeout
        screen_brightness = $bright
        screen_brightness_mode = $bmode
        wifi_on = $wifi
        governor_at_session_start = $gov
        serial = $Serial
    }
    $json = $obj | ConvertTo-Json -Depth 6
    Set-Content -Path (Join-Path $N5Root "session_pins.json") -Value $json -Encoding utf8
    Save-Probe "session_pins.txt" $json | Out-Null
    Log ("PIN timeout={0} brightness={1} mode={2} wifi_on={3}" -f $timeout, $bright, $bmode, $wifi)
    return $obj
}

function Wait-KexpBatteryPause {
    param([int]$BlockIndex)
    $b = Get-BattHeader
    if ($null -eq $b.level -or $b.level -ge $BatteryFloorPct) { return $null }
    New-Item -ItemType Directory -Force -Path $PauseDir | Out-Null
    $tStart = Get-Date
    $rec = [ordered]@{
        block_index_where_pause = $BlockIndex
        pause_t_start = $tStart.ToString("o")
        level_at_pause = $b.level
        temp_c_at_pause = $b.temp_c
        charge_counter_at_pause = $b.charge_counter
        wifi_on_at_pause = (AdbOut "settings get global wifi_on").Trim()
        lock_commit = $LockCommit
        note = "USB/AC plug allowed ONLY during this pause. Wi-Fi must stay constant. Resume gate is still 40% after unplug; recommended charge >=60%."
    }
    $pauseFile = Join-Path $PauseDir ("pause_block{0:D2}_{1}.json" -f $BlockIndex, $tStart.ToString("yyyyMMdd_HHmmss"))
    ($rec | ConvertTo-Json) | Set-Content -Path $pauseFile -Encoding utf8
    Log "BATTERY FLOOR level=$($b.level) below $BatteryFloorPct -- PAUSE. Plug to charge. Record $pauseFile"
    $sawPlug = $false
    while ($true) {
        Start-Sleep -Seconds 30
        $cur = Get-BattHeader
        $plugged = ($cur.usb -eq "true" -or $cur.ac -eq "true")
        if ($plugged) { $sawPlug = $true }
        $wifiNow = (AdbOut "settings get global wifi_on").Trim()
        Log ("PAUSE poll level={0} plugged={1} usb={2} ac={3} temp_c={4} wifi={5}" -f $cur.level, $plugged, $cur.usb, $cur.ac, $cur.temp_c, $wifiNow)
        if ($null -ne $script:WifiPin -and $wifiNow -ne $script:WifiPin) {
            Abort-N5 "wifi_on changed during pause $wifiNow != pin $($script:WifiPin)"
        }
        if (-not $plugged -and $null -ne $cur.level -and $cur.level -ge $BatteryFloorPct) {
            if ($sawPlug -and $cur.level -lt $BatteryResumeTargetPct) {
                Log "PAUSE unplugged at $($cur.level)% (gate 40% PASS; recommended 60% not reached)"
            }
            $tEnd = Get-Date
            $rec.pause_t_end = $tEnd.ToString("o")
            $rec.level_at_resume = $cur.level
            $rec.temp_c_at_resume = $cur.temp_c
            $rec.charge_counter_at_resume = $cur.charge_counter
            $rec.saw_plug = $sawPlug
            $rec.wifi_on_at_resume = $wifiNow
            ($rec | ConvertTo-Json) | Set-Content -Path $pauseFile -Encoding utf8
            Log "PAUSE end. Fresh unplug gate next."
            return [pscustomobject]$rec
        }
    }
}

function Assert-WifiHeld {
    $w = (AdbOut "settings get global wifi_on").Trim()
    if ($null -ne $script:WifiPin -and $w -ne $script:WifiPin) {
        Abort-N5 "wifi_on $w != session pin $($script:WifiPin)"
    }
}

function Assert-ShipShas([string]$When) {
    $impl = Get-OnDeviceSha "libllama-bench-impl.so"
    $ocl = Get-OnDeviceSha "libggml-opencl.so"
    $stub = Get-OnDeviceSha "llama-bench"
    Log "SHA $When impl=$($impl.sha) opencl=$($ocl.sha) stub=$($stub.sha)"
    if ($impl.sha -eq $PinImplStock) { Abort-N5 "stock extra_bufts on s3oracle at $When -- FORBIDDEN on A/B/C" }
    if ($impl.sha -ne $PinImplShip) { Abort-N5 "impl sha at $When $($impl.sha) != $PinImplShip (NO redeploy)" }
    if ($ocl.sha -ne $PinOpenclShip) { Abort-N5 "opencl sha at $When $($ocl.sha) != $PinOpenclShip (NO redeploy)" }
    if ($stub.sha -ne $PinStub) { Abort-N5 "stub sha at $When $($stub.sha) != $PinStub (NO redeploy)" }
    return [pscustomobject]@{ impl = $impl; opencl = $ocl; stub = $stub }
}

function Read-DeviceRc([string]$Tag, [string]$Dir = $DevDir) {
    $line = AdbSoft "cat ${Dir}/logs/${Tag}.rc 2>/dev/null || echo NOTYET"
    $line = ($line -replace "`r", "").Trim()
    if ($line -eq "NOTYET" -or $line -eq "") { return $null }
    if ($line -match '^(\d+)') { return $Matches[1] }
    return $null
}

function Invoke-CellNaturalExit {
    param([string]$Tag, [string]$Extra, [string]$Launcher = "$DevDir/launch_bg.sh", [string]$LogDir = $DevDir)
    $alive0 = Get-LlamaBenchPids
    if ($alive0) {
        Stop-N5 "STOP" "llama-bench already running (pids=$alive0) -- refuse launch $Tag (no SIGTERM)"
    }
    $launchCmd = "sh $Launcher $Tag $Extra"
    Log "LAUNCH_DETACH $launchCmd"
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $wrap = AdbSoft $launchCmd
    Log "LAUNCH_DETACH wrapper=$wrap"
    Start-Sleep -Seconds 2
    $rcEarly = Read-DeviceRc $Tag $LogDir
    $alive = Get-LlamaBenchPids
    if (-not $rcEarly -and -not $alive) {
        Abort-N5 "detached launch failed for $Tag (no pid, no rc). wrapper=$wrap"
    }
    $stall = $false
    $devRc = $rcEarly
    while ($null -eq $devRc) {
        Start-Sleep -Milliseconds 500
        $devRc = Read-DeviceRc $Tag $LogDir
        if ($null -ne $devRc) { break }
        if ($sw.Elapsed.TotalSeconds -ge $StallSec) {
            $devRc = Read-DeviceRc $Tag $LogDir
            if ($null -ne $devRc) { break }
            $stall = $true
            break
        }
    }
    $wall = $sw.Elapsed.TotalSeconds
    $adbRc = if ($stall) { "RUNNING" } else { 0 }
    # NEVER Kill / Stop-Process / killall / SIGTERM.
    return [pscustomobject]@{
        stall = $stall
        wall_s = $wall
        adb_rc = $adbRc
        device_rc = $devRc
        over_cap = ($wall -ge $WallCapSec)
        wrapper = $wrap
        pids = (Get-LlamaBenchPids)
    }
}

function Archive-StallHealth([string]$Tag) {
    try {
        $ps = AdbOut "ps -A | grep -E 'llama-bench|PID' || true"
        Save-Probe "${Tag}_stall_ps.txt" $ps | Out-Null
    } catch { Log "stall ps failed $($_.Exception.Message)" }
    try {
        $kg = AdbOut "cat /sys/class/kgsl/kgsl-3d0/gpubusy 2>/dev/null || echo NO_KGSL"
        Save-Probe "${Tag}_stall_kgsl.txt" $kg | Out-Null
    } catch { Log "stall kgsl failed $($_.Exception.Message)" }
    Pull-Remote "$DevDir/logs/$Tag.out" (Join-Path $ProbeDir "$Tag.stall.out") -BestEffort | Out-Null
    Pull-Remote "$DevDir/logs/$Tag.err" (Join-Path $ProbeDir "$Tag.stall.err") -BestEffort | Out-Null
    Pull-Remote "$DevDir/logs/${Tag}.rc" (Join-Path $ProbeDir "$Tag.stall.rc") -BestEffort | Out-Null
}

function Update-N5Report {
    param([string]$ForceNote = "")
    New-Item -ItemType Directory -Force -Path (Split-Path $ReportPath) | Out-Null
    $rows = @()
    if (Test-Path $CsvPath) { $rows = @(Import-Csv $CsvPath) }
    $complete = @(Get-CompleteBlockIds)
    $counted = @(Get-CountedRows)
    $a = @($counted | Where-Object { $_.arm -eq "A" } | ForEach-Object { [double]$_.tg512 })
    $b = @($counted | Where-Object { $_.arm -eq "B" } | ForEach-Object { [double]$_.tg512 })
    $c = @($counted | Where-Object { $_.arm -eq "C" } | ForEach-Object { [double]$_.tg512 })
    $tA = @($counted | Where-Object { $_.arm -eq "A" -and $_.temp_peak -ne "" } | ForEach-Object { [double]$_.temp_peak })
    $tB = @($counted | Where-Object { $_.arm -eq "B" -and $_.temp_peak -ne "" } | ForEach-Object { [double]$_.temp_peak })
    $tC = @($counted | Where-Object { $_.arm -eq "C" -and $_.temp_peak -ne "" } | ForEach-Object { [double]$_.temp_peak })
    $medA = Get-Median $a
    $medB = Get-Median $b
    $medC = Get-Median $c
    $medTA = Get-Median $tA
    $medTB = Get-Median $tB
    $medTC = Get-Median $tC
    $ratioAB = if ($medA -and $medB -and $medB -ne 0) { $medA / $medB } else { $null }
    $ratioAC = if ($medA -and $medC -and $medC -ne 0) { $medA / $medC } else { $null }
    $coolIds = @()
    foreach ($bid in $complete) {
        $h = @($rows | Where-Object { [int]$_.block -eq $bid } | Select-Object -First 1)
        if ($h.Count -gt 0 -and ($h[0].warm_start -eq "False" -or $h[0].warm_start -eq "false")) { $coolIds += $bid }
    }
    $coolRows = @($counted | Where-Object { $coolIds -contains [int]$_.block })
    $cA = @($coolRows | Where-Object { $_.arm -eq "A" } | ForEach-Object { [double]$_.tg512 })
    $cB = @($coolRows | Where-Object { $_.arm -eq "B" } | ForEach-Object { [double]$_.tg512 })
    $cC = @($coolRows | Where-Object { $_.arm -eq "C" } | ForEach-Object { [double]$_.tg512 })
    $cMedA = Get-Median $cA
    $cMedB = Get-Median $cB
    $cMedC = Get-Median $cC
    $cRatioAB = if ($cMedA -and $cMedB -and $cMedB -ne 0) { $cMedA / $cMedB } else { $null }
    $cRatioAC = if ($cMedA -and $cMedC -and $cMedC -ne 0) { $cMedA / $cMedC } else { $null }
    $lines = @()
    foreach ($bid in ($rows | ForEach-Object { [int]$_.block } | Sort-Object -Unique)) {
        $cs = @($rows | Where-Object { [int]$_.block -eq $bid } | Sort-Object { [int]$_.cell_in_block })
        if ($cs.Count -eq 0) { continue }
        $h = $cs[0]
        $st = if ($complete -contains $bid) { "COMPLETE" } else { "INCOMPLETE" }
        $tgs = ($cs | ForEach-Object {
            $mark = if ($_.excluded -eq "True" -or $_.excluded -eq "true") { "*" } else { "" }
            "{0}{1}:{2}" -f $_.arm, $mark, $_.tg512
        }) -join " "
        $decay = ""
        $aCells = @($cs | Where-Object { $_.arm -eq "A" -and $_.tg512 -ne "" } | Sort-Object { [int]$_.cell_in_block })
        if ($aCells.Count -ge 2) {
            $a1 = [double]$aCells[0].tg512
            $a2 = [double]$aCells[-1].tg512
            if ($a1 -ne 0) { $decay = Fmt3((($a1 - $a2) / $a1) * 100.0) + "%" }
        }
        $meanAB = ""
        $aMean = @($cs | Where-Object { $_.arm -eq "A" -and $_.tg512 -ne "" -and $_.excluded -ne "True" -and $_.excluded -ne "true" } | ForEach-Object { [double]$_.tg512 })
        $bMean = @($cs | Where-Object { $_.arm -eq "B" -and $_.tg512 -ne "" -and $_.excluded -ne "True" -and $_.excluded -ne "true" } | ForEach-Object { [double]$_.tg512 })
        if ($aMean.Count -ge 1 -and $bMean.Count -ge 1) {
            $am = ($aMean | Measure-Object -Average).Average
            $bm = ($bMean | Measure-Object -Average).Average
            if ($bm -ne 0) { $meanAB = Fmt3($am / $bm) }
        }
        $lines += ("| {0} | {1} | {2} | {3} | {4} | {5} | {6} | {7} | {8} |" -f $bid, $st, $h.temp_c_block_start, $h.warm_start, $h.level_pre, $tgs, $decay, $meanAB, $h.governor)
    }
    $floorAB = "n/a"
    $floorAC = "n/a"
    $tempGate = "n/a"
    $interp = ""
    if ($null -ne $ratioAB) {
        $floorAB = if ($ratioAB -ge 1.50) { "PASS" } else { "FAIL" }
        if ($ratioAB -ge 1.40 -and $ratioAB -lt 1.50 -and $coolIds.Count -ge 3 -and $null -ne $cRatioAB -and $cRatioAB -ge 1.50) {
            $interp = "interpretive rule F6: report, re-run with cooldown emphasis"
        }
    }
    if ($null -ne $ratioAC) { $floorAC = if ($ratioAC -ge 1.20) { "PASS" } else { "FAIL" } }
    if ($null -ne $medTA -and $null -ne $medTB) {
        $tempGate = if ($medTA -le ($medTB + 0.5)) { "PASS" } else { "FAIL" }
    }
    $flags = @()
    $flags += "lock_commit=$LockCommit"
    $flags += "protocol=$Protocol"
    $flags += "complete_blocks=$($complete.Count)/$TargetComplete"
    $flags += "cool_start_complete=$($coolIds.Count)"
    $flags += "C_over_cap=$COverCapCount"
    if ($ForceNote) { $flags += "NOTE: $ForceNote" }
    $section = @"
# KEXP N>=5 session -- queue #18

**Lock commit:** ``$LockCommit`` (``$LockShort``). Protocol **$Protocol**. Criterion 11.

Ship arms (same s3oracle binaries, **NO rebuild / NO redeploy**): A ``-ngl 99``, B ``-ngl 99 -ncmoe 99``, C ``-ngl 0``. ALL ``-nr -fa off -t 4``. tg512 ``-p 0 -n 512 -r 1 -o jsonl``. Palindrome ABC-CBA. Pins: impl ``8adc148c...``, opencl ``f4325483...``, stub ``b2ae0fa6...``, GGUF ``b07c8087...``.

## Running medians (complete blocks only; full precision; display 3 dp; no pre-rounding)

| set | nA | nB | nC | med A | med B | med C | A/B | A/C | med peakT A | med peakT B | med peakT C |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| all complete (primary) | $($a.Count) | $($b.Count) | $($c.Count) | $(Fmt3 $medA) | $(Fmt3 $medB) | $(Fmt3 $medC) | $(Fmt3 $ratioAB) | $(Fmt3 $ratioAC) | $(Fmt3 $medTA) | $(Fmt3 $medTB) | $(Fmt3 $medTC) |
| cool-start only (secondary) | $($cA.Count) | $($cB.Count) | $($cC.Count) | $(Fmt3 $cMedA) | $(Fmt3 $cMedB) | $(Fmt3 $cMedC) | $(Fmt3 $cRatioAB) | $(Fmt3 $cRatioAC) |  |  |  |

Floor checks (unrounded): A/B>=1.50 **$floorAB** ; A/C>=1.20 **$floorAC** ; peakT A <= B+0.5C **$tempGate**. $interp

A-decay is pre-declared: second-A cells are **never** dropped from complete blocks.

## Blocks

| block | status | temp_c_block_start | warm_start | level_pre | tg512 (*excluded) | A-decay | mean(A)/mean(B) | governor |
|---:|---|---:|---|---:|---|---:|---:|---|
$($lines -join "`n")

## Flags

$($flags | ForEach-Object { "- $_" } | Out-String)
Raw: ``results/kexp_speed_s23/n5/runs.csv``  probes: ``results/kexp_speed_s23/n5/probes/``  pauses: ``results/kexp_speed_s23/pauses/``
"@
    Set-Content -Path $ReportPath -Value $section -Encoding utf8
    Set-Content -Path $ReportN5 -Value $section -Encoding utf8
}

function Append-CellRow($row) {
    $row | Export-Csv -Path $CsvPath -Append -NoTypeInformation -Encoding utf8
}

function Get-ArmSpec([string]$Arm) {
    switch ($Arm) {
        "A" { return [pscustomobject]@{ extra = "-ngl 99"; experts = "GPU"; ngl = 99 } }
        "B" { return [pscustomobject]@{ extra = "-ngl 99 -ncmoe 99"; experts = "CPU"; ngl = 99 } }
        "C" { return [pscustomobject]@{ extra = "-ngl 0"; experts = "NGL0"; ngl = 0 } }
        default { throw "bad arm $Arm" }
    }
}

# --- session start ---
New-Item -ItemType Directory -Force -Path $N5Root, $CellDir, $ProbeDir, $PauseDir, $KexpProbeDir, (Split-Path $ReportPath) | Out-Null
if (-not (Test-Path $LogPath)) { Set-Content -Path $LogPath -Value "" -Encoding utf8 }
if (-not (Test-Path $ShaSums)) { Set-Content -Path $ShaSums -Value "" -Encoding ascii }

foreach ($term in @("ABORT.md", "STOP.md", "AMEND.md")) {
    $tp = Join-Path $N5Root $term
    if (Test-Path $tp) {
        throw "REFUSE: $tp exists. N>=5 session is OVER. Resumption requires a written protocol amendment (lock $LockCommit). Do not stitch."
    }
}

Assert-UsbS23
Log "KEXP N>=5 START TargetComplete=$TargetComplete serial=$Serial lock=$LockCommit protocol=$Protocol"
$devs = (& $Adb devices | Out-String)
Save-Probe "adb_devices.txt" $devs | Out-Null
Set-Content -Path (Join-Path $N5Root "lock_commit.txt") -Value $LockCommit -Encoding ascii

# Wrapper scripts only (not ship binaries).
Invoke-S23 @("push", (Join-Path $N5Root "one_cell_n5.sh"), "$DevDir/one_cell_n5.sh")
Invoke-S23 @("push", (Join-Path $N5Root "dump_env.sh"), "$DevDir/dump_env.sh")
Invoke-S23 @("push", (Join-Path $N5Root "launch_bg.sh"), "$DevDir/launch_bg.sh")
AdbOut "chmod 755 $DevDir/one_cell_n5.sh $DevDir/dump_env.sh $DevDir/launch_bg.sh" | Out-Null
AdbOut "mkdir -p $DevDir/logs" | Out-Null

# LOG_ALLOC unset evidence: RAW dump BEFORE any unset (prereg).
$envDump = AdbOut "sh $DevDir/dump_env.sh"
$rawPart = $envDump
$splitAt = $envDump.IndexOf("AFTER cell-matching unsets")
if ($splitAt -ge 0) { $rawPart = $envDump.Substring(0, $splitAt) }
$envPathN5 = Save-Probe "log_alloc_unset.env.txt" $envDump
$envPathKexp = Join-Path $KexpProbeDir "log_alloc_unset.env.txt"
Set-Content -Path $envPathKexp -Value $envDump -Encoding utf8
Save-Probe "log_alloc_unset.raw.txt" $rawPart | Out-Null
Set-Content -Path (Join-Path $KexpProbeDir "log_alloc_unset.raw.txt") -Value $rawPart -Encoding utf8
if ($rawPart -match "(?m)^GGML_OPENCL_LOG_ALLOC=") {
    Abort-N5 "GGML_OPENCL_LOG_ALLOC is SET in RAW env dump -- must be unset"
}
Log "LOG_ALLOC-unset RAW evidenced at $envPathN5 and $envPathKexp"

# Frozen on-device pins -- verify, never push .so / llama-bench.
$shaStart = Assert-ShipShas "session-start"
$ggufLine = AdbOut "sha256sum $KexpGgufDev"
Log "KEXP GGUF $ggufLine"
$ggufSha = (($ggufLine -split "\s+")[0]).ToLower()
if ($ggufSha -ne $PinKexpGguf) { Abort-N5 "KEXP gguf sha $ggufSha != $PinKexpGguf" }
$shaBlock = AdbOut "cd $DevDir && sha256sum llama-bench libllama-bench-impl.so libllama.so libggml-opencl.so libggml.so libggml-base.so libggml-cpu.so libllama-common.so"
Log "SHA_BLOCK`n$shaBlock"
$shaStartTxt = "$shaBlock`n$ggufLine`nlock=$LockCommit"
Set-Content -Path (Join-Path $N5Root "sha_session_start.txt") -Value $shaStartTxt -Encoding utf8
Save-Probe "sha_session_start.txt" $shaStartTxt | Out-Null

@"
# KEXP N>=5 queue #18 MANIFEST

Lock commit: ``$LockCommit`` (``$LockShort``). Protocol $Protocol.
Date: $((Get-Date).ToString("o"))
Serial: ``$Serial``

## Pins (on-device, verified at session start; NOT pushed this session)

| artifact | sha256 |
|---|---|
| libllama-bench-impl.so | $PinImplShip |
| libggml-opencl.so | $PinOpenclShip |
| llama-bench stub | $PinStub |
| LFM2.5-8B-A1B-KEXP.gguf | $PinKexpGguf |

Stock extra_bufts ``$PinImplStock`` is **forbidden** on A/B/C. Optional arm D uses a **separate** dir ``$StockDevDir``.

Flags: A ``-ngl 99``, B ``-ngl 99 -ncmoe 99``, C ``-ngl 0``; ALL ``-nr -fa off -t 4``; tg512 ``-p 0 -n 512 -r 1 -o jsonl``.
Block: ABC-CBA. Cooldown 35.0C / 10 min warm-start. Battery floor 40% pauses under ``results/kexp_speed_s23/pauses/``.
Cell cap 10 min = exclude/wait; 15 min = STOP. NEVER SIGTERM. MemAvailable drop >= 2.0 GB / rc!=0 / adb 255 / power-off = abort A/B/C.
"@ | Set-Content -Path (Join-Path $N5Root "MANIFEST.md") -Encoding utf8

$pins = Invoke-N5Pins
$openPause = $null
if (Test-Path $PauseDir) {
    $openPause = @(Get-ChildItem $PauseDir -Filter "pause_*.json" -ErrorAction SilentlyContinue | Where-Object {
        (Get-Content $_.FullName -Raw) -notmatch "pause_t_end"
    })
}
if ($openPause -and $openPause.Count -gt 0) {
    Log "open pause file $($openPause[0].Name) -- skip session-start unplug; resume pause loop"
    Wait-KexpBatteryPause -BlockIndex 0 | Out-Null
    Assert-UnpluggedN5
} else {
    Assert-UnpluggedN5
}
Update-N5Report

$arms = @("A", "B", "C", "C", "B", "A")
$block = 1
$seq = 0
$resumeCi = 0
if (Test-Path $CsvPath) {
    $existing = @(Import-Csv $CsvPath)
    if ($existing.Count -gt 0) {
        $seq = [int](($existing | Measure-Object seq_global -Maximum).Maximum)
        $maxBlock = [int](($existing | Measure-Object block -Maximum).Maximum)
        $lastBlockRows = @($existing | Where-Object { [int]$_.block -eq $maxBlock } | Sort-Object { [int]$_.cell_in_block })
        if ($lastBlockRows.Count -ge 6) {
            $block = $maxBlock + 1
            $resumeCi = 0
        } else {
            $block = $maxBlock
            $resumeCi = $lastBlockRows.Count
        }
        $script:COverCapCount = @($existing | Where-Object {
            $_.arm -eq "C" -and ($_.over_cap -eq "True" -or $_.over_cap -eq "true")
        }).Count
        Log "RESUME csv rows=$($existing.Count) block=$block resume_ci=$resumeCi seq=$seq C_over_cap=$COverCapCount"
    }
}

try {
while ($true) {
    $done = (Get-CompleteBlockIds).Count
    if ($done -ge $TargetComplete) { break }

    Log "=== BLOCK $block (complete=$done/$TargetComplete) lock=$LockCommit resume_ci=$resumeCi ==="
    Assert-WifiHeld
    $metaPath = Join-Path $N5Root ("block_{0:D2}_meta.json" -f $block)
    if ($resumeCi -gt 0) {
        if (-not (Test-Path $metaPath)) {
            Log "MID-BLOCK RESUME without meta -- do not cooldown mid-palindrome; drop block $block as incomplete"
            $resumeCi = 0
            $block++
            continue
        }
        Log "MID-BLOCK RESUME -- reuse $metaPath (no extra cooldown; palindrome must not be split by a new gate)"
        Assert-UnpluggedN5
        $metaObj = Get-Content $metaPath -Raw | ConvertFrom-Json
        $cool = [pscustomobject]@{
            warm_start = [bool]([System.Convert]::ToBoolean($metaObj.warm_start))
            temp_c_block_start = $metaObj.temp_c_block_start
            cooldown_s = $metaObj.cooldown_s
        }
        $gov = [string]$metaObj.governor
        $batt = Get-BattHeader
        if ($batt.level -lt 40) {
            Log "MID-BLOCK RESUME level=$($batt.level) below 40 -- finish remaining cells then pause (not abort)"
        }
    } else {
        $cool = Invoke-CooldownGate
        Assert-UnpluggedN5
        $pause = Wait-KexpBatteryPause -BlockIndex $block
        if ($pause) {
            Assert-UnpluggedN5
            $cool = Invoke-CooldownGate
            Assert-UnpluggedN5
            Assert-WifiHeld
        }
        $batt = Get-BattHeader
        if ($batt.level -lt 40) { Abort-N5 "battery floor at block $block level=$($batt.level)" }
        $gov = ((Get-GovernorVector) -replace "`r", "" -replace "`n", "; ")
        Log "GOVERNOR $gov temp_start=$($cool.temp_c_block_start) warm=$($cool.warm_start) level=$($batt.level)"
        Save-Probe ("block_{0:D2}_governor.txt" -f $block) $gov | Out-Null
        Save-Probe ("block_{0:D2}_unplug.txt" -f $block) $batt.raw | Out-Null

        $blockMeta = [ordered]@{
            iso = (Get-Date).ToString("o")
            lock_commit = $LockCommit
            protocol = $Protocol
            block = $block
            temp_c_block_start = $cool.temp_c_block_start
            warm_start = [bool]$cool.warm_start
            cooldown_s = $cool.cooldown_s
            level_pre = $batt.level
            governor = $gov
            unplug = $batt.raw
            usb = $batt.usb
            ac = $batt.ac
        }
        Write-JsonFile $metaPath $blockMeta
    }

    $cellOk = 0
    for ($ci = $resumeCi; $ci -lt 6; $ci++) {
        $arm = $arms[$ci]
        $spec = Get-ArmSpec $arm
        $seq++
        $tag = "k_b{0:D2}_c{1}_{2}" -f $block, ($ci + 1), $arm
        Log "=== $tag $($spec.extra) ==="

        $shas = Assert-ShipShas $tag
        Save-Probe "${tag}_sha.txt" ("{0}`n{1}`n{2}" -f $shas.impl.line, $shas.opencl.line, $shas.stub.line) | Out-Null
        Assert-WifiHeld

        $excluded = $false
        $exclReason = ""
        $tg = ""
        $nrStr = ""
        $rc = "NA"
        $wallS = ""
        $overCap = $false
        $pre = $null
        $post = $null
        $outLog = Join-Path $CellDir "$tag.stdout.txt"

        $pre = Archive-CellSensors $tag "PRE"
        AdbSoft "input keyevent KEYCODE_WAKEUP" | Out-Null
        Start-Sleep -Milliseconds 400
        $wakeLine = AdbSoft "dumpsys power | grep mWakefulness="
        Save-Probe "${tag}_wake_prelaunch.txt" $wakeLine | Out-Null
        if (-not (Test-WakeAwake $wakeLine)) {
            $excluded = $true
            $exclReason = "wake_not_awake:$wakeLine"
            Log "EXCLUDE $tag $exclReason"
            $post = $pre
        } else {
            $run = Invoke-CellNaturalExit -Tag $tag -Extra $spec.extra
            $wallS = FmtG $run.wall_s
            $overCap = [bool]$run.over_cap
            Log "RETURN $tag stall=$($run.stall) wall_s=$($run.wall_s) adb_rc=$($run.adb_rc) device_rc=$($run.device_rc) over_cap=$overCap"

            if ($run.stall) {
                Archive-StallHealth $tag
                $rowStall = [pscustomobject]@{
                    block = $block; cell_in_block = ($ci + 1); seq_global = $seq
                    arm = $arm; experts = $spec.experts; ngl = $spec.ngl; p = 0; n = 512
                    rc = "RUNNING"; stdout_file = ""
                    excluded = $true; exclude_reason = "stall_15min"
                    level_pre = $pre.level; temp_c_pre = $pre.temp_c; wake_pre = $wakeLine
                    mem_avail_pre = $pre.mem_available_kb; mem_free_pre = $pre.mem_free_kb
                    level_post = ""; temp_c_post = ""; wake_post = ""
                    mem_avail_post = ""; mem_free_post = ""
                    iso_pre = $pre.iso; iso_post = ""; tg512 = ""; temp_peak = ""
                    temp_c_block_start = $cool.temp_c_block_start; warm_start = $cool.warm_start
                    governor = $gov; sha_impl = $shas.impl.sha; sha_opencl = $shas.opencl.sha
                    label = "kexp_n5_q18"; no_repack = ""; wall_s = $wallS; over_cap = $true
                    sha_stub = $shas.stub.sha
                }
                Append-CellRow $rowStall
                Stop-N5 "STOP" "15 min stall on $tag (leave process; no SIGTERM). wall_s=$($run.wall_s) pids=$($run.pids)"
            }

            if ([string]$run.adb_rc -eq "255") { Abort-N5 "adb 255 on $tag" }

            $pulledOut = Join-Path $ProbeDir "$tag.out"
            $pulledErr = Join-Path $ProbeDir "$tag.err"
            $pulledRc = Join-Path $ProbeDir "$tag.rc"
            Pull-Remote "$DevDir/logs/$tag.out" $pulledOut
            Pull-Remote "$DevDir/logs/$tag.err" $pulledErr -BestEffort | Out-Null
            Pull-Remote "$DevDir/logs/$tag.rc" $pulledRc
            if (Test-Path $pulledOut) { Copy-Item $pulledOut $outLog -Force }

            $rcTxt = "MISSING"
            if (Test-Path $pulledRc) { $rcTxt = ((Get-Content $pulledRc -Raw).Trim()) }
            $rc = $rcTxt
            Log "DEVICE_RC $tag rc=$rc"

            try { $post = Archive-CellSensors $tag "POST" } catch { Abort-N5 "sensors failed after $tag rc=$rc -- possible power-off" }

            if ($rc -eq "MISSING" -or $rc -eq "") { Abort-N5 "missing device rc file after $tag" }
            if ($rc -ne "0") { Abort-N5 "llama-bench rc=$rc on $tag (wall-class; rule 3)" }

            $drop = [int64]$pre.mem_available_kb - [int64]$post.mem_available_kb
            Log "MemAvailable drop_kb=$drop (cliff=$MemCliffKb)"
            if ($drop -ge $MemCliffKb) { Abort-N5 "oomwall-class MemAvailable drop $drop kB on $tag" }

            if (-not (Test-WakeAwake $post.wake)) {
                $excluded = $true
                $exclReason = "wake_post_not_awake:$($post.wake)"
                Log "EXCLUDE $tag $exclReason"
            }

            if ($overCap) {
                $excluded = $true
                if ($exclReason) { $exclReason = "$exclReason;over_cap_10min" } else { $exclReason = "over_cap_10min" }
                Log "EXCLUDE $tag over_cap wall_s=$($run.wall_s) (keep jsonl, no SIGTERM)"
                if ($arm -eq "C") {
                    $script:COverCapCount++
                    if ($COverCapCount -ge 2) {
                        $parsedOC = Parse-CellJsonl $outLog
                        if ($parsedOC) { $tg = FmtG $parsedOC.avg_ts; $nrStr = [string]$parsedOC.no_repack }
                        $peakOC = ""
                        if ($pre.temp_c -ne "" -and $post.temp_c -ne "") { $peakOC = [math]::Max([double]$pre.temp_c, [double]$post.temp_c) }
                        $rowOC = [pscustomobject]@{
                            block = $block; cell_in_block = ($ci + 1); seq_global = $seq
                            arm = $arm; experts = $spec.experts; ngl = $spec.ngl; p = 0; n = 512
                            rc = $rc; stdout_file = (Split-Path $outLog -Leaf)
                            excluded = $true; exclude_reason = $exclReason
                            level_pre = $pre.level; temp_c_pre = $pre.temp_c; wake_pre = $pre.wake
                            mem_avail_pre = $pre.mem_available_kb; mem_free_pre = $pre.mem_free_kb
                            level_post = $post.level; temp_c_post = $post.temp_c; wake_post = $post.wake
                            mem_avail_post = $post.mem_available_kb; mem_free_post = $post.mem_free_kb
                            iso_pre = $pre.iso; iso_post = $post.iso; tg512 = $tg; temp_peak = $peakOC
                            temp_c_block_start = $cool.temp_c_block_start; warm_start = $cool.warm_start
                            governor = $gov; sha_impl = $shas.impl.sha; sha_opencl = $shas.opencl.sha
                            label = "kexp_n5_q18"; no_repack = $nrStr; wall_s = $wallS; over_cap = $true
                            sha_stub = $shas.stub.sha
                        }
                        Append-CellRow $rowOC
                        Stop-N5 "AMEND" ">=2 C cells wall>=10 min (COverCap=$COverCapCount). Do not drop C. Written amendment required."
                    }
                }
            }

            $parsed = Parse-CellJsonl $outLog
            if ($null -eq $parsed) {
                if ($excluded) {
                    Log "no jsonl on excluded $tag (allowed)"
                } else {
                    Abort-N5 "no tg512 jsonl in $outLog"
                }
            } else {
                if (-not $excluded) {
                    foreach ($need in @("no_repack", "n_threads", "flash_attn", "n_gpu_layers", "n_cpu_moe", "avg_ts")) {
                        if (-not (Test-JsonProp $parsed $need)) { Abort-N5 "jsonl missing $need on $tag" }
                    }
                    if (-not (Test-NoRepackTrue $parsed.no_repack)) {
                        Abort-N5 "no_repack=$($parsed.no_repack) on $tag -- -nr/--repack 0 mandatory on A/B/C"
                    }
                    if ([int]$parsed.n_threads -ne 4) { Abort-N5 "n_threads=$($parsed.n_threads) != 4 on $tag" }
                    if ([int]$parsed.flash_attn -ne 0) { Abort-N5 "flash_attn=$($parsed.flash_attn) != 0 on $tag" }
                    if ($arm -eq "A") {
                        if ([int]$parsed.n_gpu_layers -ne 99) { Abort-N5 "A n_gpu_layers=$($parsed.n_gpu_layers) != 99" }
                        if ([int]$parsed.n_cpu_moe -ne 0) { Abort-N5 "A n_cpu_moe=$($parsed.n_cpu_moe) != 0" }
                    }
                    if ($arm -eq "B") {
                        if ([int]$parsed.n_gpu_layers -ne 99) { Abort-N5 "B n_gpu_layers=$($parsed.n_gpu_layers) != 99" }
                        if ([int]$parsed.n_cpu_moe -ne 99) { Abort-N5 "B n_cpu_moe=$($parsed.n_cpu_moe) != 99" }
                    }
                    if ($arm -eq "C") {
                        if ([int]$parsed.n_gpu_layers -ne 0) { Abort-N5 "C n_gpu_layers=$($parsed.n_gpu_layers) != 0" }
                    }
                    $tg = FmtG $parsed.avg_ts
                    $nrStr = ([string]$parsed.no_repack).ToLower()
                    if ($nrStr -eq "true") { $nrStr = "true" }
                    $cellOk++
                } else {
                    $tg = FmtG $parsed.avg_ts
                    $nrStr = [string]$parsed.no_repack
                }
            }
        }

        $peak = ""
        if ($pre -and $post -and $pre.temp_c -ne "" -and $post.temp_c -ne "") {
            $peak = [math]::Max([double]$pre.temp_c, [double]$post.temp_c)
        }
        $row = [pscustomobject]@{
            block = $block; cell_in_block = ($ci + 1); seq_global = $seq
            arm = $arm; experts = $spec.experts; ngl = $spec.ngl; p = 0; n = 512
            rc = $rc; stdout_file = (Split-Path $outLog -Leaf)
            excluded = $excluded; exclude_reason = $exclReason
            level_pre = $pre.level; temp_c_pre = $pre.temp_c; wake_pre = $pre.wake
            mem_avail_pre = $pre.mem_available_kb; mem_free_pre = $pre.mem_free_kb
            level_post = $post.level; temp_c_post = $post.temp_c; wake_post = $post.wake
            mem_avail_post = $post.mem_available_kb; mem_free_post = $post.mem_free_kb
            iso_pre = $pre.iso; iso_post = $post.iso; tg512 = $tg; temp_peak = $peak
            temp_c_block_start = $cool.temp_c_block_start; warm_start = $cool.warm_start
            governor = $gov; sha_impl = $shas.impl.sha; sha_opencl = $shas.opencl.sha
            label = "kexp_n5_q18"; no_repack = $nrStr; wall_s = $wallS; over_cap = $overCap
            sha_stub = $shas.stub.sha
        }
        Append-CellRow $row
        Update-N5Report
        Start-Sleep -Seconds 2
    }

    $resumeCi = 0
    Log "BLOCK $block cellOk=$cellOk complete_now=$((Get-CompleteBlockIds).Count)"
    $st = @{
        last_block = $block
        complete_ids = @(Get-CompleteBlockIds)
        iso = (Get-Date).ToString("o")
        lock_commit = $LockCommit
        C_over_cap = $COverCapCount
    }
    Write-JsonFile $StatePath $st
    Update-N5Report
    $block++
}

Log "N>=5 bag complete=$((Get-CompleteBlockIds).Count) lock=$LockCommit"
Update-N5Report

# --- optional arm D after the bag; NEVER ship; cannot touch N>=5 files on wall ---
function Abort-D([string]$Reason) {
    New-Item -ItemType Directory -Force -Path $ArmDRoot | Out-Null
    @"
# ARM D ABORT (ship N>=5 dataset UNTOUCHED)
lock_commit: $LockCommit
iso: $((Get-Date).ToString("o"))
reason: $Reason
"@ | Set-Content -Path (Join-Path $ArmDRoot "D_ABORT.md") -Encoding utf8
    Log "ARM D ABORT $Reason (s3oracle left as-is; N>=5 untouched)"
    throw "ARM D ABORT: $Reason"
}

$nComplete = (Get-CompleteBlockIds).Count
if ($nComplete -lt $TargetComplete) {
    Log "skip arm D -- complete=$nComplete below $TargetComplete"
} else {
    $battD = Get-BattHeader
    if ($battD.level -lt 40) {
        Log "skip arm D -- battery $($battD.level) below 40 (optional probe)"
        Set-Content -Path (Join-Path $N5Root "ARM_D_SKIPPED.md") -Value "battery $($battD.level) below 40 after bag. lock=$LockCommit" -Encoding utf8
    } elseif (-not (Test-Path $PcStockImpl)) {
        Abort-D "missing $PcStockImpl"
    } else {
        $hStock = (Get-FileHash -Algorithm SHA256 $PcStockImpl).Hash.ToLower()
        if ($hStock -ne $PinImplStock) { Abort-D "PC stock impl $hStock != $PinImplStock" }
        Log "ARM D deploy stock impl to $StockDevDir (NOT s3oracle)"
        AdbOut "mkdir -p $StockDevDir/logs" | Out-Null
        AdbOut "cp $DevDir/llama-bench $StockDevDir/llama-bench" | Out-Null
        AdbOut "for f in $DevDir/*.so; do cp `$f $StockDevDir/; done" | Out-Null
        Invoke-S23 @("push", $PcStockImpl, "$StockDevDir/libllama-bench-impl.so")
        Invoke-S23 @("push", (Join-Path $N5Root "one_cell_d.sh"), "$StockDevDir/one_cell_d.sh")
        Invoke-S23 @("push", (Join-Path $N5Root "launch_bg_d.sh"), "$StockDevDir/launch_bg_d.sh")
        AdbOut "chmod 755 $StockDevDir/llama-bench $StockDevDir/one_cell_d.sh $StockDevDir/launch_bg_d.sh" | Out-Null
        $dImpl = ((AdbOut "sha256sum $StockDevDir/libllama-bench-impl.so") -split "\s+")[0].ToLower()
        if ($dImpl -ne $PinImplStock) { Abort-D "on-device s18stock impl $dImpl != $PinImplStock" }
        $s3still = Get-OnDeviceSha "libllama-bench-impl.so"
        if ($s3still.sha -ne $PinImplShip) { Abort-D "s3oracle impl clobbered during D deploy: $($s3still.sha)" }
        Log "ARM D pins s18stock=$dImpl s3oracle still $($s3still.sha)"
        New-Item -ItemType Directory -Force -Path $ArmDRoot, (Join-Path $ArmDRoot "cells"), (Join-Path $ArmDRoot "probes") | Out-Null
        $dCsv = Join-Path $ArmDRoot "runs.csv"
        Assert-UnpluggedN5
        $dMax = 2
        for ($di = 1; $di -le $dMax; $di++) {
            $dBatt = Get-BattHeader
            if ($dBatt.level -lt 40) { Log "ARM D stop after $($di-1) cells -- battery $($dBatt.level)"; break }
            $dtag = "d_c$di"
            $pre = Write-Sensors "${dtag}_PRE"
            AdbSoft "input keyevent KEYCODE_WAKEUP" | Out-Null
            Start-Sleep -Milliseconds 400
            $wakeLine = AdbSoft "dumpsys power | grep mWakefulness="
            if (-not (Test-WakeAwake $wakeLine)) { Log "ARM D skip $dtag wake $wakeLine"; break }
            $run = Invoke-CellNaturalExit -Tag $dtag -Extra "" -Launcher "$StockDevDir/launch_bg_d.sh" -LogDir $StockDevDir
            if ($run.stall) {
                Pull-Remote "$StockDevDir/logs/$dtag.out" (Join-Path $ArmDRoot "probes\$dtag.stall.out") -BestEffort | Out-Null
                Pull-Remote "$StockDevDir/logs/$dtag.err" (Join-Path $ArmDRoot "probes\$dtag.stall.err") -BestEffort | Out-Null
                Abort-D "15 min stall on $dtag -- leave process; no SIGTERM"
            }
            if ([string]$run.adb_rc -eq "255") { Abort-D "adb 255 on $dtag" }
            $dOut = Join-Path $ArmDRoot "cells\$dtag.stdout.txt"
            Pull-Remote "$StockDevDir/logs/$dtag.out" $dOut
            Pull-Remote "$StockDevDir/logs/$dtag.err" (Join-Path $ArmDRoot "probes\$dtag.err") -BestEffort | Out-Null
            $dRcPath = Join-Path $ArmDRoot "probes\$dtag.rc"
            Pull-Remote "$StockDevDir/logs/$dtag.rc" $dRcPath
            $drc = ((Get-Content $dRcPath -Raw).Trim())
            try { $post = Write-Sensors "${dtag}_POST" } catch { Abort-D "sensors failed after $dtag -- possible power-off" }
            if ($drc -ne "0") { Abort-D "llama-bench rc=$drc on $dtag" }
            $drop = [int64]$pre.mem_available_kb - [int64]$post.mem_available_kb
            if ($drop -ge $MemCliffKb) { Abort-D "MemAvailable drop $drop kB on $dtag" }
            $parsed = Parse-CellJsonl $dOut
            $dtg = if ($parsed) { FmtG $parsed.avg_ts } else { "" }
            $drow = [pscustomobject]@{
                cell = $di; arm = "D"; ngl = 0; rc = $drc; tg512 = $dtg
                no_repack = $(if ($parsed) { [string]$parsed.no_repack } else { "" })
                wall_s = (FmtG $run.wall_s); over_cap = $run.over_cap
                mem_avail_pre = $pre.mem_available_kb; mem_avail_post = $post.mem_available_kb
                temp_c_pre = $pre.temp_c; temp_c_post = $post.temp_c
                sha_impl = $dImpl; label = "kexp_n5_armD_descriptive_never_ship"
                lock_commit = $LockCommit
            }
            $drow | Export-Csv -Path $dCsv -Append -NoTypeInformation -Encoding utf8
            Log "ARM D $dtag tg512=$dtg wall=$($run.wall_s) (descriptive only)"
        }
        $s3end = Get-OnDeviceSha "libllama-bench-impl.so"
        Log "ARM D done. s3oracle impl still $($s3end.sha) (no restore performed)"
        if ($s3end.sha -ne $PinImplShip) { Log "WARNING s3oracle impl drifted after D -- not restored per protocol" }
    }
}

Log "SESSION DONE complete=$((Get-CompleteBlockIds).Count) lock=$LockCommit"
Update-N5Report
Write-Host "KEXP N>=5 done. See $N5Root and $ReportPath"
} catch {
    Log "CATCH $($_.Exception.Message)"
    if ($_.Exception.Message -notmatch "KEXP N5|ARM D ABORT") {
        Write-AbortFiles "ABORT" $_.Exception.Message
        try { Update-N5Report -ForceNote $_.Exception.Message } catch { }
    }
    throw
}
