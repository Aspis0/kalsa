# F5 arms P1/P2 on the real hybrid (CalaQwen 35B), PC.
# Purpose: exercise the freeze path on a HYBRID model — the host gates ran on
# tiny-moe (qwen3moe, not hybrid) where the freeze is a no-op — and measure the
# RAM claim (n_rs_seq = 0 on the draft context) as peak working set.
$ErrorActionPreference = "Stop"
$root  = "C:\Users\gualt\Desktop\Kalsa\moe-experiments"
$out   = "$root\results\selfspec_f5_pc"
$exe   = "$root\BigMoeOnEdge-selfspec-f1\build-f5\cli\bmoe-cli.exe"
$model = "$root\models\Qwen3.6-35B-A3B-KEXP.gguf"
$prompt= "$root\results\selfspec_f0\prompts\p_longfact.txt"

function Log($m) {
    $line = "{0}  {1}" -f (Get-Date -Format o), $m
    # A stale runner holding STATUS.txt open must not kill a 9-minute measurement:
    # retry, then fall back to the console rather than throwing.
    for ($i = 0; $i -lt 10; $i++) {
        try { Add-Content -Path "$out\STATUS.txt" -Value $line -Encoding utf8 -ErrorAction Stop; return }
        catch { Start-Sleep -Milliseconds 300 }
    }
    Write-Output "LOG_FALLBACK $line"
}

New-Item -ItemType Directory -Force -Path $out | Out-Null
# Each run gets its own directory. Overwriting fixed log names cost this report
# its timing provenance once: the numbers were real when read, then unverifiable
# because the next run had eaten the logs.
$rev = (& git -C "$root\BigMoeOnEdge-selfspec-f1" rev-parse --short HEAD)
$out = Join-Path $out ("run_{0}_{1}" -f $rev, (Get-Date -Format "MMdd-HHmmss"))
New-Item -ItemType Directory -Force -Path $out | Out-Null
# The CLI is dynamically linked; its DLLs live in build-f5\bin, not next to the
# exe. Without this the process dies instantly with 0xc0000135 and leaves a
# 0-byte log — which looks exactly like "it ran and produced nothing".
$env:PATH = "$root\BigMoeOnEdge-selfspec-f1\build-f5\bin" + [IO.Path]::PathSeparator + $env:PATH
Log "=== F5 P1/P2 START ==="
Log ("PIN exe_sha=" + (Get-FileHash $exe -Algorithm SHA256).Hash.ToLower())
Log ("PIN git_rev=" + (& git -C "$root\BigMoeOnEdge-selfspec-f1" rev-parse --short HEAD))

$base = @(
  "-m", $model, "-t", "4", "-c", "2048", "--ubatch", "512", "-n", "256",
  "--temp", "0", "--moe-stream", "--cache-mb", "2000", "--dense-weights", "anon",
  "--overlap", "--io-threads", "4", "--n-expert-used", "6",
  # Without a chat wrapper this model emits EOG after ONE token on this prompt,
  # which silently turns every "speed" number into a prefill measurement. The
  # first version of this script had no such guard and produced exactly that.
  "--chatml", "--no-think",
  "--prompt-file", $prompt
)
$MIN_TOKENS = 200

$arms = @(
  @{ name = "p0_plain";      extra = @() },
  @{ name = "p1_freeze_off"; extra = @("--selfspec-draft-k","2","--selfspec-gamma","4") },
  @{ name = "p2_freeze_on";  extra = @("--selfspec-draft-k","2","--selfspec-gamma","4","--selfspec-freeze-recurrent") }
)

foreach ($a in $arms) {
    $name = $a.name
    $argv = $base + $a.extra
    Log "RUN $name : $exe $($argv -join ' ')"
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $p = Start-Process -FilePath $exe -ArgumentList $argv `
        -RedirectStandardOutput "$out\$name.out.log" `
        -RedirectStandardError  "$out\$name.err.log" `
        -WindowStyle Hidden -PassThru
    $peak = 0
    while (-not $p.HasExited) {
        try { $p.Refresh(); if ($p.WorkingSet64 -gt $peak) { $peak = $p.WorkingSet64 } } catch { }
        Start-Sleep -Milliseconds 400
    }
    $sw.Stop()
    try { if ($p.PeakWorkingSet64 -gt $peak) { $peak = $p.PeakWorkingSet64 } } catch { }
    $peakMB = [math]::Round($peak / 1MB, 1)
    # Validity gate: a run that emitted a handful of tokens measured prefill, not
    # decode. Say so loudly instead of letting the wall time look like a result.
    $gen = 0
    $m = Select-String -Path "$out\$name.out.log" -Pattern 'generation:\s+(\d+) tokens' | Select-Object -First 1
    if ($m) { $gen = [int]$m.Matches[0].Groups[1].Value }
    $verdict = if ($gen -ge $MIN_TOKENS) { "VALID" } else { "INVALID_TOO_FEW_TOKENS" }
    Log ("DONE {0} rc={1} wall={2}s peak_rss={3} MiB tokens={4} {5}" -f $name, $p.ExitCode, [math]::Round($sw.Elapsed.TotalSeconds,1), $peakMB, $gen, $verdict)
    if ($verdict -ne "VALID") { Log "FAIL $name generated $gen tokens (< $MIN_TOKENS): timing numbers from this arm are NOT decode measurements" }
}
Log "=== F5 P1/P2 DONE ==="
