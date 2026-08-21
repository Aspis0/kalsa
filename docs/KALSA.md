# Kalsa — state of the app and the harness

**This is the doc to keep current.** Every new result or decision goes here, same day, as a line —
not a chapter. It is meant to be read end to end in a few minutes; detail and evidence live in
`docs/HARNESS_FINDINGS.md`, which is the long record. If a claim here has no number or no pointer,
it does not belong here.

Three docs, three jobs: **this one** is state, `HARNESS_FINDINGS.md` is evidence, and
`KALSA_DEPENDENCIES.md` is structure — one row per knob, answering *when this number changes, what
changed it?* Go there when the question is "is this derived or did someone type it".

Last updated: **2026-08-21**

---

## 1. The app

| | |
|---|---|
| What | On-device chat. No server inference: the model runs on the phone. |
| Stack | React Native / Expo, engine `llama.rn` (llama.cpp), models pulled from Hugging Face into app-private storage |
| Version | `0.1.0` (`app.config.js`) |
| Android floor | **minSdk 35** (Android 15+) — owner ship policy 2026-08-07, `7123f9e`, `app.config.js:105`. A Jelly Star on Android 13 cannot install the app; that is the policy, not a bug |
| APK | built by `.github/workflows/apk.yml`. `-f debuggable=true` produces the bench instrument (needed for `run-as`); the input defaults to `"false"` and forgetting it costs a full rebuild |
| Test gate | `npx tsc --noEmit`, `npx jest` (7 suites / 73 tests), plus `scripts/*Harness.mjs`. Jest green ≠ CI green |

**Reference build in use:** `32254348018` (debuggable, from `0378fe8`) — the one on the S23 today.
`32260408831` builds the RAM-gate fix.

---

## 2. Models — the catalogue and what actually runs

| id | size | minRamTier | engineCtx | notes |
|---|---|---|---|---|
| `qwen3.5-2b` | 1222 MiB | low | 16384 | most campaign evidence is this model |
| `qwen3.5-4b` | 2704 MiB | **high** | 8192 | the on-device speed evidence |
| `qwen3.5-4b-q3` | 2265 MiB | mid | 8192 | |
| `gemma-4-e2b` | 2963 MiB | none | 8192 | |
| `lfm2.5-2.6b` | 1597 MiB | none | 8192 | |
| **`lfm2.5-8b-a1b`** | **4917 MiB** | **none** | 8192 | **the model we ship**. MoE, ~1B active, `preserveThinking: true` |
| `lfm2.5-8b-a1b-kexp` | 3172 MiB | none | 8192 | our requantization of the row above. **SIDELOAD ONLY** — `hfRepo` does not host it |

⛔ **The shipping model does not load on a Galaxy S23** (confirmed on hardware 2026-08-19, §7.11).
`'model.fit', '{"verdict":"does_not_fit","availableMb":4030}'`, no engine init attempted, and a chat
turn returns *"Caricamento del modello non riuscito… tocca Riprova caricamento"* in the same
millisecond — advice that cannot work, since the RAM will not differ next time.

Why, and why the refusal is **correct**: weights are mmapped and evictable, but ARM weight repacking
allocates a full-size **anonymous** second copy (`repack.cpp:4751`), and MoE expert tensors are
eligible (`:4791-4795`, `MUL_MAT_ID` with 3-dim `src[0]`; `block_q4_K` has traits). In an 8B-A1B the
experts are nearly the whole file. 4917 MiB × 0.8951 + 249 MiB = **4650 MiB non-evictable** against
**4030 MiB** available.

Two RAM gates, both fixed 2026-08-19 to model the load mode the engine will actually use (default
unchanged, so production is byte-identical): `evaluateModelFit` (blocks lazy restore, logs
`model.fit`) and `gateForModel` inside `ensureEngineForModel` (`AppShell.tsx:2951-2965`, produces the
error bubble, refuses before any engine init).

⛔ **And with `no_extra_bufts` it loads but does not work** (measured 2026-08-19, §7.13). The gate
opens (`verdict":"tight"`), native init takes ~12.6 s, `RssAnon` is **32 MiB** instead of 4401, the
system keeps 4.57 GB — and then it decodes at **0.357 tok/s: 10.4 minutes for one 222-token reply**.
Prefill is *normal* (18.0 tok/s, the same as the 4B), so this is not missing kernels; the file is
only **51 % resident** and a MoE picks different experts every token and every layer, so the leading
reading is I/O. Not thermal: measured 0.3627 cold and 0.3572 warm.

**So both configurations are dead ends on 8 GB: repack on will not load, repack off answers in ten
minutes.** But the size is not the ceiling — a 35B MoE has run on this phone — so the fault is the
regime, not the model.

**We already have the smaller model.** `LFM2.5-8B-A1B-KEXP.gguf`, **3.10 GiB** (3 326 160 384 B,
sha256 `b07c8087…`), quantized with our own recipe: q2_k on routed gate/up, q3_k on down, q5_k/q6_k
on the leading dense blocks, f32 norms.

✅ **Measured on the phone: it stays resident, and it decodes at ~22 tok/s** (§7.20, 2026-08-20).
`RssFile` plateaus at ~3 330 000 kB against a 3 248 203 kB file (**~96 % resident**, vs 53 % for the
4.80 GiB build) and `workingset_refault_file` on a warm turn falls **130×**. Four consecutive turns:
**19.97 · 21.81 · 22.26 · 21.98 tok/s** — **2.7× the dense 4B in production config** (8.06), which is
what ~1B active parameters should buy.

⛔ **The 0.861 tok/s this doc carried until 2026-08-20 was a transient, not the model.** §7.15's two
turns ran in the wake of §7.14's 93.5 GiB storm on the 4.80 GiB build. §7.20 reproduces it on
command — run the Q4_K_M model first (0.263 tok/s, 58 GiB re-read), then KEXP: turn 1 **1.15**, turn
2 **20.92**. A model switch invalidates the next turn or two; measure four turns and quote the
plateau.

⚠️ **The confound to drop next:** every device number so far, this one included, was measured with
`norepack=1` — ARM GEMM **off** — because at 4.80 GiB the repacked buffer did not fit. At 3.10 GiB it
should: 2839 + 249 = **3088 MiB non-evictable against 4016 MiB of measured `MemAvailable`**,
conditional on the file pages being released after repack. `RssAnon` vs `RssFile` settles it in one
turn. **Not yet run.**

⚠️ **It misses our own pre-declared quality gate**, and the gate was frozen before the numbers
existed, so it is not renegotiated here. Same k=4, our multi5 corpus, macro bpb:

| | Q4_K_M | KEXP | Δ |
|---|---|---|---|
| macro (5 langs) | 1.2221 | 1.2926 | **+0.0705** — gate was ≤ +0.05, **fails** |
| it | 1.3206 | 1.4115 | +0.0909 (per-lang gate ≤ +0.10, passes) |
| zh | 1.5923 | 1.6976 | **+0.1053 — fails** the per-lang gate too |

`KEXP-k2` never finished (`PIPELINE_STATUS: RUNNING_KEXP-k2`, 2026-08-13). **Open for the owner:**
+0.07 macro bpb against a model that does not run at all is a different trade from the one the gate
was written for, and it is a product call, not a technical one.

Carried over from the deleted `ROADMAP_BIGGER_MODELS.md` (its subject now lives in the
`moe-experiments` repo): the product priority is **6 GB+ phones**, the mass market, not the flagships;
and the quant-quality reference is Q4_K_M ≈ 99 % of BF16, Q3 ≈ 95 %, IQ2 ≈ 87 % (Unsloth evals).

---

## 2.1 The lineup — model × quantization × phone

**This is the table to update after every device run.** One row per (model, quant, phone,
load config). Empty cell = **not measured**, and it stays empty until it is: a blank here is a
result, an invented number is a defect. Research-only models (CalaQwen, Marco1c, Mellum2) live in
the sibling repo's `docs/ALIVE.md` §5 — they are engine vehicles, not Kalsa candidates, and mixing
them into this table is how the two questions got confused.

**Read `MB/token` first.** It is the weights each generated token pulls, and it predicts decode
better than anything else: decode tok/s ≈ achievable bandwidth ÷ MB/token. It is **computed** from
the tensor map, not measured. Everything else in the table is measured.

⛔ **Every `MB/token` in this table is now from a tensor map. The three that were "estimated from
the file" were all too LOW, not too high** (§7.31) — the opposite of the direction §7.28 assumed
when it discounted its own throughput spread. On a dense model with tied embeddings the number is
essentially the whole tensor set, because the tied `token_embd` is read in full as the output head
every token: LFM2.5-2.6B is 1451 MB of blocks **plus 215 MB of tied head = 1666**. Only a sparse
model separates the two, which is the whole of KEXP's 848.

| model | quant | file | MB/tok (computed) | phone | load config | decode tok/s | resident |
|---|---|---:|---:|---|---|---:|---|
| LFM2.5-8B-A1B | Q4_K_M | 5.15 GB | ~1030 | S23 | **production (repack)** | **does not load** — gate refuses, 4650 MiB non-evictable vs 4030 available (§7.11) | — |
| LFM2.5-8B-A1B | Q4_K_M | 5.15 GB | ~1030 | S23 | `norepack=1` | **0.26 · 0.31 · 0.36 · 0.36** (4 runs) | **51 %** — 58–93 GiB re-read per turn (§7.13, §7.14, §7.20) |
| LFM2.5-8B-A1B | Q4_K_M | 5.15 GB | ~1030 | Jelly (G99) | CLI, `k=4` | 10.60 · `k=3` 12.28 · `k=2` 14.38 | RSS ~5 GiB, no thrash |
| LFM2.5-8B-A1B | Q4_K_M | 5.15 GB | ~1030 | Jelly (G99) | **in-app, `norepack=1`, unplugged** | **4.23** (turn 1; turn 2 never finished inside 420 s) | **100 %** (`RssFile` 5.15 GB) but only **0.92 GB `MemAvailable`** — lmkd killed the app at turn 8 in a second run (§7.27) |
| **LFM2.5-8B-A1B-KEXP** | q2_K/q3_K experts, q5_K/q6_K trunk | **3.33 GB** | **~848** | **S23** | **`norepack=1`, fresh chat, 4 turns** | **19.97 · 21.81 · 22.26 · 21.98** (§7.20) | **96 %**, `majflt` 14–55/turn |
| LFM2.5-8B-A1B-KEXP | same | 3.33 GB | ~848 | S23 | `norepack=1`, **real 16-turn conversation** | 18–20 early · 14–17 mid · **0.7–4.4 late** (§7.23) | — |
| LFM2.5-8B-A1B-KEXP | same | 3.33 GB | ~848 | S23 | `norepack=1`, **second arm after a long session** | **0.3 – 4.1 on every one of 9 turns** (§7.24) | — |
| LFM2.5-8B-A1B-KEXP | same | 3.33 GB | ~848 | S23 | **production (repack)** | **unstable: 0.45 – 19.96 across 13 turns** (§7.21) | trunk repack costs ~0.5 GB anon |
| LFM2.5-8B-A1B-KEXP | same | 3.33 GB | ~848 | Jelly (G99) | CLI, `k=4` | 8.83 — **slower than Q4_K_M on this SoC** | — |
| **LFM2.5-8B-A1B-KEXP** | same | 3.33 GB | ~848 | **Jelly (G99)** | **in-app, `norepack=1`, unplugged, 4 turns** | **7.31 · 7.14 · 6.95 · 6.80** — **1.6× faster than Q4_K_M in the app** (§7.27) | **100 %** (`RssFile` 3.42 GB), `io_read` frozen at 3 389 177 856 — **zero flash re-reads**, 2.37 GB headroom |
| LFM2.5-8B-A1B-KEXP | same | 3.33 GB | 848 | Jelly (G99) | **in-app, `norepack=1`, ON THE CHARGER, 5 restore cycles** | **7.43 · 7.04 · 7.12 · 7.10 · 7.26** (§7.30) — reproduces the unplugged row above, so charging is not inflating decode on this phone | — |
| Qwen3.5-4B | Q4_K_M | 2.83 GB | ~2700 | S23 | production (repack) | **8.06** | `RssAnon` 3.77 GB, `MemAvailable` 930 MB, **961 majflt/token** |
| LFM2.5-2.6B | Q4_K_M | 1.67 GB | **1666** (tensor map, §7.31) | Jelly (G99) | **in-app, production, unplugged, 4 turns** | **5.68 · 5.53 · 5.40 · 5.27** (§7.28) | `RssAnon` 1.95 GB (repack), `MemAvailable` 2.27 GB — prefill 190 s → **2.7-3.2 s, KV reused** |
| Qwen3.5-2B | Q4_K_M | 1.28 GB | **1270** (tensor map, §7.31) | Jelly (G99) | **in-app, production, unplugged, 4 turns** | **6.61 · 5.73 · 4.94 · 6.70** (§7.28) | **prefill never drops: 80.7 · 101.3 · 127.7 · 85.2 s — KV never reused** |
| Qwen3.5-2B | Q4_K_M | 1.28 GB | **1270** (tensor map) | S23 | — | **~17.2 predicted, unmeasured** | S23 unavailable 2026-08-21 |
| LFM2.5-VL-3B | Q4_K_M | 1.67 GB + 583 MB mmproj | **1666** (its backbone's tensor map, §7.31) | S23 | — | **13.1 predicted, unmeasured** | **tier-1 pick.** Language backbone *is* LFM2.5-2.6B, so the Jelly row above is its text behaviour |

**Quality and tools — properties of the model+quant, not of the phone:**

| model | quant | macro bpb vs Q4_K_M | tool structured output | tool precision / recall |
|---|---|---:|---|---|
| LFM2.5-8B-A1B | Q4_K_M | baseline | — | — |
| LFM2.5-8B-A1B-KEXP | q2_K/q3_K | **+0.0705** (gate ≤ +0.05, **fails**; zh +0.1053 fails per-lang) | **intact** — 0 parse failures, 0 fallback dialect, 0 empty bubbles, 0 truncations over 14 turns × 2 arms | gate ON **0.75 / 0.43** · gate OFF **0.83 / 0.71** (§7.22) |

⛔ **Our own tool gate costs more than the quantization does.** Turning `toolgate` off on the same
model, same seed, same 14-turn plan: recall **0.429 → 0.714**, precision **0.750 → 0.833**, missed
calls **4 → 2** — and the single spurious call is **unchanged**, so the rule blocks good calls and
does not stop the bad one. §1.1 predicted exactly this from the scoring rule; this is the first time
it has been measured on the model we would ship. The largest available improvement to Kalsa's tool
use is a JavaScript rule, not the weights. Two misses survive the gate being off, and
`tool_selection` is 1/3 — those are the model's, and they are the only part a fine-tune could
address. n=1 seed; both arms ran with production repack.

**What the two tables already say, and it is not what we assumed:**

1. **The winning quant flips with the silicon — and the CLI ranking does not survive the app.**
   The S23 is bandwidth-bound (18.7 GB/s achieved) so fewer bytes wins → KEXP. On the Jelly, under
   `llama-cli`, the machine is dequant-bound (6.1 GB/s achieved against a ~10.8 GB/s roof) and
   cheaper unpacking wins → Q4_K_M at 10.60 against KEXP's 8.83, *despite reading 20 % more bytes*.
   **Inside Kalsa that ordering inverts: KEXP 6.80–7.31, Q4_K_M 4.23** (§7.27). The CLI number was
   not wrong — it was measured without the app's own ~1.5 GB in RAM. Add that, and Q4_K_M has
   0.92 GB of `MemAvailable` left where KEXP has 2.37 GB, so it spends the difference fighting the
   reclaim path instead of decoding. **Benchmark the quant inside the app that will ship it**;
   a CLI ranking is a statement about the kernel, not about the product. There is still no single
   best quant, and the choice must stay per-phone.
2. **A 20 tok/s floor is a byte budget.** At the measured bandwidths: S23 ≤ 935 MB/token,
   Jelly ≤ 540 MB/token. KEXP is at 848 — inside on the S23 with ~10 % margin, **1.6× outside on the
   Jelly**, and on the Jelly the binding constraint is not even bytes. **Now measured, not predicted:
   the Jelly's best in-app result on this model is 7.31 tok/s** (§7.27). Neither quant reaches the
   owner's 20 tok/s floor there, and the gap is 2.7× — not something a quant choice closes. The
   Jelly needs a smaller *byte budget* — which is **not** the same as a smaller model, and the
   original wording of this line ("needs a smaller model") was wrong. A dense 2B reads **more** bytes
   per token than this sparse 8B: Qwen3.5-2B ~1230 MB/tok and LFM2.5-2.6B ~1600, against KEXP's 848.
   On bytes alone both "small" models are worse. What pulls the other way is unpacking cost — they
   are q4_K_M, KEXP is q2_K/q3_K — and on a dequant-bound phone that is the term that matters. The
   two effects push in opposite directions and only a measurement settles it; the arm is running.
3. **The 22 tok/s figure is a fresh-chat number and does not survive a real conversation.** It holds
   for the first 3 turns, drifts to 14–17 as thermal moves to status 2, and collapses to 0.7–4.4 on
   several late turns (§7.23). Worse, the collapsed regime can become **persistent**: a second arm run
   straight after a long session never exceeded 4.12 tok/s across nine turns (§7.24). Cause not
   established — memory pressure and sustained thermal are confounded, and the instrumented re-run
   that separates them is owed.
4. **59 % of KEXP's per-token read is not experts**: shortconv projections 215 MB, the tied
   `token_embd` output head 180 MB, dense FFN 63, attention 44 — against 346 MB of experts. The
   recipe put its cheap bits where only 4 of 32 tensors are read and left the always-read trunk at
   q5_K/q6_K.

---

## 3. Engine knobs — measured, never invented

Rule (from `docs/DEVICE_TUNING_LAYER.md`, status DESIGN): every knob traces to a measurement, an
unmeasured device gets the safest measured value, and every resolved knob carries a provenance
string.

| knob | value | source |
|---|---|---|
| threads | Helio G99 2 decode / 8 prefill · SD 8 Gen 2 → 5 · SD 8 Gen 3 → 6 · iOS 4 | llama-bench + threadProfile harness |
| threads danger | `>= 7` gave 0.06 tok/s decode on SD 8 Gen 3 | measured |
| ubatch | 256 (compute buffer ≈ 249 MiB) | measured, lmkd guard |
| KV cache | k `q8_0` / v `q4_0` | catalog |
| n_ctx | catalog `engineCtx`; hybrids upgrade to 16384 only above **7.5 GB total RAM** — the S23 has 7.42 GB and **misses it by 82 MB** | `contextProfile.ts:45,61-63` |
| repack | production ON. `kalsa.bench.norepack=1` turns it off | see §2 |

---

## 4. How a prompt is assembled

`[system prompt] + [history window] + [optional operative block prefixed onto the LAST user message]`.

| context mode | window | digest | shipped |
|---|---|---|---|
| `off` | legacy **sliding**, sized by a **char budget derived from the loaded `n_ctx`** — 40 messages is only the cap, and on an 8192 context ~19 messages is what actually fits; images always 8 | none | **yes, this is the default** |
| `ciswire` | same sliding window | BM25 digest of what fell out of it | no (off by default) |
| `v42` | boundary-anchored, append-only between rebuilds | same digest | no; measured worse on recall |

The operative block = 4 fixed instruction strings (language, web search, honesty, miniapp) + digest
(≤900 chars) + rolling summary (≤600 chars). It exists **only** when there is a digest or summary,
so with `off` there is no block at all.

**Memory subsystem**: opt-in, `kalsa.memory.enabled`, **off by default**. When on it runs a full LLM
completion every turn (+40 % wall clock), has stored nothing in any campaign, and calls
`engine.clearCache()` — so it discards the KV cache by construction.

---

## 5. The KV cache — what is actually true

Reuse per turn is **not** a smooth fraction. Two regimes, one per model
(`llm_arch_supports_rs_rollback`: true for Qwen3.5, false for LFM2):

| | LFM2.5-8B-A1B (shipping) | Qwen3.5-4B |
|---|---|---|
| per-turn reuse | **0.98 or exactly 0** — 600 observations, 595 zeros, 5 above 0.90, none in between | continuous (482 of 570 turns strictly between 0 and 0.90) |
| cost of one divergent token | **the whole cache** | only the suffix after it |

Destroyers, in measured order of size:

1. **The sliding window — biggest, and it hits `off` too.** 20 messages ≈ 10 exchanges; past that the
   oldest exchange leaves the window every turn, the prompt's first message changes, and the prefix
   dies right after the system prompt. On the 4B: mean reuse **0.82 at turn 11 → 0.15 at turn 12**,
   in `baseline`, which never carries a digest. Prompt tokens plateau at ~4750 there, confirming it.
   **Doubled 2026-08-19** to 40 messages where the loaded context is ≥16384 — twice the good regime.
   Trade: a miss now costs ~9500 tokens of re-prefill instead of ~4750, so it is a win only while
   misses are rare, which on the shipping model they are not until tool rounds are replayed.
2. **Tool calls.** A tool round puts `assistant(tool_calls)` + `tool(result)` in the KV
   (`LlamaService.ts:1930-1941`) while stored history keeps only the final answer. On the shipping
   model that is total: **10 of 10 turns after a tool call lost everything, zero survivors**, prefill
   3 s → **195–405 s**. On the 4B the same event costs 0.507 vs 0.637.
3. **The digest**, −0.100 reuse with window and tool turns controlled, p = 0.0016.
4. **Memory extraction**, which calls `clearCache()`.

**Fixed and measured:** `preserve_thinking: true` on the shipping model (§7.9, `31c5489`) — reuse
0.035 → 0.599, prefill 255 s → 111 s, turn 295 s → 160 s, at +85 prompt tokens.

**Not attempted:** replaying tool rounds in history (the biggest lever on the shipping model), and an
append-only window.

---

## 6. What the harness proved

`ciswire` in every campaign so far means **the organelle-B digest alone**; the memory subsystem has
never been enabled in one.

| # | question | answer | confidence |
|---|---|---|---|
| 1 | Better than bare for small models? | **Yes on all three.** 2B +0.635 (p=0.0043) · shipping 8B +0.312 (p=0.0291) · 4B +0.209 (p=0.0108) | high |
| 2 | Better tool / web-search use? | **Yes — tool precision nearly doubles** (0.241 → 0.485 on the 2B) | medium (one seed) |
| 3 | Holds context after many turns? | **Yes — no decay at all.** Strongest result we have | high |
| 4 | Faster / less prefill? | Fewer tokens, but the cache dies at ~10 exchanges in *every* mode, and on the shipping model at the first tool call | high on the costs, none on any fix |
| 5 | Small models only? | **Not about size.** It helps whichever model holds context worst — that is the shipping MoE, not the small dense one | high |

⚠️ **Reuse warning.** If this deterministic harness is ever pointed at delicate domains — medical,
legal, psychological — remember that small models answer confidently and wrongly, and that the
primary metric scores "I don't know" the same as a wrong answer (§3.8).

---

## 7. The phone

Galaxy S23 (`SM-S911U`), wireless adb `192.168.1.152:5555`. **Ask before disconnecting it.**
**Timings are invalid while charging.** **Never uninstall the app** — several GB of models live in
app data.

| | |
|---|---|
| RAM | 7 243 740 kB total; ~4030 MiB available idle → tier `high` |
| Disk | 27 GB free |
| Thermal | cools 44 → 29 °C in ~10 min screen-off; stop rules: status ≥ 3, ≥ 44.0 °C, **battery < 30 %** |
| Battery floor | **30 %**, not 40 — owner 2026-08-19: performance holds down to 30. The old 40 was costing usable measurement time on a device we can only run unplugged |
| Battery | ~30 %/h of sustained inference → ~2.3 h per discharge above the floor |
| Load | 4.7 s cold (4B), 0.8 s warm from page cache; KV session restore 33–45 ms |
| Speed | **all decode and residency numbers live in §2.1**, one table, model × quant × phone. Do not add speed rows here — two places holding one number is how this doc drifts |
| Prefill | ~18 tok/s cold on both the 4B and the 8B MoE; ~12–22 tok/s on KEXP depending on cache state. Prefill is *not* the phase that separates the models |
| Why | **page-fault storm, measured**: 93.5 GiB of file pages re-read from flash in one 1134 s turn, 309 MiB per generated token, `RssFile` oscillating 4.15 → 2.02 → 2.52 GB inside one pid (§7.14) |
| GPU — **our** Adreno 740 | ⛔ **SUPERSEDED 2026-08-21 — see §7.33's retraction banner.** This row said MoE decode was 0.41–0.44× the CPU and that the Adreno K-quant MoE gate must not be lifted because those kernels measure ERR 0.36–0.9 against a 0.0005 threshold. Both halves rested on **broken or gated-off kernels**: `use_adreno_moe_kernels` excludes A7X and 730/740/750 are all A7X, so K-quant MoE never reached the GPU — the decode figure measured **CPU fallback with graph splits**. The parallel session has since repaired those kernels, certified them bit-exact against the CPU reference (nfail=0), and measured **experts on GPU at 2.17× burst / 1.5× sustained, cooler**. Prefill remains a GPU lever. |
| GPU — **Adreno 750 and up** | **"da Adreno 750 la GPU fa volare tutto"** (owner, 2026-08-19). Prefill is measured on a Xiaomi 14: **5.26–5.97×** the CPU, unplugged (§7.33). ⛔ The decode **0.44×** this row used to carry is **withdrawn** — it predates the OpenCL expert-kernel repair and measured CPU fallback (§7.33 banner). Open: a Vulkan-vs-OpenCL cell on the S23 decides which backend this silicon wants |
| GPU — **what it costs in RAM** | With `n_gpu_layers=99` the weights leave the process entirely: app RSS ~150 MB while system `MemAvailable` falls **4.02 GB → 583 MB**, then lmkd kills the app at `oom_score_adj 0` (§7.18). **The RAM fit gate cannot see driver memory** — it would pass this configuration |
| ⚠️ prior art | **`~/Projects/kalsa-moe-experiments` already measured most GPU/kernel/quant questions.** Read it before opening one — `docs/kernel-plan-v1.md:113-118`, `mandates/research-adreno740-custom.md`, `results/xiaomi_ab/curve_table.md`. Engine fork: `Aspis0/kalsa-engine` (ours; never the public upstream) |
| Bigger models | a 35B MoE has run on this phone with a streaming engine, so file size is **not** the ceiling — the mmap regime is |

### The Jelly Star — second device, onboarded 2026-08-20

Low-end half of the matrix: MediaTek G99 (2×A76 + 6×A55), weak CPU/GPU, **8 GB RAM**. Not a toy —
it is the device that answers "what happens on cheap silicon", and it holds a resource the S23 does
not.

| | Jelly Star | S23 |
|---|---|---|
| `MemAvailable` idle | **5.36 GB** | 4.0–4.2 GB |
| Android | **13 (API 33)** | 15 |
| what fits resident | the 5.15 GB Q4_K_M **does** (10.60 tok/s, CLI) | it does not (0.26–0.36) |

**Measured 2026-08-21 (§7.32, §7.36) — read rather than assumed:**

| | |
|---|---|
| Cores | **6×A55** (`cpu_capacity` 348, max 2.0 GHz) + **2×A76** (1024, 2.2 GHz). Governor `sugov_ext` on the big pair; the little policy's governor file is `0660 system:system` and unreadable from shell |
| Threads | `deviceTuning.ts` preset `helio-g99`: decode **2** (= the two A76s), prefill **8**. **Correct, measured** — prefill `promptMs` is 113 867 / 92 999 / 77 419 / 72 121 ms at 2/4/6/8 threads, monotonic, and the 2/4/6 arms repeat within **0.1 %** when the run order is reversed (§7.36). More threads is faster; 8 is **not** distinguishable from 6 |
| Storage | **UFS**, not eMMC (`/sys/class/block/sda` under `11270000.ufshci`, no `mmcblk*`; `ro.vendor.mtk_emmc_support=1` is a vendor flag, not the block layer). `/data` is **f2fs**, `fsync_mode=nobarrier`, **137 GB free** of 228 |
| Sequential read | **984 MB/s** coldest, 2.9–3.2 GB/s from page cache → a cold KEXP load has a **~3.4 s floor** no tuning removes |
| Prewarm | **69–114 s** for the ~1 300-token system+tools prefix, and **no thread setting fixes it** (§7.36). The lever is §7.30's restored session: 120.8 s cold start → **1.8 s** |
| Session pool | per-conversation key confirmed on device; real file **5.16 kB/token** against the gate's 64 kB estimate — a **12.7×** over-charge, fixed 2026-08-21 (§7.30) |

⛔ **Unplugged, it falls off adb within minutes — and the cure already exists.** Pull the charger and
the phone hits `screen_off_timeout`, then Doze, and the wireless-debugging listener stops accepting:
`Connection refused` on the advertised port, surviving `adb kill-server` and fresh mDNS discovery,
while the phone still answers ping (latency 5 ms → 30–115 ms, i.e. wifi power-save). Recovering it
needs Developer options re-enabled **by hand**, possibly on a new port.

**There is a second channel, and it survives what adb does not.** Termux runs an sshd on
**:8022** (`u0_a225@192.168.1.82`) — verified open on 2026-08-20 while adb was refusing. The
`moe-experiments` campaigns used it as the resilient route
(`reports/moe-jelly-freetier.md:112,122`, `scripts/run_kexp_jelly_orch.py:17`), and that repo already
documents this exact failure: *"Wireless adb/sshd dead on Jelly despite ICMP up — classic
post-reboot / screen-off loss of wireless debug"*. ⚠️ **Its key is not on this Mac** (the campaigns
were driven from the Windows desktop), so from here the channel is visible but unusable until a
pubkey is added to Termux's `authorized_keys`. Worth doing once: it removes the only step that needs
hands on the phone.

⚠️ **The adb port changes every time.** 44395 in the August campaigns, 39591 on 2026-08-20. Always
rediscover with `adb mdns services`; never hardcode it.

**Do not let it get there.** `device_keepawake_setup` (`ci-lib.sh:719-733`) raises
`screen_off_timeout` and whitelists the package from Doze/app-standby. Its own comment records that
this failure already happened *on the S23* mid-arm, which is why it was written.

⚠️ **It is scoped to the script that calls it, with a restore trap** — so running an unplugged
session as a series of separate commands installs and tears down keep-awake each time, and the phone
sleeps in the gaps. Verified the hard way on 2026-08-20: every command logged
`keep-awake: restored screen_off_timeout` on exit, and the Jelly dropped off adb the moment the
charger came out. **Batch all unplugged work into ONE script invocation** that sets keep-awake once
at the top.

**How to reach it — it is NOT on port 5555.** It uses modern wireless debugging on a *random* port
that changes across reboots. Do not port-scan; discover it:

```
adb mdns services          # → adb-JELLYS0000053795-…  _adb-tls-connect._tcp  192.168.1.82:39591
adb connect 192.168.1.82:39591
```

**It needs its own build.** Kalsa ships `minSdk 35`; the Jelly is API 33, so the standard APK will
not install. Branch **`bench/jelly-minsdk33`** carries the single-line lowering and is **NOT FOR
MERGE** (minSdk 35 is owner ship policy, `7123f9e`). Build it with `apk.yml -f debuggable=true`;
`adb install -r` updates in place and preserves app data. Verified 2026-08-20: installs, launches on
Android 13 with no crash, `run-as` works, so the campaign machinery can reach it.

⛔ **The UI-driven campaign path does NOT work on this screen.** `type_into_composer` garbles: the
text interleaves and duplicates (`[Ricorda anche il coloRicorda anche il colored e Zaffiro…]`), 3
attempts out of 3, arm dead at turn 2. **Cause found 2026-08-21 and fixed:** the composer was
cleared with a fixed 60 backspaces against prompts longer than that — 89 chars typed, 81 landed, 60
deleted, 21 left, and the retype concatenated onto them. `clear_composer` now deletes the field's
actual length. ⚠️ **The fix is not yet confirmed on this screen**; until a graded arm completes here,
assume the Jelly takes **single messages, not multi-turn conversations**, and drive it with
`kalsa://share?text=`.

**Models present in the app** (updated 2026-08-21): `qwen3.5-2b`, `lfm2.5-8b-a1b` (Q4_K_M),
`lfm2.5-8b-a1b-kexp`, `lfm2.5-2.6b`, plus the `multilingual-e5-small` embedder. The 8B Q4_K_M and
the 2.6B were sideloaded with md5 verified Mac → `/data/local/tmp` → app storage. So the model we
ship **can** now be measured here; §7.27 and §7.28 are those measurements.

**`/proc/diskstats` and `/sys/class/block/*/stat` are root-only on this device.** The per-turn probe
therefore reads **`/proc/<pid>/io` through `run-as`** instead, which is better anyway: `read_bytes`
is attributed to our process and counts bytes actually fetched from the block layer, so it excludes
page-cache hits — precisely the distinction §7.20–§7.24 turn on. Verified live: `io_read_bytes`
matched the loaded GGUF's size to the byte.

Driving it: `scripts/device-share-send.sh` (`kalsa://share?text=`) — the type path is a no-op on a
real device. Runners in `~/kalsa-scripts/`, output in `~/kalsa-runs/`. **Not `/tmp`**: it was wiped
twice mid-campaign and took an APK and a runner with it.

---

## 8. How to measure

- **CI**: `.github/workflows/bench.yml`, phases `fase0 | fase4 | smoke | tools | mem`, arms as a seed
  matrix. Knobs are AsyncStorage prefs written by `scripts/ci-bench.sh` with a both-branch assert, and
  every pref lands in `prefs.txt` so an arm cannot claim a setting it did not run.
- **Significance**: exact two-sided permutation tests on per-seed arm means.
- **The trap that has cost two campaigns**: check probe density and that the arm can differ *at all*
  before spending a run. A 7-turn conversation against a 20-message window leaves the digest empty,
  and `ciswire` then renders byte-identical to `off`.

---

## 9. What we do not know

- ~~Where KEXP's 0.861 tok/s goes~~ — **closed 2026-08-20, §7.20: it went nowhere.** The steady
  state is ~22 tok/s; the 0.861 was page-cache contention left by the 4.80 GiB model, reproducible on
  command. Refuted along the way: batch-1 `MUL_MAT_ID`, the minor-fault hypothesis (519 per token,
  not 167 000) and any thread pathology (2 threads 13.26 vs 5 threads 21.32 — sublinear and healthy).
- **Why the collapsed regime becomes PERSISTENT.** §7.20 showed it recovers in one turn after page-cache
  contamination; §7.24 showed a whole arm stuck below 4.12 tok/s for an hour. Two candidates —
  cumulative memory pressure and sustained thermal — **confounded**, because that arm ran entirely at
  thermal status 2. The 14-turn re-run with per-turn `RssFile`/`majflt`/`MemAvailable` separates them.
  This is the highest-value open question we have: it decides whether the app degrades permanently
  after a long session.
- ~~Whether a `.kvs` restore avoids the prefill on `lfm2moe`~~ — **YES, measured 2026-08-20 (§7.25):
  83.9 s → 1.5 s**, `is_hybrid=1 resumable=1`, state loaded in 29 ms, 1672/1747 prompt tokens reused.
  #25913 is a `llama-server` defect and does not touch our path. **The UFS session pool is
  buildable**: `sessionPersistence.ts` keys per *model*, so every chat switch is a cold start
  (`AppShell.tsx:3237` says so in a comment) — what is missing is the key and an LRU budget.
- **The device gate knows how much RAM a phone has and nothing about how fast it is.** Owner call
  2026-08-21, approved: fix it by *measuring* bandwidth, not by identifying the memory.
  `deviceProfile.ts` decides everything on capacity — `totalMemoryBytes`, `getRamTier`,
  `estimateModelNonEvictableMiB`, `evaluateModelFit`. That is why it happily starts a model on the
  Jelly that then decodes at 4.23 tok/s: it fits, so the gate is satisfied. Capacity answers *will it
  run*; it says nothing about *will it be usable*, and §7.27 is the proof — two phones, both 8 GB,
  both 100 % resident, **3× apart** in decode.
  **Not the fix: identifying the RAM type.** LPDDR4X vs 5X is not exposed reliably to an app, a
  `Build.SOC_MODEL` → memory lookup is exactly the hardcoded table the owner has ruled out, and it
  would still miss half the Jelly's problem — the A55 cores cannot dequantize fast enough, which no
  memory datasheet reports.
  **The fix: one calibration decode per device.** `MB/token` is already computed from the tensor map
  for every catalog entry, so a single measurement inverts into the device constant:
  `achieved_bandwidth = measured tok/s × MB/token`. That constant then predicts every other model in
  the catalog, **including ones never downloaded**. The gate gains a second question next to "does it
  fit": `bandwidth ÷ MB_per_token ≥ floor`.
  **Four honest limits, to be built in from the start:** (a) measure on a *fresh chat* and keep the
  result as a **ceiling**, because §7.23 shows the achieved rate decays within a session; (b) apply a
  margin rather than gating on the raw number; (c) until a measurement exists, use a prudent default,
  not an invented one; (d) **a single scalar per phone is an approximation on dequant-bound devices**
  — the Jelly's own achieved bandwidth is ~7.5 GB/s under KEXP's q2_K/q3_K but ~10.9 GB/s under
  q4_K_M, because unpacking cost, not bytes, is its binding constraint. Strictly the constant is per
  (phone, quant family); one scalar will over-predict cheap quants and under-predict exotic ones.
- **Five design calls on the UFS session pool that are the owner's, not the code's.** The pool is
  written and under audit (2026-08-21). Six correctness defects are being fixed; these five are not
  defects, they are choices:
  1. **Which context does a "chat" cost?** The budget bills `5200 B/token × 8192` = 42.6 MB, but
     `qwen3.5-2b` runs at `engineCtx: 16384` (`ModelRegistry.ts:196`) and `ModelRegistry.ts:126`
     warns the runtime may upgrade others. At 16k a chat costs 85 MB, so "7 chats" is really 3.5.
     Bill the real per-model context, or label the setting in MB and stop promising a chat count.
  2. **Is the budget hard or soft?** Today a single session larger than the whole budget is kept and
     nothing is evicted — the cap is silently exceeded to avoid deleting the active chat. Defensible,
     but then it is a target, not a cap, and the Settings copy should not imply otherwise.
  3. **When does eviction run?** Only on save. A reader never evicts, and *lowering* the setting
     evicts nothing, so the pool can sit over budget indefinitely.
  4. **The disk gate disagrees with the pool by 19×.** `estimateSessionBytes` charges 64 KB/token
     (`sessionPersistence.ts:318`), so an 8192 save demands 805 MB free while the real file is 42 MB.
     The pool can have room and the gate still refuse. That constant predates the pool and is now
     measurably wrong for these models (§7.25 measured ~5.2 kB/token, and §7.30 caught the gate
     live on the shipping model: 127 533 056 B charged against a 10 041 119 B file — **12.7× over**).
  5. **What should "new conversation" do to a warm KV?** The fallback that invalidated it is now
     unreachable (the parent always supplies the callback and returns early on an empty chat), so a
     cleared chat can reuse the native KV of the conversation it just emptied.
- **What `ciswire` does on a phone.** Still zero device measurements: the 2026-08-20 arm was vacuous
  (`corpusSize: 0`, digest never populated — §7.24). ⛔ **The "≥12 turns" rule this bullet used to
  give is WRONG and cost us a repeat of the same blind arm on 2026-08-21** (§7.35): it was arithmetic
  against `LEGACY_MAX_HISTORY = 20`, and `AppShell.tsx:4541` no longer calls that path — the live
  window is `windowStartIndex`, 40 messages under a character budget of 13 824 (11 059 with a
  digest) at `n_ctx` 8192. A 16-turn conversation is 30 messages and ~7 653 characters, so **nothing
  falls outside the window and the corpus is empty no matter how many turns you run**. The gate is
  the **character budget**, not the turn count: force it with the bench's `winbudget` input, and
  check `boundaryByTurn` actually advanced before reading any number.
- **Whether repack is costing us decode on this device.** The `.so` in production is
  `..._v8_2_dotprod_i8mm_...` (confirmed in logcat); the other tree measured REPACK + i8mm turning
  Q4_K into `q4_K_8x8_q8_K` — a GEMM win and a **GEMV loss** worth +47 % of decode when removed. The
  dense 4B with repack ON held 3.77 GB anonymous, dropped `MemAvailable` to 930 MB and paid 961 major
  faults per generated token. **One dense arm with `norepack=1` settles it. Never run.**
- ~~Whether KEXP at 3.10 GiB stays resident~~ — **yes**, ~96 %, §7.15. And it did buy the speed (§7.20).
- ~~What KEXP does with repack ON~~ — **void, and never worth a run.** The ARM repack backend
  implements `q8_0, q4_K, q6_K, q5_K, q4_0, mxfp4, iq4_nl`; **q3_K is absent entirely and q2_K has
  only avx512/riscv paths**. KEXP's experts are q2_k + q3_k, i.e. nearly the whole file, so on ARM
  they get no repack with the flag either way. Read in the shipped C++, not inferred.
- **GPU prefill on this device, and how CL buffers account against RAM.** Decode on GPU is answered
  and negative on this chip (§7.16), so the arm is re-aimed at prefill (3.2–7×, and it lands on
  §7.12's sliding-window cost) and at offload memory accounting, which nobody has — everything in
  §7.11–§7.15 is mapped-file accounting. **First attempt produced no GPU result** (§7.17): the arm
  could not initialise for a KV-cache reason with the GPU never involved. Fixed; APK `1df593b`
  built and unrun.
- **Whether an MXFP4-expert MoE is correct on an Adreno 740.** `supports_op` allows it in this tree
  (general `MUL_MAT_ID` branch, no Adreno gate) — but allowed is not correct, and in the other tree
  mxfp4 fails 0/74 on the Adreno path. Needs an MXFP4 GGUF from `moe-experiments` first.
- What the 4.80 GiB 8B would do with repack on — it cannot load, so there is no in-model control.
- Net wall clock of `ciswire` on a phone. Every quality number is emulator; every speed number is 4B.
- Whether replaying tool rounds recovers the cache.
- Whether a sparser digest cadence trades cache for recall acceptably (`kalsa.bench.digestcadence`,
  written, never run).
- Whether memory extraction is worth its cost — it has never extracted anything.

---

## 10. Decisions on record

| date | decision |
|---|---|
| 2026-08-07 | Android 15+ only (`minSdk 35`) |
| 2026-08-18 | **Thinking is never off and never budget 0.** Small models need reasoning to be usable |
| 2026-08-18 | **Cache beats context budget** when they conflict |
| 2026-08-18 | The shipping model is **LFM2.5-8B-A1B** |
| 2026-08-19 | `ROADMAP_BIGGER_MODELS.md` removed — big-MoE work lives in the `moe-experiments` repo |
| 2026-08-19 | **Verbatim window doubled to 20 exchanges** where the context holds it — owner's call, it is our app |
| 2026-08-19 | **Open for the owner:** the 8B is unusable on 8 GB in both configurations. Ship it only above 8 GB, or change the shipping model |
| 2026-08-19 | KEXP measured: residency solved, speed not. **No shipping decision taken** — the quality gate it misses (+0.0705 macro bpb) is not worth arguing until a repack-on arm says whether a shippable decode number exists at all |
| 2026-08-20 | **That decode number exists: ~22 tok/s (§7.20).** The row above rested on a transient. **Open for the owner, now with both sides real:** KEXP is +0.0705 macro bpb worse and 2.7× faster than the dense 4B, on a phone where the 4.80 GiB build cannot run at all |
| 2026-08-21 | **Two tiers, both LFM2 — owner's decision.** Fast tier = **LFM2.5-8B-A1B-KEXP**; quality tier with vision = **LFM2.5-VL-3B**. KEXP is the only model measured at or above the 20 tok/s floor on a real phone (22.1, S23), and the margin is structural: 848 MB/token against a 1090 budget, where every alternative is 2-3x over. Rejected with reasons: **Nemotron-3-Nano-30B-A3B** — MoE does not help by itself, 3.2B active reads ~2500 MB/token and the Q4_K_M file is **24.6 GB**, so it fails on residency before speed; **Nemotron-3-Nano-4B** (2837 MB/tok) and **Qwen3.5-4B** (2700, measured 8.06 while taking 961 major faults per token); **Jamba Reasoning 3B** (1933, Apache 2.0, but no vision so it does not serve the quality tier). The principle: **what buys speed is active parameters, not sparsity as such.** |
| 2026-08-21 | **The 20 tok/s floor is per phone generation, not absolute.** 20 on current flagships, ~10 on mid-range, and the tier is chosen from a measured device constant (§9), not a hand-written table. Consequence to state in the gate rather than let users discover: **on Jelly-class silicon nothing measured passes even 10** — best is 7.31 — so that class is a testbed, not a target. |
| 2026-08-21 | **Three reservations recorded against the model decision, all open.** (1) Both tiers are LFM2, so both inherit `llm_arch_supports_rs_rollback == false` and fail together if that limit binds — no fallback architecture. (2) ~~LFM2.5-VL-3B emits **Pythonic** tool calls between `<|tool_call_start|>`/`<|tool_call_end|>`, not JSON, so the parser needs work.~~ ✅ **CLOSED 2026-08-21.** The parser already implements that dialect — `parseLfmToolCalls` → `tryParsePythonCallList` — and it is covered: multiple calls in one block, single-quoted strings, escaped quotes, commas and parens inside string values, nested JSON values, malformed input yielding `[]` without throwing, and the streaming stripper handling tags split across deltas (exercised at 3-char chunks). **One real defect was found closing it and is fixed**: `parseArgValue` accepted the JSON literals `true`/`false` and the Python `None`, but **not Python's `True`/`False`** — so `safe=True` reached the tool as the *string* `"True"`, which a boolean parameter rejects or reads as truthy. Both capitalisations are now accepted, with a regression test. (3) LFM Open License, not Apache: free commercially under 10M USD revenue. Owner accepted (3) explicitly. |
| 2026-08-21 | **`v42` is to be deleted.** Dead on recall on two models (+0.040 and +0.062, p=0.70 both), crashes the KV *earlier* than legacy (turn 7 against 11) on its K=3 rebuild cadence, and **half of it never ran at all** — its rolling summary shows `summaryChars = 0` on every arm of every campaign because the scheduler condition is unreachable when the boundary advances on size. Delete the mode and the dead summary scheduler; **keep** `boundaryIndex` and the append-only branch of `assembleEngineHistory`, which the new `anchored` regime is built on. |
