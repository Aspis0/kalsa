> Archives: `archived/ALIVE-2026-09-full.md` (diary to 2026-09-20),
> `archived/ALIVE-2026-10-09-full.md` (the full ALIVE to 2026-10-09: dated cells, the 2026-09
> phone speed tables, the engine release pipeline procedure). Superseded rows live there.

# Kalsa: ALIVE (living measured state)

## Headline (2026-10-09)

- Engine fork main `2e723bd9d` (upstream b11514 merged + audit fixes + the B1 Hexagon cap
  restore); binding main `f0ca4692` (rule v3 HEAT_RANK default on the S23 one-copy row,
  `decode_hop_rule` stat); app main `1f0e967b` pins the pair + the A1 fix, provenance 1198 files
  EXIT 0. APK building (CI run `37961298208`, debuggable; the first run failed on a lab-only OpenCL TU, backlog B7). SM8650 row held back: the engine's
  TILE32 gate does not admit Adreno 750 outside lab builds.
- One-copy three-leg loads are CORRECT on the merged engine on every measured device: S23 real
  phone (cell `s23-merge-b11514-legs-73`), Xiaomi 14 real phone - the GPU-750 leg that failed
  here is fixed and deterministic (cell `xiaomi-merge-b11514-legs-74`) - and QDC SM8650/SM8750/
  SM8850 (cell `qdc-merge-b11514-legs-72`).
- Governor on the S23, endurance to skin 43 C, unplugged: the round-3 headroom rule LOST (2785
  tokens vs NPU-alone 6051); round 4 with rule v3 HEAT_RANK TIES NPU alone (449/420 s vs
  453/431 s to 43 C, same 6144 tokens). Records: `onecopy-three-legs/step5-s23/raw/
  session26-vsleg3-fbf33176c.grep`, `onecopy-three-legs/step5-s23/raw/r4/REPORT.md`.
- 8 Elite long NPU (QDC #69): NSP reached 104 C vs its 105 C trip at 25 min; the speed loss is
  tied (one-run correlation) to the board's `gpu` cooling device (the J(1) lm_head runs on the
  GPU), cdsp never engaged (`qdc-8elite-npu-long-69`).
- Xiaomi 14 real phone, unplugged: GPU fastest (19.7-21.3 tok/s) but ~3x the NPU's skin heat per
  token; the NPU ran 8192 tokens without reaching 43 C (cells `xiaomi-endur-npu-gpu-75`,
  `xiaomi-legheat-76`). Under HEAT_RANK SM8650 stays mostly on the NPU.
- G2 in-app on the S23 (APK `1f0e967b`, 2026-10-09): the one-copy load (RSS 2.4 GB vs 3.9 GB two-copy), NPU
  prefill+decode and rule v3 hops all ran in-app, no crash; the session stopped at turn 4 on Android SEVERE while
  the governor stayed FAST - the platform status reaches it once per completion (`s23-g2-inapp-1f0e967b`).
- COOLMODE pacing exists end to end (engine `0012f97f2`, binding `a9bf7a26`, both pushed 2026-10-09):
  decode at duty 0.5 measured 7.5 tok/s on the S23 NPU; the binding reads Android's thermal status natively
  mid-turn. Not yet in an APK. Cell 77 (paced NPU vs paced GPU skin slope) is incomplete: a memory hard reset
  in the bench's second model load (one-copy NPU leaves ~0.9 GB MemAvailable); rerun 2026-10-10.
- G2 attempt on APK `2a1d1055` (2026-10-10): the governor held the S23 at Android status 2 for 65 min (COOLMODE,
  paced ~6 tok/s, skin 40-41.4 C, MemAvailable >= 1.24 GB, no crash) through 15 turns; stopped by a harness DB-read
  abort, since fixed. Repeat pending on a charged phone.
- Graduated decode pacing (2026-10-10, engine `74b75037f`, binding `2b85937b`, app `41ab9149`, all pushed): the
  engine slows decode by Android's own thermal forecast (S23: full speed below skin ~38 C, floor duty 0.35 at
  ~41 C), a battery ramp 39.5-43 C and a cap from Android's status; the binding reads the forecast natively every
  2 s. S23 G2 run 2026-10-10 (`s23-g2-graduated-867affaa`): faster first turns (5 completions >= 10 tok/s vs 2),
  about 10 % slower in the hot steady state than the flat 0.5, never SEVERE, no crash; stopped by the harness's
  thermal hard abort, whose 42 C pause ignored the config's 43 (fixed in app `e0ae695d`).
- **G2 on the S23, 2026-10-10 (APK `233486dd`, cell `s23-g2-full099-233486dd`): 20/20 turns in-app, unplugged from
  cold, no crash, no recovery, no harness pause, Android status never 3; repeated 2026-10-11 with the same result.** NPU decode under graduated pacing (S23 full
  line 0.99): first completions 10-16 tok/s, hot steady state ~5.8 tok/s at skin ~41.5 C.
- Xiaomi 14 in-app (night of 2026-10-11, APK `233486dd`, cell `xiaomi-g2-inapp-233486dd`): 14 turns, NPU prefill
  and decode, no crash, 15 -> 5-6 tok/s, skin max 44.9 C, battery max 42.0 C, Android status 0 throughout; stopped
  at 29 % battery (started at 62 %). Its thermal headroom scale differs from the S23's (0.28 at skin 44.9 C): the
  pacing lines must be per phone.
- QDC 2026-10-11 (APK `41dc728f`, cell `qdc-oracle-onoff-41dc728f`): on 8 Elite Gen 5 and 8 Elite the governor runs
  prefill on the NPU, ~6x faster than CPU (1337 vs 216 and 1159 vs 212 tok/s); decode is CPU in both arms and about
  equal; no crash. GPU prefill on Adreno 840 still fails the logit oracle (R2), so it stays off.
- Decode pacing now reasons in skin degrees for every phone (app `bc99cfeb`): the same 38.1 / 41.7 C lines, converted
  per model from the declared SEVERE threshold (S23 42 C, Xiaomi 14 66.5 C); other phones keep the defaults and the
  battery ramp.
- M1 was due 2026-10-09 (reserve 16 Oct) and is NOT met: G2 (in-app 20-30 turn session) has
  never been claimed and needs the APK that does not exist yet. Owner approved the next leg
  2026-10-09: rule v3 default in the app + per-SoC v3 values + the SM8650 row in the legs
  table, then APK, S23 in-app test, fix A1. Done up to the APK build (S23 row only).

## How to read this file

Each row names what is proven and the artefact that proves it. Numbers that move under
concurrent work are not copied here; the record that produced them is named instead.

## Proven, with the record

| what is proven | record |
|---|---|
| The delivery chain, current: engine main `2e723bd9d` -> binding main `f0ca4692` (`vendor/VERSIONS`, skels rebuilt, skew gate) -> app main `1f0e967b` pins `kalsa.rn#f0ca4692`, provenance 1198 files EXIT 0; APK CI run `37961298208`. Forks are main-only; retired lines are `archive/*` tags | app repo `package.json` + `REPOS.md` at `44609814`; provenance run: `archived/PLAN-2026-10-09-full.md:2311` |
| Engine main content: b11514 merge `904d38fad` + audit fixes `35233cf8e` (MUL_MAT_ID HMX gate, Metal vec-FA NULL-pipeline guard, Windows `ggml_fopen`, n_read) and `23b2a44d7` (u8path); B1 mbuf-cap restore `e2d2ac01b`/`985c6eb8f`/`2e723bd9d`; Q8_0 quantizer fix `837334a74`; bench-logits fix `fbf33176c` | `onecopy-three-legs/audit-merge-b11514-n2.md`; root `BACKLOG-LOW-PRIORITY.md` (B1); `bisect-npu-kld/` under `onecopy-three-legs/` |
| One copy, three legs: one weight copy serves NPU+GPU+CPU; KL mean vs two copies 1e-5 to 1.2e-4 (L-npu on SM8750/SM8850), E5 residual <= 2.3e-5; correct on the merged engine on S23 (real), Xiaomi (real), QDC SM8650/SM8750/SM8850 | `s23-merge-b11514-legs-73/`, `xiaomi-merge-b11514-legs-74/`, `qdc-merge-b11514-legs-72/` REPORTs |
| GPU-750 one-copy defect root cause: upstream `kernel_mul_mat_f16_f32_l4_y8` on the decode KQV; fixed by keeping Adreno A7X off it (engine `e01a61cee`, no speed cost); reproduced on a second 750 (QRD8650) | `qdc-8g3-gpu750-dump-67/`, `qdc-8g3-gpu750-y8-70/`, `qdc-8g3-onecopy-legs-71/` |
| Governor round 3: headroom rule lost to both single legs (2785 vs npu 6051 / gpu 5506 tokens to skin 43); round 4: rule v3 HEAT_RANK ties NPU alone; round-3 hard resets were bench-only (512 KB logits/token; fixed `fbf33176c`) | `onecopy-three-legs/step5-s23/raw/session26-vsleg3-fbf33176c.grep`; `onecopy-three-legs/step5-s23/raw/r4/REPORT.md`; `step5-s23/raw/session25-reset-proof-fbf33176c.grep` |
| In-app one-copy: S23 ONLY (binding legs table `cpp/rn-legs-table.cpp` has one row, SM8550); RAM 2.51 GB one copy vs 4.06 GB two-model, same method; `decode_tokens_gpu` telemetry wired and verified in-app | `onecopy-three-legs/step6-inapp/` (`summary-ram.grep`, `raw/gputel-4-kalsa.grep`); binding repo `cpp/rn-legs-table.cpp` at `1babccb9` |
| In-app NPU prefill with KV on the device (option a): 4.0x (short) / 5.5x (long) vs host KV on the S23, decode unchanged, 7/7 answers correct; owner OKed it ON by default (`2a079bd2`) | `s23-option-a-speed-7ec12eb0/`; `htp-kv-attention/` (the host-KV bottleneck measurement) |
| `_cok` q4_K small-batch accumulator fix `319b53937` is IN engine main (ancestor of `2e723bd9d`); the audit's app-shaped verification has NO record of having run - open verification | `cok-accumulator-audit/REPORT.md`; `git merge-base --is-ancestor 319b53937 2e723bd9d` in the engine repo |
| 2026-09-22 GPU numerics: the fp16 activation block scale was the 57x divergence cause (shipped default 0.005412 / 93.982 %); the acceptance gate (<= 0.005 KLD) is not reachable by batched-GEMM precision work; the KV-term magnitude is unsettled (two reference orientations disagree 3.2x) | `s23-kld-740-q4-0/REPORT.md` sec. 17-35 |
| Per-backend heat: NPU is the coolest leg for prefill on both chips, CPU prefill never coolest; S23 decode heat per 1k tokens NPU 2.8 / GPU 3.2 / CPU 4.7 C skin | `s23-heat-arms-engine/`, `qdc-8elite-heat-arms/`, `qdc-8elite-hopping-heat/`, `onecopy-three-legs/step5-s23/raw/session13-legheat-3a7fbec44.grep` |
| The governor engages in-app and hops (S23). On 2026-09-28 one long turn drove Android status 0 -> 3 SEVERE while it logged FAST (battery-only classifier then); engine `6892d0415` (2026-09-29) made the platform status a classifier input, fed by the app; no in-app re-verification on disk | `s23-governor-lfm-long/REPORT.md`; engine `src/llama-governor-policy.cpp:248` |
| Governor trend producer: inert at production cadence, unproven - not to be shipped as an escalation trigger on this evidence | `governor-trend/REPORT.md` (rounds 1-4, `replay-wrongfire.cjs`) |
| Meter: owner rule (nearly zero consumption -> release APK), the 1 %/5 % bar against the measured 1,045 mA turn draw, and the pre-registered thresholds; energy is unsound as within-turn control. Sampler overhead (S23, 2026-10-11): measured ~1.1-1.36 ms CPU/s in its thread + ~1 ms/s in the health HAL; conditional bound (system_server share and 4 W/core assumed) <= 0.24-0.44 % of a turn, under the 1 % bar. First in-app reading (S23): turn 1 costs 254-294 mWh governor ON vs 376 mWh OFF (CPU only, SEVERE in that turn), 1.8-2.0x per output token; one OFF turn; S23 energy = current x voltage (the charge counter pins at full) | `s23-kld-740-q4-0/REPORT.md` sec. 30; `governor-meter-recon/REPORT.md`; `s23-meter-gov-onoff-bc99cfeb/REPORT.md`; `s23-meter-overhead-bc99cfeb/REPORT.md` |
| Learning governor Stage 0 (observation only, 2026-10-12): binding main `861a3cc3` (Aspis0/kalsa.rn, from `2581a9aa`, 5 commits, GLM writer, luna gpt-6 auditor x3 + coordinator read) records per-32-token decode windows (leg, forecast + its age, zone temps/headroom, status/app ages, battery sysfs) in a 256-slot ring, committed only after a decode step returns rc 0; one `governorStats` call returns stats + samples under one lock; no governor decision changes (bench path drops only the record). Host tests + guard jest 13/13 + assert-htp-skels EXIT 0; app part pushed as app main `aa789620` (pin `861a3cc3`; one numeric JSONL row per completion in the private app dir, 4 MB rotation, gap/dropped markers, stop races the stats read; privacy audited: ids, numbers and closed labels only); pre-push block + 283 targeted jest + campaign selftest EXIT 0. S23 device check 2026-10-12 (6 turns vs a df359450 control): criteria 1-6 pass (7 rows, no gap, tok = pred_n, windows complete, forecast age <= 2.3 s); leg mix not judgeable (different conversations; one 32-token GPU window per completion in both arms from turn 2); native log lines absent from logcat; S23 battery sysfs denied (OPEN 4: unusable there); app thermo sample ages reach 350 s inside a paced completion. Pre-existing, out of scope: the binding hop mirror drifts from the engine counter after a failed bench run | `scratchpad/agents/learning-governor/DESIGN.md` (v0.5 + sec. 3.5), `AUDIT-1..3.md`, `s23-stage0-obs-aa789620/REPORT.md` |
| Learning governor Stage 0 on the Xiaomi 14 (2026-10-15, cell `xiaomi-stage0-obs-aa789620`): 6 turns, 8 observation rows, `gap:0` everywhere, `sum(tok) - pred_n = +1` on every row, `win` = ceil(pred_n/32) with 0 overflow, forecast age <= 2.65 s over 324 windows. **The Xiaomi's passive trips are finite for all three legs: cpu 60-115 C, npu 100 C, gpu 95 C** (OPEN 1 closed; GPU block ceiling 90 C, so the zone guard does not bind on the blind path). The battery sysfs is not readable by the app here either (OPEN 4 closed negatively, same as the S23). The app thermo sample age reaches **503 s** inside a paced completion here (350 s on the S23), so DESIGN 5.1's 120 s freshness gate would false-disarm: ownership-first rule + 1200 s backstop decided on paper. Decode stayed 100 % NPU (10229 tokens, 0 GPU, 0 CPU), pps 17.9 -> 3.2, skin peak 42.2 C, battery 79 -> 63 %, Android status 0 throughout, no crash, no pause, no kill. Criterion 3 not testable (paced from the first completion), criterion 8 not observable. No control arm, so no speed or heat claim. Stage 0b written, audited (round 1 DO-NOT-SHIP on an unpinned rounding direction, fixed and amended, round 2 SHIP) and **pushed on the owner's OK as app main `54c36105`** (fast-forward over `357e36d2`, 3 files: the Xiaomi declares 39.0 / 42.6 C skin -> 0.083 / 0.203, the S23 keeps the shared 0.87 / 0.99) | `xiaomi-stage0-obs-aa789620/REPORT.md`, `learning-governor/DESIGN-ADDENDUM-2026-10-15.md` |
| 8 Elite long NPU: 16 x 2048-token runs, -14 % from run 6, tied to the board's `gpu` cooling device; NSP 104 C vs trip 105 at 25 min, cdsp cooling 0 | `qdc-8elite-npu-long-69/REPORT.md` |
| Xiaomi 14 endurance (unplugged, to skin 43): NPU alone ~7.5-8k tokens vs CPU alone ~1.5k (~1.0 vs ~5.4 C skin per 1k tokens); GPU leg excluded then (pre-fix) | `onecopy-three-legs/xiaomi-sm8650/raw/session3-legs-endurance-unplugged-dbdeb628e.grep` |
| Mixed K/V showed no CPU decode penalty on one QDC SM8650 board at depths 0/2048 (S23 not measured; Metal cliff at depth 15744 not tested on CPU); Android keeps q8_0/q4_0, iOS resolves q8_0/q8_0 | `qdc-kv-mixed-decode/`; `ios-engine-choice/REPORT.md` |
| iOS engine line: llama.cpp on Metal beats MLX on LFM2.5 (+6 % decode) and loses on Qwen3.5-2B (-26 %); engine line confirmed llama.cpp; AFM not a main engine | `ios-engine-choice/REPORT.md` |
| Iroh pairing passes on the Jelly (invite link, desk Allow, Forget + re-pair); the `kalsa-pair` Worker is live (HTTP 200 both endpoints); doorless node-only invites pair over iroh, LIVE PASS 2026-10-03 | `pair-worker-reachability/2026-09-28.txt`; `archived/PLAN-2026-10-09-full.md` (Pairing section, LIVE PASS) |
| The binding's jest is green after `npm ci` (the old 12/12 failures were a pnpm-installed `node_modules`) | `binding-jest-dead/REPORT.md` |
| Ling-3.0-tiny: Chinese only (owner decision 2026-10-01); IT/FR/ES answers fail with thinking on or off | `analysis/ling-probe-2026-10-01/REPORT.md` |
| Analysis records still in force: ciswire char-3-gram + Jelly thermal (LFM on Jelly CPU thermally non-viable); Xiaomi/Qwen fit-gate + token overflow; fork `vendor/` migration; governor KV session contract (re-pin its `file:line`s before quoting); governor device plan | `analysis/` by name; `archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md` |

## Measured on-device, 2026-10 kits (ship model LFM2.5-2.6B QAD-Q4_0)

One-copy three-leg builds (merged engine `2e723bd9d` line unless noted). Rows are comparable
only inside themselves; QDC boards are always powered, so their speed is indicative and their
heat is meaningless.

| device (SoC) | legs correct (KL vs two copies) | decode tok/s NPU / GPU / CPU | notes |
|---|---|---|---|
| Galaxy S23 (SM8550, v73) real | yes, incl. hops (cell 73) | 17.1 / 14.5-15.7 / 12.8-13.5 | heat 2.8 / 3.2 / 4.7 C per 1k; endurance NPU 6051 tokens to skin 43; rule v3 = NPU alone (round 4). In-app: prefill 706.7/661.4 tok/s with KV on device, RAM 2.51 GB |
| Xiaomi 14 (SM8650, v75) real | yes on the merged engine (cell 74); GPU-750 fixed, KL 1.0e-5 | 14-17.5 / 19.7-22.2 / 13.6-14.7 (cells 74-76) | heat ~1.1 / 3.2 / 7.3 C skin per 1k; load step ~5 / 11 / 26 C; NPU 8192 tokens without reaching skin 43, GPU to 43 in one 2048-token run (cells 75, 76) |
| 8 Elite (SM8750, v79) QDC | yes (cells 66, 72) | 26.7 / 28.9 / 26.5 (cell 72, plugged, indicative) | long NPU: NSP 104 C vs 105 trip at 25 min; throttle via the `gpu` cooling device (cell 69) |
| 8 Elite Gen 5 (SM8850, v81) QDC | yes (cells 68, 72) | 27.1 / 30.6 / 19.2 (cell 72, plugged, indicative) | in the app's generation map as V81 (`0cf38a79`); GPU prefill is the lane-off fallback since app `df359450`, verified in-app on the SM8850 2026-10-11: GPU 295 / NPU 1342 / CPU 224 tok/s prefill, no crash (`qdc-v81-fallback-df359450`) |

## Standing cautions

- A device number is only as good as the phone state it was read in: unplugged vs charging,
  screen awake vs dozing, skin temperature at start. Heat and speed claims only unplugged on our
  phones (never while charging); QDC boards are always powered - speed indicative, heat none.
- Every timing ratio states the screen state of BOTH arms (with the screen off Android parks
  CPUs; `screen_off_timeout` is 30000 ms). Every published number carries its load condition.
- Read the executing device from `layers_device`, never from the per-chunk `actual` or the
  per-turn `engine_prefill` label: lane-on, those named "gpu" while HTP0 executed
  (`s23-governor-npu-gpu-cpu/AUDIT-r1.md`; proven in-app by `s23-layers-device-proof/`).
- In-app NPU speed is context-dependent; quote it with its KV placement and depth
  (`htp-kv-attention/`).
- The 2026-09-28 SEVERE-vs-FAST blind spot predates the platform-status input (`6892d0415`) and
  has no in-app re-verification on disk.
- Safety marking: 4 pre-answer cells flagged RELEASE BLOCKER CANDIDATE; a budget-up re-run
  (n >= 160) is required before acting (`archived/ALIVE-2026-10-09-full.md:259-263`).
- Open since 2026-09-22, unverified since: the KV-term magnitude (orientations disagree 3.2x)
  and the thermal limb of the Jelly prefill stall (both reruns sat at SEVERE).
- An artefact whose hash is cited must be archived before any cleanup touches build output.
- A coder's refspec is a proposal, not a decision (see PLAN, Standing rules).

## Where the record lives

- `scratchpad/agents/<cell>/`: one folder per measurement cell (`PREREG.md`, scripts, `raw/`,
  `REPORT.md`).
- `archived/ALIVE-2026-10-09-full.md`: the full measured-state diary to 2026-10-09, including
  the 2026-09 phone speed tables (superseded by the kits above) and the **Engine release
  pipeline** procedure (publish steps, manifest contract, Cloudflare cache traps) - the
  procedure is unchanged, read it there.
- `archived/ALIVE-2026-09-full.md`: diary to 2026-09-20. `archived/PLAN-2026-10-09-full.md` /
  `archived/PLAN-2026-09-full.md`: the PLAN archives.
- Current state and next steps: `PLAN.md` (living). Current gate statuses: `PLAN.md`, "Gates and dates".
- `scratchpad/agents/gpu-layers-history/`: 2026-10-15 audit of the "GPU at several layer counts"
  history, four independent read-only sweeps (`SCOPE-A/B/C/D.md`, 347 lines) integrated into
  `VERDICT.md`. Reading it before arguing about the Xiaomi `NoFit`: per-layer MEMORY exists only
  for the S23, per-layer SPEED only for the Xiaomi, and the two were never measured together.
- `scratchpad/agents/PLAN-NPU-LANE-2026-10-15.md`: the NPU prefill lane is measured on the Xiaomi
  (4.7x OpenCL, 29/09) and ran in-app on 11/10 (prefill+decode on the NPU, no crash); it stopped
  running by 15/10. Read this before touching the fit gate - the plan reframes the work as a
  regression hunt, and it voids three coordinator premises recorded earlier the same day.
- Owner policy 2026-10-15: **no OOM, no reboot, degrade gently.** Degrading means stepping down a
  leg, never dropping to zero layers and hoping.
