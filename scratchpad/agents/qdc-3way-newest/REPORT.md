# QDC 3-way (CPU/GPU/NPU) on newest Snapdragon boards - 2026-09-29

**Status: NOT RUN. QRD8750 (8 Elite) was never selectable 05:59-11:56 UTC (19 polls); 8 Elite Gen 5 (SM8850) has 0 minutes on aspis. 0 QDC minutes spent; no session was created.**

- Poll log: `/tmp/qdc-3way/availability-polls.log`. Catalog snapshot: `/tmp/qdc-3way/catalog-2026-09-29.txt`.
- QRD8750: 640 min remaining, "Devices Busy" at 05:59, then "Unavailable" at every poll to 11:56.
  In the New Interactive Session wizard the card carries `class="disabled-card"`, so it cannot be
  queued at all (the 30/08 "queue on Unavailable" note no longer holds).
- SM8850 (8 Elite Gen 5, Android 17 on the public page): "Request Free Minutes", Unavailable. A Gen 5
  run needs someone to submit the minutes request first. That is the owner's call; I did not submit it.
- QRD8650 not run, per the coordinator (same SoC as the Xiaomi 14).
- Ready for the next attempt: `/tmp/qdc-3way/run_qdc.py <board> <v79|v81> stage|run|cleanup`. It
  replays the Xiaomi A/B order and flags exactly, with QRD gates (thermal status >= 3 or skin >= 50 C;
  no plug/battery gates because the rack board is powered). Host kit/model/prompt SHA256 verified
  (`host-kit-check.log`, `host-input-shas.log`). GPU route proof = `using device GPUOpenCL (QUALCOMM
  Adreno` + `offloaded 31/31`, because engine f25f0c1c5 never prints `selected platform:`.
  LD_LIBRARY_PATH is unset.
- Login trap (new): the Okta widget stays blank in a hidden Paseo tab (`inactiveTab` pause). Fix:
  call `oktaData.inactiveTab.renderFnBackup` on `renderArgsBackup`, then follow
  `oktaSignIn.router.appState.get('idx').rawIdxState.success.href`. No 2FA was asked. The identifier
  field is autofilled with marco's email, so use fill, not type.
