# Implementation report 5

## Changes

- `src/screens/HelpScreen.tsx:17-23,54-65` now renders the six Help sections in the specified order. `src/i18n/en.ts:399-431` and `src/i18n/it.ts:394-426` provide the copy: local mode is scoped, the two model locations are named, the canonical computer disclosure is retained verbatim, document names are distinguished from document files, and computer mode's disabled tools are stated in one clause. The connection wording is conditional; it gives no address-entry steps, QR, camera, or control that is absent here.
- `src/screens/ProScreen.tsx:40-65` explains the upcoming benefits and what stays unchanged. It says Pro comes with the next version and is not for sale today; it has no price, duration, or purchase action.
- `src/screens/SettingsHomeScreen.tsx:244-246` and `src/screens/SettingsScreen.tsx:1411-1421` add the location subtitle and model-size guidance. The subtitle says the computer is a future option rather than promising it is faster (`en.ts:71,74-75`; `it.ts:70,73-74`).
- `src/ui/shell/ShellStrip.tsx:41-45` and `src/ui/shell/shellLocationLabel.ts:1-14` use localized “Local / Your computer” and “Locale / Il tuo computer” fallback labels. No “Dove rispondere” sheet exists in this branch, so no sheet copy was fabricated.
- Tests: `src/screens/copyTruth.test.ts:113-202` renders Help, Pro, and Settings copy in both languages and guards the disclosure, local-mode scope, absence of QR/pairing claims, no purchase action, prompt claims, and unchanged dictation wording. `src/screens/overlayGrammar.test.ts:245-259` replaces its old Help/FAQ key expectations with the six-section order and updates Pro's primary-action count to zero. `src/screens/settingsHome.test.ts:52-83` follows the model-size metadata; `src/ui/shell/stripWebSwitch.test.ts:36-49` and `stripTextBudget.test.ts:80-82` cover localized pill labels and their fit.

## Claims scoped and claims left unchanged

- **Scoped:** the Settings privacy disclosure (`en.ts:181-182`, `it.ts:180-181`); Help's model-location section (`en.ts:405-413`, `it.ts:400-408`); the Account closing line (`en.ts:1086-1087`, `it.ts:1055-1056`); and both system prompts in both languages (`en.ts:1136,1159`; `it.ts:1091,1113`). The prompts no longer claim the model always runs on this device or is a small on-device model; they retain Kalsa's identity, no-cloud/no-account/no-tracking facts, and concise-answer rule.
- **Also clarified:** the memory note now says saved memory may be included in a computer-mode conversation (`en.ts:998-999`, `it.ts:967-968`); enabled telemetry copy describes report contents rather than claiming chats never leave the device (`en.ts:186-187`, `it.ts:185-186`). Drawer, About, and Settings brand lines now say local by default (`en.ts:38,84,210`; `it.ts:37,83,209`); chat suggestion labels say “active model” (`en.ts:514-517`, `it.ts:512-515`).
- **Verified and left unchanged:** the dictation sentence at `en.ts:430` and `it.ts:425` remains byte-for-byte unchanged because transcription and audio handling stay on the phone in every mode. `copyTruth.test.ts:199-202` pins both exact sentences. `src/host/modelFailureState.test.ts:98-110` was not changed.

## Main-port facts, separate from this copy work

1. Main calls the mode “Remote brain” and its hint says to use your computer and set its address. This copy uses the owner's terms “il tuo computer” and “Kalsa desktop”; reconciliation of the mode label remains a merge follow-up for the coordinator.
2. Main currently connects by typing an address; QR is a later door. This branch has no address-entry client, so Help does not direct someone to that absent control or describe QR/camera pairing. The Help connection sentence is conditional: it becomes actionable when the port lands. The canonical “To answer…” disclosure is likewise explicitly conditional in Help.
3. Main says tools, memory extraction, translation, and embeddings stay off in computer mode. Help carries that limitation in one clause at `en.ts:408` and `it.ts:403`.

## Verification

- `npx tsc --noEmit` — EXIT=0.
- `npx jest --silent` — EXIT=0; 174 suites, 2,095 tests passed.
- `git diff --check` — EXIT=0.
- The port's address-entry behavior and a connected computer were not verifiable in this branch. No device run or build was performed; no commit was made.
