# Queue item #4 — `cvt.cl` hygiene

## Scope and baseline

- Engine repo: `BigMoeOnEdge/third_party/llama.cpp`
- Branch: `kalsa/kernel-s3-repack`
- Starting head: `7686ca6fc5685c70f95bf60116dd7c8e5dec01c1`
- Remotes: none; no push performed
- Build tree: `C:\Users\gualt\Desktop\Kalsa\moe-experiments\build-android-opencl-s3oracle`
- Required context read from `PLAN.md`, `defectP-fix2-verify/REPORT.md`, and
  `maxrecall-claims/REPORT.md`.

The PLAN records the remaining q4_1/q5_x/q4_K mask-then-shift consumers as
device-proven clean (156 cases; a deviation would have exceeded the threshold
by about 900x). This work is therefore a hygiene/uniformity port; semantic
identity is the gate.

## Commit 1 — `1882bf8cd`

`opencl: fix stale cvt trans4 comments`

Only two comments changed in `ggml/src/ggml-opencl/kernels/cvt.cl`:

1. q4_0 `qs` offset corrected from 4 to 2, matching `struct block_q4_0`.
2. The trans4 variant note now says the kernels use scalar-uint global stores,
   matching the current code instead of describing byte-wise stores.

No code or generated build artifact was changed in this commit.

## Commit 2 — `99ed2cb92`

Six mask-argument q4_K/q5_K/q6_K trans4 convert/restore consumers were
rewritten mechanically in the scalar-uint shift-first form used by q2_K/q3_K.
The host passes `mask_0F=0x0F` and `mask_F0=0xF0` to all six. For every input
byte `x = sum(i=0..7, b_i*2^i)`,

```text
x & 0x0F             = sum(i=0..3, b_i*2^i)
(x << 4) & 0xF0      = sum(i=0..3, b_i*2^(i+4))
(x & 0xF0) >> 4      = sum(i=4..7, b_i*2^(i-4))
(x >> 4) & 0x0F      = sum(i=4..7, b_i*2^(i-4))
```

The first pair proves the low-nibble byte is unchanged; the second pair proves
the high-nibble byte is unchanged. The source byte is widened to `uint` before
the shift and the final `convert_uchar` receives the same 8-bit result.
Applied per data-layout pair:

1. `kernel_convert_block_q4_k_trans4_ns`: each old
   `(x1 & 0x0F) << 4` became `(x1 << 4) & 0xF0`, and each old
   `(x0 & 0xF0) >> 4` became `(x0 >> 4) & 0x0F`; the two q4_K SoA byte
   destinations are unchanged.
2. `kernel_restore_block_q4_k_trans4_ns`: the same two identities apply to
   `hi` while reconstructing each q4_K pair; destination indices are unchanged.
3. `kernel_convert_block_q5_k_trans4_ns`: the same identities apply to each
   `x0,x1` q5_K low/high byte pair; qh, scales, and destinations are untouched.
4. `kernel_restore_block_q5_k_trans4_ns`: the same identities apply to each
   `lo,hi` q5_K pair; qh reconstruction and destination indices are untouched.
5. `kernel_convert_block_q6_k_trans4_ns`: the identities apply independently
   to `(x0,x1)` and `(x2,x3)`; all four q6_K SoA byte destinations are unchanged.
6. `kernel_restore_block_q6_k_trans4_ns`: the identities apply independently
   to `(lo_02,hi_02)` and `(lo_13,hi_13)`; all four ql destination indices are
   unchanged.

No consumer was skipped: each change is the same byte/nibble algebra, with
only the q4/q5/q6 stream indices differing. Commit 2 changes only
`ggml/src/ggml-opencl/kernels/cvt.cl`.

## Build result

The literal requested command was first attempted and could not start because
`ninja` was not on this PowerShell PATH. The existing Android CMake toolchain
contains Ninja at
`C:\Users\gualt\AppData\Local\Android\Sdk\cmake\3.22.1\bin\ninja.exe`.
Running the identical command through that absolute executable passed:

```text
ninja -C C:\Users\gualt\Desktop\Kalsa\moe-experiments\build-android-opencl-s3oracle test-backend-ops ggml-opencl -j 8
=> PASS (20/20 build steps)
```

CMake regenerated the embedded `cvt.cl.h`; `ggml-opencl` and
`test-backend-ops` linked successfully. Warnings were pre-existing/toolchain
warnings only: unused `backend_ctx`, a TODO pragma, and OpenSSL unavailable
for optional HTTPS support. No device work was run.

## Verification

Final engine-repo checks: clean worktree at `99ed2cb92`, branch
`kalsa/kernel-s3-repack`, no remotes, and exactly the two local commits above
after starting head `7686ca6fc`.

No device work is part of this item.
