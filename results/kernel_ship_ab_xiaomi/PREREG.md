# Pre-registration — Kernel ship A/B REPLICATION, Mellum2 on Xiaomi 14

Registered: 2026-08-16 (night), **BEFORE any run of this experiment** and
before the device was even staged. Direct replication of
`results/kernel_ship_ab_s23/PREREG.md` with the **device axis changed and
everything else held fixed**.

## Why

The ship claim (`reports/moe-kernel-ship-ab-s23.md`: W=0, p=0.000488,
−42.7% median wall) rests on **one device**. The owner criterion was "improves
the models we ship in a **general**, significant way". One phone is not
generality. This cell tests whether the certified config still wins on a
device from a different class.

## Pre-registered prediction (declared now, before any data)

The effect is expected to be **smaller than −42.7%, and may be null**.

Reasoning, from our own measurements: the certified config's win is largely an
I/O-footprint win (183 MiB/token stock vs 39 MiB/token certified). The S23 is
8 GB RAM / UFS 3.1. This device is **11.4 GB MemTotal (12 GB class), Snapdragon
8 Gen 3 (`pineapple`), Android 16, 8 cores** — more page cache and faster
flash, so arm A suffers less from the very cost arm B removes. The K-F
characterization already showed this device absorbs I/O stalls that hurt the
others (cold stall share 8.7%, `results/kf_cold_xiaomi/REPORT.md`).

**A null or a much smaller effect here is a SCOPE finding, not a failure**, and
will be reported as such — exactly as the K-F ship cell was reported when it
came back negative on Jelly warm cache (p=0.000977 against). The claim that
would be damaged is "general", not "real": the S23 result stands on its own
pre-registered evidence either way.

Direction is declared: the confirmatory test is **two-sided**; we are not
allowed to convert a loss into a win by re-reading it as one-sided.

## Design (copied from the S23 cell; deviations marked ⚠)

- **Device**: Xiaomi 14 `23127PN0CG` (`houji`), **UNPLUGGED**, battery floor
  **45%**, thermal abort **43 °C**, screen state logged every run.
  ⚠ Driven over **adb** (`adb-625689a2-…_adb-tls-connect._tcp`), not ssh/Termux.
  Transport only — no change to what is measured.
- **Session start**: **fresh reboot required** (S23 amendment 2). `SwapFree`
  and `MemAvailable` recorded at session start. This device idles with ~2.7 GB
  already in zram (measured 2026-08-16 02:0x: SwapTotal 12 582 908 kB,
  SwapFree 9 818 644 kB, MemAvailable 4 512 024 kB), i.e. exactly the state
  that invalidated two S23 sessions. Non-negotiable.
- **Model**: `Mellum2-12B-A2.5B-Instruct-Q4_K_M.gguf`, sha-pinned against the
  PC copy before and after push (8 071 293 600 bytes).
- **Binary pin**: must be the campaign ELF
  `0ac612def6b82586d695bfb11acf42cce23bd99fc4ccd3aeddb51a0cd15cf93c`, the ELF
  the S23 claim was measured on.
  ⚠ **Provenance risk found while writing this PREREG:** that ELF exists
  **only on the S23** (`~/bin/mellum2/bmoe-cli`). The ship cell deliberately
  never pushed a binary (`push_and_start_s23.ps1`: "Never writes the campaign
  binary") and no file on the PC matches that sha — all 12 Android `bmoe-cli`
  builds in the tree hash to something else. Pulling it is a 5-second
  read-only `adb pull`, but the S23 is currently reserved by another harness,
  so it needs owner OK.
  **Declared in advance:** if the run must use a different ELF, that is a
  **deviation**, the cell is reported as a **conceptual** replication (device
  AND binary changed), and the weaker label is used in the report — no
  retroactive upgrade.

  **AMENDMENT 1 (2026-08-16 06:16, before any run and before any staging):**
  resolved — owner authorized the pull, the S23's sshd was restarted, and the
  full runtime was copied and verified 7/7 bit-identical
  (`models_staging/ship_runtime_s23_0ac612de/`, MANIFEST.md). The deviation
  clause above is therefore **not invoked**: this cell runs the exact ELF the
  S23 claim was measured on and is an **exact** replication on the binary axis.
  Note recorded while pulling: the ELF is dynamically linked, so the pin is the
  whole 7-file runtime (binary + 6 shared objects), not `bmoe-cli` alone — the
  Xiaomi must receive and verify all seven before the first run.
- **Arms** (identical base flags: `--moe-stream --cache-mb 2000 --dense-weights
  anon --overlap --io-threads 4 --ubatch 512 -c 4096 --temp 0 --chatml
  --no-think`, `-n 200`, fact prompt sha-pinned
  `b5301c32c0bd8aae4cf5c25d667a52eef05b940a459a2e9c82b1b6134cf0dcbd`):
  - **A (stock)**: `--n-expert-used 8` **EXPLICIT** (never flag-absent — the S23
    amendment showed flag-absent degenerates 60-90x, an engine flag-default
    pathology), no drop flag, `-t 4`.
  - **B (certified)**: `-t 2 --n-expert-used 6 --drop-cold-experts 1.0`.
  ⚠ The certified thread count `-t 2` was dispatched for S23-class silicon. It
  is kept **unchanged** here on purpose: this cell tests the *shipped* config,
  not a re-tuned one. Re-tuning `-t` for this SoC is a separate future cell and
  may not be used to rescue a null.
- **Sequence**: warm-up run (excluded, declared), then **12 ABBA pairs**
  interleaved `AB BA AB BA …` (24 measured runs). No cold resets between
  measured runs (hot regime = product regime).
- **Continuation**: if the battery floor stops the sequence, the remainder runs
  on the next battery cycle, same protocol, appended whole pairs only.

## Primary metrics (declared now)

1. **Decode wall s/token** (harness-parsed `decode X s/token`), per run —
   confirmatory.
2. Sustained late-rep: median decode s/token of the last 4 pairs.
3. J/token: 1 Hz battery sampler (voltage_uV × current_uA over the decode
   window) / tokens generated. Whole-device power, same screen state both arms.
4. Max battery temperature per run.
5. TTFT proxy: prefill + first-token time on each arm's first measured run.
6. ⚠ Added for this device: **MiB/token of page-cache churn per arm** (the
   mechanism the prediction rests on). Reported, not confirmatory.

## Analysis (declared now)

- Pairing: within each ABBA pair, the A and B runs adjacent in time.
- Test: **Wilcoxon signed-rank on paired per-pair medians of metric 1,
  two-sided, alpha 0.05**. Effect size: Hodges-Lehmann shift + % change.
- N ≥ 10 completed pairs required for the confirmatory claim; fewer = reported
  as incomplete and continued on the next cycle.
- Exclusions (declared): runs with a thermal wait triggered mid-run, plugged
  state ≠ UNPLUGGED, or harness error; an excluded run voids its whole pair,
  which is re-run appended at the end.
- **Comparison to S23 is descriptive only.** No formal test across devices
  (different sessions, different silicon); the S23 number is quoted as
  context, never pooled.

## Kill conditions

- Model or binary sha mismatch before/after → cell void, no analysis.
- Session not started from a fresh reboot → cell void.
- Any post-hoc change of arms, flags, metric 1, or the test → cell void; a new
  PREREG must be registered.
