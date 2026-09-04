# S5 operator run

1. In QDC Interactive Devices, reserve QRD8650 first. Name the session
   `S5-QRD8650`, click Connect, and copy its SSH command.
2. Start the copied tunnel with local port 6037; replace only the QDC host:
   `/usr/bin/ssh -i /Users/marco/.ssh/qdc_ed25519 -o IdentitiesOnly=yes -o ExitOnForwardFailure=yes -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30 -L 6037:saXXXX.sa.svc.cluster.local:5037 -N sshtunnel@ssh.qdc.qualcomm.com`
3. In a second terminal, verify the tunnel:
   `ANDROID_ADB_SERVER_PORT=6037 /opt/homebrew/bin/adb devices`.
   The driver starts and stops the `/data` mode-771 holder loop itself.
4. Run the locked CI APK from an absolute path:
   `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/d_run.sh <job_id> <absolute_apk_path> ABABABAB`
   The first turn runtime-checks `kalsa.bench.sampling=greedy`; a missing
   `KALSA_BENCH_TOKENS` line writes `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/<job_id>/PREREQUISITE.txt` and
   exits 3.
5. Wait for `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/<job_id>/END.txt`, pull `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/<job_id>`, then
   end the QDC session. Repeat for 8 Elite as `S5-8Elite`; end it after pull.
