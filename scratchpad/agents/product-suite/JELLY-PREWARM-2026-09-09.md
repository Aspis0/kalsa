# Jelly prewarm measurement — 2026-09-09

- Device: USB `JELLYS0000053795` only; app kept awake; no S23/Xiaomi access.
- `kalsa.bench.devmodels=1` verified. Model preference restored to `lfm2.5-2.6b`; app force-stopped at end. Battery gate was <=38°C at each launch; thermal status was 0 at launch. During MiniCPM5, skin reached ~47°C / status 3.
- Full unfiltered logs are under `JELLY-PREWARM-2026-09-09/{minicpm5,lfm}/`; `prewarm-native-all.txt` contains every llama/RNLlama/ggml-tagged line between that model's prewarm start and terminal line.

## MiniCPM5 (`dev-minicpm5-2b`)

- Prewarm wall: `12:45:13.115` → `12:48:56.614` = **223.499 s**. Result: `skip/eval-failed`, `promptMs=0`, `promptN=1`, `tokensEvaluated=2112`.
- Evidence: `12:45:13.115 ... KALSA_PREWARM ... op=start`; `12:48:56.614 ... op=skip ... promptN=1 ... tokensEvaluated=2112`.
- Native/batch: `12:45:12.622 ... llama_context: n_batch = 512`; `... n_ubatch = 256`; `12:45:12.943 ... ggml threadpool (n_threads=2, n_threads_batch=8)`; `12:45:13.165 ... KALSA_KVPREFIX embd=0 text_tokens=2112 n_common=0`.
- Repack: `12:45:06.981 ... output.weight with q6_K_8x4`; `12:45:12.574 ... blk.41.ffn_up.weight with q4_K_8x4`; variant `rnllama_jni_v8_2_dotprod`. No `llama_perf`, `prompt eval time`, `KleidiAI`, `q4_K_8x8`, `Q4_0_4_8`, or `KALSA_GOVERNOR` line.
- Warm turn reply: “Ciao! Sono un assistente AI privato che lavora sul dispositivo, senza nessuna interazione con il web o account esterni. Se hai altri domande o bisogni, sono qui per aiutarti.”
- Turn telemetry: `tokensCached=3235`, `tokensEvaluated=3117`, `promptMs=289058.421`, `predictedMs=60702.475`, `predictedPerSecond=1.927`; reply poll completed at 610 s after submission (telemetry at `13:02:20.090`). Native turn prefix: `embd=2112 text_tokens=3117 n_common=2109`.

## LFM (`lfm2.5-2.6b`)

- Prewarm wall: `13:04:27.185` → `13:06:22.674` = **115.489 s**. Result: `done`, `promptMs=114669.581`.
- Evidence: `13:04:27.185 ... KALSA_PREWARM ... op=start`; `13:06:22.674 ... op=done ... promptMs=114669.581`.
- Native/batch: `13:04:26.462 ... llama_context: n_batch = 512`; `... n_ubatch = 256`; `13:04:26.942 ... ggml threadpool (n_threads=2, n_threads_batch=8)`; `13:04:27.205 ... KALSA_KVPREFIX embd=0 text_tokens=1832 n_common=0`.
- Repack: `13:04:22.080 ... token_embd.weight with q6_K_8x4`; `13:04:26.434 ... blk.29.shortconv.out_proj.weight with q4_0_4x4`; variant `rnllama_jni_v8_2_dotprod`. No `llama_perf`, `prompt eval time`, `KleidiAI`, `q4_K_8x8`, `Q4_0_4_8`, or `KALSA_GOVERNOR` line.
- Warm turn reply: “Ciao! Sono un assistente AI privato, senza accesso al cloud o a contatti esterni. Sono pronto ad aiutarti con qualsiasi domanda che hai. Posso rispondere in italiano, inglese o in altri linguaggi. C'è qualcosa su cui posso assisterti oggi?” (verbatim saved in `lfm/turn/reply.txt`).
- Turn telemetry: `tokensCached=3089`, `tokensEvaluated=2956`, `promptMs=135263.860`, `predictedMs=42466.912`, `predictedPerSecond=3.108`; reply poll completed at 300 s after submission (telemetry at `13:13:17.290`). Native turn prefix: `embd=1832 text_tokens=2956 n_common=1829`, reusing `1827/2956`.

## Conclusion

The S23-style single-token perf-counter signature is reproduced on the Jelly for **MiniCPM5 only**: its terminal prewarm explicitly reports `promptN=1` while evaluating 2112 tokens and ends `eval-failed`. LFM reports a successful `done` with prompt timing, but this log has no `promptN` or native `llama_perf`/batch-consumption line; `n_batch=512` and `n_ubatch=256` are configuration values, not proof of the actual ingest batch. Therefore the capture directly demonstrates single-token ingest for MiniCPM5, not for LFM; the native logger does not expose enough evidence to claim N single-token evals for LFM.

## Parent verification and root cause (orchestrator, 2026-09-09 ~14:00 EDT)

The "single-token ingest" reading is **REFUTED**. The signature `promptN=1, promptMs=0` is a perf-accounting artefact, not a batching defect, and the KV was fully computed (the warm turn reused the prefix: `n_common=2109`).

Chain, all quoted from `kalsa/node_modules/llama.rn/cpp` at fork pin 67c73d26c:

1. `llama_context::decode()` never synchronises (`llama-context.cpp:2020-2021`, `//synchronize();` commented out); queued tokens are folded into `n_p_eval/t_p_eval_us` only inside `synchronize()` (`llama-context.cpp:664-682`).
2. `perf_get_data()` is `const` and does not sync (`llama-context.cpp:3150`); `data.n_p_eval = std::max(1, n_p_eval)` is where the `1` comes from (`:3157`). llama.rn reads it as-is in `jsi/JSICompletion.h:205`.
3. With `n_predict: 0` the completion returns before any `llama_get_logits*` (`rn-completion.cpp:1203-1208`), so nothing syncs.
4. LFM2.5 (hybrid) syncs by accident: the prompt state-checkpoint capture calls `llama_state_seq_get_data_ext`, which does `ctx->synchronize()` (`llama-context.cpp:~3976`). Dense models have `state_cache_enabled=false` (`rn-completion.cpp:146-152`), so MiniCPM5 never syncs → `prompt_n=0→1`, `prompt_ms=0`. That is also why LFM's `promptMs=114669` ≈ its wall time.
5. App side: `evalFailed = nativeError || tokensEvaluated <= 0 || promptMs <= 0` (`src/engine/LlamaService.ts:811-812`) marks the prewarm failed, `prewarmPrefixHash` stays null, and the next trigger re-runs the whole multi-minute prefill.

So the numbers to keep are wall times: MiniCPM5 2112 tok / 223.5 s (9.4 tok/s), LFM 1832 tok / 115.5 s (15.9 tok/s) on the Jelly, skin 47 °C during MiniCPM5. Whether the 1.7× gap (S23: ~3×) is the Q4_K repack path (`q4_K_8x4`, no i8mm on MT6789) is a separate question for the G1 device sweep.

Fix in flight: app criterion no longer depends on `prompt_ms` (Paseo agent 53f7ade9). Follow-up in the fork: `llama_synchronize` before `llama_perf_context` in `JSICompletion.h` so `n_predict=0` timings are real.

## Re-measure on e168b4a

MiniCPM5 (`dev-minicpm5-2b`) on USB `JELLYS0000053795`; `kalsa.bench.devmodels=1`; battery 29°C at cold launch and 32°C before the turn. Full unfiltered captures and raw RKStorage reply are under `JELLY-PREWARM-2026-09-09/fix-e168b4a/`.
- Cold prewarm wall: `14:24:10.063` → `14:26:06.523` = **116.460 s**. Quoted lines: `09-09 14:24:10.063 ... 'KALSA_PREWARM', '{"op":"start","hash":"3586270056","systemChars":3969,"toolCount":5}'`; `09-09 14:26:06.523 ... 'KALSA_PREWARM', '{"op":"done","promptMs":0,"promptN":1,"hash":"3586270056"}'`. No `tokensCached`/`tokensEvaluated` fields were emitted.
- Native evidence: `09-09 14:24:08.836 ... llama_context: n_batch = 512`; same timestamp `n_ubatch = 256`; `09-09 14:24:09.842 ... Attached ggml threadpool (n_threads=2, n_threads_batch=8)`; `09-09 14:24:09.982 ... KALSA_NATIVE_VARIANT {"androidLib":"rnllama_jni_v8_2_dotprod","nGpuLayers":0}`; `09-09 14:24:10.093 ... KALSA_KVPREFIX embd=0 text_tokens=2112 n_common=0`.
- After `done`, HOME → foreground → `Nuova chat` tap (`new-chat-tap.txt`, `436 171`) produced no additional `KALSA_PREWARM` line in `cold-transition-logcat-threadtime-full.txt`.
- For completeness, the first share-helper attempt was run under the wrong shell and delivered the URI but not the text; its recovery capture records the only later start/done pair: `09-09 14:29:37.083 ... 'KALSA_PREWARM', '{"op":"start","hash":"3586270056","systemChars":3969,"toolCount":5}'`; `09-09 14:32:03.241 ... 'KALSA_PREWARM', '{"op":"done","promptMs":0,"promptN":1,"hash":"3586270056"}'`.
- Corrected Bash warm turn reply (verbatim in `turn-retry/reply-verbatim.txt`): “Ciao! Sono un assistente AI privato di Kasa, pensato per essere sempre a tu disposizione su questo dispositivo. Non ho accesso a internet, account o tracciamento — resto puramente sul tuo dispositivo. Se hai bisogno di aiuto, puoi chiedermi qualsiasi cosa!”
- Corrected-turn prewarm lines: `09-09 14:33:21.796 ... 'KALSA_PREWARM', '{"op":"skip","reason":"kv_holds_chat"}'`; `09-09 14:33:21.810 ... 'KALSA_PREWARM', '{"match":false,"reason":"kv_holds_chat","prewarm":null,"send":"3586270056"}'`.
- Warm native/telemetry: `09-09 14:33:21.859 ... KALSA_KVPREFIX embd=2263 text_tokens=2281 n_common=2263`; `09-09 14:33:47.852 ... KALSA_TELEMETRY {"turnId":"2","round":0,"tokensCached":2388,"tokensEvaluated":2281,"tokensPredicted":106,"draftTokens":0,"draftAccepted":0,"promptMs":2459.841,"predictedMs":23309.704,"predictedPerSecond":4.547462292957474,"contextFull":false,"interrupted":false,"ciswireFlags":4}`. No native `llama_perf`/prompt-eval timing line was emitted.

Verdict: PASS — e168b4a correctly reports MiniCPM5 prewarm `done` despite diagnostic `promptMs=0/promptN=1`, the prescribed foreground/new-chat transition caused no second start, and warm-turn `n_common=2263` proves KV reuse; the later share-induced restart was a separate harness attempt and is fully recorded above.

### Parent note on the 14:29:37 second start (orchestrator)

Same PID 4246, so no app restart: at `14:29:36.7` the engine was re-created in-process (`sched_reserve`, `attach_threadpool`, `KALSA_SESSION load … no_file`), which is what the harness's wrong-shell share attempt did to the activity. A model reload nulls `prewarmPrefixHash` by design (`LlamaService.ts:690-691`), so that prewarm is expected, not a regression. The prescribed transition (HOME → foreground → new chat) produced no second start. Verdict PASS stands.

## Native sync on e6d6aa0

- APK SHA-256 verified: `9a1bacd086d6abcac448f213a3f017212f97ac95e86fd23343efb64495aa504f`; MiniCPM5 and `kalsa.bench.devmodels=1` selected. The first relaunch saw persisted-chat `skip/kv_holds_chat`; a drawer-created empty conversation (`hasMessages:false`) was used for the authoritative cold run. Full captures/reply are under `JELLY-PREWARM-2026-09-09/native-e6d6aa0/`.
- Cold lines: `09-09 15:55:17.581 ... 'KALSA_PREWARM', '{"op":"start","hash":"3586270056","systemChars":3969,"toolCount":5}'`; `09-09 15:57:16.275 ... 'KALSA_PREWARM', '{"op":"done","promptMs":118648.554,"promptN":2112,"hash":"3586270056"}'`.
- Cold wall `118.694 s`; `promptMs=118648.554 ms` (45.446 ms below wall); `promptN=2112`; implied prefill **17.8005 tok/s**. Native context remained `n_batch=512`, `n_ubatch=256`, threadpool `n_threads=2,n_threads_batch=8`, variant `rnllama_jni_v8_2_dotprod`.
- Warm handoff also queued a second prewarm: `09-09 15:59:07.988 ... 'KALSA_PREWARM', '{"op":"start","hash":"3586270056","systemChars":3969,"toolCount":5}'`; `09-09 16:01:42.117 ... 'KALSA_PREWARM', '{"op":"done","promptMs":154080.476,"promptN":2112,"hash":"3586270056"}'`.
- Warm turn: `09-09 16:01:42.198 ... KALSA_KVPREFIX embd=2112 text_tokens=2122 n_common=2109`; `09-09 16:02:12.922 ... KALSA_TELEMETRY {"turnId":"1","round":0,"tokensCached":2230,"tokensEvaluated":2122,"tokensPredicted":107,"draftTokens":0,"draftAccepted":0,"promptMs":2562.462,"predictedMs":27891.589999999997,"predictedPerSecond":3.8362818326240995,"contextFull":false,"interrupted":false,"ciswireFlags":4}`. Turn `promptN` was not emitted; reply is in `native-e6d6aa0/turn/reply-verbatim.txt`.
- Final state: `kalsa.model.id|lfm2.5-2.6b`, `kalsa.bench.devmodels|1`, app stopped, battery 100%/35°C, thermal status 0, keep-awake restored; model files untouched.

Verdict: PASS for native sync — MiniCPM5 now reports real `promptMs≈wall` and `promptN=2112`; PARTIAL for the share handoff because it still re-creates the engine and repeats the prewarm before the warm turn.
