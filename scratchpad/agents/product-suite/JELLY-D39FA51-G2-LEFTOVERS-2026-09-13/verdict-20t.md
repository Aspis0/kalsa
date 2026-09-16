# Jelly d39fa51 — G2 leftovers — 2026-09-13

Jelly only. No reinstall (hash match). No stayon. Not G2. `oneshot` see run.log.

## SHA — PASS

```text
sha256=1a0fb8f5a00b2d52f80648c41967213b19577bce8f09844ffe44bd112032598c
hash_match=true
```

[jelly] battery_before=  status: 2   level: 100   temperature: 320 
[jelly] battery_after=  status: 4   level: 100   temperature: 370 
After: stay_on=?, timeout=?.

## 1) Tools — PASS

```text
09-13 11:21:52.779  3420  3444 I ReactNativeJS: KALSA_TOOLCALL {"turnId":"1","round":0,"toolChoice":"auto","structuredCalls":1,"fallbackCalls":0,"fallbackDialect":"none","executed":1,"skippedCap":0,"skippedDup":0,"skippedFailedRepeat":0,"failed":0,"blockedPrivacy":0,"namesValid":true,"argsParsed":true,"toolNames":["device_calc"]}
09-13 10:09:10.725 26569 26593 I ReactNativeJS: KALSA_TOOLCALL {"turnId":"1","round":0,"toolChoice":"auto","structuredCalls":0,"fallbackCalls":0,"fallbackDialect":"none","executed":0,"skippedCap":0,"skippedDup":0,"skippedFailedRepeat":0,"failed":0,"blockedPrivacy":0,"namesValid":true,"argsParsed":true,"toolNames":[]}
09-13 11:21:52.779  3420  3444 I ReactNativeJS: KALSA_TOOLCALL {"turnId":"1","round":0,"toolChoice":"auto","structuredCalls":1,"fallbackCalls":0,"fallbackDialect":"none","executed":1,"skippedCap":0,"skippedDup":0,"skippedFailedRepeat":0,"failed":0,"blockedPrivacy":0,"namesValid":true,"argsParsed":true,"toolNames":["device_calc"]}
```

```text
09-13 11:21:52.777  3420  3444 I ReactNativeJS: KALSA_TELEMETRY {"turnId":"1","round":0,"tokensCached":2259,"tokensEvaluated":2178,"tokensPredicted":80,"draftTokens":0,"draftAccepted":0,"promptMs":15899.437,"predictedMs":12099.655999999999,"predictedPerSecond":6.61175821858076,"contextFull":false,"interrupted":false,"prompt_n":351,"ciswireFlags":6}
```

numeric in UI: **True**. tool line present: **True**.

```text
Kalsa
LFM2.5 2.6B · QAD-Q4_0 · Pronto · locale
Web
The user is asking me to calculate 3847 + 291. This is a simple arithmetic operation. I need to use the device_calc tool to compute this accurately.&#10;&#10;Let me calculate: 3847 + 291 = 4138&#10;&#10;I should use the device_calc tool for this calculation as instructed. │
Ricerca approfondita
Documento in libreria
Fai una domanda…
```

## 2) Documents — FAIL

library n=8. keys:
```text
kalsa.documents.library
```

```text
09-13 11:24:15.287  3420  3444 I ReactNativeJS: KALSA_TOOLCALL {"turnId":"3","round":0,"toolChoice":"auto","structuredCalls":0,"fallbackCalls":0,"fallbackDialect":"none","executed":0,"skippedCap":0,"skippedDup":0,"skippedFailedRepeat":0,"failed":0,"blockedPrivacy":0,"namesValid":true,"argsParsed":true,"toolNames":[]}
09-13 11:24:15.286  3420  3444 I ReactNativeJS: KALSA_TELEMETRY {"turnId":"3","round":0,"tokensCached":2434,"tokensEvaluated":2259,"tokensPredicted":174,"draftTokens":0,"draftAccepted":0,"promptMs":24100.676,"predictedMs":35254.46799999999,"predictedPerSecond":4.935544623733934,"contextFull":false,"interrupted":false,"prompt_n":432,"ciswireFlags":6}
```

```text
Kalsa
LFM2.5 2.6B · QAD-Q4_0 · Pronto · locale
Web
Kalsa
Sto pensando
4138
Copia
Leggi ad alta voce
```

## 3) 20 turns — PASS

completed **20/20**. abort=`none`. stuck_1833_or_0_after_t5=**False**. restore load ok=**True**.

turn 1:
```text
09-13 11:28:47.888  6228  6303 W RNLlama : loadPrompt:473 KALSA_KVPREFIX embd=1832 text_tokens=2237 n_common=1829 mtp_draft_mem_shared=0 is_enc_dec=0 this=0xb400007d9d295ef0
```

turn 5:
```text
09-13 11:48:03.616  6228  6307 W RNLlama : loadPrompt:473 KALSA_KVPREFIX embd=4774 text_tokens=5270 n_common=4774 mtp_draft_mem_shared=0 is_enc_dec=0 this=0xb400007d9d48fcb0
```

last 3 KVPREFIX:
```text
09-13 13:11:37.335  6228  6306 W RNLlama : loadPrompt:473 KALSA_KVPREFIX embd=13028 text_tokens=13546 n_common=13028 mtp_draft_mem_shared=0 is_enc_dec=0 this=0xb400007d9d3db530
09-13 13:19:44.349  6228  6308 W RNLlama : loadPrompt:473 KALSA_KVPREFIX embd=13601 text_tokens=14120 n_common=13601 mtp_draft_mem_shared=0 is_enc_dec=0 this=0xb400007d9d3dfd10
09-13 13:27:07.771  6228  6305 W RNLlama : loadPrompt:473 KALSA_KVPREFIX embd=14273 text_tokens=14790 n_common=14273 mtp_draft_mem_shared=0 is_enc_dec=0 this=0xb400007d9d3d1c10
```

restore:
```text
09-13 13:30:03.367 14486 14510 I ReactNativeJS: KALSA_SESSION {"op":"load","ms":140,"ok":true,"tokensOnDisk":14896,"stem":"lfm2_002e5-2_002e6b__conv-1789313073606-jw9g0e0c__71419929","tokens":14896}
```

| check | verdict |
|---|---|
| SHA | **PASS** |
| tools | **PASS** |
| documents | **FAIL** |
| 20-turn | **PASS** (20/20) |
| timeout/stayon after | **? / ?** |
| G2 | **not claimed** |
