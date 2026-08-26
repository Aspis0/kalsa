# S23 day-1 storage ledger

Status: READ-ONLY audit, 2026-08-26. Device selected exactly as listed by `adb devices -l`:
`adb-R3CW406P8CV-zyLM4b (2)._adb-tls-connect._tcp`. Xiaomi `625689a2` and Jelly were not touched.

## Capacity and collection

`df -h /data`:

```text
Filesystem       Size Used Avail Use% Mounted on
/dev/block/dm-60 104G  96G  8.0G  93% /data/user/0
```

`/data/local/tmp`: 1,270 files in 38 grouped directories. `inventory.json` is exhaustive: path, byte size, mtime, and SHA-256 for every non-GGUF file below 100 MiB. GGUFs and files >=100 MiB are size+mtime only, as requested. `du -sh` was collected for each top-level `/data/local/tmp` entry; the byte totals below are the exact recursive sums behind that read.

Termux probe: `TERMUX_UNREADABLE` for `/data/data/com.termux`. No Termux path is a deletion candidate.

## Recursive `du` groups

| entry | bytes | approx. | purpose / cross-reference |
|---|---:|---:|---|
| `Marco-Mini-Instruct.i1-Q4_K_M.gguf` | 10,505,424,704 | 9.78 GiB | old non-target Marco; `results/lineup_abs_s23/MANIFEST.md` calls it superseded |
| `Marco-Mini-Instruct-KEXP-fromsrc-trunk-q8_0.gguf` | 6,509,642,624 | 6.06 GiB | old from-source KEXP; Phase 1 target is the PC `Marco1c-KEXP` copy |
| `s3oracle/` | 4,369,672,848 | 4.07 GiB | KEEP: Phase 1 pinned deployment; `results/barrier_verify_s23/`, `results/olmoe_gpu_moe_s23/`, PLAN §3 |
| `OLMoE-1B-7B-0924-Instruct-Q4_0.gguf` | 3,928,037,856 | 3.66 GiB | old quant; Phase 1 target is Q4_K_M |
| `LFM2.5-8B-A1B-KEXP-fromsrc-trunk-q8_0.gguf` | 3,580,407,296 | 3.33 GiB | historical KEXP experiment; PLAN/ALIVE model campaign |
| `LFM2.5-8B-A1B-KEXP.gguf` | 3,326,160,384 | 3.10 GiB | historical KEXP experiment; PLAN/ALIVE model campaign |
| `kalsahtp/` | 2,741,054,788 | 2.55 GiB | HTP/NPU cell and Qwen model; PLAN/ALIVE NPU chapter |
| `s15vk/` | 194,818,299 | 185.8 MiB | historical Vulkan cell; PLAN Vulkan chapter |
| `s3printf/` | 150,683,720 | 143.7 MiB | historical S3 printf/debug set; PLAN/ALIVE kernel campaign |
| `s3base/` | 150,610,424 | 143.6 MiB | historical S3 baseline set; PLAN/ALIVE kernel campaign |
| `s3fix/` | 150,609,256 | 143.6 MiB | historical S3 fix set; PLAN/ALIVE kernel campaign |
| `s18stock/` | 145,642,204 | 138.9 MiB | KEEP pending review: duplicate current S3 artifacts plus stock-cell evidence |
| `kalsahtp_f2b/` | 142,886,768 | 136.3 MiB | historical HTP F2b cell; PLAN/ALIVE NPU chapter |
| `q53_v73_npu_correctness/` | 131,862,222 | 125.8 MiB | Q53 v73 correctness evidence; PLAN/ALIVE NPU chapter |
| `bmoe/` | 124,821,922 | 119.0 MiB | BigMoeOnEdge runtime/ABBA payload; `results/lineup_abs_s23/`, ALIVE product streamer |
| `q56_thermal_watchdog/` | 85,587,820 | 81.6 MiB | KEEP: thermal evidence/harness; `scratchpad/agents/q56-thermal-watchdog/` |
| `termux-app.apk` | 35,106,607 | 33.5 MiB | KEEP: Termux artifact; never propose |
| `k2ref/` | 28,099,608 | 26.8 MiB | historical K2 reference test-backend; PLAN K2 chapter |
| `k22/` | 27,068,405 | 25.8 MiB | historical K2 correctness set; PLAN K2 chapter / ALIVE |
| remaining files and small historical dirs | not counted | small | UI, reports, scripts, and scratch artifacts; see `inventory.json` exact paths and purpose guesses |

The last line is intentionally not used as a deletion total because the root contains mixed UI/report/script artifacts. `inventory.json` is the authoritative exhaustive listing, including all nested `du` groups and every file mtime/hash.

Small top-level subdirs also measured by recursive `du -sh`: `_gguf_keep` 651 B; `kalsa_q44` 1,413,083 B; `kalsa_q46` 8,514,169 B; `kalsa_q48` 6,995,642 B; `kalsa_q51_f2b` 7,979,883 B; `kalsaio` 11,148 B; `q60b_s23_sampler` 25,913 B. Nested subdirs (including `bmoe/abba`, `s3oracle/logs`, and the `kalsa_q*` children) are separately grouped in `inventory.json`.

## Candidate pool

The explicit pool in `DROP_CHAIN.md` is **31,669,224,940 bytes (about 29.49 GiB)** before any approval. It excludes `s3oracle/`, `q56_thermal_watchdog/`, Termux artifacts, `_gguf_keep`, and every exact pinned runtime library. This is a proposal pool, not a deletion result; no device bytes were changed.
