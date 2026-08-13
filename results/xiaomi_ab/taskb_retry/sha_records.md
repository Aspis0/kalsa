# SHA records — Xiaomi Task B RETRY

Verified 2026-08-13 on device after Memory Extension OFF.

## Binary / libs (campaign pin)

| file | size | sha256 | note |
|---|---:|---|---|
| `bmoe-cli` (device) | 402416 | `1ca51420476d4a979552448f1c0b5bc48a04ed2e43643543ce43fa7566bb022f` | campaign pin; `--version` 0.19.0 after lib closure |
| `libssl.so.3` | 875304 | `9bf626fadf689237cf641bf1108057f0cc87c587c17fbdeaa16bd4a12807d7ce` | pulled from idle S23 Termux `/usr/lib` (one scp) |
| `libcrypto.so.3` | 5205472 | `4122f5c95088f11a43c14e49e257cc1ce700960e855840cf9b9f39a8acbcd7e8` | same scp |
| `libllama-common.so.0` etc. | — | unchanged from prior Task B push | already staged |

DT_NEEDED closure (llvm-readelf NDK 27.1): campaign bin → llama/ggml + libc/libm/libdl/libandroid/libc++_shared. `libllama-common.so.0` → `libssl.so.3` + `libcrypto.so.3`. OpenSSL needs only libc/libdl. No further missing libs. `libc++_shared.so` already in `taskb/bin/`.

## Model / prompts

| file | size | sha256 |
|---|---:|---|
| `Qwen3.6-35B-A3B-KEXP.gguf` | 13416430592 | `ac44e20c1783b9105b83246fd8ce59892b47a265b84e1323a8a501929877721a` MATCH |
| `p_fact.txt` | 361 | `b5301c32c0bd8aae4cf5c25d667a52eef05b940a459a2e9c82b1b6134cf0dcbd` MATCH marco P1 |
| `p_creative.txt` | 268 | `761db0d07cbc312acb35fb8c64894be83f38a3a7f0ba14e2100ef6a44a29c871` MATCH marco P1 |
