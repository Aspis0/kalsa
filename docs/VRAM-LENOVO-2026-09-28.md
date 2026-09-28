# VRAM on the Lenovo, measured, 2026-09-28

The catalog budgets a discrete card the way it budgets RAM: at least 3 GiB, or 25%
(`crates/kalsa-catalog/src/footprint.rs:29-30`, applied to the card's own memory at
`footprint.rs:55` and `footprint.rs:75-86`). On the owner's Lenovo (RTX 4050 Laptop,
6141 MiB) that is a 3.0 GiB budget, and the whole catalog refuses: not even LFM2.5-2.6B
Q8_0, whose own footprint estimate is 3.71 GiB at 65 536 tokens. Yet Gemma 4 E4B
Q4_K_M ran on that card at 65 536 context on 2026-09-26, peaking at 3 659 MiB
(`docs/WALK-LENOVO-2026-09-26.md` §2). The owner approved replacing the VRAM margin
with a smaller, MEASURED one. This walk produces the measurements that decide the
number.

Machine: the owner's Lenovo, Core Ultra 9 185H (16C/22T, 32 GB), RTX 4050 Laptop GPU
6141 MiB (nvidia-smi `memory.total`; the probe reads 6 439 305 216 bytes) plus the
Intel Arc iGPU that drives the display, Windows 11. The owner's normal desktop was
open. Times are the Lenovo's clock. Engine: the fork `kalsa-server` v1.1.2 Vulkan
build already extracted at
`%LOCALAPPDATA%\kalsa-brain\runtime\builds\vulkan\kalsa-server-v1.1.2\` (the archive's
sha256 `24f0a982…c85c245e` was verified against the pins on 09-26).

Models, both verified before use:
- `gemma-4-E4B-it-Q4_K_M.gguf`, 4 977 171 584 bytes, sha256 `85a896a0…1fab87` —
  equal to the pin in `crates/kalsa-catalog/src/manifest.rs:611`. Already in
  `%LOCALAPPDATA%\kalsa-brain\runtime\models\`.
- `LFM2.5-2.6B-Q8_0.gguf`, 2 874 779 648 bytes, sha256 `1e22128d…b0fc9` — equal to
  the pin at `crates/kalsa-catalog/src/manifest.rs:852`. Not on the machine this
  morning; fetched from the pinned repo and commit
  (`LiquidAI/LFM2.5-2.6B-GGUF@e7caca5d`) into `C:\kalsa-bench\`, hashed, then used.

Three labels, the walk doc's convention. Unmarked statements were measured on the
Lenovo today. **CODE-DERIVED** means read from this repo's source; the files cited
are unchanged at the HEAD this doc lands on. **INFERRED** means neither measured nor
in our code: an explanation, or a proposal.

## 1. How each number below was taken

Every run used the app's own argv shape, as the process watcher recorded it on
2026-09-26 — same flags, my port, my slot dir, and the run's context:

```
kalsa-server.exe --host 127.0.0.1 --port 8195 --model <model> --threads 16
--threads-batch 16 --batch-size 2048 --ubatch-size 512 --ctx-size <N> --flash-attn on
--cache-type-k q8_0 --cache-type-v q8_0 --sleep-idle-seconds 300 --no-webui
--parallel 1 --cache-ram 4755 --slot-save-path <run>\slots --ctx-checkpoints 1
```

No `-ngl` flag: the app's fitted argv renders none, and the engine's default puts
every layer it can on the GPU (§3 quotes what it did). `--cache-ram 4755` is the
fork's prompt-cache roof as the app passed it on 09-26 (`crates/kalsa-launch/src/argv.rs:124`).

Then, per run, on one card that read 0 MiB used before the engine started:

- idle: three `nvidia-smi --query-gpu=memory.used,memory.total` samples before launch;
- a sampler process reading `memory.used` every ~400 ms from before the launch until
  after the answer, into `samples.csv`; peak = the maximum sample;
- after load: one explicit sample once `/health` answered 200;
- one request to `/v1/chat/completions`: a 37 000-character repeated-paragraph prompt
  plus "Summarise the story above in one sentence.", `max_tokens 256`, non-streaming.
  The Gemma tokenizer priced it at 9 426 prompt tokens, LFM2.5's at 9 821 — "~8k"
  as asked, and the exact numbers are in each run's `response.json` `usage`;
- decode tok/s from the server's own `timings.predicted_per_second`;
- stop: `taskkill /PID <pid> /T /F` on the process this run started, then one sample
  confirming the card drained back to 0 MiB.

Before every launch a guard checked `Get-Process` for any `kalsa*`/`llama*` process
and refused to start if one ran; nothing that another agent started was ever touched.
Four runs are the measurement (14:26–14:32); two more at `-lv 6` (14:33, 14:35)
captured the load log's own words for §3 and reproduced the same load and peak
numbers, so verbosity does not move the measurement.

One cold-start caveat. The first Gemma run's prefill ran at 105.0 tok/s because
Vulkan was still compiling its pipelines for the freshly started process — the same
stall the 09-26 walk saw as ~21 s on an 18-token prompt, here spread across a
9 426-token prompt (89.7 s, of which a warm rerun takes 5.1 s). Every later number in
the table is warm. Decode on that first run also carries the tail of the compile
(30.7 tok/s against 43.3 on the rerun); it is reported as measured, with the warm
figure beside it.

## 2. The table

Catalog estimate is **CODE-DERIVED** from `footprint.rs`'s own arithmetic — weights
+ 512 MiB compute-buffer forfait + `kv_bytes_per_token × ctx`, each row's manifest
figures (`manifest.rs:558,568` for Gemma; `manifest.rs:807,819` for LFM2.5) — the
same sum the CLI prices; at `--ram 31.5 --vram 6.0` the CLI answers
`refused (NothingFits): This computer is not worth using: it can give a model 3.0 GiB
and the smallest one in the catalog needs 3.7 GiB.` at 65 536, and `…needs 3.4 GiB.`
at 32 768. Measured peak and decode are today's runs.

| row | ctx | catalog estimate | measured after load | measured peak | decode tok/s |
|---|---|---|---|---|---|
| Gemma 4 E4B Q4_K_M | 65 536 | 6 084 467 840 B = 5 802 MiB (5.67 GiB) | 3 649 MiB | **3 800 MiB** | 30.7 cold; 43.3 warm |
| Gemma 4 E4B Q4_K_M | 32 768 | 5 799 255 168 B = 5 530 MiB (5.40 GiB) | 3 345 MiB | **3 496 MiB** | 42.6 |
| LFM2.5-2.6B Q8_0 | 65 536 | 3 982 075 904 B = 3 798 MiB (3.71 GiB) | 3 423 MiB | **3 436 MiB** | 52.6 |
| LFM2.5-2.6B Q8_0 | 32 768 | 3 696 863 232 B = 3 526 MiB (3.44 GiB) | 3 119 MiB | **3 132 MiB** | 51.8 |

Prefill, warm, from the same `timings`: Gemma 1 828–1 835 tok/s at both contexts,
LFM2.5 3 529–3 537 tok/s. Both rows decode at 64k at 43–53 tok/s against the 11.0
tok/s the same machine's processor fallback measured on 09-26 — whatever the margin
becomes, the VRAM route is also the fast one.

The engine's own accounting agrees with the sampler. Gemma at 64k: weights 2 883.51
MiB + KV 544.00 + SWA pool 21.25 + compute 186.30 = 3 635 MiB projected —
`after load: 3 649`, peak 3 800. LFM2.5 at 64k: 2 733.75 + 544.00 + 0.34 + 135.07 =
3 413 MiB projected — `after load: 3 423`, peak 3 436. The sampler's headroom over
the projection (≈ 15–165 MiB) is the prompt's own transient: scratch, staging and
the driver's accounting, already inside the peaks this table reports.

## 3. Do the weights sit fully on the GPU? No — and the log says where the rest is

Both rows offload every layer. Neither row keeps all of its weights in VRAM. The
load log (`-lv 6`), Gemma 4 E4B at 65 536:

```
I load_tensors: offloading output layer to GPU
I load_tensors: offloading 41 repeating layers to GPU
I load_tensors: offloaded 43/43 layers to GPU
I load_tensors:   CPU_Mapped model buffer size =  2208.00 MiB
I load_tensors:      Vulkan0 model buffer size =  2883.51 MiB
I llama_kv_cache:    Vulkan0 KV buffer size =   544.00 MiB
I llama_kv_cache: size =  544.00 MiB ( 65536 cells,   4 layers,  1/1 seqs), K (q8_0):  272.00 MiB, V (q8_0):  272.00 MiB
I llama_kv_cache:    Vulkan0 KV buffer size =    21.25 MiB
I llama_kv_cache: size =   21.25 MiB (  1024 cells,  20 layers,  1/1 seqs), K (q8_0):   10.62 MiB, V (q8_0):   10.62 MiB
I sched_reserve:    Vulkan0 compute buffer size =   186.30 MiB
I sched_reserve: Vulkan_Host compute buffer size =    97.30 MiB
I common_params_fit_impl: projected to use 3635 MiB of device memory vs. 5150 MiB of free device memory
I common_params_fit_impl: will leave 1515 >= 1024 MiB of free device memory, no changes needed
```

LFM2.5-2.6B at 65 536:

```
I load_tensors: offloading output layer to GPU
I load_tensors: offloading 29 repeating layers to GPU
I load_tensors: offloaded 31/31 layers to GPU
I load_tensors:   CPU_Mapped model buffer size =   265.62 MiB
I load_tensors:      Vulkan0 model buffer size =  2733.75 MiB
I llama_kv_cache:    Vulkan0 KV buffer size =   544.00 MiB
I llama_kv_cache: size =  544.00 MiB ( 65536 cells,   8 layers,  1/1 seqs), K (q8_0):  272.00 MiB, V (q8_0):  272.00 MiB
I llama_memory_recurrent:    Vulkan0 RS buffer size =     0.34 MiB
I llama_memory_recurrent: size =    0.34 MiB (     1 cells,  30 layers,  1 seqs  0 rs_seq), R (f32):    0.34 MiB, S (f32):    0.00 MiB, P (f32):    0.00 MiB
I sched_reserve:    Vulkan0 compute buffer size =   135.07 MiB
I sched_reserve: Vulkan_Host compute buffer size =    72.04 MiB
I common_params_fit_impl: projected to use 3413 MiB of device memory vs. 5149 MiB of free device memory
I common_params_fit_impl: will leave 1736 >= 1024 MiB of free device memory, no changes needed
```

- Every one of Gemma's 43 layers (42 blocks + output) and LFM2.5's 31 is assigned to
  `Vulkan0` — `load_tensors: layer N assigned to device Vulkan0` for all of them.
- Gemma leaves **2 208 MiB of weights in a `CPU_Mapped` buffer** — its per-layer
  embeddings and friends stay mmapped in system RAM and are read from there; only
  2 883.51 MiB of weights land in the card. INFERRED, from the sizes: the CPU_Mapped
  block is the per-layer-embedding tensors the E-architecture is named for, which is
  why the card holds a "4.6 GiB" file in 2.88 GiB of VRAM while still decoding at
  43 tok/s.
- LFM2.5 leaves only **265.62 MiB CPU_Mapped** — INFERRED, the size is its 65 536-vocab
  output weight, the usual logits-on-CPU shape. Its two measured fixed caches match
  the manifest's arithmetic exactly: KV 544.00 MiB = 8 704 B/token × 65 536
  (`manifest.rs:819`), recurrent state 0.34 MiB = the 360 448 B `SlotCache::Recurrent`
  at `manifest.rs:828`. Gemma's growing KV 544.00 MiB likewise equals its
  8 704 B/token (`manifest.rs:568`), and the 21.25 MiB saturated SWA pool (20 layers,
  1 024 cells) is the measured figure that row's `SlotCache::SlidingWindow` was
  calibrated against on 09-26.
- The engine's own planner applies a **1 024 MiB free-VRAM floor** — twice, verbatim:
  `will leave 1515 >= 1024 MiB of free device memory, no changes needed` (Gemma) and
  `will leave 1736 >= 1024 MiB` (LFM2.5). The card had accepted both plans without
  the fit stepping in to shave layers. This is the same number the next section
  proposes as the margin, already enforced by the thing that will run under it.

## 4. The idle desktop's own VRAM

0 MiB. `nvidia-smi --query-gpu=memory.used` read 0 MiB before every run and 0 MiB
after every stop, with the owner's desktop up — the display and compositor live on
the Intel iGPU, and nothing open had touched the NVIDIA card. The card reports
6 141 MiB total; the Vulkan device sees 5 920 MiB usable and 5 152 MiB free before a
model loads, so the driver's own reservation (≈ 770 MiB of the 6 141) never shows up
as `memory.used`. The one other datapoint: the 09-26 walk started with 5 920 MiB
free — about 221 MiB of desktop use that day. Call the real idle number 0–221 MiB,
and the compositor's worst seen on this card a fifth of a gigabyte.

## 5. Why the catalog over-charges, and by how much

The catalog's footprint books every byte of the weights file as memory the model
occupies. On a CPU path that is what runs; on this card it is not what runs. Today:

| row × ctx | catalog estimate | measured peak | over-charge |
|---|---|---|---|
| Gemma 64k | 5 802 MiB | 3 800 MiB | 2 002 MiB |
| Gemma 32k | 5 530 MiB | 3 496 MiB | 2 034 MiB |
| LFM2.5 64k | 3 798 MiB | 3 436 MiB | 362 MiB |
| LFM2.5 32k | 3 526 MiB | 3 132 MiB | 394 MiB |

Gemma's 2 000 MiB gap is its 2 208 MiB `CPU_Mapped` weights minus the 21 MiB SWA
pool the catalog's per-token figure does not carry; LFM2.5's ≈ 380 MiB gap is its
266 MiB of CPU_Mapped weights plus the sampler-vs-projection transient. The KV and
compute terms, the parts the catalog can price from the header, land within a few
MiB (§3). The correction that would fix the estimate at its root — letting a row
declare which weights stay off the card — is a separate change; this doc only
supplies its measurement.

## 6. A proposed VRAM margin — INFERRED

**Proposed: for a discrete card, replace `max(3 GiB, 25%)` with a 1 GiB floor —
leave 1 024 MiB of the card free.** In `footprint.rs` terms: the `DiscreteGpu`
arm of `memory_budget` would budget `vram_bytes − 1 024 MiB` instead of
`usable_bytes(vram)`'s RAM margin. The RAM margin keeps its 3 GiB / 25% shape;
only the card's arm changes, and the doc that changes it should carry this section.

The arithmetic, all of it measured above:

- Card: 6 141 MiB (`memory.total`; the probe's 6 439 305 216 bytes). Budget:
  6 141 − 1 024 = **5 117 MiB** (5 365 563 392 bytes).
- Measured peaks at the app's own argv: 3 800 MiB (Gemma 64k), 3 496 (32k), 3 436
  (LFM2.5 64k), 3 132 (32k). Every one fits 5 117 with room to spare; the worst case
  leaves 6 141 − 3 800 = **2 341 MiB** of the card free after the model's worst
  moment — 2.3× the proposed margin, on the machine's real desktop, which measured
  0 MiB idle (§4) and at most ≈ 221 MiB on 09-26.
- The floor is not chosen from the desktop alone: the engine's own planner refuses
  to plan below exactly this number — `will leave 1515 >= 1024 MiB of free device
  memory, no changes needed` (§3, both rows). A card that ships this margin keeps
  the launch path the engine already enforces; nothing the chooser funds will ever
  ask the fit to shave layers it would have refused anyway.

What it would let this card run at 64k, on the owner's own words of approval
("replace the VRAM margin with a smaller, measured one"):

- **On measured peaks, both rows fit at 65 536 today**: Gemma 4 E4B Q4_K_M at
  3 800 MiB and LFM2.5-2.6B Q8_0 at 3 436 MiB, each decoding at 43–53 tok/s — against
  a 3.0 GiB budget under which the catalog refuses everything and the app told the
  owner on 09-26 that this model "runs on the processor" while the graphics build
  was already running it.
- **On the catalog's current arithmetic, LFM2.5 flips and Gemma does not**: LFM2.5's
  estimate 3 798 MiB ≤ 5 117 MiB fits at 64k; Gemma's 5 802 MiB stays 685 MiB over —
  unless and until the footprint stops charging the 2 208 MiB of `CPU_Mapped` weights
  that §3 shows never land in the card (§5 is that measurement). The margin alone
  makes the catalog tell the truth about LFM2.5; the CPU_Mapped correction is what
  makes it tell the truth about Gemma.

## 7. What changed on the Lenovo

Added in `C:\kalsa-bench`: `vram-run.ps1` (the instrument: guard, sampler, launch,
prompt, kill), `LFM2.5-2.6B-Q8_0.gguf` (sha256-verified above), and six run
directories `vram-run-{gemma,lfm}-{65536,32768,65536-lv6}\` — each holds `summary.txt`,
`samples.csv`, `server-stdout.log`, `server-stderr.log`, `request.json`,
`response.json` and `log-excerpt.txt`. The same six directories are on the Mac as
`/tmp/vram-lenovo/`. Nothing was deleted. No engine and no Kalsa app process was
left running; `nvidia-smi` read 0 MiB after the last stop. The product's runtime
(model files, engine builds, verdicts) is untouched.
