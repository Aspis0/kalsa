# S5 operator run

1. In QDC Interactive Devices, reserve QRD8650 first. Name the session
   `S5-QRD8650`, click Connect, and copy its SSH command.
2. Start the copied tunnel with local port 6037 (never 5037), for example:
   `/usr/bin/ssh -i /Users/marco/.ssh/qdc_ed25519 -o IdentitiesOnly=yes -o ExitOnForwardFailure=yes -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30 -L 6037:saXXXX.sa.svc.cluster.local:5037 -N sshtunnel@ssh.qdc.qualcomm.com`
   Replace only `saXXXX.sa.svc.cluster.local` with the host in QDC’s command.
3. The driver owns the `/data` holder loop. Verify the 6037 tunnel with
   `ANDROID_ADB_SERVER_PORT=6037 /opt/homebrew/bin/adb devices`.
4. After the sampling prerequisite is closed, run the absolute driver:
   `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/d_run.sh <job_id> <absolute_apk_path> ABABABAB`
   It will currently exit 3 before device access because the prerequisite is
   deliberately open.
5. Pull `raw/` evidence, end the QDC session, then repeat with 8 Elite named
   `S5-8Elite`. End each session immediately after evidence is pulled.
