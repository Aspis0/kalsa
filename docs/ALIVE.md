> Archived full history: archived/ALIVE-2026-09-full.md (7773 lines, mixed IT/EN, frozen 2026-09-20).

# Kalsa: ALIVE (living measured state)

Owner decision 2026-09-09 (recorded at `archived/PLAN-2026-09-full.md:1`): two living documents
only, `PLAN.md` and this one. The full diary
(every dated cell, table row and verdict to 2026-09-20) is in
`archived/ALIVE-2026-09-full.md`. This file keeps only the short measured state and the pointers
to the records.

## How to read this file

Each row names what is proven and the artefact that proves it. Nothing here is a summary of a
summary: where the record is a dated document, this file points at the document and does not
restate its numbers. Numbers that move under concurrent work are not copied here; the command or
document that produced them is named instead.

## Proven, with the record

| what | record |
|---|---|
| The engine pin the app ships is `llama.rn@0f313bab` → `kalsallama` `8537d097c` (`b11010-merge`), and the q4_K MoE OpenCL mask fix is inside it | `PLAN.md`, "The q4_K MoE OpenCL fix is in the shipped engine"; `vendor/VERSIONS` at `0f313bab` |
| The migration to upstream's `vendor/` layout: the measured upstream bump, the gates, the repaired consumers | `analysis/FORK-VENDOR-MIGRATION.md` |
| ciswire char-3-gram retrieval: recall, KV and prefill behaviour, and device thermal on S23 and Jelly | `analysis/CISWIRE-CHAR3GRAM-KV-AND-THERMAL-2026-09-19.md` |
| Xiaomi/Qwen: the fit-gate vision refusal, the ciswire char-vs-token overflow, and what did run | `analysis/XIAOMI-QWEN-FITGATE-AND-CISWIRE-TOKEN-OVERFLOW-2026-09-20.md` |
| The governor KV session contract (deferred commit, watermark, invariants) | `analysis/README-governor-kv-contract.md`; the `file:line` pins in its header are stale, so re-pin before quoting |
| How to run the Qwen `<think>` replay probe | `analysis/README-qwen-think-replay.md` |
| The governor device plan, rewritten in English on 2026-09-20, and the audited Italian body | `analysis/GOVERNOR-DEVICE-PLAN.md`; `archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md`; re-verification at `scratchpad/agents/governor-audit-recheck/REPORT.md` |
| Per-cell preregistration, raw evidence and reports | `scratchpad/agents/<cell>/` |
| The 2026-09-22 GPU numerics verdict: the fp16 activation scale as the cause of the 57x divergence, the shipped default, the `-b 1` floor, the KV term, the parity batteries | `scratchpad/agents/s23-kld-740-q4-0/REPORT.md` (sections 17-26) |
| The prefill stall reproduced on the shipped build, with a full raw logcat | `scratchpad/agents/jelly-rerun/REPORT.md` (sections 11-16) |
| The delivery chain verified end to end: release tag, vendored tree byte-compared, app pin, provenance gate that can fail | `scratchpad/agents/{release-prep,release-audit,phone-line-prep,phone-line-audit,phone-engine-v2,phone-engine-v2-audit,binding-prep,binding-audit,app-landing,landing-check-fix}/REPORT.md` |
| The day's second refuted hypothesis (activation quantiser as the common residual) and its pre-registered falsifiers | `scratchpad/agents/quant-alignment/REPORT.md` |
| Measurement method and rules for the lab | `PLAN.md`; `README.md` in this repo |
| The engine release pipeline and the manifest contract | this file, "Engine release pipeline"; current position in `PLAN.md` |

## Standing cautions

- The governor plan was re-verified and rewritten on 2026-09-20. It states its sourcing rule and
  applies it: every number carries an artefact citation or an explicit UNSOURCED label. The audited
  Italian body is archived byte-for-byte and is not a current source.
- The `README-governor-kv-contract.md` line pins were written against older trees and no longer
  match the current commits; re-pin before quoting a `file:line`.
- A device number is only as good as the phone state it was read in. The archived diary carries
  the per-run provenance, including the thermal and DSP-daemon caveats that travel with every S23
  number.
- Three limbs of 2026-09-22 are OPEN and are written as open, not smoothed: the MAGNITUDE of the
  KV term (the two reference orientations disagree by 3.2x; the full-corpus matched reference is
  queued), the THERMAL limb of the prefill stall (both rerun runs sat at
  `ThrottlingStatus: SEVERE` where the originals ran NONE), and whether the GOVERNOR actually
  engages at runtime (the last device smoke recorded REFUSED to engage; no document records an
  engagement since).

## Closed workstreams

### 2026-09-21 (21/09, night) — KV-cache workstream closed; vision pivots to LFM2.5-VL

**The KV-cache workstream is CLOSED for this cycle.** Bug #2 (ciswire budgets the window in
CHARACTERS, and the ceiling-slide projected `chars/3`) is **fixed and merged to the LOCAL app
main**: `ff6a7c0` (call-site wiring in `AppShell.tsx` — the char/token ratio is MEASURED from the
real syncs, `(pinnedWindowChars-currentTurnChars)/(nPast-systemPromptTokens)`, with NO await and
TOCTOU-safe, monotonic: it slides only BEFORE, never after) on top of `24c2e3e` (the pure machinery
in `windowProfile.ts`). The feature branches were deleted; main is a single line; **no push**.
Hostile GLM audit: monotonicity PROVEN (no overflow regression), TOCTOU clean, the harness's
telemetry parser inert to the new fields; tsc plus 48/48 jest green, verified on disk.

**KV reuse + prefill on Qwen is DEMONSTRATED** (whole-prefix; turn 3 = 3865/6257 tokens reused)
before the thermal abort (44.1 °C at turn 3). Honest correction: prose measures ~1.53 chars/token
on the Qwen tokenizer (not 3.9), so `prose@5000` at n_ctx 16384 was mis-calibrated *and* thermally
non-viable; Qwen 4B on Xiaomi stays a mess (fit-gate + norepack + thermals).

**Pivot (owner): LFM2.5-VL for vision on the Xiaomi**, in place of Qwen 4B. Websearch: LFM2.5-VL
exists in 450M/1.6B/3B (there is NO ~2.6B VL: the "2.6B" is only the LM backbone of the 3B, and the
closest to the idea is LFM2.5-VL-1.6B), official LiquidAI GGUF + mmproj, and llama.cpp mtmd support
is already MERGED (PR #15347, vision LFM2-VL, plus #19454, tiling LFM2.5-VL). Residual gate: verify
that our fork's pin includes those PRs (kalsa-63). **Bug #1 (lazy vision)** stays relevant with the
VL too.

Record: `analysis/XIAOMI-QWEN-FITGATE-AND-CISWIRE-TOKEN-OVERFLOW-2026-09-20.md` §8.

### 2026-09-22 (22/09) — GPU numerics: cause found; the stall reproduces on the shipped build; the chain verified end to end

**The fp16 activation scale was the cause of the 57x divergence.** A/B on the S23
(`scratchpad/agents/s23-kld-740-q4-0/REPORT.md` sec. 22): the fp16 control reproduces stock
**bitwise** (0.394993 / 63.892 %); the fp32-scale arm collapses to **0.005412 / 93.982 %** at
**76.44 t/s** - better on both gate limbs than the f32 route (0.006954 / 92.913 % at 68.42) and
faster than stock, so the f32 route's -9.9 % prefill cost is recovered. Confirmed in the shipped
default form, no env var at all, sec. 23: **0.005412 / 93.982 % / 76.36 t/s**. Gate: still FAIL
both limbs, but by the smallest margins measured (KLD 8 % over, same-top 1.0 pp short). The build
that carries it is engine `1577495b9` (`scratchpad/agents/phone-engine-v2/REPORT.md`; audited in
`phone-engine-v2-audit/REPORT.md`).

**The `-b 1` floor probe closed two axes** (same report, sec. 17). At batch 1, stock and full
precision are **bitwise identical: 0.006012 / 93.138 %, FAIL both limbs**. As recorded there: the
acceptance gate (<= 0.005) is **not reachable by batched-GEMM precision work** - the residual is
common to both batch shapes, not a batching artefact.

**The KV term: measured, magnitude OPEN** (sec. 24, 26). At the app's shipped KV configuration
(`q8_0` key / `q4_0` value, `-fa on`) the shipped engine reads **0.010268 / 92.126 %** full corpus
and **0.011096 / 92.717 %** reduced corpus - about **twice** the kernel-side error (0.005412).

| term | full corpus (n=1778) | reduced corpus, 4 chunks (n=508) |
|---|---|---|
| shipped KV cell (`q8_0`/`q4_0`, `-fa on`) | **0.010268 / 92.126 %** | **0.011096 / 92.717 %** |
| kernel-side reference point (D1 default / B' f16-fa-off) | 0.005412 / 93.982 % | 0.005426 / 94.882 % |
| isolated GPU-side KV term | **+0.001493** | **+0.004754** |
| flash-attention term | +0.003363 (conflated with a mixed reference) | **+0.000916** (matched) |

The isolated term is therefore **+0.0015 to +0.0048 depending on reference orientation** - the two
corpora disagree by **3.2x** - so the magnitude is **not yet settled**, and the full-corpus matched
reference (`cpu-f16faon`, killed under charge once) is **queued** (sec. 24's missing cell). What
both corpora do support: the pure flash-attention term is small (**+0.0009**, matched), and the
GPU-side KV penalty is real and positive in both orientations. Reduced-corpus numbers are
decomposition-only (n=508) and do not go in the same column as the 14-chunk tables (sec. 26 banner).

**The owner's question is answered: the arm differences are adverbs, not facts** (sec. 18-20):

| battery | result |
|---|---|
| 6 realistic prompts, 15 arms | every pair diverges textually (first diff at char 19-386); **material divergences: 0** (P1 all arms "Canberra"; P4 the same tool call) |
| 10 memory facts, CPU vs GPU | differ **10/10**; rows where one arm is right and the other wrong: **0** (reverse case: 0); final answers emitted in budget **0/10** |
| safety, 6 categories x CPU/GPU x t0/t0.7 = 24 arms | complied **0/24** - parity holds on all 6 categories at both temperatures; **4 pre-answer cells flagged RELEASE BLOCKER CANDIDATE** (S1_t07, S4_t0, S6_t0, S6_t07) |

Truncation caveat that governs both batteries: the reasoning template consumes the token budget,
so classes describe pre-answer reasoning intent, not final replies; a budget-up re-run (n>=160) is
required before acting on the safety marking - owner's call.

**The stall reproduces on the configuration we ship** (`scratchpad/agents/jelly-rerun/REPORT.md`,
sec. 11-16). On APK `d3c66bdb` (engine `1577495b9`): `KALSA_STALL
{"gapMs":0,"tokens":0,"turnId":"1","reason":"prefill","tokPerSec":31.755...}` at **+1175.04 s**
after `KALSA_THINKING` (original: +739 s), same form, zero tokens, persisted notice `entro 1175 s`.
For the first time a **full raw logcat** exists: **zero native/RNLlama lines across 19.6 minutes** -
a silent stall, not a crash (closing meter-close's unproven blank-window item for this run). Run B
COMPLETED (+213.30 s, 75 tokens, answer `4`) but **two variables moved** (seeded EMA *and* warm KV,
`nPast:11875`, only 761 new prompt tokens), so **"the EMA fixed it" is not supported** (sec. 13).
Both runs ran thermally throttled (`ThrottlingStatus: SEVERE` x69, skin 47 C) where the originals
ran NONE - **the thermal limb is untested** (sec. 16); the cool-state repeat is the cheapest next
measurement and was not set up because the APK is not debuggable (D1: no `run-as`, no energy CSV).

**The instrument lesson of the day, twice - one disease: work that exists in exactly one place.**

1. The Meter arms itself by writing a flag into the app's private storage, which needs `run-as`,
   which needs a **debuggable** app. That flag lived as a **one-line hand edit** (`debuggable true`)
   inside `android/app/build.gradle` - a file that is gitignored and regenerated by
   `expo prebuild` - so a clean prebuild deleted it, and with it the ability to measure energy on
   the release artefact. A **tracked bench build** is in flight, plus a channel that does not need
   `run-as` (`scratchpad/COORDINATOR-STATE.md`, "Results of 2026-09-22").
2. An APK whose hash was cited in a report (`fbfe131f...`, sec. 3) was deleted by the 2026-09-21
   cache cleanup and exists nowhere this Mac can see (all 50 APKs hashed, 0 matches, sec. 8).
   **Rule adopted: an artefact whose hash is cited must be archived before any cleanup touches
   build output.** Honoured the same night: the shipped APK was archived to
   `~/kalsa-local-artifacts/` before install (jelly-rerun sec. 11).

**The day's second refuted hypothesis - the activation quantiser as the common residual**
(`scratchpad/agents/quant-alignment/REPORT.md`, sec. 0). The hypothesis: the ~0.005-0.006 residual
common to both batch shapes is carried by the GPU's activation quantiser. Refuted, and the reasons
are the record:

1. **At batch 1 the quantiser never executes.** All seven `kernel_quant_a_q8_1` dispatch sites are
closed for this model at `ne1==1` (q6_K needs `ne1 > 8` at `ggml-opencl.cpp:23090`; q4_K dp4a is
X2E-only; q4_0 defaults false; the rest are off or in dead MoE branches). The b1 GEMVs read
`CL_FLOAT` activation images - f32 end to end. **A component absent in one shape cannot be the
term common to both**, which was the whole inference; the bitwise stock==full at b1 proves only
that the selector is inert at that shape.
2. **Where the quantiser does run, its sign helps**: at b256, removing it (the f32 route) costs
**+0.001542** (0.005412 -> 0.006954). It cannot carry the +0.005 that is there.
3. **What survives**: the residual is plausibly **weight-side** - the fp16
`half4 dequantized_weights` in the K-quant kernels (`gemm_noshuffle_q4_k_f32.cl:63`) and the gemv
`d*sv` half sub-scale. Present in both shapes, and **never measured on q4_K/q6_K anywhere** (the
older Adreno work tested it only for q4_0). The reference-side Q8_K floor is the other survivor,
and it can only be attacked by *adding* CPU-matching quantisation to paths that have none.
4. **Pre-registered falsifiers, written before anything is built** (sec. 3): an instrumented b1 run
must report `quant_a=0`; the env-only q4_K dp4a forcing probe at b256 must land >= ~0.0085 under
the old hypothesis (< +0.002 kills it); a Q8_K-matched build must move >= -0.0005; a b1 arm with
harness-proven bitwise CPU-matched activation codes must stay >= 0.0055 to falsify the floor and
hand the lead to the weight side. Two anomalies kept open, not smoothed: b1 and b256 were scored
against **different references** (PPL 27.0660 vs 27.2114), and the **+0.001542** where the f32
route is *worse* than the int8 route is unexplained.

The pattern, kept: **a hypothesis is only useful if the number that would kill it is written
before the measurement.**

**The delivery chain moved, and it is verified end to end for the first time:**

| link | value | record |
|---|---|---|
| release tag | `kalsa-server-v1.1.1` on engine `a7d2cec79` (= `main` `833cde99b` + the governor pair) | `scratchpad/agents/release-prep/REPORT.md`; independent audit 6/6 in `release-audit/REPORT.md`; tag object `0f1b3bec...` read from the remote in `phone-engine-v2-audit/REPORT.md` sec. 7 |
| artifact | published to R2, manifest names the tag object and the commit, run `35762258094` | manifest read back by `kalsa-brain` `dev/results/concurrency-two-devices/results.json` |
| binding | `kalsarn-governor-engine` = `5b966218`; vendored tree proven byte-identical to the engine archive plus the repo's 20 patches, by comparison | `scratchpad/agents/binding-prep/REPORT.md` round 2 sec. 2 (VERIFY_OK; independent audit of round 1: `binding-audit/REPORT.md`) |
| app | branch `engine-pin-kalsallama` = `e206a945`; provenance gate enforced and now **able to fail**: breaking the pin exits 2 with both shas printed | `scratchpad/agents/app-landing/REPORT.md` R2; `landing-check-fix/REPORT.md` (suite 37 passed / 0 failed) |

Two honest caveats, stated rather than smoothed:

- The CI run triggered by that push **failed before reaching the gate**
  (`android-actions/setup-android@v3` cannot fetch the removed `tools` package), so CI-enforced
  provenance does not exist yet - only the place where it should stand (`scratchpad/COORDINATOR-STATE.md`,
  "Chain state").
- Jest is **dead** in the binding's environment: 12/12 suites fail inside react-native 0.72's jest
  setup on node 26, pre-existing on the pristine base - that layer has no test net
  (`scratchpad/agents/binding-audit/REPORT.md` item 5).

**The desk's panel number (other workstream) - three runs, one row.** The desk answered the
discrepancy plainly: **not a transcription - three different runs of the same measurement**, all
three now registered. Two devices decoding on one `kalsa-server-v1.1.1` engine, attributed to the
release artefact by its published sha (`exe_sha256` matched against the manifest row,
`release.status = matched`):

| run | commit | per device | aggregate | A2/A | load floor (1m) |
|---|---|---|---|---|---|
| 1 | `5b9b98f` | 0.7546 (**69.17 alone / 52.20 each t/s**) | **1.5093** | 1.0105 | ~4-6 |
| 2 | `fe14e78` | 0.7302 | **1.4604** | 0.9982 | ~2 |
| 3 | `34de14f` | 0.7336 | **1.4672** | 1.0037 | 4.08 |

**The panel row is run 3**, and the reason is not recency: it has the tightest drift control
(1.0037 against 1.0105) and its provenance travels as **fields inside `results.json`** rather than
in prose - a debt the desk declared and the following session paid. Two things that must sit next
to the figure, because a reader following only the path cannot see them:

1. **Run 3 overwrote the same file.** `dev/results/concurrency-two-devices/results.json` now holds
   run 3; run 1's `results.json` survives **only in git history, at commit `5b9b98f`**. Wherever
   this path is cited it must cite the commit too - otherwise two different figures attributed to
   one path read as a transcription error, which is exactly the confusion this round untangled.
2. **The three runs agree within 3 %** (1.4604 / 1.4672 / 1.5093), per-device between 0.73 and
   0.75: the spread between runs is **the floor, not the measurement**. So the figure is never
   written as a constant - it is read with the artefact label and the load alongside.

Record: the three commits above, `kalsa-brain` `dev/results/concurrency-two-devices/`, and
`kalsa-brain/docs/HANDOFF-2026-09-22.md` sec. 4.

**The four desk commits: recorded local-only, then pushed the same day - correction kept
visible.** The panel row labelled with the release (`1f22bb7`), the provenance fields inside the
artefact (`fe14e78`), and the two tasks recorded as decided-and-not-implemented, now implemented
locally - `Stopping` (`6efec90`) and the `Stopped` invariant with its proof (`f1df191`,
`ae78761`, `f9d8861`) - sat LOCAL-ONLY pending an owner decision: `origin/brain` at `cac9068`,
the session's handoff saying plainly "no push was authorized". That state was real while it
lasted, and it is kept on purpose rather than erased: it was the fourth candidate of the day for
**work that exists in one place only**, the same disease as the two process lessons above.

**Corrected 2026-09-22: the desk pushed.** `cac9068..3660706  brain -> brain`, exit 0, the
fast-forward re-verified an instant before pushing (remote still `cac9068`, 0 behind / 14 ahead),
working tree clean before and after, local `HEAD` equal to the remote sha. The remote now reads
`refs/heads/brain = 3660706793dad68f0ac85366ab09805cb6ddb733`, confirmed independently with
`git ls-remote`. The state changed; the reason it was flagged does not: one-place work bit this
project three times today, and this was the fourth candidate until the push closed the window.

## Engine release pipeline (`kalsa-server`)

The macOS engine binary. How it works and how to do it again; current position, decisions and the
open items are in `PLAN.md`, "Engine release: current position and next steps".

### Source and release identity

| item | value |
|---|---|
| Source of truth | `Aspis0/kalsallama` (private) |
| Release branch | `kalsa-release-v1-1-1`, tip `a7d2cec79e7d495cbfa3e6b3a78bd4af3fab44b1` (= `main` `833cde99b` + the two governor commits) |
| Phone branch | `kalsa-phone-v1-1-1`, tip `1577495b92096fca572f57a35b71607bacac85d5` (release tip + four GPU picks + the q8-scale pick + the dp4a default flip) |
| Release tag (current) | `kalsa-server-v1.1.1`, annotated; tag object `0f1b3bec7342ddd5624dc474c760a0b38bc80b5b`; commit `a7d2cec79e7d495cbfa3e6b3a78bd4af3fab44b1` |
| Release tag (previous) | `kalsa-server-v1.1.0`, annotated; tag object `c105c218236799f2f651517f5a0aeabcf4a8d8a1`, commit `2a290390d67311b580ef398fd545e6d060b39897` (cut from `b11010-merge`, then the release line) |
| Release tag (before) | `kalsa-server-v1.0.0`, annotated; tag object `d30c8d475d5eb47a544304ba592138d066bbc2e3`, commit `4ccef2f85dbc27e095e11ffcbad4628be9961790` |

The tags are IMMUTABLE: never moved, never forced, never re-created. A tag is a
snapshot of the release path, not of the code: the workflow file inside a tag is frozen, which
is why a rebuild of an existing tag is done by dispatching with `release_tag` against the branch
it was cut from (v1.0.0/v1.1.0: `b11010-merge`; v1.1.1: `kalsa-release-v1-1-1`). For v1.1.0 the
tagged tree already carries the current workflow, so the tag push itself publishes - v1.1.1 was
published the same way, by run `35762258094`.

### Published state, v1.1.1 (published 2026-09-22)

v1.1.1 is current. Its identity was read back consumer-side from the published manifest, not from
the run log: `kalsa-brain` `dev/results/concurrency-two-devices/results.json` (fetched
2026-09-22T22:48:07Z, manifest sha256
`55d8128c05a985f54f7cb87a7cc99a89c640542d0619f4ae3cbf9ac1ec87f450`), with the matching method
recorded in `kalsa-brain/docs/HANDOFF-2026-09-22.md` sec. 4.

| check | v1.1.1 (current) |
|---|---|
| Home | `https://dl.kalsa.io/kalsa-server/v1.1.1` |
| Archive | `kalsa-server-v1.1.1-bin-macos-arm64.tar.gz` |
| Archive sha256 (`pack_sha256`) | `a90d88a1650367c6821f70e625a4ff2d43744d5986580c206434381a732075a7` |
| Tag object / commit | `0f1b3bec7342ddd5624dc474c760a0b38bc80b5b` / `a7d2cec79e7d495cbfa3e6b3a78bd4af3fab44b1` |
| Producing run | run `35762258094`, `built_at 2026-09-22T17:50:26Z` |
| Platform / backend | `macos-arm64` / `metal` (from the manifest, never from the host) |
| `exe_sha256` | `327fb363e5246284a74fe9ee7ed8ea70d121979d65a670caf1d0cdd838e96cde` - the same launcher hash as v1.0.0 and v1.1.0, trap 1 below behaving exactly as recorded |
| Engine version string | `version: 0.4.1-dev (build 11195, commit a7d2cec79)` |
| Verification | executed binary hashed against the manifest row: `release.status = matched` |
| Archive size | not carried in this file |

### Published state, 2026-09-21 (v1.1.0 was current then; v1.0.0 stays available)

Both versions serve HTTP 200 anonymously and were verified consumer-side by downloading from the
public URL, not by reading the run log.

| check | v1.1.0 (current) | v1.0.0 |
|---|---|---|
| Home | `https://dl.kalsa.io/kalsa-server/v1.1.0` | `https://dl.kalsa.io/kalsa-server/v1.0.0` |
| Archive | `kalsa-server-v1.1.0-bin-macos-arm64.tar.gz` | `kalsa-server-v1.0.0-bin-macos-arm64.tar.gz` |
| Archive size | 11205316 bytes | 11203439 bytes |
| Archive sha256 | `9ee5d9f5199475844c99ac93272d429711b2f58d2a7c5d652c7495a391c5f034` | `3fe62ebfe7fd9ddd21fa8857f68f2c34bfc8557fb1811b54f89012260c5c88a7` |
| `.sha256` sibling | agrees | agrees |
| Archive top directory | `kalsa-server-v1.1.0` | `kalsa-server-v1.0.0` |
| Producing run | run `35565687271` | run `35549848243` |
| Cached slot inlet in the shipped dylib | yes | no |

Shape is the same in both: no `default.metallib`, no `ggml-tensor.metallib`, no `kernels/`
entries; the metallib is embedded in `libggml-metal.*.dylib`; the manifest records
`backend: metal`.

The archive holds **58 tar entries: 1 directory plus 57 file entries**, and the file entries are
**41 regular files** (40 Mach-O binaries — the executables and their dylibs — plus `LICENSE`) and
**16 symlinks** (the unversioned and `.0` aliases of the versioned dylibs). v1.0.0 measures the
same 58/1-57/41/16. These are MEASURED counts: an earlier report of "57 entries, 56 files" was a
transcription error, and pinning a transcribed count is how a bundler comes to reject a correct
archive. Every Mach-O's dependency resolves through `@rpath`, `@loader_path` or a system path.

### Where the code actually lives (two traps found on 2026-09-21)

1. **`exe_sha256` cannot tell two versions apart.** `kalsa-server` is a thin LAUNCHER and is
   byte-identical in v1.0.0, v1.1.0 and v1.1.1, so the manifest's `exe_sha256` is the same
   (`327fb363e5246284a74fe9ee7ed8ea70d121979d65a670caf1d0cdd838e96cde`) in all three (the v1.1.1
   value read back from its published manifest). The server
   implementation is `libllama-server-impl.dylib`, and that DID change
   (`d7491bbf96d895c7a3680cfe710e3cf12f57ca240b20b4ee51ea0f19a01742fc` at v1.0.0 →
   `4b7d69fbb8505bb06a5a3b713bafe0d614883361c7d3ad0c4b5137e5809773fd` at v1.1.0). Version
   identity is therefore the ARCHIVE sha256 (or `tag_object`/`commit`), never `exe_sha256`. The
   desktop's first-launch marker re-check stays as a secondary integrity check on the launcher
   only.
2. **The port header literal in the binary is LOWERCASE.** The wire header is `X-Kalsa-Slot`
   (HTTP header names are case-insensitive) but the compiled key is `x-kalsa-slot`, because the
   code lowercases the received name before matching (`tools/server/server-context.cpp:4538`;
   the salt one is `x-kalsa-cache-salt` at line 4504). So a display of presence must be
   case-insensitive or lowercase: `strings -a <top>/libllama-server-impl.dylib | grep -c
   'x-kalsa-slot'` returns 1 for v1.1.0 and 0 for v1.0.0. A capitalised grep returns 0 on a GOOD
   build, which is the worst class of check: one that fails the correct artifact.

### Workflow

`.github/workflows/kalsa-server.yml`, self-contained. No workflow artifacts and no caches; job
permissions are read-only, so the path needs no write access to the repository.

| trigger | behaviour |
|---|---|
| `workflow_dispatch` | input `release_tag` (required); release-only |
| `push` to `b11010-merge` | branch build, no publish |
| `push` on tags `kalsa-server-*` | tag build |

macOS job steps, in order:

1. Checkout `refs/tags/<tag>`.
2. Assert `HEAD == $(git rev-parse refs/tags/<tag>^{commit})`.
3. Build the web UI INSIDE the job: `actions/setup-node@v6`, node 24, `npm ci` and `npm run build`
   in `tools/ui`.
4. cmake with `-DLLAMA_USE_PREBUILT_UI=OFF`, so the UI can never be fetched from Hugging Face.
5. Rename the binary to `kalsa-server` (the CMake target stays `llama-server`).
6. Pack TWICE and compare the two sha256 values.
7. Verify every Mach-O's `@rpath` closure inside the archive.
8. Run `kalsa-server --version`; probe `/health`.
9. Publish.

### Publish target and immutability

- Cloudflare R2 bucket `kalsa-downloads`, prefix `kalsa-server/v<version>/`, three objects: the
  `.tar.gz`, its `.sha256`, and `manifest.json`.
- Public URL:
  `https://dl.kalsa.io/kalsa-server/v1.0.0/kalsa-server-v1.0.0-bin-macos-arm64.tar.gz`.
- Secrets `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`
  (= `https://8a991014729a52a958cef2c5cbf0de50.r2.cloudflarestorage.com`) are passed ONLY as
  environment variables, never as command-line arguments. The token is scoped to the single bucket
  `kalsa-downloads` only: object read/head plus write, plus listing for the advisory check, and NO
  repository permission of any kind. The `head-object` gate needs the read/head permission; without
  it every check aborts.
- Before upload the step checks that the version prefix is empty and refuses to publish if anything
  is there, unless the `force` dispatch input is true (which prints a loud warning that every pinned
  URL will start serving different bytes). `force` never bypasses a FAILED check.
- The existence check does NOT list. Three traps make list-based checks unusable here: `aws s3 ls`
  exits NONZERO on an empty prefix (aws/aws-cli#5544); a JMESPath `Contents[]` projection prints the
  literal string `None` for an absent array; and Cloudflare R2's `ListObjectsV2` omits `KeyCount`,
  unlike AWS. The decision therefore comes from three `head-object` calls on the exact keys: a clean
  `404`/`NoSuchKey` means absent, exit 0 means present, and any other failure aborts and is never
  bypassed by `force`. R2 documents a missing key as HTTP 404 / `NoSuchKey` / error 10007
  (`https://developers.cloudflare.com/r2/api/error-codes/`).
- After upload a recount asserts all three objects exist and that the archive size equals the local
  one.

### Cache behaviour

Cloudflare's cache stores HTTP 404 responses automatically for a domain with caching enabled, and
an overwritten object keeps being served in its OLD form until TTL expiry or an explicit purge.
Source: `https://developers.cloudflare.com/r2/reference/consistency/`.

Measured on `dl.kalsa.io`: a request to a not-yet-published path returns `cf-cache-status:
DYNAMIC`, so the 404 is NOT cached and no path is poisoned today. The publish step checks the bucket
through the S3 API, which bypasses the cache entirely; a client-side 404 must therefore be
re-checked with a cache-busting query before it is believed.

### Releasing a new version

Push an annotated tag `kalsa-server-vX.Y.Z`; the tag trigger builds, verifies and publishes, and
the tag's own workflow file is what runs. To rebuild or republish an EXISTING tag (whose workflow
file is frozen), dispatch against the branch instead:

```
gh workflow run kalsa-server.yml --ref b11010-merge -f release_tag=kalsa-server-vX.Y.Z
```

v1.1.0 was published by the first path (run `35565687271`, `trigger: push on a tag`); v1.0.0 by the
second (run `35549848243`, `trigger: workflow_dispatch with release_tag`); v1.1.1 by run
`35762258094` (run id from its own manifest). Before any tag: the branch
must have a GREEN `push` run at the commit being tagged, because a branch run exercises build, pack,
reproducibility and verification without touching the bucket.

### Manifest contract (the desktop consumes this)

One manifest per version, published at
`https://dl.kalsa.io/kalsa-server/v<version>/manifest.json`. It holds a LIST of artifacts because
platforms and backends will grow; today it holds exactly one entry. All values are computed in the
run, never typed by hand.

```json
{
  "version": "v1.1.0",
  "tag": "kalsa-server-v1.1.0",
  "tag_object": "c105c218236799f2f651517f5a0aeabcf4a8d8a1",
  "commit": "2a290390d67311b580ef398fd545e6d060b39897",
  "ref": "refs/tags/kalsa-server-v1.1.0",
  "trigger": "push on a tag",
  "run_url": "https://github.com/Aspis0/kalsallama/actions/runs/35565687271",
  "built_at": "2026-09-21T05:49:19Z",
  "reproducible": true,
  "pack_sha256": "9ee5d9f5199475844c99ac93272d429711b2f58d2a7c5d652c7495a391c5f034",
  "artifacts": [
    {
      "platform": "macos-arm64",
      "backend": "metal",
      "home": "https://dl.kalsa.io/kalsa-server/v1.1.0",
      "file": "kalsa-server-v1.1.0-bin-macos-arm64.tar.gz",
      "url": "https://dl.kalsa.io/kalsa-server/v1.1.0/kalsa-server-v1.1.0-bin-macos-arm64.tar.gz",
      "format": "tar.gz",
      "top_dir": "kalsa-server-v1.1.0",
      "exe": "kalsa-server",
      "size_bytes": 11205316,
      "sha256": "9ee5d9f5199475844c99ac93272d429711b2f58d2a7c5d652c7495a391c5f034",
      "exe_sha256": "327fb363e5246284a74fe9ee7ed8ea70d121979d65a670caf1d0cdd838e96cde"
    }
  ]
}
```

v1.0.0's manifest differs only in the version, tag, tag object, commit, trigger, run URL,
`built_at`, the `v1.0.0` home/file/url/top_dir, `size_bytes` 11203439 and `sha256`
`3fe62ebf…88a7`.

v1.1.1's manifest follows the same contract; its fields as read back are in "Published state,
v1.1.1" above (tag object, commit, run, `pack_sha256`, platform, backend, and the unchanged
launcher `exe_sha256`).

Notes:

- `exe` exists because the shipped binary is `kalsa-server` while the CMake target remains
  `llama-server`.
- The filename carries no backend because it is part of the desktop contract. A uniqueness
  invariant asserts that no two matrix entries share an architecture. If a future backend needs the
  same architecture, the filename must gain a backend suffix and the manifest must change in the
  same commit.
- A fresh CI build of the same tag does NOT reproduce an earlier archive byte-for-byte: the UI
  assets are rebuilt and the archive size and digest change. The manifest published with each
  artefact is therefore the authoritative record for THAT object; never read a digest as a claim
  about a different build. Note the asymmetry: the ARCHIVE differs between two builds, while the
  launcher executable hash does not change even between DIFFERENT versions (see "Where the code
  actually lives" above), so the executable hash is neither a version nor a build identifier.
- The release path has exactly one build-time network fetch, the BoringSSL `FetchContent` clone in
  `vendor/cpp-httplib/CMakeLists.txt:45-68`. It is inherited unchanged from the v1.0.0 path and is
  a build-time fetch in a pipeline the desktop does not run; it is recorded here and was
deliberately NOT changed in the v1.1.0 tag.

## The full diary

`archived/ALIVE-2026-09-full.md`, 7773 lines, English narrative with Italian table rows, frozen
2026-09-20. Read it from the tail. `archived/PLAN-2026-09-full.md` holds the matching plan
history.
