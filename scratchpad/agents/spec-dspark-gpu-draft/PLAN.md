# PLAN — DSpark speculative decoding on the Galaxy S23 (CPU target / CPU+GPU draft)

**Status: PREP ONLY (no device touched).** Engine `kalsallama` branch `kalsa-opencl-upload-oom-throw` @ `f25f0c1c5`.
Target: `/Users/marco/kalsa-models/mac/LFM2.5-2.6B-QAD-Q4_0.gguf` sha `a247afd6…40b03` (1,593,894,944 B).
Draft: `/Users/marco/kalsa-models/mac/LFM2.5-2.6B-DSpark-Q8_0.gguf` sha `85a98faf…386c87` (356,491,776 B, arch `dflash`,
vocab 128000 = target, `markov_w1/w2` + `conf_proj` present; Q8_0 chosen: <1 GB and GEMM-capable in our OpenCL backend).
Kit: `/Users/marco/kalsa-qdc/dspark-spec-v73/dspark-kit-f25f0c1c5.tgz` sha `bd6be0a4…45447df` (10,151,778 B,
sums in `raw/kit_SHA256SUMS.txt`, recipe in `KIT-BUILD.md`) = npu-spec-verify stage libs + stripped
`llama-speculative-simple` (built this cell, aarch64, OpenCL in) + `llama-completion`. Host smoke passed (see below).

## Arms (one run each; frozen prompt, greedy, -n 127)

Prompt = qdc-heat-per-backend frozen prompt `PROMPT.txt` (`2a4b5deaa3…6d9967d0ea1`, 3833 B, variant 1010), passed as
`-p "$(cat PROMPT.txt)"`. Greedy `--temp 0 --top-k 1`. `-t 8 -ngl 0` everywhere. Cooldown between arms until gate passes.

| arm | binary | flags (beyond common) |
|---|---|---|
| A: CPU target alone | `llama-completion` | `-n 127` only (spec-simple cannot run draft-less: "failed to initialize speculative decoding", EXIT=1, recorded in `raw/host_armA_*_check.log`) |
| B4 / B8: target CPU + DSpark draft CPU | `llama-speculative-simple` | `-md DRAFT --spec-type draft-dspark --spec-draft-n-max 4\|8 -ngld 0` |
| C4 / C8: target CPU + DSpark draft GPU | `llama-speculative-simple` | as B + `-devd GPUOpenCL -ngld 99` (OpenCL device name to confirm on-device with `--list-devices`; backend name is `GPUOpenCL`, description `Adreno(TM) 740`) |

Record per arm: `decoded N tokens in X s, speed Y t/s` (A: `eval time … tokens per second`), `n_drafted`, `n_accept`,
`accept %`, wall time, battery/thermal snapshot. Known caveat: A is a different binary than B/C (same engine, same
decode path minus speculation) — note it in the report.

**Proof the draft ran on GPU (arm C; missing all ⇒ METHOD-VOID, not a number):**
1. `ggml_opencl: device: 'Adreno(TM) 740 (…)'` init line (OpenCL only initializes when a GPU device is used);
2. spec trace `- gpu_layers=99, … devices=[GPUOpenCL]` (vs `devices=[default]` / `gpu_layers=0` in B);
3. draft load line `offloading N repeating layers to GPU` / `offloaded N/N layers to GPU` for the *second* model,
   while the target stays on CPU (`-ngl 0`);
4. with `GGML_OPENCL_LOG_WEIGHT_PATH=1`: at least one `OPENCL_WEIGHT_PATH{…}` line;
5. no `warning: no usable GPU found` in arm C.
Counter-check: B must show `devices=[default]` and zero `ggml_opencl:` lines.

## Predictions (written 2026-09-26, BEFORE any device run — do not edit after)

- A ≈ 16–19 t/s (banked: S23 CPU pp1 18.77 ± 0.59 t/s, npu-spec-verify Step 0).
- Acceptance: 45–55 % (host smoke: 51.25 %, n_max 3, greedy); B and C within ±3 pp of each other.
- B4 ≈ A ± 15 % (S23 CPU verified K=4 at 1.42× one step, so verification is cheap; the 356 MB draft step is the
  added cost) — my bet: slightly slower than A (−10 %).
- C4 ≥ B4 (draft GEMMs leave the CPU), +10–30 % over B4; still ≈ A ± 15 %. OpenCL batch-1 dispatch may eat the win.
- n_max 8 vs 4: ≈ ±10 %; at α≈0.5 the extra drafted tokens buy little — expect no clear winner, B8/C8 ≤ B4/C4 if α < 0.55.

## Owner gates for the phone (checked before each arm, refuse = no timing)

Stop/refuse if battery temperature **≥ 44.0 °C**, thermal status **≥ 3**, battery level **≤ 25 %**, or **plugged in**
(project rule: never benchmark while charging). Screen must be **Awake** (checked and kept awake). Log every snapshot.
No adb from this cell — the S23 belongs to the coordinator until the owner hands it over.

## Unverified after this prep

Everything device-side: `--list-devices` output, OpenCL draft offload actually working (`-devd GPUOpenCL -ngld 99`
never parsed on-device), q8_0 GEMM correctness on Adreno 740 for this drafter, tok/s, acceptance on-device, thermal
behaviour, and whether arm A's binary difference biases the comparison. Host smoke = CPU only, one prompt, n_max 3.
