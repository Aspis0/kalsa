# s23-onecopy-abba-df538c50c — one-copy decode gap ABBA on the Galaxy S23 (2026-09-30)

Device agent session. Galaxy S23 ONLY (`adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp`), unplugged
throughout, Awake throughout, `persist.traced.enable=0` at every gate, thermal status 0 at every
gate, no DSP daemon on `top`. Battery 91 % → 79 % (end of Part 1), battery temp 30.7-33.5 °C across
arm starts (three starts overshot the 33.0 °C gate; each was rerun once after cool-down, see
"Gate exceptions"). Session local time 19:41-21:05.

## Engine and artifacts (all sha256 verified before push and re-verified on device; no skew)

Engine `/Users/marco/Projects/kalsallama-onecopy-hmx`, branch `spike/onecopy-hmx-raw`, HEAD
`df538c50c51e81636011751df398d4282054094d`. Pushed as a PAIR (host binaries + DSP .so together, the
audit-F5 skew gate) to a NEW device dir `/data/local/tmp/govhtp/onecopy-abba/{bin,dsp}`; device
`sha256sum` == host `shasum -a 256` on all three, EXIT=0:

| Artifact | SHA-256 |
|---|---|
| `bin/llama-bench` | `5bcb3f7478318157c52b1893d68937ea35db8497c13e4a6e396eabba71f840d9` |
| `bin/llama-perplexity` | `b357d834bdfcf164e2bf520c07038f24c415d49265a497d1ccedfc6d65aab245` |
| `ggml/src/ggml-hexagon/libggml-htp-v73.so` | `2808f70f0ad480efef4b24c1bd0c327843fe26e2ce0045e9bf36ebc4e96fe7dd` |

Model `/data/local/tmp/heat3way/ship.gguf` (LFM2 2.6B Q4_0). Recipe per
`onecopy-hmx-numerics/REPORT.md` "Raw-row matvec 974a31e79": `-p 512 -n 128 -ub 512 -r 3 -t 5 -ngl 99
-dev HTP0 --load-mode none`, `GGML_HEXAGON_OPFUSION=0`, default `GGML_HEXAGON_MM_SELECT` (3) and
default `GGML_OP_OFFLOAD_MIN_BATCH` (32) — the recipe sets neither. `RAW_LOCAL` DROPPED per the
coordinator ruling (same rpcmem system-heap allocation on both buffer kinds; cannot split the memory
path).

## Arms

Base env for one-copy arms: `GGML_HEXAGON_RAW_HMX=1 GGML_HEXAGON_HOSTBUF=1` (everything else at
recipe defaults). T = two copies (recipe's two-copy command: `OPFUSION=0` only). P1 = B +
`GGML_HEXAGON_RAWROW_PROBE=1` (skip dot; DMA + arrangement only; output garbage by design — speed
read as the only output, audit F6). P2 = B + `=2` (reuse VTCM slots: no fresh weight DMA after the
first slots). P4 = B + `=4` (no activation l2fetch). U = B + `GGML_HEXAGON_HOSTBUF_UNCACHED=1`.

## Results — tg128 tok/s (`-r 3` per run), ABBA

Order pass 1: T B P1 P2 P4 U; reversed: U P4 P2 P1 B T; pass 2 repeat (B3 ran between T3 and P1_3).

| Arm | run 1 | run 2 (reversed) | run 3 (pass 2) | mean | vs B | vs T |
|---|---:|---:|---:|---:|---:|---:|
| T two copies | 22.12 ± 0.10 | 22.29 ± 0.27 | 21.90 ± 0.35 | **22.10** | +41.9 % | — |
| B one-copy base | 15.60 ± 0.09 | 15.58 ± 0.04 | 15.57 ± 0.01 | **15.58** | — | −29.5 % |
| P1 skip dot | 22.46 ± 0.36 | 22.54 ± 0.24 | 22.49 ± 0.34 | **22.50** | +44.4 % | +1.8 % |
| P2 no fresh DMA | 15.65 ± 0.04 | 15.64 ± 0.07 | 15.62 ± 0.13 | **15.64** | +0.4 % | −29.2 % |
| P4 no l2fetch | 15.39 ± 0.03 | 15.54 ± 0.02 | 15.45 ± 0.04 | **15.46** | −0.8 % | −30.0 % |
| U uncached host | 15.56 ± 0.08 | 15.60 ± 0.01 | 15.54 ± 0.09 | **15.57** | −0.1 % | −29.5 % |

Per-token: T 45.2 ms, B 64.2 ms, P1 44.4 ms, P2 64.0 ms, P4 65.0 ms, U 64.1 ms. P1 removes 19.8
ms/token relative to B; P2 removes 0.2; P4 adds 0.8; U is flat.

Extra no-`-v` base samples: B first-run 15.60, two `-v` B runs 15.57/15.65 (`speed_Bv.log`) — `-v`
does not move the number.

pp512 (prefill) invariance gate: every run 856.2-861.6 except the two-copy arms at 878.3-882.4 —
the known ~2.4 % one-copy prefill cost, probe arms indistinguishable from B (max spread ±0.6 %).
Audit-F13 gate PASS: the probes did not leak into prefill.

## Gates

- **Init env line** (`ggml-hex: memory-path env: HOSTBUF=.. HOSTBUF_UNCACHED=.. RAW_HMX=..
  RAW_LOCAL=.. RAWROW_PROBE=..`): present and correct in every one of the 20 speed logs and 6
  profile logs (RAW_LOCAL=0 everywhere; probe value matches the arm).
- **`ignoring invalid GGML_HEXAGON_RAWROW_PROBE`**: 0 hits in all 26 logs.
- **Error grep** (`dsp-error|NO-SUPPORT|CRASH|GGML_ABORT|Segmentation`): 0 hits in all speed and
  profile logs. All runs EXIT=0.
- **`hvx-rawrow` path tag** (per config, short tg32 profile runs `-p 0 -n 32 -r 1 -v` with
  `GGML_HEXAGON_PROFILE=1 GGML_HEXAGON_VERBOSE=1`): profB/profP1/profP2/profP4/profU each show
  **10,956** `hvx-rawrow` execute-op lines (every decode Q4_0 matvec); profT (two copies) shows **0**
  and tags matvecs `hvx-tiled` (negative control). `hvx-flat`: 0 hits in every one-copy profile log —
  **no VTCM-budget fallback on any matvec** in any config.
- **Teardown line** `raw-row matvec paths: kernel chosen N, VTCM-budget fallback M`: **could NOT be
  obtained from any binary.** llama-bench silences logging after backend load unless `-v`
  (`llama-bench.cpp:2275` sets the null callback); with `-v` the session-create INFO lines DO appear
  (e.g. `HTP0 new session`, `rpcmem_alloc2 not found`), but every exit-time release line
  (`releasing session`, `releasing registry`, the raw-row counters) is lost in both llama-bench AND
  llama-perplexity (checked in `smoke_v.log`, `speed_Bv.log`, all 6 profile logs, both KLD logs) —
  exit-time/static-destruction log loss, in the binaries themselves, not fixable from the CLI.
  Substitute evidence that the probe ran and never fell back: the per-config `hvx-rawrow` tags
  (10,956 = full count, 0 `hvx-flat`) and the KLD run's 168,448 rawrow MUL_MATs. The M=0 signal rests
  on those tags, not on the counter line.
- **KLD (ub 1)** — recipe command, unplugged, both arms ON THIS BINARY:

| Arm | Mean KLD ± SD | Max KLD | Same top p | Mean PPL(Q) | rawrow MUL_MAT on DSP |
|---|---|---:|---|---:|---:|
| one-copy base | **0.004608 ± 0.000243** | 0.042651 | 97.059 ± 0.749 % | 33.920876 ± 5.178269 | 168,448 |
| two copies | 0.005313 ± 0.000383 | 0.094590 | 97.059 ± 0.749 % | 33.994233 ± 5.169415 | 0 |

  Both reproduce the `974a31e79` recipe values to every printed digit (0.004608 / 0.042651 /
  33.920876 and 0.005313 / 0.094590 / 33.994233); `df538c50c` did not move the math. One-copy KLD
  is BETTER than two-copy at identical top-1 agreement. Top-1 agreement of one-copy vs the two-copy
  CPU base logits: **97.059 %** (same as two-copy vs the same base). Error greps on both KLD logs:
  0. (The two ~194 MB verbose KLD logs stay on the phone at
  `/data/local/tmp/govhtp/onecopy-abba/kld_*.log`; only the summaries above were copied.)

## Gate exceptions (each rerun once after cool-down, per protocol)

| Run | start batT | result | compliant rerun | result |
|---|---:|---:|---|---:|
| T2 | 33.2 °C | 22.29 | T3 | 21.90 |
| P2_3 | 33.5 °C | 15.69 | P2_4 | 15.62 |
| P1_3 | 33.5 °C | 22.21 | P1_4 | 22.49 |

P1_3's own result was 22.21 (P1_4 superseded it in the mean). All reruns confirm their arm means;
the violations did not bias anything (B2/B3/U3/T3/P4_3 all started ≤ 33.0).

## Interpretation — stated as the measurements allow

1. **The weight DMA is not the cost.** P2 (no fresh weight DMA per token after the first slots)
   is indistinguishable from B (+0.4 %, −0.2 ms/token). The auditor's lead hypothesis — raw row
   stride 18·n_k not 128-byte aligned on the ffn matvecs, costing in the DMA — is **not supported**:
   with the DMA removed the gap does not close.
2. **The whole gap sits in what P1 removes.** P1 (dot skipped; DMA + activation arrangement kept)
   reaches 22.50 = two-copy speed (T 22.10, +1.8 %). In per-token time the dot + its VTCM read
   traffic account for 19.8 of the 19.0 ms/token gap (B 64.2 → P1 44.4 vs T 45.2).
3. **Non-additivity caveat (audit):** arm 1 also removes the dot's VTCM read traffic (so the DMAs
   run faster — arm 1 over-attributes to the dot), and arm 2 also removes DMA-engine contention with
   the dot (arm 2 over-attributes to the fetch). The two numbers bracket the gap; they do not
   decompose it. What the pair DOES rule out: pure fetch-rate/DMA as the dominant term (P2 ≈ B), and
   cache-attribute effects (U ≈ B).
4. **The default activation l2fetch is mildly positive, not a cost.** P4 (l2fetch off) is 0.8 %
   SLOWER than B (+0.8 ms/token). The 16 KB-granular 2.5×-overlapping l2fetch (audit F3) does not
   hurt at these shapes.
5. **Uncached host mapping changes nothing.** U = B (−0.1 %): the host cache attribute of the
   rpcmem allocation is not a decode factor.
6. **Read together:** one-copy raw-row decode is bound by the raw dot executing in its VTCM slot
   pattern (compute/kernel path), not by DDR fetch rate, DMA alignment, cache attributes, or the
   activation l2fetch. The simulator predicted raw-row dot compute ~equal to tiled (70 vs 84
   pcycles/tile at K=10752); silicon says the dot is worth ~30 % of the token (19.8 of 64.2 ms).
   The sim-vs-silicon discrepancy is the next investigation — e.g. the dot's VTCM read pattern on
   18-byte row strides (slot layout), not the DMA that fills the slots.

## Defect candidate observed outside the recipe (not investigated)

`-p 32 -n 2` smoke on the base env (probe 0, `-v`): the 32-row warmup prefill ubatch failed with
`HTP0 dspcall : dsp-rsp INTERNAL-ERROR` → `graph_compute ... failed with error -1` →
`synchronize failed : dsp-error INTERNAL-ERROR` → GGML_ABORT, EXIT=134 (`smoke_v.log`). The recipe
shapes (`-p 512 -ub 512`, `-p 0`) never hit it. Logged for the coder; not bisected.

## What could NOT be verified

- The teardown counter line (N > 0, M = 0) — unobtainable from any CLI binary (log loss at exit);
  substituted by full-coverage `hvx-rawrow` tags + 0 `hvx-flat` (see Gates).
- The `memory-path env:` init line does not reach `llama-perplexity` log FILES (only the WARN level
  init lines survive); the KLD arm's env is proven by the verbatim command (raw/kld.sh) and by the
  168,448 rawrow MUL_MAT lines.
- On-device split of dot-proper vs the dot's VTCM read traffic (P1 removes both; not separable from
  the CLI).
- An on-device per-op profile of the pass-2 arms (the 12.7 MB verbose profile logs for the six
  tg32 runs stay on the phone; counts and one sample line per config were pulled).

## Part 2 — NPU lane re-check, APK aea90427

**Verdict: check (a) FAIL — NEW BUG. Check (b) PASS. Check (c) lane-on side UNMEASURABLE (load never
completes); lane-off (OpenCL) side measured, 2 runs.**

Build gate: `gh run view 36786856764 -R Aspis0/kalsa` → `conclusion: success`, headSha `aea90427`.
APK `app-release.apk` sha256 `f3f7d20f852f6d9e86c5c2fc5e4b1736ee7e162806f9fec271c6edc3292992e1`;
`strings` on `lib/arm64-v8a/librnllama_v8_2_dotprod_i8mm_hexagon_opencl.so` → **137** `ggml-hex`
hits (all other rnllama variants 0, as expected); DSP skels ship in `assets/ggml-hexagon/`
(v73/v75/v79/v81). `adb install -r` → `Success`, EXIT=0. Built from app main `aea90427` = binding
`c8471449` (the cache_v_l2 SET_ROWS abort fix) + `npu_lane` on `KALSA_GOVERNOR_PLAN`.

Operational incident (documented, does not affect Part 1): at ~21:12 the S23's wireless-debugging
endpoint vanished mid-check-(a) — adbd stopped listening (full ephemeral port scan 32768-61000:
zero open; the old mDNS record went stale). The phone recovered ~40 min later via a directed mDNS
query (`dig -p 5353 @224.0.0.251`) which revealed adbd had re-registered under a NEW instance name
(`adb-R3CW406P8CV-zyLM4b (2)`, port 34673) that `adb mdns services` never surfaced. All later work
used `192.168.1.152:34673`. During the gap the app ran unobserved (see the bug below for what it was
doing). The Jelly Star was never touched.

### (a) Lane ON (route gpu, `kalsa.bench.npu_lane=on`) — FAIL: load hangs forever in prefill, new bug

The `cache_v_l2 (view) ... SET_ROWS` abort of the previous session is GONE — no crash, no dropbox
entry after the install (all 3 `data_app_native_crash` entries are 16:51/17:03/17:22, the OLD
session; `kalsa.load.dead.*` never re-armed). What replaces it is worse in a different way: the load
never finishes. Reproduced on two independent cold launches (pids 12207 and 17604), identical to the
second:

```
21:03:58.639 KALSA_GOVERNOR_PLAN {...,"npu_device":"HTP0","npu_fallback":null,"npu_lane":"on"}
22:34:17.573 KALSA_GOVERNOR_PLAN {"gpu_fit":"Fit",...,"npu_device":"HTP0","npu_fallback":null,...  (repro 2)
22:34:17.754 E vendor/qcom/.../fastrpc_apps_user.c:1382: Error 0x80000414: remote_handle64_invoke failed
             for handle 0xb400007b77bb34c0, method 3 on domain 3          <- both repros, before queue create
22:34:17.754 I dspqueue_cpu.c:593: dspqueue_create: created Queue 0, ... for domain 3
22:34:20-21  KALSA_NATIVE warn warning: failed to mlock 223281152-byte buffer ...: Out of memory  (x2)
22:34:21.989 KALSA_NATIVE_VARIANT {"androidLib":"rnllama_jni_v8_2_dotprod_i8mm_hexagon_opencl","nGpuLayers":{"prefill":99,"decode":0}}
22:34:22.020 RNLlama: loadPrompt: prompt_n=1660 n_ctx=8192 embd=0     <- the model's own KV-prefix prefill
22:34:23.022 E dspqueue_cpu.c:963::error: 0xc: dspsignal_wait(...) == 0
22:34:23.022 E dspqueue_cpu.c:1014: Error 0xc: wait_signal_locked failed for queue 0x... signal 2
22:34:23.022 E dspqueue_cpu.c:1779::error: 0xc: wait_signal_locked(q, DSPQUEUE_SIGNAL_RESP_PACKET, timeout_ts)
             ... then the same 3-line triple EVERY ~1.0 s, forever
```

Facts about the hang (all from `raw/bug-dspqueue-*`):

- The FIRST HTP prefill batch (of the 1,660-token KV prefix at load) is submitted and its response
  never arrives: the wait on the dspqueue response packet (signal 2) times out with error 0xc and is
  immediately re-entered, at exactly ~1.02 s period, indefinitely. Repro 1 ran ~90 min = 5,193
  timeout triples before I stopped it; repro 2 hit 127 in 2.5 min before force-stop. Zero
  `execute-op` completions after the hang begins; no recovery, no crash, no abort, no ANR.
- Spinning thread: `mqt_v_native` (the RN JSI native queue that runs loadPrompt), ~85 % of one CPU
  core, 84 CPU-minutes over 90 wall minutes in repro 1. Battery cost measured: 79 % → 63 % in ~80 min
  (~13 %/h) with battery temp pinned at 33.1-33.7 °C and skin 34+ °C at idle — the spin alone holds
  the phone above the 33.0 °C session gate.
- The load-timeout loop starts ~1.0 s after `loadPrompt` in BOTH repros (21:04:03.853 after
  21:04:02.844; 22:34:23.022 after 22:34:22.020). Deterministic, unplugged, thermal 0.
- The `Error 0x80000414: remote_handle64_invoke failed ..., method 3` on the `libdspqueue_rpc_skel`
  handle precedes `dspqueue_create` in both repros — candidate root cause (the queue's control
  invoke fails, then nothing ever signals the queue), quoted verbatim for the coder; I did not
  correlate it further.
- The UI meanwhile shows the model sheet ("LFM2.5 2.6B", "Su questo telefono"); no error surfaces to
  the user. `KALSA_PREWARM` restore reports `no_file` (expected on a fresh install).
- Consequences for the acceptance: "the load completes (NO abort)" — the load does not abort but
  NEVER completes; no turn can run; `KALSA_GOVERNOR` prefill-on-HTP lines are unobtainable; the
  `npu_device:"HTP0", npu_fallback:null` plan-level resolution is the ONLY part of (a) that works.

### (b) Lane OFF, route gpu — PASS

Cold launch with `kalsa.bench.npu_lane=off` (turn harness `raw/turn2.sh`, adapted from the previous
session's `turn.sh`; same staged prompt, same send flow):

```
22:38:26.710 KALSA_GOVERNOR_PLAN {...,"npu_device":null,"npu_fallback":null,"npu_lane":"off"}
22:40:53.001 KALSA_TELEMETRY {"tokensEvaluated":4746,"tokensPredicted":553,"promptMs":45947.706,
             "predictedMs":54894.327,"predictedPerSecond":10.07,"interrupted":false,...}
22:40:53.030 KALSA_GOVERNOR {"engine_prefill":"GPU","engine_decode":"CPU",...,"prefill_chunks":
             "512+512+512+125+512+512+512+512+512+512+10+3","npu_device":null,"failed":false,...}
```

Load completes, one turn completes, prefill ran on GPU (OpenCL), nothing on HTP. The previous
session's nondeterministic lane-off `cache_v_l2` abort did not reproduce (n=1 turn; see caveats).
Post-turn state: battery 38.7 °C, thermal status 2 (cooldown enforced before the next arm).

### (c) Prefill speed/energy, lane-on (HTP) vs lane-off (OpenCL) — lane-on side IMPOSSIBLE

Same prompt both arms (the harness's staged 4,746-token `enc.txt` via `kalsa://share?text=`), 2 runs
lane-off (ABBA collapses: there is no lane-on arm to alternate with — every lane-on cold start hangs
at load, shown twice above). Energy from the per-turn 1 Hz trace (`files/energy/*.csv`), current
column read as milliamps (the unit this device's column actually carries; same method and same
~1.6-1.9 A trace values as the previous session's calibrated run), battery |I|·V trapezoid over the
prefill window (send → send+promptMs):

| run | config | prefill tok/s | decode tok/s | J/1k prefill (raw) | J/1k prefill (−840 mW idle) |
|---|---|---:|---:|---:|---:|
| gpu-b1 22:38 | lane off, route gpu | 103.2 | 10.07 | 52.1 | 43.9 |
| gpu-c2 22:56 | lane off, route gpu | 103.1 | 9.84 | 48.6 | 40.1 |
| npu-* | lane on (HTP) | **unmeasurable** | — | — | — |

Lane-off pair mean: prefill **103.2 tok/s**, 50.4 J/1k raw (42.0 incremental). The audit's warning —
attention now runs on the CPU (~60 splits per ubatch) so HTP prefill may LOSE to OpenCL — is
untestable on this build: the HTP prefill never executes a single completed op. For context only
(different APK, CPU route, previous session): CPU prefill was 22.8 tok/s at 256 J/1k raw — the
OpenCL lane-off route is ~4.5× faster and ~5× less energy per 1k prefill tokens than that CPU
reference.

### Transport note and end state

adb serial for the whole Part 2 after the drop: `192.168.1.152:34673` (the mDNS name
`adb-R3CW406P8CV-zyLM4b...` resolves to the DEAD 45119 record; `adb connect adb-R3CW406P8CV...`
fails until the stale record expires). Harness, evidence extracts and the interrupted-run logs are
under `raw/` (`bug-dspqueue-*`, `gpu-b1*`, `gpu-c2*`, `idle-samples.txt` — the idle sampler only
landed one row before dying; the 840 mW floor is the previous session's).

End state: unplugged, screen on/Awake, Kalsa foreground with the model loaded on the WORKING config
(route gpu, `kalsa.bench.npu_lane=off`, energy_trace on), thermal status 0, `persist.traced.enable=0`.

## Raw

`raw/` holds all 21 speed logs (full stderr per run), `speed.txt` (per-arm start/after gates:
level, ac/usb/wireless, battery temp, skin temp, wakefulness, thermal status, traced),
`profile.txt`, `kld.txt`, the device scripts (`env.sh`, `profile.sh`, `kld.sh`, `turn2.sh` —
verbatim commands), and `smoke_v.log`. Part 2: `bug-dspqueue-load-window.txt` (the full logcat
window around the first hang, lines 340-395 of pid 12207), `bug-dspqueue-pid12207-extract.txt`
(15,742-line extract: every dspqueue/0x80000414/mlock/KALSA_ line of the 90-min spin),
`bug-dspqueue-repro-npua1.txt` (the clean cold-launch repro quotes), `gpu-b1-*`, `gpu-c2-*`
(evidence, CSVs, pre-send states), `idle-samples.txt`. Nothing committed anywhere; no push.
