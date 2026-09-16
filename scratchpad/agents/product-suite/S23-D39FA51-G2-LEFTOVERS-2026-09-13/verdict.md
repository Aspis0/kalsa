# S23 d39fa51 — G2 leftovers — 2026-09-13

S23 only. No reinstall (hash match). No stayon. Not G2. `oneshot` see run.log.

## SHA — PASS

```text
sha256=1a0fb8f5a00b2d52f80648c41967213b19577bce8f09844ffe44bd112032598c
hash_match=true
```

[s23] battery_before=  status: 5   level: 100   temperature: 283 
[s23] battery_after=  status: 5   level: 100   temperature: 375 
After: stay_on=0, timeout=null.

## 1) Tools — PASS

```text
09-13 08:43:38.672 28797 28830 I ReactNativeJS: KALSA_TOOLCALL {"turnId":"1","round":0,"toolChoice":"auto","structuredCalls":1,"fallbackCalls":0,"fallbackDialect":"none","executed":1,"skippedCap":0,"skippedDup":0,"skippedFailedRepeat":0,"failed":0,"blockedPrivacy":0,"namesValid":true,"argsParsed":true,"toolNames":["device_calc"]}
09-13 08:43:38.672 28797 28830 I ReactNativeJS: KALSA_TOOLCALL {"turnId":"1","round":0,"toolChoice":"auto","structuredCalls":1,"fallbackCalls":0,"fallbackDialect":"none","executed":1,"skippedCap":0,"skippedDup":0,"skippedFailedRepeat":0,"failed":0,"blockedPrivacy":0,"namesValid":true,"argsParsed":true,"toolNames":["device_calc"]}
```

```text
09-13 08:43:38.669 28797 28830 I ReactNativeJS: KALSA_TELEMETRY {"turnId":"1","round":0,"tokensCached":2197,"tokensEvaluated":2137,"tokensPredicted":59,"draftTokens":0,"draftAccepted":0,"promptMs":17235.875,"predictedMs":5713.159999999999,"predictedPerSecond":10.32703442578188,"contextFull":false,"interrupted":false,"prompt_n":308,"ciswireFlags":3}
```

numeric in UI: **True**. tool line present: **True**.

```text
Kalsa
LFM2.5 2.6B · QAD-Q4_0 · Pronto · locale
Web
Buongiorno.
Cosa vuoi approfondire oggi?
Spiega un concetto in modo chiaro
Chat · modello locale
Cerca sul web: ultime notizie su [argomento]
Websearch · modello locale
Crea una tabella di confronto
Mini-app · tabella interattiva
Riassumi questo testo
```

## 2) Documents — SKIP/HARNESS_MISS

library n=0. keys:
```text
(empty)
```

```text
(empty)
```

```text
(empty)
```

## 3) 20 turns — FAIL

completed **1/20**. abort=`none`. stuck_1833_or_0_after_t5=**False**. restore load ok=**False**.

last 3 KVPREFIX:
```text
09-13 08:43:57.810 28797 28921 W RNLlama : loadPrompt:473 KALSA_KVPREFIX embd=2136 text_tokens=2137 n_common=2122 mtp_draft_mem_shared=0 is_enc_dec=0 this=0xb4000079d7c27000
```

restore:
```text
09-13 08:44:45.645 32429 32454 I ReactNativeJS: KALSA_SESSION {"op":"load","ms":6,"ok":false,"tokensOnDisk":0,"stem":"lfm2_002e5-2_002e6b__conv-g1-i14-1789042691__71419929","reason":"no_file"}
```

| check | verdict |
|---|---|
| SHA | **PASS** |
| tools | **PASS** |
| documents | **SKIP/HARNESS_MISS** |
| 20-turn | **FAIL** (1/20) |
| timeout/stayon after | **null / 0** |
| G2 | **not claimed** |
