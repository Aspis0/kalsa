# Settings location row repair

Branch `ux-2026-09-21`, starting HEAD `53cd0aab`. No commit, build, or device install was made.

## Changes

- `src/screens/SettingsHomeScreen.tsx:218-225,263-270` makes the location row pressable and keeps it title + value only. Its value and icon now follow `remoteActive`: “Questo telefono” / “This phone” locally, and the pill's shared `shell.where.pillComputer` label (“Il tuo computer” / “Your computer”) remotely. The shared AttachSheet lists both choices and marks the active one.
- `src/host/HostFurniture.tsx:77-78` passes the model host's `remoteActive` and selector through `src/host/HostOverlays.tsx:65-67,186-190` and `src/screens/SettingsScreen.tsx:122-125,1433-1437`. This is the same state read by `src/host/HostChatSurface.tsx:116-122` for the pill.
- `src/host/remoteModelHostActions.ts:32-47,49-90` routes remote and local changes through the existing model transition/selectors and refusal predicate. Stream, regeneration, busy model operations, and document deletion now write a localized reason into the shared notice slot. A local choice remains available when remote loading is in the error state.
- `src/host/hostModelDisposal.ts:10-25` holds the existing engine disposal callback extracted from `useModelHost.ts`, keeping that host file below the 350-line limit.
- Added refusal copy in both catalogs at `src/i18n/en.ts:233-235` and `src/i18n/it.ts:232-234`.
- `src/screens/settingsWhereBehavior.test.ts:141-185` renders both locations in both catalogs, opens the sheet and checks its selected radio, then drives both choices through the host action factory. `src/host/remoteModelHostActions.test.ts:44-60,90-122` proves refusal notices and confirms refused local returns do not dispatch. The existing rendered-copy check is updated at `src/screens/copyTruth.test.ts:183-194`.

## Verification

- `npx tsc --noEmit` — EXIT=0.
- `npx jest --silent` — EXIT=0, 223 suites / 2,403 tests.
- All 59 `node scripts/*` commands listed in `.github/workflows/apk.yml` — each EXIT=0; total 59, failed 0.
- `npx jest --runInBand --silent src/host/fileSize.test.ts` — EXIT=0, 1 suite / 5 tests.
- `git diff --check` — EXIT=0.

I could not verify the requested walk on a phone; no build or install was run. The host has no live semantic-rebuild job/state, so its existing `semanticRebuildBusy: false` input cannot be exercised at the host boundary; the document-delete refusal is wired and tested.
