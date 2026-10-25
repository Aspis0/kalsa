# KV paging spike - raw numbers

binary: /Users/marco/Library/Application Support/kalsa-brain/runtime/builds/metal/llama-b10950/llama-server
model: /Users/marco/Library/Application Support/kalsa-brain/runtime/models/Trinity-Nano-Preview-Q4_K_M.gguf
openssl: {'python_cryptography': None, 'python_cryptography_error': "ModuleNotFoundError: No module named 'cryptography'", 'openssl': '/opt/homebrew/bin/openssl', 'openssl_version': 'OpenSSL 3.6.4 25 Aug 2026 (Library: OpenSSL 3.6.4 25 Aug 2026)'}

- **E1**: PASS - repeat on the same slot is warm with --cache-ram 0 (slot0 601/606, slot1 599/604 cached/prompt tokens)
- **E2**: shared-cache channel, virgin device pinned to slot 1: cram384 cached=0 (prompt_ms 330.0, ttft 335) VS cram0 cached=0 (prompt_ms 332.7, ttft 338); router channel, virgin device unpinned: cram384 cached=89 (prompt_ms 249.1) VS cram0 cached=89 (prompt_ms 250.1) -> cache channel inactive in both; router channel STILL OPEN at cram0 (no --cache-ram effect)
- **E3_no_swa_full**: restore reports n_restored=613 but the next request cached=0 prompt_ms=331.3 (cold fill 330.9ms) -> RESTORE IS A NO-OP FOR CACHING
- **E3_swa_full**: restore yields cached=605 prompt_ms=13.7 vs cold 309.9ms -> RESTORE WORKS with --swa-full
- **E4**: HKDF-SHA256+AES-256-CBC roundtrip sha256 MATCH; decrypted restore cached=605 (cold 0); encrypted bytes fed to restore -> status 400
- **E5_np1_no_swa_full**: A returns cached=0 prompt_ms=334.1 (cold 265.8ms) -> paging gives nothing back
- **E5_np1_swa_full**: A returns cached=605 prompt_ms=13.7 (cold 84.9ms) save=4.125ms restore=2.347ms -> one slot pages
- **E6**: pinned: ctrl384 wrong=0/338ms exact=0/337ms, cram0 wrong=0/336ms exact=0/336ms (flat); unpinned: ctrl384 wrong=89/272ms exact=601/49ms, cram0 wrong=89/272ms exact=601/51ms (cached 89 vs 601 = the guess is readable from cached_tokens and TTFT with --cache-ram 0)
- **E6_verdict_yes_no**: YES for the pinned-slot path only (every pinned guess shows 0 cached and flat TTFT at --cache-ram 0); NO for the unpinned path (89 vs 601 cached, 272ms vs 51ms TTFT, identical at cram384 and cram0)
