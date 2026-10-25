# Windows walk, Surface and Lenovo, night of 2026-10-01

The installed app, built on each machine from `brain`, walked from a fresh state (old runtime and app
data moved to backup folders, downloaded models kept) through Start → pick → download → first-run
tune → chat. Engine kalsa-server v1.1.5 on both. Every number below was read from the machine
(tune record files, a 1.5 s process/health watcher, CDP traces of the WebView); nothing is estimated.

## The machines

- **Surface Laptop 3** (corporate-managed, antivirus on): i7-1065G7 4C/8T, 16 GB, Iris Plus iGPU, no
  dedicated card. `dl.kalsa.io` is blocked on its network (curl exit 28); huggingface.co answers.
- **Lenovo** (owner's): Core Ultra 9 185H, 32 GB, RTX 4050 Laptop 6 GB + Intel Arc iGPU.

## First-start times

| step | Surface (LFM 2.5 Q8) | Lenovo (Gemma 4 E4B + MTP) |
|---|---|---|
| machine check (Start → pick) | 10–20 s | ~40–80 s |
| engine download | ~10 s (via the HF mirror fallback) | seconds |
| model download | 3.5 min (2.9 GB) | already on disk; drafter 98.6 MB in seconds |
| first-run tune | ~7 min (4 shapes, no drafter) | ~6 min (3 shapes + MTP n=2/3/4 on the card) |
| first chat answer | ~4 min 15 s (model ran 2 web searches + read a page) | 20 s (no search) |

## What the tunes chose

**Surface** (final run, build a9d34384): winner **CPU, 8 threads — decode 12.8 tok/s**, prompt 29.7.
Before the fixes the same machine picked the iGPU at 3.9–5.3 tok/s.

| shape | prompt tok/s | decode tok/s | score s |
|---|---|---|---|
| iGPU fully offloaded | 73 | 5.1 | 55.3 |
| mixed (Vulkan build, `-ngl 0`) | 36 | 9.7 | 52.2 |
| CPU 4 threads | 24 | 11.0 | 66.7 |
| **CPU 8 threads** | 30 | **12.8** | 54.3 |

**Lenovo** (final run, build 4f91f327): winner **RTX + MTP n=2 — decode 86.7 tok/s**, prompt 1,859,
VRAM 3,800 MiB. RTX without MTP 47.6; CPU 16 threads 11.2; CPU 22 threads 8.0. MTP n=3 85.6, n=4 81.8.

## Bugs found on real hardware, and their fixes (all reviewed by a second model, pushed)

1. **Engine download blocked on corporate networks** → the archive falls back to the pinned HF mirror
   `Kalsa-ai/kalsa-server@f038a4f4`, same size+sha256 gate (`725b3813`, `f6ad753b`).
2. **Corporate antivirus made freshly installed engines miss the 120 s ready window** → a fresh build is
   run once before it is timed (`7f81f0de`, tested by `0111cb0f`).
3. **The CPU's ~2,250-token room ask took 99 s, past the 60 s request timeout, so the CPU was refused**
   → measured up to 300 s (`a9b40085`).
4. **iGPU-only PCs never tried the iGPU; owner asked for a mixed shape** (prefill on the iGPU, decode
   on the CPU) → offered and measured (`bc6eca0f`); score = mean of a typical turn (300+200) and a long
   history (2000+200), owner decision (`4727dd9c`).
5. **The tie band picked the slowest writer** (5.3 tok/s over 13.3) → decode first inside the band, no
   dominated winner, total order (`6d902392`, `8557747b`); the prune respects the band (`5d6f725c`).
6. **Slow or broken machines re-tuned on every start** → one retry, then the result stands; a retry
   pools both attempts (`a51bb4b1`, `275b3360`, `c21d67a6`, `c24cf53f`); fingerprint v4 (`87dc212c`).
7. **Chat failed after web searches on slow PCs: the door cut the engine after 10 s of silence**
   (`PATIENCE` used as a read timeout while the engine prefilled) → silence is waited through;
   completions get a 10-minute idle bound under a 30-minute ceiling; the chat and the room read the
   engine's `prompt_progress` (`d3305222`, `e82b4ea8`, `83051030`, `76d8b217`, `ecaa9021`).
8. **On a laptop with a dedicated card the app offered only LFM**: the CPU-measured bandwidth floor
   withheld Gemma E4B → a row fully resident on the card is not speed-gated by the CPU floor; the card
   says "At least X tokens/s" (`1fc31c2e`).
9. **Choosing E4B on the RTX then failed "too big"**: the launch charged 2.2 GiB of host-mapped
   embeddings to the card → one rule for bytes that never enter the card, shared by preview and launch
   (`4f91f327`). Measured: plan 3,710 MiB, real 3,800 MiB.
10. **The app pinned no device** → one GPU via `--device`/`--device-draft` from the engine's own
    `--list-devices` (`312a8571` and fixes). The Vulkan order differs per Windows session (user session:
    Vulkan0 = Arc, Vulkan1 = RTX; elevated SSH: the reverse) — the app lists from its own session and
    pinned the RTX correctly.
11. Smaller: Ctrl+K on Windows, the files warning with no files, AMD APU names, the device-list cache.

## Engine check for the coordinator

v1.1.5 with `--device Vulkan0 --device-draft Vulkan1` refuses to start with a clear message ("the
drafter and the shared K/V must be on the same device") instead of the v1.1.4 abort. Reported to the
coordinator 1d714246.

## Still open

- The app writes no log file; diagnosing the Windows runs needed process watchers and CDP traces.
- On a dGPU, nothing checks that the 2.2 GiB of host-mapped weights fit in system RAM beside other apps.
- Owner decision pending: a phone away for more than 2 minutes loses an answer still in progress
  (finished answers stay 10 minutes).
- A forced app restart once came back with no engine started and an unreadable page (Surface, 20:09);
  not reproduced.
- Copy: a single pick card says "Smarter answers."; the pick details say "2.7 GiB on this computer"
  before the download.
- LFM 2.5 thinks in English and searches the web for simple Italian questions on the Surface.
