# Jelly d39fa51 — G2 leftovers — 2026-09-13

Jelly only. No reinstall (hash match). No stayon. Not G2.

## SHA — PASS

```text
sha256=1a0fb8f5a00b2d52f80648c41967213b19577bce8f09844ffe44bd112032598c
hash_match=true
```

battery_before: status 2 level 100 temperature 320
battery_after (20t): status 4 level 100 temperature 370
After: stay_on=0, timeout=null.

## 1) Tools — PASS

```text
09-13 11:21:52.779  3420  3444 I ReactNativeJS: KALSA_TOOLCALL {"turnId":"1","round":0,"toolChoice":"auto","structuredCalls":1,"fallbackCalls":0,"fallbackDialect":"none","executed":1,"skippedCap":0,"skippedDup":0,"skippedFailedRepeat":0,"failed":0,"blockedPrivacy":0,"namesValid":true,"argsParsed":true,"toolNames":["device_calc"]}
```

```text
09-13 11:21:52.777  3420  3444 I ReactNativeJS: KALSA_TELEMETRY {"turnId":"1","round":0,"tokensCached":2259,"tokensEvaluated":2178,"tokensPredicted":80,"predictedPerSecond":6.61175821858076,"interrupted":false,"prompt_n":351}
KALSA_KVPREFIX embd=1832 text_tokens=2178 n_common=1829
```

## 2) Documents — PASS

in-app library `kalsa-v2-small-condominium.pdf` (n=8). No adb SEND-PDF.
Fresh recycle then send (same-chat docs send on the 20t pass was FAIL executed=0).

```text
09-13 13:37:44.755 15764 15787 I ReactNativeJS: KALSA_TOOLCALL {"turnId":"1","round":0,"toolChoice":"auto","structuredCalls":1,"fallbackCalls":0,"fallbackDialect":"none","executed":1,"skippedCap":0,"skippedDup":0,"skippedFailedRepeat":0,"failed":0,"blockedPrivacy":0,"namesValid":true,"argsParsed":true,"toolNames":["document_chat"]}
09-13 13:37:44.755 15764 15787 I ReactNativeJS: KALSA_DOC_STRATEGY {"strategy":"full_context","estTokens":489,"ctx":16384,"budgetTokens":556,"tokPerSec":27.808448187977024}
KALSA_KVPREFIX embd=1832 text_tokens=2363 n_common=1829
```

## 3) 20 turns — PASS

completed **20/20**. abort=none. `oneshot.done`.

turn 1: `KALSA_KVPREFIX embd=1832 text_tokens=2237 n_common=1829`
turn 5: `KALSA_KVPREFIX embd=4774 text_tokens=5270 n_common=4774`
turn 20: `KALSA_KVPREFIX embd=14273 text_tokens=14790 n_common=14273`
TELEMETRY t20: `tokensCached":14896,"tokensEvaluated":14790,"tokensPredicted":105`

restore:
```text
09-13 13:30:03.367 14486 14510 I ReactNativeJS: KALSA_SESSION {"op":"load","ms":140,"ok":true,"tokensOnDisk":14896,"stem":"lfm2_002e5-2_002e6b__conv-1789313073606-jw9g0e0c__71419929","tokens":14896}
```

| check | verdict |
|---|---|
| SHA | **PASS** |
| tools | **PASS** |
| documents | **PASS** |
| 20-turn | **PASS** (20/20) |
| timeout/stayon after | **null / 0** |
| G2 | **not claimed** |
