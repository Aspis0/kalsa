# F5 arm D1 — exploratory Xiaomi flash cell. NOT a pre-registered claim.
# Interleaved a/b/c/d, validity-gated, unplugged, battery floor 45 %, thermal abort 43 C.
$ErrorActionPreference = "Stop"
$root   = "C:\Users\gualt\Desktop\Kalsa\moe-experiments"
$out    = "$root\results\selfspec_f5_d1_xiaomi"
$src    = "$root\BigMoeOnEdge-selfspec-f1"
$build  = "$src\build-android-f5"
$adb    = "C:\Users\gualt\AppData\Local\Android\Sdk\platform-tools\adb.exe"
$serial = "adb-625689a2-9xEOfw._adb-tls-connect._tcp"
$devBin = "/data/local/tmp/f5_d1/bin"
$devPrompt = "/data/local/tmp/f5_d1/p_longfact.txt"
$devModel  = "/data/local/tmp/gdn_750/taskb/Qwen3.6-35B-A3B-KEXP.gguf"
$ndkStl = "C:\Users\gualt\AppData\Local\Android\Sdk\ndk\27.1.12297006\toolchains\llvm\prebuilt\windows-x86_64\sysroot\usr\lib\aarch64-linux-android\libc++_shared.so"
$MIN_TOKENS = 150
$MIN_WALL_S = 60
$BATT_FLOOR = 45
$TEMP_ABORT_C = 43.0
$TEMP_WAIT_C  = 40.0
$REPS = 3
$MAX_TRY = 3
$RUN_TIMEOUT_S = 1500

New-Item -ItemType Directory -Force -Path "$out\out" | Out-Null
Copy-Item "$root\results\selfspec_f0\prompts\p_longfact.txt" "$out\p_longfact.txt" -Force

function Log([string]$m) {
    $line = "{0}  {1}" -f (Get-Date -Format o), $m
    for ($i = 0; $i -lt 8; $i++) {
        try { Add-Content -Path "$out\STATUS.txt" -Value $line -Encoding utf8 -ErrorAction Stop; break }
        catch { Start-Sleep -Milliseconds 200 }
    }
    Write-Output $line
}

function Adb([string[]]$argv) {
    & $adb -s $serial @argv
    if ($LASTEXITCODE -ne 0) { throw "adb $($argv -join ' ') failed rc=$LASTEXITCODE" }
}

function AdbSh([string]$cmd) {
    & $adb -s $serial shell $cmd 2>&1 | Out-String
}

function BattInfo {
    $raw = AdbSh "dumpsys battery"
    $lvl = 999; $tC = 99.9; $ac = "?"; $usb = "?"; $wl = "?"
    foreach ($ln in ($raw -split "`n")) {
        if ($ln -match '^\s*level:\s*(\d+)') { $lvl = [int]$Matches[1] }
        if ($ln -match 'temperature:\s*(\d+)') { $tC = [math]::Round(([int]$Matches[1]) / 10.0, 1) }
        if ($ln -match 'AC powered:\s*(\w+)') { $ac = $Matches[1] }
        if ($ln -match 'USB powered:\s*(\w+)') { $usb = $Matches[1] }
        if ($ln -match 'Wireless powered:\s*(\w+)') { $wl = $Matches[1] }
    }
    [pscustomobject]@{ Level = $lvl; TempC = $tC; Ac = $ac; Usb = $usb; Wireless = $wl; Plugged = ($ac -eq "true" -or $usb -eq "true" -or $wl -eq "true") }
}

function RequireUnpluggedAndCool {
    $b = BattInfo
    Log ("BATT level={0}% temp={1}C plugged={2} ac={3} usb={4} wl={5}" -f $b.Level, $b.TempC, $b.Plugged, $b.Ac, $b.Usb, $b.Wireless)
    if ($b.Plugged) { Log "ABORT plugged — cell must stay UNPLUGGED"; return $false }
    if ($b.Level -lt $BATT_FLOOR) { Log ("ABORT battery floor {0}% < {1}%" -f $b.Level, $BATT_FLOOR); return $false }
    if ($b.TempC -ge $TEMP_ABORT_C) { Log ("ABORT thermal {0}C >= {1}C" -f $b.TempC, $TEMP_ABORT_C); return $false }
    $waited = 0
    while ($b.TempC -gt $TEMP_WAIT_C) {
        Log ("TEMP_WAIT {0}C > {1}C (abort at {2}C)" -f $b.TempC, $TEMP_WAIT_C, $TEMP_ABORT_C)
        Start-Sleep -Seconds 45
        $waited += 45
        $b = BattInfo
        Log ("BATT level={0}% temp={1}C plugged={2}" -f $b.Level, $b.TempC, $b.Plugged)
        if ($b.Plugged) { Log "ABORT plugged during temp wait"; return $false }
        if ($b.Level -lt $BATT_FLOOR) { Log "ABORT battery during temp wait"; return $false }
        if ($b.TempC -ge $TEMP_ABORT_C) { Log "ABORT thermal during wait"; return $false }
        if ($waited -gt 900) { Log "ABORT temp wait exceeded 15 min"; return $false }
    }
    return $true
}

function Parse-Run([string]$file) {
    $txt = Get-Content -Raw -Path $file -ErrorAction SilentlyContinue
    if (-not $txt) { return @{ Valid = $false; Reason = "empty_log" } }
    $gen = 0; $spt = $null; $eff = $null; $alphaN = $null; $alphaD = $null
    $tpv = $null; $mib = $null; $rssKb = $null; $exit = $null
    if ($txt -match 'generation:\s+(\d+)\s+tokens,\s+([0-9.]+)\s+s/token') {
        $gen = [int]$Matches[1]
        $spt = [double]$Matches[2]
    }
    if ($txt -match 'selfspec:\s+(\d+)/(\d+)\s+drafts accepted') {
        $alphaN = [int]$Matches[1]
        $alphaD = [int]$Matches[2]
    }
    if ($txt -match '([0-9.]+)\s+tokens per verify') { $tpv = [double]$Matches[1] }
    if ($txt -match '→\s+([0-9.]+)\s+tok/s effective') { $eff = [double]$Matches[1] }
    elseif ($txt -match 'generation:\s+\d+\s+tokens,\s+[0-9.]+\s+s/token\s+\(([0-9.]+)\s+tok/s\)') {
        $eff = [double]$Matches[1]
    }
    if ($txt -match 'read\s+[0-9.]+\s+MiB\s+\(([0-9.]+)\s+MiB/token\)') { $mib = [double]$Matches[1] }
    if ($txt -match 'PEAK_RSS_KB=(\d+)') { $rssKb = [int]$Matches[1] }
    if ($txt -match 'EXIT_CODE=(\d+)') { $exit = [int]$Matches[1] }
    $nrs = @()
    foreach ($m in [regex]::Matches($txt, 'n_rs_seq\s+=\s+(\d+)')) { $nrs += [int]$m.Groups[1].Value }
    $rsBuf = @()
    foreach ($m in [regex]::Matches($txt, 'CPU RS buffer size =\s+([0-9.]+)\s+MiB')) { $rsBuf += [double]$m.Groups[1].Value }
    [pscustomobject]@{
        Gen = $gen; Spt = $spt; Eff = $eff; AlphaN = $alphaN; AlphaD = $alphaD
        Tpv = $tpv; Mib = $mib; RssKb = $rssKb; Exit = $exit; Nrs = $nrs; RsBuf = $rsBuf
    }
}

function Gate($parsed, [int]$wallS, [long]$bytes) {
    $reasons = @()
    if ($null -eq $parsed.Spt) { $reasons += "no_numeric_s_per_token" }
    if ($parsed.Gen -lt $MIN_TOKENS) { $reasons += ("tokens={0}<{1}" -f $parsed.Gen, $MIN_TOKENS) }
    if ($wallS -lt $MIN_WALL_S) { $reasons += ("wall={0}s<{1}" -f $wallS, $MIN_WALL_S) }
    if ($bytes -lt 8000) { $reasons += ("bytes={0}<8KB" -f $bytes) }
    if ($parsed.Spt -and $parsed.Spt -le 0) { $reasons += "spt_nonpositive" }
    if ($parsed.Gen -ge $MIN_TOKENS -and $wallS -gt 0 -and ($wallS / [double]$parsed.Gen) -lt 0.15) {
        $reasons += ("too_fast wall/tok={0:N3}" -f ($wallS / [double]$parsed.Gen))
    }
    return $reasons
}

# --- push binary set into a NEW device dir (never overwrite campaign bins) ---
$cli = Join-Path $build "cli\bmoe-cli"
if (-not (Test-Path $cli)) { throw "missing $cli — build first" }
$hostSha = (Get-FileHash $cli -Algorithm SHA256).Hash.ToLower()
$rev = (& git -C $src rev-parse HEAD).Trim()
$revShort = (& git -C $src rev-parse --short HEAD).Trim()
Log "=== F5 D1 XIAOMI START (EXPLORATORY — not a claim) ==="
Log "PIN git_rev=$rev ($revShort)"
Log "PIN host_sha256=$hostSha"
Log "PIN serial=$serial"

$libs = @(
    @{ Host = $cli; Dev = "bmoe-cli" },
    @{ Host = (Get-ChildItem -Path $build -Recurse -Filter "libggml.so"        | Select-Object -First 1).FullName; Dev = "libggml.so" },
    @{ Host = (Get-ChildItem -Path $build -Recurse -Filter "libggml-base.so"   | Select-Object -First 1).FullName; Dev = "libggml-base.so" },
    @{ Host = (Get-ChildItem -Path $build -Recurse -Filter "libggml-cpu.so"    | Select-Object -First 1).FullName; Dev = "libggml-cpu.so" },
    @{ Host = (Get-ChildItem -Path $build -Recurse -Filter "libllama.so"       | Select-Object -First 1).FullName; Dev = "libllama.so" },
    @{ Host = (Get-ChildItem -Path $build -Recurse -Filter "libllama-common.so"| Select-Object -First 1).FullName; Dev = "libllama-common.so" },
    @{ Host = $ndkStl; Dev = "libc++_shared.so" }
)
foreach ($l in $libs) {
    if (-not $l.Host -or -not (Test-Path $l.Host)) { throw "missing lib $($l.Dev) under $build" }
    Log ("PUSH {0}  host={1} bytes={2}" -f $l.Dev, $l.Host, (Get-Item $l.Host).Length)
}

Adb @("shell", "mkdir -p $devBin")
foreach ($l in $libs) {
    Adb @("push", $l.Host, "$devBin/$($l.Dev)")
}
Adb @("push", "$out\p_longfact.txt", $devPrompt)
Adb @("push", "$out\run_one.sh", "/data/local/tmp/f5_d1/run_one.sh")
Adb @("shell", "chmod 755 $devBin/bmoe-cli /data/local/tmp/f5_d1/run_one.sh")

$devSha = (AdbSh "sha256sum $devBin/bmoe-cli").Trim()
Log "PIN device_sha256_line=$devSha"
if ($devSha -notmatch $hostSha) {
    Log "ABORT on-device sha does not match host sha"
    throw "device sha mismatch: $devSha vs $hostSha"
}
Log "PIN device_sha_ok=$hostSha"

$help = AdbSh "cd $devBin && LD_LIBRARY_PATH=$devBin ./bmoe-cli --help"
if ($help -notmatch 'selfspec-freeze-recurrent') {
    Log "ABORT --help did not mention --selfspec-freeze-recurrent (binary/libs failed to load?)"
    Log ("HELP_HEAD " + (($help -split "`n" | Select-Object -First 20) -join " | "))
    throw "on-device --help smoke failed"
}
Log "SMOKE --help lists --selfspec-freeze-recurrent"

AdbSh "svc power stayon true" | Out-Null
AdbSh "input keyevent KEYCODE_WAKEUP" | Out-Null
if (-not (RequireUnpluggedAndCool)) { AdbSh "svc power stayon false" | Out-Null; throw "preflight failed" }

$common = @(
    "-m", $devModel,
    "--prompt-file", $devPrompt,
    "-n", "200", "--temp", "0", "-c", "4096", "--ubatch", "512", "-t", "4",
    "--moe-stream", "--cache-mb", "2000", "--dense-weights", "anon", "--overlap",
    "--io-threads", "4", "--n-expert-used", "6", "--drop-cold-experts", "0.65",
    "--chatml", "--no-think"
)
$arms = @(
    @{ Name = "a_plain"; Extra = @() },
    @{ Name = "b_off";   Extra = @("--selfspec-draft-k","2","--selfspec-gamma","4") },
    @{ Name = "c_on";    Extra = @("--selfspec-draft-k","2","--selfspec-gamma","4","--selfspec-freeze-recurrent") },
    @{ Name = "d_on_g3"; Extra = @("--selfspec-draft-k","2","--selfspec-gamma","3","--selfspec-freeze-recurrent") }
)

$ok = @{}
foreach ($a in $arms) { $ok[$a.Name] = 0 }
$failed = @{}

# Interleave: a,b,c,d, a,b,c,d, a,b,c,d
for ($rep = 1; $rep -le $REPS; $rep++) {
    foreach ($a in $arms) {
        $name = "{0}_r{1}" -f $a.Name, $rep
        $got = $false
        for ($try = 1; $try -le $MAX_TRY; $try++) {
            if (-not (RequireUnpluggedAndCool)) {
                $failed[$name] = "preflight"
                Log "STOP campaign at $name"
                AdbSh "svc power stayon false" | Out-Null
                Log "=== F5 D1 XIAOMI STOPPED ==="
                exit 2
            }
            $argv = $common + $a.Extra
            $quoted = ($argv | ForEach-Object { if ($_ -match '\s') { '"{0}"' -f $_ } else { $_ } }) -join ' '
            $shellCmd = "sh /data/local/tmp/f5_d1/run_one.sh $quoted"
            $logFile = "$out\out\$name`_try$try.txt"
            Log ("RUN {0} try={1} extra=[{2}]" -f $name, $try, ($a.Extra -join ' '))
            $sw = [System.Diagnostics.Stopwatch]::StartNew()
            # Remote stderr (n_rs_seq / RS buffer) is captured separately and merged below.
            $p = Start-Process -FilePath $adb -ArgumentList @("-s", $serial, "shell", $shellCmd) `
                -RedirectStandardOutput $logFile -RedirectStandardError "$logFile.err" `
                -NoNewWindow -PassThru
            $hung = -not $p.WaitForExit($RUN_TIMEOUT_S * 1000)
            $sw.Stop()
            if ($hung) {
                try { $p.Kill() } catch { }
                Log ("TIMEOUT {0} try={1} after {2}s — killing" -f $name, $try, $RUN_TIMEOUT_S)
                AdbSh "pkill bmoe-cli" | Out-Null
                Start-Sleep -Seconds 5
                continue
            }
            if (Test-Path "$logFile.err") {
                Add-Content -Path $logFile -Value (Get-Content -Raw "$logFile.err") -ErrorAction SilentlyContinue
            }
            $wall = [int][math]::Round($sw.Elapsed.TotalSeconds)
            $bytes = 0
            if (Test-Path $logFile) { $bytes = (Get-Item $logFile).Length }
            $parsed = Parse-Run $logFile
            $reasons = Gate $parsed $wall $bytes
            $alpha = if ($parsed.AlphaD) { "{0}/{1}" -f $parsed.AlphaN, $parsed.AlphaD } else { "-" }
            Log ("PARSE {0} try={1} tokens={2} spt={3} eff={4} alpha={5} tpv={6} mib/tok={7} rss_kb={8} wall={9}s bytes={10} n_rs_seq=[{11}] rs_buf=[{12}]" -f `
                $name, $try, $parsed.Gen, $parsed.Spt, $parsed.Eff, $alpha, $parsed.Tpv, $parsed.Mib, $parsed.RssKb, $wall, $bytes, ($parsed.Nrs -join ','), ($parsed.RsBuf -join ','))
            if ($reasons.Count -eq 0) {
                Log ("VALID {0} try={1} wall={2}s tokens={3} spt={4}" -f $name, $try, $wall, $parsed.Gen, $parsed.Spt)
                Copy-Item $logFile "$out\out\$name.txt" -Force
                $ok[$a.Name] = $ok[$a.Name] + 1
                $got = $true
                break
            }
            Log ("RETRY {0} try={1} FAIL[{2}]" -f $name, $try, ($reasons -join ' '))
            Start-Sleep -Seconds 20
        }
        if (-not $got) {
            $failed[$name] = "invalid_after_$MAX_TRY"
            Log ("FAIL {0} after {1} tries — not entering the table" -f $name, $MAX_TRY)
        }
    }
}

$b = BattInfo
Log ("END_BATT level={0}% temp={1}C plugged={2}" -f $b.Level, $b.TempC, $b.Plugged)
AdbSh "svc power stayon false" | Out-Null
Log ("REPS_OK " + (($ok.GetEnumerator() | ForEach-Object { "{0}={1}" -f $_.Key, $_.Value }) -join " "))
if ($failed.Count -gt 0) {
    Log ("FAILED_SLOTS " + (($failed.GetEnumerator() | ForEach-Object { "{0}={1}" -f $_.Key, $_.Value }) -join " "))
}
Log "=== F5 D1 XIAOMI DONE ==="
