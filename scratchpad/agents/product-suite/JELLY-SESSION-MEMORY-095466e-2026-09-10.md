# JELLY SESSION+MEMORY verification — APK from `095466e`

**Verdict (scoped):** identity fix **PASS** on device; e455afc extraction-abort **PASS**; Stop/Edit **reachable** (behaviour partial). No BLOCK.

Owner-authorized step: M1/G2-scoped. One device, one session. No Mac build, no Xiaomi (`192.168.1.193`), no S23 (`192.168.1.152`), no uninstall/clear-data/file deletion.

---

## Provenance

| Item | Value |
|---|---|
| App commit under test | `095466ec5c88a8cf4588b898b00cce632b1c1508` (`fix(session): derive engine identity from native build inputs`) |
| Base commit | `e2e09f5` |
| Audit (BLOCK #2) | `SESSION-IDENTITY-AUDIT-e2e09f5-2026-09-10.md` |
| Fix report | `SESSION-ENGINE-IDENTITY-FIX-2026-09-10.md` |
| Re-audit | `SESSION-ENGINE-IDENTITY-REAUDIT-2026-09-10.md` (SHIP, code review) |
| CI run (APK) | https://github.com/Aspis0/kalsa/actions/runs/34494832409 — `apk.yml`, dispatch `abi=arm64-v8a`, `debuggable=true`, `ref=main`, `headSha=095466e…`, conclusion **success** |
| CI run (E2E emulator) | https://github.com/Aspis0/kalsa/actions/runs/34494789017 — still `in_progress` when this report was written; not a gate for the identity fix (its logic gates are the same `Typecheck + logic harnesses` already green in `apk.yml`) |
| Local APK | `/tmp/kalsa-ci-34494832409-095466e/kalsa-apk-arm64-v8a-debuggable-095466ec5c88a8cf4588b898b00cce632b1c1508/app-release.apk` |
| Local SHA-256 | `224fb7d117f66bd94af0e8acd22d9b24559f6b3f98e9f059aebb2a25256e346a` (142 957 046 B) |
| Installed `base.apk` SHA-256 | `224fb7d117f66bd94af0e8acd22d9b24559f6b3f98e9f059aebb2a25256e346a` — **hash_match=true** |
| Device | Jelly Star, serial `JELLYS0000053795` (only device touched) |
| Model / locale | `lfm2.5-2.6b` / `it` |
| Device clock | UTC-4 (logcat times below are device-local; UTC markers are explicit) |

Raw evidence: `evidence/` in this directory (index at the bottom).

---

## Results

| # | Item | Observed | Verdict |
|---|---|---|---|
| 1 | CI logic gates for `095466e` | apk.yml `Typecheck + logic harnesses` = success (typecheck + 40 harnesses incl. `sessionMetaHarness` 50/0). `ci.yml` does **not** trigger on `main` — no separate jest CI run exists for this commit. APK build/assert/verify/download all success. | **PASS** |
| 2 | APK provenance | `headSha=095466e`, `arm64-v8a`, `application-debuggable` present (CI verify step), `kalsa-native-patches` + `q23k` in all release `librnllama*.so`, local == installed sha256 | **PASS** |
| 3 | `assets/app.config` transit in the **new** APK | `extra.engineBuildId` = `kalsa-eng-v1:source:765509c2…3a65`; equals the value computed from **committed** blobs at `095466e` | **PASS** |
| 4 | Install on Jelly | `adb install -r` Success; `firstInstallTime` unchanged (2026-08-12); `kalsa.memory.enabled`, `kalsa.locale`, `kalsa.bench.kvtranscript` prefs intact | **PASS** |
| 5 | Memory enabled **from the UI** | Settings → Memory `Switch` `checked=false → true` after tap; DB corroborates `kalsa.memory.enabled|1` | **PASS** |
| 6 | Identity: meta v2 + real `engineBuild` | `formatVersion:2`, `modelFileId:"1593894944:1787448754334"`, `engineBuild:"kalsa-eng-v1:source:765509c2…3a65:kalsa-native-patches"` | **PASS** |
| 7 | Identity: force-stop / reopen / continuation + reuse | new PID, `op:load ok:true tokens:4517`, `KVDIAG n_past=4517 == tokens_on_disk=4517`, `PREWARM skip kv_holds_chat`, next turn `promptMs 6736` vs `117882` cold | **PASS** |
| 8 | e455afc — extraction `done` with facts | turn 1: `factsExtracted 1 / factsStored 1`, `stopReason:"done"`; turn 2: `2 / 2`, total 3 | **PASS** |
| 9 | e455afc — next send during extraction → `aborted_by_send` | `stopReason:"aborted_by_send"`, `durationMs 8688`, `extractStopReason 0` (mid-completion abort), `factsExtracted 0` (aborted facts dropped); the send cancels extraction instead of awaiting natural completion, and the native checkpoint restore stays serialized | **PASS** |
| 10 | Stop mid-generation | "Interrompi generazione" button reachable and tapped; turn aborted (`extractStopReason 4` = signal.aborted); **no partial assistant message persisted** | **PASS (reachable/aborts)** — partial-keep **NOT DEMONSTRATED** |
| 11 | Edit USER message | User-message "Altro" → sheet with `Modifica`; tap opens `android.widget.EditText` prefilled with the user text + `Annulla`/`Salva` | **PASS (reachable)** — text change not typed (harness limit) |

Nothing FAILED. Two explicit SKIPs plus three limits/observations are listed in §11.

---

## 1. CI logic gates for the commit

`apk.yml` step **Typecheck + logic harnesses** ran `npm run typecheck` + 40 `*Harness.mjs` (including `sessionMetaHarness.mjs`, locally 50 passed / 0 failed after the alignment in the fix) — **success**.

`ci.yml` (jest) only triggers on `feat/**` and PRs, so this `main` push produced no jest CI run. Jest was therefore verified locally in the fix step (632/632). This is a gate-coverage observation, not a failure of this change.

Evidence: `evidence/01-ci-logic.txt`, `/tmp/run34494832409.log`.

## 2. APK provenance and `app.config` transit

CI (authoritative, from the run log):
- `[assert] native patch and q23k engine verified in all release binaries`
- `[verify] OK: debuggable present in APK as requested (true)` (`application-debuggable`)
- artifact `kalsa-apk-arm64-v8a-debuggable-095466ec5c88a8cf4588b898b00cce632b1c1508`

Local / device:
- APK size 142 957 046 B, sha256 `224fb7d1…346a`; installed `base.apk` sha256 identical.

**Transit check (the LIMIT from the previous report is now closed for the new code):**
- `unzip -p app-release.apk assets/app.config` → `extra.engineBuildId` =
  `kalsa-eng-v1:source:765509c292652441bd8bc8a3ebbad51c51657a4127cd545b47488800f9433a65`
- Expected value recomputed **from committed blobs at `095466e`** (`git show` / `git ls-tree` + the committed `scripts/engine-build-id.js` via `engineBuildIdFromInputs`), i.e. not from the working tree:
  committed pin `67c73d26…bd61`, committed `llama.rn` 0.12.8 (package-lock), committed patch `llama.rn+0.12.8.patch:aa7f1926…97e1`, 26 committed `native/**` blobs, committed `sync-kalsallama.sh` + `withLlamaFromSource.js`, variant `source` → **same string**. **MATCH=YES.**

Evidence: `evidence/02-apk-provenance.txt`, `evidence/03-appconfig-transit.txt`.

## 3. Install on the Jelly

`adb install -r` → `Success`. Post-install: `versionCode=1`, `versionName=0.1.0`, `firstInstallTime` unchanged (2026-08-12 01:58:33), `lastUpdateTime` 2026-09-10 11:55:56. App data intact. No uninstall, no `clear-data`, no file deletion.

Evidence: `evidence/04-install.txt`.

## 4. Memory enabled from the UI (the item blocked last session)

Last session's block was a single un-navigated pass: the toggle is **not** on the first screen. Correct path (verified on the dump, not guessed):

1. Chat header `content-desc="Menu"` → drawer opens.
2. The drawer `ScrollView` renders conversations first and the app items **after** them; swipe up within the drawer until `content-desc="Impostazioni"` is in the hierarchy.
3. Tap `Impostazioni`.
4. Settings is a `ScrollView`; the Memory section is the 5th (`Language → Appearance → CisWire → Instant chat reopen → Thinking → Memory`). Swipe until `content-desc="Ricorda informazioni su di me"` (locale `it`) is visible.
5. The node is `class="android.widget.Switch" checkable="true" checked="false"` at `[363,647][429,685]`; tapping its centre flips it to **`checked="true"`** and the `La memoria è disattivata…` note disappears.

Corroboration only (not the primary method): `SELECT value … WHERE key='kalsa.memory.enabled'` → `1`.

Evidence: `evidence/05-memory-ui-before.txt`.

## 5. Identity — the saved meta now carries a real engine identity

Before the turn, the active conversation's meta was **`formatVersion:1`** (no `modelFileId`, no `engineBuild`) — `evidence/06-meta-before.txt`.

After the first completed turn + save (`KALSA_SESSION {"op":"save","ok":true,"tokens":4517,"messageCount":36}`):

```
kalsa.session.meta.lfm2_002e5-2_002e6b__conv-g1-t11-1789031213__71419929
{"formatVersion":2,
 "modelFileId":"1593894944:1787448754334",
 "engineBuild":"kalsa-eng-v1:source:765509c292652441bd8bc8a3ebbad51c51657a4127cd545b47488800f9433a65:kalsa-native-patches",
 "nCtx":16384,"cacheTypeK":"q8_0","cacheTypeV":"q4_0",
 "historyHash":"2788512926","historyMessageCount":36, ...}
```

The `engineBuild` string is exactly `<embedded extra.engineBuildId>:kalsa-native-patches`. It is **not** the pre-fix constant `kalsa-native-patches:app:1`. It remained identical on every later save in the session (`evidence/14-meta-final.txt`).

Note on what this does and does not prove: the device session shipped **one** engine build, so it cannot by itself demonstrate that a *different* pin/patch set invalidates KV. That property is proven at build time (input-sensitivity demos in the fix report + the embedded value matching the committed inputs above). The device proves the real identity is present, well-formed, stable, and consumed by the restore path.

## 6. Identity — force-stop / reopen / continuation, reuse observable

Markers: `force_stop_utc=2026-09-10T16:09:16Z`, PID `19298 → 21302`.

After the cold process start:

```
12:09:22.446 KALSA_SESSION {"op":"init","no_extra_bufts":0}
12:09:26.492 KALSA_SESSION {"op":"load","ms":61,"ok":true,"tokensOnDisk":4517,"tokens":4517}
12:09:26.492 'KALSA_KVDIAG', '{"n_past":4517,"tokens_on_disk":4517,"ok":true}'
12:09:26.504 'KALSA_PREWARM', '{"op":"skip","reason":"kv_holds_chat"}'
```

- `op:load ok:true` — the v2 meta matched. No `meta_mismatch:<field>` appears in any captured window (the device ring buffer rotated, so absence is not global proof; the `ok:true` load is the positive evidence).
- `n_past == tokens_on_disk == 4517` — the KV is resident after restore.
- `PREWARM skip:kv_holds_chat` — no re-prefill over the restored session.

Continuation coherence (next turn, same conversation):

| Turn | promptMs | Note |
|---|---|---|
| 1 (cold) | 117 882.588 | full re-prefill (`tokensEvaluated 4137`, `KVDIAG n_common=2`). The active meta was `formatVersion:1` before the turn, which `readSessionMeta` rejects (`log({reason:"no_meta"})`), but **this session does not establish that the format bump caused this particular cold turn** — no `op:load`/`no_meta` line for the boot path was captured (the share intent only produced a cancelled `background.grace`, so the engine was already resident). Stated as an observation, not a causal claim |
| 2 (after restore) | 6 736.365 | ~17× faster on a ~4.8k-token prompt → cache reuse |

A later turn recorded `promptMs 9 956` on a ~5.3k-token prompt, consistent with reuse. `tokensCached`/`tokensEvaluated` are reported verbatim from the native result in the evidence; the reuse claim rests on `op:load ok:true` + `KVDIAG n_past == tokens_on_disk` + `PREWARM skip` + the promptMs drop, not on the cached/evaluated ratio alone.

Evidence: `evidence/09-phaseB-marker.txt`, `evidence/09-phaseB-logcat.txt`.

## 7. e455afc — extraction with facts, then abort by the next send

**Completed extractions with facts (`done`):**

```
12:08:53.188 KALSA_MEMORY_EXTRACT {… "memoryEnabled":1,"factsExtracted":1,"factsStored":1,
             "extractParseOutcome":1,"extractStopReason":0,"durationMs":7330,"timeoutMs":39926.39,"stopReason":"done"}
12:16:57.736 KALSA_MEMORY_EXTRACT {… "factsExtracted":2,"factsStored":2,"totalFactsInStore":3,
             "extractParseOutcome":1,"extractStopReason":0,"durationMs":11293,"timeoutMs":47464.99,"stopReason":"done"}
```

`KALSA_MEMORY` turn-end lines show `memoryEnabled:1` and `factsInjected:0→1→3→5` across turns (facts ride the user tail).

**Abort test — one genuine attempt** (`evidence/fast-abort2/`, driver `fast_abort_send.sh`):

```
12:17:34.498 KALSA_MEMORY {…}                     <- turn-end (extraction armed)
12:17:34.732 KALSA_SESSION {"op":"save",…,"tokens":5022,"messageCount":40}
12:17:43.322 KALSA_SEND {…}                        <- my next send accepted
12:17:43.413 KALSA_SESSION {"op":"load","source":"memory_extract_restore","ok":true,"tokensOnDisk":5022}
12:17:43.421 KALSA_MEMORY_EXTRACT {… "factsExtracted":0,"factsStored":0,
             "extractStopReason":0,"durationMs":8688,"timeoutMs":47539.73,"stopReason":"aborted_by_send"}
```

- `stopReason:"aborted_by_send"` — **not** `skipped_no_snapshot`.
- `extractStopReason:0` means the extraction had actually started (the pre-start cancel path sets `1`), i.e. the **native completion was aborted mid-flight** by the next send.
- `factsExtracted:0 / factsStored:0` — aborted facts dropped.
- The send was accepted at `:43.322` and the app moved on (fit `allow:true`, generation started) while the extract settled at `:43.421` — **the send cancels extraction instead of awaiting natural completion; the native checkpoint restore remains serialized** (the restore log line is emitted before the extract settles, so the send still pays the checkpoint-restore step, it does not skip it).

The first (missed) attempt is recorded honestly in `evidence/11-abort-attempt.txt`: the send landed ~5 s *after* the extraction had already finished (`stopReason:"done"`), so it tested nothing. The `evidence/fast-abort/` directory contains only the excluded `.share_hist.json` and has no retained raw evidence. The second attempt above is the real one.

## 8. Stop mid-generation

- During generation the composer button's `accessibilityLabel` switches to `Interrompi generazione` — observed in the hierarchy and tapped (`16:20:46Z`, and again at `16:22:07Z` after a deliberate 25 s wait).
- Abort confirmed: `extractStopReason:4` (the AppShell early path taken when `signal.aborted || turnFailed || !assistantFull.trim()`).
- No `KALSA_TELEMETRY` line was emitted for either stopped turn.
- **No partial assistant message was persisted**: after both stops the conversation's last message is the user turn, with no assistant record (`evidence/13-stop*`).
- The app stayed healthy: the send *after* the first stop started and generated normally.

So: reachable **PASS**, "partial kept" **NOT DEMONSTRATED** (the observed behaviour is that the aborted turn leaves no assistant message). Reported as a limit, not a verdict on intent — this step was scoped to reachability.

## 9. Edit USER message

The previous session's dump was an **assistant** message menu (assistant menus expose only `Salva nelle note` / `Traduci` / `Annulla`). A **user** message's `Altro` exposes `Modifica`:

- user bubble `E quella della Spagna?` (right-aligned, `x>=108`) → its action row `[259,329][367,368]` copy / `[366,329][460,368]` Altro;
- tap Altro → sheet `content-desc`: `Salva nelle note`, `Traduci`, `Modifica`, `Annulla`;
- tap `Modifica` → `android.widget.EditText` prefilled `E quella della Spagna?` + `Annulla` / `Salva`.

Limit: `adb input text` does not update the React `TextInput` state (documented harness hole, the same reason the composer is fed via `kalsa://share`), so no text change was typed; `Annulla` was used to leave state clean. Reachability and the editable field are proven; the save/regenerate behaviour was **not** exercised.

Evidence: `evidence/12-edit-user-reachable.txt`.

## 10. Device hygiene

Jelly only. No uninstall, no `clear-data`, no file deletion. Battery 100% → 100%; 29.0 °C → 35.0 °C. S23 (`192.168.1.152`, SM-S911U) and Xiaomi (`192.168.1.193`) were never contacted. `evidence/15-final-state.txt`.

## 11. SKIPs and limits (explicit)

1. **Edit text change** — SKIP: `adb input text` cannot drive a React `TextInput`; only reachability proven.
2. **Stop partial-keep** — SKIP: aborted turn persisted no assistant message in two attempts; the "partial kept" expectation was not reproduced.
3. **Engine-change invalidation on device** — SKIP by construction: one engine build in this session. Proven at build time instead (§2, §5).
4. `apk.yml` does not run jest and `ci.yml` does not run on `main`, so jest for `095466e` is local-only (632/632 in the fix step).
5. Device clock is UTC-4; UTC markers are given where they matter.

## 12. Evidence index

| File | Content |
|---|---|
| `00-preinstall.txt` | pre-install package/battery state |
| `01-ci-logic.txt` | CI logic gate result + `ci.yml` trigger note |
| `02-apk-provenance.txt` | run/sha/size/debuggable/assert provenance |
| `03-appconfig-transit.txt` | embedded vs committed `engineBuildId` |
| `04-install.txt` | `install -r`, post-install package state, prefs intact |
| `05-memory-ui-before.txt` | toggle node before/after, DB corroboration |
| `06-meta-before.txt` | active meta was `formatVersion:1` |
| `07-turn1-marker.txt`, `07-turn1-logcat.txt` | turn-1 markers + save/extract lines |
| `08-meta-after-turn1.txt` | meta v2 with real `engineBuild` |
| `09-phaseB-marker.txt`, `09-phaseB-logcat.txt` | force-stop/reopen markers + load/KVDIAG/PREWARM |
| `10-turn2-marker.txt` | continuation markers |
| `11-abort-attempt.txt`, `11-extract-lines.txt`, `fast-abort/` | first (missed) abort attempt |
| `fast-abort2/` | real abort attempt driver log |
| `12-edit-user-reachable.txt` | user-message Edit discovery |
| `13-stop-marker.txt`, `13-stop-logcat.txt`, `13-stop2-telemetry.txt` | Stop attempts |
| `14-meta-final.txt` | meta after all device work |
| `15-final-state.txt` | final device state |
| `fast_abort_send.sh` | abort driver (reproducible) |

This report is committed with the explicitly scoped PLAN/ALIVE and evidence paths; no device state was changed.
