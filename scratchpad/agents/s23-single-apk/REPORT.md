# S23 single-APK session

Predictions were written first in [PREREG.md](PREREG.md) at 2026-09-24 15:29:30Z. It remains unchanged.

## Artifact and install

- `gh run watch 36020315876 --exit-status`: exit 0; run success, `headSha=67ade7a88e2fc1887b05e355d9c1ee648e0a3878`.
- Downloaded arm64-v8a debuggable artifact. CI log verifies `application-debuggable`, arm64, and native patch; provenance: binding `Aspis0/kalsa.rn@463f11f9f47f`, engine `kalsallama@8eac584bb341`.
- APK size 160,481,995 bytes; SHA-256 `57eb0fbedfb34a23afbcb17792b9372cb6e1d663e24d66c495b0646ed1a347ec`. The downloaded APK and pulled installed `base.apk` match; extracted APK matches the uploaded ZIP contents. ZIP SHA-256 `b56d08a277a5547ee51fef770d6c7e401484160b7aa7264baea4194d384127f6`, matching GitHub artifact metadata.
- `adb -s <S23> install -r`: exit 0, Success. No uninstall or data clear.

## S1 — incomplete; no valid turn

Session start: 69%, unplugged, 36.5°C, thermal status 0, low-power 0. At end: 47%, unplugged, 38.2°C, thermal status 1, low-power 0, Awake, `com.kalsa.app/.MainActivity` resumed. Timeout was restored from 2147483647 to its saved 1800000 ms.

The app-start log emitted `KALSA_GOVERNOR_PLAN`: `gpu_fit=Fit`, `decode_repack=false`, required without repack 2998.06 MiB, available 4094.76 MiB. `KALSA_NATIVE_VARIANT` selected `prefill:99, decode:0`, but the adjacent log says prefill admission paused because no safe chunk fit the thermal ceiling. This is startup evidence, not a completed S1 turn.

The first composer coordinate targeted a generic React view (`inputType=0`), so it was not counted. Corrected focus at the bottom composer produced an Android `ReactEditText` (`inputType=0x4001`, `imeOptions=0x4`), with Awake/Kalsa brackets. Neither the send tap nor an Enter action produced a `KALSA_TELEMETRY` line; a further bracketed action-row tap at y=1218 also produced none. The capture has zero `KALSA_TELEMETRY`, `KALSA_KVTRIM`, or governor fallback markers. Logcat contains repeated `Fabric View [-1] does not have SurfaceId associated with it` soft exceptions during composer/modal interaction. Therefore **0/20 turns are confirmed**; answer quality, persisted error text, commit/trim behavior, peak per-turn RssAnon, and turn-scoped lmkd status are unavailable. No engine turn is inferred from the startup plan or the unconfirmed composer attempt.

## S2 — not run

No valid S1 completion was obtained, so the preregistered paired timing cells were not started. No timing result is reported.

## Raw evidence and commands

All commands used the pinned S23 serial. CI watch, artifact download, `install -r`, timeout restore, and final-state read returned exit 0. Final device state: unplugged, 47%, 38.2°C, thermal 1, low-power 0, Awake/Kalsa foreground. The session-owned `/data/local/tmp/s23-single-apk-36020315876` directory was empty and removed.

[Evidence inventory](raw/evidence-inventory.txt) contains `ls -la` and `wc -l` for the cited raw evidence. Key records: `raw/ci-watch.log`, `raw/ci-job.log`, `raw/ci-run-metadata.json`, `raw/github-artifact-metadata.json`, `raw/apk-app.config`, `raw/install.log`, `raw/preinstall-bracket.txt`, `raw/s1-prompts.txt`, `raw/s1-brackets.txt`, `raw/s1-turn-01-driver.log`, `raw/logcat-session.txt`, `raw/composer-focus-probe-ime.txt`, `raw/s1-send-retry.txt`, `raw/s1-send-retry-post.txt`, and `raw/final-device-state.txt`.
