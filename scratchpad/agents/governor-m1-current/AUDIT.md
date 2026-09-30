# Hostile audit: governor milestone 1 current trace

**Scope:** read-only audit of lab commit 935e7841; no device access. I recomputed from the saved CSVs and logcats. The result is a partial GPU-prefill versus CPU-prefill observation, not a completed backend-separation test. Citations written as raw/… are relative to scratchpad/agents/governor-m1-current/.

## Ranked findings

### 1. [CONFIRMED] The required idle-noise test was not run; the plan’s criterion is therefore unevaluable

The criterion requires both live readings and a phase-mean difference above three times **idle** standard deviation:

> scratchpad/agents/governor-plan-fable/PLAN.md:58: 1. **De-risk: does in-app current separate backends on the S23?** Debuggable APK, `kalsa.bench.energy_trace`,
> scratchpad/agents/governor-plan-fable/PLAN.md:59:    `kalsa.bench.npu_lane`, `/bench route`; 3 turns each NPU-prefill, GPU-prefill, CPU-decode, unplugged, same
> scratchpad/agents/governor-plan-fable/PLAN.md:60:    prompt. Pass: current changes on >= 90 % of rows AND per-phase mean current differs between backends by > 3x idle
> scratchpad/agents/governor-plan-fable/PLAN.md:61:    std-dev. Fail: drop energy learning, rank on heat priors only.

The report substituted between-turn spread and active-window spread, then admitted there was no idle sample:

> scratchpad/agents/governor-m1-current/REPORT.md:88: - Noise statement, as directed: **the noise used for the pass test is the
> scratchpad/agents/governor-m1-current/REPORT.md:89:   between-turn sd of per-turn means within an arm** (thermal drift included);
> scratchpad/agents/governor-m1-current/REPORT.md:93:   the choice. There is no in-app idle window (the sampler runs only during a
> scratchpad/agents/governor-m1-current/REPORT.md:94:   turn), so true idle noise is unmeasurable on this device today.

The measured prefill means differ by about 242 mA (GPU 1260.3, CPU 1018.5). That would pass the plan’s numeric threshold only if idle SD were below about 80.6 mA. Idle SD is unknown. Between-turn SD is between-turn variation with only three turns per arm; active-window SD includes workload variation and is not idle sensor noise. The 99.7–100% changed-transition result is supported, but the report’s **FAIL on the plan’s separation criterion** is not: the actual criterion was not evaluated. The justified result is “separation not established,” not a plan-level pass or fail.

The NPU leg is also absent, and decode cannot be compared by backend because all recorded decodes use CPU. The report itself records both limitations:

> scratchpad/agents/governor-m1-current/REPORT.md:25: NPU arm NOT run (recorded, not fixed): the installed CI APK was built CPU-only
> scratchpad/agents/governor-m1-current/REPORT.md:95: - Confound quantification: decode is CPU in every turn, so decode backend
> scratchpad/agents/governor-m1-current/REPORT.md:144: - Decode backend separation: decode is CPU in every turn; no contrast exists.

### 2. [CONFIRMED] The J/1k figures reproduce when current is treated as mA, but they do not validate backend-specific energy learning

I filtered valid current rows, used the stated phase windows, and integrated row-level abs(current) × voltage by trapezoids clipped to the prefill window. Under the report’s mA assumption, the results are:

| Turn | Changes | Prefill n; mean mA (sample SD); mV | Decode n; mean mA (sample SD) | Prefill tok/s from promptMs | Reported tok/s | Trapezoid J/1k |
|---|---:|---:|---:|---:|---:|---:|
| gpu-t1 | 141/141 | 45; 1455.8 (383.6); 4024.5 | 95; 2024.0 (315.9) | 103.03 | 105.3 | 55.93 |
| cpu-t1 | 305/306 | 230; 1164.9 (172.8); 3947.5 | 75; 1465.3 (234.8) | 20.51 | 20.6 | 223.08 |
| gpu-t2 | 109/109 | 50; 1337.3 (392.2); 3971.0 | 57; 1923.0 (220.9) | 92.64 | 94.5 | 55.98 |
| cpu-t2 | 374/374 | 289; 945.3 (138.3); 3928.9 | 84; 1182.8 (170.0) | 16.31 | 16.4 | 226.95 |
| gpu-t3 | 151/151 | 62; 987.7 (348.6); 3955.4 | 88; 1945.8 (246.3) | 75.37 | 76.6 | 50.91 |
| cpu-t3 | 405/405 | 287; 945.4 (124.7); 3860.9 | 117; 1337.4 (148.3) | 16.41 | 16.5 | 221.50 |

The original displayed values are:

> scratchpad/agents/governor-m1-current/REPORT.md:40: | gpu-t1 | gpu | 141/141 (100 %) | 45 | 1456 (384) | 4024 | 95 | 2024 (316) | 105.3 | 9.78 | 56 |
> scratchpad/agents/governor-m1-current/REPORT.md:41: | cpu-t1 | cpu | 305/306 (99.7 %) | 230 | 1165 (173) | 3947 | 75 | 1465 (235) | 20.6 | 8.30 | 223 |
> scratchpad/agents/governor-m1-current/REPORT.md:42: | gpu-t2 | gpu | 109/109 (100 %) | 50 | 1337 (392) | 3971 | 57 | 1923 (221) | 94.5 | 9.46 | 56 |
> scratchpad/agents/governor-m1-current/REPORT.md:43: | cpu-t2 | cpu | 374/374 (100 %) | 289 | 945 (138) | 3929 | 84 | 1183 (170) | 16.4 | 6.94 | 227 |
> scratchpad/agents/governor-m1-current/REPORT.md:44: | gpu-t3 | gpu | 151/151 (100 %) | 62 | 988 (349) | 3955 | 88 | 1946 (246) | 76.6 | 9.13 | 51 |
> scratchpad/agents/governor-m1-current/REPORT.md:45: | cpu-t3 | cpu | 405/405 (100 %) | 287 | 945 (125) | 3861 | 117 | 1337 (148) | 16.5 | 7.11 | 222 |

The recomputation uses the saved current-status-ok rows and the stated window boundaries:

> /tmp/m1/table.py:19: def load(path):
> /tmp/m1/table.py:20:     rows = [r for r in csv.reader(
> /tmp/m1/table.py:21:         l for l in open(path) if not l.startswith('#'))][1:]
> /tmp/m1/table.py:22:     return [(float(r[0]), float(r[3]), float(r[5]))
> /tmp/m1/table.py:23:             for r in rows if r[6] == 'ok']
> /tmp/m1/split.py:4: rows=[(float(r[0]),int(r[3])) for r in rows if r[6]=='ok']
> /tmp/m1/split.py:5: t0=rows[0][0]; pe=t0+pre_ms/1000; de=pe+dec_ms/1000
> /tmp/m1/split.py:6: chg=sum(1 for a,b in zip(rows,rows[1:]) if a[1]!=b[1])

My recomputation matches every reported row count, phase mean, sample SD, voltage mean, decode rate, and rounded J/1k result. Two reporting defects remain:

- **Prefill tok/s is not the engine’s prompt throughput.** table.py uses the sampled phase duration from t0+1 through t0+promptMs, which is promptMs−1 s, while all 4,746 evaluated tokens are timed by the full promptMs. Thus reported GPU rates are 1.3–2.3% high (for example, gpu-t1 is 105.3 vs 103.03 tok/s); CPU rates move less because their prompts are much longer. The report’s “4746 / prefill_s” description does not expose that mismatch:

> REPORT.md:34: Per-turn (mean mA negative-discharge sign flipped; prefill tok/s =
> REPORT.md:35: 4746 / prefill_s; decode tok/s from KALSA_TELEMETRY predictedPerSecond;
> /tmp/m1/table.py:39:     for name, lo, hi in (("prefill", t0 + 1, pe), ("decode", pe + 1, de)):
> /tmp/m1/table.py:45:             "sec": (hi - lo) if name == "prefill" else dec_ms / 1000,
> /tmp/m1/table.py:73:               f"{PROMPT_TOKENS / p['sec']:9.1f}  {tok_pred / d['sec']:9.2f}  "

- **The written J equation is missing a factor of 1,000.** The table-producing script converts mA and mV to A and V, then multiplies by 1,000 tokens; the report’s printed equation omits those conversions. The script also multiplies phase mean current by phase mean voltage and duration rather than integrating each paired current/voltage sample. The latter approximation differs from my trapezoid integrals by at most 0.54%, so all six still round to the same whole joules; this is a method/documentation mismatch, not a material table-value mismatch.

> REPORT.md:36: J/1k = mean_mA × mean_mV × prefill_s / 4746):
> /tmp/m1/table.py:51:     # J per 1000 prefill tokens = (A * V * s) * 1000 / prompt tokens
> /tmp/m1/table.py:52:     return (win["ma"][0] / 1000) * (win["mv"][0] / 1000) * win["sec"] \
> /tmp/m1/table.py:53:         * 1000 / PROMPT_TOKENS

The arm arithmetic reproduces: GPU prefill 1260.3 mA (between-turn SD 243.4), CPU prefill 1018.5 mA (126.8), difference 241.7; GPU-arm CPU-decode 1964.3 mA (53.0), CPU-arm CPU-decode 1328.5 mA (141.5), difference 635.8. The code’s “pooled within-window SD” is an unweighted RMS of the three turn SDs, not a degrees-of-freedom-weighted pooled SD; the weighted values are about 373 mA GPU and 145 mA CPU, versus the report’s ~375 and ~147. This small arithmetic distinction does not change any threshold comparison against those active-window proxies.

> /tmp/m1/table.py:83:         gpooled = math.sqrt(sum(per[l][1][phase]["ma"][1] ** 2
> /tmp/m1/table.py:84:                                 for l in per if per[l][0] == "gpu") / 3)
> /tmp/m1/table.py:85:         cpooled = math.sqrt(sum(per[l][1][phase]["ma"][1] ** 2
> /tmp/m1/table.py:86:                                 for l in per if per[l][0] == "cpu") / 3)

The 54 ± 3 vs 224 ± 3 summary is a real ratio in this sample under the mA assumption, but it is whole-phone energy during a window, not isolated backend energy. The plan did not define an integral pass criterion; it says that if milestone 1 fails, energy learning is dropped. Milestone 6 is explicitly conditional on milestone 1 passing:

> PLAN.md:579: integral does separate: 54 +- 3 J (GPU) vs 224 +- 3 J (CPU) per 1k prefill tokens, 4.1x, because the backend sets
> PLAN.md:580: the duration. Consequence: learn and rank on energy per token, not on mean current. NPU arm
> scratchpad/agents/governor-plan-fable/PLAN.md:71: 6. **Energy-per-token table + learning** (only if 1 passes). Pass: after 6 unplugged turns the learned NPU/CPU decode
> PLAN.md:581: has no Hexagon host backend (see "NPU prefill"). n = 3 per arm, whole-phone current incl. screen.

The duration effect is large: mean timed prefill is 53.42 s GPU vs 270.52 s CPU, a 5.06× ratio before using any current sensor. The measured energy ratio is 4.12× because the GPU-prefill windows also draw more instantaneous power on average. So the ratio is **not literally duration alone**, but the direction and a larger-than-fourfold split would already arise from throughput under an equal-power assumption. No idle window was subtracted, so the number also charges the screen, OS, and other phone loads throughout the much longer CPU prefill. It does not establish incremental backend energy or justify bypassing the plan’s fail branch.

The report says the energy result is “two orders of magnitude” beyond its own 3×-SD test. With a ~170 J mean gap and ~3 J between-turn SD, the gap is about 19× the 3×SD threshold, not 100×:

> REPORT.md:56: J/1k prefill tokens: gpu 56, 56, 51 (mean 54, sd 3); cpu 223, 227, 222
> REPORT.md:57: (mean 224, sd 3).
> REPORT.md:23: per-turn integral passes its own 3× test by two orders of magnitude.

### 3. [CONFIRMED] The phase origin is not the send tap, and the exact offset to native prompt evaluation was not recorded

The driver taps Send at one point, but it does not timestamp the tap:

> /tmp/m1/turn.sh:21: adb -s $S shell input tap 944 2071

The app builds currentMessages before it starts the battery trace, then starts sampling inside streamAssistantTurn:

> /Users/marco/Projects/kalsa/src/engine/LlamaService.ts:4612:     let currentMessages: ToolChatMessage[] = applyOperativeBlockFormat(
> /Users/marco/Projects/kalsa/src/engine/LlamaService.ts:4772:     // Bench-only energy series: one CSV per turn so the host can join the
> /Users/marco/Projects/kalsa/src/engine/LlamaService.ts:4774:     const energyTraceOn = await startGovernorBatteryTrace(

After the sampler starts, the app still refreshes governor state and calls a native formatted-chat probe before engine.completion:

> /Users/marco/Projects/kalsa/src/engine/LlamaService.ts:5026:         governorThermoSource = (
> /Users/marco/Projects/kalsa/src/engine/LlamaService.ts:5033:         const templateOpensThink = await probeTemplateOpensThink(
> /Users/marco/Projects/kalsa/src/engine/LlamaService.ts:4132:     const formatted = await withNativeCallTimeout(
> /Users/marco/Projects/kalsa/src/engine/LlamaService.ts:4133:       engine.getFormattedChat(messages, null, {

The CSV’s t0 is the first asynchronous sample, not the actual native prefill start. Native promptMs is a prompt-processing timer after request/state setup; it is not send-to-prefill wall time and does not account for the preceding JS composition/template probe/tokenization. The native code starts its timer after state loading and receives already-formed request.prompt_tokens:

> /Users/marco/Projects/kalsa/node_modules/llama.rn/cpp/rn-slot-manager.cpp:622:                 // Start timing AFTER state loading completes
> /Users/marco/Projects/kalsa/node_modules/llama.rn/cpp/rn-slot-manager.cpp:623:                 slot->t_start_process = ggml_time_us();
> /Users/marco/Projects/kalsa/node_modules/llama.rn/cpp/rn-slot-manager.cpp:638:                     slot->load_prompt(request.prompt_tokens);
> /Users/marco/Projects/kalsa/node_modules/llama.rn/cpp/rn-slot.cpp:502:     t_prompt_processing = (t_start_generation - t_start_process) / 1e6;
> /Users/marco/Projects/kalsa/node_modules/llama.rn/cpp/rn-slot.cpp:730:     timings.prompt_ms = t_prompt_processing * 1e3;  // Convert seconds to milliseconds for output

The report’s windows use [t0+1 s, t0+promptMs) for prefill and begin decode at t0+promptMs+1 s:

> /tmp/m1/split.py:5: t0=rows[0][0]; pe=t0+pre_ms/1000; de=pe+dec_ms/1000
> /tmp/m1/split.py:8: for name,lo,hi in (("prefill",t0+1,pe),("decode",pe+1,de),("tail",de+2,1e18)):

The actual gap between first sample and native prompt-timer start is not in the artifacts, so phase boundaries may be shifted by a sample or more. As a sensitivity check, shifting the assumed phase windows +5 s raises the three GPU prefill means from 1456/1337/988 to about 1526/1388/1040 mA; CPU means move only a few mA. That hypothetical does not prove the real shift was five seconds, but it shows the GPU phase averages are boundary-sensitive. A start marker from the native completion and a sample-clock join are missing.

### 4. [PLAUSIBLE] The mA interpretation is strongly supported locally, but the energy scale is not externally calibrated

The CSV header says current_uA, and the native module writes the integer returned by BATTERY_PROPERTY_CURRENT_NOW without rescaling it:

> raw/cpu-t1.csv:2: t_s,elapsed_realtime_ms,wall_clock_ms,current_uA,charge_counter_uAh,voltage_mV,current_status,charge_counter_status,voltage_status
> /Users/marco/Projects/kalsa/native/GovernorBatteryModule.kt:168:     private fun readHighRateValues(): HighRateRead = HighRateRead(
> /Users/marco/Projects/kalsa/native/GovernorBatteryModule.kt:169:         current = readProperty(BatteryManager.BATTERY_PROPERTY_CURRENT_NOW),
> /Users/marco/Projects/kalsa/native/GovernorBatteryModule.kt:194:             val value = manager.getIntProperty(property)

The Android API contract calls BATTERY_PROPERTY_CURRENT_NOW “Instantaneous battery current in microamperes, as an integer.” ([BatteryManager API reference](https://developer.android.com/reference/android/os/BatteryManager#BATTERY_PROPERTY_CURRENT_NOW).) But the local charge-counter trend strongly supports interpreting these S23 numbers as mA: cpu-t1 charge counter falls 112,500 µAh over 307.805 s, implying about 1.316 A average, close to the trace’s ~1.24 A numeric mean if that mean is mA and about 1,000× away if it is µA.

> raw/cpu-t1.csv:3: 51741.667,51741667,1790785025525,-1570,2793750,3921,ok,ok,ok
> raw/cpu-t1.csv:309: 52049.472,52049472,1790785333330,-1207,2681250,3927,ok,ok,ok
> /Users/marco/Projects/kalsa/native/GovernorBatteryModule.kt:337:                 "current_uA=property-documented unit, calibrate per device; " +

The report also explicitly says there was no external calibration:

> REPORT.md:76:   (`kalsa.bench.energy_trace`, schema kalsa-governor-battery-trace-v2), latest
> REPORT.md:77:   file under files/energy via run-as. Samsung fuel gauge reports mA in the
> REPORT.md:78:   current_uA column (sign negative = discharge); not calibrated against an

If the raw numbers were actually µA, all reported J figures would be 1,000× too large (about 0.054 vs 54 J and 0.224 vs 224 J per 1k); the 4.1× ratio would remain unchanged. Keep the unit as a qualified assumption until externally calibrated.

### 5. [PLAUSIBLE] The decode contrast is real in this sample; attributing it to thermal history is not

The same CPU decode backend has a 636 mA between-arm difference, but the arms also differ in preceding prefill route, elapsed time, throughput, chunking, and likely device state. The report’s own numbers show the decode-rate split too:

> REPORT.md:53: | decode | gpu-arm (CPU backend) | 2024, 1923, 1946 | 1964 | 53 | ~264 |
> REPORT.md:54: | decode | cpu-arm (CPU backend) | 1465, 1183, 1337 | 1329 | 142 | ~188 |

Thermal labels in the log are a single turn-level field; battery temperatures in saved state files are after-turn snapshots. Neither gives temperature, clocks, or scheduler state at the phase boundary. Reported end temperatures range from 41.9 to 45.6 °C, and the gpu-t1 preflight/state file is absent. A “thermal history moves phase means more than backend” explanation is plausible, not measured causality.

Chunk sizes also vary across turns: cpu-t1 and gpu-t1/gpu-t2 use 512-token chunks, while cpu-t2/cpu-t3/gpu-t3 use mostly 128-token chunks. This is a real protocol/state difference; it does **not** prove a different CPU thread count. The saved chunk fields do not report n_threads, CPU/GPU frequencies, or per-phase thermal values. Four governor records are truncated, so their missing tails cannot establish that those fields were absent there. DVFS, different CPU scheduling/thread configuration, duration-dependent heating, and GPU-prefill carryover into CPU decode remain alternatives.

The sequence is GPU then CPU in each pair, not randomized/counterbalanced. The report calls six runs “ABABA” and says 90-second gaps:

> REPORT.md:67: - 6 turns, one cold-launched chat turn each, prompt 4746 tokens (14,023-char
> REPORT.md:68:   English text + summarize instruction) shared via `kalsa://share?text=`.
> REPORT.md:69:   Order: gpu-t1 (coordinator, 12:07), then cpu-t1, gpu-t2, cpu-t2, gpu-t3,
> REPORT.md:70:   cpu-t3 in an ABABA cpu/gpu alternation, 90 s screen-on gaps.

There are six runs, and the actual captured gap from gpu-t1’s last sample to cpu-t1’s first is 430.741 s; later inter-trace gaps are about 198–220 s. The audit brief also notes a killed turn before cpu-t1. Its trace/thermal effect is not represented in the six-turn table. The fixed order, the long unmatched first gap, the falling battery level, and changing temperatures make a causal thermal attribution unsafe. The data establish an arm-associated difference, not its mechanism.

### 6. [PLAUSIBLE] Run integrity is mostly supported at the top level, but the preserved evidence does not prove every requested condition

All six telemetry records show tokensEvaluated:4746, interrupted:false, and truncated:false; the top-level governor fields report the requested prefill backend, CPU decode, and route_mismatch:false. For example:

> raw/t1-logcat.txt:1: 09-30 12:09:55.348  7373  7397 I ReactNativeJS: KALSA_TELEMETRY {"turnId":"1","attempt":1,"round":0,"tokensCached":5687,"tokensEvaluated":4746,"tokensPredicted":940,"draftTokens":0,"draftAccepted":0,"promptMs":46063.861,"predictedMs":96114.866,"predictedPerSecond":9.779964735111841,"contextFull":false,"interrupted":false,"truncated":false,"prompt_n":4746,"ciswireFlags":1}
> raw/cpu-t1-logcat.txt:1: 09-30 12:22:13.998 13198 13222 I ReactNativeJS: KALSA_TELEMETRY {"turnId":"1","attempt":1,"round":0,"tokensCached":5385,"tokensEvaluated":4746,"tokensPredicted":638,"draftTokens":0,"draftAccepted":0,"promptMs":231444.427,"predictedMs":76840.131,"predictedPerSecond":8.30295304936427,"contextFull":false,"interrupted":false,"truncated":false,"prompt_n":4746,"ciswireFlags":1}
> raw/gpu-t2-logcat.txt:1: 09-30 12:27:23.872 17501 17526 I ReactNativeJS: KALSA_TELEMETRY {"turnId":"1","attempt":1,"round":0,"tokensCached":5299,"tokensEvaluated":4746,"tokensPredicted":552,"draftTokens":0,"draftAccepted":0,"promptMs":51230.241,"predictedMs":58348.44099999999,"predictedPerSecond":9.46040700556164,"contextFull":false,"interrupted":false,"truncated":false,"prompt_n":4746,"ciswireFlags":1}
> raw/cpu-t2-logcat.txt:1: 09-30 12:36:58.650 20889 20913 I ReactNativeJS: KALSA_TELEMETRY {"turnId":"1","attempt":1,"round":0,"tokensCached":5340,"tokensEvaluated":4746,"tokensPredicted":593,"draftTokens":0,"draftAccepted":0,"promptMs":290965.303,"predictedMs":85473.052,"predictedPerSecond":6.937859198007812,"contextFull":false,"interrupted":false,"truncated":false,"prompt_n":4746,"ciswireFlags":1}
> raw/gpu-t3-logcat.txt:1: 09-30 12:43:11.008 24685 24708 I ReactNativeJS: KALSA_TELEMETRY {"turnId":"1","attempt":1,"round":0,"tokensCached":5564,"tokensEvaluated":4746,"tokensPredicted":817,"draftTokens":0,"draftAccepted":0,"promptMs":62968.997,"predictedMs":89468.454,"predictedPerSecond":9.131710267397715,"contextFull":false,"interrupted":false,"truncated":false,"prompt_n":4746,"ciswireFlags":1}
> raw/cpu-t3-logcat.txt:1: 09-30 12:53:20.121 29254 29277 I ReactNativeJS: KALSA_TELEMETRY {"turnId":"1","attempt":1,"round":0,"tokensCached":5588,"tokensEvaluated":4746,"tokensPredicted":841,"draftTokens":0,"draftAccepted":0,"promptMs":289144.166,"predictedMs":118248.955,"predictedPerSecond":7.112113591194104,"contextFull":false,"interrupted":false,"truncated":false,"prompt_n":4746,"ciswireFlags":1}

The first KALSA_GOVERNOR line reports npu_device:"GPU" and npu_fallback:"htp-device-missing"; it is not an NPU sample:

> raw/t1-logcat.txt:2: "npu_device":"GPU","npu_fallback":"htp-device-missing"

However, the serialized governor lines are cut off mid-route_chunks in gpu-t1, cpu-t2, cpu-t3, and gpu-t3. Their earlier top-level route_mismatch:false fields survive, but the claimed independent per-chunk audit trail is incomplete for four of six turns.

The five saved state files show Awake/MainActivity **after** their turns. There is no gpu-t1 state file, and the harness captures state after telemetry, not before:

> /tmp/m1/turn.sh:21: adb -s $S shell input tap 944 2071
> /tmp/m1/turn.sh:24: adb -s $S shell 'dumpsys power | grep mWakefulness=; dumpsys activity activities | grep topResumedActivity | head -1; dumpsys battery | grep -E "level|temperature" | head -2' > /tmp/m1/$LABEL-state.txt
> raw/cpu-t1-state.txt:1:   mWakefulness=Awake
> raw/cpu-t1-state.txt:2:     topResumedActivity=ActivityRecord{185256279 u0 com.kalsa.app/.MainActivity t86}
> raw/gpu-t2-state.txt:1:   mWakefulness=Awake
> raw/gpu-t2-state.txt:2:     topResumedActivity=ActivityRecord{144678566 u0 com.kalsa.app/.MainActivity t87}
> raw/cpu-t2-state.txt:1:   mWakefulness=Awake
> raw/cpu-t2-state.txt:2:     topResumedActivity=ActivityRecord{54178664 u0 com.kalsa.app/.MainActivity t88}
> raw/gpu-t3-state.txt:1:   mWakefulness=Awake
> raw/gpu-t3-state.txt:2:     topResumedActivity=ActivityRecord{265997334 u0 com.kalsa.app/.MainActivity t89}
> raw/cpu-t3-state.txt:1:   mWakefulness=Awake
> raw/cpu-t3-state.txt:2:     topResumedActivity=ActivityRecord{126909987 u0 com.kalsa.app/.MainActivity t90}

The report says before-and-after preflights were verified, then specifically says gpu-t1’s pre-turn preflight was not captured. The persisted evidence supports only five post-turn states:

> REPORT.md:83: - Preflight before AND after every turn (verified each time): mWakefulness=Awake,
> REPORT.md:151: - gpu-t1 pre-turn preflight (coordinator's turn, run before this session): not
> REPORT.md:152:   captured by me; its logcat/CSV are internally consistent (route gpu, mismatch

For five scripted turns the harness checks for a powered AC/USB/wireless source before sending, but stores neither that output nor an after-turn plug check. Its grep | wc -l check can also treat a failed dumpsys/empty output as zero plugged sources because the script does not enable pipefail:

> /tmp/m1/turn.sh:3: set -u
> /tmp/m1/turn.sh:12: plugged=$(adb -s $S shell dumpsys battery | grep -E "^  (AC|USB|Wireless) powered: true" | wc -l)
> /tmp/m1/turn.sh:13: [ "$plugged" -eq 0 ] || { echo "PLUGGED - abort"; exit 4; }

Thus route/tokens/completion status are supported at the top level; per-chunk route, before/after foreground state, and unplugged status are not fully evidenced for every turn.

### 7. [CONFIRMED] PLAN.md and ALIVE.md turn a partial observation into a decision the criterion does not authorize

Both living documents say thermal history dominates, energy separates, and the system should rank/learn on energy per token. The first is a causal attribution not isolated by these runs; the last contradicts the written fail branch and the conditional milestone 6. The persisted wording is:

> PLAN.md:575: **Milestone 1 result (S23, 2026-09-30, `scratchpad/agents/governor-m1-current/REPORT.md`; coordinator re-derived two
> PLAN.md:576: turns from raw; hostile audit pending):** in-app current
> PLAN.md:577: does NOT separate GPU from CPU prefill (1260 vs 1019 mA, below 3x the between-turn sd of 243 mA): thermal history
> PLAN.md:578: moves phase means more than the backend does (the same CPU decode differs by 636 mA between arms). The energy
> PLAN.md:579: integral does separate: 54 +- 3 J (GPU) vs 224 +- 3 J (CPU) per 1k prefill tokens, 4.1x, because the backend sets
> PLAN.md:580: the duration. Consequence: learn and rank on energy per token, not on mean current. NPU arm
> PLAN.md:581: has no Hexagon host backend (see "NPU prefill"). n = 3 per arm, whole-phone current incl. screen.
> docs/ALIVE.md:735: LOWBAT falls back to CPU prefill; admission deltas are unmeasured and uniform. Milestone 1 on the S23
> docs/ALIVE.md:736: (`governor-m1-current/REPORT.md`, audit pending): the in-app current is live at 1 Hz (99.7-100 % of rows change),
> docs/ALIVE.md:737: but mean current does not separate GPU from CPU prefill (thermal history dominates); energy per 1k prefill tokens
> docs/ALIVE.md:738: does, 54 vs 224 J (4.1x, sd 3 J). Rank on energy per token. NPU arm impossible until the APK carries Hexagon. Correction: `s23-backend-hopping-heat` has a REPORT (28/09),
> docs/ALIVE.md:739: where CPU and HTP decode heat ranges overlap, so "NPU decode wins on S23" is plausible, not proven.

Use the replacement below in both documents. It retains the measured liveness and rounded whole-phone result, labels the idle-noise criterion untested, removes causal thermal language, and does not authorize energy learning/ranking.

### Evidence excerpts for the recomputation and confound checks

The six saved traces use the same schema; these boundary rows show each time series and the cpu-t1 charge-counter cross-check:

> raw/cpu-t1.csv:3: 51741.667,51741667,1790785025525,-1570,2793750,3921,ok,ok,ok
> raw/cpu-t1.csv:309: 52049.472,52049472,1790785333330,-1207,2681250,3927,ok,ok,ok
> raw/cpu-t2.csv:3: 52558.162,52558162,1790785842020,-961,2565000,3908,ok,ok,ok
> raw/cpu-t2.csv:377: 52934.422,52934422,1790786218280,-1092,2456250,3931,ok,ok,ok
> raw/cpu-t3.csv:3: 53508.665,53508665,1790786792522,-1200,2332500,3850,ok,ok,ok
> raw/cpu-t3.csv:408: 53916.038,53916038,1790787199896,-1238,2197500,3831,ok,ok,ok
> raw/gpu-t1.csv:3: 51169.172,51169172,1790784453030,-954,2936250,4106,ok,ok,ok
> raw/gpu-t1.csv:144: 51310.926,51310926,1790784594784,-1721,2872500,3915,ok,ok,ok
> raw/gpu-t2.csv:3: 52250.292,52250292,1790785534149,-1057,2647500,4022,ok,ok,ok
> raw/gpu-t2.csv:112: 52359.883,52359883,1790785643741,-1690,2617500,3899,ok,ok,ok
> raw/gpu-t3.csv:3: 53154.565,53154565,1790786438423,-1070,2426250,3964,ok,ok,ok
> raw/gpu-t3.csv:154: 53306.376,53306376,1790786590234,-1841,2366250,3838,ok,ok,ok

The native sampler’s first read is posted immediately, then rescheduled at the configured one-second interval. That makes the first CSV row a sampler-start marker, not a send or native-evaluation marker:

> /Users/marco/Projects/kalsa/src/engine/governorBatterySampler.ts:13: /** The fuel gauge smooths over roughly a second, so faster polling adds nothing. */
> /Users/marco/Projects/kalsa/src/engine/governorBatterySampler.ts:14: const TRACE_INTERVAL_MS = 1000;
> /Users/marco/Projects/kalsa/native/GovernorBatteryModule.kt:126:             if (!handler.post {
> /Users/marco/Projects/kalsa/native/GovernorBatteryModule.kt:127:                 sampleOnce(thread, handler, intervalMs.toLong())
> /Users/marco/Projects/kalsa/native/GovernorBatteryModule.kt:229:         val uptimeMs = SystemClock.elapsedRealtime()
> /Users/marco/Projects/kalsa/native/GovernorBatteryModule.kt:241:                 handler.postDelayed({
> /Users/marco/Projects/kalsa/native/GovernorBatteryModule.kt:242:                     sampleOnce(thread, handler, intervalMs)

Commit has a separate field in the captured governor payload and is only milliseconds; it is not represented by promptMs:

> raw/t1-logcat.txt:2: "commit_ms":13.202,"prefill_ms":46063.861
> raw/gpu-t2-logcat.txt:2: "commit_ms":13.724,"prefill_ms":51230.241
> raw/gpu-t3-logcat.txt:2: "commit_ms":12.983,"prefill_ms":62968.997
> raw/cpu-t1-logcat.txt:2: "commit_ms":0,"prefill_ms":231444.427

The top-level route/decode summaries survive, but four route_chunks arrays end mid-object in the preserved text:

> raw/t1-logcat.txt:2: "engine_prefill":"GPU","engine_decode":"CPU"
> raw/t1-logcat.txt:2: "route_requested":"gpu","route_mode":"gpu","route_push":"applied","route_mismatch":false
> raw/cpu-t1-logcat.txt:2: "engine_prefill":"CPU","engine_decode":"CPU"
> raw/cpu-t1-logcat.txt:2: "route_requested":"cpu","route_mode":"cpu","route_push":"applied","route_mismatch":false
> raw/gpu-t2-logcat.txt:2: "engine_prefill":"GPU","engine_decode":"CPU"
> raw/gpu-t2-logcat.txt:2: "route_requested":"gpu","route_mode":"gpu","route_push":"applied","route_mismatch":false
> raw/cpu-t2-logcat.txt:2: "engine_prefill":"CPU","engine_decode":"CPU"
> raw/cpu-t2-logcat.txt:2: "route_requested":"cpu","route_mode":"cpu","route_push":"applied","route_mismatch":false
> raw/gpu-t3-logcat.txt:2: "engine_prefill":"GPU","engine_decode":"CPU"
> raw/gpu-t3-logcat.txt:2: "route_requested":"gpu","route_mode":"gpu","route_push":"applied","route_mismatch":false
> raw/cpu-t3-logcat.txt:2: "engine_prefill":"CPU","engine_decode":"CPU"
> raw/cpu-t3-logcat.txt:2: "route_requested":"cpu","route_mode":"cpu","route_push":"applied","route_mismatch":false
> raw/t1-logcat.txt:2 (line suffix): {"index":10,"requested"
> raw/cpu-t2-logcat.txt:2 (line suffix): {"index":38,"
> raw/cpu-t3-logcat.txt:2 (line suffix): {"index":38,"requ
> raw/gpu-t3-logcat.txt:2 (line suffix): {"index

Chunk-size fields differ by turn and should not be mislabeled as thread counts:

> raw/t1-logcat.txt:2: "prefill_chunks":"512+512+512+125+512+512+512+512+512+512+10+3"
> raw/cpu-t1-logcat.txt:2: "prefill_chunks":"cpu:512+512+512+125+512+512+512+512+512+512+10+3"
> raw/gpu-t2-logcat.txt:2: "prefill_chunks":"512+512+512+125+512+512+512+512+512+512+10+3"
> raw/cpu-t2-logcat.txt:2: "prefill_chunks":"cpu:128+128+128+128+128+128+128+128+128+128+128+128+125+128+128+128+128+128+128+128+128+128+128+128+128+128+128+128+128+128+128"
> raw/gpu-t3-logcat.txt:2: "prefill_chunks":"128+128+128+128+128+128+128+128+128+128+128+128+125+128+128+128+128+128+128+128+128+128+128+128+128+128+128+128+128+128+128+128"
> raw/cpu-t3-logcat.txt:2: "prefill_chunks":"cpu:128+128+128+128+128+128+128+128+128+128+128+128+125+128+128+128+128+128+128+128+128+128+128+128+128+128+128+128+128+128+128"

The available turn-level thermal labels and post-turn battery temperatures are:

> raw/t1-logcat.txt:2: "thermal_state":"FAST"
> raw/cpu-t1-logcat.txt:2: "thermal_state":"FAST"
> raw/gpu-t2-logcat.txt:2: "thermal_state":"WARM"
> raw/cpu-t2-logcat.txt:2: "thermal_state":"COOLMODE"
> raw/gpu-t3-logcat.txt:2: "thermal_state":"COOLMODE"
> raw/cpu-t3-logcat.txt:2: "thermal_state":"COOLMODE"
> raw/cpu-t1-state.txt:3:   level: 71
> raw/cpu-t1-state.txt:4:   temperature: 419
> raw/gpu-t2-state.txt:3:   level: 68
> raw/gpu-t2-state.txt:4:   temperature: 436
> raw/cpu-t2-state.txt:3:   level: 64
> raw/cpu-t2-state.txt:4:   temperature: 442
> raw/gpu-t3-state.txt:3:   level: 62
> raw/gpu-t3-state.txt:4:   temperature: 456
> raw/cpu-t3-state.txt:3:   level: 58
> raw/cpu-t3-state.txt:4:   temperature: 444

The saved inter-trace samples show the unmatched first gap and the later gaps; they do not themselves establish what the phone was doing between traces:

> raw/gpu-t1.csv:144: 51310.926,51310926,1790784594784,-1721,2872500,3915,ok,ok,ok
> raw/cpu-t1.csv:3: 51741.667,51741667,1790785025525,-1570,2793750,3921,ok,ok,ok
> raw/cpu-t1.csv:309: 52049.472,52049472,1790785333330,-1207,2681250,3927,ok,ok,ok
> raw/gpu-t2.csv:3: 52250.292,52250292,1790785534149,-1057,2647500,4022,ok,ok,ok
> raw/gpu-t2.csv:112: 52359.883,52359883,1790785643741,-1690,2617500,3899,ok,ok,ok
> raw/cpu-t2.csv:3: 52558.162,52558162,1790785842020,-961,2565000,3908,ok,ok,ok
> raw/cpu-t2.csv:377: 52934.422,52934422,1790786218280,-1092,2456250,3931,ok,ok,ok
> raw/gpu-t3.csv:3: 53154.565,53154565,1790786438423,-1070,2426250,3964,ok,ok,ok
> raw/gpu-t3.csv:154: 53306.376,53306376,1790786590234,-1841,2366250,3838,ok,ok,ok
> raw/cpu-t3.csv:3: 53508.665,53508665,1790786792522,-1200,2332500,3850,ok,ok,ok

The raw inventory reports five state files, and only the five non-gpu-t1 state captures are present:

> scratchpad/agents/governor-m1-current/REPORT.md:157: Raw artifacts in raw/: six turn CSVs, six KALSA_TELEMETRY/GOVERNOR logcat
> scratchpad/agents/governor-m1-current/REPORT.md:158: extracts (t1-logcat.txt is gpu-t1's), five state files, splits.txt, table.out,

The coordinator’s documented command list also contains only the five scripted turns after gpu-t1:

> scratchpad/agents/governor-m1-current/REPORT.md:111: | `bash /tmp/m1/turn.sh cpu cpu-t1` | 0 |
> scratchpad/agents/governor-m1-current/REPORT.md:112: | `bash /tmp/m1/turn.sh gpu gpu-t2` | 0 |
> scratchpad/agents/governor-m1-current/REPORT.md:113: | `bash /tmp/m1/turn.sh cpu cpu-t2` | 0 |
> scratchpad/agents/governor-m1-current/REPORT.md:114: | `bash /tmp/m1/turn.sh gpu gpu-t3` | 0 |
> scratchpad/agents/governor-m1-current/REPORT.md:115: | `bash /tmp/m1/turn.sh cpu cpu-t3` | 0 |
## Replacement text for PLAN.md and docs/ALIVE.md

> **Milestone 1 result (S23, 2026-09-30; partial GPU/CPU-prefill trace):** The in-app sampler changed on 99.7–100% of valid adjacent readings. Across three GPU-prefill and three CPU-prefill turns, the observed prefill mean-current difference was about 242 mA. No idle window was captured, so the required comparison against 3× idle standard deviation is untested; backend-current separation is not established. The whole-phone prefill-window integral was approximately 54 vs 224 reported J per 1k tokens under the assumed mA scale, but it includes screen and other device load and largely follows the different prefill durations. It does not establish incremental backend energy or justify energy-per-token learning/ranking. Decode used CPU in all turns, and no NPU-prefill result was obtained.

Use that wording in both living documents. It preserves the observed data while removing the unsupported thermal cause, the unmeasured idle-noise verdict, and the recommendation that contradicts the plan’s fail branch.
