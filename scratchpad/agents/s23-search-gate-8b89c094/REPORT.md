# S23: the web search gate lets an ordinary request through (app 8b89c094)

Functional check, 2026-10-16 19:53-19:55 local. Not a timing run: the phone was charging.

- Device: Galaxy S23 (SM8550), wireless adb, plugged in (AC), battery 34% / 30.7 C before the turn, 37% / 36.7 C after; awake; no keyguard.
- APK: CI run 38975826380, apk.yml, commit 8b89c094, arm64-v8a, `pkgFlags=[ DEBUGGABLE HAS_CODE ALLOW_CLEAR_USER_DATA ]`, sha256 `1e27ba67fcc18851c08123c6b4885aa72249cbaedb596521d6b98fa95cd9cab5`. Installed with `adb install -r` (app data kept, so the first-search consent stored earlier was already granted).
- Model: LFM2.5 2.6B, on this phone.
- Prompt, typed in a new chat: `Cerca sul web le notizie di oggi su Samsung`.

## Result

The search ran. The gate blocked nothing; the answer cited news.samsung.com, cnbc.com, theverge.com, samsungmagazine.eu, mt.co.kr. Before 90d541f3 the same kind of request was blocked 3 of 3 times on this phone (kalsa-brain docs/BACKLOG.md, section "Phone log report, web-search notice, report Worker").

`device-lines.txt` (local only; the lab ignores raw `.txt`) holds every KALSA_TOOLCALL and KALSA_GOVERNOR_* line of the turn. Quoted here:

- line 4, round 0: `"toolChoice":"auto","structuredCalls":1,...,"executed":1,...,"blockedPrivacy":0,...,"toolNames":["web_search"]`
- line 7, round 1: `"toolChoice":"auto",...,"executed":1,...,"blockedPrivacy":0,...,"toolNames":["web_fetch"]`
- line 10, round 2: `"toolChoice":"none","structuredCalls":0,"fallbackCalls":1,"fallbackDialect":"lfm","executed":1,...,"toolNames":["web_fetch"]`

## Findings beyond the gate

1. **web_fetch ran with no notice of its own.** The model fetched a page on round 1, as the BACKLOG item says.
2. **A forced text-only round still executes a tool.** Round 2 had `toolChoice:"none"` (forced after the search), yet an LFM text-dialect `web_fetch` was parsed and executed. In `/Users/marco/Projects/kalsa/src/engine/LlamaService.ts:5003`, `if (toolCallingEnabled && !toolCalls.length && options?.executeTool)` runs `parseFallbackToolCalls` without looking at `toolChoice`.
3. `KALSA_GOVERNOR_TURN` (line 11) still carries float noise: `"hn":41.30000305175781,"hg":41.900001525878906`.
4. Governor attribution in production lines: line 11 `"ep":"NPU","ed":"NPU",...,"npu":"HTP0",...,"therm":"FAST"`. KALSA_GOVERNOR_LOAD, COMPLETION (one per round), LEARNED, TURN and COST are all present; no line carries chat text.
