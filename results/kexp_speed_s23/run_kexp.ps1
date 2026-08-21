# EXPLORATORY queue #14: KEXP-on-GPU A/B on LFM2.5-8B-A1B-KEXP.gguf
# NOT ship. NOT part of the OLMoE N>=5 median.
# OpenCL = q6k cherry b9d99fa8 (q2_K/q3_K MoE kernels + q6_K dense). Same .so both arms.
# llama-bench stub from s3oracle tree (byte-identical b2ae0fa6); impl = noextra d2030f23
# (stock extra_bufts bad17952 FORBIDDEN — oomwall). 3 ABBA blocks of tg512 if battery allows.
param([int]$TargetComplete = 3)
$ErrorActionPreference = "Stop"
$KexpRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$N10Root = [IO.Path]::GetFullPath((Join-Path $KexpRoot "..\olmoe_gpu_moe_s23\n10"))
. (Join-Path $N10Root "_lib_n10.ps1")

$PinOpenclKexp = "b9d99fa8d8be3e40661fb2edbde27229d8666fcc58c481cbb0944dd0cfd36773"
$PinKexpGguf = "b07c80870f8a864549f4a419ccbfb4d4282ba2d55a2e8d808b7c377d3fc6c3f4"
$KexpGgufName = "LFM2.5-8B-A1B-KEXP.gguf"
$KexpGgufDev = "/data/local/tmp/$KexpGgufName"
$PcOpenclKexp = [IO.Path]::GetFullPath((Join-Path $OlmoeRoot "..\..\build-android-opencl-s3oracle\bin\libggml-opencl.so"))
$ReportPath = [IO.Path]::GetFullPath((Join-Path $OlmoeRoot "..\..\scratchpad\agents\n10-kexp-session\REPORT.md"))
$CsvPath = Join-Path $KexpRoot "runs.csv"
$NglKexp = 99

function Log([string]$Msg) {
    $line = "{0} {1}" -f (Get-Date).ToString("o"), $Msg
    Write-Host $line
    Add-Content -Path (Join-Path $KexpRoot "kexp.log") -Value $line -Encoding utf8
}
function Abort-Kexp([string]$Reason) {
    Log "KEXP ABORT: $Reason"
    Add-Content -Path $ReportPath -Value "`n## KEXP #14 ABORT`n`n- $Reason`n- Exploratory only. OLMoE N>=5 dataset left untouched.`n" -Encoding utf8
    @"
# KEXP ABORT
$Reason
"@ | Set-Content -Path (Join-Path $KexpRoot "ABORT.md") -Encoding utf8
    throw "KEXP ABORT: $Reason"
}

function Update-KexpReport {
    $rows = @()
    if (Test-Path $CsvPath) { $rows = @(Import-Csv $CsvPath) }
    $complete = @()
    foreach ($g in ($rows | Group-Object block)) {
        $cells = @($g.Group)
        $ok = @($cells | Where-Object { $_.rc -eq "0" -and $_.excluded -ne "True" -and $_.excluded -ne "true" })
        if ($cells.Count -eq 4 -and $ok.Count -eq 4) { $complete += [int]$g.Name }
    }
    $counted = @($rows | Where-Object { $complete -contains [int]$_.block })
    $a = @($counted | Where-Object { $_.arm -eq "A" } | ForEach-Object { [double]$_.tg512 })
    $b = @($counted | Where-Object { $_.arm -eq "B" } | ForEach-Object { [double]$_.tg512 })
    $medA = Get-Median $a
    $medB = Get-Median $b
    $ratio = if ($medA -and $medB -and $medB -ne 0) { $medA / $medB } else { $null }
    $lines = @()
    foreach ($bid in ($rows | ForEach-Object { [int]$_.block } | Sort-Object -Unique)) {
        $cs = @($rows | Where-Object { [int]$_.block -eq $bid } | Sort-Object { [int]$_.cell_in_block })
        if ($cs.Count -eq 0) { continue }
        $h = $cs[0]
        $st = if ($complete -contains $bid) { "COMPLETE" } else { "INCOMPLETE" }
        $tgs = ($cs | ForEach-Object { "{0}:{1}" -f $_.arm, $_.tg512 }) -join " "
        $lines += ("| {0} | {1} | {2} | {3} | {4} | {5} | {6} |" -f $bid, $st, $h.temp_c_block_start, $h.warm_start, $h.level_pre, $tgs, $h.governor)
    }
    $ratioS = if ($ratio) { "{0:N3}" -f $ratio } else { "n/a" }
    $section = @"

## KEXP #14 (exploratory, NOT ship, NOT in the OLMoE N>=5 median)

Protocol: ABBA x $TargetComplete, tg512, -fa off -t 4. Arm A = ``-ngl 99`` (experts GPU). Arm B = ``-ngl 99 -ncmoe 99`` (experts CPU). OpenCL ``b9d99fa8…``. noextra impl ``d2030f23…``. Same .so both arms.

**Complete blocks:** $($complete.Count) / $TargetComplete
**Exploratory median tg512 A:** $(if ($medA) { '{0:N3}' -f $medA } else { 'n/a' })  **B:** $(if ($medB) { '{0:N3}' -f $medB } else { 'n/a' })  **ratio:** $ratioS

| block | status | temp_c_block_start | warm_start | level_pre | tg512 | governor |
|---:|---|---:|---|---:|---|---|
$($lines -join "`n")

Raw: ``results/kexp_speed_s23/runs.csv``
"@
    $report = Get-Content -Path $ReportPath -Raw -ErrorAction SilentlyContinue
    if ($null -eq $report) { $report = "" }
    $marker = "## KEXP #14"
    $idx = $report.IndexOf($marker)
    if ($idx -ge 0) { $report = $report.Substring(0, $idx) }
    Set-Content -Path $ReportPath -Value ($report.TrimEnd() + "`n" + $section) -Encoding utf8
    Set-Content -Path (Join-Path $KexpRoot "REPORT.md") -Value $section -Encoding utf8
}

Assert-UsbS23
Log "KEXP exploratory start TargetComplete=$TargetComplete serial=$Serial"
New-Item -ItemType Directory -Force -Path (Join-Path $KexpRoot "cells") | Out-Null

if (-not (Test-Path $PcOpenclKexp)) { throw "missing $PcOpenclKexp — q6k cherry build" }
$hO = (Get-FileHash -Algorithm SHA256 $PcOpenclKexp).Hash.ToLower()
if ($hO -ne $PinOpenclKexp) { throw "PC q6k opencl $hO != $PinOpenclKexp" }

Log "swap libggml-opencl.so -> q6k cherry b9d99fa8 (OLMoE ship dataset already on disk, not overwritten)"
Invoke-S23 @("push", $PcOpenclKexp, "$DevDir/libggml-opencl.so")
$ocl = Get-OnDeviceSha "libggml-opencl.so"
if ($ocl.sha -ne $PinOpenclKexp) { Abort-Kexp "opencl on-device $($ocl.sha) != $PinOpenclKexp" }
$impl = Get-OnDeviceSha "libllama-bench-impl.so"
if ($impl.sha -ne $PinImplNoex) { Abort-Kexp "noextra impl drifted: $($impl.sha)" }
if ($impl.line -match $PinImplStock) { Abort-Kexp "stock extra_bufts on device" }

Invoke-S23 @("push", (Join-Path $KexpRoot "one_cell_kexp.sh"), "$DevDir/one_cell_kexp.sh")
AdbOut "chmod 755 $DevDir/one_cell_kexp.sh" | Out-Null

$ggufLine = AdbOut "sha256sum $KexpGgufDev"
Log "KEXP GGUF $ggufLine"
$ggufSha = (($ggufLine -split "\s+")[0]).ToLower()
if ($ggufSha -ne $PinKexpGguf) { Abort-Kexp "KEXP gguf sha $ggufSha != $PinKexpGguf" }

$shaBlock = AdbOut "cd $DevDir && sha256sum llama-bench libllama-bench-impl.so libllama.so libggml-opencl.so libggml.so libggml-base.so libggml-cpu.so libllama-common.so"
Log "SHA_BLOCK`n$shaBlock"
Set-Content -Path (Join-Path $KexpRoot "sha_session_start.txt") -Value "$shaBlock`n$ggufLine" -Encoding utf8

@"
# KEXP #14 exploratory manifest

NOT ship. OpenCL q6k cherry ``$PinOpenclKexp``. noextra impl ``$PinImplNoex``. GGUF ``$PinKexpGguf`` at ``$KexpGgufDev``.
A: -ngl 99. B: -ngl 99 -ncmoe 99. -fa off -t 4. tg512. ABBA x $TargetComplete.
llama-bench stub is the s3oracle stub ``$PinBenchStub`` (byte-identical in ``build-android-opencl-s3oracle/bin/llama-bench``).
Did **not** push stock ``libllama-bench-impl.so`` from that bin (sha bad17952, extra_bufts=true, oomwall-class).
"@ | Set-Content -Path (Join-Path $KexpRoot "MANIFEST.md") -Encoding utf8

$arms = @("A", "B", "B", "A")
$block = 1
$seq = 0
Update-KexpReport

while ($true) {
    $done = 0
    if (Test-Path $CsvPath) {
        foreach ($g in (Import-Csv $CsvPath | Group-Object block)) {
            $ok = @($g.Group | Where-Object { $_.rc -eq "0" -and $_.excluded -ne "True" })
            if ($g.Group.Count -eq 4 -and $ok.Count -eq 4) { $done++ }
        }
    }
    if ($done -ge $TargetComplete) { break }

    Log "=== KEXP BLOCK $block (complete=$done/$TargetComplete) ==="
    $cool = Invoke-CooldownGate
    Assert-Unplugged
    $pause = Wait-BatteryFloorPause -BlockIndex $block
    if ($pause) { Assert-Unplugged; $cool = Invoke-CooldownGate; Assert-Unplugged }
    $batt = Get-BattHeader
    if ($batt.level -lt 40) { Abort-Kexp "battery floor at KEXP block $block" }
    $gov = ((Get-GovernorVector) -replace "`r", "" -replace "`n", "; ")
    Log "GOVERNOR $gov  temp_start=$($cool.temp_c_block_start) warm=$($cool.warm_start) level=$($batt.level)"

    $cellOk = 0
    for ($ci = 0; $ci -lt 4; $ci++) {
        $arm = $arms[$ci]
        $extra = if ($arm -eq "A") { "-ngl $NglKexp" } else { "-ngl $NglKexp -ncmoe 99" }
        $experts = if ($arm -eq "A") { "GPU" } else { "CPU" }
        $seq++
        $tag = "k_b{0:D2}_c{1}_{2}" -f $block, ($ci + 1), $arm
        Log "=== $tag $extra ==="
        $shaImpl = Get-OnDeviceSha "libllama-bench-impl.so"
        $shaOcl = Get-OnDeviceSha "libggml-opencl.so"
        if ($shaImpl.sha -ne $PinImplNoex) { Abort-Kexp "impl drifted before $tag" }
        if ($shaOcl.sha -ne $PinOpenclKexp) { Abort-Kexp "opencl drifted before $tag got=$($shaOcl.sha)" }
        $wake = Invoke-WakeGate
        $outLog = Join-Path $KexpRoot "cells\$tag.stdout.txt"
        $excluded = $false
        $exclReason = ""
        $tg = ""
        $rc = "NA"
        if ($wake.excluded) {
            $excluded = $true
            $exclReason = "wake_not_awake:$($wake.wake)"
            $pre = Write-Sensors "${tag}_PRE_EXCL"
            $post = $pre
        } else {
            $pre = Write-Sensors "${tag}_PRE"
            $cmd = "sh $DevDir/one_cell_kexp.sh $extra -p 0 -n 512 -r 1 2>$DevDir/logs/$tag.err"
            Log "RUN $cmd"
            try {
                & $Adb -s $Serial shell $cmd 2>&1 | Tee-Object -FilePath $outLog
                $rc = $LASTEXITCODE
            } catch { Abort-Kexp "adb exception $tag $($_.Exception.Message)" }
            Log "RC $tag rc=$rc"
            try { $post = Write-Sensors "${tag}_POST" } catch { Abort-Kexp "sensors failed after $tag — possible power-off" }
            if ($rc -eq 255) { Abort-Kexp "adb 255 on $tag" }
            if ($rc -ne 0) { Abort-Kexp "llama-bench rc=$rc on $tag" }
            $drop = [int64]$pre.mem_available_kb - [int64]$post.mem_available_kb
            if ($drop -ge $MemCliffKb) { Abort-Kexp "MemAvailable cliff $drop kB on $tag" }
            $tgN = Parse-Tg512 $outLog
            if ($null -eq $tgN) { Abort-Kexp "no tg512 in $outLog" }
            $tg = "{0:N6}" -f $tgN
            $cellOk++
        }
        $peak = ""
        if ($pre.temp_c -ne "" -and $post.temp_c -ne "") {
            $peak = [math]::Max([double]$pre.temp_c, [double]$post.temp_c)
        }
        $row = [pscustomobject]@{
            block = $block; cell_in_block = ($ci + 1); seq_global = $seq
            arm = $arm; experts = $experts; ngl = $NglKexp; p = 0; n = 512
            rc = $rc; stdout_file = (Split-Path $outLog -Leaf)
            excluded = $excluded; exclude_reason = $exclReason
            level_pre = $pre.level; temp_c_pre = $pre.temp_c; wake_pre = $pre.wake
            mem_avail_pre = $pre.mem_available_kb; mem_free_pre = $pre.mem_free_kb
            level_post = $post.level; temp_c_post = $post.temp_c; wake_post = $post.wake
            mem_avail_post = $post.mem_available_kb; mem_free_post = $post.mem_free_kb
            iso_pre = $pre.iso; iso_post = $post.iso; tg512 = $tg; temp_peak = $peak
            temp_c_block_start = $cool.temp_c_block_start; warm_start = $cool.warm_start
            governor = $gov; sha_impl = $shaImpl.sha; sha_opencl = $shaOcl.sha
            label = "exploratory_kexp"
        }
        $row | Export-Csv -Path $CsvPath -Append -NoTypeInformation -Encoding utf8
        Update-KexpReport
        Start-Sleep -Seconds 2
    }
    Log "KEXP BLOCK $block cellOk=$cellOk"
    $block++
}

Log "KEXP exploratory done complete=$TargetComplete"
Update-KexpReport
Write-Host "KEXP done. See $KexpRoot and $ReportPath"
