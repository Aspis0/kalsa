# S23 (Adreno 740) vs Q4_K_M: reproduce the 750 KLD gate measurement

Target: unplugged Galaxy S23 (SM-S911U, Adreno 740, driver E031.41.03.62).
Engine: fork worktree `/Users/marco/Projects/kalsallama-wt-1068` at commit `1068eb03d301a1dcb657f4e6923fe77678e651ee`.
Question: does 740 + Q4_K_M meet the conjunctive gate (median KLD <= 0.005 AND same-top >= 95%), or fail like the 750 did (94.826%, median KLD 0.004736)?

## 1. Device preflight

- Device serial (this session): `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp` (SM-S911U = Galaxy S23).
- Jelly Star `192.168.1.82:5555`: present on adb, NOT touched.
- Charger gate: `dumpsys battery` reports `AC powered: false`, `USB powered: false`, `Wireless powered: false`, `status: 3` (discharging), `Charging state: 0`, `current now: -357` (discharging), level 79%, temp 26.2 C. Last `ACTION_POWER_DISCONNECTED` at 09-21 17:11:37, no connect since.
- **Phone is UNPLUGGED -> run permitted.**
- No device settings changed, no apps opened/installed/uninstalled, no app data cleared.

## 2. Tool check: do the KLD flags exist at 1068eb03d?

YES - verified in two ways (device `--help` output recorded in section 4 below):

- Source at `1068eb03d`: `common/arg.cpp:2502` registers `--kl-divergence` ("computes
  KL-divergence to logits provided via --kl-divergence-base"); `common/arg.cpp:2509`
  registers `--save-all-logits, --kl-divergence-base FNAME` ("set logits file").
  `tools/perplexity/perplexity.cpp:1695` implements `kl_divergence()`, and its printer
  emits `Median  KLD:` and `Same top p:` - the exact statistics of the held acceptance.
- The run mode: pass `--kl-divergence-base FILE` WITHOUT `--kl-divergence` to save the
  reference logits (CPU arm); pass `--kl-divergence --kl-divergence-base FILE` to compare
  against them (GPU arm). This is the documented workflow in `tools/perplexity/README.md`.

No substitution of metric needed. Measurement proceeds in the KLD family.

## 3. Protocol recovered from the 750 acceptance (same instrument, verbatim commands)

The held numbers (94.826% same-top, median KLD 0.004736, PPL delta +0.349) come from the
`adreno-acc-type` cell, run 2026-09-07 on QRD serial `80003b9c` (Adreno 750), archived at
`scratchpad/agents/adreno-acc-type/raw/sa812265b/`. Exact commands (from `adb-exit.log`):

CPU arm (produces base):
```
cd '/data/local/tmp/kalsa-acc-type/kit-gemm-acc-probe' && export LD_LIBRARY_PATH='.../lib' && rm -f cpu.kld && \
./bin/llama-perplexity -m 'LFM2.5-2.6B-QAD-Q4_0.gguf' -f corpus.txt -c 256 -b 256 -ngl 0 -fa off -s 42 --temp 0 --kl-divergence-base cpu.kld
```
GPU arm (compares):
```
./bin/llama-perplexity -m 'LFM2.5-2.6B-QAD-Q4_0.gguf' -f corpus.txt -c 256 -b 256 -ngl 99 -fa off -s 42 --temp 0 --kl-divergence --kl-divergence-base cpu.kld
```
Reference log lines from `cpu-kld.log` (750): `calculating perplexity over 14 chunks,
n_ctx=256, batch_size=256, n_seq=1`, CPU arm 35 s, `Final estimate: PPL = 22.9415`.
Output block from `variant-stock-mul.log` (the accepted run):
`Mean PPL(Q)-PPL(base) 0.349474`, `Median KLD: 0.004736`, `Same top p: 94.826 +/- 0.525 %`.

Differences for THIS run (declared, per the task): same instrument, same seed/context/run
length (`-c 256 -b 256 -s 42 --temp 0 -fa off`), same corpus file (see section 5), but
model = `LFM2.5-2.6B-Q4_K_M.gguf` (the excluded-by-acceptance quant) and device = S23
Adreno 740. The 750 model was `LFM2.5-2.6B-QAD-Q4_0.gguf`; the acceptance explicitly
excluded q4_K, which is exactly what we measure now.

## 4. Build and deploy

- Build: `cd /Users/marco/Projects/kalsallama-wt-1068/build-android-ocl-1068 && ninja llama-perplexity`
  -> 4/4 targets, rc=0. No other agent was using the dir (no ninja process, build.ninja not open).
- Worktree HEAD: `1068eb03d301a1dcb657f4e6923fe77678e651ee` (2026-09-21 15:33:53 -0400,
  "gpu: no exit(1) on the OpenCL compile path, verdict keyed on the kernel set, V73 GPU prefill lane").
- Binary sha256: `7276aafd8269905782160f59650f6a8f96d20ec390be4cfcc7d78859d0ab7479`
  (`bin/llama-perplexity`, 119689504 bytes, built fresh in this session).
- `llvm-readelf -d` NEEDED: `libomp.so, libm.so, libdl.so, libOpenCL.so, libc.so`.
  Per the archived 1068eb03d S23 cell (`s23-native-gpu-bench`): `libOpenCL.so` resolves
  from `/vendor/lib64` automatically (Qualcomm direct impl, no LD_LIBRARY_PATH needed);
  `libomp.so` is NOT on the device and must ship with `LD_LIBRARY_PATH` (NDK r29 clang-21
  aarch64 runtime, sha256 `b0b507bb9e89360304272ba335d5fb2f6661f88842c2b3c749474cb7b8acda76`).
- Device re-check before push: still `AC/USB/Wireless powered: false`; /data has 35 GB free.
- Model reused on phone: `/data/local/tmp/llamabench/LFM2.5-2.6B-Q4_K_M.gguf`
  (1674454848 bytes) - no 1.5 GiB push.
- Device `--help` transcript: section 6 below - flags confirmed present on-device.

## 5. Corpus (no default exists; the 750's corpus reused)

`-f/--file` default is `none`, so the tool has no default corpus; we supply the SAME file
the 750 acceptance used: `adreno-precision-bisect/corpus.txt` (English prose, 18233 bytes,
3079 words). md5 on Mac and on device both `1d037601b756c2cdc94292273b8bce34` - identical
to what produced 0.004736 / 94.826%. Run length: `--chunks -1` (default = ALL chunks);
the 750 log shows this corpus yields 14 chunks at n_ctx=256, n_seq=1 (expected to be
verified in this run's own log).

## 6. On-device --help gate (rc=0, this binary, this build)

```
--kl-divergence                         computes KL-divergence to logits provided via --kl-divergence-base
--save-all-logits, --kl-divergence-base FNAME
                                        set logits file
-f,    --file FNAME                     a file containing the prompt (default: none)
-fa,   --flash-attn [on|off|auto]       set Flash Attention use ('on', 'off', or 'auto', default: 'auto')
-s,    --seed SEED                      RNG seed (default: -1, use random seed for -1)
--temp, --temperature N                 temperature (default: 0.80)
--chunks N                              max number of chunks to process (default: -1, -1 = all)
```

Flags EXIST -> the measurement runs in the KLD family, no metric substitution.

## 7. Commands (device serial adb-R3CW406P8CV-zyLM4b, dir /data/local/tmp/s23-kld-740)

Deployed this session: `llama-perplexity` (sha256 7276aafd..., 119689504 B),
`lib/libomp.so` (NDK r29, sha256 b0b507bb...), `corpus.txt` (md5 1d037601...).
Model reused: `/data/local/tmp/llamabench/LFM2.5-2.6B-Q4_K_M.gguf`.

CPU arm (reference logits):
```
cd /data/local/tmp/s23-kld-740 && \
LD_LIBRARY_PATH=/data/local/tmp/s23-kld-740/lib TMPDIR=/data/local/tmp/s23-kld-740 \
./llama-perplexity -m /data/local/tmp/llamabench/LFM2.5-2.6B-Q4_K_M.gguf \
  -f corpus.txt -c 256 -b 256 -ngl 0 -fa off -s 42 --temp 0 \
  --kl-divergence-base cpu.kld
```

GPU arm (comparison):
```
cd /data/local/tmp/s23-kld-740 && \
LD_LIBRARY_PATH=/data/local/tmp/s23-kld-740/lib TMPDIR=/data/local/tmp/s23-kld-740 \
./llama-perplexity -m /data/local/tmp/llamabench/LFM2.5-2.6B-Q4_K_M.gguf \
  -f corpus.txt -c 256 -b 256 -ngl 99 -fa off -s 42 --temp 0 \
  --kl-divergence --kl-divergence-base cpu.kld
```

Flags, seed, context, batch, corpus, run length identical across arms; `-fa off` on BOTH.

## 8. Results (sampled, both arms rc=0)

Charger re-checked before and after the arms: AC/USB/Wireless powered all false, status 3
(discharging) throughout; battery 79% -> 75% during the runs (draining, not charging).

CPU arm (raw: `raw/cpu-arm.log`):
- `calculating perplexity over 14 chunks, n_ctx=256, batch_size=256, n_seq=1`
- Final estimate: PPL = 27.2114 +/- 2.08767 (750's CPU arm on its model: 22.9415)
- wrote `cpu.kld` (455196580 bytes)

GPU arm (raw: `raw/gpu-arm.log`), computed against that reference:

| statistic | THIS run: 740 + Q4_K_M | 750 acceptance (Q4_0, 2026-09-07) | gate |
|---|---|---|---|
| Median KLD | **0.394993** | 0.004736 | <= 0.005 |
| Same top p | **63.892 +/- 1.139 %** | 94.826 +/- 0.525 % | >= 95 % |
| Mean PPL(Q)-PPL(base) | -0.727638 +/- 1.031892 | +0.349474 +/- 0.084951 | (reported, not gated) |
| Mean KLD | 0.661847 +/- 0.023464 | 0.006651 +/- 0.000186 | (reported, not gated) |
| Mean PPL(Q) / PPL(base) | 26.475441 / 27.203079 | - / - | - |
| sample size (scored token positions) | 1778 (= 127 per chunk x 14 chunks) | same construction | - |
| corpus / run length | corpus.txt, 14 chunks, all of it (`--chunks` default -1) | identical | - |

Sample size cross-check: the tool's same-top binomial uncertainty 1.139% =
sqrt(0.63892*0.36108/1777) -> n = 1778 confirmed.

### VERDICT: GATE NOT MET

- Median KLD limb: 0.394993 > 0.005 -> **FAIL** (79x over the threshold; 83x the 750's
  0.004736).
- Same-top limb: 63.892% < 95% -> **FAIL** (31.1 pp short; 30.9 pp below the 750's 94.826%).
- Conjunctive gate requires BOTH -> **NOT MET**.

Does it fail the same way the 750 did? **No - it fails much harder, and differently.**
The 750 failed by a hair on ONE limb (94.826% vs 95%) while its KLD limb PASSED
(0.004736 <= 0.005). The 740 + Q4_K_M fails BOTH limbs by wide margins. Its numbers
(0.395 / 63.9%) sit in the same regime as the 750's PRE-f32-fix measurement archived in
`gemm-f32-ship/PLAN.md` (0.4538 / 62.8%) - i.e. on this phone, with this quant, the engine
behaves like the unfixed path. Whether the f32-product kernel set even engages for Q4_K_M
on the 740 is NOT VERIFIED here; this run measures the outcome, not the kernel provenance
(the perplexity tool does not print the ggml OpenCL banner; known archived finding).

Provenance of the GPU device for THIS run: `raw/opencl-banner.log` (captured with the same
worktree's already-built `test-backend-ops`, no new build): `QUALCOMM Adreno(TM) 740`,
`OpenCL driver: OpenCL 3.0 QUALCOMM build: 0676.73 Compiler E031.41.03.62`,
platform `QUALCOMM Snapdragon(TM)` - matches the target phone and driver.

## 9. Secondary: CPU top1-top2 margin at first divergent step

NOT AVAILABLE. `llama-perplexity` in KLD mode prints only aggregate statistics (percentiles
of KLD and of delta-p); it has no flag to dump per-token probabilities or a top1-top2 margin,
and no generation loop exists in this mode - "the first divergent step" of generation is
outside this instrument entirely. Verified against `--help` output and the source of
`tools/perplexity/perplexity.cpp` at 1068eb03d: no such option. No instrument invented.

## 10. Cleanup and final device state

- Removed: `/data/local/tmp/s23-kld-740/` in full (llama-perplexity, test-backend-ops,
  lib/libomp.so, corpus.txt, cpu.kld, cl-cache). Verified gone (`No such file or directory`).
- LEFT BEHIND on the phone from this session: **nothing**.
- Untouched, as found: `/data/local/tmp/llamabench/` (both .gguf models, including the
  reused 1674454848-byte LFM2.5-2.6B-Q4_K_M.gguf), `wiki.test.raw`, and every other
  pre-existing entry in `/data/local/tmp` (post-run listing matches the pre-run listing).
- Not done, per rules: no app opened (Kalsa app never launched), no install/uninstall,
  no app data cleared, no device setting read-or-written beyond `dumpsys battery`
  (read-only), Jelly Star `192.168.1.82:5555` never contacted, phone unplugged for the
  entire session (charger status read 5x: preflight, pre-push, pre-CPU, pre-GPU, post-run).
- Host: no commit, no push. Report only at
  `Projects/kalsa-moe-experiments/scratchpad/agents/s23-kld-740-q4km/REPORT.md`;
  raw logs in `raw/` of the same dir (`cpu-arm.log`, `gpu-arm.log`, `opencl-banner.log`,
  help transcript `/tmp/s23_kld_help.txt`).

## 11. One-line answer

740 + Q4_K_M does NOT meet the gate: median KLD 0.394993 (threshold 0.005) and same-top
63.892% (threshold 95%), n=1778 scored positions over the full 14-chunk corpus, both arms
`-fa off`, seed 42, engine 1068eb03d - a hard fail on both limbs, not the 750's near-miss.
