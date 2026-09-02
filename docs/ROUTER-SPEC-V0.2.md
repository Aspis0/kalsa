# Tri-engine router/governor — runtime contract v0.2

Status: paper specification. This is the implementation start for
`docs/PLAN-10DAYS-2026-08-28.md` §7. It defines the smallest runtime contract
for a turn-aware router and thermal governor.

The audited design study remains the policy source: this document extends its
R1–R9 contract and never silently changes its ordering or meanings
([design study](GOVERNOR-TRI-ENGINE-DESIGN.md#governor-tri-engine--design-study-plan-24):7,
307–320). `npu_fit` remains an admission gate, not a speed or correctness
certificate. It is necessary; the exact model+quant PPL certificate remains the
sufficient correctness containment gate ([NPU fit model](NPU-FIT-MODEL.md#npu_fit-htp-memory-model):7–17).

## 1. Scope

v0.2 implements:

- the existing R1–R9 prefill policy, with thermal admission applied per turn;
- CPU or `gpu_coolmode` decode placement per phase, including the bounded
  COOLMODE relaunch;
- the polled thermal state machine, predicted-end-temperature admission, and
  the one-way CPU→GPU hourly budget;
- handoff between the existing prefill/decode contexts through the existing KV
  range-commit path.

NPU lane wiring is deferred. The NPU seam is specified in §3, but no NPU lane
may be selected by this version: the current ledger has no NPU lane ON; R2 is
certified but OFF pending the app-side spike cell and `npu_fit`, R3 is
characterization-only, and R6/R7 are hard OFF
([design study](GOVERNOR-TRI-ENGINE-DESIGN.md#0-executive-summary--proposed-defaults-with-honest-confidence):59–63,
333–336). The app-side shape census required by `npu_fit` is also a dependency,
not an API invented here ([NPU fit model](NPU-FIT-MODEL.md#5-open-inputs-from-the-app-side):408–426).

### Existing runtime seams

These are the only kalsallama seams this paper names. They are from
`kalsa/governor-v0` at `1bfd144a2`; v0.2 does not add a replacement interface.

| seam | use in this contract | source quote |
|---|---|---|
| `llama_governor_init` | Construct two independent model contexts for the prefill and decode placements. | `kalsallama@1bfd144a2:src/llama-ext.h:203-208` — “Initialize a governor; model handles are borrowed for the governor lifetime.” |
| `llama_governor_decode` | Submit the selected batch; the existing governor dispatches `n_tokens > 1` to prefill and one token to decode. | `kalsallama@1bfd144a2:src/llama-governor.cpp:112-114` — “`const bool is_prefill = batch.n_tokens > 1;`” and “`target = is_prefill ? ctx_prefill : ctx_decode`”. |
| `llama_kv_route_query` | Check whether a handoff is `Direct`, `MirrorAndCopy`, or `Reject` before committing. | `kalsallama@1bfd144a2:src/llama-ext.h:119-127` — “`Direct`, `MirrorAndCopy`, `Reject`” and the query declaration. |
| `llama_kv_commit_with_stats` / `llama_kv_commit_ex` | Commit only the explicit sequence range `[p0,p1)`; the governor advances its watermark and calls the existing range path. | `kalsallama@1bfd144a2:src/llama-governor.cpp:61-65` — “`llama_kv_commit_with_stats(..., src.watermark, end, &copied_bytes)`”; `src/llama-ext.h:164-171` — “`seq_id, p0, p1, llama_kv_commit_mode mode`”; `src/llama-kv-commit.cpp:311-314` — “`p1 must be explicit and greater than p0`”. |
| hybrid commit | Preserve the existing hybrid attention/recurrent handoff. | `kalsallama@1bfd144a2:src/llama-kv-commit.cpp:338-342` — “`return llama_hybrid_commit(...)`”. |
| staged V transpose | Use the existing `Staged` mode only where its source V path is valid; the implementation copies staged V through `llama_kv_copy_v_staged`. | `kalsallama@1bfd144a2:src/llama-kv-commit.cpp:217-222` — “`mode == llama_kv_commit_mode::Staged && src.v_trans`” then “`llama_kv_copy_v_staged(...)`”. |
| `llama_governor_get_stats` / `llama_governor_stats` | Read existing governor observations. There is no new `PreparedPlan` type: `n_reused` counts ubatches, splits come from the scheduler, and graph builds are the existing derived counter. | `kalsallama@1bfd144a2:src/llama-ext.h:229-232` — “Read governor counters”; `src/llama-governor.cpp:79-95` — “`side.graph_builds = side.ubatches_submitted - side.n_reused`” and “`side.n_splits = ggml_backend_sched_get_n_splits(...)`”. |

The pinned code makes failures sticky inside `llama_governor`; it does not
silently switch to a single context (`kalsallama@1bfd144a2:src/llama-ext.h:195-200`).
The policy fallback for an unknown or unadmitted turn is still CPU (§5); a
failed existing governor instance must be recreated by its caller under the CPU
launch configuration.

## 2. Inputs

The router reads these inputs at launch and on every turn. It does not infer a
generation, thermal headroom, fit result, or NPU shape from a nearby device or
model.

| input | when | source and required meaning |
|---|---|---|
| device class | launch | `DeviceProbe`: v73/740-class, v75/750-class, v79/8xx, no HTP, or unknown. Unknown generation is CPU. The existing contract recognizes the generation from a device table ([q54 router contract](../scratchpad/agents/q54-engine-router/SPEC.md#4-inputs-generation-recognition-output):57–81). |
| memory probe | launch and each new load | Available memory, sanity-checked against device total RAM. A non-positive, over-total, or otherwise unknown value fails accelerator fit. |
| model and quantization | launch | GGUF metadata: dense/hybrid/MoE class, trunk and expert quant sets, total bytes, trunk bytes. No model file scan is added ([q54 router contract](../scratchpad/agents/q54-engine-router/SPEC.md#4-inputs-generation-recognition-output):65–71). |
| `gpu_fit` | launch/selection | Existing conservative fit gate: `mem_available ≥ 800 MiB + 1.05 × offloaded_bytes`; fit precedes speed ([design study](GOVERNOR-TRI-ENGINE-DESIGN.md#14-memory-costs--fit-gates-decide-before-speed--law-4):136–146). |
| `npu_fit` and PPL verdict | deferred NPU selection | `npu_fit` is necessary. A model is NPU-fit only with a complete app-side shape census, backend verdicts, app memory/KV admission, and the per-model PPL certificate; `fit` is sufficient only after those gates ([NPU fit model](NPU-FIT-MODEL.md#1-inputs-and-outputs):19–49). |
| thermal poll | every 10 s | Battery temperature in tenths of °C, battery level, plugged state, and the last-60-second trend. `getThermalHeadroom` is not a numeric input ([design study](GOVERNOR-TRI-ENGINE-DESIGN.md#15-sensor-reality):148–154). |
| `T_idle` | plugged profile | Day-1 measured plugged idle baseline. If the baseline makes a safe relative profile impossible, refuse the plugged turn and require cooldown or unplugged operation ([design study](GOVERNOR-TRI-ENGINE-DESIGN.md#22-states-and-thresholds):174–200). |
| phase and turn sizes | every turn | Prompt token count and generation-length hint. The execution phase is prefill or decode; the existing governor's batch seam uses the actual batch size (§1). |

The output is the existing paper `LaunchConfig` v0.3 record. Its relevant
values are `prefill_engine` from R1–R9, `decode_engine ∈ {cpu, gpu_coolmode}`,
`prefill_token_cap` (`512` only after a lane is ON, otherwise `null`), and
`admission_margin_c = 0.5`; these are transcribed from
the design, not new kalsallama APIs ([design study](GOVERNOR-TRI-ENGINE-DESIGN.md#3-composition-with-router-v03-spec-v02-rules-retained):307–320).

## 3. Decision procedure

### 3.1 Preserve the router contract

R1–R9 remain pure, ordered, and first-match-wins. The table below is a
transcription of the existing router contract ([design study](GOVERNOR-TRI-ENGINE-DESIGN.md):7;
[q54 router contract](../scratchpad/agents/q54-engine-router/SPEC.md#5-the-decision-table-from-alive-8--lanes-913):102–152).
The current ledger gate is applied after the predicate and before any NPU
launch.

| rule | condition | prefill result | v0.2 status |
|---|---|---|---|
| R1 | no-HTP device | CPU | active |
| R2 | v75 + MoE + HTP-readable trunk and experts + `npu_fit` | NPU full graph | blocked: certified but OFF; spike cell + `npu_fit` required |
| R3 | v75 + dense/hybrid + HTP-readable trunk + `npu_fit` | NPU full model | blocked: characterization-only |
| R4 | v75 + MoE + HTP-readable trunk + `npu_fit` | NPU trunk, CPU experts | blocked: not certified |
| R5 | v75 + `gpu_fit` | GPU full offload | active only where the measured table says so; partial offload is prohibited |
| R6 | v73 + dense/hybrid + HTP-readable trunk + `npu_fit` | NPU full model | hard OFF; future spike cell only |
| R7 | v73 + MoE + HTP-readable trunk + `npu_fit` | NPU trunk, CPU experts | hard OFF |
| R8 | v73 + MoE + eligible `ThermoProfile` thermal fallback + `gpu_fit` | GPU cool-mode prefill fallback | KEXP/v73 measured scope only; the old `thermal_priority` input is replaced by `ThermoProfile`; do not reinterpret R8 as the decode rule |
| R9 | otherwise | CPU | always available |

The R8 meaning is intentionally retained. The separate decode decision below
is what emits `decode_engine="gpu_coolmode"`. Current NPU status is no NPU
selection, even when an R2–R7 predicate would otherwise match.

### 3.2 Generation data used by the tables

These are lookup values, not calculations performed by the governor.

| generation | table fact used by v0.2 | decision consequence |
|---|---|---|
| v73 / Adreno 740 | CPU owns decode; GPU cool-mode is KEXP-only, A/C `0.812`, peak delta `−2.75 °C` ([ALIVE](ALIVE.md):453–479; [design study](GOVERNOR-TRI-ENGINE-DESIGN.md#0-executive-summary--proposed-defaults-with-honest-confidence):67–75) | only an eligible KEXP cool-mode relaunch may displace CPU decode |
| v75 / Adreno 750 | decode A/C `0.992` parity and prefill about `2.48×` ([ALIVE](ALIVE.md):371–378; [design study](GOVERNOR-TRI-ENGINE-DESIGN.md#11-engine-speeds-banked-cells-product-cards-and-cell-numbers-never-mixed):89–105) | no GPU cool-mode decode; use measured full-GPU prefill only when fit passes |
| v79 / Adreno 830 | shipping-model NPU prefill `7.2×` CPU and Oryon CPU decode `1.64×` NPU; exploratory data seeds the 830 column and is not itself a routing verdict ([PLAN](../PLAN.md):1522–1547) | no NPU wiring in v0.2; unknown/deferred route is CPU |
| unknown / other | no transferred generation verdict | CPU |

### 3.3 Poll and state transition

Classify the initial state from the first successful poll. For unplugged use
the absolute row. For plugged use the measured `T_idle` row; cap every entry at
the absolute watchdog limits ([design study](GOVERNOR-TRI-ENGINE-DESIGN.md#22-states-and-thresholds):172–200).

| state | entry condition | exit condition | action |
|---|---|---|---|
| FAST | `T < WARM enter` | `T ≥ WARM enter` | normal table-driven prefill; CPU decode |
| WARM | WARM range through COOL entry | `T < WARM exit` after at least 10 min | CPU decode; admitted prefill only |
| COOLMODE | `T ≥ COOL enter`, or at WARM+0.5 with trend `≥ +1.5 °C/min` | `T < COOL exit` after 10 min | suppress NPU; permit eligible GPU cool-mode decode; exit lands in FAST |
| CRITICAL | `T ≥ CRITICAL enter` or watchdog precondition | unplugged `≤34.0 °C`; plugged `≤T_idle+1.0 °C`, plus 10-min soak | abort; kill children and drop HTP |
| LOWBAT | `<25%` only when the 45% floor is not enforced | battery is safe | CPU only; unreachable under the carried 45% floor |

| profile | WARM enter / exit | COOL enter / exit | CRITICAL enter / exit |
|---|---|---|---|
| unplugged | `38.0 / 36.0 °C` | `39.5 / 36.5 °C` | `42.0 / 34.0 °C` + 10-min soak |
| plugged | `min(T_idle+3.0,42.0) / T_idle+1.0` | `min(T_idle+4.5,42.0) / T_idle+1.5` | `min(T_idle+7.0,42.0) / T_idle+1.0` + 10-min soak |

| plugged-profile guard | result |
|---|---|
| `T_idle + 1.0 ≥ 42.0 °C`, or an offset can reach KILL before CRITICAL aborts | refuse plugged launch |
| `T_idle ≥ 37.5 °C` | hot-plugged: CPU-only, no cool mode, announce refusal |
| `T_idle ≥ 39.0 °C` | WARM entry also collapses; announce refusal/cooldown |

The hysteresis widths are 2.0 °C (WARM), 3.0 °C (COOL), and 8.0 °C
(unplugged CRITICAL). `+1.5 °C/min` is an engineered tunable pinned by tests.
`WARN=40.0 °C`, `KILL=43.0 °C`, poll interval 10 s, and battery floor 45%
remain hard values ([design study](GOVERNOR-TRI-ENGINE-DESIGN.md#23-transitions-hysteresis--dwell):217–229;
[design study](GOVERNOR-TRI-ENGINE-DESIGN.md#15-sensor-reality):148–154).

### 3.4 Per-turn prefill admission

Admission runs before engine selection and before every prefill chunk. The
predicted end temperature is checked against `T_limit = WARN − 0.5 = 39.5 °C`.

| order | condition | result |
|---|---|---|
| 1 | state is CRITICAL, sensor failed, or profile is invalid | abort/refuse; wait for a valid safe profile |
| 2 | candidate is NPU | defer in v0.2; select CPU |
| 3 | candidate is GPU, or prompt size is not a table key | refuse the candidate; reduce to a tabled chunk and re-check |
| 4 | `T_now + ΔT_table(prompt_tokens, engine) > 39.5 °C` | smaller admitted chunk, then CPU, then cooldown wait; re-check after every chunk |
| 5 | tabled candidate passes | admit it |

| prompt tokens | 128 | 512 | 1024 | 2048 |
|---|---:|---:|---:|---:|
| NPU ΔT (°C) | 0.5 | 0.0 | 1.1 | 2.2 |
| CPU ΔT (°C) | 1.9 | 3.25 | 3.25 | 5.15 |

No unknown delta is admitted. In particular, `37.9 + 5.15 = 43.05 °C`
rejects a 2048-token CPU prefill before launch ([design study](GOVERNOR-TRI-ENGINE-DESIGN.md#24-placement-and-pre-turn-admission):231–260).

### 3.5 Per-turn decode placement

CPU is the default and is the only result when any predicate is unknown.
`gpu_coolmode` is a full reload, not an in-process executor flip.

| condition, in order | `decode_engine` |
|---|---|
| phase is not decode | retain the phase's prefill result |
| state is not COOLMODE | `cpu` |
| no `gpu_fit`, no measured v73/KEXP cool delta, or device is v75-class | `cpu` |
| `cool_pays() == false` or reload budget is exhausted | `cpu` or cooldown wait |
| v73/KEXP fit passes, measured delta exists, `cool_pays() == true`, and CPU→GPU budget is available | `gpu_coolmode` |

The design's break-even predicate is retained:

`(1/rate_cpu_hot − 1/(0.81 × rate_cpu_cold)) × τ_energy_tokens > reload_s`.

`τ_energy_tokens` is the remaining hot-window token count implied by the
selected exits. `rate_cpu(T)`, sustained GPU slope, and reload cost remain
unknown until G1–G3; until measured, the interim rule is to switch when an
eligible COOL entry is reached ([design study](GOVERNOR-TRI-ENGINE-DESIGN.md#24-placement-and-pre-turn-admission):283–305).

Only CPU→GPU engagement consumes one flip per hour. GPU→CPU exit does not.

### 3.6 Deferred NPU seam

When the ledger and app dependencies eventually permit an NPU lane, the
admission order is:

| gate | required condition | v0.2 result |
|---|---|---|
| generation and lane | v75, or v73 dense/hybrid only after R6 reopens; the specific lane is ON | currently false: no NPU lane is selected |
| quantization | all emitted NPU weights use `{Q4_0,Q4_1,Q8_0,IQ4_NL,MXFP4}` | otherwise CPU |
| `npu_fit` | model fit, complete shape census, backend verdicts, and app memory/KV admission | unknown or `not fit` → CPU |
| correctness | exact model+quant per-model PPL certificate | missing → CPU |
| spike controls | future spike only: `tokens ≤512`, FAST/WARM, predicted-end inequality, unplugged, watchdog, ≤10 min | otherwise CPU/wait |

The app-side dependency is the complete emitted `MUL_MAT` and `MUL_MAT_ID`
census for prompt, microbatch, decode, and routed-expert cases, including
operation kind, logical/batch dimensions, strides or permutation, destination
shape, repacked-weight fact, weight residency, and host-KV admission. The source
explicitly says the paper defines no collection API ([NPU fit model](NPU-FIT-MODEL.md#5-open-inputs-from-the-app-side):408–426).

## 4. State

State belongs to one live router/governor session. It is not a process-global
policy cache and it is not written to disk.

| state | lifetime and owner | rule |
|---|---|---|
| thermal state, last successful poll, trend window | governor session | retain across turns; classify the first successful poll directly; reset on a new load |
| plugged `T_idle` profile and validity | device/session profile | retain for the declared plugged session; re-measure if it drifts by more than 1.5 °C or an exit misses 2× its dwell |
| current phase and selected decode engine | governor session | retain only to detect a phase/engine transition and a required reload |
| CPU→GPU engagement timestamp/budget | governor session | at most one engagement in any hour; GPU→CPU does not spend it |
| KV handoff watermarks | existing prefill/decode side state | one exclusive watermark per side; commit only the range since that watermark |
| `n_reused`, splits, graph-builds, commit bytes/time/count | existing `llama_governor_stats` | observations only; do not turn them into new routing policy in v0.2 |

The existing side state stores “`watermark = 0; // exclusive next position not
committed to the other side`” (`kalsallama@1bfd144a2:src/llama-governor.h:19-26`).
The existing governor also stores `last_phase` and a sticky `failed` flag
(`kalsallama@1bfd144a2:src/llama-governor.h:34-42`). A new launch re-probes
memory, re-reads the ledger, and re-derives state; mid-session state is not
persisted ([design study](GOVERNOR-TRI-ENGINE-DESIGN.md#5-risks--anti-patterns):417–418).

## 5. Failure and unknown handling

Unknown means “not proven for this exact generation, model, quantization,
phase, or table key.” It never means “try the nearest value.”

| condition | result |
|---|---|
| unknown generation, schema, device table, model fit, `gpu_fit`, cool delta, reload cost, or table delta | CPU; if the thermal profile is unsafe, wait rather than launch |
| incomplete NPU shape census, unknown `npu_fit`, missing PPL certificate, or OFF ledger lane | CPU; no NPU attempt |
| unknown/intermediate/oversize prompt size | chunk to a tabled size and re-admit; if no safe tabled chunk exists, CPU or wait |
| thermal sensor failure, invalid plugged profile, or `T_now + predicted delta > 39.5 °C` | fail closed: refuse accelerator, choose CPU if safe, otherwise wait |
| CRITICAL or KILL backstop | abort immediately; kill children, drop HTP, and re-derive at the next load |
| `llama_kv_route_query == Reject` | do not hand off; do not call the commit; use the CPU launch path |
| KV commit, decode, or selected-lane verification failure | no retry policy in v0.2; the existing governor's sticky failure is honored and the caller recreates under CPU |
| chosen lane silently falls back | log `lane_fallback` with the rule id and continue on CPU; no retry ([q54 router contract](../scratchpad/agents/q54-engine-router/SPEC.md#4-inputs-generation-recognition-output):82–87) |

The KILL backstop is independent of predicted admission. The OS may protect
the device before user-space observes the next poll; therefore no turn gets a
grace period ([design study](GOVERNOR-TRI-ENGINE-DESIGN.md#23-transitions-hysteresis--dwell):221–229).

## 6. Test plan

No build or device run is part of this paper. Implementation starts with pure
decision tests and seam tests against the already-existing governor plumbing.

### G1–G5 measurement fixtures

These names and acceptance conditions are transcribed from the design study's
measurement cells; they supply later table values and do not authorize a lane
by themselves ([design study](GOVERNOR-TRI-ENGINE-DESIGN.md#4-unknowns--measurement-cells--1-hdevice-unless-noted):353–402).

| fixture | feeds | acceptance/use |
|---|---|---|
| G1 CPU throttle curve | `rate_cpu(T)`, CPU slope, trend sensitivity | bins only the traversed range; use the pre-committed partial fallback when the full range is unavailable |
| G2 decode-switch reload cost | `reload_s` by model size | measure CPU load and CPU→GPU relaunch/upload separately; CV ≤15% |
| G3 GPU cool slope and break-even | GPU slope and `cool_pays()` | re-test the v73/KEXP `−19%` / `−2.75 °C` scope; two replicates per arm within ±15% slope |
| G4 prompt crossover | prompt/generation table rows | signed PLAN §6(a) alias; grid `p∈{128,512,2048}` × `g∈{64,512}`, N=3 ABBA |
| G5 NPU spike repeatability | future spike ceiling and window frequency | post-window, owner re-authorization, unplugged-only, balanced 4 NPU + 4 CPU per size; plugged arm is CPU-controls-only |

### Router golden assertions

Pin these assertions from the design's golden list ([design study](GOVERNOR-TRI-ENGINE-DESIGN.md#3-composition-with-router-v03-spec-v02-rules-retained):338–351):

| assertion | expected result |
|---|---|
| current ledger: R2 OFF, R3 characterization-only, R6/R7 hard OFF | no NPU |
| v0.3 schema and eligible COOLMODE relaunch | `decode_engine="gpu_coolmode"`; v0.2/unknown schema emits CPU |
| missing fit/cool delta, 750 parity, or failed admission | CPU or wait |
| hot first poll | classify directly into WARM, COOLMODE, or CRITICAL |
| 2048-token CPU prefill from 37.9 °C | reject because predicted end is 43.05 °C; test smaller-chunk re-admission |
| plugged CRITICAL exit | `T_idle+1.0 °C` plus soak, never absolute 34.0 °C |
| hysteresis and trend | widths 2.0/3.0/8.0 °C; trend threshold +1.5 °C/min |
| flip accounting | CPU→GPU spends the one/hour budget; GPU→CPU does not; plugged G5 rejects NPU |
| 4096, intermediate miss, oversize, and GPU-prefill request | refuse or chunk to a tabled size; never admit an unknown delta |

### `npu_fit` acceptance fixtures

These fixtures are required before any future NPU lane can be considered fit.
They reproduce the audited v79 bank; they are not a new collection API
([NPU fit model](NPU-FIT-MODEL.md#6-acceptance-reproduce-the-bank-then-trust-the-model):428–456).

| fixture | expected verdict |
|---|---|
| `{Q4_0,Q4_1,Q8_0,MXFP4,IQ4_NL}` × `(m=16,n=5..9,k=256)` | `HVX`, fit |
| `{Q4_0,Q4_1,Q8_0,MXFP4}` × `(m=16,n=16,k=256)` | `HVX`, fit |
| `{Q4_0,Q4_1,Q8_0,MXFP4,IQ4_NL}` × `(m=1,n=64,k=256)` | `HVX`, fit |
| `Q4_0 (m=1,n=2048,k=8192)` | `NS`; HVX VTCM exceeds 8 MiB |
| `Q8_0 (m=6,n=4096,k=5120)` | `NS`; HVX VTCM exceeds 8 MiB |
| `Q4_0 (m=576,n=512,k=576)` | `HMX`, fit |

The model gate is still: complete shape census, memory/KV admission, bank
reproduction, then the exact model+quant PPL certificate. Only then may an ON
ledger lane be selected.

## 7. Non-goals and S23 gates

v0.2 does not add autotuning, online benchmarking, a scheduler replacement, a
plugin runtime, energy-based routing, NPU decode, partial GPU offload, or
cross-generation transfer of a measured table ([design study](GOVERNOR-TRI-ENGINE-DESIGN.md#6-non-goals-v2):438–442).

The governor reads the certification ledger and never writes it. A future lane
flip requires its dedicated cell, the ledger change, and `npu_fit`; no current
NPU run is authorized ([design study](GOVERNOR-TRI-ENGINE-DESIGN.md#3-composition-with-router-v03-spec-v02-rules-retained):333–336;
[design study](GOVERNOR-TRI-ENGINE-DESIGN.md#4-unknowns--measurement-cells--1-hdevice-unless-noted):401–402).

S23-gated work feeds later table revisions only:

- Phase 3 can change KEXP GPU constants only after its profiled kernel gate and
  pp512 cell gate both pass ([PLAN §5](PLAN-10DAYS-2026-08-28.md#5-phase-3--optimise-the-prefill-path-of-our-q2_kq3_k-moe-kernels-days-4-7):214–227).
- Phase 4(a) supplies the product prompt-length crossover; 4(b) re-measures
  cool-mode cost; 4(c)/(d) supply only the remaining S23 cache, lineup, and
  fit-constant work ([PLAN §6](PLAN-10DAYS-2026-08-28.md#6-phase-4--product-cells-for-the-router-days-8-10--5-h-device-total--audit-reduced):229–241).
- G1/G3 must replace the interim CPU-throttle/GPU-slope unknowns before the
  break-even rule is claimed as measured. G5 remains post-window and
  unplugged-only; it cannot turn on an NPU lane during the current plugged S23
  window.
