# PREREG — Cell #62: does the CURRENT upstream Hexagon backend survive the v73 mapping death? (HDK8550)

Date: 2026-09-04 (owner full delegation; follow-up of #60, ALIVE row 43). Cell #60 showed the
v73 death is a DSP VA-allocation failure in `mmap_buf()` (main.c:729) after map/unmap churn,
with the two host knobs (MBUF=512, VMEM=1800) NOT saving it in our kit (kalsa/npu-judge-v79
@022458a28, upstream through #25968). Upstream has since merged #26501 (multi-NPU / async
backend overhaul, 2026-08-27) and #28202 (MUL_MAT/MUL_MAT_ID fusion + "op batch buffers sorted
by size to avoid address space fragmentation", 2026-09-02). Cherry-picking them onto our branch
is impossible (conflicts, CHERRYPICK.md in scratchpad/agents/qdc-npu-mmapfix-kit/), so the
instrument is a PURE UPSTREAM kit built from `upstream/master` @64a155d24 ("sync : ggml
(#28379)", branch kalsa/upstream-snapshot-2026-09-04 on Aspis0/kalsallama) with the same
Docker recipe as kit-v6 (kit path and sha recorded at lock in MODEL_SHA.txt).

## Question

On HDK8550 with OLMoE Q4_0 (same model bytes as #59/#60), does upstream's current backend
(a) still die at `-ngl 99` (B0 control), and (b) still die under the two churn configurations
that killed our kit (B2 `MBUF=512`, B5 `VMEM=1800`)? A survival where our kit died isolates
the upstream fix (#28202 size-sorted batching / #26501 mapping changes) as the remedy; a death
with the same FARF chain says the fix is not there yet.

## Arms (HOSTBUF unset; env `GGML_HEXAGON_NDEV=1 GGML_HEXAGON_VERBOSE=1`; `.farf` file =
0x1F; logcat + tombstones per arm; #38 thermal gate; caps 900 s)

Template T = #60's: `./bin/llama-bench -m olmoe.gguf -p 16 -n 8 -r 1 --no-warmup -dev HTP0 -v
-o jsonl --mmap 0 -fa on --ubatch-size 1024` — every flag re-verified in the upstream tree's
tools/llama-bench/llama-bench.cpp before lock (BUILD.md); a missing flag is a pre-run amendment.

- U0 `up_ngl99` (control, the #59/#60 death config): T + `-ngl 99`.
- U2 `up_ngl99_mbuf512`: T + `-ngl 99`, `GGML_HEXAGON_MBUF=512` (if the knob still exists;
  else METHOD-VOID by declaration).
- U5 `up_ngl99_vmem1800`: T + `-ngl 99`, `GGML_HEXAGON_VMEM=1800` (same caveat).
- U1 `up_ngl8`: T + `-ngl 8` (sanity: the survivor of #60 must survive here too; a death here
  = the upstream kit is broken on this device → all arms METHOD-VOID for the question).

Survival = exit 0 with `n_exps_htp0` ≥ 48 (ngl 99) / 24 (ngl 8) counted as in #60 (the -v
proof lines; if upstream renamed the verbose lines, the driver's counters are re-derived
before lock and quoted in BUILD.md). Death = exit ≠ 0 or a dspqueue/fastrpc fatal; the cDSP
crash block + FARF chain identify the site (offset resolved with objdump on THIS skel).

## Binding grid

- H1 (UPSTREAM FIXED): U1 survives, U0 survives AND U2 survives AND U5 survives → the current
  upstream backend maps 3.6 GiB of experts on v73 without dying; our kit's death is fixed
  upstream between #25968 and 64a155d24 (#26501/#28202 the candidates, not separated here).
  Consequence: F6's "3.6 GiB dies" clause is tied to OUR pin; the app engine pin needs a
  hexagon rebase (owner decision), and dossier #8 gets a "fixed upstream as of …" note.
- H2 (PARTIALLY FIXED): U1 survives, U0 dies, but U2 or U5 survives → the fix works only with
  a knob; banked with the knob named; F6 clause stays with the knob as the mitigation.
- H3 (NOT FIXED): U1 survives and U0, U2, U5 all die with the mapping-failure FARF chain
  (`qurt_vtlb_mmap: unable to get virtual address` → `mmap failed : va`) → upstream has not
  fixed it; dossier #8's suggested action stands; F6 clause stands.
- H4 (DIFFERENT DEATH): any arm dies with another signature (TLBMISS, other abort line, host
  error at load) → new finding on the upstream kit; no H1-H3 claim for that arm.
- U1 dies → METHOD-VOID for the whole cell (kit broken here), banked as such.

## Materials / budget / ops

Kit `~/kalsa-qdc/npu-v79-cell/npu-kit-62-upstream.tgz` (sha at lock; SHA256SUMS verified on
device); model `~/kalsa-qdc/models/OLMoE-1B-7B-0924-Instruct-Q4_0.gguf` sha `361e8d83…`;
D=/data/local/tmp/kalsa62; driver = #60's d_run.sh with the arms above (Luna), audited before
the session. HDK8550, booked 30 min, expected ~12 (push 3 min, four ~30 s arms). 8 Gen 2 pool
≈ 935 min. One session; End Session = ref-click End + Yes + reload + "Ended On" within 1 min.

## Non-goals

No perf claims, no v75/v79 arms, no separation of #26501 vs #28202 (a bisect is a later cell),
no app work.

## Lock addendum (before the session; kit sha 1baee516…, MODEL_SHA.txt)

Static facts about the upstream v73 skel (DISASM-upstream.txt, BUILD.md by the kit agent,
verified by the orchestrator on the objdump output): `htp/main.c` @64a155d24 still has the
`#if __HVX_ARCH__ > 73` split (L54/L74) and calls `HAP_mmap@plt` (0x47b0/0x47c0), but
`mmap_buf`/`prep-bufs` no longer abort on the first `-1`: the skel retries after a
"defragmentation" pass and aborts only if that fails too — strings `mmap failed : fd %u size %u`
and `prep-bufs : mmap failed after defragmentation (fd %u size %u)` (abort near L961); the 2 GB
guard abort (L58) remains. Consequences declared now:
- The H3 death signature for the upstream kit is the `after defragmentation` FARF line followed
  by the cDSP crash block (abort in libggml-htp-v73.so; offset resolved on THIS skel with
  DISASM-upstream.txt), not #60's `mmap failed : va FFFFFFFF` :729 line. Either family counts
  as "the mapping death" for H3; a `2GB limit` abort is H4.
- A survival of U0/U2/U5 with `mmap failed : fd` lines present in logcat but no crash means the
  defragmentation path RESCUED the mapping: banked as H1/H2 with "rescued N times" counted from
  the FARF lines (informative).
- llama-bench flags of the #60 template all exist in this tree (BUILD.md lists the source
  lines; `--mmap` is marked deprecated but accepted); env knobs VMEM/MBUF/NDEV/VERBOSE exist
  (ggml-hexagon.cpp:6320-6336). Build note: this tree's preset targets android-34 (kit-v6 was
  android-31); the host build needed one retry (embed_kernel.py step) and then installed cleanly.

## Lock addendum 2 (audit F1/F2/F14/F15, before the session)

- Knob existence (F1): `GGML_HEXAGON_MBUF` and `GGML_HEXAGON_VMEM` are read by the upstream host
  backend at ggml-hexagon.cpp:6335-6336 @64a155d24 (quoted in MODEL_SHA.txt); the kit's
  libggml-hexagon.so is built from that tree. Effect verification, declared now: U2's MBUF=512
  is confirmed post hoc by the host `-v` `mapped buffer … size` lines (all weight buffers ≤ 512
  MiB, ≥ 7 of them, as in #60 B2); if the sizes are ~1 GiB the knob was ignored → U2 is
  METHOD-VOID. U5's VMEM=1800 has no direct host-side print; its effect is only inferable from
  the DSP `fd_mmap_destroy` churn in the adsprpc log (as in #60 B5); if U5 shows no destroys
  before its outcome, the arm is banked as "knob effect unverified", not as a grid input.
- Counters (F2/F14): the .sig line carries `n_exec_any` (all `execute-op` lines regardless of
  device) next to `n_exps_htp0`; if `n_exps_htp0` = 0 while `n_exec_any` > 0 and the arm exited
  0, the verbose format changed and the arm is "survived, proof format changed" — the REPORT
  re-derives the HTP count from the raw lines and quotes the new format; a zero in BOTH with
  exit 0 is a silent CPU fallback → METHOD-VOID.
- BUILD.md (F15) exists at scratchpad/agents/qdc-npu-mmapfix-kit/BUILD.md (kit agent) and the
  flag/knob/abort facts were re-verified by the orchestrator (lock addendum above).
