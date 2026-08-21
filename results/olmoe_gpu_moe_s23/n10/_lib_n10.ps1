# N>=10 v1.1 helpers. Dot-source parent _lib.ps1 first.
# Do not dump full dumpsys power. Header-only battery, mWakefulness grep only.
$ErrorActionPreference = "Stop"

$N10Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$OlmoeRoot = Split-Path -Parent $N10Root
. (Join-Path $OlmoeRoot "_lib.ps1")

$PinOlmoeFull = $PinOlmoe
$MemCliffKb = 2 * 1024 * 1024  # 2.0 GiB in /proc/meminfo kB units
$CooldownLimitC = 35.0
$CooldownTimeoutSec = 600
$BatteryFloorPct = 40
$BatteryResumeTargetPct = 60
$NglN10 = 16

$PcOpenclFrozen = [IO.Path]::GetFullPath((Join-Path $OlmoeRoot "..\oomwall_s23\libggml-opencl.2ed2e48a.so"))
$PcImplNoex = [IO.Path]::GetFullPath((Join-Path $OlmoeRoot "..\oomwall_s23\staging\noextra\libllama-bench-impl.so"))
$PcBenchStub = [IO.Path]::GetFullPath((Join-Path $OlmoeRoot "..\oomwall_s23\staging\noextra\llama-bench"))
$PcLlamaSo = [IO.Path]::GetFullPath((Join-Path $OlmoeRoot "..\oomwall_s23\staging\noextra\libllama.so"))
$PcOlmoe = [IO.Path]::GetFullPath((Join-Path $OlmoeRoot "..\..\models\$OlmoeName"))
$PcOneCell = Join-Path $OlmoeRoot "one_cell.sh"
$PinLlamaSo = "f8b11fc34be81291c01cc77a657d267eaf7f102ed6cb6ef708bbaab7730a667d"
$PinGgml = "3f07bb31e79da8698635286a1a39dd2f21836e32dff9bdf578a1cce01351fb27"
$PinGgmlCpu = "fd9cb4b1f49c60a64eea964a4c19200c2878b74df450bc287cbbe6fdf8dcb0da"
$PinBenchStub = "b2ae0fa6c413a5049a87b0706f2687cd7035ae5e43985fe40779dc0a7d225b2c"

function Get-BattHeader {
    $hdr = AdbOut "dumpsys battery | grep -E '^  (USB|AC|Wireless) powered:|^  status:|^  level:|^  temperature:|^  Charge counter:'"
    $lvl = ([regex]::Match($hdr, "(?m)^  level:\s*(\d+)")).Groups[1].Value
    $tempRaw = ([regex]::Match($hdr, "(?m)^  temperature:\s*(\d+)")).Groups[1].Value
    $cc = ([regex]::Match($hdr, "(?m)^  Charge counter:\s*(-?\d+)")).Groups[1].Value
    $usb = ([regex]::Match($hdr, "(?m)^  USB powered:\s*(true|false)")).Groups[1].Value
    $ac = ([regex]::Match($hdr, "(?m)^  AC powered:\s*(true|false)")).Groups[1].Value
    $wl = ([regex]::Match($hdr, "(?m)^  Wireless powered:\s*(true|false)")).Groups[1].Value
    $tempC = if ($tempRaw) { [math]::Round([int]$tempRaw / 10.0, 1) } else { $null }
    return [pscustomobject]@{
        raw = $hdr
        level = if ($lvl) { [int]$lvl } else { $null }
        temp_c = $tempC
        temp_raw = $tempRaw
        charge_counter = $cc
        usb = $usb
        ac = $ac
        wireless = $wl
    }
}

function Get-WakeOnly {
    # Single grep line. Never dump full dumpsys power.
    return (AdbOut "dumpsys power | grep mWakefulness=").Trim()
}

function Test-WakeAwake([string]$WakeLine) {
    return ($WakeLine -match "mWakefulness=Awake") -and ($WakeLine -notmatch "mWakefulness=Asleep") -and ($WakeLine -notmatch "mWakefulness=Dozing")
}

function Invoke-WakeGate {
    $w = Get-WakeOnly
    if (Test-WakeAwake $w) {
        return [pscustomobject]@{ ok = $true; wake = $w; excluded = $false }
    }
    Write-Host "WAKE: not Awake ($w) — KEYCODE_WAKEUP"
    AdbOut "input keyevent KEYCODE_WAKEUP" | Out-Null
    Start-Sleep -Seconds 1
    $w2 = Get-WakeOnly
    if (Test-WakeAwake $w2) {
        return [pscustomobject]@{ ok = $true; wake = $w2; excluded = $false }
    }
    Write-Host "WAKE: still not Awake ($w2) — EXCLUDE cell"
    return [pscustomobject]@{ ok = $false; wake = $w2; excluded = $true }
}

function Get-GovernorVector {
    $txt = AdbOut 'for g in /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor; do echo "$(basename $(dirname $(dirname $g))):$(cat $g)"; done'
    return ($txt -replace "\r", "").Trim()
}

function Invoke-SessionPins {
    Write-Host "=== session pins (v1.1) ==="
    AdbOut "settings put system screen_off_timeout 1800000" | Out-Null
    AdbOut "settings put system screen_brightness_mode 0" | Out-Null
    AdbOut "settings put system screen_brightness 128" | Out-Null
    $timeout = (AdbOut "settings get system screen_off_timeout").Trim()
    $bright = (AdbOut "settings get system screen_brightness").Trim()
    $bmode = (AdbOut "settings get system screen_brightness_mode").Trim()
    $wifi = (AdbOut "settings get global wifi_on").Trim()
    $gov = Get-GovernorVector
    $obj = [pscustomobject]@{
        iso = (Get-Date).ToString("o")
        screen_off_timeout = $timeout
        screen_brightness = $bright
        screen_brightness_mode = $bmode
        wifi_on = $wifi
        governor_at_session_start = $gov
    }
    Write-Host ("PIN screen_off_timeout={0} brightness={1} mode={2} wifi_on={3}" -f $timeout, $bright, $bmode, $wifi)
    Write-Host "PIN governor_start: $gov"
    return $obj
}

function Invoke-CooldownGate {
    $t0 = Get-Date
    $deadline = $t0.AddSeconds($CooldownTimeoutSec)
    while ($true) {
        $b = Get-BattHeader
        $c = $b.temp_c
        $elapsed = [int]((Get-Date) - $t0).TotalSeconds
        Write-Host ("COOLDOWN temp_c={0} elapsed_s={1} level={2}" -f $c, $elapsed, $b.level)
        if ($null -ne $c -and $c -le $CooldownLimitC) {
            return [pscustomobject]@{
                warm_start = $false
                temp_c_block_start = $c
                cooldown_s = $elapsed
            }
        }
        if ((Get-Date) -ge $deadline) {
            Write-Host ("COOLDOWN timeout 10min — warm-start flag, temp_c={0} (NOT abort)" -f $c)
            return [pscustomobject]@{
                warm_start = $true
                temp_c_block_start = $c
                cooldown_s = $elapsed
            }
        }
        Start-Sleep -Seconds 15
    }
}

function Wait-BatteryFloorPause {
    param([int]$BlockIndex)
    $b = Get-BattHeader
    if ($null -eq $b.level -or $b.level -ge $BatteryFloorPct) {
        return $null
    }
    $pauseDir = Join-Path $N10Root "pauses"
    New-Item -ItemType Directory -Force -Path $pauseDir | Out-Null
    $tStart = Get-Date
    $rec = [ordered]@{
        block_index_where_pause = $BlockIndex
        pause_t_start = $tStart.ToString("o")
        level_at_pause = $b.level
        temp_c_at_pause = $b.temp_c
        charge_counter_at_pause = $b.charge_counter
        note = "USB/AC plug allowed ONLY during this pause. Wi-Fi must stay constant. Resume gate is still 40% after unplug; recommended charge >=60%."
    }
    $pauseFile = Join-Path $pauseDir ("pause_block{0:D2}_{1}.json" -f $BlockIndex, $tStart.ToString("yyyyMMdd_HHmmss"))
    ($rec | ConvertTo-Json) | Set-Content -Path $pauseFile -Encoding utf8
    Write-Host "BATTERY FLOOR: level=$($b.level) < $BatteryFloorPct — PAUSE. Plug to charge (>=$BatteryResumeTargetPct recommended). Wi-Fi must not be toggled."
    Write-Host "PAUSE record: $pauseFile"
    $sawPlug = $false
    while ($true) {
        Start-Sleep -Seconds 30
        $cur = Get-BattHeader
        $plugged = ($cur.usb -eq "true" -or $cur.ac -eq "true")
        if ($plugged) { $sawPlug = $true }
        Write-Host ("PAUSE poll level={0} plugged={1} usb={2} ac={3} temp_c={4}" -f $cur.level, $plugged, $cur.usb, $cur.ac, $cur.temp_c)
        # Resume: unplugged AND level >= floor. Prefer >=60 once we saw a charge, but gate is 40%.
        if (-not $plugged -and $null -ne $cur.level -and $cur.level -ge $BatteryFloorPct) {
            if ($sawPlug -and $cur.level -lt $BatteryResumeTargetPct) {
                Write-Host "PAUSE: unplugged at $($cur.level)% (gate 40% PASS; recommended 60% not reached — continuing per prereg resume gate)."
            }
            $tEnd = Get-Date
            $rec.pause_t_end = $tEnd.ToString("o")
            $rec.level_at_resume = $cur.level
            $rec.temp_c_at_resume = $cur.temp_c
            $rec.charge_counter_at_resume = $cur.charge_counter
            $rec.saw_plug = $sawPlug
            ($rec | ConvertTo-Json) | Set-Content -Path $pauseFile -Encoding utf8
            Write-Host "PAUSE end. Fresh unplug gate next."
            return [pscustomobject]$rec
        }
    }
}

function Get-OnDeviceSha([string]$Rel) {
    $line = AdbOut "sha256sum $DevDir/$Rel"
    $got = (($line -split "\s+")[0]).ToLower()
    return [pscustomobject]@{ line = $line.Trim(); sha = $got }
}

function Assert-FrozenPins {
    Write-Host "=== frozen pins (on-device) ==="
    CheckSha "libllama-bench-impl.so" $PinImplNoex
    $implLine = AdbOut "sha256sum $DevDir/libllama-bench-impl.so"
    if ($implLine -match $PinImplStock) {
        throw "stock extra_bufts impl is on device — FORBIDDEN"
    }
    CheckSha "libggml-opencl.so" $PinOpencl
    CheckSha $OlmoeName $PinOlmoe
    CheckSha "llama-bench" $PinBenchStub
    CheckSha "libllama.so" $PinLlamaSo
    CheckSha "libggml.so" $PinGgml
    CheckSha "libggml-cpu.so" $PinGgmlCpu
}

function Get-FullShaBlock {
    return (AdbOut "cd $DevDir && sha256sum llama-bench libllama-bench-impl.so libllama.so libggml-opencl.so libggml.so libggml-base.so libggml-cpu.so libllama-common.so libc++_shared.so libomp.so $OlmoeName")
}

function Restore-FrozenStack {
    Write-Host "=== restore frozen N>=10 stack (do not touch s3base/s3fix/s3printf) ==="
    if (-not (Test-Path $PcOpenclFrozen)) { throw "missing $PcOpenclFrozen" }
    if (-not (Test-Path $PcImplNoex)) { throw "missing $PcImplNoex" }
    if (-not (Test-Path $PcBenchStub)) { throw "missing $PcBenchStub" }
    if (-not (Test-Path $PcOlmoe)) { throw "missing $PcOlmoe" }
    if (-not (Test-Path $PcOneCell)) { throw "missing $PcOneCell" }

    $hOpen = (Get-FileHash -Algorithm SHA256 $PcOpenclFrozen).Hash.ToLower()
    if ($hOpen -ne $PinOpencl) { throw "PC opencl $hOpen != $PinOpencl" }
    $hImpl = (Get-FileHash -Algorithm SHA256 $PcImplNoex).Hash.ToLower()
    if ($hImpl -ne $PinImplNoex) { throw "PC impl $hImpl != $PinImplNoex" }
    $hOlmoe = (Get-FileHash -Algorithm SHA256 $PcOlmoe).Hash.ToLower()
    if ($hOlmoe -ne $PinOlmoe) { throw "PC OLMoE $hOlmoe != $PinOlmoe" }

    AdbOut "mkdir -p $DevDir/logs" | Out-Null

    Write-Host "push libggml-opencl.so frozen 2ed2e48a"
    Invoke-S23 @("push", $PcOpenclFrozen, "$DevDir/libggml-opencl.so")
    Write-Host "push noextra libllama-bench-impl.so d2030f23"
    Invoke-S23 @("push", $PcImplNoex, "$DevDir/libllama-bench-impl.so")
    Write-Host "push llama-bench stub b2ae0fa6"
    Invoke-S23 @("push", $PcBenchStub, "$DevDir/llama-bench")
    AdbOut "chmod 755 $DevDir/llama-bench" | Out-Null
    Write-Host "push one_cell.sh"
    Invoke-S23 @("push", $PcOneCell, "$DevDir/one_cell.sh")
    AdbOut "chmod 755 $DevDir/one_cell.sh" | Out-Null

    $needModel = $true
    try {
        $got = Get-OnDeviceSha $OlmoeName
        if ($got.sha -eq $PinOlmoe) { $needModel = $false; Write-Host "OLMoE already on device sha match" }
    } catch {
        $needModel = $true
    }
    if ($needModel) {
        Write-Host "push OLMoE GGUF (4.2 GiB, may take several minutes over TLS)"
        Invoke-S23 @("push", $PcOlmoe, "$DevDir/$OlmoeName")
    }

    if (Test-Path $PcLlamaSo) {
        $devLlama = Get-OnDeviceSha "libllama.so"
        if ($devLlama.sha -ne $PinLlamaSo) {
            Write-Host "libllama.so drifted on device — restoring f8b11fc3"
            Invoke-S23 @("push", $PcLlamaSo, "$DevDir/libllama.so")
        }
    }

    Assert-FrozenPins
    Write-Host "=== full sha block after restore ==="
    Write-Host (Get-FullShaBlock)
}

function Parse-Tg512([string]$StdoutFile) {
    if (-not (Test-Path $StdoutFile)) { return $null }
    $hits = @()
    Get-Content -Path $StdoutFile -ErrorAction SilentlyContinue | ForEach-Object {
        $t = $_.Trim()
        if ($t.StartsWith("{")) {
            try { $hits += ($t | ConvertFrom-Json) } catch { }
        }
    }
    $row = $hits | Where-Object { $_.n_gen -eq 512 -and $_.n_prompt -eq 0 } | Select-Object -Last 1
    if (-not $row) { $row = $hits | Select-Object -Last 1 }
    if (-not $row) { return $null }
    return [double]$row.avg_ts
}

function Get-Median([double[]]$Values) {
    if (-not $Values -or $Values.Count -eq 0) { return $null }
    $s = @($Values | Sort-Object)
    $n = $s.Count
    if ($n % 2 -eq 1) { return [double]$s[[int](($n - 1) / 2)] }
    return ([double]$s[$n / 2 - 1] + [double]$s[$n / 2]) / 2.0
}

function Write-JsonFile([string]$Path, $Obj) {
    $dir = Split-Path -Parent $Path
    if ($dir) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    ($Obj | ConvertTo-Json -Depth 8) | Set-Content -Path $Path -Encoding utf8
}
