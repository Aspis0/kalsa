# SPIKE: encrypted per-device KV paging with the shared prompt cache disabled

Script: `dev/spike-kv-paging.py`
Results: `dev/results/kv-paging-spike/results.json`, `.../summary.md`, per-config
`argv.txt` + `server.log` (gitignored), and `run.out` (full tables).

## Setup (raw)

- host: Apple Silicon macOS, build `b10950` (commit `ad6c66839`), version `0.4.0-dev`
- binary: `/Users/marco/Library/Application Support/kalsa-brain/runtime/builds/metal/llama-b10950/llama-server`
- model: `.../models/Trinity-Nano-Preview-Q4_K_M.gguf`
  - `general.architecture = afmoe`, `n_swa = 2048`, `is_swa_any = 1`, 6B
- base argv: `--threads 4 --threads-batch 4 --batch-size 2048 --ubatch-size 512
  --ctx-size 16384 --n-gpu-layers all --flash-attn on --cache-type-k q8_0
  --cache-type-v q8_0 --sleep-idle-seconds 3600 --no-webui --metrics`,
  plus per-config `--parallel N`, `--cache-ram {0|384}`, `--slot-save-path <dir>`,
  and on the rescue config `--swa-full`.
- server load time: 1.0-1.03 s for every config (5 configs).
- fixture lengths via `/tokenize` on the raw strings: A = 598 tokens, B = 596,
  shared prefix = 579 tokens. As rendered by the chat template the prompts are
  606 / 604 tokens; the shared prefix is always 579 raw tokens. The doc's "579"
  is exactly this shared-preamble length.
- `--cache-ram 0` startup lines: `prompt cache is disabled - use --cache-ram N
  to enable it` and `--cache-idle-slots requires --cache-ram, disabling`.

## E1 - within-slot warmth with `--cache-ram 0`, np=2

| device/slot | req# | cached_tokens | prompt_tokens | cache_n | prompt_ms | ttft_ms |
|---|---|---|---|---|---|---|
| A (slot 0) | 1 | 0 | 606 | 0 | 334.8 | 340 |
| A (slot 0) | 2 | **601** | 606 | 601 | 44.6 | 50 |
| B (slot 1) | 1 | 0 | 604 | 0 | 329.9 | 335 |
| B (slot 1) | 2 | **599** | 604 | 599 | 44.2 | 49 |

**Verdict E1: PASS.** A slot keeps its own KV with the shared cache disabled.
Repeat costs 44 ms of prefill instead of 330 ms.

## E2 - cross-device oracle, `--cache-ram 384` (control) vs `0`

Same two-device shape, plus a virgin probe device that has never occupied a
slot, measured both pinned to slot 1 and unpinned (router decides).

`--cache-ram 0`:

| request | slot | cached_tokens | prompt_tokens | prompt_ms | ttft_ms | A_pin_leaked |
|---|---|---|---|---|---|---|
| A (slot 0) | pinned 0 | 0 | 606 | 347.0 | 352 | True |
| B1 (slot 1, first) | pinned 1 | 0 | 604 | 330.2 | 335 | False |
| A2 (slot 0) | pinned 0 | 601 | 606 | 53.4 | 58 | - |
| B2 (slot 1) | pinned 1 | 599 | 604 | 44.6 | 50 | False |
| virgin probe | pinned 1 | **0** | 604 | 332.7 | 338 | False |
| virgin probe | auto | **89** | 604 | 250.1 | 255 | False |

`--cache-ram 384`:

| request | slot | cached_tokens | prompt_tokens | prompt_ms | ttft_ms | A_pin_leaked |
|---|---|---|---|---|---|---|
| A (slot 0) | pinned 0 | 0 | 606 | 339.5 | 345 | True |
| B1 (slot 1, first) | pinned 1 | 0 | 604 | 329.7 | 338 | False |
| A2 (slot 0) | pinned 0 | 601 | 606 | 44.9 | 53 | - |
| B2 (slot 1) | pinned 1 | 599 | 604 | 44.7 | 50 | False |
| virgin probe | pinned 1 | **0** | 604 | 330.0 | 335 | False |
| virgin probe | auto | **89** | 604 | 249.1 | 254 | False |

**Verdict E2: the oracle is NOT closed by `--cache-ram 0`.**
Two separate facts:

1. With the device pinned to its own slot, a virgin device gets `cached_tokens=0`
   and a full 330 ms prefill in *both* configs. We could not reproduce the
   documented "81 of 579" cross-slot number at `--cache-ram 384` in this shape:
   at `-lv 3` the log shows `selected slot by id (1)`, and the shared-cache load
   in `get_available_slot()` only runs when the slot was chosen by LRU, not by
   id. The shared prompt cache never gets consulted for a pinned device.
2. With the device unpinned, the similarity router puts it in the slot still
   holding A's context (`selected slot by LCP similarity, f_sim_best = 1.000
   (> 0.100 thold), f_keep = 0.989`), and the virgin device reuses **89** tokens
   (250 ms prefill instead of ~340 ms). This 89 is the measured form of the
   documented 81, and it is **identical at `--cache-ram 384` and `--cache-ram 0`**.
   `--cache-ram` is not the control that governs it; slot routing is.

## E3 - slot save/restore with `--cache-ram 0` (load-bearing test)

Without `--swa-full` (np=2, slot 0):

| step | cached_tokens | prompt_ms | ttft_ms | save_ms | wall_ms | bytes |
|---|---|---|---|---|---|---|
| fill slot (cold) | 0 | 330.9 | 336 | | | |
| save -> a.bin | | | | 3.676 | 4.3 | 18,693,008 |
| after erase (must be cold) | 0 | 330.6 | 336 | | | |
| restore <- a.bin | | | | 2.397 | 3.0 | 18,693,000 |
| **after restore** | **0** | **331.3** | **336** | | | |

With `--swa-full` (np=1, slot 0):

| step | cached_tokens | prompt_ms | ttft_ms | save_ms | wall_ms | bytes |
|---|---|---|---|---|---|---|
| fill slot (cold) | 0 | 309.9 | 315 | | | |
| save -> a.bin | | | | 3.734 | 4.37 | 18,693,000 |
| after erase (must be cold) | 0 | 301.4 | 306 | | | |
| restore <- a.bin | | | | 2.249 | 2.84 | 18,693,000 |
| **after restore** | **605** | **13.7** | **19** | | | |

`n_saved = n_restored = 613` in both cases, file 18.69 MB, no API error.

**Verdict E3: save/restore is a NO-OP for caching unless `--swa-full` is added.**
The endpoint works (`200`, `n_restored > 0`) and the bytes are a valid KV
snapshot, but the next identical request forces a full re-prefill
(`cached n_tokens = 0, memory_seq_rm [0, end)`; `-lv 5` line: `forcing full
prompt re-processing due to lack of cache data (likely due to SWA or
hybrid/recurrent memory)`, server-context.cpp:3380). Source: restore restores
`slot->prompt.tokens` and the sequence state but creates no entry in
`slot.prompt.checkpoints`; for an SWA model the reuse path (`pos_min >= pos_next
- n_swa ...`, server-context.cpp:3351-3387) requires a checkpoint and, finding
none, resets `n_past = 0`. With `--swa-full` (full-size SWA cache) the
checkpoint gate is satisfied and restore is fully warm: 605/606 cached, 13.7 ms
vs 310 ms cold. The failure holds for a 29-token and for a 2,939-token prompt
(the 2,939-token case was checked during reconnaissance: restore still gave
`cached=0`, 1,520 ms).

## E4 - encryption transparency

- `python3 -c "import cryptography"` -> **ModuleNotFoundError** (not available).
  `openssl` CLI = `/opt/homebrew/bin/openssl`, OpenSSL 3.6.4. Used
  `openssl enc -aes-256-cbc` with a key from a hand-rolled **HKDF-SHA256**
  (`hmac`+`hashlib`), `salt=b"device-A"`, `info=b"kalsa-kv-paging-v1"`, random
  16-byte IV.
- round-trip `sha256(plain) == sha256(decrypted)` = **MATCH**
  (`5a5362555cb756fd...`), byte-identical via `cmp`.
- `restore` of the **decrypted** file: `cached 0` cold -> **`cached 605`** warm.
- `restore` of the ciphertext directly: HTTP **400** `Unable to restore slot: No
  available space in KV cache or invalid slot save file` (as required - encrypted
  bytes are not a slot file).
- The snapshot itself contains the prompt as **token IDs**, not text (file magic
  `qsgg`, then the `server_tokens` list). Token IDs decode back to the prompt, so
  the file is plaintext-equivalent and must be encrypted. No ASCII prompt text
  appears in `a.bin`.
- AES-256-CBC cost on this machine (18.69 MB): **74.3 ms encrypt / 58.4 ms
  decrypt** (252 / 320 MB/s). That is the per-switch crypto tax.

**Verdict E4: the paging wrapper is transparent.** Encrypt/decrypt is a pure
byte transform; the server is unaware of it, and the decrypted file restores to
a fully warm slot.

## E5 - more logical devices than physical slots

np=1, `--cache-ram 0`, three devices A/B/C sharing one slot, each device's turn
also evicting the previous one; then A returns.

Without `--swa-full`:

| step | cached_tokens | prompt_tokens | prompt_ms | ttft_ms | save_ms | restore_ms | bytes |
|---|---|---|---|---|---|---|---|
| A: send (cold) | 0 | 606 | 341.1 | 346 | 3.528 | | 18,693,000 |
| B: send (evicts A) | **89** | 604 | 248.7 | 254 | 3.937 | | 18,632,016 |
| C: send (evicts B) | **88** | 606 | 268.7 | 274 | 10.188 | | 18,693,000 |
| A: return, NO restore | 89 | 606 | 265.8 | 271 | | | |
| A: return, after restore a.bin | **0** | 606 | 334.1 | 339 | | 2.244 | 18,693,000 |

With `--swa-full`:

| step | cached_tokens | prompt_tokens | prompt_ms | ttft_ms | save_ms | restore_ms | bytes |
|---|---|---|---|---|---|---|---|
| A: send (cold) | 0 | 606 | 301.4 | 306 | 4.125 | | 18,693,000 |
| B: send (evicts A) | **582** | 604 | 82.4 | 87 | 3.936 | | 18,632,016 |
| C: send (evicts B) | **582** | 606 | 85.2 | 90 | 3.617 | | 18,693,000 |
| A: return, NO restore | 582 | 606 | 84.9 | 90 | | | |
| A: return, after restore a.bin | **605** | 606 | 13.7 | 19 | | 2.347 | 18,693,000 |

np=4, `--cache-ram 0`, 3 devices concurrent, one slot each:

| device | round | slot | cached_tokens | prompt_tokens | prompt_ms | ttft_ms |
|---|---|---|---|---|---|---|
| A | 1 | 0 | 0 | 606 | 916.8 | 925 |
| B | 1 | 1 | 0 | 604 | 998.5 | 1094 |
| C | 1 | 2 | 0 | 606 | 998.8 | 1094 |
| `<wall>` | 1 | | | | | 1255 |
| A | 2 | 0 | 601 | 606 | 68.6 | 76 |
| B | 2 | 1 | 599 | 604 | 103.8 | 130 |
| C | 2 | 2 | 601 | 606 | 101.9 | 130 |
| `<wall>` | 2 | | | | | 291 |

**Verdict E5: one physical slot can page, but only with `--swa-full`, and the
same-slot sharing re-opens the oracle.**
No `--swa-full`: A's return gets `cached=0`, i.e. **worse than no restore at all**
(89 -> 0), because restore clears the checkpoint that plain slot sharing had been
using. With `--swa-full`: A's return is `cached=605` (13.7 ms vs 84.9 ms cold),
save 4.1 ms + restore 2.3 ms server-side (4.8 + 3.0 ms wall). But a device
sharing the slot reads the previous device's preamble: 89 tokens without
`--swa-full`, **582 tokens with** - the flag that makes paging work is the flag
that widens the leak. np=4 gives every device its own slot: no cross-device
reuse in any round (0 on cold, 599-601 on each device's own warm repeat).

## E6 - oracle probe with a guessed private tail

A's private marker is `84719`; probes are sent to a freshly erased slot 1
(pinned) and unpinned.

`--cache-ram 0`:

| B probe | exact guess | slot | cached_tokens | prompt_tokens | cache_n | prompt_ms | ttft_ms |
|---|---|---|---|---|---|---|---|
| own tail (B) | no | pinned 1 | 0 | 604 | 0 | 330.5 | 336 |
| guess wrong | no | pinned 1 | 0 | 606 | 0 | 330.9 | 336 |
| guess exact | yes | pinned 1 | 0 | 606 | 0 | 331.1 | 336 |
| guess wrong | no | auto | **89** | 606 | 89 | 267.3 | 272 |
| guess exact | yes | auto | **601** | 606 | 601 | 45.5 | 51 |

`--cache-ram 384`: identical to the row above (wrong `89`/272 ms, exact
`601`/49 ms; pinned all `0`).

**Verdict E6: YES only for the pinned-slot path.** Every pinned guess shows
`cached=0` and flat TTFT (336-339 ms) at `--cache-ram 0`. On the unpinned path
the guess is directly readable with `--cache-ram 0`: a wrong guess gets 89 cached
tokens / 272 ms TTFT, the exact guess gets 601 / 51 ms. `--cache-ram 0` changes
nothing (same numbers at 384).

## Single most important finding

**With `--cache-ram 0`, `/slots/{i}?action=save|restore` returns success but does
not provide warm context on this model unless `--swa-full` is added - and the
flag that fixes paging (`--swa-full`) widens the same-slot cross-device leak from
89 to 582 cached tokens.** The save file is valid (`n_saved = n_restored = 613`,
18.69 MB, restore of an encrypted-then-decrypted copy is byte-identical), yet the
server forces full re-prefill after the restore: `after restore cached=0,
prompt_ms=331.3` against a cold fill of 330.9 ms, with the `-lv 5` line `forcing
full prompt re-processing due to lack of cache data (likely due to SWA or
hybrid/recurrent memory)`. Trinity-Nano is `afmoe` with `n_swa = 2048` and
`is_swa_any = 1`, and the reuse gate requires a context checkpoint that the
file restore never creates. So the E3/E5 design ("per-device warm context by
slot save/restore to disk") is inert as specified, and only works with
`--swa-full`, whose side effect is a much larger cross-device prefix leak on a
shared slot.

Close second, and the reason the privacy premise needs revision: **the
cross-device timing oracle is not a property of `--cache-ram`.** A virgin device
unpinned gets 89 cached tokens at *both* 384 and 0; the exact-tail guess gets 601
at *both*. What actually closes it is one pinned slot per device (measured: 0
cached, 330 ms prefill for every pinned cross-device probe, in both configs).
`--cache-ram 0` does disable the shared cache (`prompt cache is disabled`,
`--cache-idle-slots` disabled), but in the pinned-slot shape the shared cache was
never consulted anyway.

## Design consequences (measured, not proposed)

- Keep `-np N` with one pinned `id_slot` per device. That is the only control
  measured to zero the cross-device reuse (E2/E6 pinned rows).
- `--cache-ram 0` is still worth keeping as insurance for the auto-slot path, but
  it is not sufficient; also pin the slot and set `--slot-prompt-similarity 0` if
  the app ever sends a request without `id_slot`.
- If paging on fewer slots than devices is required, `--swa-full` is mandatory
  for restore to be warm, and the switch must be erase-or-restore *before* the
  incoming device's prompt is forwarded, otherwise it reads the previous
  device's prefix.
- Snapshot size is 30.8 KB/token (18.69 MB for 606 tokens; a full 16k-token
  context is ~490 MB), so disk and crypto cost scale with context, not with
  device count.
- Per-switch cost with `--swa-full`: save 3.6-4.1 ms + restore 2.2-2.3 ms
  server-side; AES-256-CBC on 18.69 MB adds 74.3 ms encrypt + 58.4 ms decrypt,
  i.e. ~0.22 ms/token total against ~0.51-0.55 ms/token of prefill saved. The
  crypto tax is roughly 40 % of the prefill it avoids at this size.

## Production primitive (proposed, not implemented)

- Key: `HKDF-SHA256(device_secret, salt = device_id, info = "kalsa-kv-paging-v1")`
  -> 32 bytes; `device_secret` in the macOS Keychain with
  `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`; rotate on revoke.
- Cipher: **AES-256-GCM** (or XChaCha20-Poly1305), random 96-bit nonce per
  snapshot, never reused; AAD binds `device_id || slot_id || model_file_sha256 ||
  build_id || format_version` so a snapshot cannot be replayed onto another
  device, slot, model, or build.
- File layout: cleartext authenticated header (magic, version, device_id,
  slot_id, nonce, key_epoch) + ciphertext; verify tag before writing a single
  byte of plaintext.
- The restore endpoint needs a filesystem path, so the wrapper must decrypt to an
  unlinked temp file (`mkstemp` + immediate `unlink`, or `O_TMPFILE`/tmpfs) and
  pass that path; there is no streaming restore endpoint and no fork is allowed,
  so a short-lived plaintext file is unavoidable. FileVault at rest is the
  backstop; APFS deletion does not guarantee zeroing.
- The snapshot contains the prompt as token IDs (decodable), so treat the file as
  plaintext-equivalent (confirmed).
- Open question before production: `--swa-full` changes the attention window for
  the SWA layers of an `afmoe` model trained with `n_swa = 2048`. That may change
  outputs; it must be validated separately against quality/evals before adoption.
