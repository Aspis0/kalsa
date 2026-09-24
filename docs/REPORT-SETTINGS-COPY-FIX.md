# Settings copy fixes

Branch `ux-2026-09-21`, starting HEAD `20bdff23`. No commit or build was made.

## Changes

1. **Where row** — `src/screens/SettingsHomeScreen.tsx:250` now renders the title and value only: “Dove risponde” · “Questo telefono” / “Where it responds” · “This phone”. Removed subtitles “Locale sul telefono; in futuro, il tuo computer.” / “Local on this phone; your computer later.” and deleted the now-unused `whereRunsHint` catalog keys. The rendered-row assertions in `src/screens/copyTruth.test.ts:171-193` verify exactly those two strings in both locales, so adding a subtitle or losing either label fails.
2. **Model id leak** — when `currentModelId` is `REMOTE_COMPUTER_MODEL_ID`, `src/screens/SettingsHomeScreen.tsx:182-187,252` now displays “Kalsa desktop” instead of the persisted `kalsa-remote-mac`. The same fallback name is set on the virtual model at `src/engine/remote/remoteComputerModel.ts:15-19`. The rendered-row test at `copyTruth.test.ts:171-193` checks the displayed name and verifies the id is absent. I searched other uses: `HostChatSurface.tsx:231` and `RemoteBrainSettings.tsx:291,328` render localized labels; the remaining id uses are state, persistence, declarations, or tests, not user-facing text.
3. **Machine naming** — `settings.remoteComputer` changes from “My computer” / “Il mio computer” to “Your computer” / “Il tuo computer” at `src/i18n/en.ts:208` and `src/i18n/it.ts:207`. The action changes from “Use my computer” / “Usa il mio computer” to “Use your computer” / “Usa il tuo computer” at `en.ts:211` and `it.ts:210`. Existing hints already use “your computer” / “il tuo computer” and remain unchanged. The English remote settings test renders and pins “Your computer” before the action at `src/screens/RemoteBrainSettings.disclosure.test.ts:150,171-197`; `copyTruth.test.ts:191-192` checks the corresponding wording in both catalogs.

## Checks

- `npx jest --runInBand --silent src/screens/copyTruth.test.ts src/screens/settingsHome.test.ts src/screens/RemoteBrainSettings.disclosure.test.ts` — EXIT=0, 3 suites / 21 tests.
- `npx tsc --noEmit` — EXIT=0.
- `npx jest --silent` — EXIT=0, 222 suites / 2,394 tests.
- All 59 `node` commands in `.github/workflows/apk.yml:87-156` — each EXIT=0; aggregate EXIT=0, 0 failures.
- `git diff --check` — EXIT=0.

One initial targeted run exited 1 because `copyTruth.test.ts` still expected the removed subtitle key. I replaced that expectation with assertions against the rendered rows; the final targeted and full runs pass.
