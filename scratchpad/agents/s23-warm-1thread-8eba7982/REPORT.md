# S23 check - WARM keeps the NPU lane + one host thread on HTP (app 8eba7982, kalsa.rn 6752f659, kalsallama 60b83719)

2026-10-03 16:48-16:52 EDT, S23 unplugged (47 %), APK CI run 37149170024 (debuggable, sha256 232b5cd1...),
skels in the APK byte-identical to the binding manifest; `adb install -r`. Protocol, prompts and key handling
exactly as `s23-every-snapdragon-ac04c939` (npu_lane/route keys deleted for the turns = production defaults,
restored after: `raw/keys-found.txt` == `raw/keys-restored.txt`).

| turn | state | temp pre/peak C | engine_prefill | layers | prefill tok/s | decode tok/s |
|---|---|---|---|---|---:|---:|
| wt-s1 | FAST | 30.6 / 35.0 | NPU | HTP0x6 | 706.8 | 11.10 |
| wt-s2 | FAST | 35.0 / 36.6 | NPU | HTP0x6 | 707.7 | 10.86 |
| wt-s3 | WARM | 38.6 / 39.3 | **NPU** | HTP0x6 | 706.7 | 9.41 |

- **One host thread on the HTP prefill context costs nothing in the app**: 706.7-707.7 tok/s vs 703.2-707.7 on
  ac04c939 (5 threads). The audit's worry (CPU-fallback ops slowed by one thread) does not show on this model.
- **WARM now reports and runs NPU** (ac04c939's WARM turn reported `engine_prefill:"GPU"` while running on HTP0).
- 3/3 answers correct, 0 crash markers, attempt 1, failed false.
