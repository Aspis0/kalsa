# Lab — MTP on the Iris, and the Vulkan shapes, on the Surface (2026-10-07)

Plan steps 1 and 2 of `PLAN-SURFACE-TUNE-2026-10-07.md`, measured by hand in one session.
Every server below was started and stopped by the lab; the installed Kalsa app never ran
(`tasklist` had no Kalsa/kalsa-server process at any point) and no engine of its was touched.
Machine load at session start: CPU 4 %, 4.7 GiB of 16 GiB RAM free.

## Machine

- Surface (TABLET-V477JRIG), Windows 11 Pro (10.0.26200.9457), i7-1065G7: 4 cores / 8 threads,
  Iris Plus iGPU only. **Measured**: CPU LoadPercentage 4, 4 cores / 8 logical, FreePhysicalMemory
  4 675 284 KB of 16 353 432 KB (start of session).
- The iGPU as the engine sees it: **measured** (load log, every run) —
  `Vulkan0 : Intel(R) Iris(R) Plus Graphics (7985 MiB, 7329 MiB free)`.

## Binaries, model, drafter

Both builds the app had already downloaded, read-only, **measured** file sizes:

| What | Path | Size |
|---|---|---|
| Vulkan build | `C:\Users\gualt\AppData\Local\kalsa-brain\runtime\builds\vulkan\kalsa-server-v1.1.5\kalsa-server.exe` | 10 240 B (stub; code in the DLLs beside it) |
| CPU build | `C:\Users\gualt\AppData\Local\kalsa-brain\runtime\builds\cpu\kalsa-server-v1.1.5\kalsa-server.exe` | 10 240 B (stub) |
| Target model | `C:\Users\gualt\AppData\Local\kalsa-brain\runtime\models\gemma-4-E4B-it-Q4_K_M.gguf` | 4 977 171 584 B |
| MTP drafter | `C:\Users\gualt\AppData\Local\kalsa-brain\runtime\models\mtp-gemma-4-E4B-it-Q8_0.gguf` | 98 653 280 B |

Engine version **measured** (`kalsa-server.exe --version`, both builds carry the same stamp):
`0.5.0-dev (build 11596, commit 63a51b6d6)`, MSVC 19.51.36260.0 x64 — the app's `kalsa-server-v1.1.5`
packages. The target is Gemma 4 E4B (42 layers, MTP drafter = a 4-layer head: **measured** in the
load log, `n_layer = 0, n_layer_all = 4`).

## How the runs were made, and every argv

The argv shapes are copied from the app log's tuned launch (2026-10-06T00:44:20Z,
`engine start #1: kalsa-server.exe argv …` for the winner `processor 8 threads + MTP 3`) plus
`crates/kalsa-launch/src/argv.rs` and `crates/kalsa-tune/src/candidates.rs`:
the **graphics** shape is the Vulkan build with no `--n-gpu-layers` flag (EngineFitted — the engine
fitted all 42 layers onto Vulkan0, **measured** in the load log), threads 4
(**inferred**: physical cores; the 2026-10-03/05/06 tunes all ran a "graphics + processor 4
threads" candidate, so the count was 4); the **mixed** shape adds `--n-gpu-layers 0`
(**measured** placement: every layer `assigned to device CPU`); the **processor** shapes are the
CPU build, which renders no GPU flag at all.

The only deltas from a tune lifetime, none of which touch load or decode work: fixed port 8157
(the tune picks any free port), alias `lab-*` (the tune uses a nonce; identity-only), `-lv 5`
added (the lab needs the load log; the tune launches quiet), and `--slot-save-path` pointed at the
lab's own empty directory (the engine requires an existing directory; the tune uses the app's
slots dir; no slot was saved or restored — each request was a single uncached POST). Full request
bounds in "Protocol" below.

Shared argv tail, verbatim, present in every run:

```
--host 127.0.0.1 --port 8157 --batch-size 2048 --ubatch-size 512 --ctx-size 65536
--flash-attn on --cache-type-k q8_0 --cache-type-v q8_0 --temp 1 --top-p 0.95 --top-k 64
--sleep-idle-seconds 300 --no-webui --parallel 1 --cache-ram 1656 --ctx-checkpoints 1 -lv 5
--slot-save-path C:\Users\gualt\AppData\Local\Temp\kalsa-lab-20261007\slots
```

(One line in the real command line, in argv.rs's order; the `--model` and `--alias` head each run.)

Per run, the differing middle (verbatim):

| Run | Exe | Head + middle after `--alias` |
|---|---|---|
| s1n2 | Vulkan | `--model …gemma-4-E4B-it-Q4_K_M.gguf --alias lab-s1n2 --threads 4 --threads-batch 4` `--device Vulkan0` `--model-draft …mtp-gemma-4-E4B-it-Q8_0.gguf --spec-type draft-mtp --spec-draft-n-max 2 --spec-draft-n-min 0 --spec-draft-type-k q8_0 --spec-draft-type-v q8_0 --device-draft Vulkan0` |
| s1n3 | Vulkan | same, `--spec-draft-n-max 3`, alias `lab-s1n3` |
| s1n4 | Vulkan | same, `--spec-draft-n-max 4`, alias `lab-s1n4` |
| s1off | Vulkan | `--model … --alias lab-s1off --threads 4 --threads-batch 4 --device Vulkan0` (no draft flags) |
| s1ncpu | Vulkan | s1n3's argv with `--device-draft Vulkan0` replaced by `--n-gpu-layers-draft 0` (drafter weights on CPU), alias `lab-s1ncpu` |
| s2gfx | Vulkan | = s1off (`lab-s2gfx`) |
| s2mix | Vulkan | `… --alias lab-s2mix --threads 4 --threads-batch 4 --n-gpu-layers 0 --device Vulkan0` |
| s2cpu4 | CPU | `… --alias lab-s2cpu4 --threads 4 --threads-batch 4` (no ngl, no device) |
| s2cpu8 | CPU | `… --alias lab-s2cpu8 --threads 8 --threads-batch 8` (no ngl, no device) |

### The asks

- **Step 1** — the tune's own draft ask, byte-for-byte (`crates/kalsa-tune/src/sample.rs`
  `DRAFT_PROMPT`, DRAFT_SEED 42, DRAFT_N_PREDICT 128; sampling = the row's own Gemma sampling,
  temperature 1.0 / top_p 0.95 / top_k 64 — `kalsa-catalog` manifest, and the production argv's
  `--temp 1 --top-p 0.95 --top-k 64`): `POST /v1/chat/completions`,
  `{"messages":[{"role":"user","content":DRAFT_PROMPT}],"max_tokens":128,"cache_prompt":false,
  "temperature":1.0,"top_p":0.95,"top_k":64,"seed":42}` — one discarded 8-token warm-up, then two
  measured requests (the tune's `draft_requests` discipline).
- **Step 2** — the score's two cases on the raw road (`/completion`), drafter off, two runs each:
  a typical turn (prompt built from the tune's own `room.rs` turns, 1 416 chars → **measured**
  281 tokens; target ≈300) and a long history (8 888 chars → **measured** 1 773 tokens; target
  ≈2 000), each `{"prompt":…,"n_predict":200,"cache_prompt":false,"temperature":0.0,
  "ignore_eos":true}` — 200 written tokens per request, as the score prices.
  Road note: the tune measures decode on the chat road at temp 1.0; this lab used the raw road at
  temp 0.0 to hold the text fixed across both cases. Cross-check against the tune's own numbers
  below — the shapes rank identically.

### Protocol

Server started detached via `Start-Process -PassThru` (the printed PID is the killed PID); wait on
`/health`; identity read from `/v1/models`; requests via `curl.exe --data-binary @file` with
per-request bounds of 120 s (step 1) and 120/180 s (step 2 turn/long) — wider than the tune's
60 s `REQUEST_TIMEOUT` on purpose, so a request slower than the bound still reports its true rate;
"inside the tune's 60 s bound" below is judged from the measured wall time. Between runs the
server was stopped by exact PID (`Stop-Process -Force`) and the port's listen state waited on
(all runs printed `PORT_FREE=True`; the s1n3 kill was additionally verified by PID with
`tasklist`). Total engine time across the nine runs: ≈ 37.5 min (sum of ready times 126 s +
request walls ≈ 2 125 s).

## Step 1 — Iris MTP (Vulkan graphics shape, drafter on n = 2/3/4, off baseline)

All decode numbers **measured** from the server's own `timings` block; the fork carries
`draft_n` / `draft_n_accepted` in `timings` directly. Decode tok/s = `predicted_per_second`;
prompt = the chat ask's 77 template-expanded tokens (`prompt_n` **measured**).

| Run | decode tok/s (m1 / m2) | wall per measured request | draft_n / accepted (m1, m2) | acceptance | inside the tune's 60 s bound? |
|---|---|---|---|---|---|
| drafter **off** | 4.70 / 4.72 | 36.7 s / 38.9 s | — | — | yes, both |
| **n = 2** | 3.31 / 3.33 | 47.2 s / 46.9 s | 105 / 74, 105 / 74 | 70.5 % | yes, both (barely) |
| **n = 3** | 1.93 / (no answer) | 74.5 s / **> 120 s — killed** | 132 / 82 | 62.1 % | **no** — m1 past it, m2 never returned in 120 s |
| **n = 4** | 1.50 / 1.26 | 93.4 s / 111.4 s | 139 / 91, 137 / 92 | 65.5 %, 67.2 % | **no**, both |
| n = 3, drafter forced to CPU | 1.63 / 1.60 | 87.5 s / 89.3 s | 132 / 82, 132 / 82 | 62.1 % | no, both |

Ready-to-serve times **measured**: 18.3 / 17.0 / 16.3 / 13.3 / 14.9 s (n2/n3/n4/off/ncpu).

Where the drafter runs — **measured** from the `-lv 5` load log. n = 2/3/4 (engine default):
every `load_tensors` line, target and drafter alike, is `assigned to device Vulkan0` — the drafter
runs on the iGPU. The forced-CPU run: the drafter's block after `print_info: n_layer = 0` reads
`layer 0..4 assigned to device CPU` — placement confirmed applied, and it did not help.

Raw `timings` excerpts (verbatim field dumps, one per run):

```
s1off  m1: prompt_n=77 prompt_ms=9636.037 prompt_per_second=7.99 predicted_n=128
           predicted_ms=27000.85 predicted_per_second=4.7036
s1n2   m1: prompt_n=77 prompt_ms=8837.093 prompt_per_second=8.71 predicted_n=128
           predicted_ms=38333.256 predicted_per_second=3.3131 draft_n=105 draft_n_accepted=74
s1n3   m1: prompt_n=77 prompt_ms=8747.97  prompt_per_second=8.80 predicted_n=128
           predicted_ms=65723.261 predicted_per_second=1.9323 draft_n=132 draft_n_accepted=82
s1n4   m1: prompt_n=77 prompt_ms=8798.582 prompt_per_second=8.75 predicted_n=128
           predicted_ms=84546.167 predicted_per_second=1.5021 draft_n=139 draft_n_accepted=91
s1ncpu m1: prompt_n=77 prompt_ms=9752.883 prompt_per_second=7.90 predicted_n=128
           predicted_ms=77729.594 predicted_per_second=1.6339 draft_n=132 draft_n_accepted=82
```

Errors: none. The drafted runs' logs show the engine's own benign memory-fitting warning
(`Gemma4Assistant requires ctx_other to be set … normal during memory fitting`, then
`fitting without it`); every drafted server started and served. The s1n3 second request hit the
120 s client bound with zero bytes received and its exact PID (30820) was stopped and recorded.

This reproduces the tune's own picture (**measured** there, cross-checked): on 2026-10-05 the
graphics drafted settings refused (`NoUsableAnswer`); on 2026-10-06 n = 2 measured 3 tok/s
(reply 121.2 s) and n = 3 refused again — the same numbers this lab measures directly.

**Conclusion (3 lines).** The drafter works and accepts 62–70 % of its proposals, yet every
drafted launch decodes slower than the same shape undrafted on this iGPU (best drafted 3.3 tok/s
against 4.7 off; per-token cost 212 ms off against 302/517/666 ms at n = 2/3/4): the Iris pays
more per drafting step than acceptance returns. n = 2 is the only drafted setting that finishes
inside the tune's 60 s request bound at all; n ≥ 3 breaches it (74–111 s), which is exactly the
tune's `NoUsableAnswer` — a refusal that is the true answer, not a measurement gap. It is not an
acceptance bug and not a placement bug (forcing the drafter onto the CPU measures 1.6 tok/s, no
better); no launch flag or engine setting measured here can turn it into a win.

**Recommendation (one):** (b) never sweep drafted settings on an iGPU shape — drop the drafted
lifetimes wherever the target decodes on an integrated GPU and keep the sweep only on shapes that
decode on the processor (where the tune measured a real win, 10 vs 8 tok/s on this same machine).

## Step 2 — the Vulkan shapes against the processor (Gemma E4B, drafter off)

Prompt rate P and decode rate D **measured** from each answer's `timings`
(`prompt_per_second`, `predicted_per_second`); two runs of each case per shape. Score
**computed** by the score's own arithmetic, `s = 1150/P + 200/D` (the mean of 300/P + 200/D and
2000/P + 200/D), best sample per rate — the tune's own estimator.

| Shape | case | P (tok/s) run 1 / run 2 | D (tok/s) run 1 / run 2 | score (best P, best D) |
|---|---|---|---|---|
| Vulkan graphics (fitted) | turn | 28.5 / 22.9 | 5.20 / 4.22 | **78.8 s** |
| | long history | 24.5 / 25.0 | 4.11 / 4.32 | (P 28.5, D 5.20) |
| Vulkan mixed (`-ngl 0`) | turn | 23.8 / 22.0 | 5.89 / 5.47 | **82.3 s** |
| | long history | 22.2 / 22.2 | 4.94 / 5.04 | (P 23.8, D 5.89) |
| CPU 4 threads | turn | 25.8 / 25.5 | 6.47 / 6.69 | **74.5 s** |
| | long history | 19.6 / 19.4 | 6.06 / 5.86 | (P 25.8, D 6.69) |
| CPU 8 threads | turn | 29.6 / 29.9 | 7.45 / 7.25 | **65.7 s** |
| | long history | 23.8 / 22.4 | 6.15 / 6.30 | (P 29.6, D 7.45) |

Mean-of-runs scores (mark: **computed**, for robustness) rank the same way:
graphics 90.4 s, mixed 88.5 s, CPU 4T 82.8 s, CPU 8T 73.0 s.

Raw `timings` excerpts (one per shape, long-history run 1):

```
s2gfx  l1: prompt_n=1773 prompt_ms=72228.335 prompt_per_second=24.547 predicted_n=200
           predicted_ms=48376.632 predicted_per_second=4.1136
s2mix  l1: prompt_n=1773 prompt_ms=79942.904 prompt_per_second=22.178 predicted_n=200
           predicted_ms=40266.528 predicted_per_second=4.9421
s2cpu4 l1: prompt_n=1773 prompt_ms=90404.542 prompt_per_second=19.612 predicted_n=200
           predicted_ms=32840.004 predicted_per_second=6.0597
s2cpu8 l1: prompt_n=1773 prompt_ms=74595.602 prompt_per_second=23.768 predicted_n=200
           predicted_ms=32349.115 predicted_per_second=6.1516
```

Cross-check against the tune's own 2026-10-06 verdict lines (**measured** there): graphics
"prompt 26, decode 5", processor 8T "prompt 22, decode 7–8" — this lab's 24.5/4.1 and 23.8/6.2
land within a few percent; the ranking is the same.

**Conclusion (3 lines).** No Vulkan shape can win Gemma E4B on this machine: the processor at
8 threads beats the best Vulkan shape on both axes at once (decode 7.45 vs 5.89 tok/s, score
65.7 vs 78.8 s), and the mixed shape that won on LFM 2.5 on 2026-10-01 measures *worst* here
(82.3 s) — with E4B the iGPU neither reads nor writes faster than the cores. The graphics shape's
decode also degrades on the long history (5.2 → 4.1 tok/s) where the CPU holds its rate, so no
turn shape favours the card either. Dropping both Vulkan shapes on Iris-class machines removes two
lifetimes plus their drafted sweeps from every tune there (the mixed shape's own first lifetime
and the graphics candidate's), which is the saving step 3 of the plan builds on.

## Measured vs inferred — summary

- **Measured**: every rate, wall time, `prompt_n`/`predicted_n`, `draft_n`/`draft_n_accepted`,
  ready times, file sizes, engine version, device placements (load logs), machine load/free RAM,
  the app-absent checks.
- **Inferred**: the tune's graphics-shape thread count = 4 (from `candidates()`'s
  rule_threads-or-physical rule and the "graphics + processor 4 threads" tune lines); the exact
  tune argv (reconstructed from the app log's production `engine start` lines + `argv.rs`; the
  tune's own spawn argv is not logged); prompt-size intent of ≈300/≈2 000 (the server's measured
  281/1 773 is what the rate is computed over); "the machine stayed idle throughout" (load was
  checked at session start; the runs' agreement with the tune's own numbers is the ongoing
  evidence).

## Cleanup — what the lab left on the Surface

- **Server PIDs started, all stopped**: 7068 (s1n2), 30820 (s1n3 — killed after its second
  request passed 120 s), 26164 (s1n4), 74020 (s1off), 55972 (s1ncpu), 41376 (s2gfx), 45728
  (s2mix), 32180 (s2cpu4), 72548 (s2cpu8). Every run printed `PORT_FREE=True`; 30820 was
  additionally verified gone by `tasklist`.
- **Files created, all deleted by exact name** (in `C:\Users\gualt\AppData\Local\Temp\kalsa-lab-20261007\`):
  `run.ps1`; `s1n2.cmd`, `s1n3.cmd`, `s1n4.cmd`, `s1off.cmd`, `s1ncpu.cmd`, `s2gfx.cmd`,
  `s2mix.cmd`, `s2cpu4.cmd`, `s2cpu8.cmd`; `draft_body.json`, `draft_warmup_body.json`,
  `turn_body.json`, `long_body.json`; per-run outputs `<run>.out.log`, `<run>.err.log` and
  `<run>.{warm,m1,m2}.json` (s1 runs) / `<run>.{t1,l1,t2,l2}.json` (s2 runs) for the nine runs
  above; the empty `slots` directory and then the lab directory itself.

## Orchestrator's decision for plan step 3
Recommendation (b), "never sweep drafted settings on an iGPU shape", is not adopted as written: an
integrated Intel Arc measured MTP at ~2.8× on decode (recon 2026-10-05, the reason the owner chose
the wider sweep), so a blanket iGPU rule would drop a real win there. Step 3 takes the measured
version instead: a shape's sweep stops at its first drafted setting that is refused OR does not
decode faster than the same shape with the drafter off; its remaining settings leave the plan
through `lower()`. Here that stops the graphics shape after n = 2 (3.3 vs 4.7 tok/s). Assumption,
to watch: a setting that loses to off is not followed by a higher n that wins (true in every row
above).
