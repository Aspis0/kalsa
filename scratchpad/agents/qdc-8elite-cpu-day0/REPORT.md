# REPORT — qdc-8elite-cpu-day0

Device: QRD8750/SM8750 (Sun_for_arm64), serial `eb49fb9d`, adb port **6037**. PLUGGED DECLARED (rack). dumpsys AC/USB/Wireless all false the whole session — not an unplugged claim. Jelly/5037 not touched.

Kit: `bin-a0cabca6b` (c750342f = main a0cabca6b + CI yml), CPU-only. Model: OLMoE Q4_K_M 4,213,513,024 B, Mac sha `3bd9ec48…`, on-device size exact match.

## Correctness

| invocation | result | rc |
|---|---|---:|
| `test -o MUL_MAT` (no `-b`) | CPU skipped (test-mode uses CPU as reference) | 0 |
| `test -o MUL_MAT -b CPU` | **1144/1144 passed** (incl. q2_K / q3_K) | 0 |
| `test -o MUL_MAT_ID -b CPU` | **812/812 passed**, 0 FAIL | 0 |

Gate: PASS. Speed cells ran.

Note: kit ELF stubs needed same-build `.so` from `kalsallama/build-android/bin/` + NDK r29 `libomp.so`. First link failed without them; hashes in RUN_LOG.

## Speed (llama-bench `-r 3 -ngl 0`, N=3 interleaved invocations)

Median of the three **invocation** `avg_ts` (each invocation already averages 3 internal reps). Downward drift across the three launches. No verdict vs #20.

| config | r1 | r2 | r3 | **median** |
|---|---:|---:|---:|---:|
| t=8 tg128 | 63.527 | 59.095 | 58.095 | **59.095** |
| t=8 pp512 | 98.423 | 92.996 | 90.491 | **92.996** |
| t=6 tg128 | 54.736 | 52.504 | 51.505 | **52.504** |
| t=6 pp512 | 76.573 | 75.514 | 74.318 | **75.514** |

Read-only comparator (not a verdict): #20 S23 OLMoE tg128 CPU **27.685** t/s (unplugged). This cell is plugged, Oryon, same GGUF bytes.

`no_repack=false` (llama-bench default; prereg did not pass `-nr`).

## Temp

- `dumpsys battery` temperature **430 (43.0 °C) on every sample** (25 watch rows + 24 pre/post). Looks like a stub; do not treat as a live sensor.
- `dumpsys thermalservice` HAL, pre-bench: CPU ~39–41 °C, battery 43.0, skin 37.0, Thermal Status **0**.
- Post-bench: CPU ~53–55 °C, skin 47.6 (status 1), Thermal Status **1**. Battery HAL still 43.0.

## Time

Model push 171 s. Correctness ~2 min. t=8 matrix ~1.7 min. t=6 matrix ~2 min. Cell wall from kit push to stop ~20 min. Hard cap not hit.

No commit.
