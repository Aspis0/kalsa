# CalaQwen drop curve — same protocol as results/mellum2_dropcurve, model swapped.
# Closes the honesty gap declared in docs/NAMING.md: the recipe's quality gate
# (PPL vs drop) is certified on Mellum2 only, while CalaQwen runs the recipe in
# every speed cell. Smoke-measured 2026-08-16: 6.6 tok/s on this binary (Mellum2
# ran at 5.9), so the full 6-arm x 5-language curve costs ~21-25 h, the same as
# Mellum2 — no reason to shorten the protocol and lose comparability.
$root = "C:\Users\gualt\Desktop\Kalsa\moe-experiments"
$out  = "$root\results\calaqwen_dropcurve"
New-Item -ItemType Directory -Force -Path $out | Out-Null
$p = Start-Process -FilePath "python" `
  -ArgumentList @("$root\scripts\run_mellum2_dropcurve.py",
                  "--model", "$root\models\Qwen3.6-35B-A3B-KEXP.gguf",
                  "--outdir", $out,
                  "--threads", "16",
                  # Declare CalaQwen's sha rather than using --skip-identity,
                  # which would also drop the binary and DLL pins.
                  "--expect-model-sha", "ac44e20c1783b9105b83246fd8ce59892b47a265b84e1323a8a501929877721a") `
  -RedirectStandardOutput "$out\orchestrator.out.log" `
  -RedirectStandardError  "$out\orchestrator.err.log" `
  -WindowStyle Hidden -PassThru
$p.Id | Out-File "$out\orchestrator.pid.txt" -Encoding ascii
Write-Output "LAUNCHED pid=$($p.Id)"
