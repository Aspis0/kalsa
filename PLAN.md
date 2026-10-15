> Archives: `archived/PLAN-2026-09-full.md` (full Italian history to 2026-09-20),
> `archived/PLAN-2026-10-09-full.md` (the full PLAN to 2026-10-09, frozen before this compaction).
> The diary and every superseded detail live there; this file keeps only the standing rules,
> the gates and the current state of each workstream.

# Kalsa: PLAN (living)

## What Kalsa is

Kalsa is an Android and iOS chat app that runs language models on the phone itself, no server in
the loop, plus a desktop app (kalsa-brain) it pairs with. Standing goal (owner): a kernel that uses NPU, GPU and CPU per phase according to
temperature, battery and device profile, optimised for Snapdragon, and for MediaTek/Jelly where
possible (`archived/PLAN-2026-09-full.md`, section "Il goal"). The engine is our llama.cpp fork, consumed through our `llama.rn` binding fork pinned
by commit; the app is React Native. Device measurements are the arbiter; this lab repo holds the
method, the raw evidence and the audits. Scope (owner, 2026-09-29): DENSE models in Q4_0
(one-copy NPU prefill reader, governor) first; MoE and our own quantisations later.
Accelerator order (owner, 2026-09-29): Snapdragon, then iPhone, then Exynos, Mali, Tensor.

## Standing rules

### NOTHING GOES UPSTREAM (owner, 2026-09-21, permanent and absolute)

Nothing goes upstream. Ever. No pull requests, no issues, no comments, no reviews, no patches,
no discussion posts, no mailing list, no Discord, nothing. Reading upstream is allowed and
useful (`git fetch upstream`, logs, issue pages); writing anything upstream is forbidden, by us
and by any agent acting for us. The fork is ours and stays ours. Where an earlier record says
"push this as a PR", the fork-only equivalent applies: keep it in the branch. This rule sits
ABOVE the push/tag/release rule: push, tag and release additionally require the owner's explicit
OK. The coordinator pushes after an audit; agents do not push.

### A coder's refspec is a proposal, not a decision (2026-09-23)

The shipping line moves only when the audit's checklist is cleared. A push command written
against a shipping ref is a proposal for the owner: on 2026-09-23 a coder's push block named the
shipping ref, what ran created a new ref instead, and the shipping ref was verified unmoved
(`scratchpad/agents/cok-residual/REPORT.md` sec. 9). Review the REFSPEC, not just the patch.

### Two living documents only (owner, 2026-09-09)

`PLAN.md` and `docs/ALIVE.md` are the only two living documents. Dated findings and contracts
under `analysis/`, and per-cell evidence under `scratchpad/agents/`, sit outside `archived/` on
purpose. Every other `.md` is frozen, in `archived/` or in place. The count is whatever
`git ls-files '*.md' | rg -v '^(archived/|PLAN\.md$|docs/ALIVE\.md$)' | wc -l` prints, so it
cannot go stale. Archive blobs are byte-fidelity copies, original language kept.

### The four repos, their checkouts and the delivery chain

The authoritative map is `REPOS.md` in the app repo. The live checkouts:

| repo | local checkout | role |
|---|---|---|
| `Aspis0/kalsa` | governor/app work: worktree `~/Projects/kalsa-wt-gov`. `~/Projects/kalsa` is shared and holds another session's uncommitted UX work - do not edit it. `~/Projects/kalsa-brain` = branch `brain` (desktop) | the app |
| `Aspis0/kalsallama` | worktree `~/Projects/kalsallama-upstream-b11514` (the live tree). `~/Projects/kalsallama`'s local `main` is stale (`5b596ce43`) | the llama.cpp fork: OpenCL MoE kernels, Hexagon, repack, governor |
| `Aspis0/kalsa.rn` | `~/Projects/llama.rn-kalsa-onecopy` | the React Native binding fork, upstream `vendor/` layout |
| `Aspis0/kalsa-moe-experiments` | `~/Projects/kalsa-moe-experiments` | the lab: this repo |

One repo is archived read-only: `Aspis0/kalsa-forkbigmoeonedge`, a lab submodule for provenance.
Engine and binding forks are main-only (retired lines are `archive/<name>` tags).

The delivery chain: engine commit -> binding vendor bump (`vendor/VERSIONS` names the engine
commit; HTP DSP skels are rebuilt from the same tree, with a skew gate) -> app pin
(`package.json` pins `kalsa.rn#<sha>`) -> provenance gate (`npm ci` + assert-engine-provenance,
must exit 0) -> CI APK -> device verification. The app pin moves only with the owner's OK.

### Other standing rules (owner, 2026-10-02)

- Audits are triaged: fix P0/P1 and P2 that touch app/users/performance; the rest goes to the
  root `BACKLOG-LOW-PRIORITY.md` (current; `scratchpad/BACKLOG-LOW-PRIORITY.md` holds older
  leftovers) and work moves on.
- ONE max-recall cross-file review per piece of work, then triage as above.
- An artefact whose hash is cited must be archived before any cleanup touches build output.
- Measurement hygiene: heat and speed claims only unplugged on our phones (never benchmark
  charging); every timing ratio states the screen state of both arms; every published number
  carries its load condition. QDC boards are always powered: speed indicative, heat none.
- Endurance criterion (owner 2026-10-08): start at skin <= 31 C (S23), run until skin 43 C,
  report mean tok/s next to it. Safety kills only: skin 44 C, battery < 30 %. No leg-headroom stop.
- S23 before every session: `persist.traced.enable` must be 0 (the DSP-daemon spin fix).
- No `apk.yml` dispatch without telling kalsa-brain first (agreed 2026-10-07).

### No claim without a cited line (owner, 2026-10-15)

> *"Basta cercare e usare explorers e non c'è bisogno di allucinare niente. Basta citare le righe
> lette."*

- **If you cannot cite `file:line` for it, you did not read it — do not assert it.** Search first,
  then speak. A claim about our own code or our own history is never made from memory, from a
  subagent's summary, or from a plausible-sounding inference.
- **A delegated report is not evidence.** Re-open every load-bearing citation on disk, with a real
  exit code, before it enters a document or a commit. A delegate correcting the coordinator is
  checked twice, like any other claim.
- **"Not verified" is a valid, expected answer** and is written down as such. Never fill a gap with
  the likely story.
- What this rule is for, from 2026-10-15 where all three coordinator claims of the day were wrong on
  first pass and each was dissolved by one cited line: `governorInputs.ts:395` (the NPU lane was not
  hardcoded off), `xiaomi14-3way/REPORT.md:18` (SM8650/v75 NPU prefill does exist),
  `xiaomi-stage0-obs-aa789620/raw/harness.log:63` (same APK, so not a regression). Each was stated
  confidently and none was read.

## Gates and dates (recovered 2026-09-21; statuses as the record shows on 2026-10-09)

Critical path: **G0 baseline -> G1 model -> G2 complete chat -> G3 correct profiles -> G4
sustained quality -> M1**. Dates are 2026 planning estimates subordinate to the gates, not
publication promises (`archived/PLAN-2026-09-full.md:408-431`).

| date | gate | requires | status 2026-10-09 |
|---|---|---|---|
| 9 Sep | **G0** | reproducible baseline, real device matrix, schedulable slots | closed (2026-09; QDC + our two phones in use) |
| 14-15 Sep | **G1** | model chosen, baseline with per-phone targets written before tuning | closed 10 Sep: LFM2.5-2.6B QAD Q4_0, sha `a247afd6` |
| 21-23 Sep | **G2** | complete chat, 20-30 turn sessions, recovery without corruption | S23: MET 2026-10-10 - 20/20 turns in-app, unplugged, no crash, no recovery, status never 3 (APK `233486dd`, cell `s23-g2-full099-233486dd`); recovery without duplicate seen on `867affaa`. Other phones open. Earlier: first in-app run 2026-10-09 (APK `1f0e967b`) stopped at turn 4 on Android SEVERE (`s23-g2-inapp-1f0e967b`) |
| 28-29 Sep | **G3** | every phone has at least one correct path; every ENABLED path passes its tests | partial: S23 yes in-app; Xiaomi correct in lab, in-app still two-copy until the SM8650 row ships; Jelly Star out of scope (owner 2026-10-11: unsupported until a Mali GPU kernel) |
| 30 Sep-2 Oct | **G4** | sustained quality; consumption measured or limits declared | open: in-APK consumption first measured 2026-10-11 on the S23 (turn 1: governor ON 254-294 mWh vs OFF 376 mWh, 1.8-2.0x per output token, OFF SEVERE in that turn, `s23-meter-gov-onoff-bc99cfeb`); Meter sampler overhead: conditional bound <= 0.24-0.44 % of a turn, under the 1 % bar (`s23-meter-overhead-bc99cfeb`); the 2026-09-28 governor blind spot has no later verification |
| 9 Oct (reserve 16 Oct) | **M1** | first model complete and banked on the three phones, or a precise list of missing gates | NOT met as of 2026-10-09: no APK exists with the 2026-10-09 pin; G2 open |
| 30 Oct | **M2** | second dense model on validated devices | future |
| 20 Nov (reserve 27 Nov) | **M3** | first large MoE within the declared perimeter | future; the MoE lane itself is PARKED (see workstreams) |

Rules kept with the table: G3 - NPU without evidence stays out; M2 - the second model must add
useful capability, not be the automatic loser of the first comparison; a release candidate has
no dependency on hidden debug flags; never promote an incomplete build. Riders: the GPU/V75/q4_K generations, the NPU and the governor were
evidence-gated in the 24-29 Sep window, NOT "after M1"; a separate gate on 12 Oct reopens the
MiniCPM5 fine-tuning decision (LFM licence revenue threshold one input). Owner decision
2026-09-21: the governor work was brought forward because G2's long-session criterion is
unreachable without thermal control in the loop; the app-side energy measurement (Meter) is part
of the governor work, not beside it.

## Workstreams (newest first)

### One copy, three legs + governor (the front)

One weight copy read by NPU, GPU and CPU; the governor hops decode between legs. Design:
`scratchpad/agents/onecopy-three-legs/DESIGN.md`, `FABLE-DESIGN.md`.

- Legs CORRECT on the merged engine everywhere measured: S23 real phone (cell
  `s23-merge-b11514-legs-73`), Xiaomi 14 real phone including the GPU-750 fix (cell
  `xiaomi-merge-b11514-legs-74`), QDC SM8650 + SM8750 + SM8850 (cell
  `qdc-merge-b11514-legs-72`). The GPU-750 defect was upstream's
  `kernel_mul_mat_f16_f32_l4_y8` on the decode KQV; fixed by keeping A7X off it, engine
  `e01a61cee` (cells `qdc-8g3-gpu750-dump-67`, `qdc-8g3-gpu750-y8-70`, `qdc-8g3-onecopy-legs-71`).
- Governor vs single legs, S23 endurance to skin 43 C, unplugged: round 3 headroom governor
  LOST (2785 tokens vs NPU-alone 6051, GPU-alone 5506;
  `step5-s23/raw/session26-vsleg3-fbf33176c.grep`). Round 4, rule v3 HEAT_RANK: TIES NPU alone
  (449/420 s vs 453/431 s, same 6144 tokens; `step5-s23/raw/r4/REPORT.md`). Honest S23 claim:
  the governor equals NPU alone, no gain where the NPU is best on both axes; its value is
  cross-device robustness (owner 2026-10-08) and SoCs where the NPU trips.
- 8 Elite long NPU (QDC #69, `qdc-8elite-npu-long-69`): NSP reached 104 C vs trip 105 at
  25 min; the slowdown is tied (one-run correlation, not an ablation) to the board's `gpu`
  cooling device - the J(1) lm_head runs on the GPU - while cdsp never engaged. That board
  throttle (sys-therm-8 -> gpu cdev) is a signal the governor does not watch today.
- Xiaomi 14 real phone, unplugged (cells `xiaomi-endur-npu-gpu-75`, `xiaomi-legheat-76`): GPU
  19.7-21.3 tok/s but ~3.2 C skin per 1k tokens; NPU 14-17.5 tok/s at ~1.1 (8192 tokens, never
  reached 43 C); CPU 14.7 tok/s at ~7.3. Load steps ~5/11/26 C (npu/gpu/cpu; npu/gpu lower
  bounds). Under HEAT_RANK SM8650 runs mostly on the NPU: v3 buys heat there, not speed; spending
  the GPU when there is margin is the learning governor's job (owner 2026-10-09).
- In-app one-copy runs on the S23 and the Xiaomi 14: the binding's legs table (`cpp/rn-legs-table.cpp`,
  binding `0da3b1eb`) has the SM8550 and SM8650 rows (cells 75/76); the Xiaomi in-app run of 2026-10-11 logged
  `KALSA_LEGS_TABLE_OUTCOME {mode:"onecopy", row_tuning:1}` and HEAT_RANK kept decode on the NPU. SM8750 / SM8850
  have no row (two-model, CPU decode in-app): their per-leg heat is not measurable on powered QDC boards. In-app RAM one copy
  2.51 GB vs two-model 4.06 GB (`step6-inapp/summary-ram.grep`).
- The governor is ON by default in the app since 2026-10-02 (absent `kalsa.governor.enabled` =
  ON; an explicit "0"/"false" from Settings stays OFF). mmproj models stay OUT of the governor
  until it has a vision lane (owner 2026-09-25; app gate `!options.mmprojPath`).
- The platform thermal status floors the classifier since engine `6892d0415` (2026-09-29), and
  the app feeds it. The 2026-09-28 SEVERE-while-FAST blind spot predates it and has not been
  re-verified in-app.
- Blast radius: Mali/MediaTek/unknown SoCs and iOS never load the governor; low-RAM phones are
  guarded only by its estimate-based fit; V75 enablement rests on one board plus the Xiaomi lab.
- Owner approved 2026-10-09: rule v3 ON by default in the app + per-SoC v3 values in the legs
  table + an SM8650 row, then APK, then the S23 in-app test; fix A1 (App / UX below). DONE
  2026-10-09 (two audits, deepseek + Luna): binding main `f0ca4692` - the S23 row carries rule v3
  (hop 32, HEAT_RANK, load step 19/9/22, guard 5) as the default of every key the app JSON leaves
  absent (an explicit key wins; the app sends none), `KALSA_LEGS_TABLE_OUTCOME {mode, row_tuning}`
  says whether the row tuning is in force, `GovernorStats.decode_hop_rule` names the rule.
- SM8650 row NOT shipped (audit P1): the engine's TILE32 gate admits only Adreno 740 / E031.41
  outside lab builds (`ggml-opencl-tile32-facts.cpp`), so the row (binding `84ac0d57`, unpushed,
  values from cells 75/76) would load one-copy, fail the J(1) fence and reload two-copy on every
  Xiaomi load. Enabling it = add Adreno 750 / E031.45 to the engine's measured gate (correctness
  evidence: cells 72, 74), re-vendor, then the row. The NPU voltage-corner knob
  (engine `6e06ce5a1`) stays lab-only, not wired into the governor.
- **Partial layer offload — evidence audit (2026-10-15).** The "GPU at several layer counts"
  history exists but in two halves that never met: MEMORY per ngl was measured **only on the
  S23** (`q44-ngl-sweep-mem`, ngl {0,7,13,19,99}, 1 Hz meminfo/smaps, `ALIVE-2026-09-full.md:449`,
  k not constant → `800 MiB + 1.05×bytes`), and SPEED per ngl **only on the Xiaomi**
  (`results/gpu_prefill_recheck_xiaomi/report.md:106-109`, 53.8 / 89.5 / 200.3 / 216.7 t/s, with
  **zero** memory instrumentation in ~286 artifacts). The q44 row itself says the constants
  "need a second model/device before shipping"; that was never discharged, and today's
  `NoFit` on the Xiaomi is decided by the S23-fitted constant
  (`gpufit-drop-memory-gate/REPORT.md:120`). Reframing, because partial offload was **already
  rejected on speed on this phone** (`report.md:178`: "ngl 8 ≈ CPU … Full offload is the right
  product setting"): the only useful outcome of loosening the gate is reaching **full** offload
  (216.7 t/s vs 109.4 s measured today), so the question is "recover full-GPU prefill on the
  Xiaomi", not "make NoFit smarter" / "ship partial offload". Shortfall today is 380 MiB
  (12.6 %); force-stopping the app lifted MemAvailable ~3.65 → ~5 GB on this same phone
  (`analysis/XIAOMI-QWEN-FITGATE-…-2026-09-20.md:80`), i.e. 3.5× the shortfall — so the first
  step is a cold-process re-run, not a constant re-fit. Closed option: a swap-aware gate was
  explicitly rejected (same file `:82-83`). Caution: full-GPU offload of the 17.25B GGUF
  **kernel-rebooted this phone** with 6.7 GB free (`q16-xiaomi/REPORT.md:338,400,417`,
  FAIL-HARD, do not retry). Two traps: "half-offload is NEVER right" is about the MoE
  trunk/experts split, not layer counts; and `NoFit` can also mean unknown SoC, not low RAM
  (`PLAN-2026-10-09-full.md:958-959`). Full verdict + verification ledger:
  `scratchpad/agents/gpu-layers-history/VERDICT.md` (scopes A-D, 347 lines).
- **CORRECTION + REGRESSION (2026-10-15, supersedes the framing above).** The NPU prefill lane on
  the Xiaomi is already measured and already proved in-app: `xiaomi14-3way/REPORT.md:18,22` (29/09,
  first NPU v75 run) gives **NPU prefill 5.2x CPU and 4.7x OpenCL**, and
  `xiaomi-g2-inapp-233486dd/REPORT.md:3,26` (11/10) ran **14 in-app turns with prefill AND decode on
  the NPU, 0 CPU/0 GPU decode tokens, no crash**. Same 4.7x as the S23
  (`s23-heat-arms-engine/REPORT.md:85-87`), so it is a property of the legs, not of v73. **Today the
  same phone loaded `n_gpu_layers = 0` and prefilled 1760 tokens in 109.4 s: this is a REGRESSION
  between APK `233486dd` and `aa789620`, not a gap in evidence.** Lane gate is
  `governorInputs.ts:355-370` (`enabled = force || GPU_PREFILL_CORRECT[gen] || laneEnabled`, with
  `fitOk = npuLane.fit === "Fit"`); its own comment at `:366-369` describes the working 11/10
  configuration. Three earlier premises were wrong and are corrected on record: the lane is NOT
  hardcoded off, SM8650/V75 data DOES exist, and **one-copy is the primary path while two-model is
  the fallback** (`llama-model.cpp:1195-1199`: "the one-copy buffer the GPU leg imports ... every
  device but Hexagon, and every device in two-copy mode"; `rn-llama.cpp:444` gates it on
  `npu_lane_enabled`). Owner policy 2026-10-15: **no OOM, no reboot, degrade gently** - that is
  Fable milestone 3 (`governor-plan-fable/PLAN.md:64-66`), never implemented, and today's code is
  the opposite (`llama-governor-policy.cpp:379-383`: LOWBAT/CRITICAL -> CPU prefill, the hottest
  backend). Live hazard to respect: a non-native TILE32 weight is refused outright with
  `split_failed` (`ggml/src/ggml-backend.cpp:1554-1562`). Plan, with the four suspects for the
  regression and the no-coder-before-step-1/2 rule: `scratchpad/agents/PLAN-NPU-LANE-2026-10-15.md`.
- **ROOT CAUSE FOUND, and it is one line (2026-10-15, supersedes the "regression" framing above).**
  Not a code regression: at engine init today the harness read back
  `"gpu_fit":"Fit","npu_fit":"Fit","npu_device":"HTP0","available_mib":5555.19` in
  `xiaomi-stage0-obs-aa789620/raw/harness.log:63-64`; later the same build saw
  `available_mib 3004.93` -> `gpu_fit=NoFit`. **Available memory fell ~2550 MiB with no code change.**
  The defect is that **`LlamaService.ts:2564` drops the WHOLE governor when `gpu_fit === "NoFit"`** -
  `npu_fit` appears nowhere in that condition (verified by grep over the block). With
  `governorLoad = null`, `n_gpu_layers` falls to 0 on Android's cpu-only backend (`:2717-2718`) and
  prefill takes 109.4 s. **A GPU memory shortfall killed a NPU lane that needs no GPU memory at all**,
  even though that lane prefills 4.7x faster than the GPU here and ran 14 in-app turns on 11/10
  without a crash. The design already says "step down to the lane"
  (`governorInputs.ts:366-369`); the app gate contradicts it. Fix shape: when `gpu_fit` is NoFit but
  `npu_fit` is Fit and the lane gates hold, load the governor lane-only. Guarded by the lane's own
  fit - **not** by loosening the GPU gate, which stays as the OOM protection. The app repo is the
  brain session's, so the fix needs their coordination. Corrected plan:
  `scratchpad/agents/PLAN-NPU-LANE-2026-10-15.md` (section 1 records the voided hypothesis list).

### Engine and upstream

Engine fork main = `2e723bd9d`: upstream llama.cpp b11514 merged (merge `904d38fad`) + audit
fixes `35233cf8e` (MUL_MAT_ID HMX gate, Metal vec-FA NULL-pipeline guard, Windows `ggml_fopen`,
n_read) and `23b2a44d7` (u8path on the Windows slot path), plus the B1 one-copy Hexagon cap
restore `e2d2ac01b`/`985c6eb8f`/`2e723bd9d`. Audit chain:
`onecopy-three-legs/audit-merge-b11514-n2.md`; B1 in the root `BACKLOG-LOW-PRIORITY.md`.
Earlier landings still in main: the upstream Q8_0 quantizer fix `837334a74`, the bench-logits
fix `fbf33176c` (the S23 hard resets were bench-only memory exhaustion; closed), rule v3
`09a496d71` (default off: NPU_FIRST byte-identical). Upstream watch (2026-10-08, read-only:
OpenCL OOB fix, Hexagon SSM_CONV double-buffered DMA, Q6_K dequant speedup, FA multicore
partitioning) is recorded in `archived/PLAN-2026-10-09-full.md`.

### GPU numerics (`_cok` etc.)

The q4_K small-batch `_cok` accumulator fix `319b53937` IS in engine main (verified: ancestor
of `2e723bd9d`). Its record's shipping checklist requires an app-shaped verification; there is
no record on disk that it ran, and its audit refuses shipment until it does: NOT YET SHIPPABLE
(`scratchpad/agents/cok-accumulator-audit/REPORT.md`). The 2026-09-22 GPU-numerics verdicts
(fp16 activation scale as the 57x cause; the acceptance gate not reachable by batched-GEMM
precision work; the KV-term magnitude unresolved) stand as measured:
`scratchpad/agents/s23-kld-740-q4-0/REPORT.md` sec. 17-35.

### Desktop / kalsa-brain

Current published release `kalsa-server-v1.1.5` (engine `63a51b6d6`, 2026-10-01; M1 SIGILL
fixed, kalsa-brain repinned). The b11514 merge is desktop-verified: macOS Metal checks PASS on
`904d38fad` - Gemma 12B+mmproj u512 no longer aborts, E4B MTP decode +19 % - and Windows checks
PASS (`onecopy-three-legs/b11514-mac-checks-904d38fad.md`, `b11514-windows-checks.md`; the
Windows non-ASCII slot save is fixed on `23b2a44d7`, kalsa-brain's run). Next desktop release
carries the merge; server picks requested in
`onecopy-three-legs/upstream-b11514-desktop-notes.md`.

### App / UX (alpha track)

Feature freeze for the alpha after the three open jobs (owner 2026-10-05): pill switch
(`7d028acd`), Room reachability + dark Settings (`cc4ede9b`, `3f922959`), virtualized transcript
(`e110a56b`) - all landed; then tests and bug fixes only. Stability: background drain root-caused
(worklets never pausing; `1cd2a40a`), Settings loop fixed (`b9e96c53`), iroh background stop
(`1b54f533`); Room send visibility fixed (`480f4592`). Phone log -> `POST kalsa.io/report`
feature complete (`37624f8e`; design `phone-log-report/DESIGN.md`; native lines enter uploads
only by allow-list). Telemetry parity + governor Android-only: `b36552ee`. Composer disclaimer
`ebc93d90`. Owner direction: CPU is out of prefill; NPU first; decode hops by heat; never
truncate reasoning silently; persistent SEVERE means a sustainable slow rate, the pause is only
an emergency brake. App backlog A1 (P2): under the governor the JSI refuses session save/load,
so a chat switch re-prefills the whole history and the generic catch deletes a meta-valid .kvs
(root `BACKLOG-LOW-PRIORITY.md`, A1).

### iOS / Metal

Engine line: llama.cpp on Metal (same GGUF, KV and governor); measured +6 % over MLX on LFM2.5
(`ios-engine-choice/REPORT.md`); MLX only if it clearly wins. iOS resolves KV to q8_0/q8_0
(`ee8b5f25`; the mixed q8_0/q4_0 cliff is Metal-only; one QDC SM8650 board at depths 0/2048
showed no CPU penalty, S23 not measured, `qdc-kv-mixed-decode`). Core ML / ANE is NOT the plan
(own model format, no shared weights): a later prefill-only research lane at most. Background generation poisons and reloads the context (`30038004`).
Desktop link (iroh, `c4cd72ab`) and quick-switch pill shipped. Perf track: memory warnings,
mlock off, root error boundary landed (`2e5e13cd`); transcript virtualization is the app track's
`e110a56b`; real-iPhone numbers (jetsam, frames, Metal speed) still owed. Parity gaps
(`ios-readiness/PARITY-GAP.md`): share-in extension, no battery current; TestFlight needs the
$99 developer account. AFM measured: not a main engine (small context, multi-turn weak);
optional "no download" fallback at most (`ios-engine-choice/REPORT.md`).

### MoE (PARKED by the owner, 2026-10-01)

Good plan, cost above expectations; resume after the alpha if users are interested. No Runpod
spend. Resume checklist: `scratchpad/agents/kalsa-moe-design-fable/PARKED.md`. The gate-probe
result (RAZOR-19 out for Kalsa; unpruned Qwen3.6 beats LFM on bpb) is
`results/gate_probe_a40_2026-10-01/REPORT.md`.

### Pairing / iroh

Doorless iroh pairing (node-bearing invite, no door address) landed `f4f3696c`; LIVE PASS
2026-10-03 simulator + Mac Brain. Iroh bridge stops 30 s in background (`1b54f533`; delay is
owner-approved). Phone <-> PC media contract (owner 2026-10-03/04): 1:1 images landed
(`3908f2a0`, follow-up `ac457508`); Room images and video after the alpha. Phone Room v1 (text)
landed (`cc4ede9b`). LAN direct path is step 6 of kalsa-brain's plan
(`docs/PLAN-SURFACE-TUNE-2026-10-07.md`, brain `0c1cf787`); no wire change without Marco.
`kalsa-pair` Worker live, reachability recorded
(`scratchpad/agents/pair-worker-reachability/2026-09-28.txt`).

### Release pipeline

Phone chain: engine main `2e723bd9d` -> binding main `f0ca4692` (vendors `2e723bd9d`, HTP skels
rebuilt) -> app main `1f0e967b` pins `kalsa.rn#f0ca4692` / kalsallama `2e723bd9d` (provenance
1198 files EXIT 0, apk.yml harness block and jest src/engine 1218 EXIT 0; includes the A1 fix).
APK: CI run `37949782564` on `23854676` FAILED (the binding's OpenCL glob compiled the lab-only `ggml-opencl-tile32-verify.cpp` since vendor `1babccb9`; backlog B7); fixed in binding `76768fb2` + skels `f0ca4692`; re-dispatched as run `37961298208` (debuggable, arm64). Desktop: v1.1.5 published on R2 + HF; the
next tag carries b11514 (desktop checks PASS, see above). Operational procedure, manifest
contract and the Cloudflare cache traps:
`archived/ALIVE-2026-10-09-full.md`, "Engine release pipeline" (unchanged procedure). The
Cloudflare/R2 inventory, the telemetry opt-in guarantees and the release dead ends (immutable
tags, `--clobber`, `workflow_dispatch` dash trap, Actions quota) are in
`archived/PLAN-2026-10-09-full.md:2773-2815`.

## Next steps (ordered, 2026-10-09)

1. DONE 2026-10-09: binding `f0ca4692`, app `1f0e967b` (pin + A1), APK run `37961298208`.
2. DONE 2026-10-09: engine `0012f97f2` pushed (TILE32 gate admits Adreno 750 / E031.45; COOLMODE decode
   pacing, `decode_coolmode_duty`, 250 ms cap; bench `--coolmode-duty` / `--platform-status`, arm L only).
   Binding `a9bf7a26` pushed: engine vendored, native platform status (AThermal, read <= 1 Hz in the decode
   loop, escalation debounced 5 s, carry of the last status bounded to a native read in the last 10 s),
   `decode_coolmode_duty` binding default 0.5, SM8650 row, `decode_paced_*` stats in JS, skels rebuilt
   (engine 0012f97, fingerprint 900bf79). Each step hostile-audited by a model other than its writer.
3. G2 on the S23 failed on heat (cell `s23-g2-inapp-1f0e967b`). Owner decision 2026-10-09: COOLMODE slows
   decode to a sustainable rate. App `2a1d1055` pushed 2026-10-09: pin `a9bf7a26` / engine `0012f97f2`
   (provenance, skels, apk.yml harness block, jest src/engine 1218/1218) plus the campaign harness fixes
   (no force-stop on adb-drop or an unknown pid; toolcap turns without an answer fail the gate; four audit
   rounds, leftovers H1-H5 in the backlog). Debuggable APK: CI run `38022468371`. G2 attempt 1 on it (2026-10-10,
   `s23-g2-inapp-2a1d1055`): 15 turns in-app, no crash, COOLMODE from turn 1, paced at ~6 tok/s,
   Android status held at 2 for 65 min (never 3, vs SEVERE at turn 4 on 10-09), one harness thermal pause; the
   harness died on one unreadable DB copy at turn 15 - fixed in app `0c8a711d` (5-round retry). Next: repeat
   on a charged cold S23, then the shorter tools-ON session. Cell 77 done: pacing cuts the skin slope 3.2x;
   paced NPU = paced GPU on the S23 (`s23-paced-legs-77`).
   Cell 77 (`s23-paced-legs-77`, does pacing cool, NPU vs GPU): the paced NPU arm decoded 2048 tokens at
   7.5 tok/s (duty 0.5 achieved), then a PMIC hard reset (PonReason.HARD_RESET) during the next rep's
   model load in the same process. Measured after: one one-copy NPU load leaves ~0.9 GB MemAvailable (the
   rpcmem is outside process RSS). Rerun 2026-10-10 morning (owner): one 4096-token rep per arm, MemAvailable
   logged, bench killed below 500 MB. The app's reloads run on the same margin: watch it in G2.
3b. Graduated pacing (owner 2026-10-10 "Fai 1": slow only as much as needed, replacing the flat 0.5). Cell 78
   (`s23-headroom-cal-78`): S23 Android headroom = (skin - 12) / 30 exactly; status 1/2/3 at 0.877/0.937/1.003.
   Engine `74b75037f` pushed: duty = min(headroom ramp 0.87 -> 0.97 down to 0.35, battery ramp 39.5 -> 43 C,
   Android status cap: 2 -> 0.5, >= 3 -> 0.35); NaN headroom falls back to the flat COOLMODE 0.5. Binding
   `2b85937b` pushed: AThermal_getThermalHeadroom(10 s) read every 2 s, carried 10 s, fed to the engine;
   pacing params in JSON; duty/headroom stats to JS; engine_mutex_ serializes decode vs profile/stats/cache calls.
   App `41ab9149` pushed: pin + pacing fields in KALSA_GOVERNOR. Harness pause for G2 raised to battery > 43 C
   (app `64b05470`, owner). Each step hostile-audited by a model other than its writer (gpt-6-luna; opencode-go
   was out of quota); leftovers E3-E6, B8-B10 in the backlog. Debuggable APK: CI run `38078019923` (app `867affaa`, kalsa.rn `52718a55` with the skels rebuilt for 74b7503; run `38076349748` had failed the skels gate), sha256 `cbd27007`. Next: G2
   repeat on a charged cold S23 with it. DONE 2026-10-10 (`s23-g2-graduated-867affaa`): 16 turns, no crash, status
   never 3; 5 completions at >= 10 tok/s (vs 2 with the flat 0.5), hot steady state 5.3-5.6 then 4.4-5.0 tok/s at the
   0.35 floor (vs 5.6-6.4); stopped by the harness thermal hard abort at battery 42.5 C. Found: `run-t20c.sh`
   hard-coded the 42 C pause and ignored `recovery.thermalMaxC` (fixed in app `e0ae695d`, pushed); a 600 s "tool round" wait at turn 10
   (the app ended a `write_note` turn without a continuation round; backlog H6). Owner 2026-10-10 ("se secondo te e' meglio si"): S23 full line 0.99 (skin ~41.7 C) - binding `0da3b1eb` (param types), app `233486dd` (SM8550 only), pushed; APK CI run `38097645331`. G2 on it 2026-10-10 (`s23-g2-full099-233486dd`): **20/20 turns, recoveries 0, no pause**, repeated 2026-10-11 (run 2: 20/20, hot median 5.82 tok/s, MemAvailable min 1.08 GB); 4 completions >= 10 tok/s, hot median 5.8 tok/s (flat 0.5: 6.0; full 0.97: 5.3); skin max 41.5, battery max 42.5 C.
4. The `_cok` app-shaped verification and in-APK consumption (Meter, measured on APK `bc99cfeb`, not the G2 APK `233486dd`: the code is in app main since
   `6a58ef5`, `kalsa.bench.energy_trace` -> `files/energy/*.csv`; `GovernorBatteryPackage` is in the dex of APK `bc99cfeb`;
   first in-app reading 2026-10-11, `s23-meter-gov-onoff-bc99cfeb`: turn 1 of the G2 script costs 254-294 mWh with the
   governor ON (NPU, 12.1-13.5 mWh per 100 output tokens) and 376 mWh OFF (CPU only, 24.4; SEVERE within that turn);
   one OFF turn only. On the S23 energy comes from current x voltage: the charge counter pins at full charge, and the
   first version of the cell under-read ON by 3-4x that way. Sampler overhead measured at its source, `s23-meter-overhead-bc99cfeb`:
   ~1.1-1.36 ms CPU/s in its own thread + ~1 ms/s in the health HAL; with the system_server share and a 4 W/core price
   assumed, <= 0.24-0.44 % of a turn's power, under the 1 % bar). The Meter
   needs `run-as`: this APK is built debuggable for it (tracked bench build still owed for ship).
5. Xiaomi: lab numbers done without an APK (owner 2026-10-09, cells 74-76). In-app round night of 2026-10-11
   (`xiaomi-g2-inapp-233486dd`, APK `233486dd`, owner lent it at 62 %): 14 turns in-app, NPU prefill + decode, no
   crash, stopped at 29 % battery by the coordinator watchdog. Android's headroom here ~ 0.0327 x skin - 1.19 (0.28
   at skin 44.9 C, status 0 throughout), so the S23 ramp never paced; the battery ramp did. Next: a per-SoC Xiaomi
   row (proposal start 0.15 / full 0.25) after one more run; H6 hit again at turn 2.
   QDC 2026-10-11 (`qdc-oracle-onoff-41dc728f`, APK `41dc728f`, battery faked unplugged 30 C): governor ON = NPU
   prefill, 6.2x CPU on SM8850 (1337 vs 216 tok/s, 2 turns each) and 5.5x on QRD8750 (1159 vs 212, ON n=1); decode on
   CPU in both arms, similar (30.5/30.1, 26.2/27.5 tok/s); no captured crash, no fallback where routed. Two QRD8750 ON
   turns reached 48 C with no telemetry after the app went to TOP_SLEEPING (`background_stop`; QRD doze trap, stall
   not ruled out). Shipped config (tools on) on SM8850 hit 48.9 C after two offline `web_search` rounds.
   Per-model declared SEVERE (owner 2026-10-11 "Dovremmo fare questo"): app `bc99cfeb` (pushed) keeps two skin lines
   for every phone, 38.1 / 41.7 C (the S23's 0.87 / 0.99), converted per model with AOSP's (T - (SEVERE - 30)) / 30:
   S23 `SM-S911` SEVERE 42.0 -> 0.87 / 0.99 (unchanged), Xiaomi 14 `23127PN0CG` 66.5 (HAL dump) -> 0.053 / 0.173;
   unmeasured models keep the engine defaults + battery ramp (other SM8550 phones no longer get the S23 line).
   `KALSA_GOVERNOR_PLAN` logs `pacing_start` / `pacing_full`. APK CI run `38163419959` (sha256 `6a556e81`). S23 check
   2026-10-11: `"pacing_start":0.87,"pacing_full":0.99` on load (unchanged lines; the S23's BASE_OS is a build
   fingerprint, so the first draft's osName gate would have dropped it - caught in audit). Xiaomi run when lent.
6. Owner decisions: the safety marking (below). The Jelly is decided (unsupported until a Mali kernel).
7. M1 dossier (raw results, limits, reproduction instructions).
8. Then: the learning governor, iOS/Metal on a real iPhone, MoE unpark.

## Open decisions (owner)

- The learning governor (2026-10-09 owner idea): design v0 in `scratchpad/agents/learning-governor/DESIGN.md`
  (Fable architect, 2026-10-12; now v0.5, audited). Owner 2026-10-12 ("va bene a tutto"): speed while
  cold, heat (HEAT_RANK) once warm; heat learned per phone in the app, speed live in the engine; no
  exploration in v0; Xiaomi first, S23 as the null control, row-less phones out of v0. Owner corrections
  for the revision: the margin uses BOTH sources but not a plain minimum ("il minimo è troppo
  conservatore") - the Android forecast reads 0 below SEVERE - 30 (Xiaomi: 36.5 C), so there the
  component zones decide; real life (pauses, cooling, reloads, other apps, background load) must not
  break it: live margin every window, an "everything else" heat term + outlier rejection + forgetting,
  a surprise breaker (actual rise faster than predicted -> GPU off for the session), Stage 0 data from
  real use. Known flaw of the first draft: the forecast-only margin can never fire on the Xiaomi. v0.2 (2026-10-12, same
  folder) answers AUDIT-1; owner on its questions: (1) Xiaomi pacing lines raised: start at skin 39.0 C,
  full at 42.6 C (the S23's 3.6 C ramp), i.e. headroom 0.083 / 0.203 with SEVERE 66.5 ("si 39"; 41 / 44
  is the fallback if Stage 0 shows the GPU learns too little). App change in `declaredSevere.ts` (today
  every phone gets 38.1 / 41.7);
  (2) "blind forecast abstains, zones decide; when it speaks both must pass" approved ("mi piace, poi
  testiamo"); (3) Stage 0 private numeric log file on the owner's Xiaomi approved (no model text, no user
  content).
  Status 2026-10-12: design v0.5 accepted with coordinator notes (DESIGN sec. 3.5; AUDIT-1..3). Stage 0 binding
  (observation only) pushed: binding main `861a3cc3`; Stage 0 app part pushed: app main `aa789620` (pin 861a3cc3,
  JSONL rows in files/governor/observations.jsonl, KALSA_GOVERNOR_COMPLETION tag). S23 device check done
  (`s23-stage0-obs-aa789620`: criteria 1-6 pass, leg mix not judgeable, sysfs denied). Next: the Xiaomi (dev APK
  `aa789620`, >= 20 completions of normal use, adb pull), then Stage 0b. Starting values approved by the owner 2026-10-12 ("se hanno senso si"):
  breaker latch 6 h, blind cap 2048 tokens, lookahead 10 s - all re-checked against Stage 0 data before Stage 2;
  the blind cap must count across the tool rounds of one turn, not reset per completion (AUDIT-3). Open owner
  question: repeat cell 75 (3 runs per leg) before Stage 3.
  Status 2026-10-15 (coordinator session, `xiaomi-stage0-obs-aa789620`): **the Xiaomi Stage 0 arm ran on the
  owner's phone (6 turns, 8 rows, `aa789620`) and OPEN 1 is CLOSED - the Xiaomi's passive trips are finite for
  all three legs, cpu 60-115 C, npu 100 C, gpu 95 C, so the GPU block ceiling is 90 C and the zone guard will
  not bind on the blind path. OPEN 4 is CLOSED negatively: the battery sysfs is not readable by the app on the
  Xiaomi either (`bsys:[0,null,0,null]` on every row), so the app push stays the battery source and DESIGN 5.1's
  native 5 s refresh branch is dead.** The app-sample freshness gate of DESIGN 5.1 is also settled by
  measurement: the app sample age reaches 503 s inside one paced completion on the Xiaomi (350 s on the S23),
  so a 120 s wall-clock gate false-disarms the pass; the rule becomes ownership-first with a 1200 s backstop
  (`learning-governor/DESIGN-ADDENDUM-2026-10-15.md`, Items B and C). Criteria 1, 2, 4, 5, 6 PASS; criterion 3
  not testable (the phone paced from the first completion) and criterion 8 not observable (no native line
  reaches logcat, pre-existing). Stage 0b is WRITTEN and audit-clear: app `54c36105` in worktree
  `kalsa-wt-s0b` (Xiaomi 39.0 / 42.6 C skin -> 0.083 / 0.203, S23 unchanged), writer claude-haiku-5-5,
  hostile audit codex/gpt-6-luna round 1 DO-NOT-SHIP on a test-gap (rounding direction unpinned), fixed and
  amended, round 2 SHIP; coordinator re-ran jest (EXIT=0), tsc (EXIT=0), provenance 1205 files (EXIT=0) and
  both rounding mutations by hand (`ceil` -> EXIT=1, restored -> EXIT=0). **PUSHED 2026-10-15 on the owner's OK:
app main `54c36105` (fast-forward over `357e36d2`, 3 files, rev-list 0/0).** Still owed: the >= 20 completions of DESIGN 3.3 (the dev build stays installed on the Xiaomi, so
  the batch can be collected from normal use), then Stage 2.
- DECIDED 2026-10-11 (owner: "non viene supportato dall'app finché non scriviamo il kernel per mali GPU"):
  the Jelly Star (Helio G99, Mali-G57) is NOT supported by the app until a Mali GPU kernel exists; LFM on
  its CPU is thermally non-viable (`analysis/CISWIRE-CHAR3GRAM-KV-AND-THERMAL-2026-09-19.md`). M1 is
  therefore judged on the S23 and the Xiaomi 14, with the Jelly declared out of scope.
- SM8850 GPU prefill (V81): logit oracle FAIL R2 again on engine 74b75037f (2026-10-11,
  `qdc-oracle-onoff-41dc728f`: one distinct comparison, top-1 agrees on 32/32 steps, max_dp1 0.108 vs
  0.02; CPU replay control PASS 0.0000), but it meets the effect-size criteria V75 was promoted on. Owner
  2026-10-11: V81 GPU prefill is the fallback when the NPU lane is off (app `df359450`, engine `f1f612388`).
  Verified on the SM8850 the same evening (`qdc-v81-fallback-df359450`, 4 turns): lane off -> prefill GPU
  295 tok/s, decode CPU, no fallback, no crash, answers on topic; defaults -> prefill NPU 1342 tok/s;
  governor OFF -> CPU 224 tok/s. Not checked: logits on the fallback path; the lane-off arm also runs V cache
  q4_0 vs q8_0 on the NPU arm.
- Safety marking on the ship model: complied 0/24 with parity on all 6 categories, but 4
  pre-answer cells are flagged RELEASE BLOCKER CANDIDATE (S1_t07, S4_t0, S6_t0, S6_t07); a
  budget-up re-run (n >= 160) is required before acting on it (`archived/ALIVE-2026-10-09-full.md:259-263`).
- App interface: the 2026-09-21 decision to redo it from scratch keeping only the palette
  (`archived/PLAN-2026-10-09-full.md:2919-2953`) has no later record superseding it, while later
  work patched the current UI. The owner to confirm which holds.
- Beta debts (owner, 2026-09-28): private release signing key + `assetlinks.json` SHA-256 +
  CI gate; APK size (target under 70 MB: fewer engine variants, R8, App Bundle) - estimate,
  not measured.
- Owner-suspended: vision lazy loading (mmproj eager); ciswire window counted in characters;
  catalog gate threshold. Records: `analysis/XIAOMI-QWEN-FITGATE-AND-CISWIRE-TOKEN-OVERFLOW-2026-09-20.md`,
  `archived/PLAN-2026-09-full.md:682`.
- MoE resume (parked): needs owner budget OK (`kalsa-moe-design-fable/PARKED.md`).

## Where the record lives

- `analysis/`: dated findings and contracts (`CISWIRE-CHAR3GRAM-KV-AND-THERMAL-2026-09-19.md`,
  `XIAOMI-QWEN-FITGATE-AND-CISWIRE-TOKEN-OVERFLOW-2026-09-20.md`, `FORK-VENDOR-MIGRATION.md`,
  `GOVERNOR-DEVICE-PLAN.md`, `README-governor-kv-contract.md`, `README-qwen-think-replay.md`).
- `scratchpad/agents/<cell>/`: one folder per measurement cell (`PREREG.md` where relevant,
  driver scripts, `raw/`, `REPORT.md`).
- root `BACKLOG-LOW-PRIORITY.md` (current: B1-B6, A1-A3) and `scratchpad/BACKLOG-LOW-PRIORITY.md`
  (older): triaged audit leftovers. `scratchpad/COORDINATOR-STATE.md`: cross-session state.
- `archived/PLAN-2026-09-full.md`: full Italian history to 2026-09-20.
- `archived/PLAN-2026-10-09-full.md`: the full PLAN to 2026-10-09 (diary, engine release
  history, MoE research, pairing detail, every dated decision).
- `archived/ALIVE-2026-09-full.md`, `archived/ALIVE-2026-10-09-full.md`: the measured-state
  diaries, including the 2026-09 phone speed tables and the engine release pipeline procedure.
- `docs/ALIVE.md`: the living measured state.
