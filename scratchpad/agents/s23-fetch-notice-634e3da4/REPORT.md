# S23: fetch notice and text-only round on app 634e3da4

Functional check, 2026-10-17 00:00-00:02 local. Not a timing run.

- Device: Galaxy S23 (SM8550), wireless adb, unplugged, battery 98%, 28.7 C before / 31.9 C after, thermal status 0.
- APK: CI run 38997687535, apk.yml, commit 634e3da4, `pkgFlags=[ DEBUGGABLE HAS_CODE ALLOW_CLEAR_USER_DATA ]`, sha256 `c27b833aa923ed1169bb0d9f17a8df0750d8173b8a370d05f89f8d22dd43681d`. `adb install -r` (data kept: search consent already granted, fetch consent not yet).
- CI run 38997681322 (typecheck + jest) on the same commit: success.
- Model: LFM2.5 2.6B on this phone. Prompt, in a new chat: `Cerca sul web le notizie di oggi su Samsung`.

## What worked

`device-lines.txt` (local only; the lab ignores raw `.txt`) is quoted here.

- Search ran with no dialog. Line 1, round 0: `"toolChoice":"auto",...,"executed":1,...,"blockedPrivacy":0,...,"toolNames":["web_search"]`.
- Before the first page, the fetch notice appeared with the IT copy: "Aprire pagine web?" / "Per leggere una pagina, Kalsa la apre direttamente da questo telefono. Il sito vede il tuo indirizzo internet. La conversazione resta su questo telefono." / NON ORA / APRI. Tapped APRI.
- Line 2, round 1: `"toolChoice":"auto",...,"executed":1,...,"toolNames":["web_fetch"]`.
- The forced text-only round no longer runs a tool. Line 3, round 2: `"toolChoice":"none","structuredCalls":0,"fallbackCalls":1,"fallbackDialect":"lfm","executed":0,...,"toolNames":[]`.
- hn/hg rounded. Line 4: `"hn":33.7,"hg":40.3`.

## What did not: the user got no answer

The bubble shows `Non ho potuto completare la ricerca. Riprova o riformula la domanda.` above five source chips (ad-hoc-news.de, en.sedaily.com, mt.co.kr, mk.co.kr, news.samsung.com), with a stale "Recupero pagina..." status line (`final-answer.png`).

Why, from the lines: round 2 was markup only, so the blank-reply fallback fired (634e3da4 behaviour). The fallback completion ran (`KALSA_TELEMETRY ... "round":3,"tokensPredicted":146`) and its whole output was stripped again, so `KALSA_TOOLROUND_EXHAUSTED {"turnId":"1","roundsUsed":3,"streamedLen":0,"fallbackFired":true,"fallbackOk":false}` and the canned message was shown (`LlamaService.ts` ~5521, `strings.errors.toolRoundsExhausted`).

On 8b89c094 the same prompt answered with citations because the round-2 fallback fetch was executed. 634e3da4 closes that privacy hole but, on this model, turns the answer into an error. The fix belongs in the fallback, not the gate: LFM keeps emitting its text tool dialect even with tools off.

## Re-test on app a68ca93b (2026-10-17 ~09:08 local, S23 unplugged 65%, 37.9 C, thermal 1)

APK run 39002375129, debuggable, sha256 `12fc3b971c7a4ff98d79c7df7c9e70b1f3e7fc77e6faa3c605802ba3eb141a58`. Same prompt, new chat.
Rounds as before (search, one fetch, round 2 `"toolChoice":"none",...,"fallbackDialect":"lfm","executed":0`), then the fallback with the no-tools system prompt answered:
`KALSA_TELEMETRY ... "round":3,...,"tokensPredicted":718` and `KALSA_TOOLROUND_EXHAUSTED {"turnId":"1","roundsUsed":3,"streamedLen":0,"fallbackFired":true,"fallbackOk":true}`.
The bubble is a real answer grounded in the results, with source markers (e.g. "Trading estero: ... SK Hynix, più di Samsung Electronics (KRW 89 miliardi) (KRX) 3") above five source chips. No canned error.
