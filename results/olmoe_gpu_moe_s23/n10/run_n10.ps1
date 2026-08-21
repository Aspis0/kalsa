# OLMoE confirmatory N>=5 (PREREG v1.2) ABBA tg512 cells on S23.
# Frozen pins: noextra impl d2030f23 + opencl 2ed2e48a. Stock extra_bufts FORBIDDEN.
# PC-side adb shell only. Do not dump full dumpsys power.
param(
    [int]$TargetComplete = 5,
    [switch]$SkipRestore,
    [switch]$Fresh
)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $Root "_lib_n10.ps1")

$ReportPath = [IO.Path]::GetFullPath((Join-Path $OlmoeRoot "..\..\scratchpad\agents\n10-kexp-session\REPORT.md"))
$ManifestPath = Join-Path $Root "MANIFEST.md"
$CsvPath = Join-Path $Root "runs.csv"
$StatePath = Join-Path $Root "state.json"
$SessionLog = Join-Path $Root "session.log"
$AbortPath = Join-Path $Root "ABORT.md"
$PinsPath = Join-Path $Root "session_pins.json"

function Log([string]$Msg) {
    $line = "{0} {1}" -f (Get-Date).ToString("o"), $Msg
    Write-Host $line
    Add-Content -Path $SessionLog -Value $line -Encoding utf8
}

function Abort-Session([string]$Reason) {
    Log "ABORT: $Reason"
    @"
# ABORT

- iso: $((Get-Date).ToString("o"))
- reason: $Reason
- N>=5 dataset is NOT a ship set after a wall event. Stop. Do not improvise.
"@ | Set-Content -Path $AbortPath -Encoding utf8
    Update-N10Report -AbortReason $Reason
    throw "SESSION ABORT: $Reason"
}

function Ensure-Csv {
    if ($Fresh -and (Test-Path $CsvPath)) {
        Remove-Item $CsvPath -Force
    }
}

function Read-CsvRows {
    if (-not (Test-Path $CsvPath)) { return @() }
    return @(Import-Csv -Path $CsvPath)
}

function Get-CompleteBlockIds {
    $rows = Read-CsvRows
    $ids = @()
    $byBlock = $rows | Group-Object block
    foreach ($g in $byBlock) {
        $cells = @($g.Group)
        $excl = @($cells | Where-Object { $_.excluded -eq "True" -or $_.excluded -eq "true" -or $_.excluded -eq "1" })
        $okRc = @($cells | Where-Object { $_.rc -eq "0" -and ($_.excluded -ne "True") -and ($_.excluded -ne "true") })
        if ($cells.Count -eq 4 -and $excl.Count -eq 0 -and $okRc.Count -eq 4) {
            $ids += [int]$g.Name
        }
    }
    return @($ids | Sort-Object -Unique)
}

function Update-N10Report {
    param([string]$AbortReason = "")
    $rows = Read-CsvRows
    $complete = Get-CompleteBlockIds
    $counted = @($rows | Where-Object {
        $complete -contains [int]$_.block -and $_.excluded -ne "True" -and $_.excluded -ne "true"
    })
    $a = @($counted | Where-Object { $_.arm -eq "A" } | ForEach-Object { [double]$_.tg512 })
    $b = @($counted | Where-Object { $_.arm -eq "B" } | ForEach-Object { [double]$_.tg512 })
    $aPeak = @($counted | Where-Object { $_.arm -eq "A" } | ForEach-Object { [double]$_.temp_peak })
    $bPeak = @($counted | Where-Object { $_.arm -eq "B" } | ForEach-Object { [double]$_.temp_peak })
    $medA = Get-Median $a
    $medB = Get-Median $b
    $ratio = if ($medA -and $medB -and $medB -ne 0) { $medA / $medB } else { $null }
    $medPeakA = Get-Median $aPeak
    $medPeakB = Get-Median $bPeak
    $coolBlocks = @()
    foreach ($bid in $complete) {
        $br = @($rows | Where-Object { [int]$_.block -eq $bid } | Select-Object -First 1)
        if ($br -and ($br.warm_start -eq "False" -or $br.warm_start -eq "false" -or $br.warm_start -eq "0")) {
            $coolBlocks += $bid
        }
    }
    $coolRows = @($counted | Where-Object { $coolBlocks -contains [int]$_.block })
    $cA = Get-Median @($coolRows | Where-Object { $_.arm -eq "A" } | ForEach-Object { [double]$_.tg512 })
    $cB = Get-Median @($coolRows | Where-Object { $_.arm -eq "B" } | ForEach-Object { [double]$_.tg512 })
    $cRatio = if ($cA -and $cB -and $cB -ne 0) { $cA / $cB } else { $null }

    $blockLines = @()
    foreach ($bid in ($rows | ForEach-Object { [int]$_.block } | Sort-Object -Unique)) {
        $cs = @($rows | Where-Object { [int]$_.block -eq $bid } | Sort-Object { [int]$_.cell_in_block })
        if ($cs.Count -eq 0) { continue }
        $h = $cs[0]
        $completeFlag = if ($complete -contains $bid) { "COMPLETE" } else { "INCOMPLETE" }
        $warm = $h.warm_start
        $tgs = ($cs | ForEach-Object {
            $x = if ($_.excluded -eq "True" -or $_.excluded -eq "true") { "EXCL" } else { $_.tg512 }
            "{0}:{1}" -f $_.arm, $x
        }) -join " "
        $blockLines += ("| {0} | {1} | {2} | {3} | {4} | {5} | {6} | {7} | {8} |" -f `
            $bid, $completeFlag, $h.temp_c_block_start, $warm, $h.level_pre, ($cs[-1].level_post), $tgs, $h.governor, $h.iso_pre)
    }

    $verdict = "IN PROGRESS"
    if ($AbortReason) { $verdict = "ABORT — $AbortReason" }
    elseif ($complete.Count -ge $TargetComplete -and $ratio) {
        $tempOk = ($medPeakA -le ($medPeakB + 0.5))
        if ($ratio -ge 1.30 -and $tempOk) { $verdict = "SHIP (pending remaining ship-claim checks)" }
        elseif ($ratio -ge 1.0 -and $ratio -lt 1.30) { $verdict = "REPORT-NOT-SHIP (1.0-1.3x)" }
        else { $verdict = "REFUTE" }
        if (-not $tempOk -and $ratio -ge 1.0) { $verdict = "REFUTE (A hotter than B + 0.5C)" }
    }

    $ratioS = if ($ratio) { "{0:N3}" -f $ratio } else { "n/a" }
    $medAS = if ($null -ne $medA) { "{0:N3}" -f $medA } else { "n/a" }
    $medBS = if ($null -ne $medB) { "{0:N3}" -f $medB } else { "n/a" }
    $pAS = if ($null -ne $medPeakA) { "{0:N1}" -f $medPeakA } else { "n/a" }
    $pBS = if ($null -ne $medPeakB) { "{0:N1}" -f $medPeakB } else { "n/a" }
    $cRatioS = if ($cRatio) { "{0:N3}" -f $cRatio } else { "not estimable" }

    $md = @"
# n10-kexp-session REPORT

**Protocol re-read:** PREREG_N10.md **v1.2** (2026-08-21 owner decision). Confirmed re-read before continuing this session.

**Amendment:** v1.1 required N>=10 complete ABBA blocks. v1.2 (pre-analysis, stopping rule fixed before any block result of this session was read) changes the confirmatory target to **N>=5** (20 cells, 10 A + 10 B). Per-block protocol, gates, pins, exclusions, 1.30x floor, temp criterion **unchanged**. Extra OLMoE blocks beyond 5 are not collected: KEXP has priority.

**Pre-amendment blocks:** **0**. The v1.1 harness was not yet running when v1.2 landed. Every OLMoE block in this report is post-amendment, still using the identical per-block protocol.

**Device:** S23 SM-S911U Adreno 740, serial ``adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp``. PC-side ``adb shell`` (not Termux).

**Frozen pins (N>=5 ship cell):** noextra ``libllama-bench-impl.so`` ``d2030f23…``; ``libggml-opencl.so`` ``2ed2e48a…``; OLMoE Q4_K_M ``3bd9ec48…``; ngl=16 both arms; ``-fa off -t 4``; LOG_ALLOC unset; stock extra_bufts ``bad17952…`` FORBIDDEN.

**Status:** $verdict
**Complete blocks:** $($complete.Count) / $TargetComplete  (ids: $($complete -join ', '))
**Primary median tg512 A:** $medAS   **B:** $medBS   **ratio A/B:** $ratioS
**Median peak temp A:** $pAS C   **B:** $pBS C
**Cool-start-only secondary ratio:** $cRatioS  (cool-start complete blocks: $($coolBlocks.Count))
**J/token:** see cell level_pre/post; likely ``not extractable at 1% resolution`` until the full set is in.

## Block table

| block | status | temp_c_block_start | warm_start | level_pre | level_post | tg512 cells | governor | iso_block_start |
|---:|---|---:|---|---:|---:|---|---|---|
$($blockLines -join "`n")

## Cells (csv ground truth)

Raw: ``results/olmoe_gpu_moe_s23/n10/runs.csv``. Do not trust the terminal.

## Mellum2 (exploratory, NOT ship)

Not started until N>=5 OLMoE is in the bag.

## KEXP #14 (exploratory, NOT ship, NOT in the N>=5 median)

Not started. Planned: 3 ABBA blocks if battery allows, q6k cherry opencl ``b9d99fa8…``.

## Abort

$(if ($AbortReason) { $AbortReason } else { "none" })
"@
    $reportDir = Split-Path -Parent $ReportPath
    New-Item -ItemType Directory -Force -Path $reportDir | Out-Null
    Set-Content -Path $ReportPath -Value $md -Encoding utf8
    Set-Content -Path (Join-Path $Root "REPORT.md") -Value $md -Encoding utf8
}

# --- session start ---
Assert-UsbS23
Log "S23 serial=$Serial  protocol=v1.2 TargetComplete=$TargetComplete"
if ($Fresh -and (Test-Path $CsvPath)) {
    Copy-Item $CsvPath "$CsvPath.bak_$(Get-Date -Format yyyyMMdd_HHmmss)" -Force
}
Ensure-Csv
New-Item -ItemType Directory -Force -Path (Join-Path $Root "cells") | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path $ReportPath) | Out-Null

if (-not $SkipRestore) {
    Restore-FrozenStack
} else {
    Assert-FrozenPins
}

$shaBlock = Get-FullShaBlock
Log "SHA_BLOCK`n$shaBlock"
Set-Content -Path (Join-Path $Root "sha_session_start.txt") -Value $shaBlock -Encoding utf8

$pins = Invoke-SessionPins
Write-JsonFile $PinsPath $pins
if ($pins.screen_off_timeout -ne "1800000") {
    Log "WARN screen_off_timeout=$($pins.screen_off_timeout) (wanted 1800000)"
}
if ($pins.screen_brightness -ne "128") {
    Log "WARN brightness=$($pins.screen_brightness) (wanted 128) — recorded value is the pin"
}

Update-N10Report

$seqGlobal = @(Read-CsvRows).Count
$block = 1
if (-not $Fresh) {
    $existing = @(Read-CsvRows | ForEach-Object { [int]$_.block })
    if ($existing.Count -gt 0) { $block = ([int]($existing | Measure-Object -Maximum).Maximum) }
    $completeNow = Get-CompleteBlockIds
    if ($completeNow.Count -ge $TargetComplete) {
        Log "Already have $($completeNow.Count) complete blocks. Stopping OLMoE arm (v1.2)."
        Update-N10Report
        exit 0
    }
    # If current block is incomplete, continue it only if it has 0 cells; else start next.
    $curCells = @((Read-CsvRows) | Where-Object { [int]$_.block -eq $block })
    if ($curCells.Count -eq 4) { $block = $block + 1 }
    elseif ($curCells.Count -gt 0) {
        Log "Incomplete block $block with $($curCells.Count) cells — dropping it (prereg: incomplete not repaired in-place)."
        $block = $block + 1
    }
}

$arms = @("A", "B", "B", "A")

while ((Get-CompleteBlockIds).Count -lt $TargetComplete) {
    Log "=== BLOCK $block start (complete=$((Get-CompleteBlockIds).Count)/$TargetComplete) ==="
    $cool = Invoke-CooldownGate
    Log ("COOLDOWN done warm_start={0} temp_c_block_start={1} cooldown_s={2}" -f $cool.warm_start, $cool.temp_c_block_start, $cool.cooldown_s)

    Assert-Unplugged
    $pause = Wait-BatteryFloorPause -BlockIndex $block
    if ($pause) {
        Log ("battery pause recorded; fresh unplug")
        Assert-Unplugged
        $cool = Invoke-CooldownGate
        Log ("post-pause cooldown warm_start={0} temp_c_block_start={1}" -f $cool.warm_start, $cool.temp_c_block_start)
        Assert-Unplugged
    }

    $bStart = Get-BattHeader
    if ($bStart.level -lt $BatteryFloorPct) {
        Abort-Session "battery floor still below 40 after pause logic — refusing to start block $block"
    }
    $gov = ((Get-GovernorVector) -replace "`r", "" -replace "`n", "; ")
    Log "GOVERNOR $gov"
    $blockMeta = [pscustomobject]@{
        block = $block
        iso = (Get-Date).ToString("o")
        temp_c_block_start = $cool.temp_c_block_start
        warm_start = [bool]$cool.warm_start
        cooldown_s = $cool.cooldown_s
        level_pre = $bStart.level
        governor = $gov
        unplug = $bStart.raw
    }
    Write-JsonFile (Join-Path $Root ("block_{0:D2}_meta.json" -f $block)) $blockMeta

    $cellOk = 0
    for ($ci = 0; $ci -lt 4; $ci++) {
        $arm = $arms[$ci]
        $experts = if ($arm -eq "A") { "GPU" } else { "CPU" }
        $extra = if ($arm -eq "A") { "-ngl $NglN10" } else { "-ngl $NglN10 -ncmoe 99" }
        $seqGlobal++
        $tag = "b{0:D2}_c{1}_{2}" -f $block, ($ci + 1), $arm
        Log "=== CELL $tag experts=$experts $extra ==="

        # sha on-device before every run (prereg)
        $shaImpl = Get-OnDeviceSha "libllama-bench-impl.so"
        $shaOcl = Get-OnDeviceSha "libggml-opencl.so"
        if ($shaImpl.sha -ne $PinImplNoex) { Abort-Session "impl sha drifted before $tag got=$($shaImpl.sha)" }
        if ($shaImpl.line -match $PinImplStock) { Abort-Session "stock extra_bufts on device before $tag" }
        if ($shaOcl.sha -ne $PinOpencl) { Abort-Session "opencl sha drifted before $tag got=$($shaOcl.sha)" }

        $wake = Invoke-WakeGate
        $excluded = $false
        $exclReason = ""
        $tg = ""
        $rc = ""
        $pre = $null
        $post = $null
        $outLog = Join-Path $Root "cells\$tag.stdout.txt"

        $ccPre = ""
        $ccPost = ""
        try {
            if ($wake.excluded) {
                $excluded = $true
                $exclReason = "wake_not_awake:$($wake.wake)"
                Log "EXCLUDE $tag $exclReason"
                $pre = Write-Sensors "${tag}_PRE_EXCL"
                $ccPre = (Get-BattHeader).charge_counter
                $post = $pre
                $ccPost = $ccPre
                $rc = "NA"
            } else {
                $pre = Write-Sensors "${tag}_PRE"
                $ccPre = (Get-BattHeader).charge_counter
                $errRemote = "$DevDir/logs/$tag.err"
                $cmd = "sh $DevDir/one_cell.sh $extra -p 0 -n 512 -r 1 2>$errRemote"
                Log "RUN $cmd"
                & $Adb -s $Serial shell $cmd 2>&1 | Tee-Object -FilePath $outLog
                $rc = $LASTEXITCODE
                Log "RC $tag rc=$rc"
                try { $post = Write-Sensors "${tag}_POST" } catch { Abort-Session "adb/sensors failed after $tag rc=$rc — possible power-off" }
                try { $ccPost = (Get-BattHeader).charge_counter } catch { $ccPost = "" }
                if ($rc -eq 255) { Abort-Session "adb 255 on $tag" }
                if ($rc -ne 0) { Abort-Session "llama-bench rc=$rc on $tag (wall-class)" }
                $memPre = [int64]$pre.mem_available_kb
                $memPost = [int64]$post.mem_available_kb
                $drop = $memPre - $memPost
                Log "MemAvailable drop_kb=$drop (cliff=${MemCliffKb})"
                if ($drop -ge $MemCliffKb) {
                    Abort-Session "oomwall-class MemAvailable drop $drop kB (>= $MemCliffKb) on $tag"
                }
                $tgN = Parse-Tg512 $outLog
                if ($null -eq $tgN) { Abort-Session "no tg512 parse from $outLog" }
                $tg = ("{0:N6}" -f $tgN)
                $cellOk++
            }
        } catch {
            if ($_.Exception.Message -match "SESSION ABORT") { throw }
            Abort-Session "exception on $tag : $($_.Exception.Message)"
        }

        $peak = ""
        if ($pre -and $post -and $pre.temp_c -ne "" -and $post.temp_c -ne "") {
            $peak = [math]::Max([double]$pre.temp_c, [double]$post.temp_c)
        }
        $row = [pscustomobject]@{
            block = $block
            cell_in_block = ($ci + 1)
            seq_global = $seqGlobal
            arm = $arm
            experts = $experts
            ngl = $NglN10
            p = 0
            n = 512
            rc = $rc
            stdout_file = (Split-Path $outLog -Leaf)
            excluded = $excluded
            exclude_reason = $exclReason
            level_pre = $pre.level
            temp_c_pre = $pre.temp_c
            wake_pre = $pre.wake
            mem_avail_pre = $pre.mem_available_kb
            mem_free_pre = $pre.mem_free_kb
            level_post = $post.level
            temp_c_post = $post.temp_c
            wake_post = $post.wake
            mem_avail_post = $post.mem_available_kb
            mem_free_post = $post.mem_free_kb
            iso_pre = $pre.iso
            iso_post = $post.iso
            tg512 = $tg
            temp_peak = $peak
            temp_c_block_start = $cool.temp_c_block_start
            warm_start = $cool.warm_start
            governor = ($gov -replace ",", ";")
            charge_counter_pre = $ccPre
            charge_counter_post = $ccPost
            sha_impl = $shaImpl.sha
            sha_opencl = $shaOcl.sha
            complete_block = ""
        }
        $row | Export-Csv -Path $CsvPath -Append -NoTypeInformation -Encoding utf8
        Update-N10Report
        Start-Sleep -Seconds 2
    }

    # mark complete_block on the 4 rows if all 4 counted
    $complete = ($cellOk -eq 4)
    Log "BLOCK $block complete=$complete cellOk=$cellOk"
    $st = @{
        last_block = $block
        complete_ids = @(Get-CompleteBlockIds)
        iso = (Get-Date).ToString("o")
    }
    Write-JsonFile $StatePath $st
    Update-N10Report
    $block++
}

Log "OLMoE arm done. complete=$((Get-CompleteBlockIds).Count) target=$TargetComplete"
Update-N10Report
Write-Host "OLMoE N>=5 finished. See $ReportPath and $CsvPath"
