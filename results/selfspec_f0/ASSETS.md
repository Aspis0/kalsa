# selfspec-f0 assets (setup, 2026-08-13)

All hashes below are `Get-FileHash -Algorithm SHA256` unless marked otherwise.
KEXP itself was **not** rehashed this session (live LFM PPL, see `PC_BUSY.txt`).

## Model

| field | value |
| --- | --- |
| path | `C:\Users\gualt\Desktop\Kalsa\moe-experiments\models\Qwen3.6-35B-A3B-KEXP.gguf` |
| size_bytes | `13416430592` (Get-Item, this session) |
| size_GiB | `12.495` (size/2^30) |
| mtime | `2026-08-10T13:48:04.1365582-04:00` |
| sha256 this session | **NOT recomputed** (12.5 GiB read would fight the live PPL page cache) |
| sha256 previously recorded | `ac44e20c1783b9105b83246fd8ce59892b47a265b84e1323a8a501929877721a` |
| sha source | `quality/ppl_baseline.json:111` (also `reports/moe-requant-1c.md:5`, `reports/moe-calaqwen-xiaomi.md:15`) |
| size match vs those reports | yes, `13416430592` |

No live process CommandLine references this GGUF (CIM snapshot, this session).

## PC binary (chosen)

Prefer `build-pc/cli/bmoe-cli.exe`: file existed, exclusive-read open succeeded
(not locked). A live PPL process is *executing* this same path; that is not a
share-mode lock. Fallback recorded but not selected.

| field | value |
| --- | --- |
| path | `C:\Users\gualt\Desktop\Kalsa\moe-experiments\build-pc\cli\bmoe-cli.exe` |
| size_bytes | `332800` |
| mtime | `2026-08-09T00:45:30.2751616-04:00` |
| sha256 | `42cd907c38fb223d1b04c7070a0c9a6e3b200e186afc19439189651dcac74f69` |
| `--version` | `0.19.0` |

Sibling DLLs (same directory, hashed this session):

| file | sha256 |
| --- | --- |
| `ggml-base.dll` | `9bca3d9fd317a969838530e6bd4dc37c9fe518bb3ad592bc90e4f837c0e0cb6a` |
| `ggml-cpu.dll` | `c4361f7306eac97f9d281448b60e18791be0b4611e33a1c112fccda24874cdf6` |
| `ggml.dll` | `0784a7115eea344d6967bd8cc6079f38cb9a4a242932bb35a61eaa13ced8eb50` |
| `llama-common.dll` | `f0f0126cb5ce2a1d914c3ffed4d1a23dd45e3eed3c5256418a92004bb2f18aef` |
| `llama.dll` | `6d125662205f870979f24593e6af6ffbdad6bbd975addd7c819b82b5341ebb02` |

## Fallback binary (not chosen)

`results/k4split/bin/bmoe-cli-pc.exe` + DLLs, in case `build-pc` becomes
unreadable later.

| file | size | sha256 |
| --- | ---: | --- |
| `bmoe-cli-pc.exe` | 347136 | `d2672584ddd8ac6453101850c19fde3eedf15df5390e18dad5efb16f2fa477a0` |
| `ggml-base.dll` | 643072 | `c0ed71fde0f1687a3ce559a2dbc19109e2db382b449e8541c74795ac09477b4a` |
| `ggml-cpu.dll` | 894976 | `265b4cd6217bc4ce9439792c3d83ec4aed45c5bff9eaa8f5d58b87c0f275e683` |
| `ggml.dll` | 67072 | `55ecdff50d65f585d311300a2a2a37a4af359e86fd9ef525e7fad39d36730d9b` |
| `llama-common.dll` | 9255936 | `5028afa6b3501bc11242b25988380a6bad405c6619894b5998d0c59c78f588a2` |
| `llama.dll` | 2225152 | `6e9835964b61b9465a7b023c190a6411d105220da62623c808704cfca11c20c7` |

Also present in that dir and **not** used: `bmoe-cli` (108997408 B, Android
ELF, mtime 2026-08-13 02:01:23), `libc++_shared.so`.

`build-pc/cli/bmoe-cli-k4split.exe` (345600 B, mtime 2026-08-13 00:48:10)
exists; not selected (mandate prefers campaign `bmoe-cli.exe` or the k4
`bmoe-cli-pc.exe` pair).

## Prompts

| path | size | sha256 |
| --- | ---: | --- |
| `results/marco_phase1/speed_s23/prompts/p_fact.txt` | 361 | `b5301c32c0bd8aae4cf5c25d667a52eef05b940a459a2e9c82b1b6134cf0dcbd` |
| `results/marco_phase1/speed_s23/prompts/p_creative.txt` | 268 | `761db0d07cbc312acb35fb8c64894be83f38a3a7f0ba14e2100ef6a44a29c871` |
| `results/selfspec_f0/prompts/p_longfact.txt` | 1202 | `24694e05189a25581384e9ab3dd6e80e92bdacf728a1a33c2a5e5f4cd3524f37` |
| `results/selfspec_f0/prompts/p_code.txt` | 1628 | `fc9467a37f595de422ec3255a4b0bb48586da741a0fad0d207a66a35569dbaa8` |
