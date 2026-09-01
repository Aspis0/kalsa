# Watcher contract — cell #45

Marco does the wizard + **Connect**. Then paste the QDC ssh line here
or run `connect.sh`. Do not open a second session.

**Name:** `npu-v79-d-rest-45`  20 min  SSH+mirror  key `kalsa-mac`
**Device:** QRD8750 / Snapdragon 8 Elite only. Unavailable = queue.

## Marco

1. New Interactive Session: Mobile → QRD8750 / 8 Elite → 20 min →
   Screen mirroring + SSH → `kalsa-mac` → Create Session.
2. When Running, click **Connect** within seconds (minutes start here).
3. Copy the ssh command from the dialog. Paste it in chat **or**:
   `pbpaste | true; ./connect.sh`
   (`connect.sh` rewrites local port to **6037**, never 5037).

## After Connect (agent)

`connect.sh` starts the tunnel then `d_run.sh`: kit → ops → OLMoE Q3 → Qwen.
One crash ends the NPU arm. End Session when `raw/done.txt` exists.

## When Submitted

Wait. Do not Cancel. Do not open a second session.

## When Completed without raw/done.txt

Do not requeue in the same breath.
