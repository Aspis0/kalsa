# QDC SM8850 (Snapdragon 8 Elite Gen 5, Hexagon v81, Adreno 840) — "every Snapdragon" step 4 (2026-10-03)

APK: CI run 37135421002, app main ac04c939 (binding e3ee58d7, engine 0917c693), debuggable (`pkgFlags=[ DEBUGGABLE HAS_CODE ALLOW_CLEAR_USER_DATA ]`,
raw/sm8850/pkg.txt), sha256 `9976d6de…2169f0` verified after `gh run download`. Installed with `adb install -r -d`, never uninstalled, data never cleared.
Model LFM2.5-2.6B-QAD-Q4_0 sha `a247afd6…0b03` verified on device. QDC session 864730 (aspis account), SSH-only, tunnel on 6037 only. Board serial 783ee7e5, Android 16.

## Verdicts

**Part A — NPU lane by default on SM8850: PASS** (3/3 ON turns; the OFF control is VOID, see below).
- Defaults armed and read back: `kalsa.governor.enabled` ABSENT, `kalsa.bench.npu_lane` ABSENT (raw/sm8850/arm-defaults.txt); battery unplugged.
- Every ON turn: `KALSA_GOVERNOR_PLAN` `npu_lane:"auto"`, `npu_fit:"Fit"`, `npu_device:"HTP0"`; `KALSA_GOVERNOR` `engine_prefill:"NPU"`, `engine_decode:"CPU"`,
  every route chunk `HTP0` (17 / 5 / 21 chunks, `layers_counts` = HTP0 only), `failed:false`, 0 `KALSA_GOVERNOR_FALLBACK`, 0 crash markers (`*-crash.txt` empty), answers correct and on topic.
- `thermal_state` was `COOLMODE` on all three (battery stub reads 42.0 C, unplugged) and the NPU lane still ran.

**Part B — GPU prefill on Adreno 840 under the logit oracle (TF mode): FAIL R2** on both comparable pairs. R1 (confident top-1 disagreement) never fired: all 32 forced steps have B top-1 == A top-1 in every pair.
- Pair 2 (valid): `oracle=FAIL rule=R2 steps=32 max_dlogp=0.6160 max_dp1=0.0460`; first violation step 2 (`margin=0.129 dp1=0.021`), step 3 `dp1=0.046`, step 9.
- Pair 3 (valid): `oracle=FAIL rule=R2 steps=32 max_dlogp=0.4662 max_dp1=0.0194`; R2 at steps 5, 6, 16, 17 (A's top-5 token with pA>=0.02 missing or |dlogp|>0.10; step 6 margin 0.231, dlogp 0.352).
- Pair 1 is NOT comparable (see odd #2); its raw verdict was also FAIL R2 (steps 2,3,5,6,9,10,11).
- R4 coverage met (32 comparable steps on 2 valid pairs). R5 is still unmet in the registry (no GPU PASS control exists), so this is a FAIL verdict on a not-yet-validated oracle. **R6: nothing enabled; the owner decides.**
- Consequence for the product: with `GPU_PREFILL_CORRECT` for V81 unqualified, this run gives no reason to qualify it. NPU lane is the route on this board.

## Part A numbers (first-round `KALSA_TELEMETRY`, prefill = prompt_n/(promptMs/1000))

| turn | prompt | prompt_n | n_common | prefill tok/s | decode tok/s | tokens out | route | skin start→peak | answer |
|---|---|---:|---:|---:|---:|---:|---|---|---|
| on-short-1 | short | 1964 | 0 | **1337.3** | 27.9 | 475 | NPU, 17x HTP0 | 31.2→39.2 | 3 sentences |
| on-short-2 | short | 628 | 1889 | **1334.0** | 25.4 | 564 | NPU, 5x HTP0 | 35.6→42.6 | 3 sentences |
| on-long-1 | long | 2680 | 1889 | **1306.7** | 23.6 | 671 | NPU, 21x HTP0 | 38.7→46.3 | contains "The dominant factor" |
| off-short-1 (governor "0") | short | — | 1889 | VOID | VOID | — | CPU | 39.3→**48.1 KILL** | no telemetry |
| off-short-2 (governor "0") | short | — | 1889 | VOID | VOID | — | CPU | 33.8→**48.4 KILL** | no telemetry |

ON vs OFF ratio: **not measured in this run.** Both CPU control turns hit the owner's 48.0 C stop within ~40 s of Send (CPU prewarm + CPU prefill, even from a 33.8 C start), before any telemetry. Indicative only, from the previous report on this same board
(app 1d51f196, different APK, governor never loaded there): CPU prefill 112.0 tok/s, decode 23.9 tok/s -> prefill ~11.9x, decode ~1.17x. Do not quote that as a same-build ratio.
ON-turn KV: q8_0/q8_0 (NPU lane). The lane's prefill is ~1,300 tok/s and flat across 628 / 1964 / 2680 tokens.

`ggml-hex`/HTP arch (grep-filtered, raw/sm8850/on-short-1-hexlog.txt, on-long-1-hexlog.txt): `Extracted HTP library: libggml-htp-v81.so`, `remote_handle64_open: opened handle … for file:///libggml-htp-v81.so?htp_iface_skel_handle_invoke…`,
`Successfully opened file …/app_rnllama-htp/./libggml-htp-v81.so`. (A benign `apps_std_fopen_fd failed … /cdsp/./libggml-htp-v81.so (No such file…)` precedes the successful open; no `ggml-hex` arch log line is mirrored, the arch is read from the DSP library name.)

## Part B detail

Arms (parm.sh): A = `kalsa.governor.enabled=0` (CPU prefill, CPU decode). B = `governor.enabled=1`, `bench.governor_force=1`, `bench.npu_lane=off`, `bench.route=gpu`, injected cool thermo (`bench.thermo`, plugged false, 33.0 C), `bench.force_ids` = A's first 32 ids.
Both: `bench.sampling=greedy`, `bench.probs=1`, `bench.toolchoice=none`, web/device/calendar tools off (keeps the CPU arm short enough for the 48.0 stop), sessions wiped, cold launch, `dumpsys battery unplug`.
B telemetry: `engine_prefill:"GPU"`, `engine_decode:"CPU"`, `forced:true`, `failed:false`, `thermal_state:"FAST"`, `layers_device` = GPUOpenCL only, KV q8_0/q4_0, chunks e.g. `512x5+128+128+128+10`, 33 `KALSA_BENCH_PROBS` rows (32 forced + 1 stop). Prefill 297–300 tok/s (prompt_n 2845–3063; tools off, so not comparable to Part A).
KV types: both arms read `cacheTypeK/V` from the same catalog variables (LlamaService.ts:2576 plain load, 2675/2689 governor load); the B log prints q8_0/q4_0, A's llama.cpp INFO log is not mirrored, so A's types are source-read, not log-read.
Parser sanity (Phase 0): the "run 6 PASS 4/4" is the **token** oracle of qdc-governor-s5 sa803609 (4 B turns, ids identical to A: reproduced with `cmp`, 4/4). That run predates the probs hook, so the **logit** driver cannot reproduce a PASS from committed data (no committed logit PASS exists).
What I reproduced instead: `oracle_logit.py` on the committed 8 Gen 3 data gives CPU-vs-CPU `PASS steps=936 max_dlogp=0.0000` and the committed 8650 GPU pair `FAIL R2 steps=32` (as in the s5b results.tsv). Known open item untouched: the script reports `min(violations)` ordered by step, not by severity (PREREG amendment 12); this run has no R1, so it does not matter here.

## Odd things

1. **A arm never completes.** Every CPU A turn (p1/p2/p3) was killed by the 48.0 watchdog mid-decode (255–375 steps logged, no `KALSA_BENCH_TOKENS`, no telemetry). The oracle only needs the first 32 steps, so A's ids are taken from the `tok` field of the logged `KALSA_BENCH_PROBS` rows (contiguous steps 0.., `forced:false`). Deviation from PREREG's "complete turn", declared here; prefill of A was complete in all three (`KVPREFIX … text_tokens=3285/3472/3581 n_common=518` then decode).
2. **The prompt is not byte-stable across turns.** `text_tokens` of the SAME short prompt grew 3285 (p1-A) → 3363 (p1-B) → 3472 (p2-A) → 3472 (p2-B) → 3581 (p3-A) → 3581 (p3-B). Pair 1 therefore compared different prompts (3285 vs 3363) and is VOID as a pair. Pairs 2 and 3 have equal token counts per arm (the only check I have; not a text hash). Source of the growth not investigated (app-side context injection between chats is the suspect). It also explains why A1 vs A2 (different prompts) differ at step 0 (max_dlogp 2.80) — that is NOT CPU nondeterminism, do not read it as a noise floor.
3. **Thermal sensor trap, new variant.** `dumpsys thermalservice` lists two `mName=skin`: one FROZEN at 45.60036 (from ~13:45), one live (34.4→33.9 falling). The old harness took the max, so it cooled forever against the frozen value and would have VOIDed. `env.sh skin_c` now takes the LAST entry (live one); on the first board the frozen one was low (28.24), now it was high — the harness must not assume which. Kernel zones (`/sys/class/thermal`, cpu/gpuss ~39-41 C at 13:49) agreed with the live entry.
4. **Stale local adb server on 6037.** A leftover local `adb -L tcp:6037` (pid 53111, since 02:02 AM) held 127.0.0.1:6037, so the QDC ssh tunnel bound only `[::1]` and `adb devices` listed a *local* phone (`adb-R3CW406P8CV…`, not touched). I ran `adb kill-server` on port 6037 only, then re-opened the tunnel; the board then showed as `783ee7e5`.
5. CPU paths are thermally unusable here: skin 33.8–39.9 → 48.x in ≤ 50 s on every CPU turn (5/5 CPU turns killed). GPU/NPU turns peaked 39.2–46.3.
6. Battery stub: `AC powered: true, 42.0 C` as before; `unplug` made the plan valid. `dumpsys battery reset` at the end returned `AC powered: false` (same as earlier boards).
7. OpenCL on Adreno 840: initializes. Evidence (p1-B-hexlog.txt, grep-filtered): `AdrenoVK-0: Vulkan loaded OpenCL driver`, `ggml_opencl: q4_K small-batch accumulator: fp32 (KALSA_COK_ACC)`, `ggml_opencl: q8_1 activation scale: fp32 (KALSA_Q8A_SCALE)`, `KALSA_NATIVE_VARIANT {"androidLib":"rnllama_jni_v8_2_dotprod_i8mm_hexagon_opencl","nGpuLayers":{"prefill":99,"decode":0}}`, and GPU prefill executed (`engine_prefill:"GPU"`, `layers_device` GPUOpenCL). The `selected platform: 'QUALCOMM …` line is not mirrored (native INFO log off), so the device string "Adreno 840" is not quoted from a log.

## Minutes

| session | Submitted | Started → Ended (portal) | duration | cap | card |
|---|---|---|---|---|---|
| 864730 SM8850 | 1:19:09 PM | 1:20:25 PM → 2:20:40 PM | 60.3 min | 90 | 940 → 850 (billed the full cap) |

Opened one session only; no other board touched. Tunnel closed; battery `reset` done; app force-stopped.

## Evidence map

`raw/sm8850/`: `recon.txt`, `pkg.txt` (debuggable), `arm-defaults.txt` / `*-arm.txt` (keys read back), per turn `<label>-{kalsa,hexlog,fastrpc,lmk,crash,exitinfo,watchdog,cool,state-pre,state-post,battery-pre,answer}.txt`, `all-rows.tsv` (extract), `p{1,2,3}-{A,B}-{probs.jsonl,ids.txt}`, `p{1,2,3}-steps.txt` (per-step table from `steps.py`),
`discarded-off-short-1-killed/` (first CPU control, killed 48.1), `discarded-off-short-2-stale-skin/` (aborted cooldown against the frozen sensor). Scripts: `env.sh setup.sh kset.sh kmulti.sh turn.sh run.sh extract.sh parm.sh oparse.sh steps.py oracle_logit.py` (copy of s5b). UI dumps and full logcats stayed out (`/tmp/qdcgov/sm8850`). No binaries.
