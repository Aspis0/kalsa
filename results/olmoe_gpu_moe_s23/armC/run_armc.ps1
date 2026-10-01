# OLMoE arm C decision cell -- queue #20. Exploratory-registered, full #18 gate discipline.
# NOT a prereg ship claim. Head-build binaries currently deployed in s3oracle.
# DO NOT SIGTERM llama-bench. DO NOT rebuild. DO NOT redeploy ship binaries.
# Arms: A -ngl 16; C -ngl 0. BOTH: -nr -fa off -t 4. tg512 only.
# Palindrome A,C,C,A x 3. Battery <40% at block start = SESSION_END (no recharge pause).
param([int]$TargetComplete = 3)
$ErrorActionPreference = "Stop"
[System.Threading.Thread]::CurrentThread.CurrentCulture = [Globalization.CultureInfo]::InvariantCulture
[System.Threading.Thread]::CurrentThread.CurrentUICulture = [Globalization.CultureInfo]::InvariantCulture

$ArmCRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$OlmoeRoot = Split-Path -Parent $ArmCRoot
$RepoRoot = [IO.Path]::GetFullPath((Join-Path $OlmoeRoot "..\.."))
$N10Root = Join-Path $OlmoeRoot "n10"
. (Join-Path $N10Root "_lib_n10.ps1")

$Protocol = "armC-exploratory-gates-v1.2"
$PinImplShip = "8adc148c0909e8ebbbf6ed41970b2c07ac0319db96454ad0dd7b2f281a9b8807"
$PinOpenclShip = "f432548328af0429fd0f885ccde70cae69f40666118836c713491602dedd6d6d"
$PinStub = "b2ae0fa6c413a5049a87b0706f2687cd7035ae5e43985fe40779dc0a7d225b2c"
$PinOlmoeGguf = "3bd9ec48045f526508956ef663c5c11dbb3ef791a06f4e10a6be88379c40e1fe"
$PinImplStock = "bad179520546f8d5316cd98124e948d025e8acb2999bf92b94977879ce72c171"
$PinOpenclOldN5 = "2ed2e48a98e50f324c2aaed0c8fa7ed5b1c0fb09bff8f9a153f79420a7d69a87"
$OlmoeGgufName = "OLMoE-1B-7B-0924-Instruct-Q4_K_M.gguf"
$OlmoeGgufDev = "$DevDir/$OlmoeGgufName"
$ReportPath = Join-Path $RepoRoot "scratchpad\agents\olmoe-armC\REPORT.md"
$ReportArmC = Join-Path $ArmCRoot "REPORT.md"
$CsvPath = Join-Path $ArmCRoot "runs.csv"
$ProbeDir = Join-Path $ArmCRoot "probes"
$CellDir = Join-Path $ArmCRoot "cells"
$LogPath = Join-Path $ArmCRoot "session.log"
$StatePath = Join-Path $ArmCRoot "state.json"
$ShaSums = Join-Path $ProbeDir "SHA256SUMS"
$WifiPin = $null
$COverCapCount = 0
$SessionStopKind = $null
$GitHead = "unknown"

$WallCapSec = 600
$StallSec = 900

function Log([string]$Msg) {
    $line = "{0} {1}" -f (Get-Date).ToString("o"), $Msg
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

function Write-StopFiles([string]$Kind, [string]$Reason) {
    $body = @"
# OLMoE arm C $Kind
protocol: $Protocol
iso: $((Get-Date).ToString("o"))
reason: $Reason
git_head: $GitHead
"@
    Set-Content -Path (Join-Path $ArmCRoot "$Kind.md") -Value $body -Encoding utf8
    Log "$Kind $Reason"
}

function Abort-ArmC([string]$Reason) {
    Write-StopFiles "ABORT" $Reason
    Update-ArmCReport -ForceNote $Reason
    throw "OLMoE ARMC ABORT: $Reason"
}

function Stop-ArmC([string]$Kind, [string]$Reason) {
    $script:SessionStopKind = $Kind
    Write-StopFiles $Kind $Reason
    Update-ArmCReport -ForceNote "$Kind $Reason"
    throw "OLMoE ARMC $Kind : $Reason"
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

function Assert-UnpluggedArmC {
    $hdr = AdbSoft "dumpsys battery | grep -E '^  (USB|AC|Wireless) powered:'"
    Log "UNPLUG_GATE: $hdr"
    if ($hdr -notmatch "USB powered:\s*false" -or $hdr -notmatch "AC powered:\s*false") {
        Abort-ArmC "unplug gate fail (USB/AC): $hdr"
    }
    if ($hdr -match "Wireless powered:\s*true") {
        Abort-ArmC "unplug gate fail (Wireless true): $hdr"
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
        if ($cells.Count -eq 4 -and $ok.Count -eq 4 -and $order -eq "A,C,C,A") { $ids += [int]$g.Name }
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
    $bright = (AdbOut "settings get system screen_brightness").Trim()
    Save-Probe "${Tag}_${Suffix}_batt.txt" $batt | Out-Null
    Save-Probe "${Tag}_${Suffix}_wake.txt" $wake | Out-Null
    Save-Probe "${Tag}_${Suffix}_mem.txt" $mem | Out-Null
    Save-Probe "${Tag}_${Suffix}_brightness.txt" $bright | Out-Null
    $s = Get-Sensors
    $cc = ([regex]::Match($batt, "(?m)^  Charge counter:\s*(-?\d+)")).Groups[1].Value
    $s | Add-Member -NotePropertyName charge_counter -NotePropertyValue $cc -Force
    $s | Add-Member -NotePropertyName brightness -NotePropertyValue $bright -Force
    return $s
}

function Invoke-ArmCPins {
    Log "session pins protocol=$Protocol"
    AdbOut "settings put system screen_off_timeout 900000" | Out-Null
    AdbOut "settings put system screen_brightness_mode 0" | Out-Null
    AdbOut "settings put system screen_brightness 128" | Out-Null
    $timeout = (AdbOut "settings get system screen_off_timeout").Trim()
    $bright = (AdbOut "settings get system screen_brightness").Trim()
    $bmode = (AdbOut "settings get system screen_brightness_mode").Trim()
    $wifi = (AdbOut "settings get global wifi_on").Trim()
    $gov = Get-GovernorVector
    if ($timeout -ne "900000") {
        Abort-ArmC "screen_off_timeout readback $timeout != 900000"
    }
    if ($bright -ne "128") {
        Log "brightness readback $bright != 128 -- retry mode=0 put 128"
        AdbOut "settings put system screen_brightness_mode 0" | Out-Null
        AdbOut "settings put system screen_brightness 128" | Out-Null
        $bright = (AdbOut "settings get system screen_brightness").Trim()
        if ($bright -ne "128") {
            Abort-ArmC "brightness readback $bright != 128 after retry (must be 128 before block 1)"
        }
    }
    $script:WifiPin = $wifi
    $obj = [ordered]@{
        iso = (Get-Date).ToString("o")
        protocol = $Protocol
        git_head = $GitHead
        screen_off_timeout = $timeout
        screen_brightness = $bright
        screen_brightness_mode = $bmode
        wifi_on = $wifi
        governor_at_session_start = $gov
        serial = $Serial
        note = "HEAD BUILD currently deployed in s3oracle. NOT the old OLMoE-N5 pin 2ed2e48a (no longer extant). Arm A is RE-MEASURED in-session; never compare C against the old n10 session A numbers."
    }
    $json = $obj | ConvertTo-Json -Depth 6
    Set-Content -Path (Join-Path $ArmCRoot "session_pins.json") -Value $json -Encoding utf8
    Save-Probe "session_pins.txt" $json | Out-Null
    Log ("PIN timeout={0} brightness={1} mode={2} wifi_on={3}" -f $timeout, $bright, $bmode, $wifi)
    return $obj
}

function Assert-WifiHeld {
    $w = (AdbOut "settings get global wifi_on").Trim()
    if ($null -ne $script:WifiPin -and $w -ne $script:WifiPin) {
        Abort-ArmC "wifi_on $w != session pin $($script:WifiPin)"
    }
}

function Assert-ShipShas([string]$When) {
    $impl = Get-OnDeviceSha "libllama-bench-impl.so"
    $ocl = Get-OnDeviceSha "libggml-opencl.so"
    $stub = Get-OnDeviceSha "llama-bench"
    Log "SHA $When impl=$($impl.sha) opencl=$($ocl.sha) stub=$($stub.sha)"
    if ($impl.sha -eq $PinImplStock) { Abort-ArmC "stock extra_bufts on s3oracle at $When -- FORBIDDEN" }
    if ($impl.sha -ne $PinImplShip) { Abort-ArmC "impl sha at $When $($impl.sha) != $PinImplShip (NO rebuild/redeploy)" }
    if ($ocl.sha -eq $PinOpenclOldN5) { Abort-ArmC "old OLMoE-N5 opencl pin 2ed2e48a at $When -- no longer extant; this session is HEAD BUILD only" }
    if ($ocl.sha -ne $PinOpenclShip) { Abort-ArmC "opencl sha at $When $($ocl.sha) != $PinOpenclShip (NO rebuild/redeploy)" }
    if ($stub.sha -ne $PinStub) { Abort-ArmC "stub sha at $When $($stub.sha) != $PinStub (NO rebuild/redeploy)" }
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
    param([string]$Tag, [string]$Extra, [string]$Launcher = "$DevDir/launch_bg_armc.sh", [string]$LogDir = $DevDir)
    $alive0 = Get-LlamaBenchPids
    if ($alive0) {
        Stop-ArmC "STOP" "llama-bench already running (pids=$alive0) -- refuse launch $Tag (no SIGTERM)"
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
        Abort-ArmC "detached launch failed for $Tag (no pid, no rc). wrapper=$wrap"
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

function Get-BlockAcRatio($cells) {
    $aMean = @($cells | Where-Object { $_.arm -eq "A" -and $_.tg512 -ne "" -and $_.excluded -ne "True" -and $_.excluded -ne "true" } | ForEach-Object { [double]$_.tg512 })
    $cMean = @($cells | Where-Object { $_.arm -eq "C" -and $_.tg512 -ne "" -and $_.excluded -ne "True" -and $_.excluded -ne "true" } | ForEach-Object { [double]$_.tg512 })
    if ($aMean.Count -ge 1 -and $cMean.Count -ge 1) {
        $am = ($aMean | Measure-Object -Average).Average
        $cm = ($cMean | Measure-Object -Average).Average
        if ($cm -ne 0) { return ($am / $cm) }
    }
    return $null
}

function Update-ArmCReport {
    param([string]$ForceNote = "")
    New-Item -ItemType Directory -Force -Path (Split-Path $ReportPath) | Out-Null
    $rows = @()
    if (Test-Path $CsvPath) { $rows = @(Import-Csv $CsvPath) }
    $complete = @(Get-CompleteBlockIds)
    $counted = @(Get-CountedRows)
    $a = @($counted | Where-Object { $_.arm -eq "A" } | ForEach-Object { [double]$_.tg512 })
    $c = @($counted | Where-Object { $_.arm -eq "C" } | ForEach-Object { [double]$_.tg512 })
    $tA = @($counted | Where-Object { $_.arm -eq "A" -and $_.temp_peak -ne "" } | ForEach-Object { [double]$_.temp_peak })
    $tC = @($counted | Where-Object { $_.arm -eq "C" -and $_.temp_peak -ne "" } | ForEach-Object { [double]$_.temp_peak })
    $medA = Get-Median $a
    $medC = Get-Median $c
    $medTA = Get-Median $tA
    $medTC = Get-Median $tC
    $maxTA = if ($tA.Count -gt 0) { ($tA | Measure-Object -Maximum).Maximum } else { $null }
    $maxTC = if ($tC.Count -gt 0) { ($tC | Measure-Object -Maximum).Maximum } else { $null }
    $ratioAC = if ($medA -and $medC -and $medC -ne 0) { $medA / $medC } else { $null }
    $coolIds = @()
    foreach ($bid in $complete) {
        $h = @($rows | Where-Object { [int]$_.block -eq $bid } | Select-Object -First 1)
        if ($h.Count -gt 0 -and ($h[0].warm_start -eq "False" -or $h[0].warm_start -eq "false")) { $coolIds += $bid }
    }
    $coolRows = @($counted | Where-Object { $coolIds -contains [int]$_.block })
    $cA = @($coolRows | Where-Object { $_.arm -eq "A" } | ForEach-Object { [double]$_.tg512 })
    $cC = @($coolRows | Where-Object { $_.arm -eq "C" } | ForEach-Object { [double]$_.tg512 })
    $cMedA = Get-Median $cA
    $cMedC = Get-Median $cC
    $cRatioAC = if ($cMedA -and $cMedC -and $cMedC -ne 0) { $cMedA / $cMedC } else { $null }
    $lines = @()
    $blockRatios = @()
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
        $meanAC = Get-BlockAcRatio $cs
        $meanACStr = if ($null -ne $meanAC) { Fmt3 $meanAC } else { "" }
        if ($complete -contains $bid -and $null -ne $meanAC) { $blockRatios += $meanAC }
        $lvl0 = $cs[0].level_pre
        $lvl1 = $cs[-1].level_post
        $lines += ("| {0} | {1} | {2} | {3} | {4}->{5} | {6} | {7} | {8} | {9} |" -f $bid, $st, $h.temp_c_block_start, $h.warm_start, $lvl0, $lvl1, $tgs, $decay, $meanACStr, $h.governor)
    }
    $framing = "n/a (need complete blocks)"
    if ($null -ne $ratioAC) {
        if ($ratioAC -ge 1.20) {
            $framing = "GPU default candidate (A/C >= 1.20; exploratory, not a ship claim)"
        } elseif ($ratioAC -gt 1.0) {
            $framing = "A faster than C but below 1.20 -- do not frame as GPU default; exploratory"
        } elseif ($ratioAC -eq 1.0) {
            $framing = "A == C"
        } else {
            $framing = "GPU = cool mode (pure CPU C beats full-GPU A; same pattern as KEXP A/C refute)"
        }
    }
    $flags = @()
    $flags += "protocol=$Protocol"
    $flags += "git_head=$GitHead"
    $flags += "complete_blocks=$($complete.Count)/$TargetComplete"
    $flags += "cool_start_complete=$($coolIds.Count)"
    $flags += "C_over_cap=$COverCapCount"
    $flags += "HEAD_BUILD=impl 8adc148c / opencl f4325483 / stub b2ae0fa6 (NOT old OLMoE-N5 pin 2ed2e48a)"
    $flags += "A is RE-MEASURED in-session; do not compare C to n10 session A"
    if ($ForceNote) { $flags += "NOTE: $ForceNote" }
    $blockRatioTxt = if ($blockRatios.Count -gt 0) { ($blockRatios | ForEach-Object { Fmt3 $_ }) -join ", " } else { "n/a" }
    $section = @"
# OLMoE arm C -- queue #20 (DECISION CELL, exploratory-registered)

**Not a prereg ship claim.** Full #18 gate discipline. Protocol ``$Protocol``. git HEAD ``$GitHead``.

**HEAD BUILD** currently deployed in ``/data/local/tmp/s3oracle`` (verified, no rebuild/redeploy): impl ``8adc148c...``, opencl ``f4325483...``, stub ``b2ae0fa6...``. **NOT** the old OLMoE-N5 pin ``2ed2e48a`` (no longer extant). Arm A is **RE-MEASURED in this session**. Never compare C against the old n10 A numbers.

Arms: A ``-ngl 16``, C ``-ngl 0``. BOTH ``-nr -fa off -t 4``. tg512 ``-p 0 -n 512 -r 1 -o jsonl``. Palindrome A,C,C,A x 3. Model OLMoE-1B-7B Q4_K_M sha ``3bd9ec48...``. Battery floor 40% = **SESSION END** (no recharge pause).

## Running medians (complete blocks only; full precision; display 3 dp; no pre-rounding)

| set | nA | nC | med A | med C | A/C | med peakT A | med peakT C | max peakT A | max peakT C |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| all complete (primary) | $($a.Count) | $($c.Count) | $(Fmt3 $medA) | $(Fmt3 $medC) | $(Fmt3 $ratioAC) | $(Fmt3 $medTA) | $(Fmt3 $medTC) | $(Fmt3 $maxTA) | $(Fmt3 $maxTC) |
| cool-start only (secondary) | $($cA.Count) | $($cC.Count) | $(Fmt3 $cMedA) | $(Fmt3 $cMedC) | $(Fmt3 $cRatioAC) |  |  |  |  |

Per-block mean(A)/mean(C) robustness: $blockRatioTxt

**Dossier framing (exploratory, not ship):** $framing

A-decay is pre-declared: second-A cells are **never** dropped from complete blocks.

## Blocks

| block | status | temp_c_block_start | warm_start | level pre->post | tg512 (*excluded) | A-decay | mean(A)/mean(C) | governor |
|---:|---|---:|---|---|---|---:|---:|---|
$($lines -join "`n")

## Flags

$($flags | ForEach-Object { "- $_" } | Out-String)
Raw: ``results/olmoe_gpu_moe_s23/armC/runs.csv``  probes: ``results/olmoe_gpu_moe_s23/armC/probes/``  cells: ``results/olmoe_gpu_moe_s23/armC/cells/``
"@
    Set-Content -Path $ReportPath -Value $section -Encoding utf8
    Set-Content -Path $ReportArmC -Value $section -Encoding utf8
}

function Append-CellRow($row) {
    $row | Export-Csv -Path $CsvPath -Append -NoTypeInformation -Encoding utf8
}

function Get-ArmSpec([string]$Arm) {
    switch ($Arm) {
        "A" { return [pscustomobject]@{ extra = "-ngl 16"; experts = "GPU"; ngl = 16 } }
        "C" { return [pscustomobject]@{ extra = "-ngl 0"; experts = "NGL0"; ngl = 0 } }
        default { throw "bad arm $Arm (arm C session is A and C only)" }
    }
}

function New-CsvRow {
    param(
        $block, $ci, $seq, $arm, $spec, $rc, $outLog, $excluded, $exclReason,
        $pre, $post, $wakeLaunch, $tg, $peak, $cool, $gov, $shas, $nrStr, $wallS, $overCap
    )
    $wakePre = if ($wakeLaunch) { $wakeLaunch } else { $pre.wake }
    $wakePost = if ($post) { $post.wake } else { "" }
    $isoPost = if ($post) { $post.iso } else { "" }
    $levelPost = if ($post) { $post.level } else { "" }
    $tempPost = if ($post) { $post.temp_c } else { "" }
    $memAPost = if ($post) { $post.mem_available_kb } else { "" }
    $memFPost = if ($post) { $post.mem_free_kb } else { "" }
    $ccPre = if ($pre -and $pre.PSObject.Properties.Name -contains "charge_counter") { $pre.charge_counter } else { "" }
    $ccPost = if ($post -and $post.PSObject.Properties.Name -contains "charge_counter") { $post.charge_counter } else { "" }
    $stdoutLeaf = if ($outLog) { Split-Path $outLog -Leaf } else { "" }
    return [pscustomobject]@{
        block = $block; cell_in_block = ($ci + 1); seq_global = $seq
        arm = $arm; experts = $spec.experts; ngl = $spec.ngl; p = 0; n = 512
        rc = $rc; stdout_file = $stdoutLeaf
        excluded = $excluded; exclude_reason = $exclReason
        level_pre = $pre.level; temp_c_pre = $pre.temp_c; wake_pre = $wakePre
        mem_avail_pre = $pre.mem_available_kb; mem_free_pre = $pre.mem_free_kb
        level_post = $levelPost; temp_c_post = $tempPost; wake_post = $wakePost
        mem_avail_post = $memAPost; mem_free_post = $memFPost
        iso_pre = $pre.iso; iso_post = $isoPost; tg512 = $tg; temp_peak = $peak
        temp_c_block_start = $cool.temp_c_block_start; warm_start = $cool.warm_start
        governor = $gov; sha_impl = $shas.impl.sha; sha_opencl = $shas.opencl.sha
        label = "olmoe_armC_q20"; no_repack = $nrStr; wall_s = $wallS; over_cap = $overCap
        sha_stub = $shas.stub.sha
        charge_counter_pre = $ccPre; charge_counter_post = $ccPost
    }
}

# --- session start ---
New-Item -ItemType Directory -Force -Path $ArmCRoot, $CellDir, $ProbeDir, (Split-Path $ReportPath) | Out-Null
if (-not (Test-Path $LogPath)) { Set-Content -Path $LogPath -Value "" -Encoding utf8 }
if (-not (Test-Path $ShaSums)) { Set-Content -Path $ShaSums -Value "" -Encoding ascii }

try {
    $GitHead = (git -C $RepoRoot rev-parse HEAD 2>$null)
    if (-not $GitHead) { $GitHead = "unknown" }
} catch { $GitHead = "unknown" }

foreach ($term in @("ABORT.md", "STOP.md", "AMEND.md", "SESSION_END.md")) {
    $tp = Join-Path $ArmCRoot $term
    if (Test-Path $tp) {
        throw "REFUSE: $tp exists. Arm C session is OVER. Do not stitch."
    }
}

Assert-UsbS23
Log "OLMoE arm C START TargetComplete=$TargetComplete serial=$Serial protocol=$Protocol git=$GitHead"
$devs = (& $Adb devices | Out-String)
Save-Probe "adb_devices.txt" $devs | Out-Null

# Wrapper scripts only (not ship binaries). Distinct names so n5 wrappers are not clobbered.
Invoke-S23 @("push", (Join-Path $ArmCRoot "one_cell_armc.sh"), "$DevDir/one_cell_armc.sh")
Invoke-S23 @("push", (Join-Path $ArmCRoot "dump_env.sh"), "$DevDir/dump_env_armc.sh")
Invoke-S23 @("push", (Join-Path $ArmCRoot "launch_bg_armc.sh"), "$DevDir/launch_bg_armc.sh")
AdbOut "chmod 755 $DevDir/one_cell_armc.sh $DevDir/dump_env_armc.sh $DevDir/launch_bg_armc.sh" | Out-Null
AdbOut "mkdir -p $DevDir/logs" | Out-Null

# LOG_ALLOC unset evidence: RAW dump BEFORE any unset.
$envDump = AdbOut "sh $DevDir/dump_env_armc.sh"
$rawPart = $envDump
$splitAt = $envDump.IndexOf("AFTER cell-matching unsets")
if ($splitAt -ge 0) { $rawPart = $envDump.Substring(0, $splitAt) }
Save-Probe "log_alloc_unset.env.txt" $envDump | Out-Null
Save-Probe "log_alloc_unset.raw.txt" $rawPart | Out-Null
if ($rawPart -match "(?m)^GGML_OPENCL_LOG_ALLOC=") {
    Abort-ArmC "GGML_OPENCL_LOG_ALLOC is SET in RAW env dump -- must be unset"
}
Log "LOG_ALLOC-unset RAW evidenced"

$shaStart = Assert-ShipShas "session-start"
$ggufLine = AdbOut "sha256sum $OlmoeGgufDev"
Log "OLMoE GGUF $ggufLine"
$ggufSha = (($ggufLine -split "\s+")[0]).ToLower()
if ($ggufSha -ne $PinOlmoeGguf) { Abort-ArmC "OLMoE gguf sha $ggufSha != $PinOlmoeGguf" }
$shaBlock = AdbOut "cd $DevDir && sha256sum llama-bench libllama-bench-impl.so libllama.so libggml-opencl.so libggml.so libggml-base.so libggml-cpu.so libllama-common.so"
Log "SHA_BLOCK`n$shaBlock"
$shaStartTxt = "$shaBlock`n$ggufLine`nprotocol=$Protocol`ngit=$GitHead"
Set-Content -Path (Join-Path $ArmCRoot "sha_session_start.txt") -Value $shaStartTxt -Encoding utf8
Save-Probe "sha_session_start.txt" $shaStartTxt | Out-Null

@"
# OLMoE arm C -- queue #20 MANIFEST

**DECISION CELL, exploratory-registered, not a prereg ship claim.**
Run with full #18 gate discipline (cooldown 35.0 C / 10 min warm-start, unplug per block, Awake per cell with wake_post check, no SIGTERM, 10-min cap = exclude/wait, raw probes archived, no full dumpsys dumps, sha on-device before cells, medians full-precision).

Date: $((Get-Date).ToString("o"))
Serial: ``$Serial``
Protocol: ``$Protocol``
git HEAD: ``$GitHead``

## THIS IS THE HEAD BUILD, NOT the old OLMoE-N5 pin

The confirmatory OLMoE N>=5 ship cell (queue 2d-i, SHIP 1.553x A/B) used opencl ``2ed2e48a...`` which is **no longer extant**. This session uses the **currently deployed verified set** in ``/data/local/tmp/s3oracle`` (engine head, device-verified MUL_MAT_ID 407/407). Arm A is therefore **RE-MEASURED in-session**. Never compare C against the old session's A numbers, only within-session A vs C.

| artifact | sha256 | note |
|---|---|---|
| libllama-bench-impl.so | $PinImplShip | HEAD; ``-nr`` mandatory |
| libggml-opencl.so | $PinOpenclShip | HEAD (kalsakernel-v4 + #26476 + barrier-safe); NOT 2ed2e48a |
| llama-bench stub | $PinStub | unchanged |
| $OlmoeGgufName | $PinOlmoeGguf | on-device path ``$OlmoeGgufDev`` |

Stock extra_bufts ``$PinImplStock`` is **forbidden**. No rebuild / no redeploy this session.

Flags: A ``-ngl 16`` (same ngl as the OLMoE ship cell), C ``-ngl 0``; BOTH ``-nr -fa off -t 4``; tg512 ``-p 0 -n 512 -r 1 -o jsonl``.
Block: palindrome A,C,C,A x 3 (12 cells). Cooldown 35.0C / 10 min warm-start. **Battery floor 40% at block start = SESSION END** (nobody available to plug; no recharge pause). Finish a running block, then stop.
Cell cap 10 min = exclude/wait; 15 min = STOP. NEVER SIGTERM. MemAvailable drop >= 2.0 GB / rc!=0 / adb 255 / power-off = abort.
wake_post != Awake -> exclude cell, drop incomplete block.
"@ | Set-Content -Path (Join-Path $ArmCRoot "MANIFEST.md") -Encoding utf8

$pins = Invoke-ArmCPins
Assert-UnpluggedArmC
Update-ArmCReport

$arms = @("A", "C", "C", "A")
$block = 1
$seq = 0
$resumeCi = 0
if (Test-Path $CsvPath) {
    $existing = @(Import-Csv $CsvPath)
    if ($existing.Count -gt 0) {
        $seq = [int](($existing | Measure-Object seq_global -Maximum).Maximum)
        $maxBlock = [int](($existing | Measure-Object block -Maximum).Maximum)
        $lastBlockRows = @($existing | Where-Object { [int]$_.block -eq $maxBlock } | Sort-Object { [int]$_.cell_in_block })
        if ($lastBlockRows.Count -ge 4) {
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

    Log "=== BLOCK $block (complete=$done/$TargetComplete) resume_ci=$resumeCi ==="
    Assert-WifiHeld
    $metaPath = Join-Path $ArmCRoot ("block_{0:D2}_meta.json" -f $block)
    if ($resumeCi -gt 0) {
        if (-not (Test-Path $metaPath)) {
            Log "MID-BLOCK RESUME without meta -- do not cooldown mid-palindrome; drop block $block as incomplete"
            $resumeCi = 0
            $block++
            continue
        }
        Log "MID-BLOCK RESUME -- reuse $metaPath (no extra cooldown; palindrome must not be split by a new gate)"
        Assert-UnpluggedArmC
        $metaObj = Get-Content $metaPath -Raw | ConvertFrom-Json
        $cool = [pscustomobject]@{
            warm_start = [bool]([System.Convert]::ToBoolean($metaObj.warm_start))
            temp_c_block_start = $metaObj.temp_c_block_start
            cooldown_s = $metaObj.cooldown_s
        }
        $gov = [string]$metaObj.governor
        $batt = Get-BattHeader
        Log "MID-BLOCK RESUME level=$($batt.level) (finish remaining cells of this block, then END if <40)"
    } else {
        $cool = Invoke-CooldownGate
        Assert-UnpluggedArmC
        $batt = Get-BattHeader
        if ($null -eq $batt.level -or $batt.level -lt 40) {
            Stop-ArmC "SESSION_END" "battery floor at block $block start level=$($batt.level) -- no recharge pause; nobody available to plug. Finish = this block not started."
        }
        $gov = ((Get-GovernorVector) -replace "`r", "" -replace "`n", "; ")
        Log "GOVERNOR $gov temp_start=$($cool.temp_c_block_start) warm=$($cool.warm_start) level=$($batt.level)"
        Save-Probe ("block_{0:D2}_governor.txt" -f $block) $gov | Out-Null
        Save-Probe ("block_{0:D2}_unplug.txt" -f $block) $batt.raw | Out-Null

        $blockMeta = [ordered]@{
            iso = (Get-Date).ToString("o")
            protocol = $Protocol
            git_head = $GitHead
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
    for ($ci = $resumeCi; $ci -lt 4; $ci++) {
        $arm = $arms[$ci]
        $spec = Get-ArmSpec $arm
        $seq++
        $tag = "c_b{0:D2}_c{1}_{2}" -f $block, ($ci + 1), $arm
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
        $wakeLine = ""
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
            $peak = ""
            if ($pre.temp_c -ne "") { $peak = $pre.temp_c }
            $row = New-CsvRow $block $ci $seq $arm $spec $rc $outLog $excluded $exclReason $pre $post $wakeLine $tg $peak $cool $gov $shas $nrStr $wallS $overCap
            Append-CellRow $row
            Update-ArmCReport
            Start-Sleep -Seconds 2
            continue
        } else {
            $run = Invoke-CellNaturalExit -Tag $tag -Extra $spec.extra
            $wallS = FmtG $run.wall_s
            $overCap = [bool]$run.over_cap
            Log "RETURN $tag stall=$($run.stall) wall_s=$($run.wall_s) adb_rc=$($run.adb_rc) device_rc=$($run.device_rc) over_cap=$overCap"

            if ($run.stall) {
                Archive-StallHealth $tag
                $rowStall = New-CsvRow $block $ci $seq $arm $spec "RUNNING" "" $true "stall_15min" $pre $null $wakeLine "" "" $cool $gov $shas "" $wallS $true
                Append-CellRow $rowStall
                Stop-ArmC "STOP" "15 min stall on $tag (leave process; no SIGTERM). wall_s=$($run.wall_s) pids=$($run.pids)"
            }

            if ([string]$run.adb_rc -eq "255") { Abort-ArmC "adb 255 on $tag" }

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

            try { $post = Archive-CellSensors $tag "POST" } catch { Abort-ArmC "sensors failed after $tag rc=$rc -- possible power-off" }

            if ($rc -eq "MISSING" -or $rc -eq "") { Abort-ArmC "missing device rc file after $tag" }
            if ($rc -ne "0") { Abort-ArmC "llama-bench rc=$rc on $tag (wall-class; rule 3)" }

            $drop = [int64]$pre.mem_available_kb - [int64]$post.mem_available_kb
            Log "MemAvailable drop_kb=$drop (cliff=$MemCliffKb)"
            if ($drop -ge $MemCliffKb) { Abort-ArmC "oomwall-class MemAvailable drop $drop kB on $tag" }

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
                        $rowOC = New-CsvRow $block $ci $seq $arm $spec $rc $outLog $true $exclReason $pre $post $wakeLine $tg $peakOC $cool $gov $shas $nrStr $wallS $true
                        Append-CellRow $rowOC
                        Stop-ArmC "AMEND" ">=2 C cells wall>=10 min (COverCap=$COverCapCount). Do not drop C. Written amendment required."
                    }
                }
            }

            $parsed = Parse-CellJsonl $outLog
            if ($null -eq $parsed) {
                if ($excluded) {
                    Log "no jsonl on excluded $tag (allowed)"
                } else {
                    Abort-ArmC "no tg512 jsonl in $outLog"
                }
            } else {
                if (-not $excluded) {
                    foreach ($need in @("no_repack", "n_threads", "flash_attn", "n_gpu_layers", "n_cpu_moe", "avg_ts")) {
                        if (-not (Test-JsonProp $parsed $need)) { Abort-ArmC "jsonl missing $need on $tag" }
                    }
                    if (-not (Test-NoRepackTrue $parsed.no_repack)) {
                        Abort-ArmC "no_repack=$($parsed.no_repack) on $tag -- -nr/--repack 0 mandatory on A/C"
                    }
                    if ([int]$parsed.n_threads -ne 4) { Abort-ArmC "n_threads=$($parsed.n_threads) != 4 on $tag" }
                    if ([int]$parsed.flash_attn -ne 0) { Abort-ArmC "flash_attn=$($parsed.flash_attn) != 0 on $tag" }
                    if ($arm -eq "A") {
                        if ([int]$parsed.n_gpu_layers -ne 16) { Abort-ArmC "A n_gpu_layers=$($parsed.n_gpu_layers) != 16" }
                        if ([int]$parsed.n_cpu_moe -ne 0) { Abort-ArmC "A n_cpu_moe=$($parsed.n_cpu_moe) != 0" }
                    }
                    if ($arm -eq "C") {
                        if ([int]$parsed.n_gpu_layers -ne 0) { Abort-ArmC "C n_gpu_layers=$($parsed.n_gpu_layers) != 0" }
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
        $row = New-CsvRow $block $ci $seq $arm $spec $rc $outLog $excluded $exclReason $pre $post $wakeLine $tg $peak $cool $gov $shas $nrStr $wallS $overCap
        Append-CellRow $row
        Update-ArmCReport
        Start-Sleep -Seconds 2
    }

    $resumeCi = 0
    Log "BLOCK $block cellOk=$cellOk complete_now=$((Get-CompleteBlockIds).Count)"
    $st = @{
        last_block = $block
        complete_ids = @(Get-CompleteBlockIds)
        iso = (Get-Date).ToString("o")
        protocol = $Protocol
        git_head = $GitHead
        C_over_cap = $COverCapCount
    }
    Write-JsonFile $StatePath $st
    Update-ArmCReport
    $block++
}

Log "arm C bag complete=$((Get-CompleteBlockIds).Count) protocol=$Protocol"
Update-ArmCReport
Write-Host "OLMoE arm C done. See $ArmCRoot and $ReportPath"
} catch {
    Log "CATCH $($_.Exception.Message)"
    if ($_.Exception.Message -notmatch "OLMoE ARMC") {
        Write-StopFiles "ABORT" $_.Exception.Message
        try { Update-ArmCReport -ForceNote $_.Exception.Message } catch { }
    }
    throw
}
