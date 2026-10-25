# Device capture — Jelly Star, 2026-09-22

Repo `kalsa-ux`, branch `ux-2026-09-21`, HEAD `0246081`. Written by the orchestrator session that ran
the capture the brief (`docs/NEXT-SESSION.md`) asked for. The frames are committed with this file,
under `docs/captures/2026-09-22/` (ten PNGs, 480x854 each). `mock/` is deliberately ignored, so a
capture that has to be readable from the repo goes here.

| Frame | What it is |
|---|---|
| `01-model-ready.png` | Pill `LFM2.5 2.6B / Su questo telefono`, model bar `Pronto · locale`, model resident |
| `02-send-held-waiting-first-token.png` | Sent, IME up: control swapped to stop, line `In attesa che parta la risposta` |
| `03-thinking-card-and-trail.png` | The thinking card with the cloud's three-ring trail below it |
| `04-streaming-free-band.png` | Streaming with the band free: `Fermato da te` from the earlier stopped turn, `In attesa mentre scrive`, live stop control |
| `05-answer-appearing.png` | The answer's first line arriving inside the 24 dp edge fade — where the caret glyph is lost |
| `06-stop-partial-the-sea.png` | After a stop: thinking card and the partial answer `The sea` |
| `07-after-new-chat-tap.png` | The frame right after the second tap on `shell.strip.newChat` |
| `08-empty-state-after-relaunch.png` | Empty state restored after force-stop and relaunch: photograph, `Buonasera.`, welcome line, suggestion card |
| `09-drawer-conversations.png` | The drawer: two `Senza titolo` from two new-chat taps, and the previous conversation whose preview still carries its messages |
| `10-large-context-held.png` | The 13 453-token turn held at `In attesa che parta la risposta` |

## What is on the phone

| Item | Value |
|---|---|
| APK | `com.kalsa.app` v0.1.0, 155 572 635 bytes, sha256 `e1ae8c677bbdd5b755eb44ee76ab7de7b3996adde92ffd5e9abf7263cbab3452` |
| sha on device | identical to the built artifact (verified after `adb install -r`) |
| Engine | `node_modules/llama.rn`, vendor `LLAMA_CPP_COMMIT=8537d097c32e7307d82540b6da8eb448d7e07107`, built **from source in this worktree**, CPU-only |
| Variant picked at runtime | `KALSA_NATIVE_VARIANT {"androidLib":"rnllama_jni_v8_2_dotprod","nGpuLayers":0}` |
| Model | `lfm2.5-2.6b`, resident of app storage, loads in ~6 s from local file |

## Build traps — three, all cost time

1. **`-PrnllamaBuildFromSource=false` builds an APK with no engine.** The recipe in
   `docs/HANDOFF-2026-09-21.md:472` and `docs/DESIGN.md:497` produces 24 native libs and **zero**
   `librnllama*.so`. The app boots, mounts the shell, and answers a model tap with the engine's own
   sentence `Error: JSI bindings not installed` (`shell.modelBar.hint`). The CI recipe
   (`.github/workflows/build-kalsa-apk.yml:67`) passes `=true`. For any capture that must load a
   model, `=true` is the flag.
2. **With `=true`, the Hexagon branch fires and the configure dies.** `build.gradle:143-168` enables
   DSP support whenever `~/.hexagon-sdk/6.4.0.2` exists, and CMake then stops with
   `Hexagon host QAIC artifacts are missing ... htp/v73/htp_iface_stub.c`
   (`rnllama/CMakeLists.txt:110`). The artifacts are in neither worktree and the generator the
   message names (`scripts/build-hexagon-htp.sh`) is **not** in the installed package. There is no
   `-PrnllamaHexagon` property; the only switch is the environment:
   `HEXAGON_SDK_ROOT=/nonexistent-hexagon-sdk HEXAGON_TOOLS_ROOT=/nonexistent-hexagon-tools`.
   That yields the CPU-only engine — which is the variant this device uses anyway.
3. **This worktree's native caches were copied from `/Users/marco/Projects/kalsa`.** The cached
   `CMakeCache.txt` under `node_modules/llama.rn/android/.cxx/RelWithDebInfo/631b5u4n/` names
   `CMAKE_HOME_DIRECTORY=/Users/marco/Projects/kalsa/node_modules/...`, so a bare `ninja` in this
   worktree rebuilds objects **into the other worktree** (it did, 2 861 edges). Delete
   `node_modules/llama.rn/android/.cxx` and `node_modules/llama.rn/android/build/intermediates/cxx`
   before a from-source build here. With the caches deleted, the from-source build is 2 675 objects
   and 14 `.so` in 7 m 8 s (10 cores, `-j6` and `--max-workers=2`).

The app module's own witness is unchanged: the only translation units compiled for `:app` are CMake's
two LTO probes (`_CMakeLTOTest-CXX/.../foo.cpp.o`, `.../boo.dir/main.cpp.o`).

## What the run proved, with the log lines that prove it

- **A real turn.** `KALSA_TELEMETRY {"turnId":"1","tokensCached":2367,"tokensEvaluated":2167,"tokensPredicted":199,...,"predictedMs":30628,"predictedPerSecond":6.497}` — 199 tokens in 30.6 s
  at 6.5 tok/s on CPU, and the answer rendered as block nodes (`transcript.answer.<id>.b0.0…b0.9`,
  the 1-to-10 list) plus a second turn whose partial text is `The sea`.
- **The stop, both outcomes.** Empty drop: a stop during the prefill removed the placeholder and
  returned the control to `Invia`. Partial: a stop mid-stream left the partial answer and the marker
  line `Fermato da te` in the tree (`mock/device-2026-09-22/jelly_marker.png`).
- **The epoch-stamped round trip of real content.** `force-stop` → relaunch gives
  `KALSA_SESSION {"op":"load","ok":true,"tokensOnDisk":2591,"stemHash":"536206399"}` against the
  earlier `{"op":"save","ok":true,"tokens":2367,"messageCount":2,"stemHash":"536206399"}`, and the
  transcript comes back with the user turns, the list answer, the partial answer and the stop marker.
- **The empty state.** Greeting `Buonasera.`, welcome line `Cosa vuoi approfondire oggi?`, the
  suggestion cards, the toolbar. Shown after the app was restarted into a conversation with no
  messages.
- **The thinking card and the cloud's trail.** `thought-<id>-head` = `Thinking…` with the
  `thought-<id>-trail` node live, and three rings visible under the card
  (`mock/device-2026-09-22/thinking-trail-19-48.png`).
- **The composer's held lines, live.** `In attesa che parta la risposta` while the prompt is
  processed, `In attesa mentre scrive` while the answer streams — with the send ⇄ stop swap applied
  and the field still typeable.
- **The model bar's battery lines** (see finding 2) and the engine reason verbatim.

## Findings that move parity verdicts (verify, do not repeat)

1. **The strip's "Nuova chat" creates and activates a new conversation but does not reset the
   transcript.** Two taps at `shell.strip.newChat` (398,41)-(464,107) produced **two** conversations
   named `Senza titolo` in the drawer, while the transcript kept rendering the previous
   conversation's messages — message ids unchanged across the tap — until the app was restarted,
   at which point the welcome state appeared. Nothing was lost: the drawer preview of the previous
   conversation reads `List eight fruits, one short sentence each.`, i.e. its messages persisted.
   This is `PARITY-STATUS.md` Section 4.3 made visible (no synchronous multi-system reset on
   new-chat); it is a defect with user impact, not a note.
2. **D1 row 36 (advisory battery ETA line) is not MISSING.** The model bar carries two states:
   `Stima dell'uso della batteria — appare dopo ~10 min di generazione continua` (placeholder) and,
   once a decode rate exists and charge fell below 50 %,
   `~1 h 30 min–2 h rimanente a questo ritmo` — observed at 49 % and again at 46 % and 45 %.
3. **Table 3 gap 8 (idle dispose) is wired.** `'model.unload', '{"reason":"idle","idleMs":289714}'`
   — the model released itself after ≈290 s idle. Whatever PARITY says about "no production caller",
   something calls it; the next walk should name the constant and the caller.
4. **The engine's own reason reaches the screen verbatim** — `shell.modelBar.hint` carried
   `Error: JSI bindings not installed` for a build with no engine libs, alongside the retry row and
   `Impossibile caricare il modello.` Row 25's mechanism works; row 35's "hint line" claim should be
   re-read against it.

## Still unproven

- **The streaming caret's glyph.** The streaming *state* is photographed
  (`mock/device-2026-09-22/jelly_k44.png`: the answer's first line appearing under the user capsule
  while the composer reads `In attesa mentre scrive` and the stop control is live), but the caret
  sits inside the 24 dp edge fade at the band's bottom edge and the frames do not resolve it.
  Recipe for the retry: capture while the streaming line is mid-band, not at the pinned end.
- **Tool rows.** Both turns logged `KALSA_TOOLCALL {... "toolNames":[]}` — the engine emitted no
  tool call, so nothing could render. The Web toggle was off; a tool-row capture needs it on and a
  prompt that provokes a call.

## A large-context turn is slower than the patience window

The first turn of this session carried a **13 453-token** prompt
(`RNLlama loadPrompt: prompt_n=13453 n_ctx=16384 embd=2147`, `KALSA_PREFIX_MEASURED {"tokens":2147}`,
prewarm invalidated by `meta_mismatch:engineBuild`). At the measured prefill rate
(`promptMs:77767.073` for 2 147 tokens ≈ 27.6 tok/s) that turn could not produce a first token
inside the 15 minutes it was given. The conversation history already holds one turn that failed this
way: `La risposta non è iniziata entro 1175 s` — the same 19.6-minute patience window. The new
conversation's first turn, at 2 367 cached tokens, was fast (1.6 s prefill, 30.6 s generation).

## Phone state at hand-off

App force-stopped, screen dozing, animation scales `1 1 1`, `/data/local/tmp` 114 entries (unchanged),
battery 45 %, 33.0 °C, not charging. Five conversations in the drawer, including the two real ones
from earlier sessions (`Spiega la fotosintesi clorofilliana in una frase` ×2).
