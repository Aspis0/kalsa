# BISECT-LOG — cell #64 (HDK8550, v73, OLMoE Q4_0, allenai 361e8d83…)

Verdict rule (PREREG): from `up_ngl8` only. BAD = TLBMISS family in logcat
(`crashed in thread … due to TLBMISS RW`, `Bad VA`, `0x7003`). GOOD = exit 0
with n_exps_htp0 ≥ 24. `up_ngl99` recorded for the mapping question only.

| step | index | sha7 | kit tgz sha256 | session / job | up_ngl8 | up_ngl99 | verdict |
|---|---|---|---|---|---|---|---|
| 0 | — (pin) | 022458a | e8f5cfd1… | 799155 / sa803224 | exit 0, n_exps_htp0=189 | exit 134, `dspqueue_read 0x2e` (mapping death, no TLBMISS) | **GOOD** → range valid |
| 1 | 12 | 990e3bf | 5306f3f8… | 799155 / sa803224 | exit 134 after 21 exps; logcat: `Process "/frpc/… llama-bench" crashed in thread "work-queue:0" due to TLBMISS RW occurrence`, Fault PC 0x20089E4C = `op_binary+0x5B9C` | exit 134, `dspqueue_read 0x2e` | **BAD** |
| 2 | 6 | 0278d83 | e64a3697… | 799162 / sa803231 (HDK unit f623f410, Android 14) | exit 0, n_exps_htp0=189 | exit 134, `dspqueue_read 0x2e` (mapping death) | **GOOD** |
| 3 | 9 | 355303e | dd9cd8dd… | 799168 / sa803237 (unit 47874641) | exit 134 after 21 exps; `crashed in thread "work-queue:2" due to TLBMISS RW`, Fault PC 0x20089EEC | exit 134 | **BAD** |
| 4 | 8 | 0a50d99 | 8e1044d2… | 799176 / sa803245 (unit 47874641) | exit 134 after 21 exps; `crashed in thread "work-queue:1" due to TLBMISS RW`, Fault PC 0x20089ECC | exit 134 | **BAD** |
| 5 | 7 | c0bc859 | 25a83981… | 799176 / sa803245 (same session, model reused, kit re-pushed) | exit 0, n_exps_htp0=189 | exit 134, `dspqueue_read 0x2e` (mapping death) | **GOOD** |

**RESULT (step 5, 4/09 15:01): G1 — CULPRIT FOUND. Index 7 GOOD, index 8 BAD → the first hexagon commit that introduces the v73 TLBMISS in `op_binary` is `0a50d9909a3478e82679f505bf8595d1eee4b0a8` = upstream #26049 "hexagon: further improved pipeline of the core bits (L2, DMA, MM, FA)".** Verdicts are monotone (GOOD: pin, 6, 7; BAD: 8, 9, 12), no G3. Caveat from PREREG: only hexagon-touching commits were candidates; non-hexagon commits between index 7 and 8 in the full history are a declared confound (the first BAD *hexagon* commit is the claim). Six sessions, ~44 min of the 8 Gen 2 pool.

Range after step 4 (historical): culprit ∈ {7, 8} — 8 = 0a50d9909 #26049 "hexagon: further improved pipeline of the core bits (L2, DMA, MM, FA)" is BAD; 7 = c0bc8591e #26029 (op_poll Windows fix, tiny) to be tested (kit building since 14:32). If 7 is GOOD → culprit = #26049.

Range after step 3 (historical): culprit ∈ {7, 8, 9} — 7 c0bc859 (#26029 op_poll Windows fix, tiny), 8 0a50d99 (#26049 "further improved pipeline of the core bits (L2, DMA, MM, FA)", prime suspect), 9 355303e (#26007 im2col, BAD). Next: index 8 (building since 14:03); then 7 only if 8 is BAD.

Range after step 2 (historical): culprit ∈ index 7..12. Next: index 9 (`355303e`, #26007
"partial im2col support"); kit build started 4/09 13:33 (the index-3 kit
built speculatively at 13:03 is now unneeded — kept, BUILDS.txt line
`b2dd28a 0 - 431` was cut short by a pkill that also hit the runner).

VOID run (kept in raw/990e3bf-VOID-ran-kit-022458a/): the first "990e3bf"
run inherited the step-0 kit because the #62-derived driver's resume guard
skipped BOTH pushes when the model sha matched and a `bin/llama-bench`
existed. Driver fixed the same minute: the kit is now ALWAYS removed and
re-pushed (`rm -rf bin lib lib-fix SHA256SUMS`, push, extract, on-device
`sha256sum -c`), only the model is reused; the host kit tgz sha is logged in
the "push verified" line. The valid 990e3bf run logs
`kit tgz sha=5306f3f8…` (raw/990e3bf/, driver log /tmp/cell64_mid2.log copied
as raw/driver_990e3bf_sa803224.log).

Board note: this HDK8550 unit reports Android 14 (#59/#62 unit: Android 16).
