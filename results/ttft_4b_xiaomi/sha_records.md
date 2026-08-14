# sha records — ttft_4b_xiaomi

date: 2026-08-14
device: adb-625689a2-9xEOfw._adb-tls-connect._tcp · houji · 23127PN0CG · Xiaomi 14
apk_commit: bea257e (main, merge fix/ttft-v2)

| artifact | bytes | sha256 | note |
|---|---:|---|---|
| /data/local/tmp/gdn_750/Qwen3.5-4B-Q4_K_M.gguf | 2740937888 | `00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4` | source, read-only, MATCH campaign pin |
| /sdcard/Download/Qwen3.5-4B-Q4_K_M.gguf | 2740937888 | `00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4` | copy only, source untouched |
| kalsa-ttft-v2-bea257e.apk | 143424435 | `2B71032D87B3B6A695AE7ABECDEF4FA63DF75276C4D2AE56A0D1FD47417CA4CA` | assembleRelease arm64, debug-keystore |

Catalog `qwen3.5-4b` sizeBytes in main is 2_834_975_040 (MTP GGUF + mmproj). The campaign file is the 2.74 GiB non-MTP Q4_K_M used in all Xiaomi/Jelly benches. App data after install-over is still 4736.3 MiB (models kept).
