# QDC 8 Elite new APK governor run — preregistration

Registered 2026-09-24T13:31:25Z, before reserving the QDC session.

## Objective and run

On one Snapdragon 8 Elite QRD (Adreno 830) QDC phone, install CI run 35961215542 (main `57eca6077bf4b850b0ad4484ab870f29a29a4184`) and run one synthetic 20-turn chat, stopping early if the 40-minute device window approaches its end. Keep Kalsa in the foreground with the screen Awake. For every turn capture the verbatim `KALSA_GOVERNOR` JSON, relevant KVTRIM/governor fallback markers, answer coherence, and `mWakefulness` plus foreground activity immediately before and after. Record buffer lines while loading the model. Any ms or tokens/s are labeled **QDC board, powered — indicative only**.

## Predictions (locked)

- **Fit:** Fit. The QRD has ample RAM for the 2.6B ship model; I expect model load to succeed and the governor fit calculation to permit GPU prefill.
- **GPU prefill:** CPU prefill on turns 1–2 while context is established, then GPU prefill beginning turn 3 and continuing through turn 20, as on the Xiaomi 14 fixed-APK run. A different first GPU turn is a prediction miss, not a failure by itself.
- **KVTRIM and fallbacks:** no `KALSA_KVTRIM`, `KALSA_GOVERNOR_FALLBACK`, or `KALSA_GOVERNOR_RUNTIME_FALLBACK` during the 20 turns. Any such marker will be retained verbatim and counted as an exception.
- **Second-turn fix:** turn 2 completes without `commit_side: … watermark is invalid` or `route Reject during phase handoff`; all turns remain coherent and continue in the same chat.
- **decode_repack:** expected ON because the QRD has ample RAM. Infer this from engine buffer evidence at load: the relevant `CPU_REPACK` buffer allocation lines should be present. If absent from a complete captured load log, infer OFF; if the log is incomplete, mark unknown. `decode_repack` may not be in the per-turn JSON, so do not infer it from throughput.

## Materials verified and staged before reservation

- APK: run 35961215542, debuggable arm64, 159,321,059 bytes, SHA-256 `cbc3034ac7cc3baf93aa373efd9493a4de00de8a3f9befed785bfbf7161e1f81`. The CI job log has the uploaded artifact ZIP digest `224572258f51c4ccd2de022564beda57ed1c143ee41486d1d878bbc758783304`; the bundle contains only `app-release.apk`. The APK hash also matches the fixed-artifact record in `xiaomi-governor-night/REPORT.md`. No separate APK checksum sidecar was included in the downloaded bundle; the verified digest is recorded in `raw/host-materials/SHA256SUMS.txt`.
- Model: `LFM2.5-2.6B-QAD-Q4_0.gguf`, 1,593,894,944 bytes, SHA-256 `a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03`.
- Host copies of both artifacts, CI job log, artifact ZIP, and SHA-256 list are in `raw/host-materials/`.
- Synthetic prompt sequence is staged in `PROMPTS.txt`; no personal or user-provided text will be used.

## Device safety and validity

Request a 40-minute session maximum. Connect the adb tunnel on local port **6037 only**; establish the tunnel before probing adb. Keep Kalsa foreground and Awake throughout; log `dumpsys power` and resumed activity before and after every turn. A turn outside that gate is invalid and must be repeated if time permits. Record the saved screen timeout and restore it only if this run changes it. Record QDC power/battery/thermal state. Stop on Android thermal status >=3 or battery temperature >=44.0 C. QRD boards are powered, so all latency and throughput fields are descriptive only, never energy/performance claims.

## Results

Not measured at preregistration time. Predictions above remain unchanged; append observations and deviations in `REPORT.md`.
