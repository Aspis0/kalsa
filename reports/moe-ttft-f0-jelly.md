# moe-ttft-f0-jelly

**Mandato:** TTFT-F0 — where do the "minutes before the first token" go, engine-side, on the worst phone.
**Device:** Unihertz Jelly Star · Helio G99 (2×A76 + 6×A55) · 8 GB · Termux ssh `u0_a225@192.168.1.82:8022`
**Model:** `Qwen3.5-2B-Q4_K_M.gguf` · 1 280 835 840 B · sha `aaf42c8b7c3cab2bf3d69c355048d4a0ee9973d48f16c731c0520ee914699223` MATCH
**Binary:** campaign `~/bin/bmoe-cli` sha `36b01966ba0f471d17f8fcb29ab49f64f760999c4256f612f959a7a0b178ce81` · `-t 2`
**Discipline:** UNPLUGGED · batt floor 35% · temp abort 45 °C · cold `posix_fadvise(DONTNEED)` via `~/bin/cold_model.sh` on every C1/C2 and before each C3/C4 process
**Config:** `--session --chatml --no-think --temp 0 -n 8 --ubatch 512` · 2 reps
**Artefacts:** `results/ttft_f0_jelly/`
**Finestra:** 2026-08-13 12:22:04 → 13:10:54 −0400 · STATUS **DONE**
**Battery / temp:** 69% @ 29.0 °C → 53% @ 36.0 °C · peak 37.0 °C (C4 r1 start) · never plugged · never hit 35% floor or 45 °C abort · MemAvailable 5.46–5.73 GiB (no RAM pressure)
**App-side companion:** `reports/kalsa-ttft-audit.md` @ `ai-chat` 82590ad

Parser note: the live `runs.csv` writer (`parse_done` heredoc+stdin, same class as `reports/moe-calaqwen-fix-session.md` PASSO 1) marked every cell `NO_BMOE_DONE`. The logs contain valid `BMOE_DONE`. Canonical numbers below are from `logs/*/stdout.txt`. Master log truncates during C4 r2 fadvise (line 100); C4 r2 is taken from `logs/C4_r2_c4096/` (wall 557 s, both `BMOE_DONE` present).

---

## Verdict (one line)

The minutes are **history re-prefill at ~13.8 tok/s on 2×A76**, not KV-alloc. C1 @ even `-c 262144` is **~5 s**. C2 is linear: 257 tok → 21 s, 974 → 73 s, 1980 → **147 s (2.5 min)**. C3 — the cell that was supposed to quantify the reuse win — **did not reuse**: T2 re-prefilled the full 2033-token prompt (155–180 s), `n_common = 0`, **0% saved**. C4 then paid the broken-prefix price on top of that wipe (T2 356–384 s / 4007 tok; cell wall **8.9–9.3 min**). App P0-1/P0-2/P0-3 still stand from C1+C2+the audit; the KV-reuse win is **UNVERIFIED** until C3 is fixed and re-run.

---

## Method

| | |
|--|--|
| Engine path | `bmoe-cli --session` JSONL (`cmd:generate` + `cmd:close`). Same fork session contract as `reports/moe-calaqwen-fix-session.md` / `BigMoeOnEdge/docs/session.md`. |
| TTFT (cold / T1) | `load_s + prefill_s` from `BMOE_DONE`. |
| TTFT (warm T2) | `prefill_s` of that turn — model already resident. |
| `n_common` | not logged; reconstructed as `n_past − n_prompt − n_gen` (same identity as `reports/moe-kv-reuse-fix.md` G-K1). Full match ⇒ `n_common = n_past_T1`. |
| Prefix reuse | chat mode only (`--chatml`). Caller sends the **new user message**; Session re-renders the full history and diffs against `kv_tokens` (`session.cpp:1167-1184`). `n_prompt` on `BMOE_DONE` is tokens actually prefilled. |
| C3 T2 | new ~53-token user message only, `clear_kv=false`, **same process** (no disk save/load). |
| C4 T2 | same session, `clear_kv=false`, but the new user message is the **mutated ~2048-token prefix** (8 bytes flipped at offset 48, `TS=99:99`) — the app anti-pattern of resubmitting a rewritten transcript. |
| ubatch | fixed 512 so C1 deltas are KV/context, not compute-graph width. |
| What this is not | not llama.rn, not the Kalsa process. Same model / same prefill physics. App uses n_ctx=16384 and quantized KV (q8_0/q4_0); we measure f16 KV. |

Prompt files and shas: `results/ttft_f0_jelly/prompts/SHA256SUMS.txt` (copied to `prompt_sha256.txt`). C2 slices are prefixes of each other. C3 prefix sha = C2@2048 sha `ec93a018…`.

---

## C1 — KV-alloc tax vs n_ctx

Cold each. Trivial prompt ("Reply with the single word: hello.") → n_prompt=20 after chat template. Decode stops at EOS (`hello`, 1 token).

| n_ctx | rep | load_s | prefill_s | TTFT | n_prompt | rc | KV MiB | compute MiB | wall_s | batt% | temp |
|------:|----:|-------:|----------:|-----:|---------:|---:|-------:|------------:|-------:|------:|-----:|
| 512 | 1 | 2.346 | 1.464 | **3.810** | 20 | 0 | 6.00 | 497.52 | 4 | 69 | 29 |
| 512 | 2 | 2.350 | 1.471 | **3.821** | 20 | 0 | 6.00 | 497.52 | 4 | 69 | 29 |
| 4096 | 1 | 2.365 | 1.468 | **3.833** | 20 | 0 | 48.00 | 497.02 | 4 | 69 | 29 |
| 4096 | 2 | 2.372 | 1.468 | **3.840** | 20 | 0 | 48.00 | 497.02 | 5 | 69 | 29 |
| 16384 | — | — | — | **~4 s proj.** | 20 | — | ~192 f16 / **78 app q8/q4** | ~497 | — | — | — |
| 32768 | 1 | 2.581 | 1.463 | **4.044** | 20 | 0 | 384.00 | 497.00 | 4 | 69 | 29 |
| 32768 | 2 | 2.536 | 1.472 | **4.008** | 20 | 0 | 384.00 | 497.00 | 4 | 68 | 29 |
| 65536 | 1 | 2.691 | 1.468 | **4.159** | 20 | 0 | 768.00 | 497.00 | 5 | 68 | 29 |
| 65536 | 2 | 2.688 | 1.469 | **4.157** | 20 | 0 | 768.00 | 497.00 | 5 | 68 | 29 |
| 131072 | 1 | 3.011 | 1.472 | **4.483** | 20 | 0 | 1536.00 | 497.00 | 5 | 68 | 29 |
| 131072 | 2 | 2.977 | 1.464 | **4.441** | 20 | 0 | 1536.00 | 497.00 | 6 | 68 | 29 |
| **262144** | 1 | **3.748** | 1.474 | **5.222** | 20 | **0** | **3072.00** | 497.00 | 6 | 68 | 29 |
| 262144 | 2 | 3.568 | 1.470 | **5.038** | 20 | 0 | 3072.00 | 497.00 | 6 | 68 | 29 |

**Readout:** **model-max `-c 262144` fits** (3.0 GiB f16 KV + 497 MiB compute + 1.18 GiB mmap + 19.27 MiB recurrent RS) and still returns a token in **~5 s**. Load 2.35 → 3.75 s across 512→262144 (+1.4 s to allocate 3 GiB). Prefill of 20 tokens is flat at **1.46–1.47 s**. Compute buffer is **~497 MiB** at ubatch 512 regardless of n_ctx. Recurrent state is **19.27 MiB fixed**. KV scales ≈ 12 KiB/token (f16, attn layers only; every 4th layer is full-attn, the rest SSM).

**KV-alloc is not the minutes. Not at 16k (app). Not at 256k (model max).** App 2B uses 16384 + quantized KV (~78 MiB, `ModelRegistry.ts:188,193-195`) — firmly in the 2.4 s load band.

Caveat: this is `--ubatch 512`. A naive app that left ubatch = n_ctx at 262144 would reserve a much larger compute graph; we did not measure that trap. The Kalsa app does **not** request 262144.

---

## C2 — history re-prefill curve (`-c 4096`, cold each)

Synthetic conversation prompts built from repo text (`d1_long.txt` + f45 + session.md + moe-g99-freetier.md). Actual `n_prompt` from `BMOE_DONE` is the x-axis, not the filename target.

| target | file sha | n_prompt | rep | load_s | prefill_s | TTFT | prefill_tps | rc | batt% | temp |
|--------|----------|---------:|----:|-------:|----------:|-----:|------------:|---:|------:|-----:|
| ~256 | `8330d65c…` | **257** | 1 | 2.372 | **18.544** | **20.916** | 13.86 | 0 | 67 | 29 |
| ~256 | | 257 | 2 | 2.388 | **18.519** | **20.907** | 13.88 | 0 | 67 | 29 |
| ~1024 | `4d47fc02…` | **974** | 1 | 2.369 | **70.352** | **72.721** | 13.84 | 0 | 67 | 29 |
| ~1024 | | 974 | 2 | 2.372 | **70.420** | **72.792** | 13.83 | 0 | 66 | 30 |
| ~2048 | `ec93a018…` | **1980** | 1 | 2.375 | **144.671** | **147.046** | 13.69 | 0 | 65 | 31 |
| ~2048 | | 1980 | 2 | 2.371 | **144.654** | **147.025** | 13.69 | 0 | 64 | 33 |
| ~4000 | `30cbce6e…` | **overflow** | 1 | 2.369 | — | — | — | 0 | 63 | 34 |
| ~4000 | | **overflow** | 2 | 2.376 | — | — | — | 0 | 62 | 34 |

### C2@4000 is not a missing cell

Both reps loaded the model (`BMOE_READY`, load_s 2.369 / 2.376) then refused the generate:

```
BMOE_ERROR {"id":1,"fatal":false,"msg":"prompt + n_predict exceeds the session n_ctx (4096); open the session with a larger n_ctx"}
```

That is the session.cpp guard (`n_prompt + n_predict + 8 > n_ctx`). The ~4000-token *source* plus the chatml wrapper plus `-n 8` does not fit in `-c 4096`. Wall 3 s, rc 0. The curve below 2048 is complete; the 4000 point is an n_ctx overflow, not a harness skip.

**Readout:** this **is** the minutes curve. Prefill is linear at **~13.8 tok/s** on 2×A76 (slight thermal droop 13.87 → 13.69 as temp 29→33 °C). Load stays **2.37 s**.

| n_prompt | TTFT | wall | prefill |
|---------:|-----:|-----:|--------:|
| 20 (C1) | 3.8 s | 4 s | 1.47 s |
| 257 | **21 s** | 22 s | 18.5 s |
| 974 | **73 s** | 75 s | 70.4 s |
| 1980 | **147 s (2.5 min)** | 149 s | 144.7 s |
| ~4000 | n_ctx overflow | 3 s | — |
| 10k (proj.) | **~12 min** | | 10k × 0.0725 |
| 16k app max (proj.) | **~19 min** | | 16k × 0.0725 |
| 20k (proj.) | **~24 min** | | 20k × 0.0725 |

Fit on the 6 completed C2 points (prefill vs n_prompt): **m ≈ 0.0725 s/tok** (1/13.8), F ≈ 0.0–0.4 s, visually R² ~1. A 10–16k-token sliding window (app audit D1, clamped by app n_ctx=16384) is **12–19 min** of re-prefill on this phone. The audit's 8–16 min assumed 20–40 t/s; the measured G99 2B slope is slower. Prior g99-freetier B1 (74 tok / 6.140 s = 12.1 t/s, ubatch 256) is the same physics, slightly slower ubatch.

---

## C3 — KV reuse win — **BROKEN, 0% saved**

T1 = C2@2048 prefix, n=8, `clear_kv=true`. T2 = one-line follow-up only (`c3_reuse.jsonl` line 2), `clear_kv=false`. Same process. `--session --chatml --no-think` on the cmdline. No `--session-file`; this is in-process reuse, not disk save/load.

T2 prompt text (the entire user message the harness sent):

> Follow-up only: in two short sentences, name the last concrete detail you were given and say whether the night train is still the working example. Do not repeat the transcript.

| rep | phase | n_prompt | n_past | n_gen | n_common | load_s | prefill_s | prefill_tps | TTFT | batt% | temp |
|----:|-------|---------:|-------:|------:|---------:|-------:|----------:|------------:|-----:|------:|-----:|
| 1 | t1 | 1980 | 1988 | 8 | 0 (cold) | 2.372 | 144.745 | 13.68 | **147.117** | 62 | 34 |
| 1 | t2 | **2033** | 2041 | 8 | **0** | 2.372 | **155.210** | 13.10 | **155.210** | 62 | 34 |
| 2 | t1 | 1980 | 1988 | 8 | 0 (cold) | 2.440 | 156.967 | 12.61 | **159.407** | 60 | 36 |
| 2 | t2 | **2033** | 2041 | 8 | **0** | 2.440 | **180.341** | 11.27 | **180.341** | 60 | 36 |

`n_common = n_past − n_prompt − n_gen` = 2041 − 2033 − 8 = **0** on both reps.
`prefill_s × prefill_tps` = 155.210 × 13.10 = 2033.3 and 180.341 × 11.27 = 2032.4 — T2 **actually evaluated 2033 tokens**.

| | C2@2048 prefill (cold, 1980 tok) | C3 T2 observed | C3 T2 if reuse engaged |
|--|--:|--:|--:|
| tokens prefilled | 1980 | **2033** | **~53** (new user + gen-prompt) |
| prefill_s | 144.7 | **155 / 180** | **~4–5 s** |
| % saved vs C2@2048 prefill | — | **−7% / −25%** (worse; +53 tok + thermal) | **~97% (UNVERIFIED)** |

T2 decoded `Il dettaglio concreto più recente è l'` — the model saw the T1 material (it is in the re-rendered 2033-token prompt). History assembly worked. KV reuse did not.

### Why reuse did not engage (from the logs, no re-run)

Hypotheses, and which ones the artefacts support:

| # | hypothesis | verdict | evidence |
|---|------------|---------|----------|
| H1 | `--session` flags missing / wrong | **REFUTED** | `logs/C3_r1_c4096/cmdline.txt` is `bmoe-cli -m … --session --chatml --no-think -t 2 -c 4096 --ubatch 512 --temp 0 -n 8`. Same flag set as G-K1 (`reports/moe-kv-reuse-fix.md`). |
| H2 | session load skipped (disk `.kvs` not restored) | **REFUTED** | harness never uses a session file. C3 is one process, two `generate` in one JSONL, then `close` (`c3_reuse.jsonl`). There is nothing to skip. |
| H3 | harness T2 was not the byte-identical prefix (sent a different transcript) | **REFUTED as a harness bug** | T2 JSONL prompt is the 1-line follow-up, `clear_kv:false`. That is the chat-mode contract: send the *new* user message, let Session re-render. |
| H4 | Session did not keep T1 history | **REFUTED** | T2 `n_prompt=2033` = 1980 (T1 user+template) + 53 (follow-up+gen-prompt), not ~53 in isolation. Re-render included T1. T2's answer refers to the T1 content. |
| H5 | re-render of T1+T2 was not byte-identical to `kv_tokens`, so `n_common < \|kv_tokens\|`, `llama_memory_seq_rm` of the tail **refused** on this hybrid attn+SSM, and `session.cpp:1177-1183` cleared the cache and set `n_common=0` | **SUPPORTED** | (a) `n_common=0` and 2033 tokens evaluated. (b) stderr: `arch=qwen35`, `ssm.*`, `full_attention_interval=4`, `CPU RS buffer size = 19.27 MiB` — hybrid recurrent, not a pure KV cache. (c) `moe-kv-reuse-fix.md` §5: `llama_memory_seq_rm` at an intermediate position can refuse on this memory; fallback is a full wipe. (d) T2 prompt size 2033 vs T1 `n_past=1988` means the re-render is *not* `kv_tokens ‖ new_suffix` (that would be 1988+53=2041 before the new gen). The 8-token T1 assistant answer is the likely mismatch boundary: any 1-token diverge there invokes `seq_rm` of the tail, which this model can refuse. (e) Jelly pin `36b01966…` is **not** the KVFIX binary `ede3ac7c…` that passed G-K1 after `preserve_thinking=true` + empty-think history commit. These logs do not print pre-fallback `n_common`, so we cannot split "empty-think diverge at the assistant header" from "any other 1-token diverge" — both collapse to the same wipe. |

**What this is not:** a harness that forgot `--session`, skipped a load, or re-submitted a mutated T1 prefix on T2. Those three are ruled out by cmdline + JSONL + the 2033-token re-render. The engine-side session reuse contract (byte-identical prefix → prefill only the suffix; `reports/moe-calaqwen-fix-session.md`, `session.cpp:1167-1184`) **did not deliver on this run**.

**Required follow-up cell:** C3 re-run, same prompts / same `-c 4096` / same `--session --chatml --no-think`, after the engine path actually yields `n_common = n_past_T1` (expect T2 `n_prompt ≈ 53`, `prefill_s ≈ 4–5 s`). Until that cell exists, do not cite a reuse %. Optionally log `n_common` before the `seq_rm` fallback so the next failure is not another black box.

---

## C4 — broken-template / mutated prefix (the KV-killer)

Same T1 as C3. T2 sends the 2048-token prefix with 8 early bytes flipped (`chatTS=99:99one` at offset 48, sha `d7fe717e…`) as the **new user message**.

| rep | phase | n_prompt | n_past | n_common | prefill_s | prefill_tps | TTFT | wall (cell) | batt% | temp |
|----:|-------|---------:|-------:|---------:|----------:|------------:|-----:|------------:|------:|-----:|
| 1 | t1 | 1980 | 1988 | 0 | 173.312 | 11.42 | **175.687** | | 57 | 37 |
| 1 | t2 | **4007** | 4015 | **0** | **356.055** | 11.25 | **356.055** | **535** | 57 | 37 |
| 2 | t1 | 1980 | 1988 | 0 | 167.068 | 11.85 | **169.440** | | 53 | 36 |
| 2 | t2 | **4007** | 4015 | **0** | **383.780** | 10.44 | **383.780** | **557** | 53 | 36 |

`prefill_s × prefill_tps` ≈ 4007 on both T2s. Full re-prefill of T1 user + T1 assistant + mutated user2. Cell wall **8.9–9.3 min**. Thermal droop is visible (11.4 → 10.4 t/s, 37 °C).

**Readout:** C4 did what the anti-pattern is supposed to do — a rewritten transcript is expensive. Two layers, do not mix them:

1. **App anti-pattern (intended C4 signal):** T2's *new* user message is itself ~2k tokens of mutated history. Even with working reuse of T1 (`n_common=1988`), T2 would still prefill ~2000 new tokens ≈ **2.5–3 min** at 11 t/s. That is the cost of D1/D2 (sliding window / facts injected early).
2. **C3 engine failure, also present here:** `n_common=0`, so T1's 1988 tokens were thrown away too. Observed T2 is 4007 tok / 6.0–6.4 min, not the ~2000-tok / 2.5–3 min a working Session would have charged. C4 therefore **overstates** the anti-pattern by one full T1 prefill until C3 is fixed.

Hybrid note (same as `reports/moe-kv-reuse-fix.md` §5): this 2B is attn+SSM (`n_swa=0`, recurrent RS 19.27 MiB). A mid-prefix `seq_rm` can refuse and fall back to `n_common=0`. C4 as implemented does not *need* a mid-prefix `seq_rm` for the mutation (T1 still matches; the mutated text is a new user turn) — but the same wipe as C3 fires first, so we never observe the "reuse T1, prefill only the mutated user2" path.

---

## Waterfall — where the minutes go

| bucket | what | C1@512 | C1@app 16k (proj.) | C2@2048 | C3 T2 observed | C3 T2 if reuse | C4 T2 observed |
|--------|------|-------:|-------------------:|--------:|---------------:|---------------:|---------------:|
| Model load (mmap 1.18 GiB, cold) | `load_s` | 2.35 s | ~2.5 s | 2.37 s | 0 (warm) | 0 | 0 (warm) |
| KV + compute reserve | part of `load_s` | KV 6 + compute 498 MiB | KV ~192 f16 / **78 app** | KV 48 | already held | held | held |
| Prefill | `prefill_s` | 1.47 s (20 tok) | 20 tok still ~1.5 s | **145 s (1980 tok)** | **155–180 s (2033 tok, n_common=0)** | **~4–5 s UNVERIFIED** | **356–384 s (4007 tok, n_common=0)** |
| Decode to first token | first step ~140–170 ms | <0.2 s | <0.2 s | <0.2 s | <0.2 s | <0.2 s | <0.2 s |
| **User-visible TTFT** | | **3.8 s** | **~4 s** | **147 s** | **155–180 s** | **~4–5 s** | **6.0–6.4 min** (cell 8.9–9.3 min) |

The minutes are the **C2/C3/C4 prefill column**. C1 is a few seconds even at model-max n_ctx.

---

## Projected fix impact (honest)

App P0s from `reports/kalsa-ttft-audit.md` Q6(a). Engine evidence from this run.

| fix | engine evidence | app lever | impact on G99 2B, this run |
|-----|-----------------|-----------|----------------------------|
| **P0-3** Do not dispose on background; evict on memory pressure | C1 `load_s` = 2.3–3.7 s | `AppShell.tsx:2030-2140` (dispose 2123-2132); foreground no auto-load `AppShell.tsx:2144-2190` | **Stands.** Removes 2–4 s of `initLlama` from every post-background send. Not the minutes by itself. Combined with P0-2, takes load off the critical path entirely. |
| **P0-2** Eager engine init at app start (model already downloaded) | C1 `load_s` 2.3–3.7 s is paid on first send today | lazy load `AppShell.tsx:3534`; boot is download-check only `AppShell.tsx:2290-2310` | **Stands.** Moves C1 off message-1. Does not touch C2. |
| **P0-1** Compaction ON by default | C2 slope **0.0725 s/tok** · 10–16k window = **12–19 min** | `compactor.ts:114`, read `AppShell.tsx:3562-3567`; window `compactor.ts:128,421-432` | **Stands.** This is the minutes lever. Caps the re-prefill when reuse misses (and reuse *did* miss on this engine). Zero dependence on C3. |
| Byte-stable prefix + session reuse | C3 **failed**: 0% saved, n_common=0 | llama.rn prefix match `rn-completion.cpp:429,455`; no `clearCache` on chat turns `LlamaService.ts:2185-2190`; hybrid restore patch `patches/llama.rn+0.12.8.patch` | **UNVERIFIED.** If C3 had worked, T2 would be ~4–5 s vs 147 s (**~97%**). That number is a projection from the C2 slope × ~53 new tokens, not a measurement. Do not ship "KV reuse saves minutes" from this run. **Follow-up = C3 re-run.** |
| Do **not** resubmit a mutated full transcript | C4 T2 = 4007 tok / 6+ min (inflated by C3 wipe). Fair anti-pattern cost ≈ 2000 new tok / **2.5–3 min** | D1 window slide `compactor.ts:421-432`; D2 facts in system prompt `LlamaService.ts:258-268` + `clearCache` `LlamaService.ts:2222-2226`; D3 tools `kvReproducibility.ts:38-53` | **Stands as a warning, magnitude pending C3.** The anti-pattern is real; the 8.9 min cell wall is T1+T2 and includes the engine wipe. |

P0-1/P0-2/P0-3 do **not** wait on the C3 re-run. They are justified by C1 (load is small but on the critical path) and C2 (prefill *is* the minutes). The reuse win is extra, and today it is a contract the engine did not keep.

---

## Mapping — measured cost ↔ app audit

Source: `reports/kalsa-ttft-audit.md` @ `ai-chat` 82590ad.

| Engine cell | App finding | file:line | How the number lands in the app |
|-------------|-------------|-----------|----------------------------------|
| **C1 load_s 2.3–3.7 s** | Engine disposed on every background; never preloaded; `initLlama` on first send | `AppShell.tsx:2030-2140` (dispose 2123-2132); lazy load `AppShell.tsx:3534`; boot is download-check only `AppShell.tsx:2290-2310` | Every post-background send pays C1 `load_s` + KV/compute reserve **on the critical path**. 2B catalog n_ctx is **16384 always** (`ModelRegistry.ts:188`), KV quantized q8_0/q4_0 ≈ **78 MiB** (`ModelRegistry.ts:193-195`) — **not** 262144. The 262k trap is **absent**. C1@16384 (f16 ~192 MiB) is the closest engine analogue; app alloc is smaller. |
| **C1 n_ctx sweep, 262144 fits in 5 s** | `n_ctx` from catalog + RAM clamp, floor 2048; no user control | `LlamaService.ts:717-737`; `contextProfile.ts:112-139`; clamp `deviceTuning.ts:470-577` | Q1 confirmed: alloc is not the minutes. 262144 is a **don't do this** bound the app already does not hit, and even that bound is ~5 s on this phone, not minutes. |
| **C2 curve, 0.0725 s/tok** | Full conversation re-rendered every turn; sliding window of last 20 messages, compaction **OFF** | `assembleEngineHistory` `AppShell.tsx:3745-3767`; `compactor.ts:128, 421-432`; `LlamaService.ts:1603, 1814-1863` | C2 **is** the per-send prefill the user waits through when reuse misses. At the 21st message the window slides → prefix breaks after the system prompt → full re-prefill of the window (D1). Measured G99 slope makes a 10–16k window **12–19 min**, not the audit's 8–16 min (that used 20–40 t/s). |
| **C3 reuse 0% (broken)** | llama.rn prefix match; chat turns never `clearCache`; hybrid restore needs the state-checkpoint patch | `rn-completion.cpp:429,455,469-497`; `LlamaService.ts:2185-2190`; patch `patches/llama.rn+0.12.8.patch` | C3 is the win the app **already designed for**, when the re-render is byte-identical. This run did not deliver it **on the campaign `bmoe-cli` session path**. The app's llama.rn path is a different binary + the hybrid checkpoint patch; it is **not** validated by this cell. Treat engine reuse as unverified on both paths until C3 (this binary) and a matching llama.rn cell exist. |
| **C4 mutated prefix** | Memory facts injected into the **system prompt**; `extractMemory` calls `clearCache`; tool/miniapp/think turns diverge; window slide | D2 `LlamaService.ts:258-268`, `clearCache` `LlamaService.ts:2222-2226`; D3 `kvReproducibility.ts:38-53`; D4 `AiChatPage.tsx:2253` | C4 is D1/D2/D3 made numeric: flip early bytes (system-prompt / dropped-oldest-message class) and TTFT returns to a multi-minute prefill. Audit: no timestamps in the prompt — the silent killers are facts, tools, window slide, not a clock. Observed 6+ min includes the C3 wipe; fair isolated cost is ~2.5–3 min of *new* mutated tokens. |
| **Load UX** | Bubble says "Writing" through init+restore+prefill; no split | `AiChatPage.tsx:1873`; `i18n/en.ts:97,415`; `onStatus` only after init `LlamaService.ts:1701-1704` | User-reported "minutes to first token" = C1 `load_s` + C2 `prefill_s` + optional restore I/O, with no progress. On this phone that is **~4 s + 0.0725 s × history_tokens**. |

---

## C5 — GGML_CPU_REPACK on A76 (no build)

Fold-in from `scratchpad/agents/ttft-f0-c5-repack/report.md`. Read-only; no on-device A/B.

**Relevant — not i8mm-only.** Dispatch in `llama.cpp/ggml/src/ggml-cpu/repack.cpp:4601-4613`:

- NEON + `matmul_int8` (i8mm) → `q4_K_8x8_q8_K` (the S23 pp×2 / tg−33% layout, `reports/moe-cpu-build-gap.md`)
- NEON + **dotprod only** → `q4_K_8x4_q8_K` (`repack.cpp:4610-4613`; GEMV `arch/arm/repack.cpp:576` under `__ARM_FEATURE_DOTPROD`)

A G99 A76 build `armv8.2-a+dotprod+fp16` (no i8mm) — which is how this Jelly `bmoe-cli` is labelled — takes the **8×4** branch for every Q4_K tensor with `ne[1]%8==0` when `GGML_CPU_REPACK=ON` (upstream default, `ggml/CMakeLists.txt:152`). The feature checks are compile-time macros (`ggml_cpu_has_dotprod` / `ggml_cpu_has_matmul_int8` in `ggml-cpu.c:3754-3776`): a no-i8mm build cannot take the 8×8 branch, and an i8mm-in-`-march` build would both select 8×8 *and* compile `smmla` that illegal-instructions on A76. The working A76 override is `ARM_ARCH=armv8.2-a+dotprod+fp16` (`scripts/build_llama_termux.sh:25`).

The S23 pp×2 number must **not** be copied: that was the i8mm 8×8 kernel. Sign of 8×4 on A76 is unmeasured. Do not treat REPACK as a free TTFT knob on this phone without an ON/OFF A/B at the same `-march`.

---

## Artefacts

| path | what |
|------|------|
| `results/ttft_f0_jelly/prompts/` | fixed prompts + JSONL + `SHA256SUMS.txt` |
| `results/ttft_f0_jelly/logs/*/` | cmdline, in.jsonl, stdout, stderr, combo, rc, wall — **source of truth** |
| `results/ttft_f0_jelly/runs.csv` | live writer (parser bug: every row `NO_BMOE_DONE`); battery/temp/wall still valid |
| `results/ttft_f0_jelly/reparse_logs.py` | rebuilds timing columns from `BMOE_DONE` (drops batt/temp) |
| `results/ttft_f0_jelly/TTFT.master.log` | battery / preflight / cell boundaries; **truncated during C4 r2 fadvise** |
| `results/ttft_f0_jelly/bin.sha256` | `36b01966ba0f471d17f8fcb29ab49f64f760999c4256f612f959a7a0b178ce81` |
| `results/ttft_f0_jelly/model.sha256` | `aaf42c8b7c3cab2bf3d69c355048d4a0ee9973d48f16c731c0520ee914699223` |
| `results/ttft_f0_jelly/prompt_sha256.txt` | copy of `prompts/SHA256SUMS.txt` |
| `results/ttft_f0_jelly/run_ttft_f0_jelly.sh` | harness as executed |

**Not touched:** S23, Xiaomi, any phone, PC heavy compute.

---

## Checklist

| item | stato |
|------|--------|
| C1 512 / 4096 / 32768 / 65536 / 131072 / 262144 × 2 | ✅ all rc=0, including model-max |
| C2 256 / 1024 / 2048 × 2 | ✅ linear 13.8 t/s |
| C2 4000 × 2 | ✅ executed; n_ctx overflow (not missing) |
| C3 reuse % | ✅ measured **0%** — engine reuse did not engage; re-run required |
| C4 collapse | ✅ full re-prefill (4007 tok / 6+ min T2); inflated by C3 wipe |
| C5 paragraph | ✅ fold-in, no build |
| App mapping | ✅ vs `kalsa-ttft-audit.md` |
| UNPLUGGED only | ✅ 69%→53%, 29→37 °C |
| Follow-up | **C3 re-run** once session reuse yields `n_common = n_past_T1` |

DONE

---

## Addendum — C3 re-run with KVFIX binary (2026-08-13)

**Verdict: FAIL.** T2 `n_common = 0` again. Session KV reuse did **not** engage on a fresh A76 rebuild of the exact KVFIX commit. The ~97% reuse win stays a projection. H5 is deeper than "the campaign binary is not KVFIX".

### Binary

| | |
|--|--|
| Installed as | `~/bin/bmoe-cli-kvfix` (campaign `~/bin/bmoe-cli` **not** overwritten) |
| ELF sha256 | `581e9773aa6ef9728b6e71166e455b863078129144801731b7f6ba390330a716` |
| Source commit | `2c675a52abecce529b6a595b617717bbf2fdb282` — `fix(session): keep empty-think prefix byte-identical for multi-turn KV reuse` |
| llama.cpp submodule | `e5605f3bd3545867b2eb2581c96fd7042e243541` |
| Arch | NDK r27.1 · API 29 · `GGML_CPU_ARM_ARCH=armv8.2-a+dotprod+fp16` · HAVE_DOTPROD=ON · **HAVE_MATMUL_INT8=OFF** (no i8mm, A76-safe) |
| `ede3ac7c…` | S23 G-K1 binary, **not** reused (would SIGILL on A76) |
| Campaign pin after run | `36b01966…` still at `~/bin/bmoe-cli` |
| Model | `aaf42c8b…699223` MATCH |
| Prompt | `c3_reuse.jsonl` sha `1bccdaae…` MATCH (byte-identical to original C3) |

Main already contains KVFIX (`2c675a5` is an ancestor of `8958cdf`; `session.cpp` is identical between those two commits). A fresh A76 build of `2c675a5` is the cleanest KVFIX-equivalent.

**Source-level note on H5(e):** the on-device tree that produced campaign `36b01966…` (session.cpp dated 2026-08-09, binary 2026-08-10, `build-jelly` `ARM_ARCH=armv8.2-a+dotprod+fp16`) **already had both KVFIX hunks** (`preserve_thinking=true` at line 910; empty-think history commit at 1549). So this re-run is not "KVFIX vs a pre-fix A76 binary". It is KVFIX-on-A76 vs the same contract, isolated from the S23 `ede3ac7c` hash.

### C3 table (canonical from `logs/*/stdout.txt` `BMOE_DONE`)

Same flags: `--session --chatml --no-think -t 2 -c 4096 --ubatch 512 --temp 0 -n 8`. One process, two generates, `clear_kv` true then false. Cold `posix_fadvise` before each process. UNPLUGGED.

`n_common = n_past − n_prompt − n_gen`.

| rep | phase | n_prompt | n_past | n_gen | n_common | load_s | prefill_s | prefill_tps | TTFT | batt% | temp |
|----:|-------|---------:|-------:|------:|---------:|-------:|----------:|------------:|-----:|------:|-----:|
| 1 | t1 | 1980 | 1988 | 8 | 0 (cold) | 2.377 | 159.313 | 12.43 | **161.690** | 39 | 27 |
| 1 | t2 | **2033** | 2041 | 8 | **0** | 2.377 | **163.834** | 12.41 | **163.834** | 39 | 27 |
| 2 | t1 | 1980 | 1988 | 8 | 0 (cold) | 2.379 | 159.324 | 12.43 | **161.703** | 37 | 31 |
| 2 | t2 | **2033** | 2041 | 8 | **0** | 2.379 | **163.875** | 12.41 | **163.875** | 37 | 31 |

T2 `prefill_s × prefill_tps` = 163.834 × 12.41 = 2033.2 and 163.875 × 12.41 = 2033.7 — T2 **actually evaluated 2033 tokens**. Wall 328 / 329 s, rc=0 both. Battery 39% @ 27.0 °C → 34% @ 34.0 °C. r2 **started** at 37% (above the 35% floor); ended at 34% after the last timed rep. Never plugged. Live `runs.csv` writer hit the same `NO_BMOE_DONE` heredoc bug as the original F0 run; numbers above are from stdout.

stderr (full capture in `logs/C3_r{1,2}_c4096/stderr.txt`): **no** `seq_rm` / wipe / `n_common` messages. Only load metadata. Hybrid signature unchanged: `arch=qwen35`, `ssm.*`, `full_attention_interval=4`, `CPU RS buffer size = 19.27 MiB`. The engine still does not log the pre-fallback `n_common`.

T2 decoded `Il dettaglio concreto più recente è l'` — same class as original C3: history assembly worked, KV reuse did not.

### Gate

| | required | measured |
|--|--|--|
| T2 `n_common` | ≈ 1988 (`n_past_T1`) | **0** |
| T2 `n_prompt` | ≈ 53 | **2033** |
| T2 `prefill_s` | ≈ 3–8 s | **163.8 s** |
| | | **FAIL** |

### Corrected "projected fix impact" line

| | C2@2048 prefill (cold, 1980 tok) | C3 T2 original (`36b01966`) | C3 T2 KVFIX A76 (`581e9773`, this cell) | C3 T2 if reuse engaged |
|--|--:|--:|--:|--:|
| tokens prefilled | 1980 | 2033 | **2033** | ~53 |
| prefill_s | 144.7 | 155 / 180 | **163.8 / 163.9** | ~4–5 s |
| % saved vs C2@2048 | — | −7% / −25% | **−13%** | ~97% (still a projection) |

**The ~97% reuse win is still not a measurement.** Putting the KVFIX source on A76 did not change the wipe. Cite **0% saved**, not 97%.

H5 after this cell: the empty-think / `preserve_thinking` fix that passed G-K1 (short prompt, S23, `n_prompt` t1=39 / t2=41) is **not sufficient** for this 1980-token hybrid `qwen35` chat turn. The 8-token T1 assistant answer remains the likely mismatch boundary (T2 re-render 2033 vs `kv_tokens ‖ new_suffix` = 1988+53=2041). Mid-prefix `seq_rm` on attn+SSM still the supported mechanism; the missing-binary hypothesis is **refuted**.

Artefacts: `results/ttft_f0_jelly/C3_kvfix/`.

DONE
