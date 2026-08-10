# moe-requant-1c — Phase A PC complete

## Crash recovery
- Cause: 0x19C WIN32K_POWER_WATCHDOG_TIMEOUT / Modern Standby (quantize assolto)
- Mitigation: monitor/standby-timeout-ac 0; restore via powercfg_restore.bat
- Lost: nothing measured; first Q8 resume was corrupt (wrong sha); clean redownload from zero

## Phase A
- Q8: size=36903140320 sha256=d1a395809f65a43a13ad119eb4e7acdef1ac6d68120f39902c8ab96e72794a59 (HF LFS oid)
- imatrix: 192223904 sha=1ff7ed05...
- Recipe fix: `output.weight=q4_k` -> `^output\.weight$=q4_k` (regex_search matched attn_output)
- Quantize: exit=0, BELOWNORMAL, re-hash gate + lock
- KEXP: size=13416430592 (~12.49 GB)
- Verify: experts 120/0 (Q2_K gate/up, Q3_K down); dense 613/0; VERIFY_OK
- kexp.sha256: see results/requant1c/kexp.sha256

## Phase B/C
Device only — not run on this PC resume.

## Refuse candidates (not deleted)
- Q2_K_XL, LFM2.BADSIZE — need gualt ok
