# Hostile review — K2.2 Q6_K dispatch fix

Branch `kalsa/opencl-q6k-dispatch-fix` (2 commits on `e5605f3bd`), nested repo
`BigMoeOnEdge/third_party/llama.cpp`. Scope: `ggml/src/ggml-opencl/ggml-opencl.cpp`
(`use_flat_gemv_for_large_m_q6_K`), `tests/test-backend-ops.cpp` (3 new default
Q6_K MUL_MAT cases). Artifacts checked: `results/gdn_gpu_k22/fix.diff` (byte-identical
to `git diff e5605f3bd..HEAD`), BUILD_MANIFEST, build log, on-device logs
(ops, greedy, bench), K2.1 instrumentation patch + logs, K2.1/K2.2 reports.

---

## 0. What actually changed (verified)

Pre-fix predicate (`32b318aab` parent):

```
if (ne1 % 128 != 0 && 2D) return true;                 // odd-vocab safety (pre-existing, #25464)
return ne1 >= 32768 && ne0 >= 2048 && 2D;              // large-M perf redirect (upstream #24006, 63e66fdd2)
```

Post-fix: second branch removed, unconditional `return false`.

Changed shape class (the ONLY behavioral delta): `ne1 >= 32768 && ne0 >= 2048 &&
ne1 % 128 == 0 && ne2 == ne3 == 1`. Everything else routes identically pre/post.

---

## 1. Attack vector 1 — the threshold hole

**Verdict: REFUTED as a dispatch hole; one PLAUSIBLE untested sub-shape exists (n>=32 GEMM).**

Full post-fix dispatch chain for Q6_K MUL_MAT src0 (traced in source):

| shape class (src0 [ne0=K, ne1=M]) | n=1 | n∈[2,32) | n>=32 |
|---|---|---|---|
| Adreno build, `use_adreno_kernels` true (ne0>=512, ne1>=512, ne1%128==0, ne2==ne3==1; `ggml-opencl.cpp:6419-6438`) and helper false | noshuffle GEMV (`17534-17601`, branch `17590-17592` → `ggml_cl_mul_mat_q6_K_f32_adreno` `16560`, `ne1==1` branch `16612-16663`) | same fn, `ne1>1` branch: transpose + `gemm_noshuffle_q6_K_f32` (`16664-16747`) | **same gemm branch — the Adreno block intercepts BEFORE the LM GEMM block** |
| Adreno build, thresholds not met (ne0<512, ne1<512, ne1%128!=0, or 3D/4D) | generic GEMV → `kernel_mul_mv_q6_K_f32_flat` (`19058-19066`) | LM GEMM switch → `if (ne11 < 32) break` (`18137`) → flat GEMV | LM GEMM `kernel_mul_mm_q6_k_f32_l4_lm` (`18137-18150`) |
| Non-Adreno build | identical to row 2 (helper unreferenced — see §2) | same | LM GEMM |

No shape class hits an assert, and no class silently changes kernel vs pre-fix,
except the intended one. Algebra checks:

- GEMV dispatch `CEIL_DIV(ne01/2,64)*64` with `vstore2(dst, gid*2)`, no store guard
  (`kernels/gemv_noshuffle_q6_k_f32.cl:194,208`, tail `dst[gid*2]`): exact cover iff
  `ne1%128==0` — always exact for the changed class. Comment math is correct.
- The changed class is a strict subset of the noshuffle-legal class
  (`ne0>=2048>=512`, `ne1>=32768>=512`, `ne1%128==0`, 2D) — the K2.2 §1.1 claim
  "unreachable for any tensor noshuffle cannot legally take" is CORRECT, including
  for E031<38.11 drivers (threshold drops to 128, `6422-6426`).
- Convert (noshuffle layout, `8703`/`8736`) and compute (`17590`) use the identical
  predicate `use_adreno_kernels && !helper` — layout and kernel can never desync.
- Contiguity: guaranteed by `supports_op` for Q6_K MUL_MAT (`6703-6706`,
  `ggml_is_contiguous` both operands); the gemm branch's `subbuffer(offset1, ne00*ne1*4)`
  assumption (`16680-16690`) is therefore safe.

**PLAUSIBLE sub-findings (pre-existing kernel design, newly enlarged to the large-M class):**

- (a) The gemm dispatch is per-spec illegal when `CEIL_DIV(ne1,8) % 2 != 0`
  (n∈[2,8]) or `CEIL_DIV(ne01,4) % 128 != 0` (ne1 % 512 != 0) — `global {CEIL_DIV(ne1,8),
  CEIL_DIV(ne01,4),1}, local {2,128,1}` (`16736-16742`). 248320 and 32768 are both
  %512==0 (legal); other real even-vocab Q6_K lm_heads are not (e.g. Llama-3.2-1B
  vocab 128256 → 32064 % 128 = 64). The 740 driver demonstrably tolerates illegal
  dispatches (the n=16 transpose runs `global y=4 < local y=16` and PASSES on device;
  greedy E2E ran the gemm with n=7 → `CEIL_DIV(7,8)=1` odd, and produced correct
  output). On a spec-strict driver this would abort. Pre-existing pattern (FFN
  Q6_K w2 [4096,11008] already dispatched illegally at n>=32), not introduced.
- (b) n>=32 on the changed class: kernel switch LM GEMM → `gemm_noshuffle_q6_K_f32`
  happened silently — see attack vector 4.

---

## 2. Attack vector 2 — non-Adreno devices

**Verdict: CONFIRMED no-op on macro-off builds; PLAUSIBLE risk on Adreno-build/non-Adreno-device.**

- All four call sites of the helper are inside `#ifdef GGML_OPENCL_USE_ADRENO_KERNELS`:
  `8703`/`8736` (within `#ifdef GGML_OPENCL_SOA_Q` + inner ADRENO ifdef),
  `9769` (`9731-9821`), `17590` (`17286-17601`). On macro-off builds the helper is
  compiled, unreferenced, `static inline` → no warning, **zero behavioral change**.
  The old large-M redirect also did nothing there. Intel/Mali/other OpenCL kernel
  selection is byte-identical pre/post. (Note: `GGML_OPENCL_SOA_Q` is unconditionally
  defined by `ggml/src/ggml-opencl/CMakeLists.txt:17`.)
- Adreno build on a non-Adreno device (Mali/Intel with the macro ON): `use_adreno_kernels`
  does NOT check vendor — `get_adreno_cl_compiler_version` returns `{}` for any driver
  without "E031"/"DX" (`268-290`, `5466`), dropping thresholds to 128 → a Mali device
  passes for any `ne0>=128, ne1>=128, ne1%128==0`. Pre-fix the large-M class was
  exempted from the Adreno block; post-fix it joins it. This enlarges an existing risk
  class (FFN Q6_K already used noshuffle there pre-fix) rather than creating a new one,
  and the kernels' subgroup requirements (`REQD_SUBGROUP_SIZE_64`, qcom ext,
  `gemv_noshuffle_q6_k_f32.cl:7-13`) make such configs fragile regardless. Unusual
  config; flag, do not block.

---

## 3. Attack vector 3 — comment/test honesty

**Verdict: comment mostly accurate but retains one FALSE sentence; tests are regression-effective on Adreno, path-blind elsewhere, and stop at n=16.**

- **FALSE retained sentence**: "the matching GEMM (ne1>1) falls back to CPU (see
  supports_op)" (`6466-6467` post-fix). `supports_op` for Q6_K MUL_MAT (`6703-6706`)
  places NO ne11 restriction — an odd-ne1 Q6_K GEMM (e.g. granitemoe [1536, 49155],
  n>=32) runs `kernel_mul_mm_q6_k_f32_l4_lm` on GPU (`18137-18145`), not CPU.
  The fix rewrote this comment block and re-anchored a false claim. Documentation
  bug only (no behavior change), but the fix's own commit message sells the comment
  as corrected.
- Test effectiveness: the three cases FAILED pre-fix on this exact device (measured:
  `results/gdn_gpu_k21/s23/logs` — ERR 11.84 / 12.18 / 12.45 / 12.02 at m=32768 n=1,
  m=32768 n=16, m=248320 n=1, m=248320 n=16) and PASS post-fix. They would catch a
  re-introduction of the redirect on any device where the flat kernel is wrong.
  On non-Adreno CI both paths are numerically fine → the test passes regardless of
  dispatch; the commit message "must stay on noshuffle" is an intent statement, not
  something the test enforces (it asserts numerics, not kernel selection). Honest
  characterization would say "must not hit the broken flat kernel on Adreno".
- Coverage gap: no case with n>=32 (the LM-GEMM boundary) at these shapes; no case
  with `ne1%512!=0` even-vocab; the n=16 case exercises `gemm_noshuffle` only at a
  dispatch size (x=2 workgroups) 8× smaller than a real 128-token prefill.
- `m=16 n=1..9 k=256` small-flat failures are pre-existing defaults (K2.1: 10/11);
  the TODO(K2.3) disclosure is honest. "Suite 4/14" is correctly described as a
  partial gate.
- Model-naming trap (checked, resolved): the E2E model file is
  `Qwen3.5-2B-Q4_K_M.gguf`, but `ngl2_verbose.err` confirms
  `tensor 'token_embd.weight' (q6_K)` — the greedy gate DID exercise the Q6_K lm_head
  (pre-fix: garbage with "search engine"; post-fix: token-identical to CPU). Valid gate.

---

## 4. Attack vector 4 — prefill path

**Verdict: LM GEMM code untouched (CONFIRMED), but the dispatch outcome changed for n>=32 and that path is unvalidated (PLAUSIBLE gap).**

The LM GEMM block (`18120-18150`, `if (ne11 < 32) break` at `18137`) is byte-identical
pre/post. However, on Adreno the block at `17534` intercepts BEFORE it for any ne11:
pre-fix the 2B lm_head at n>=32 (helper true) went to `kernel_mul_mm_q6_k_f32_l4_lm`;
post-fix it goes to the transpose + `gemm_noshuffle_q6_K_f32` path (`16664-16747`).
That kernel is validated on this device only at n=16 (op test) — n=128 (real long
prefill; bench `-p 128` ran it at 82.26 tok/s but llama-bench does not validate
output) is unverified. The greedy E2E gate (6-token prompt, n<32) and the n=1/n=16
op cases do not cover it. If `gemm_noshuffle` misbehaves at larger n, the first token
of any >=32-token prompt would be garbage and every current gate would still pass.
Recommended closing action: add `m=248320, n=64, k=2048` (n>=32, exercises
`gemm_noshuffle` at legal dispatch sizes) and re-run the 128-token greedy on device.

---

## 5. General hostile checklist

| item | finding |
|---|---|
| Predicate arithmetic | No off-by-one; `(ne1 % 128 != 0) && ne2==1 && ne3==1` parens explicit; `ne` is int64_t, `%` well-defined; `ne1==0` → 0%128==0 → false → generic path, correct. |
| Contiguity of noshuffle | Guaranteed by `supports_op` (`6703-6706`). No view/permute path reaches it. |
| Batched/3D/4D weights | `use_adreno_kernels` requires ne2==ne3==1; helper's 2D guard matches; 3D/4D → generic flat/LM GEMM, unchanged pre/post. |
| Perf (740) | Fix is a strict win on 740: noshuffle decode 5.06 tok/s and correct vs flat 3.00 tok/s and wrong (K2 vs K2.2, same device). |
| Perf (other Adreno gens) | The redirect came from upstream #24006, which measured a real win somewhere (likely newer Adreno/driver where flat is correct and fast). 750/830/X1 never measured here; they lose the redirect and take noshuffle (or LM GEMM at n>=32). PLAUSIBLE perf regression on other gens — accepted trade, should be disclosed upstream when/if merged. |
| Build hygiene (macro OFF) | Clean: helper `static inline`, unused, no warning; all uses ifdef'd (verified at all 4 sites). |
| Git hygiene | Exactly 2 commits, exactly 2 files, `fix.diff` byte-identical to HEAD diff; no stray files in the nested repo. Parent `BigMoeOnEdge` shows ` M third_party/llama.cpp` (submodule pointer) — working-tree dirt, disclosed as "not committed" in the report; true as stated. `moe-experiments` dirt (marco csv, scripts, logs) is unrelated prior work. |
| Dead code | Odd-ne1 branch still live (granite-type odd vocab → flat + regular convert, `8703`). Not dead. |
| Q4_K residual | `use_flat_gemv_for_large_m_q4_K` (`6452-6455`) still redirects large-M Q4_K → `kernel_mul_mv_q4_K_f32_flat`, same REQD_SUBGROUP_SIZE_64 family as the broken q6_K flat kernel. A model with a genuinely Q4_K lm_head (vanilla Q4_K_M mapping; this repo's GGUF uses Q6_K token_embd instead) would still hit an untested-on-740 kernel. Out of scope, disclosed only indirectly ("Q4_K left alone"). |

---

## 6. Verdict summary

| # | finding | verdict | severity | evidence |
|---|---|---|---|---|
| 1 | Threshold hole: no shape silently changes kernel or asserts post-fix; changed class is strict subset of noshuffle-legal | REFUTED (no hole) | — | full chain `6419-6438`, `17534-17601`, `18137`, `19058`; algebra |
| 1a | gemm dispatch per-spec illegal for n∈[2,8] and ne1%512!=0; tolerated by 740 driver, abort risk on strict drivers | PLAUSIBLE (pre-existing, enlarged) | MED | `16736-16742`; n=16/n=7 empirical pass |
| 2 | Macro-off builds: zero change (all call sites ifdef'd) | CONFIRMED (no-op) | — | `8703/8736/9769/17590` + guards |
| 2a | Adreno build on non-Adreno device: vendor never checked; large-M class joins noshuffle | PLAUSIBLE (pre-existing class) | LOW | `268-290`, `5466-5470`, `6419-6438` |
| 3 | "matching GEMM falls back to CPU (see supports_op)" — false; odd-ne1 GEMM runs LM GEMM on GPU | CONFIRMED (comment bug) | LOW | `6466-6467` vs `6703-6706`, `18137-18150` |
| 3a | Tests catch the exact regression on Adreno (measured A/B), path-blind elsewhere | CONFIRMED (effective) | — | K2.1 ERR 11.8–12.5 FAIL → K2.2 OK |
| 3b | No n>=32 (LM-GEMM boundary) coverage; commit message overstates "must stay on noshuffle" | PLAUSIBLE (gap) | MED | test file `8676-8686`; only n∈{1,16} |
| 4 | Prefill: LM GEMM code untouched; but n>=32 lm_head dispatch switched LM GEMM → gemm_noshuffle, unvalidated at n>=32 | CONFIRMED (code) / PLAUSIBLE (gap) | MED | `17590` intercepts all ne11; bench -p 128 unvalidated |
| 5 | Perf regression risk on other Adreno gens (loses upstream #24006 redirect) | PLAUSIBLE | LOW | `git log -S 32768` → 63e66fdd2 (#24006) |
| 6 | Git/build hygiene: 2 commits, 2 files, diff artifact exact, builds clean either macro state | CONFIRMED (clean) | — | git log/stat, `fix.diff` diff, CMakeLists |

**Overall: the fix is correct and load-bearing — it removes a broken kernel from a
measured-wrong path and the A/B on the same device is airtight. No blocker findings.
Three things to close before calling it done: (1) validate (or explicitly scope out)
the n>=32 `gemm_noshuffle` path on 740 with a real long prefill; (2) fix or delete the
false "falls back to CPU" comment sentence; (3) decide whether the Q4_K large-M
redirect gets the same treatment (same kernel family, same 740).**

DONE
