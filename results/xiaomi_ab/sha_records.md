# SHA records — Xiaomi A/B night

## Device binaries (on-device sha256sum)

| file | sha256 | note |
|---|---|---|
| llama-cli | `4986ff30447cb866656bce6762e6d30266669a2ebc4055a9c2ada00b9e4fdd80` | cpufix a92a51627, matches mandate |
| llama-bench | `5092a319dd43a4e62095cc49ce15b329be96d0188734e7380d8935fe56b01ea3` | same pin, stripped |
| libc++_shared.so | `e69496a4aeb51ebe61d0775ae9fefc76eee640f12317aa5174da67e5d4ec8fd6` | NDK |
| fadv | rebuilt NDK 27.1 aarch64-linux-android26, dynamic (static rejected: TLS align 8 vs 64) | `scripts/fadv.c` |

## Models

| file | size | sha256 | status |
|---|---:|---|---|
| Qwen3.5-2B-Q4_K_M.gguf (on device) | 1280835840 | `aaf42c8b7c3cab2bf3d69c355048d4a0ee9973d48f16c731c0520ee914699223` | from gdn-750 report |
| Qwen3.5-4B-Q4_K_M.gguf (PC draft/) | 2740937888 | `00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4` | PC verified 2026-08-12 |
| Qwen3.5-4B-Q4_K_M.gguf (on device) | 2740937888 | `00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4` | device sha256sum MATCH after 187 s push |
| Qwen3.6-35B-A3B-KEXP.gguf (PC) | 13416430592 | `ac44e20c1783b9105b83246fd8ce59892b47a265b84e1323a8a501929877721a` | PC verified 2026-08-12 |

## Prompts

| file | sha256 | bytes |
|---|---|---:|
| results/xiaomi_ab/prompts/ttft_2b_1000.txt | `c3faee01d06389536a73a774d7e7199d13222f66bd397b8ab20d478a3161a456` | 4335 |
| results/marco_phase1/speed_s23/prompts/p_fact.txt | `b5301c32c0bd8aae4cf5c25d667a52eef05b940a459a2e9c82b1b6134cf0dcbd` | 361 |
| results/marco_phase1/speed_s23/prompts/p_creative.txt | `761db0d07cbc312acb35fb8c64894be83f38a3a7f0ba14e2100ef6a44a29c871` | 268 |

## Campaign binary (needed for B)

Expected `1ca51420476d4a979552448f1c0b5bc48a04ed2e43643543ce43fa7566bb022f`
S23 path: `~/src/BigMoeOnEdge/build-bmoe/cli/bmoe-cli.CAMPAIGN`
PC copy: `results/xiaomi_ab/bmoe-cli.CAMPAIGN` (402416 B)
Pulled from S23 via scp 2026-08-13 (K4 N1/N2 live — file pull only, no other S23 contact).
PC sha256: `1ca51420476d4a979552448f1c0b5bc48a04ed2e43643543ce43fa7566bb022f` MATCH.

Campaign CLI is dynamically linked. Companion libs pulled from the same S23
`build-bmoe/bin/` (same class of file pull; N1/N2 not timed):

| file | size | sha256 |
|---|---:|---|
| libggml-base.so.0.16.0 | 1792136 | `c61bd1321db163d4c545b6df0a570edb4a849de6aacb84104b345b1304a01e99` |
| libggml-cpu.so.0.16.0 | 999528 | `ba1a7dee19a16059ae103ad300ecfed947cdf0b1d06197b1237fa96eb647db1d` |
| libggml.so.0.16.0 | 82096 | `212505003ac910b1d8b2ce6a41e51d2219e3c41ce46c383c1047cccb19e21f8d` |
| libllama-common.so.0.0.9965 | 6244696 | `939062a45741c32bcad2c3bf4004c6c421f6c39486c8d02daed0992431da5b5e` |
| libllama.so.0.0.9965 | 3438704 | `96526746ffbaafaf773ed8f76dea3500390a20ba6866e068aeb090997852626a` |

Not yet on Xiaomi (push after Task A 4B clean finishes — do not I/O-contaminate cells).

Fallback (unused unless campaign pin fails on device): `results/k4split/bin/bmoe-cli`
108997408 B sha `b8b1c732064f5f1d8e0d6ba3f5257af51bfe3d40ccb71ecaad49911677c815ab`
(static, only libc/libc++/OpenCL). If used, label the run "k4 binary, not campaign pin".

## SM8650 cpu_capacity (this unit)

`cpu0=379 cpu1=379 cpu2=923 cpu3=923 cpu4=923 cpu5=867 cpu6=867 cpu7=1024`
Max=1024, 50% threshold=512. Cores ≥512: cpu2–cpu7 → **`-t 6`**.
Two A520 (cpu0/cpu1, 379) excluded. Matches `reports/moe-gdn-750.md`.
