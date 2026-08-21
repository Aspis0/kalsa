# Sustained thermal-valve leg: 4 consecutive tg512 per arm (A then B), same ngl.
# NOEXTRA impl, -fa off, LOG_ALLOC off. REFUSES if plugged.
param([int]$Ngl = 0, [int]$Repeats = 4)
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $Root "_lib.ps1")
Assert-UsbS23
Assert-Unplugged
Assert-NoextraImpl
CheckSha $OlmoeName $PinOlmoe

if ($Ngl -le 0) {
    $nglFile = Join-Path $Root "ngl.txt"
    if (Test-Path $nglFile) { $Ngl = [int](Get-Content $nglFile | Select-Object -First 1) }
    else { $Ngl = 4 }
}

Invoke-S23 @("push", (Join-Path $Root "one_cell.sh"), "$DevDir/one_cell.sh")
AdbOut "chmod 755 $DevDir/one_cell.sh" | Out-Null

$csv = Join-Path $Root "runs.csv"
if (-not (Test-Path $csv)) {
    "seq,block,arm,experts,ngl,p,n,rc,stdout_file,level_pre,temp_c_pre,wake_pre,mem_avail_pre,mem_free_pre,level_post,temp_c_post,wake_post,mem_avail_post,mem_free_post,iso_pre,iso_post" |
        Set-Content -Path $csv -Encoding utf8
}

$i = 0
foreach ($arm in @("A","B")) {
    $extra = if ($arm -eq "A") { "-ngl $Ngl" } else { "-ngl $Ngl -ncmoe 99" }
    $experts = if ($arm -eq "A") { "GPU" } else { "CPU" }
    for ($k = 1; $k -le $Repeats; $k++) {
        $i++
        $tag = "sus_{0}_{1}_{2}" -f $arm, $k, $i
        Write-Host "=== SUSTAIN $tag ngl=$Ngl experts=$experts tg512 ==="
        $pre = Write-Sensors "${tag}_PRE"
        $errRemote = "$DevDir/logs/$tag.err"
        $outLog = Join-Path $Root "$tag.stdout.txt"
        $cmd = "sh $DevDir/one_cell.sh $extra -p 0 -n 512 -r 1 2>$errRemote"
        & $Adb -s $Serial shell $cmd 2>&1 | Tee-Object -FilePath $outLog
        $rc = $LASTEXITCODE
        $post = Write-Sensors "${tag}_POST"
        $relOut = Split-Path $outLog -Leaf
        $line = "{0},{1},{2},{3},{4},0,512,{5},{6},{7},{8},""{9}"",{10},{11},{12},{13},""{14}"",{15},{16},{17},{18}" -f `
            $i, "SUSTAIN", $arm, $experts, $Ngl, $rc, $relOut, `
            $pre.level, $pre.temp_c, $pre.wake, $pre.mem_available_kb, $pre.mem_free_kb, `
            $post.level, $post.temp_c, $post.wake, $post.mem_available_kb, $post.mem_free_kb, `
            $pre.iso, $post.iso
        Add-Content -Path $csv -Value $line -Encoding utf8
        if ($rc -eq 255) { Write-Host "device likely down — STOP"; break }
        Start-Sleep -Seconds 2
    }
}
Write-Host "SUSTAIN done. Temp curve is in $csv (temp_c_pre/post per consecutive tg512)."
