# qdc-8elite-heat-arms — report

**Status: NOT RUN (2026-09-27).** No QDC session was opened and no minutes
were spent. The portal session in Paseo tab `3774c340` had expired, and Okta
asked for a full sign-in. The `aspis.launcher` password is not in the Keychain,
and agents do not handle passwords. The owner chose to stop here.

Ready on disk for the run:
- `PREREG.md`: 15 arms, metrics, decision rules and budget (a 70-min cap).
- `sess.sh` and `smp.sh`: the on-device runner, and the sampler with the 45 °C skin watchdog.
- `run.sh`: the host driver, run step by step on adb port 6037.
- `analyze.py`: the host-side parse into `raw/results.tsv` plus the median table.
  It was checked on a synthetic fixture built from the S23 run-6 logs.
- The kit is at `~/kalsa-qdc/qdc-8elite-heat-arms/kit-8e.tgz` (manifest in
  `kit.SHA256SUMS`). It is engine f25f0c1c5 plus the v79 HTP skel from the same build.

To run: log in as aspis in the tab, then open an interactive "SSH only" session on
QRD8750 with a 70-min cap, Screen Always On, and SSH key `kalsa-mac`. Start the
tunnel on 6037, then run `run.sh preflight`, then `run.sh push`, then
`run.sh launch <start+64min epoch>`, then `run.sh poll` until `DONE`, then
`run.sh pull`, then `analyze.py raw/device-out`. End the session.
