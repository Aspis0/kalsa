# PREREG — `s23-unplugged-baseline-night0` (LOCKED at commit)

Owner instruction 2026-08-28 ~00:15 ("ultima notte staccato"): the S23 was unplugged at
00:10:55 (dumpsys ac:false, level 100, 28.7 °C) and tonight is the LAST unplugged window
before the 10-day plugged period. This cell runs the Phase-1 speed matrix **unplugged
declared** — the regime in which every banked S23 speed verdict was measured — so the
Day-1 plugged repeat can quantify the plugged tax for the whole window.

**Base document:** `../s23-plugged-baseline/PREREG.md` (DRAFT) applies verbatim except the
deltas below. Pins: `../s23-plugged-baseline/PINNED_SET.md` (s3oracle 11-file set, device
sha authoritative per `CERT_DAY0.md`). Models: OLMoE Q4_K_M `3bd9ec48…` 4,213,513,024 B;
Marco-Mini-Instruct-KEXP `2f921958…` 6,385,238,848 B (device sha re-verified before cells).

## Deltas vs the draft

1. **Unplugged declared** for every cell (`ac:false` recorded in every manifest; a replug
   mid-matrix INVALIDATES the running block, not the completed ones).
2. Battery floor **45 %**: below it, stop the matrix, report partial (completed ABBA
   blocks are valid; no partial block is reported as a median).
3. Thermal-only profiles (5-min CPU / 5-min GPU) are **out** — they belong to the plugged
   Day-1 card. Correctness gate + speed matrix only.
4. Cool-start gate ≤ 32 °C per block (cool_start_class=cool; idle 28.7 °C at lock).
5. Transport: the Mac's existing wireless-adb transport `192.168.1.152:36329`
   (already-authorized key). NO `adb pair`, NO `adb kill-server` (a second device campaign
   is live on this host), no reconnect attempts beyond `adb connect` to the same
   IP:port if the transport drops.

## Matrix (identical to draft §Speed matrix)

Models {Marco-KEXP, OLMoE} × workloads {pp512, tg128} × arms {A=`-ngl 99`, C=`-ngl 0`},
both with `-nr -fa off`, N=3 ABBA blocks (A,C,C,A) per model×workload pairing as in the
draft; one llama process at a time; q56 guard (WARN 40 / KILL 43 / poll 10 s) on every
invocation; cpuset gate per draft (fail = invalid cell, exit-93 convention); load time
recorded separately; correctness gate first (MUL_MAT_ID 407/407, dense 925/925).

Budget: ~1 h target, hard wall 2 h. Stop rules, hygiene, outputs: as in the draft.

## Comparators (pre-declared)

Banked unplugged references this cell may be compared to: #18 KEXP A 14.252 / C 17.553
(A/C 0.812) and #20 OLMoE A 20.034 / C 27.685 (A/C 0.724) — same device, earlier binary
lineage. Divergence is REPORTED, not adjudicated here.

LOCK = the commit adding this file. Any change after lock is a numbered Amendment.
