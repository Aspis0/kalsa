# q53 — v73 NPU correctness gate on S23 (trunk-NPU lane) (PREREG)

**Status: LOCKED at commit time (see git log for this file). Measurements may
start only after this file is committed.** Owner: "procedi" 2026-08-24.

Context: every v73 NPU lane so far is verified as "fast + generates plausible
text" but NEVER as *correct* (no PPL HTP-vs-CPU at identical weights). The
Adreno campaign taught us garbage kernels show up as PPL explosions (10^5×),
not subtle drift — this gate exists to rule that class out before any engine
router codifies the lane.

Constraint discovered in q46: Marco-B′ (6.5 GiB) dies in `load_all_data` on
the S23 HTP path; the only KEXP-class model that fits the v73 trunk-NPU lane
is **LFM-B′** (3.6 GiB). Marco-B′-on-NPU correctness waits for the Xiaomi
window. This cell certifies the LANE, not Marco.

## Device / hygiene

S23 (v73), serial `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp`. NOT a speed
cell: plugged is ALLOWED and must be declared; no t/s may be shipped from this
cell. Cool-start ≤ 35 °C recorded. /data is ~96 % full: **no new model pushes**
— the cell uses only files already on device. Scripts LF-only, pushed via scp/
adb with `sed 's/\r$//'` guard; adb from Git-bash with `MSYS_NO_PATHCONV=1`;
runs launched from `adb shell` (cores 0-7), never Termux. On-device sha256sum
must match PC hashlib before first run. Record `/proc/<binary-pid>/cpuset`
for every measured run.

## Arms (same gguf, same binary, only offload differs)

Model: `LFM2.5-8B-A1B-KEXP-fromsrc-trunk-q8_0.gguf`, 3,580,407,296 B, sha256
`38a93d7120ef217effba39e4490d341ce02a0ed04fef899d65b03c1322a1b13a` (already on
device, q46). kalsahtp v73 pins unchanged from q46 (stub `5db18906…`, hexagon
`f06aa309…`, htp-v73 `c8f9d14a…`); env `NDEV=1`, `HOSTBUF` unset.

| arm | offload | proof required |
|---|---|---|
| HTP | `-ngl 99 -dev HTP0` | ≥1 `HTP0 execute-op MUL_MAT\|blk.*.attn_*` line in a `-v` probe (trunk really on NPU) |
| CPU-ref | `-ngl 0` (same HTP-linked binary; q46 precedent — HTP session opens but `n_gpu_layers=0` is the offload proof) | log shows 0 offloaded layers |

## Measurement

**Primary: perplexity, HTP vs CPU-ref, identical corpus and parameters.**

- Tool: the kalsahtp build's `llama-perplexity`. If the binary is absent on
  device, build it from the SAME pinned kalsahtp commit with the same flags
  (record binary sha256, PC and device); no other deviation allowed.
- Corpus: the q43 wiki corpus file (same file used for the q41/q43 PPL runs);
  its sha256 must match the value recorded in the q43 artifacts and be
  re-recorded in this cell's manifest. First **32 chunks** at `-c 2048` (~64k
  text tokens is unnecessary; 32 chunks bounds device time at both arms'
  prefill speeds). Same chunk count both arms.
- Both arms run on the DEVICE (no cross-machine primary comparison). Optional
  recorded-only extra: same-gguf PPL on PC CPU as a sanity echo (not a gate).

**Secondary (recorded, not gated): 5 fixed prompts** (first 5 of q49
`prompts.json`, cats permitting, temp 0, n 128) generated on both arms, saved
verbatim — evidence for the report, no judgment in this cell.

## Gate (frozen)

Let `r = PPL_HTP / PPL_CPUref − 1` over the same 32 chunks.

- **PASS** iff `r ≤ 0.02` (HTP within +2 % of CPU; better-than-CPU passes).
- **FAIL** iff `r > 0.05`, or either arm NaN/inf, or the HTP arm loses the
  execute-op proof (lane silently fell back to CPU → cell VOID, not PASS).
- **GREY** iff `0.02 < r ≤ 0.05`: record, no lane certification, escalate to
  owner (numerics vs defect is then a product question).

## Lane 2 (conditional, same gates): dense/hybrid on v73

ONLY IF an NPU-compatible dense/hybrid gguf is ALREADY on the device (no new
pushes): same PPL HTP-vs-CPU protocol, same gate arithmetic, reported as a
separate row. If no such gguf is on device, SKIP and record the skip — do not
free space, do not push.

## Consequence

- PASS → the v73 trunk-NPU lane is certified correct; the engine router (q54)
  may include it. The 4.82× experts lane (v75) remains UNCERTIFIED until the
  Xiaomi window.
- FAIL → lane quarantined in ALIVE; router excludes NPU on v73 entirely.

## Outputs

`scratchpad/agents/q53-v73-npu-correctness/`: `RUN_LOG.md` (timestamps: lock
before first run; battery/temp/plugged declarations), `manifest.json` (all
shas, pins, cpuset, chunk count), raw PPL logs per arm, `gen/` for the 5
prompts × 2 arms, `REPORT.md` (numbers only, no adjectives).
