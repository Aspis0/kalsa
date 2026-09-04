# PREREG — Cell #59: do the v73 NPU deaths replicate on reference hardware? (HDK8550)

Date: 2026-09-03 night, owner full delegation; option 1 of the NPU pair
("replica morti v73"), orchestrator-recommended and owner-endorsed. S23 and
Jelly are LOST until ~13/09 — QDC reference hw is the only lane.

## Question

On the HDK8550 (Snapdragon 8 Gen 2, Hexagon HTP **v73** — the S23's NPU
arch), does the experts-on-NPU lane die the way the S23 died? The S23 record
(results/htp_probe/s23_v73_olmoe_q40, cells of 24/08): OLMoE all-Q4_0 with
experts on HTP0 dispatches (48 MUL_MAT_ID execute-ops seen) then dies
rc=134 — at pp16/tg8 with HOSTBUF unset AND with GGML_HEXAGON_HOSTBUF=1
(q48 confound-closer: the HOSTBUF variable is ALREADY exonerated on-device;
ALIVE §8's "clean retry queued" note is stale and this prereg supersedes
it), with `dspqueue_read 0x2e` as the characterized load-death signature
(pp512/decode, tombstone_08). Policy F6 (owner 24/08): experts-on-NPU is
v75-class-only. If reference hardware reproduces the death → F6 stands
arch-bound and upstream dossier #8 gains a QDC-reproducible case. If it
survives → the S23 evidence becomes device-bound-or-build-bound (grid G3).

## Declared confound (BINDING — written before the session)

The kit binary is NOT the S23-era build (kalsahtp @3f545bec, sha 5db18906…,
not archived on this Mac). Kit v6 is built from kalsa/npu-judge-v79, which
carries post-pin hexagon changes, including upstream #25968 "check tensor
type when reusing descriptors" and HMX-eligibility gating — changes that
could plausibly FIX a dspqueue death. Therefore:
- A DEATH here is the strong result (newer build + reference device + still
  dies = arch/stack-bound, F6 confirmed).
- SURVIVAL here is AMBIGUOUS between (i) S23-device-bound and (ii) fixed by
  post-pin commits; the discriminating follow-up (rebuild at the S23-era
  base) is queued, not run, and no policy change is inferred from survival
  alone.

## Arms (in order; each behind the #38 thermal gate; all with
GGML_HEXAGON_NDEV=1 GGML_HEXAGON_VERBOSE=1, ADSP/CDSP_LIBRARY_PATH=$D/lib-fix,
LD_LIBRARY_PATH=$D/lib-fix, logcat ring captured per arm, tombstones pulled)

Invocation template = the S23 manifest's, verbatim where possible:
`llama-bench -m olmoe.gguf -p 16 -n 8 -r 1 --no-warmup -ngl 99 -dev HTP0 -v
-o jsonl --load-mode none -fa on --ubatch-size 1024`

- A1 `exp_pp16_nohostbuf` (cap 900 s): template as-is, HOSTBUF unset — the
  original S23 death config.
- A2 `exp_pp16_hostbuf1` (cap 900 s): template + GGML_HEXAGON_HOSTBUF=1 and
  `--no-host 1` — the q48 mirror config.
- A3 `exp_pp512_nohostbuf` (cap 1500 s): template with `-p 512 -n 0`,
  HOSTBUF unset — the load-death config. Runs ONLY if A1 exits 0.
  Declared fallback (audit F3, mirrors the S23 bprime driver): if `-n 0`
  is rejected or yields no output, retry once with `-n 1`; the retry is
  the arm, recorded as such. Same fallback applies to A4.
- A4 `exp_pp512_hostbuf1` (cap 1500 s): as A3 with the A2 env. Runs ONLY if
  A2 exits 0.
- A5 `exp_tg128` (cap 1500 s): template with `-p 0 -n 128`, HOSTBUF unset.
  Runs ONLY if A3 exits 0. (Decode was the other S23 death surface.)

"Dies" = non-zero exit (134/abort) or a dspqueue/fastrpc fatal in stderr/
logcat. "Survives" = exit 0 with HTP execute-op proof in -v stderr
(n_exps_htp0 > 0 — without the proof a green run is a silent CPU fallback
and the arm is METHOD-VOID, not a survival).

## Binding interpretation grid

- G1 (REPLICATED): A1 and A2 both die at pp16 with a dspqueue/fastrpc
  signature (grep `dspqueue` — read AND write variants, audit F2 — plus
  `0x2e` / `fastrpc` in stderr+logcat+tombstone; record verbatim whatever
  appears) → the v73 death is
  arch/stack-bound on reference hw. F6 CONFIRMED; dossier #8 upgraded with
  the QDC repro. Signature `0x2e` matching exactly is recorded but NOT
  required for G1 — same family (dspqueue/fastrpc fatal during expert
  dispatch) suffices; a different family goes to G4 instead.
- G2 (REPLICATED-AT-LOAD): A1/A2 exit 0 with proof but A3/A4 die with the
  dspqueue/fastrpc family → replicated with a threshold shift (S23 died at
  pp16, HDK at pp512); same conclusion as G1, threshold difference banked.
- G3 (NOT REPLICATED): A1-A4 all exit 0 with HTP proof → the death does not
  reproduce on reference v73 with this build. Per the declared confound this
  is AMBIGUOUS (device-bound vs build-fixed); banked as an owner question
  plus the queued discriminating rebuild. NO policy change.
- G4 (DIFFERENT DEATH): any arm dies with a signature outside the
  dspqueue/fastrpc family (e.g. qurt_exit, OOM, driver reject) → banked as
  a NEW finding; "S23 death not replicated as such"; no F6 inference.
- Mixed HOSTBUF outcomes (A1 dies, A2 survives, or vice versa) → the S23
  HOSTBUF-exoneration does NOT transfer to HDK; banked as its own finding,
  no G1/G3 claim.

## Fixed materials

- Kit: `~/kalsa-qdc/npu-v79-cell/kit-v6/` re-tarred as `npu-kit-59.tgz`
  (sha recorded in MODEL_SHA.txt at lock); llama-bench ELF + lib-fix/ incl.
  libggml-htp-v73.so; SHA256SUMS (45 entries) verified on-device.
- Model: `~/kalsa-qdc/models/OLMoE-1B-7B-0924-Instruct-Q4_0.gguf` from
  allenai/OLMoE-1B-7B-0924-Instruct-GGUF, sha256
  `361e8d83f0820e50d0ed1a13b10586ed9f476d99dcaf6aafd14f07e11840b22b`,
  3 928 037 856 B. **PRE-RUN AMENDMENT (before any session was opened):**
  the plan said "byte-identical to the S23 q55 artifact (43379486…)" — that
  turned out unobtainable: the q55 gguf was an in-house quant; no HF repo
  hosts that sha (allenai/bartowski/QuantFactory/l3utterfly/Meshwa LFS oids
  all checked and differ; Lenovo full-disk search still negative). The
  allenai official has the IDENTICAL byte size and must pass a Mac-side
  tensor census gate before push: same type census as the S23 artifact
  (113 Q4_0 / 81 F32 / 1 Q6_K, the #48 fingerprint) or the cell does not
  launch. Rationale for validity: the death mechanism under test is DSP
  queue/dispatch behavior driven by tensor types/shapes, not weight values;
  the weight-content difference is declared as a residual confound (weaker
  than the build confound above). On-device sha must match 361e8d83…
  (mismatch = METHOD-VOID).
- Device class: HDK8550 (8 Gen 2 free pool, ~976 min). One session, booked
  45 min, expected ~20-25 min billed (model push ~2 min on QDC's link).
- Ops: all #52 lessons (T4 launch, adbT perl-alarm caps, re-entrant arms,
  bracketed pkill, portal ref-clicks + verified End). Thermal gate #38
  before every arm; the HDK ran hot in #53 — retries expected.

## Non-goals

No v75/v79 arms, no PPL (the B′ `dspqueue_write 0x1` death needs the B′
trunk model — separate cell), no perf claims (any t/s recorded is
incidental), no upstream filing tonight (dossier update only).
