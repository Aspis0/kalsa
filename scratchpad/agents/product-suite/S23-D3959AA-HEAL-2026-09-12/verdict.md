# S23 d3959aa — second-send reuse after heal — 2026-09-12

S23 only `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp` SM-S911U. Same APK, no reinstall. No stayon. Timeout 300000 during shot, restored **null**. Not G2.

Previous optional send had already `window_slide`’d the 4454 file (`load no_file` this shot). Battery 28.9°C → 37.2°C. After: `stay_on=0`, `timeout=null`.

## Send 1 (same process)

```text
13:42:28 KALSA_KVPREFIX embd=0 text_tokens=1832 n_common=0
13:44:19 KALSA_KVPREFIX embd=1832 text_tokens=4467 n_common=1829
13:44:19 KALSA_KVDIVERGE n_common=1829 ... 5922 ...
13:46:59 KALSA_KVPREFIX embd=4635 text_tokens=207 n_common=2   # extract after turn
```

No `window_slide` on the user send. Cold/system prefix (`1829` vs `1832`). After the turn, live KV is **4635**.

## Send 2 (same process, no force-stop) — FAIL

```text
13:47:06 KALSA_SESSION {"op":"window_slide","kvCleared":true}
13:47:06 KALSA_KVPREFIX embd=0 text_tokens=4941 n_common=0
```

After heal/cold fill, next user send **slid again** and did not reuse 4635. `n_common` is 0, not ≈ embd.

| check | verdict |
|---|---|
| timeout/stayon after | **null / 0** |
| send2 n_common ≈ embd | **FAIL** (`window_slide` → `n_common=0`) |
