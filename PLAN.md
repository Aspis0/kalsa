> Archives: `archived/PLAN-2026-09-full.md` (full Italian history to 2026-09-20),
> `archived/PLAN-2026-10-09-full.md` (the full PLAN to 2026-10-09, frozen before this compaction).
> The diary and every superseded detail live there; this file keeps only the standing rules,
> the gates and the current state of each workstream.

# Kalsa: PLAN (living)

## What Kalsa is

Kalsa is an Android and iOS chat app that runs language models on the phone itself, no server in
the loop, plus a desktop app (kalsa-brain) it pairs with. Standing goal (owner;
`archived/PLAN-2026-09-full.md:9`): a kernel that uses NPU, GPU and CPU per phase according to
temperature, battery and device profile, optimised for Snapdragon, and for MediaTek/Jelly where
possible. The engine is our llama.cpp fork, consumed through our `llama.rn` binding fork pinned
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

### The four repos and the delivery chain

The authoritative map is `REPOS.md` in the app repo. The four live checkouts:

| repo | local checkout | role |
|---|---|---|
| `Aspis0/kalsa` | `~/Projects/kalsa` | the app |
| `Aspis0/kalsallama` | `~/Projects/kalsallama` (worktree `kalsallama-upstream-b11514`) | the llama.cpp fork: OpenCL MoE kernels, Hexagon, repack, governor |
| `Aspis0/kalsa.rn` | `~/Projects/llama.rn-kalsa-onecopy` | the React Native binding fork, upstream `vendor/` layout |
| `Aspis0/kalsa-moe-experiments` | `~/Projects/kalsa-moe-experiments` | the lab: this repo |

One repo is archived read-only: `Aspis0/kalsa-forkbigmoeonedge`, a lab submodule for provenance.
Engine and binding forks are main-only (retired lines are `archive/<name>` tags).

The delivery chain: engine commit -> binding vendor bump (`vendor/VERSIONS` names the engine
commit; HTP DSP skels are rebuilt from the same tree, with a skew gate) -> app pin
(`package.json` pins `kalsa.rn#<sha>`) -> provenance gate (`npm ci` + assert-engine-provenance,
must exit 0) -> CI APK -> device verification. The app pin moves only with the owner's OK.

### Other standing rules (owner, 2026-10-02)

- Audits are triaged: fix P0/P1 and P2 that touch app/users/performance; the rest goes to
  `scratchpad/BACKLOG-LOW-PRIORITY.md` and work moves on.
- ONE max-recall cross-file review per piece of work, then triage as above.
- An artefact whose hash is cited must be archived before any cleanup touches build output.
- Measurement hygiene: heat and speed claims only unplugged on our phones (never benchmark
  charging); every timing ratio states the screen state of both arms; every published number
  carries its load condition. QDC boards are always powered: speed indicative, heat none.

## Gates and dates (recovered 2026-09-21; statuses as the record shows on 2026-10-09)

Critical path: **G0 baseline -> G1 model -> G2 complete chat -> G3 correct profiles -> G4
sustained quality -> M1**. Dates are 2026 planning estimates subordinate to the gates, not
publication promises (`archived/PLAN-2026-09-full.md:408-431`).

| date | gate | requires | status 2026-10-09 |
|---|---|---|---|
| 9 Sep | **G0** | reproducible baseline, real device matrix, schedulable slots | closed (2026-09; QDC + our two phones in use) |
| 14-15 Sep | **G1** | model chosen, baseline with per-phone targets written before tuning | closed 10 Sep: LFM2.5-2.6B QAD Q4_0, sha `a247afd6` |
| 21-23 Sep | **G2** | complete chat, 20-30 turn sessions, recovery without corruption | never claimed; needs an in-app long session on the 2026-10-09 APK (not built yet) |
| 28-29 Sep | **G3** | every phone has at least one correct path; every ENABLED path passes its tests | partial: S23 yes in-app; Xiaomi correct in lab, in-app still two-copy until the SM8650 row ships; Jelly Star open |
| 30 Sep-2 Oct | **G4** | sustained quality; consumption measured or limits declared | open: Meter A/B pending; consumption measured in the lab, not in the APK; the 2026-09-28 governor blind spot has no later verification |
| 9 Oct (reserve 16 Oct) | **M1** | first model complete and banked on the three phones, or a precise list of missing gates | NOT met as of 2026-10-09: no APK exists with the 2026-10-09 pin; G2 open |
| 30 Oct | **M2** | second dense model on validated devices | future |
| 20 Nov (reserve 27 Nov) | **M3** | first large MoE within the declared perimeter | future; the MoE lane itself is PARKED (see workstreams) |

Riders kept with the table: the GPU/V75/q4_K generations, the NPU and the governor were
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
  25 min; the slowdown came from the board's `gpu` cooling device (the J(1) lm_head runs on the
  GPU), not from cdsp. Xiaomi NPU-vs-GPU endurance cell `xiaomi-endur-npu-gpu-75` is RUNNING.
- In-app one-copy runs on the S23 ONLY. The binding's legs table (`cpp/rn-legs-table.cpp`) has
  one row (SM8550). An SM8650 row needs the lab per-leg data: cells 74/75. In-app RAM one copy
  2.51 GB vs two-model 4.06 GB (`step6-inapp/summary-ram.grep`).
- Owner approved 2026-10-09: rule v3 ON by default in the app + per-SoC v3 values in the legs
  table + an SM8650 row, then APK, then the S23 in-app test; fix A1 (see backlog below).
  Binding v3 knobs exposed (`70de0d22` + `80d585ac`), audit next. The NPU voltage-corner knob
  (engine `6e06ce5a1`) stays lab-only, not wired into the governor.

### Engine and upstream

Engine fork main = `2e723bd9d`: upstream llama.cpp b11514 merged (merge `904d38fad`) + audit
fixes `35233cf8e` (MUL_MAT_ID HMX gate, Metal vec-FA NULL-pipeline guard, Windows `ggml_fopen`,
n_read) and `23b2a44d7` (u8path on the Windows slot path), plus the B1 one-copy Hexagon cap
restore `e2d2ac01b`/`985c6eb8f`/`2e723bd9d`. Audit chain:
`onecopy-three-legs/audit-merge-b11514-n2.md`; B1 in `scratchpad/BACKLOG-LOW-PRIORITY.md`.
Earlier landings still in main: the upstream Q8_0 quantizer fix `837334a74`, the bench-logits
fix `fbf33176c` (the S23 hard resets were bench-only memory exhaustion; closed), rule v3
`09a496d71` (default off: NPU_FIRST byte-identical). Upstream watch (2026-10-08, read-only:
OpenCL OOB fix, Hexagon SSM_CONV double-buffered DMA, Q6_K dequant speedup, FA multicore
partitioning) is recorded in `archived/PLAN-2026-10-09-full.md`.

### GPU numerics (`_cok` etc.)

The q4_K small-batch `_cok` accumulator fix `319b53937` IS in engine main (verified: ancestor
of `2e723bd9d`). Its record's shipping checklist requires an app-shaped verification; there is
no record on disk that it ran -> OPEN VERIFICATION, not "not shippable"
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
(audit `6220ecfa` leftovers, recorded at `archived/PLAN-2026-10-09-full.md:2313`).

### iOS / Metal

Engine line: llama.cpp on Metal (same GGUF, KV and governor); measured +6 % over MLX on LFM2.5
(`ios-engine-choice/REPORT.md`); MLX only if it clearly wins. iOS resolves KV to q8_0/q8_0
(`ee8b5f25`; the mixed q8_0/q4_0 cliff is Metal-only - Android CPU has no penalty,
`qdc-kv-mixed-decode`). Background generation poisons and reloads the context (`30038004`).
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

Phone chain: engine main `2e723bd9d` -> binding main `1babccb9` (vendors `2e723bd9d`, HTP skels
rebuilt) -> app main `44609814` pins `kalsa.rn#1babccb9` / kalsallama `2e723bd9d` (provenance
1198 files EXIT 0). NO APK exists yet with this pin. Desktop: v1.1.5 published on R2 + HF; the
next tag carries b11514 (desktop checks PASS, see above). Operational procedure, manifest
contract and the Cloudflare cache traps:
`archived/ALIVE-2026-10-09-full.md`, "Engine release pipeline" (unchanged procedure).

## Next steps (ordered, 2026-10-09)

1. Binding: rule v3 per-SoC values in the legs table + the SM8650 row (lab data cells 74/75) +
   audit fixes. App: v3 ON by default, re-pin, fix A1. Build the APK.
2. On that APK: S23 in-app smoke, then a 20-30 turn long session (this is G2 on the S23).
3. `_cok` app-shaped verification, and in-APK consumption (Meter), on the same APK.
4. The same on the Xiaomi (SM8650 row; governor gain measurement, not correctness only).
5. Owner decision on the Jelly (G3).
6. M1 dossier (raw results, limits, reproduction instructions).
7. Then: the learning governor (owner idea 2026-10-09), iOS/Metal on a real iPhone, MoE unpark.

## Open decisions (owner)

- The learning governor (2026-10-09 owner idea, plan after M1): learns per-device heat/speed
  per leg online (persisted, with exploration), seeded by the per-SoC lab row.
- G3 on the Jelly Star: LFM on the Jelly CPU is thermally non-viable
  (`analysis/CISWIRE-CHAR3GRAM-KV-AND-THERMAL-2026-09-19.md`); what the Jelly ships instead is
  an owner call.
- SM8850/v81 in the app's generation map needs a GPU-prefill correctness check on v81 first
  (`scratchpad/agents/qdc-governor-on-off-1d51f196/REPORT.md`).
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
- `scratchpad/BACKLOG-LOW-PRIORITY.md`: triaged audit leftovers; `scratchpad/COORDINATOR-STATE.md`:
  cross-session state.
- `archived/PLAN-2026-09-full.md`: full Italian history to 2026-09-20.
- `archived/PLAN-2026-10-09-full.md`: the full PLAN to 2026-10-09 (diary, engine release
  history, MoE research, pairing detail, every dated decision).
- `archived/ALIVE-2026-09-full.md`, `archived/ALIVE-2026-10-09-full.md`: the measured-state
  diaries, including the 2026-09 phone speed tables and the engine release pipeline procedure.
- `docs/ALIVE.md`: the living measured state.
