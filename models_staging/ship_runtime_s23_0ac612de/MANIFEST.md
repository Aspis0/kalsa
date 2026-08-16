# Ship-claim runtime archive — campaign ELF `0ac612de` + its shared libraries

Pulled from the Galaxy S23 (`u0_a344@192.168.1.152:8022`,
`~/bin/mellum2/`) on **2026-08-16 06:16**, owner-authorized, read-only.
Verified with `sha256sum -c DEVICE.sha256`: **7/7 OK**, bit-identical to the
device.

## Why this exists

`reports/moe-kernel-ship-ab-s23.md` (W=0, p=0.000488, −42.7% median wall) was
measured on this exact binary. The ship cell deliberately never pushed a binary
(`push_and_start_s23.ps1`: *"Never writes the campaign binary"*) — correct
discipline for the experiment, but it meant the claim's runtime existed **only
on that phone**, and no build in the tree matches its sha (all 12 Android
`bmoe-cli` binaries were hashed on 2026-08-16; none match). Wiping the S23 would
have made a pre-registered, published result impossible to reproduce
bit-for-bit.

## Contents

| file | sha256 | bytes |
|---|---|---|
| bmoe-cli | `0ac612def6b82586d695bfb11acf42cce23bd99fc4ccd3aeddb51a0cd15cf93c` | 6 362 168 |
| libllama-common.so | `09d54baac36407f2c1197f8f65bba32a5c84f8ed2c381dc2bfc914838f2d86c1` | 78 405 896 |
| libllama.so | `4d505d3c403a60c0f617fe52512cbc5be38b31e314e571b31c5548e4ecda7288` | 40 605 088 |
| libggml-base.so | `cfed1b4e511511a28ca4f6bc9d3976976ff2fcf67f22919a875d9454a39b0dc1` | 6 604 920 |
| libggml-cpu.so | `b164d48a955329964a08248d1c2a26576c3b654eda17b6727d396fd5de901052` | 5 006 968 |
| libggml.so | `af29c01eeafcba1bb981bb336ea9f231e62fafdb0203fa9884f776b7f06a1939` | 630 048 |
| libc++_shared.so | `e69496a4aeb51ebe61d0775ae9fefc76eee640f12317aa5174da67e5d4ec8fd6` | 1 794 776 |

The ELF is dynamically linked (`readelf -d`: NEEDED libllama-common, libllama,
libggml, libggml-cpu, libggml-base + platform libs), so **the whole set is the
pin** — the binary alone does not reproduce anything.

The second pinned path on the device, `~/bin/bmoe-cli-mellum2`
(`d32e04e1731c060669a195224e2d0d929f1cb220bbe3dd129eef9e7059782855`), is the
harness's other pin and was verified unchanged at pull time; it is not part of
this runtime and was not copied.

## Storage policy

Binaries are **not committed** (139 MB). This manifest and `DEVICE.sha256` are
the tracked record. After the Xiaomi replication stages this same runtime, three
independent copies exist (S23, this PC, Xiaomi) — enough redundancy without
permanently inflating the repo. If the owner wants a fourth, durable copy, the
right home is a release asset or LFS, not the tree.
