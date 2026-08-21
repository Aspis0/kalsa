# EXPLORATORY Mellum2 block AFTER OLMoE N>=5 is in the bag.
# NOT part of the 1.30x ship median. Frozen pins stay (noextra d2030f23, opencl 2ed2e48a).
# Order: ngl=2 -ncmoe 99 load sanity, then one experts-GPU cell at ngl=2 if that lived.
# Any power-off / adb 255 / MemAvailable cliff -> stop Mellum2 immediately. Do not touch OLMoE dataset.
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $Root "_lib_n10.ps1")

$PinMellum = "b04281c27de5d968d577f310d982273b1b13bdbd8117b3ecffffeebfe222f0a7"
$MellumName = "Mellum2-12B-A2.5B-Instruct-Q4_K_M.gguf"
$PcMellum = [IO.Path]::GetFullPath((Join-Path $OlmoeRoot "..\..\models\$MellumName"))
$ReportPath = [IO.Path]::GetFullPath((Join-Path $OlmoeRoot "..\..\scratchpad\agents\n10-kexp-session\REPORT.md"))
$OutDir = Join-Path $Root "mellum2"
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

function Log([string]$Msg) {
    $line = "{0} {1}" -f (Get-Date).ToString("o"), $Msg
    Write-Host $line
    Add-Content -Path (Join-Path $OutDir "mellum2.log") -Value $line -Encoding utf8
}

function Abort-Mellum([string]$Reason) {
    Log "MELLUM2 STOP: $Reason"
    Add-Content -Path $ReportPath -Value "`n## Mellum2 (exploratory) STOP`n`n- $Reason`n- OLMoE N>=5 dataset left untouched.`n" -Encoding utf8
    throw "MELLUM2 STOP: $Reason"
}

Assert-UsbS23
Assert-Unplugged
Assert-FrozenPins
if (-not (Test-Path $PcMellum)) { throw "missing $PcMellum" }
$h = (Get-FileHash -Algorithm SHA256 $PcMellum).Hash.ToLower()
if ($h -ne $PinMellum) { throw "PC Mellum2 sha $h != $PinMellum" }

$need = $true
try {
    $got = Get-OnDeviceSha $MellumName
    if ($got.sha -eq $PinMellum) { $need = $false; Log "Mellum2 already on device" }
} catch { $need = $true }
if ($need) {
    Log "push Mellum2 7.5 GiB"
    Invoke-S23 @("push", $PcMellum, "$DevDir/$MellumName")
}
CheckSha $MellumName $PinMellum
Invoke-S23 @("push", (Join-Path $Root "one_cell_mellum2.sh"), "$DevDir/one_cell_mellum2.sh")
AdbOut "chmod 755 $DevDir/one_cell_mellum2.sh" | Out-Null

function Run-MellumCell([string]$Tag, [string]$Extra, [int]$N, [string]$Note) {
    Log "=== MELLUM2 $Tag $Extra -p 0 -n $N  ($Note) ==="
    $shaImpl = Get-OnDeviceSha "libllama-bench-impl.so"
    $shaOcl = Get-OnDeviceSha "libggml-opencl.so"
    if ($shaImpl.sha -ne $PinImplNoex) { Abort-Mellum "impl pin drifted" }
    if ($shaOcl.sha -ne $PinOpencl) { Abort-Mellum "opencl pin drifted (must stay frozen 2ed2e48a for Mellum2)" }
    $wake = Invoke-WakeGate
    if ($wake.excluded) { Abort-Mellum "wake not Awake — not a ship cell; stopping Mellum2 rather than faking a number" }
    $batt = Get-BattHeader
    if ($batt.level -lt 40) { Abort-Mellum "battery floor before Mellum2 cell" }
    $pre = Write-Sensors "${Tag}_PRE"
    $outLog = Join-Path $OutDir "$Tag.stdout.txt"
    $cmd = "sh $DevDir/one_cell_mellum2.sh $Extra -p 0 -n $N -r 1 2>$DevDir/logs/$Tag.err"
    Log "RUN $cmd"
    try {
        & $Adb -s $Serial shell $cmd 2>&1 | Tee-Object -FilePath $outLog
        $rc = $LASTEXITCODE
    } catch {
        Abort-Mellum "adb exception (possible power-off): $($_.Exception.Message)"
    }
    Log "RC $Tag rc=$rc"
    if ($rc -eq 255) { Abort-Mellum "adb 255 / possible power-off on $Tag" }
    try { $post = Write-Sensors "${Tag}_POST" } catch { Abort-Mellum "sensors failed after $Tag — possible power-off" }
    $drop = [int64]$pre.mem_available_kb - [int64]$post.mem_available_kb
    if ($drop -ge $MemCliffKb) { Abort-Mellum "MemAvailable cliff $drop kB on $Tag" }
    if ($rc -ne 0) { Abort-Mellum "llama-bench rc=$rc on $Tag" }
    $tg = $null
    Get-Content $outLog | ForEach-Object {
        $t = $_.Trim()
        if ($t.StartsWith("{")) {
            try {
                $j = $t | ConvertFrom-Json
                if ($j.n_gen -eq $N) { $tg = [double]$j.avg_ts }
            } catch {}
        }
    }
    $rec = [pscustomobject]@{
        tag = $Tag; extra = $Extra; n = $N; rc = $rc; tg = $tg
        level_pre = $pre.level; level_post = $post.level
        temp_c_pre = $pre.temp_c; temp_c_post = $post.temp_c
        mem_avail_pre = $pre.mem_available_kb; mem_avail_post = $post.mem_available_kb
        note = $Note
    }
    Write-JsonFile (Join-Path $OutDir "$Tag.json") $rec
    return $rec
}

Assert-Unplugged
$cool = Invoke-CooldownGate
Log ("mellum2 cooldown warm_start={0} temp={1}" -f $cool.warm_start, $cool.temp_c_block_start)

# 1) load sanity: dense GPU / experts CPU
$r1 = Run-MellumCell -Tag "m2_ngl2_ncmoe99" -Extra "-ngl 2 -ncmoe 99" -N 16 -Note "load sanity experts=CPU"
Log ("sanity lived tg={0}" -f $r1.tg)

# 2) one experts-GPU cell at ngl=2
$r2 = Run-MellumCell -Tag "m2_ngl2_gpu_experts" -Extra "-ngl 2" -N 512 -Note "EXPLORATORY experts=GPU tg512"

$summary = @"

## Mellum2 (exploratory, NOT ship)

Lived. Frozen pins unchanged. OLMoE dataset untouched.

| cell | extra | n | tg t/s | temp C | batt | MemAvailable kB |
|---|---|---:|---:|---|---|---|
| load sanity | -ngl 2 -ncmoe 99 | 16 | $($r1.tg) | $($r1.temp_c_pre) -> $($r1.temp_c_post) | $($r1.level_pre)->$($r1.level_post) | $($r1.mem_avail_pre)->$($r1.mem_avail_post) |
| experts GPU | -ngl 2 | 512 | $($r2.tg) | $($r2.temp_c_pre) -> $($r2.temp_c_post) | $($r2.level_pre)->$($r2.level_post) | $($r2.mem_avail_pre)->$($r2.mem_avail_post) |

Raw: ``results/olmoe_gpu_moe_s23/n10/mellum2/``
"@
Add-Content -Path $ReportPath -Value $summary -Encoding utf8
Add-Content -Path (Join-Path $Root "REPORT.md") -Value $summary -Encoding utf8
Log "Mellum2 exploratory done"
Write-Host "Mellum2 done. See $OutDir"
