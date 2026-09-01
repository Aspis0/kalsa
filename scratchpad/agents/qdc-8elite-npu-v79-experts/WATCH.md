# Watcher contract — cell #44

Job 795454 burned 20 min with no Connect. This file is the recover path.

## When Running (seconds, not minutes)

1. On the QDC job page click **Connect** immediately.
2. Copy the SSH command from the dialog. Start the tunnel with
   `~/.ssh/qdc_ed25519`, local adb server **6037 only**
   (`ANDROID_ADB_SERVER_PORT=6037`, never 5037).
3. `adb devices` must show a `device`. Then run `q1_run.sh`.
4. Q1 is one llama-bench. Crash or non-zero after a successful load
   ends the NPU arm. Do not retry. Cancel the QDC session after logs
   are pulled so leftover cap is not idle-burned.

## When Submitted

Wait. Do not Cancel. Do not open a second session.

## When Completed with empty raw/

Do not requeue in the same breath. Write the empty-session erratum
first. Requeue only with this watcher already armed.
