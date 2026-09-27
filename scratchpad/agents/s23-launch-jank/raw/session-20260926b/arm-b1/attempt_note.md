# B1 setup attempt (excluded)

The first B1 cold launch had `pidof com.kalsa.app` return empty at the immediate post-launch check; the `top` command did not produce samples and no valid `gfxinfo` window was recorded. A later read found the process and confirms `KALSA_EAGER delay_ms=5000` plus model loading, but the 30-second sample window had already passed. This attempt is excluded. The measured B1 retry is `../arm-b1-valid/`.
