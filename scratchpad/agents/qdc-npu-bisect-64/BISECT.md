# QDC NPU upstream Hexagon bisect

Range: pure upstream `022458a28..64a155d24`, restricted to commits touching
`ggml/src/ggml-hexagon`. The table is chronological, oldest first, and uses
1-based indices.

Step 0 is not a bisect step: build and test pure upstream `022458a28` as the
good endpoint. The existing kit was produced from a patched worktree, so that
endpoint has not been tested in pure-upstream form.

| index | sha7 | title |
|---:|---|---|
| 1 | `67776ea` | hexagon: improve ARGSORT performance for small tensors (#25512) |
| 2 | `c718542` | hexagon: fix hmx-queue signal enum-narrowing problem (#25677) |
| 3 | `b2dd28a` | hexagon: L2 cache handling rework (dirty bit tracking with lazy flushing) and more MUL_MAT updates (#25762) |
| 4 | `76f46ad` | hexagon: add CLAMP op (#25934) |
| 5 | `71102a7` | hexagon: check tensor type when reusing descriptors (#25968) |
| 6 | `0278d83` | hexagon: activation ops update (#25974) |
| 7 | `c0bc859` | hexagon: fix Windows crash when op_poll is enabled (#26029) |
| 8 | `0a50d99` | hexagon: further improved pipeline of the core bits (L2, DMA, MM, FA) (#26049) |
| 9 | `355303e` | hexagon: partial im2col support (#26007) |
| 10 | `153d324` | llama: add default load-mode auto, which avoids mmap on iGPUs (#26081) |
| 11 | `fe8156f` | ggml: add ggml_rope_set_offset (+ metal support) (#27120) |
| 12 | `990e3bf` | hexagon: fix FA HMX queue ordering and pack the rescale D matrices (#27042) |
| 13 | `749f688` | ggml: support ggml_rope_set_offset on opencl, sycl, wgpu, hexagon (#27345) |
| 14 | `192067b` | hexagon: support for multi-NPU devices (IQ9, IQ10) and fully asynchronous backend (#26501) |
| 15 | `83d855c` | hex-unary: fix RMS_NORM_MUL weight-offset bugs for grouped/broadcast norms (#27798) |
| 16 | `e70802a` | ggml-hexagon: add HTP unary ops for ABS and LOG (#27786) |
| 17 | `57291f2` | ggml: allow passing alloc dependencies in graph_optimize (#27301) |
| 18 | `9e54e68` | hexagon: support for device discovery and create sessions on demand (#27785) |
| 19 | `0190529` | ggml: add SWIGLU_CLAMP (#27930) |
| 20 | `9723942` | hexagon: fix CPY fence bug (#28033) |
| 21 | `69320fe` | hexagon: add missing FARF logs for cpy/get_rows/set_rows/gdn ops (#28217) |
| 22 | `960dffa` | hexagon: MUL_MAT and MUL_MAT_ID fusion and fixes (#28202) |
| 23 | `f027c4f` | ggml-hexagon: add F16 support for unary ops (#28228) |

## Plan

1. Step 0: build/test pure `022458a28` and mark it good if the HDK8550 run
   survives the #62 driver workload.
2. Treat `64a155d24` as the known bad endpoint from QDC cell #62.
3. Bisect the 23 table indices classically, using the first midpoint at index
   12 (`990e3bfee`). For each candidate, build a v73-only kit and run the same
   HDK8550 driver.
4. Continue until the first bad table index is isolated; report that commit as
   the first bad Hexagon commit.

This identifies a first bad Hexagon commit in the tested ordering. It does not
claim that commit is the only cause: the full 844-commit range also contains
potentially relevant non-Hexagon changes, including ggml core changes,
`graph_optimize` (#27301), and `SWIGLU_CLAMP`.

Estimated cost per candidate is approximately 10 minutes for the v73-only
build and 8–10 minutes for the HDK8550 QDC session.
