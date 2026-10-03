# S23 regression check - every-Snapdragon build (app `ac04c939`, kalsa.rn `e3ee58d7`, kalsallama `0917c693`)

Date 2026-10-03, 13:03-13:15 EDT. Galaxy S23 (SM8550, Hexagon v73), wireless adb `192.168.1.152:35017`,
UNPLUGGED every turn (`raw/esd-*-battery-pre.txt`), `persist.traced.enable=0`. APK: CI run `37135421002`,
debuggable, sha256 `9976d6de...2169f0`; the four skels in the APK are byte-identical to the binding manifest
`bin/arm64-v8a/HTP_SKELS`, and the core lib carries the new `registering no HTP device` strings. Installed with
`adb install -r` (no uninstall, data kept). Protocol and prompts: `s23-option-a-speed-7ec12eb0/raw/turn.sh`
reused unchanged except paths (prompts sha256-identical). Production defaults under test: `kalsa.bench.npu_lane`
and `kalsa.bench.route` DELETED for the session (governor ON, lane "auto"), restored after
(`raw/keys-found.txt` == `raw/keys-restored.txt`).

## Verdict

**No regression on v73.** The NPU lane now gates on the RUNTIME HTP arch (`getBackendDevicesInfo` ->
`Hexagon v<NN>`) instead of the SoC name, and on the S23 it still opens by default: plan `npu_lane:"auto"`,
`npu_fit:"Fit"`, `npu_device:"HTP0"`, every chunk `layers_device:"HTP0"` (29/29), KV on device q8_0/q8_0.
Prefill matches the 2026-10-02 option-(a) run: short 707.7 / 703.9 / 703.2 tok/s (ref median 706.7), long
654.1 (ref 661.4, -1.1 %). Decode 10.60 / 10.20 / 10.11 short (ref 10.58), 8.74 long (ref 9.10 / 8.94). 4/4
answers correct and on topic, 0 watchdog kills (peak 41.7 C), 0 crash markers (the one `dspqueue_` hit is the
successful open of `libdspqueue_rpc_skel.so`), attempt 1, failed false on every turn.

| turn | state | temp pre/peak C | engine_prefill | layers | prefill tok/s | decode tok/s |
|---|---|---|---|---|---:|---:|
| esd-s1 short | FAST | 30.2 / 33.5 | NPU | HTP0x6 | 707.7 | 10.60 |
| esd-s2 short | FAST | 35.9 / 36.6 | NPU | HTP0x6 | 703.9 | 10.20 |
| esd-s3 short | WARM | 38.6 / 39.2 | **GPU (label)** | HTP0x6 | 703.2 | 10.11 |
| esd-l1 long | COOLMODE | 39.0 / 41.7 | NPU | HTP0x11 | 654.1 | 8.74 |

## Device-confirmed pre-existing defect (backlog, audit luna f718f7ec #2)

esd-s3 ran in WARM: the policy reported `engine_prefill:"GPU"` while all 6 chunks ran `layers_device:"HTP0"`
at the same 2.47 s. With the lane resolved the single prefill context is HTP-pinned, so a "GPU" route is
computed on HTP: the result is correct and actually the cooler backend, but the label lies. Not introduced by
this build.

## Not shown

The `ggml-hex: Hexagon Arch version v73` INFO line does not reach logcat (registration precedes the log hook);
the runtime arch read is proven indirectly: the auto lane opens only on a parsed arch >= 73.
