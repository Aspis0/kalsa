# RECON — why the governor prefilled turns 1–2 on CPU (Xiaomi 14, SM8650, Adreno 750)

Read-only investigation. No code, test, or device change was made; no device was contacted. Every
claim below carries a `file:line` quote or a raw-artefact line number. Where the evidence runs out,
the claim is labelled unverified rather than smoothed.

## 0. Identity of the artefacts examined

| item | value | source |
|---|---|---|
| engine source | `9875acabef87af4eeeb17dc5577c352d26d3aa0d` ("governor : trim_sequence refuses once failed") | `cd /Users/marco/Projects/kalsallama-wt-oom && git log -1` |
| binding source | `3b203c6819770b0faadadc4445d7db2e231c427a` | `~/Projects/llama.rn-kalsa`, `git log -1` |
| binding engine pin | `LLAMA_CPP_REF=9875acabef87af4eeeb17dc5577c352d26d3aa0d` | `~/Projects/llama.rn-kalsa/vendor/VERSIONS` |
| app commit → binding pin | `57eca607…` → `"llama.rn": "github:Aspis0/kalsa.rn#3b203c68…"` | `cd ~/Projects/kalsa && git show 57eca607:package.json` |
| session evidence | `scratchpad/agents/xiaomi-governor-night/` (X2, 20 turns, one chat, charging) | `REPORT.md:43-123` |

The APK that produced the X2 JSON ran binding `3b203c68`, which pins engine `9875acabe`. The source
under examination is therefore the source that produced the evidence, not a later revision.

Relevant history: the prefill route was made to follow the requested engine by
`2b1ee43ab7149fab46e6dd648105d01cc319943e` ("governor : route prefill by the requested engine
(defect 5.3)", 2026-09-21), whose diff is `- prefill_route_ = prefill_route::GPU;` →
`+ prefill_route_ = requested == llama_governor_engine::CPU ? prefill_route::CPU : prefill_route::GPU;`.
That commit predates the pin, so defect 5.3 as described in `analysis/GOVERNOR-DEVICE-PLAN.md:343-346`
(and `scratchpad/agents/governor-audit/REPORT.md:25, 92-101`) is **fixed at this pin**. Consequence
for this RECON: `"engine_prefill":"CPU"` in the X2 JSON means the batch really ran on the CPU context.
The fix is what turned the floor from a cosmetic telemetry bug into a real routing cost.

## 1. The exact rule that routed turns 1 and 2 to CPU

It is a **battery-percentage floor**, not a token threshold and not a warm-up state.

`src/llama-governor-policy.cpp:158-163`:

```cpp
llama_governor_engine llama_governor_policy::prefill_engine() const {
    if (!valid_schema(params_) || !profile_valid_ || !have_profile_ ||
        state_ == llama_governor_thermal_state::CRITICAL || state_ == llama_governor_thermal_state::Invalid ||
        state_ == llama_governor_thermal_state::LOWBAT || profile_.batt_level_pct < 45) {
        return llama_governor_engine::CPU;
    }
```

The Xiaomi 14 satisfies the GPU branch that follows, `src/llama-governor-policy.cpp:171-176`:

```cpp
    if ((params_.generation == llama_governor_generation::V73 ||
         params_.generation == llama_governor_generation::V75 ||
         params_.generation == llama_governor_generation::V79) &&
        params_.gpu_fit == llama_governor_fit::Fit && params_.gpu_prefill_measured) {
        return llama_governor_engine::GPU;
    }
```

with `SM8650 → V75` (`~/Projects/kalsa/src/engine/governorInputs.ts:49, 52`:
`if (/(SM8650|PINEAPPLE)/.test(soc)) return "V75";`) and
`gpu_prefill_measured: generation === "V73" || generation === "V75" || generation === "V79"`
(`governorInputs.ts:96-97`).

### Per-turn JSON field match

The floor is the only input that differs between turns 1–2 and turns 3–20. Every other input of
`prefill_engine()` is pinned by a JSON field that was identical on all 20 turns.

| `prefill_engine()` input | clause | JSON field | value on all 20 turns | verdict |
|---|---|---|---|---|
| `valid_schema(params_)` | `:159` | none (load-time) | constant per load; `fit:"Fit"` and `forced:false` prove the params were accepted and the bench force was off | passes |
| `profile_valid_`, `have_profile_` | `:159` | `thermal_state` | `"FAST"` on turns 1–20 | passes |
| `state_ == CRITICAL / Invalid` | `:160` | `thermal_state` | never `"Invalid"`/`"CRITICAL"` in 20 turns | not triggered |
| `state_ == LOWBAT` (`batt_level_pct < 25`, `policy.cpp:128`) | `:161` | battery dumps | 36–48 % throughout | not triggered |
| `profile_.batt_level_pct < 45` | `:161` | **absent from the JSON** | turns 1–2: 37 / 40 %; turns 3–20: 45–48 % | **bound** |
| `bench_force_gpu_prefill` | `:164` | `forced` | `false` ×20 | not triggered |
| `generation`, `gpu_fit`, `gpu_prefill_measured` | `:171-174` | `fit` | `"Fit"` ×20 | passes |
| `cool_prefill_eligible`, `hot_plugged_` (V73+MoE only) | `:177-178` | — | generation is V75 | not reachable |

The per-turn battery reads (side evidence, because the field is not in the JSON) cross the floor
exactly between turn 2 and turn 3:

```
raw/x2-functional-turn01-summary.txt:5    NUMBERS={'level': 37, 'temp': 329, 'status': 0, 'low': '0', 'miui': '0'}
raw/x2-functional-turn02-summary.txt:5    NUMBERS={'level': 40, 'temp': 341, 'status': 0, 'low': '0', 'miui': '0'}
raw/x2-functional-turn03-summary.txt:5    NUMBERS={'level': 45, 'temp': 346, 'status': 0, 'low': '0', 'miui': '0'}
raw/x2-functional-turn04-summary.txt:5    NUMBERS={'level': 46, 'temp': 352, 'status': 0, 'low': '0', 'miui': '0'}
```

40 < 45 ≤ 45. The gate is `< 45`, so 45 passes. That single unit step is the whole difference.

### The JSON fields that look like the cause and are not

- `prefill_ctx_ngl: 99` appears on the CPU turns too. It is a static value, not a route fact:
  `stats_.prefill_ctx_ngl = ctx_prefill->get_model().n_gpu_layers();`
  (`src/llama-governor.cpp:59`) reads the prefill context's offload setting, which is 99 regardless
  of which context the batch is sent to. It cannot discriminate.
- `thermo_source: "battery"` means the native battery path was read, i.e. the profile came from
  `GovernorBattery.readThermo` (`governorInputs.ts:150, 162-165`), so the level used by the policy was
  the real battery level. It says nothing about the route.
- `profile_valid` is proven true by the state field, not assumed: an invalid profile sets the state
  to `Invalid` in `update_thermal`, `src/llama-governor-policy.cpp:104-107`
  (`profile_valid_ = false; have_profile_ = true; state_ = llama_governor_thermal_state::Invalid;`).
  The JSON says `FAST` in all 20 turns, so the profile was valid, hence the `!profile_valid_`
  clause in `:159` never fired.
- No token threshold exists in the routing path at all. The token table (`policy.cpp:14`,
  `k_table_tokens[] = { 128, 512, 1024, 2048 }`) is used only by `admit_prefill` to *size chunks*
  (`policy.cpp:205-232`); it cannot return CPU. Turn 1 (18 tokens) and turn 4 (21 tokens) take the
  identical `table == 0` branch (`policy.cpp:212-222`) and were routed to opposite engines.
- No warm-up or lazy-compile input exists. The policy's entire persistent state is
  `llama-governor-policy.h:60-72` (`params_`, `profile_`, `state_`, `state_since_ms_`,
  `last_gpu_engagement_ms_`, `cpu_to_gpu_engagements_`, `profile_valid_`, `have_profile_`,
  `hot_plugged_`, `cache_budget_warning_`, `t_idle_reference_c_`, `have_t_idle_reference_`,
  `last_decode_engine_`). No member records a compile or warm-up condition, and `prefill_engine()`
  consults none of the timing members. Corroboration from the evidence: turn 3 was the first GPU
  execution after the 05:54:03 model load and its governed prefill ran at the same marginal cost as
  the later GPU turns (fit in §3), so no compile penalty is visible on the first GPU turn either.

### The two JSON fields that corroborate the CPU route

`prefill_chunks` takes the `cpu:` prefix only on a CPU route — `src/llama-governor.cpp:161`:

```cpp
            const char * separator = used == 0 ? (prefill_route_ == prefill_route::CPU ? "cpu:" : "") : "+";
```

Turn 1 `"cpu:18"`, turn 2 `"cpu:128+128+58"`, turn 3 `"128+128+126"`, turns 4–20 no prefix. And the
KV commit is skipped on the CPU route, `src/llama-governor.cpp:271-273`:

```cpp
    const bool cpu_route_handoff = prefill_route_ == prefill_route::CPU &&
        (is_prefill || last_phase == phase::Prefill);
    if (last_phase != phase::None && last_phase != next_phase && !cpu_route_handoff) {
```

which is why turns 1–2 report `"commit_bytes":0,"commit_ms":0` and every GPU turn reports 15.1–33.9 MB
(`raw/x2-functional-governor-lines.txt`, turns 3–20). Both facts are consistent with prefill *and*
decode running on the same context on turns 1–2, as §4 traces in the code.

The chunk shapes also match the policy's table arithmetic exactly. Turn 2, 314 tokens
(`policy.cpp:205-222`): `table=1` → row 128 → `Chunk`; remaining 186 → row 128 → `Chunk`; remaining
58 → `table==0`, `58 < 128` and `36.2 + 1.9 = 38.1 ≤ 39.5` (`k_cpu_delta_c[0]=1.9`, `k_limit_c=39.5`,
`policy.cpp:11,15`) → `Admit`, tokens = 58. Hence `128+128+58`. The temperature ceiling never bound
(turns 1–20 ranged 32.9–36.6 °C battery temperature, max at turn 20
`raw/x2-functional-turn20-summary.txt:5`, `'temp': 366`), so temperature did not enter the routing.

## 2. Why turns 4–20 (≈20 tokens) went to GPU when turn 1 (18 tokens) went to CPU

Not hysteresis and not sticky state on the prefill path. The battery crossed 45 %, and the prefill
rule is a stateless read of the live profile.

- `prefill_engine()` is a `const` function of `params_`, `profile_`, `state_`, `hot_plugged_`
  (`policy.cpp:158-182`) with no memory of the previous route.
- The only hysteresis constants in the policy are `k_dwell_ms = 10 * 60 * 1000` and
  `k_flip_window_ms = 60 * 60 * 1000` (`policy.cpp:8-9`). They are consumed only by
  `dwell_elapsed` for thermal-state exits (`policy.cpp:84`, used at `:124-126`, `:137-139`, `:150`)
  and by `select_decode`'s engagement budget (`policy.cpp:244-247`:
  `now_ms - last_gpu_engagement_ms_ >= k_flip_window_ms`). Neither is on the prefill path, and
  neither is a function of battery level.
- Across turns the route is explicitly re-decided: `src/llama-governor.cpp:246-249`

```cpp
    const bool is_prefill = batch.n_tokens > 1;
    if (is_prefill && allow_chunking && last_phase != phase::Prefill) {
        prefill_route_ = prefill_route::Undecided;
    }
```

  and in this session the governor object itself was recreated for the first three turns: the engine
  loaded three times (`raw/x2-functional-logcat.txt:242412` 05:35:16.250, `:341491` 05:43:58.160,
  `:401987` 05:54:07.388, `CPU_Mapped model buffer size =  1512.20 MiB`, the decode/CPU model) and
  the prefix prewarm ran three times (`:242873`, `:341843`, `:402426`, all
  `'{"op":"start","hash":"3586270056",…}'`). Turns 4–20 reused the engine loaded at 05:54:03.
- Within a turn the route *is* deliberately sticky, which is why all three of turn 2's chunks went
  to the CPU context: `src/llama-governor-runtime.cpp:40-43`

```cpp
int32_t llama_governor::admit_prefill(llama_batch batch, bool allow_chunking) {
    if (prefill_route_ == prefill_route::CPU) {
        return 0;
    }
```

  and the design comment at `src/llama-governor.h:59-60`:
  `// A turn chooses one prefill context at its first multi-token batch;` /
  `// later batches cannot switch between CPU and GPU.`

So the answer to "18 tokens CPU, 21 tokens GPU" is that neither number was consulted. Turn 1 read
37 %, turn 4 read 46 %. If the routing were a token threshold, turn 1 (18) and turn 4 (21) would
have shared a route; they do not.

## 3. Is a 20-token GPU prefill at ~415 ms plausibly slower than CPU at that size?

No. Fitted from the session's own governed turns, the CPU path is ~4× more expensive per token and
the ~415 ms is dominated by per-call fixed cost, not by the 20 tokens.

Observed (all charging — indicative only, quoted with the `charging — not a measurement` labels the
session attached):

```
turn 1  CPU  18 tok   689.507 ms   raw/x2-functional-turn01-summary.txt:20
turn 2  CPU 314 tok  9357.102 ms   raw/x2-functional-turn02-summary.txt:17
turn 3  GPU 382 tok  3142.116 ms   raw/x2-functional-turn03-summary.txt:14
turn 4  GPU  21 tok   408.610 ms   raw/x2-functional-turn04-summary.txt:13
turns 5-20 GPU 19-21 tok, 408.6-435.5 ms   raw/x2-functional-governor-lines.txt
```

Straight-line fits over those points:

- CPU (turn 1 one chunk, turn 2 three chunks): `162.5 ms + 29.28 ms/token`.
- GPU (turn 4 one chunk, turn 3 three chunks): `249.6 ms + 7.57 ms/token`.
- crossover ≈ 4 tokens: `162.5 + 29.28n = 249.6 + 7.57n` → `n ≈ 4.0`.

At 20 tokens the fits predict 748 ms on CPU against 401 ms on GPU (observed 408.6–435.5 ms). The
202 ms–250 ms intercept has a candidate mechanism in the load banner
(`raw/x2-functional-logcat.txt:242543`): `ggml_opencl: Adreno xmem F16xF32 GEMM enabled (temporary
weight prepack)`, i.e. a per-graph weight prepack. That mechanism is labelled a hypothesis; it was
not measured here, and the intercept is not separable from a per-chunk constant with two points per
engine. The marginal rates are the parts that repeat at a second prompt size, so they carry the
argument.

Independent cross-check at 1826 tokens, same prompt hash `3586270056`, same `promptN: 1826`:

```
05:36:01.536 'KALSA_PREWARM','{"op":"done","promptMs":44981.167,"promptN":1826,"hash":"3586270056"}'   raw/x2-functional-logcat.txt:252398
05:44:42.639 'KALSA_PREWARM','{"op":"done","promptMs":44230.737,"promptN":1826,"hash":"3586270056"}'   raw/x2-functional-logcat.txt:349245
05:54:21.514 'KALSA_PREWARM','{"op":"done","promptMs":13915.96,"promptN":1826,"hash":"3586270056"}'    raw/x2-functional-logcat.txt:405534
```

24.62 and 24.22 ms/token on the two sub-45 % prewarms versus 7.62 ms/token on the 45 % prewarm:
3.23× and 3.18×, on an identical prompt. The GPU figure agrees with §3's GPU marginal (7.57) to
0.7 %, and the CPU figure is 16 % below §3's CPU marginal because the table gives a 1826-token
prefill larger rows (1024+512+128+128+34) than a 314-token turn. These prewarms carry no
`KALSA_GOVERNOR` line of their own (the marker is emitted per chat turn only, 20 lines in 20 turns),
so this leg is *inferred* to have been routed by the same `prefill_engine()` call; the ratio match
is the support, and the falsifier is a battery sweep of the prewarm leg.

Prior Adreno 750 / 8 Gen 3 / QRD8650 constants agree on the direction and the size of the gap:

- `scratchpad/agents/qdc-8g3-govbench-55/REPORT.md:47-52`, ship model LFM2.5-2.6B QAD-Q4_0 (the
  same GGUF family as X2), `-fa 0`, QRD8650: `GPU full offload -ngl 99 → pp512 284.18 ± 0.07`,
  `CPU pure -dev none -ngl 0 → pp512 16.26 ± 0.20`, described as "GPU prefill 284 t/s
  (1.87× the 732's 151.8, ~17× this build's CPU)".
- `scratchpad/agents/qdc-8g3-rerun-58/REPORT.md:46-49`: `pp512 284–291 t/s (two sessions)` and
  `G4 (informative): 291.11 / 98.97 (tuned CPU, #57) = 2.94×`.
- `scratchpad/agents/qdc-cpu-tuned-57/REPORT.md:28`: `8 Gen 3 (8650) tuned pp512 98.97 ± 12.78`.
- ALIVE `#38` (Adreno 830, not the 750) in-code at `policy.cpp:167-168`: `G ttft 1434/1470 ms vs
  C 16476/14412 ms (>=9.8x)`.
- The app's own comment carries the 750 pair: `~/Projects/kalsa/src/engine/governorInputs.ts:88`
  `// measured: ALIVE #55 ~17x; #58 2.94x (Adreno 750); #38 >=9.8x (Adreno 830).`

The X2 GPU marginal (7.57 ms/token ≈ 132 t/s) sits below the kit's 284–291 t/s because the app
prefills in 128-token table rows, not pp512 batches, and runs with `flash_attn = enabled`
(`raw/x2-functional-logcat.txt:242514`) rather than the kit's `-fa 0`. The X2 CPU marginal
(24.6–29.3 ms/token ≈ 34–41 t/s) sits between the kit's untuned 16.26 t/s and tuned 98.97 t/s, and
two non-governor facts push it down there: this unit's CPU caps measured `cpu0-1 2035200`,
`cpu2-6 2188800`, `cpu7 1824000` kHz (`raw/03-frequencies.txt`, read during setup at 00:04, not
per turn) against the QRD8650's `cpu0-1 @2.2656, cpu2-6 @2.9568, cpu7 @3.1872 GHz`
(`qdc-8g3-govbench-55/REPORT.md:15-17`), and the app's exact-SoC preset asks for 6 threads
(`~/Projects/kalsa/src/engine/deviceTuning.ts:226-233`: `id: "sd-8-gen3", decodeThreads: 6,
prefillThreads: 6`) where the tuned kit arm pinned 4 big cores (`#55` materials: `CPU_MASK f0
(cpu4-7)`). Neither fact is verified for the X2 turns themselves (§6).

**Verdict on §3.** The 45 % floor cost nothing in speed at 19–21 tokens; the GPU was still ~1.8×
faster there. What the floor cost was the 314-token turn and the 1826-token prewarm legs.

## 4. Is turn 2's 9.4 s CPU prefill for 314 tokens a defect?

The 9.4 s is not a kernel anomaly — it is the same CPU rate as turn 1 and the prewarm, i.e. the
steady-state cost of the chosen path. Turn 1's 689.5 ms at 18 tokens and turn 2's 9357.1 ms at 314
tokens lie on one line (§3), so turn 2 contains no second, separate pathology. The defect is the
routing decision that selected that path at 40 % while plugged, plus the fact that the resulting
per-token cost is 3–4× the GPU's.

Governor-induced causes checked, and their status:

1. **`ubatch` — excluded.** Both contexts were created with `n_batch = 512, n_ubatch = 256`
   (`raw/x2-functional-logcat.txt:242511-242512` and `:242682-242683` for the 05:35:16 load;
   `:341588-341589`, `:341716-341717` for 05:43:58; `:402087-402088`, `:402222-402223` for
   05:54:07). Every governor chunk on turns 1–2 (18, 128, 128, 58) is below 256, so each chunk is
   one ubatch and no chunking-induced graph fragmentation occurred. `record_side` computes
   `side.ubatches_submitted += (n_tokens + n_ubatch - 1) / n_ubatch` from exactly that field
   (`src/llama-governor.cpp:148-149`).
2. **Thread count and cpuset — not touched by the governor, not observable this session.** The
   engine's governor sources contain no affinity or thread control: `grep -rn
   "affinity\|sched_set\|cpuset\|taskset\|threadpool" src/llama-governor*.{cpp,h}` returns nothing
   (0 hits in `llama-governor-policy.cpp`, `llama-governor-runtime.cpp`, `llama-governor.cpp`). The
   only thread input is the app's, passed through `common_params` to both models
   (`~/Projects/llama.rn-kalsa/cpp/rn-llama.cpp:75-78`). The X2 capture has no `n_threads` or
   threadpool-attach line (`grep -n "n_threads\|threadpool"` over
   `raw/x2-functional-logcat.txt` returns only `:94099 … detach_threadpool: call`, before the
   loads), so the thread count actually used by the CPU prefill on turns 1–2 is **unverified**; the
   sd-8-gen3 preset value of 6 is the app's intent, not a measurement.
3. **The decode-model-only path — present, by design, and the reason the CPU route has no GPU
   offload at all.** `src/llama-governor.cpp:259-261`:

```cpp
    const bool cpu_prefill = is_prefill && prefill_route_ == prefill_route::CPU;
    llama_context * target = cpu_prefill ? ctx_decode : (is_prefill ? ctx_prefill : ctx_decode);
    side_state * state = cpu_prefill ? &decode_state : (is_prefill ? &prefill_state : &decode_state);
```

   `ctx_decode` was built from the CPU model, `~/Projects/llama.rn-kalsa/cpp/rn-llama.cpp:75-78`:

```cpp
common_params prefill_params = owner.params;
common_params decode_params = owner.params;
prefill_params.n_gpu_layers = 99;
decode_params.n_gpu_layers = 0;
```

   and the load log shows that second full copy on the CPU:
   `raw/x2-functional-logcat.txt:242412` `CPU_Mapped model buffer size =  1512.20 MiB` (the decode
   model, the full 1,593,894,944-byte GGUF) beside `:239642-239643` `CPU_Mapped 205.08 MiB` +
   `OpenCL model buffer size =  1307.20 MiB` (the prefill model). So turn 2's 9.4 s is pure CPU
   work on a full-weight CPU copy, not a GPU-bound path with a CPU label.
   Two consequences follow from the same design: the KV commit is skipped
   (`llama-governor.cpp:271-273`, hence `commit_bytes: 0`), and the CPU rate has no fallback to
   partially offloaded weights.
4. **`CPUFallback` never moves a chunk to CPU — the decision name is dead as a routing signal.**
   The engine is chosen from `requested`, not from the decision:
   `src/llama-governor-runtime.cpp:59-63`

```cpp
    if (prefill_route_ == prefill_route::Undecided) {
        prefill_route_ = requested == llama_governor_engine::CPU ? prefill_route::CPU : prefill_route::GPU;
        stats_.prefill_engine = requested;
    }
    if (admission.decision == llama_governor_decision::CPUFallback) {
```

   Turn 3's last chunk shows the label in action: a 126-token remainder takes the `table == 0` path
   with `requested == GPU` and is set to `CPUFallback` (`policy.cpp:217-218`), yet the runtime
   returns 0 at `:63-65` and the chunk runs on `ctx_prefill`. So "CPUFallback" produced a GPU chunk
   — correct in engine terms, but a reader comparing the decision enum with telemetry cannot tell
   what ran. This is a naming/contract mismatch, not the cause of turn 2.

What explains the remaining ~2.4–2.9× gap between the X2 CPU rate (24.6–29.3 ms/token) and the tuned
QRD8650 constant (98.97 t/s = 10.1 ms/token, `qdc-cpu-tuned-57/REPORT.md:28`) is not established
here. Candidates are the unit's capped clocks and the difference between 128/1024-token table rows
and pp512 (`raw/03-frequencies.txt`, `policy.cpp:14`), plus charging. None of them is
governor-induced, and none changes the conclusion: at 314 tokens the GPU path was worth ≈3.6× on
the routing decision alone (9357.1 ms observed on CPU against 2627 ms predicted for 314 tokens from
the §3 GPU fit).

### The cost the per-turn JSON does not show

Because the engine unloads during the long gaps, turns 1–3 each paid a prefix prewarm on top of the
turn: 44.98 s + 44.23 s of CPU prefill for the two sub-45 % loads against 13.92 s for the 45 % load
(§3 quotes). Summed for the session, the floor's price was ≈10.0 s (the two turn prefills) plus
≈89.2 s (the two prewarm legs) ≈ 99 s of CPU prefill that the GPU route did in ≈17 s. Reporting the
floor as a "turn-level" policy understates it, because the largest prefill in the session was the
prewarm, not the prompt.

## 5. Side findings from the same lines

- **The floor is duplicated.** `batt_level_pct < 45` at `policy.cpp:161` and `batt_level_pct >= 45`
  at `policy.cpp:247` (`const bool eligible = valid_schema(params_) && … && profile_.batt_level_pct >= 45 &&`).
  The second is one of the thirteen clauses that make `select_decode`'s GPU lane unreachable on
  V75/V79 (`params_.generation == llama_governor_generation::V73` at `policy.cpp:249`);
  `analysis/GOVERNOR-DEVICE-PLAN.md:590-594` records that lane as unreachable. Changing the prefill
  floor without deciding what the decode floor means would leave the two clauses in disagreement.
- **The routing input is the only one absent from telemetry.** `KALSA_GOVERNOR`
  (`~/Projects/kalsa/src/engine/LlamaService.ts:1764-1782`) emits fourteen fields, none of which is
  `batt_level_pct`, `plugged`, or `t_idle_c`. The diagnosis in this RECON required the per-turn
  battery dumps (`x2-functional-turnNN-summary.txt:5`) because the deciding value is not in the
  governor line. `governorInputs.ts:122` also defaults a missing level to `100`
  (`const level = numberValue(input.batt_level_pct ?? input.battLevelPct, 100);`), which is above
  the floor — a failed battery read opens the GPU route rather than closing it.
- **`-2` on a 1-token remainder (adjacent, not part of the asked answer).**
  `src/llama-governor-runtime.cpp:89-92`:

```cpp
        const int32_t count = std::min<int32_t>(next.tokens, remaining);
        if (count <= 1) {
            return -2;
        }
```

  For a prompt of `128k + 1` tokens (129, 257, 385, 513 …) the table walk leaves a 1-token
  remainder and this returns `-2`. The X2 prompts (18, 314, 382, 19–21) are all off that lattice,
  so this session neither exercises nor refutes it. The binding treats `-2` as non-fatal
  (`~/Projects/llama.rn-kalsa/cpp/rn-governor.h:16-18`:
  `return rc != 0 && (rc != -2 || engine_failed);`), so the user-visible outcome is not established
  here; `analysis/GOVERNOR-DEVICE-PLAN.md:597-600` predicts a truncated answer. One 129-token
  prompt on this phone, with the logcat kept, settles it.

## 6. Unverified, and what would falsify the main claim

Unverified in this RECON: the thread count and affinity actually used by the CPU prefill on turns
1–2 (no `n_threads` line in the capture); whether the `sd-8-gen3` preset matched this unit's
capacity signature (not captured); the energy cost of either route (X2 ran charging; the X3/Meter
speed-energy A/B is deferred — `xiaomi-governor-night/REPORT.md`, "X3 and other deferred work");
whether the prewarm legs were governed (inferred
from the ratio, no per-prewarm `KALSA_GOVERNOR` line exists).

Falsifiers for §1–§2: a governed turn with `batt_level_pct >= 45`, `fit:"Fit"`,
`thermal_state:"FAST"`, `forced:false`, and `engine_prefill:"CPU"` would show another binding clause
that this reading missed. A battery sweep holding the prompt fixed (a 314-token prompt at 40 % and
at 46 %) would settle it directly and is cheap: two turns, no new build.

## 7. Is the policy wrong, and what to change

Yes, as written, for a specific and narrow reason: the floor is a *battery-budget* rule that ignores
`profile_.plugged`, and on AC there is no battery budget to protect. The session's own numbers put
its cost at ≈3.2–3.9× on the turns it changed (3.87× per token on the §3 marginal fits, 3.2× on the
identical 1826-token prewarm pair), on a phone whose charge was rising throughout
(37 → 48 %). The floor also has no stated rationale in the source (contrast the measured comment at
`policy.cpp:167-168`), and its consumer is invisible in telemetry.

Concrete proposal, smallest first:

1. **Exempt the plugged case at the floor.** At `src/llama-governor-policy.cpp:161`, change
   `profile_.batt_level_pct < 45` to `(profile_.batt_level_pct < 45 && !profile_.plugged)`.
   Temperature safety is unaffected: the thermal walk at `policy.cpp:205-211`
   (`while (table > 0 && now_c + k_cpu_delta_c[table - 1] > k_limit_c)`) still sizes every chunk
   under `k_limit_c = 39.5 °C`, and `plugged` already has its own threshold family
   (`policy.cpp:42-50`). Expected effect on the X2 session: turns 1–2 and both prewarms move to the
   GPU route, ≈99 s → ≈17 s. Same one-clause question applies to `policy.cpp:247`; decide it
   separately, in writing, because that lane is already unreachable on V75/V79.
2. **Put the routing inputs in the marker.** Add `batt_level_pct`, `plugged`, and `t_idle_c` to the
   `KALSA_GOVERNOR` object (`~/Projects/kalsa/src/engine/LlamaService.ts:1764-1782`). Four of this
   RECON's confirmations needed side dumps that a single field would have replaced, and the X2
   report had to reconstruct the level from `x2-functional-turnNN-summary.txt:5`.
3. **Resolve the `CPUFallback` name** at `policy.cpp:217-218` versus `runtime.cpp:59-65`: either
   make the decision able to change the chunk's target engine, or rename it (for example
   `ShortChunk`) so telemetry and the enum cannot be read as promising a CPU fallback that the
   runtime never performs.
4. **Do not widen the change before the meter run.** The claim that GPU prefill is also the
   *lower-energy* path at 314 tokens and at 1826 tokens is not measured here; the deferred X3/Meter
   experiment is the instrument for it. Step 1 is defensible without that measurement because
   "plugged" removes the battery-budget premise the floor is named for; any change below 45 % on
   battery should wait for the measurement.

## 8. Evidence index

| claim | location |
|---|---|
| floor clause | `src/llama-governor-policy.cpp:158-163` |
| V75 GPU branch | `src/llama-governor-policy.cpp:171-176` |
| `valid_schema` | `src/llama-governor-policy.cpp:17-21` |
| LOWBAT at <25 % | `src/llama-governor-policy.cpp:128-133` |
| table and deltas | `src/llama-governor-policy.cpp:10-15` |
| chunk sizing | `src/llama-governor-policy.cpp:205-232` |
| hysteresis constants, decode budget | `src/llama-governor-policy.cpp:8-9, 244-247` |
| duplicate floor in `select_decode` | `src/llama-governor-policy.cpp:247-249` |
| policy persistent state (no warm-up field) | `src/llama-governor-policy.h:60-72` |
| route sticky within a turn | `src/llama-governor-runtime.cpp:40-43`, `src/llama-governor.h:59-61` |
| route = requested engine (defect 5.3 fix) | `src/llama-governor-runtime.cpp:59-63`, commit `2b1ee43ab` |
| chunk loop, 1-token remainder | `src/llama-governor-runtime.cpp:75-95` |
| route reset per turn / phase | `src/llama-governor.cpp:246-249` |
| CPU route targets `ctx_decode` | `src/llama-governor.cpp:259-261` |
| KV commit skipped on CPU route | `src/llama-governor.cpp:271-273` |
| `prefill_us` times only `llama_decode` | `src/llama-governor.cpp:285, 300` |
| `cpu:` chunk prefix | `src/llama-governor.cpp:158-163` |
| `prefill_ctx_ngl` is static | `src/llama-governor.cpp:59` |
| two models, CPU decode model | `~/Projects/llama.rn-kalsa/cpp/rn-llama.cpp:75-78` |
| binding `-2` handling | `~/Projects/llama.rn-kalsa/cpp/rn-governor.h:16-18` |
| `SM8650 → V75`, `gpu_prefill_measured` | `~/Projects/kalsa/src/engine/governorInputs.ts:49, 52, 96-97` |
| battery default 100 | `~/Projects/kalsa/src/engine/governorInputs.ts:122` |
| marker fields | `~/Projects/kalsa/src/engine/LlamaService.ts:1764-1782` |
| sd-8-gen3 preset 6/6 | `~/Projects/kalsa/src/engine/deviceTuning.ts:226-233` |
| per-turn JSON, 20 turns | `raw/x2-functional-governor-lines.txt` |
| per-turn battery levels | `raw/x2-functional-turn01..04-summary.txt:5` |
| engine loads ×3, `n_batch`/`n_ubatch` | `raw/x2-functional-logcat.txt:239642-239643, 242412, 242511-242512, 341491, 341588-341589, 401987, 402087-402088` |
| prewarm promptMs, same hash/length | `raw/x2-functional-logcat.txt:252398, 349245, 405534` |
| OpenCL banner, flash_attn, prepack | `raw/x2-functional-logcat.txt:242514, 242543` |
| 750 GPU/CPU prefill constants | `scratchpad/agents/qdc-8g3-govbench-55/REPORT.md:15-17, 47-52`; `qdc-8g3-rerun-58/REPORT.md:46-49`; `qdc-cpu-tuned-57/REPORT.md:28` |
| defect 5.3 history | `analysis/GOVERNOR-DEVICE-PLAN.md:343-346, 586-593`; `scratchpad/agents/governor-audit/REPORT.md:25, 92-105` |

No commit, push, or device access was made in this session.
