# F1 CalaQwen correctness + noisy PC A/B. Does not kill other processes.
$ErrorActionPreference = 'Stop'
$OutRoot = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\selfspec_f1_pc'
$Cli = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\BigMoeOnEdge-selfspec-f1\build\cli\bmoe-cli.exe'
$DllDir = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\BigMoeOnEdge-selfspec-f1\build\bin'
$Model = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\models\Qwen3.6-35B-A3B-KEXP.gguf'
$PromptDir = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\selfspec_f0\prompts'
$env:PATH = "$DllDir;" + $env:PATH

$Common = @(
    '-m', $Model,
    '--temp', '0',
    '--moe-stream',
    '--cache-mb', '2000',
    '--dense-weights', 'anon',
    '--overlap',
    '--io-threads', '4',
    '--progress',
    '--session',
    '-c', '2048',
    '--ubatch', '512',
    '-n', '256',
    '-t', '4'
)

$Prompts = @(
    @{ name = 'longfact'; file = (Join-Path $PromptDir 'p_longfact.txt') },
    @{ name = 'creative'; file = (Join-Path $PromptDir 'p_creative.txt') },
    @{ name = 'code';     file = (Join-Path $PromptDir 'p_code.txt') }
)

function Write-Log($msg) {
    $line = "[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $msg
    Add-Content -Path (Join-Path $OutRoot 'run.log') -Value $line
    Write-Output $line
}

function Invoke-Session {
    param(
        [string]$Tag,
        [string]$OutDir,
        [string[]]$ExtraArgs,
        [object[]]$Jobs
    )
    New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
    $stdoutPath = Join-Path $OutDir "$Tag.stdout.log"
    $stderrPath = Join-Path $OutDir "$Tag.stderr.log"
    $metaPath   = Join-Path $OutDir "$Tag.meta.json"
    $allArgs = $Common + $ExtraArgs
    $cmdLine = @($Cli) + $allArgs
    Write-Log "START $Tag :: $($cmdLine -join ' ')"
    Set-Content -Path (Join-Path $OutDir "$Tag.cmdline.txt") -Value ($cmdLine -join ' ')

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $Cli
    $psi.Arguments = ($allArgs | ForEach-Object { if ($_ -match '\s') { '"' + $_ + '"' } else { $_ } }) -join ' '
    $psi.UseShellExecute = $false
    $psi.RedirectStandardInput = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    $psi.WorkingDirectory = (Split-Path $Cli -Parent)
    $psi.Environment['PATH'] = $env:PATH

    $proc = New-Object System.Diagnostics.Process
    $proc.StartInfo = $psi
    $null = $proc.Start()
    $stdin = $proc.StandardInput
    $stdout = $proc.StandardOutput
    $stderr = $proc.StandardError

    $stderrBuf = New-Object System.Text.StringBuilder
    $stdoutBuf = New-Object System.Text.StringBuilder
    $ready = $false
    $results = @()
    $deadline = (Get-Date).AddMinutes(90)

    function Drain-Stderr {
        while ($stderr.Peek() -ge 0) {
            $ch = [char]$stderr.Read()
            [void]$stderrBuf.Append($ch)
        }
    }

    try {
        while (-not $proc.HasExited -and (Get-Date) -lt $deadline) {
            if ($stdout.Peek() -ge 0) {
                $line = $stdout.ReadLine()
                if ($null -eq $line) { Start-Sleep -Milliseconds 80; continue }
                [void]$stdoutBuf.AppendLine($line)
                if ($line -like 'BMOE_READY*') {
                    $ready = $true
                    Write-Log "$Tag READY: $line"
                    break
                }
                if ($line -like 'BMOE_ERROR*') {
                    Write-Log "$Tag ERROR during load: $line"
                    break
                }
            } else {
                Start-Sleep -Milliseconds 200
            }
            Drain-Stderr
        }
        if (-not $ready) {
            Write-Log "$Tag FAILED to become ready"
            if (-not $proc.HasExited) { $proc.Kill() }
            Set-Content -Path $stdoutPath -Value $stdoutBuf.ToString()
            Set-Content -Path $stderrPath -Value $stderrBuf.ToString()
            return $false
        }

        $id = 0
        foreach ($job in $Jobs) {
            $id++
            $prompt = (Get-Content -Raw -Path $job.file).TrimEnd()
            $payload = @{
                cmd = 'generate'
                id = $id
                prompt = $prompt
                n_predict = 256
                think = $false
                clear_kv = $true
            } | ConvertTo-Json -Compress
            Write-Log "$Tag SEND id=$id name=$($job.name) bytes=$($payload.Length)"
            $stdin.WriteLine($payload)
            $stdin.Flush()

            $doneLine = $null
            $genDeadline = (Get-Date).AddMinutes(45)
            while ((Get-Date) -lt $genDeadline) {
                if ($proc.HasExited) {
                    Write-Log "$Tag process exited mid-generate id=$id"
                    break
                }
                if ($stdout.Peek() -ge 0) {
                    $line = $stdout.ReadLine()
                    if ($null -eq $line) { Start-Sleep -Milliseconds 80; continue }
                    [void]$stdoutBuf.AppendLine($line)
                    if ($line -like "BMOE_DONE*" -or $line -like "BMOE_ERROR*") {
                        $doneLine = $line
                        break
                    }
                } else {
                    Start-Sleep -Milliseconds 200
                }
                Drain-Stderr
            }
            $textPath = Join-Path $OutDir "$Tag.$($job.name).done.txt"
            Set-Content -Path $textPath -Value $doneLine
            $results += @{ name = $job.name; done = $doneLine }
            Write-Log "$Tag DONE id=$id name=$($job.name) line_len=$(if ($doneLine) { $doneLine.Length } else { 0 })"
        }
        $stdin.WriteLine('{"cmd":"close"}')
        $stdin.Flush()
        $stdin.Close()
        if (-not $proc.WaitForExit(15000)) {
            Write-Log "$Tag close timed out; leaving process (will not kill)"
        }
    } catch {
        Write-Log "$Tag EXCEPTION: $_"
    } finally {
        Drain-Stderr
        Set-Content -Path $stdoutPath -Value $stdoutBuf.ToString()
        Set-Content -Path $stderrPath -Value $stderrBuf.ToString()
        ($results | ConvertTo-Json -Depth 4) | Set-Content -Path $metaPath
        Write-Log "END $Tag exit=$($proc.ExitCode) stdout=$($stdoutBuf.Length) stderr=$($stderrBuf.Length)"
    }
    return $true
}

function Extract-DoneField([string]$line, [string]$key) {
    if (-not $line) { return $null }
    $jsonStart = $line.IndexOf('{')
    if ($jsonStart -lt 0) { return $null }
    $json = $line.Substring($jsonStart)
    try {
        $o = $json | ConvertFrom-Json
        return $o.$key
    } catch {
        return $null
    }
}

# --- 1) correctness ---
$cdir = Join-Path $OutRoot 'correctness'
Invoke-Session -Tag 'plain' -OutDir $cdir -ExtraArgs @('--n-expert-used','6') -Jobs $Prompts
Invoke-Session -Tag 'selfspec' -OutDir $cdir -ExtraArgs @('--n-expert-used','6','--selfspec-draft-k','2','--selfspec-gamma','4') -Jobs $Prompts

# Compare texts
$cmp = Join-Path $cdir 'COMPARE.txt'
$cmpLines = @()
$identical = $true
$firstDrift = $null
$accSum = 0L; $drSum = 0L
foreach ($p in $Prompts) {
    $aLine = Get-Content -Raw (Join-Path $cdir "plain.$($p.name).done.txt") -ErrorAction SilentlyContinue
    $bLine = Get-Content -Raw (Join-Path $cdir "selfspec.$($p.name).done.txt") -ErrorAction SilentlyContinue
    $a = [string](Extract-DoneField $aLine 'text')
    $b = [string](Extract-DoneField $bLine 'text')
    $acc = Extract-DoneField $bLine 'mtp_accepted'
    $dr  = Extract-DoneField $bLine 'mtp_drafted'
    $dec = Extract-DoneField $bLine 'mtp_decodes'
    $tok = Extract-DoneField $bLine 'tokens'
    $tps = Extract-DoneField $bLine 'tok_s'
    $ds  = Extract-DoneField $bLine 'mtp_draft_s_tok'
    if ($dr) { $accSum += [int64]$acc; $drSum += [int64]$dr }
    $eq = ($a -eq $b)
    if (-not $eq) { $identical = $false }
    $pos = -1
    if (-not $eq -and $a -and $b) {
        $n = [Math]::Min($a.Length, $b.Length)
        for ($i = 0; $i -lt $n; $i++) { if ($a[$i] -ne $b[$i]) { $pos = $i; break } }
        if ($pos -lt 0) { $pos = $n }
        if (-not $firstDrift) { $firstDrift = "$($p.name)@$pos" }
        $lo = [Math]::Max(0, $pos - 8)
        $ctxA = if ($a.Length -gt 0) { $a.Substring($lo, [Math]::Min(24, $a.Length - $lo)) } else { '' }
        $ctxB = if ($b.Length -gt 0) { $b.Substring($lo, [Math]::Min(24, $b.Length - $lo)) } else { '' }
        $cmpLines += "DRIFT $($p.name) pos=$pos"
        $cmpLines += "  plain : $ctxA"
        $cmpLines += "  spec  : $ctxB"
    } else {
        $cmpLines += "IDENTICAL $($p.name) chars=$($a.Length) tokens=$tok drafted=$dr accepted=$acc decodes=$dec tok_s=$tps draft_s_tok=$ds"
    }
    Set-Content -Path (Join-Path $cdir "plain.$($p.name).text.txt") -Value $a
    Set-Content -Path (Join-Path $cdir "selfspec.$($p.name).text.txt") -Value $b
}
$alpha = if ($drSum -gt 0) { [double]$accSum / [double]$drSum } else { 0 }
$cmpLines += "POOLED_ALPHA $accSum/$drSum = $alpha"
$cmpLines += "IDENTICAL_ALL $identical"
if ($firstDrift) { $cmpLines += "FIRST_DRIFT $firstDrift" }
Set-Content -Path $cmp -Value ($cmpLines -join "`n")
Write-Log ("COMPARE identical={0} alpha={1:N4} first={2}" -f $identical, $alpha, $firstDrift)

# --- 3) speed A/B (one prompt) ---
$sdir = Join-Path $OutRoot 'speed'
$speedJobs = @($Prompts[0])
Invoke-Session -Tag 'plain_d065' -OutDir $sdir -ExtraArgs @('--n-expert-used','6','--drop-cold-experts','0.65') -Jobs $speedJobs
Invoke-Session -Tag 'selfspec_d065' -OutDir $sdir -ExtraArgs @('--n-expert-used','6','--selfspec-draft-k','2','--selfspec-gamma','4','--drop-cold-experts','0.65') -Jobs $speedJobs

$spd = Join-Path $sdir 'SPEED.txt'
$pLine = Get-Content -Raw (Join-Path $sdir 'plain_d065.longfact.done.txt') -ErrorAction SilentlyContinue
$sLine = Get-Content -Raw (Join-Path $sdir 'selfspec_d065.longfact.done.txt') -ErrorAction SilentlyContinue
$pToks = Extract-DoneField $pLine 'tok_s'
$sToks = Extract-DoneField $sLine 'tok_s'
$sDraft = Extract-DoneField $sLine 'mtp_draft_s_tok'
$sAcc = Extract-DoneField $sLine 'mtp_accepted'
$sDr = Extract-DoneField $sLine 'mtp_drafted'
$sDec = Extract-DoneField $sLine 'mtp_decodes'
$pEff = $pToks
$sEff = $null
if ($sToks -and $sDraft) {
    $spt = if ([double]$sToks -gt 0) { 1.0 / [double]$sToks } else { 0 }
    $den = $spt + [double]$sDraft
    $sEff = if ($den -gt 0) { 1.0 / $den } else { 0 }
}
$speedup = if ($pEff -and $sEff -and [double]$pEff -gt 0) { [double]$sEff / [double]$pEff } else { 0 }
@(
    "plain_d065 tok_s=$pToks (decode-only; no draft)"
    "selfspec_d065 tok_s=$sToks draft_s_tok=$sDraft eff=$sEff accepted=$sAcc drafted=$sDr decodes=$sDec"
    "speedup_eff $speedup (NOISY_ENV)"
) | Set-Content -Path $spd
Write-Log "SPEED plain=$pToks spec_eff=$sEff speedup=$speedup"

# Verdict line for the orchestrator
$verdict = if (-not $identical -and $firstDrift) {
    "F1_CORRECT(drift@$firstDrift) alpha=$([string]::Format('{0:N4}',$alpha)) PC speedup $([string]::Format('{0:N2}',$speedup)) (NOISY_ENV)"
} elseif ($identical) {
    "F1_CORRECT(identical) alpha=$([string]::Format('{0:N4}',$alpha)) PC speedup $([string]::Format('{0:N2}',$speedup)) (NOISY_ENV)"
} else {
    "F1_BLOCKED(compare failed) alpha=$alpha"
}
Set-Content -Path (Join-Path $OutRoot 'VERDICT.txt') -Value $verdict
Write-Log $verdict
Write-Log 'RUNNER_DONE'
