# Fixes applied after hostile Grok review (2026-08-10)

Source: .grok/agents/review-resume-scripts/report.md (rating HIGH)

Must-fix applied before quantize:
- F01: bat + orch recompute SHA256 of Q8 before quantize (do not trust gate alone)
- F02: orch aborts without A_QUANTIZE_DONE / ORCH=DONE if verify_kexp exit != 0 or EXP_BAD
- F03: quantize.lock via mkdir + refuse if llama-quantize already running
- F04: orch enforces monitor/standby AC timeout 0 at start
- F05: free disk < 25GB aborts quantize
- F07: gate written UTF-8 no BOM
- F08: pid file validation + process name curl check
- F17/F18: n2_acceptance exits 3 on tokenizer mismatch / n!=248320

Deferred (N2 / post A): F15 multi load, F16 port, F19-F22 cosmetics, restore power at campaign end (powercfg_restore.bat)

Crash cause closed: 0x19C Modern Standby - quantize assolto. powercfg_mitigation.txt + restore bat.
