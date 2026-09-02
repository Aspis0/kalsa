# PREREG — cell #47: PPL HTP-vs-CPU on v79 WITH the execute-op witness (qdc-8elite-npu-v79-ppl-v)

**Status: DRAFT 2026-09-01 late, delta over #46's PREREG rev-3; awaiting a hostile delta
audit (different model from the author). No QDC session until APPLY.**

## Why (one paragraph)

#46 (job 796233) measured PPL HTP-vs-CPU at 32 chunks on the ship model (40.2720 vs
40.2837, r −0.029 %) and OLMoE all-Q4_0 (9.0620 vs 9.0562, r +0.064 %), but its HTP
arms carry NO `execute-op` lines: the #46 prereg dropped the `-v` flag that q55's
binding command had (`q55-v75-npu-correctness/PREREG.md:20-22`), so `llama-perplexity`
filtered the backend's `GGML_HEXAGON_VERBOSE=1` output. By #46's own rule ("proof absent
→ METHOD-VOID for that arm") those PPL numbers are report-only. #47 re-runs the same two
HTP arms with `-v` and nothing else changed. See `../qdc-8elite-npu-v79-judge/FINDINGS-reviewer.md` §6.

## What is inherited verbatim from #46 PREREG rev-3 (binding, not restated)

Kit `npu-kit-93e9592fa.tgz` (same tarball, SHA256SUMS verified on device, self-line
excluded, OK count = manifest lines); device QRD8750 only; tunnel 6037; thermal gate
(HAL live, ≤ 60 °C, status ≤ 1, before EACH invocation, one ≤ 3-min wait then SKIP);
crash policy; clocks/cap policy; models and corpus with the same full shas
(ship `a247afd6…`, OLMoE `9d0b90c6…`, corpus `173c87a5…`; device sha mismatch =
METHOD-VOID that arm; corpus mismatch voids all); flags `-c 2048 -b 2048 -ub 1024 -fa on
--chunks 32 -t 8` (no `--load-mode`: absent in this binary, `#46 raw/perplexity_help.txt`);
PASS ≤ 2 % / GREY 2–5 % / FAIL > 5 % or NaN; structural-VOID before the first per-chunk
line; precedence of a non-zero exit after the first chunk (FAIL) over the n ≥ 8 fallback;
"what this cell cannot say" list. Session name `npu-v79-ppl-v-47`, cap **20 min**.

## What changes (the whole delta)

1. HTP invocations add **`-v`** (`--verbose`, `raw/perplexity_help.txt:200` of #46):
   `GGML_HEXAGON_VERBOSE=1 llama-perplexity -m <model> -f wiki.test.raw --device HTP0
   -ngl 99 -c 2048 -b 2048 -ub 1024 -fa on --chunks 32 -t 8 -v`, stdout+stderr in one log,
   tee'd on device and pulled. Expected log size: large (per-op lines for 65 536 tokens ×
   layers); the driver keeps it whole — no `tail`, no filtering on device.
2. **Execute-op proof** (binding, as in #46): ship arm ≥ 1 `HTP0 execute-op MUL_MAT`
   line; OLMoE arm ≥ 1 `HTP0 execute-op MUL_MAT_ID` line on `ffn_*_exps`. Proof absent
   → METHOD-VOID that arm (again). Additionally report the offload split (which ops/layers
   the verbose log shows on CPU vs HTP0) and KV placement lines.
3. **CPU twins are NOT re-run.** `r` for each model = PPL_HTP(#47) / PPL_CPU(#46) − 1,
   with PPL_CPU(#46) = 40.2837 (ship) and 9.0562 (OLMoE), taken verbatim from
   `../qdc-8elite-npu-v79-judge/raw/ppl_ship_cpu.txt` and `raw/ppl_olmoe_cpu.txt`
   (`Final estimate` lines, both `EXIT=0`). Justification, pre-declared: CPU PPL is
   deterministic for identical binary (same kit sha), model (same sha), corpus (same
   sha), flags and thread count (`-t 8`), on the same device class; the CPU arm needs no
   HTP witness. If the audit rejects the reuse, the CPU twins are added back (≈ 7.5 min
   ship + 8 min OLMoE → cap 40 min) before the session is queued.
4. **Cross-check** (report-only, not a gate): PPL_HTP(#47) vs PPL_HTP(#46) — the same
   HTP computation with and without `-v` must agree to the printed precision
   (40.2720 / 9.0620); a difference is a declared anomaly and blocks banking until
   explained.
5. Drop order: kit → ship HTP → OLMoE HTP. No ops arms, no Qwen. Budget: kit 5 s, ship
   upload ~80 s, ship HTP ~80 s + `-v` I/O overhead (unknown; assume ≤ 2×), OLMoE upload
   ~200 s, OLMoE HTP ~80 s (+ same overhead), gates + shas ~1.5 min → ≈ 10–13 min;
   cap 20 min.

## Decision rule (pre-written)

- Certification per model = PASS/GREY/FAIL on `r` as defined in item 3, ONLY if the
  execute-op proof for that arm is present and the item-4 cross-check agrees; otherwise
  METHOD-VOID (proof) or ANOMALY (cross-check), no certification.
- **Session 1 D closes on correctness** iff #46's judge-repaired verdict stands after its
  hostile audit AND ship = PASS here at 32 chunks (OLMoE PASS certifies the experts lane
  in addition; it is not required for D). GREY/FAIL bank `r` and leave D OPEN. The #46
  ops defect list (36 INTERNAL-ERROR shapes + attribution note) stays open as its own
  item regardless.

## What this cell cannot say

Everything in #46's list, plus: nothing about the judge (no ops arms here); nothing
about CPU-arm reproducibility (not re-measured — declared, item 3).

## Outputs

`raw/` (both HTP logs whole, device tee copies, gates, shas, kit verify, list_devices,
events.txt, running.txt), `REPORT.md`, `AUDIT.md` (different model), then PLAN STATO +
ALIVE row + PLAN-10DAYS in the SAME commit as the bank, banked together with #46.

## Reviewer verification of the delta's premise (source-level)

`ggml/src/ggml-hexagon/ggml-hexagon.cpp:110` — the execute-op line is emitted with
`GGML_LOG_DEBUG(...)` (under the `GGML_HEXAGON_VERBOSE` gate). Tools built on `common`
(llama-perplexity) route ggml logs through `common_log`, whose threshold drops DEBUG
unless raised: `common/log.h:106` `if ((verbosity) <= common_log_get_verbosity_thold())`,
and `-v` = "Set verbosity level to infinity" (`#46 raw/perplexity_help.txt:200`). #46 set
the env but not `-v` → 12-line logs. llama-bench (#44) printed the lines because it does
not install the filtering logger. Both the env AND `-v` are required; #47 sets both.
