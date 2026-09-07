# Kalsa

**A private AI chat that runs entirely on your phone.** No backend, no cloud inference, no account.
Kalsa loads a quantized LLM (GGUF) onto the device and runs it locally with
[llama.cpp](https://github.com/ggml-org/llama.cpp) via [llama.rn](https://github.com/mybigday/llama.rn) —
your conversations never leave the handset.

> Status: **pre-release, Android first.** Usable and actively developed; not on any store yet.

## What it does

- **Local chat** with Qwen 3.5 (4B / 2B) or Gemma 4 E2B — you pick the model, it downloads once and stays on the device.
- **Vision**: attach photos or PDFs (pages are rendered and fed to the model's vision projector).
- **Voice**: on-device speech-to-text with Whisper, and text-to-speech for replies.
- **Web search, opt-in**: an agentic tool loop that only leaves the device when *you* ask a question that needs the web. Default provider is keyless; API keys, if you add any, live in the OS keystore.
- **Memory, opt-in and filtered**: short facts about you, kept on the device. Passwords, cards, IDs, addresses and health data are refused automatically.
- **Smart conversation memory** (experimental): long chats are compacted into a frozen digest instead of a blunt sliding window, so older facts survive. Off by default until the benchmark says otherwise — see [`docs/RESEARCH_CONTEXT_LOSS.md`](docs/RESEARCH_CONTEXT_LOSS.md).
- **In-chat mini-apps**: quizzes, tables and small interactive blocks the model can emit, rendered in a sandbox.
- English and Italian throughout.

## Requirements

| Model | Device RAM | Download | Notes |
|---|---|---|---|
| **Qwen 3.5 4B** (default) | **8 GB+** | ~3.5 GB | Best quality, understands images, 16k context |
| Qwen 3.5 4B-Q3 | 6–8 GB | ~2.4 GB | Same model, lighter quantization |
| Qwen 3.5 2B | under 6 GB | ~1.3 GB | Fast fallback, text only |

Android 8+ (arm64 recommended). The app shows your detected RAM and flags the model that fits.

## Build it yourself

```bash
npm install
npx expo prebuild --platform android      # generates android/ (CNG)
cd android && ./gradlew assembleRelease
```

The APK lands in `android/app/build/outputs/apk/release/`. For development: `npm start`, then `npm run android`.

Useful scripts:

```bash
npm run typecheck              # tsc --noEmit
node scripts/retrieverHarness.mjs   # BM25+ retriever unit harness
node scripts/compactorHarness.mjs   # context-compaction harness
```

## How it is tested

Beyond typecheck and the logic harnesses, `.github/workflows/e2e-emulator.yml` runs a **real
end-to-end proof on a KVM-accelerated emulator**: it builds the APK, sideloads a GGUF, drives the
UI through adb, sends a message and waits for the model's actual reply — failing the job if no
reply is produced. Screenshots, UI dumps, logcat and the chat database are uploaded as artifacts.

## Architecture at a glance

```
src/
  engine/      llama.rn wrapper, model catalog & downloader, RAM/context profile
  context/     BM25+ retriever, conversation compactor, operative block
  memory/      on-device user facts with a sensitivity filter
  search/      pluggable web-search providers (Exa MCP / Exa / Brave / Tavily)
  voice/       Whisper ASR + TTS
  ui/ theme/   design system and in-chat mini-app renderer
  screens/     chat, settings, help
```

Design notes and the multi-turn context research live in [`docs/`](docs/).

## Privacy

Inference, chat history, memory facts and model files stay on the device. Android auto-backup is
disabled so multi-GB models and conversations are not copied off the phone. The only outbound
traffic is a web search you explicitly trigger, and the model download from Hugging Face.

**Telemetry** is off by default and opt-in. A release/store build **must** set
`TELEMETRY_WORKER_URL` in `src/telemetry/config.ts` to the deployed Worker
origin (see `workers/telemetry/README.md`). Leaving it empty silently disables
network send — correct for local/dev, not for production.

**Egress privacy filter (fail-closed).** The only user-triggered outbound traffic that can carry
private data is `web_search` (its query) and `web_fetch` (its URL **and** query). Before either
leaves the device it is scanned by the tool-call gate (`src/rules/toolGate.ts`): a stored memory
fact echoed verbatim, a card/IBAN/SSN pattern, an email address — any match blocks the call and
returns a localized "blocked" message. Gate evaluation **fails closed**: if evaluation itself
throws, the call is blocked, never allowed. The bypass flag `kalsa.bench.toolgate=0` is honored
**only in `__DEV__`** and never in a release/store build.

**Honest limit.** The gate is a regex/structural filter, not an LLM. It catches known patterns and
a fact echoed verbatim, but it **cannot** catch a secret the model rephrases into its own words
inside a search query. That is the boundary of this on-device approach — documented, not hidden.

## License

[Apache License 2.0](LICENSE) — see the file for terms. Model weights are distributed by their
respective authors under their own licenses.
