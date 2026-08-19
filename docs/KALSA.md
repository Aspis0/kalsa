# Kalsa — state of the app and the harness

**This is the doc to keep current.** Every new result or decision goes here, same day, as a line —
not a chapter. It is meant to be read end to end in a few minutes; detail and evidence live in
`docs/HARNESS_FINDINGS.md`, which is the long record. If a claim here has no number or no pointer,
it does not belong here.

Three docs, three jobs: **this one** is state, `HARNESS_FINDINGS.md` is evidence, and
`KALSA_DEPENDENCIES.md` is structure — one row per knob, answering *when this number changes, what
changed it?* Go there when the question is "is this derived or did someone type it".

Last updated: **2026-08-19**

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

✅ **Measured on the phone 2026-08-19 (§7.15) — it stays resident, and it is still too slow.**
`RssFile` plateaus at 3 270 144 kB against a 3 248 203 kB file (**~96 % resident**, vs 53 % for the
4.80 GiB build), its oscillation drops from 2.04 GiB to 100 MiB, and `workingset_refault_file` on a
warm turn falls **130×**, from 93.5 GiB to 755 MiB. The storm is over. Decode still only reaches
**0.861 tok/s** warm (turn 1 is 0.324 and contains the load — never average the two).

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
| `off` | legacy **sliding**: last **40 messages (20 exchanges)** where the loaded context is ≥16384, else 20; images always 8 | none | **yes, this is the default** |
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
| Thermal | cools 44 → 29 °C in ~10 min screen-off; stop rules: status ≥ 3, ≥ 44.0 °C, battery < 40 % |
| Battery | ~30 %/h of sustained inference → ~2.3 h per discharge above the floor |
| Load | 4.7 s cold (4B), 0.8 s warm from page cache; KV session restore 33–45 ms |
| Speed (4B) | prefill ~18 tok/s cold, decode 5–8 tok/s |
| Speed (8B MoE 4.80 GiB, norepack) | prefill ~18 tok/s, **decode 0.31–0.36 tok/s** (3 runs), load ~12.6 s |
| Why | **page-fault storm, measured**: 93.5 GiB of file pages re-read from flash in one 1134 s turn, 309 MiB per generated token, `RssFile` oscillating 4.15 → 2.02 → 2.52 GB inside one pid (§7.14) |
| Speed (KEXP 3.10 GiB, norepack) | **decode 0.861 tok/s warm** — storm gone (refaults 130× lower, 96 % resident), speed still not a product (§7.15) |
| GPU — **our** Adreno 740 | **not a decode lever on this chip**: MoE decode 0.41–0.44× the CPU, ~60 ms/token of dispatch glue. It *is* a prefill lever, **3.2–7×**, which is what §7.12's sliding window costs us. K-quant MoE never reaches the GPU here anyway — `use_adreno_moe_kernels` excludes A7X, and 730/740/**750** are all A7X. **Do not lift that gate**: on this silicon those kernels measure ERR 0.36–0.9 vs a 0.0005 threshold (§7.16) |
| GPU — **Adreno 750 and up** | **"da Adreno 750 la GPU fa volare tutto"** (owner, 2026-08-19). The row above is the floor of the range, measured on the one phone we own — it is **not** an argument about the phones Kalsa ships to. Unmeasured here: we have no 750-class device |
| Bigger models | a 35B MoE has run on this phone with a streaming engine, so file size is **not** the ceiling — the mmap regime is |

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

- **Where KEXP's 0.861 tok/s actually goes.** Not page cache (fixed, §7.15), not repack (see below),
  not thermal (0.3627 cold vs 0.3572 warm), not the KV cache (`n_common` 1411/1431, 98.6 % reused),
  not thread count (5). Prefill is *normal* at 17 tok/s while decode is 20× worse, and a **dense**
  4B with 4× more active parameters decodes at 5–8 tok/s on the same CPU — so per active parameter
  the MoE decode is ~25× less efficient. Remaining suspect: the batch-1 `MUL_MAT_ID` path. **Needs a
  profile, not another A/B.**
- ~~Whether KEXP at 3.10 GiB stays resident~~ — **yes**, ~96 %, §7.15. It did not buy speed.
- ~~What KEXP does with repack ON~~ — **void, and never worth a run.** The ARM repack backend
  implements `q8_0, q4_K, q6_K, q5_K, q4_0, mxfp4, iq4_nl`; **q3_K is absent entirely and q2_K has
  only avx512/riscv paths**. KEXP's experts are q2_k + q3_k, i.e. nearly the whole file, so on ARM
  they get no repack with the flag either way. Read in the shipped C++, not inferred.
- **GPU prefill on this device, and how CL buffers account against RAM.** Decode on GPU is answered
  and negative (§7.16), so the arm is re-aimed: prefill is the 3.2–7× lever and it lands on §7.12's
  sliding-window cost, and *nobody* knows how offload memory accounts on an S23 — everything in
  §7.11–§7.15 is mapped-file accounting. `NGL=99` in `lfm-setup.sh`, APK built, unrun.
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
