# RUN_LOG — qdc-8elite-cpu-day0

Prereg locked f72b1b20. Device: QRD8750/SM8750 Sun_for_arm64, serial `eb49fb9d`, adb `ANDROID_ADB_SERVER_PORT=6037`. PLUGGED DECLARED (rack). Jelly/5037 not touched.

## Device snapshot (before kit)

- nproc=8, Cpus_allowed_list=0-7, cpuset=/
- dumpsys battery: AC=false USB=false Wireless=false status=3 level=100 temperature=430 (43.0 °C)
- Plugged declared per prereg despite dumpsys AC false (rack power path not shown as AC). No unplugged claim.
- df /data/local/tmp: 45G total, 43G avail.

## Kit push

Kit: `~/kalsa-qdc/bin-a0cabca6b/` (a0cabca6b, android-28, GGML_OPENCL=OFF). Dest `/data/local/tmp/kalsa/`. chmod 755.

| file | bytes | kit SHA256 = device SHA256 |
|---|---:|---|
| llama-bench | 7208 | 62d2fe5eb141b329008c027df25d9644a63fddfc9273dfbde929f31f2c097f4f |
| llama-cli | 7232 | 5b17ac8b34051e86fb9da89dc51181046202d1e582c1249a5b6d77ad17d98fe2 |
| test-backend-ops | 9724152 | 715ff176bef628ee1c71e5f2755b4c02354107c74f84111e51648ca98612d752 |

3/3 MATCH. mkdir/push/chmod all rc=0.

Kit stubs need the same-build .so from `~/Projects/kalsallama/build-android/bin/` (byte-identical llama-bench/test-backend-ops SHA). First correctness attempt: CANNOT LINK libllama-common.so. Pushed:

| file | device SHA256 |
|---|---|
| libggml-base.so | b4db54e108652819d7a829de4a0a85cd6ae976b5d7db19db23037dff222581fa |
| libggml-cpu.so | 2d63f5f8df76dbfb761e9009e575add0847282651d0ecad91114a0a3581b493e |
| libggml.so | 0d8afd1ba9255a3e7cb4027cf1b065b6142bcc304c3dcf5252b8cd46d0c6ca4d |
| libllama.so | 42c26807e3186fbf7c3f28e333602f4db4c20d984f0638606dbd602ecca0d400 |
| libllama-common.so | 45d976298fda679001b5d5d0366b26e51c05f782b2faa5e0c5367d88b72d1449 |
| libllama-bench-impl.so | e0e5ba0b6dd1da0f12f7a35617e65d58bfe6f220f92ac50aaae880871594f295 |
| libomp.so (NDK 29.0.14206865 aarch64) | b0b507bb9e89360304272ba335d5fb2f6661f88842c2b3c749474cb7b8acda76 |

## Model

Mac sha256 before push: `3bd9ec48045f526508956ef663c5c11dbb3ef791a06f4e10a6be88379c40e1fe` (4213513024 B).
adb push rc=0, 23.5 MB/s, 170.6 s. On-device size **4213513024** MATCH.

## Correctness

Literal `./test-backend-ops test -o MUL_MAT` (no `-b`): **Skipping CPU backend** (CPU is the reference in test mode; CPU-only kit). rc=0, 0 cases. Not a FAIL, also not a sweep.

Real CPU gate (`-b CPU`, required or CPU is skipped):
- MUL_MAT: **1144/1144** passed, rc=0, 0 FAIL. Includes q2_K/q3_K.
- MUL_MAT_ID: **812/812** passed, rc=0, 0 FAIL.

dumpsys throughout: level 100, temperature 430 (43.0 °C), AC=false. PLUGGED DECLARED.

## Speed

llama-bench `-t {8,6} -r 3 -ngl 0 -o jsonl`, interleaved tg128 (`-p 0 -n 128`) / pp512 (`-p 512 -n 0`), N=3 process launches each. All rc=0. build_commit `c750342f5`.

t=8 tg128 avg_ts: 63.527 / 59.095 / 58.095  median **59.095**
t=8 pp512 avg_ts: 98.423 / 92.996 / 90.491  median **92.996**
t=6 tg128 avg_ts: 54.736 / 52.504 / 51.505  median **52.504**
t=6 pp512 avg_ts: 76.573 / 75.514 / 74.318  median **75.514**

Watch 10 s: `raw/thermal_watch.csv` (25 rows, all temp=430, level=100, ac=false).
thermalservice HAL CPU 39–41 °C → 53–55 °C; status 0 → 1.

Stop. No commit. Comparator #20 listed in REPORT, no verdict.



