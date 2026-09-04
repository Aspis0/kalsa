# BISECT-LOG — cell #64 (HDK8550, v73, OLMoE Q4_0, allenai 361e8d83…)

Verdict rule (PREREG): from `up_ngl8` only. BAD = TLBMISS family in logcat
(`crashed in thread … due to TLBMISS RW`, `Bad VA`, `0x7003`). GOOD = exit 0
with n_exps_htp0 ≥ 24. `up_ngl99` recorded for the mapping question only.

| step | index | sha7 | kit tgz sha256 | session / job | up_ngl8 | up_ngl99 | verdict |
|---|---|---|---|---|---|---|---|
| 0 | — (pin) | 022458a | e8f5cfd1… | 799155 / sa803224 | exit 0, n_exps_htp0=189 | exit 134, `dspqueue_read 0x2e` (mapping death, no TLBMISS) | **GOOD** → range valid |
| 1 | 12 | 990e3bf | 5306f3f8… | 799155 / sa803224 | exit 134 after 21 exps; logcat: `Process "/frpc/… llama-bench" crashed in thread "work-queue:0" due to TLBMISS RW occurrence`, Fault PC 0x20089E4C = `op_binary+0x5B9C` | exit 134, `dspqueue_read 0x2e` | **BAD** |
| 2 | 6 | 0278d83 | e64a3697… | 799162 / sa803231 (HDK unit f623f410, Android 14) | exit 0, n_exps_htp0=189 | exit 134, `dspqueue_read 0x2e` (mapping death) | **GOOD** |

Range after step 2: culprit ∈ index 7..12. Next: index 9 (`355303e`, #26007
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
