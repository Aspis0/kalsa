# Implementation report 5

## Changes

- `src/screens/HelpScreen.tsx:17-23,54-65` renders the six Help sections in order. `src/i18n/en.ts:399-431` and `src/i18n/it.ts:394-426` scope the local claim, name both model locations, use the canonical computer-data disclosure, distinguish document names from document files, and state the remote-mode feature limits in one clause. The connection wording is conditional and has no address instructions, QR, camera, or absent control.
- `src/screens/ProScreen.tsx:40-70` adds the third benefit as a Sparkles row after search. I chose candidate 1, “Funzioni esclusive e AI più potenti · Sui telefoni più recenti,” because the title carries the adjectives and the short subtitle fits the existing row. `src/i18n/en.ts:1101-1104` and `src/i18n/it.ts:1070-1073` contain both translations and explicitly retain free local chat and older-phone support. The row contains no numbers, model names, dates, or hedges and adds no purchase action.
- `src/i18n/en.ts:376` and `src/i18n/it.ts:371` now scope the embedding download claim to local mode. The computer-mode rule that disables embeddings, translation, tools, and memory extraction was not changed.
- `src/ui/AskAssistantMiniappRenderer.tsx:928,936,948,967,1000,1036,1067` now resolves Condition, its numbered fallback, and the four empty states through `context.t`. Their keys and both translations are in `src/i18n/en.ts:645-651` and `src/i18n/it.ts:639-645`.
- `src/app/miniappActions.smoke.test.ts:140-215` widens the existing partial mini-app parity check to every catalog path in both directions. Missing paths are printed by name; empty or whitespace-only values fail. Identical values are allowed for names and format strings.
- `src/screens/copyTruth.test.ts:166-320` renders the Pro row in both languages, checks its position and copy, rejects digits, model names, dates, and hedges, and pins the old-phone/free-chat floor. Its location-claim guard scans every string in both catalogs. The explicit allowlist gives each approved key its source line and reason; the embedding sentence is allowed only when scoped to local mode.
- The two `Kalsa` brand literals at `src/screens/SettingsHomeScreen.tsx:273,277` were deliberately left untranslated: Kalsa is the brand name.

## Claims scoped and claims left unchanged

- **Scoped:** Settings privacy (`en.ts:181-182`, `it.ts:180-181`); Help model location (`en.ts:405-413`, `it.ts:400-408`); Account closing line (`en.ts:1092-1093`, `it.ts:1061-1062`); both system prompts in both languages (`en.ts:1144-1168`, `it.ts:1099-1122`); and the embedding hint above. The prompts no longer claim the model always runs on this device or is a small on-device model; identity, no-cloud/no-account/no-tracking, and concise-answer instructions remain. Memory copy says computer mode may include saved memory (`en.ts:1004-1005`, `it.ts:973-974`); enabled telemetry copy describes report contents rather than claiming chats never leave the device (`en.ts:186-187`, `it.ts:185-186`).
- **Verified and left unchanged:** the Help dictation sentences at `en.ts:430` and `it.ts:425` remain byte-for-byte unchanged; phone transcription keeps audio on the phone in every mode. The Settings speech hint at `en.ts:342` and `it.ts:337` is also unchanged. `copyTruth.test.ts:304-307` pins the Help wording. Reviewer n2 confirmed the dictation copy and endorsed removing the model-location assertion from the system prompts while retaining identity and privacy.

## Main-port facts, separate from our copy

1. Main labels the mode “Remote brain” and asks for the computer's address. Our copy uses “il tuo computer” and “Kalsa desktop”; the mode-label reconciliation remains a merge follow-up for the coordinator.
2. Main connects by typing an address; QR is a later door. This branch has no address-entry client, so Help does not direct the reader to it or describe QR/camera pairing. Its computer-connection copy is conditional and becomes actionable when the port lands.
3. Main disables tools, memory extraction, translation, and embeddings in computer mode. Help states those limits in one clause (`en.ts:408`, `it.ts:403`).

## Verification

- `npx tsc --noEmit` — EXIT=0.
- `npx jest --runInBand --silent src/screens/copyTruth.test.ts src/app/miniappActions.smoke.test.ts src/screens/overlayGrammar.test.ts` — EXIT=0; 3 suites, 32 tests passed.
- `npx jest --silent` — EXIT=0; 174 suites, 2,096 tests passed.
- `git diff --check` — EXIT=0.
- No device run, build, install, or commit. The computer connection could not be exercised because its client is not in this branch.
