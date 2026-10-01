# Diagnosis — in-app HTP prefill hangs forever in `dspqueue` RESP wait (Galaxy S23, APK aea90427)

Date: 2026-10-01 (written 2026-09-30 night). Read-only code diagnosis; no device, no adb, no builds.
Trees inspected: binding pin `~/Projects/llama.rn-kalsa-gov-platform` @ c8471449 (vendored engine =
kalsallama **d07d0181b** — what the aea90427 APK builds its host backend from), engine main
`~/Projects/kalsallama` (read-only; e3c43a9db = upstream b11304 merge, under audit), Hexagon SDK
6.4.0.2 at `~/.hexagon-sdk/6.4.0.2`, `qualcomm/fastrpc` (public source of the on-device
`libcdsprpc.so` dspqueue code). Evidence: `s23-onecopy-abba-df538c50c/REPORT.md` Part 2 +
`raw/bug-dspqueue-*.txt`, `qdc-8g2-npu-upstream-62/raw/logcat_up_ngl99_sa803054.txt` (a WORKING
CLI run's logcat, the control group), `app-ci-hexagon-recon/{REPORT,AUDIT}.md`,
`s23-npu-lane-c26ba8bc/DIAGNOSIS.md`.

## Verdict table

| # | Hypothesis | Verdict |
|---|---|---|
| H1 | Unsigned-PD: dspqueue `method 3` unavailable in an app (unsigned PD), response signal never fires | **REFUTED** (the identical error appears verbatim in a working CLI run) |
| H2 | Host↔skel protocol skew: APK ships pre-`b10920` DSP skel, host backend is post-restructure | **CONFIRMED** — root cause of the hang |
| H3 | Wrong domain/session after `FASTRPC_GET_URI` 0x14 fallback | **REFUTED** (working CLI uses the same `_session=0` fallback URI) |
| H4 | App mlock failures | **REFUTED** (best-effort host page locking, `src/llama-mmap.cpp:719`; unrelated to the DSP response path) |
| H5 | Skel/stub version skew (general form of H2) | **CONFIRMED as H2**, pinned to upstream commit `eafe15a5e` |

## 1. Root cause (H2 CONFIRMED, mechanism complete)

**The APK pairs a host backend that speaks the NEW opbatch wire protocol (vendored engine
d07d0181b, which contains upstream `eafe15a5e`) with a DSP skel built from the binding's old
`cpp/ggml-hexagon` snapshot, which predates that commit and still speaks the OLD protocol.**
Control-plane RPCs are unaffected (`htp/htp_iface.idl` is byte-identical old vs new), which is why
session open, `hwinfo`, QoS, queue create and `htp_iface_start` all succeed and the hang only
fires on the **first data-plane batch**.

### 1.1 The two protocol generations

Upstream `eafe15a5e` — *"hexagon: support for multi-device model split (aka row-split)
(#28589)"*, 2026-09-11, contained in upstream tags `b10920+`, **is an ancestor of the vendored pin
d07d0181b** (`git merge-base --is-ancestor eafe15a5e d07d0181b` → true) — restructured the
dspqueue wire format (`ggml/src/ggml-hexagon/htp/htp-ops.h`):

Old (binding's `cpp/ggml-hexagon` at its last content state, synced to **b10829** in 95c69e87,
"feat: sync llama.cpp to b10829 (#388)"; verified `git show 95c69e87:cpp/ggml-hexagon/htp/htp-ops.h`):

```c
struct htp_opbatch_req {
    uint32_t id;          // Batch id
    uint32_t n_bufs; ...
    uint32_t pad;         // unused
    uint64_t seq;         // Sequence number        -> sizeof(req) = 32
};
struct htp_opbatch_rsp {
    uint32_t id;  uint32_t status; ... uint64_t cycles_start; uint64_t cycles_stop; uint64_t seq;
};                                                                  -> different sizeof(rsp)
```

New (vendored `vendor/llama.cpp/ggml/src/ggml-hexagon/htp/htp-ops.h:219-243` at d07d0181b):

```c
struct htp_opbatch_req {
    uint64_t seq;         // Sequence number
    uint32_t n_bufs; ...
};                                                              -> sizeof(req) = 24
struct htp_opbatch_rsp {
    uint64_t seq;  uint64_t cycles_start; uint64_t cycles_stop; uint32_t status; ...
};
```

The same commit family also changed: op enum insertions mid-list (`HTP_OP_UNARY_RELU`,
`HTP_OP_CPY_FENCE`, `HTP_OP_LEAKY_RELU`, `HTP_OP_MDEV_GROUP` — every later op code shifts), the
fence representation (new `htp/htp-fence.h`, seq+status records in 128-byte slots,
`HTP_FENCE_SLOT_SIZE`, vs the old single `atomic_uint`), and new DSP ops (`op_mdev_group`,
`op_fence` mode 1). The public interface `htp/htp_iface.idl` is IDENTICAL old↔new (diff empty) —
that is exactly why nothing fails at init.

### 1.2 What the APK actually ships

- Host: built in CI from the vendored engine pin d07d0181b (new protocol). The app pin aea90427 =
  binding c8471449; `vendor/VERSIONS`: `LLAMA_CPP_COMMIT=d07d0181b…`.
- DSP skels: `bin/arm64-v8a/libggml-htp-v{73,75,79,81}.so`, committed once in 130cc023
  ("build: track lib/, bin/…", 2026-09-17) from the old npm tarball, **never rebuilt since**
  (`git log --follow bin/arm64-v8a/libggml-htp-v73.so` → only 130cc023). sha256 v73 =
  `f81f95e9502e5ffec783e55c1c3994b1857f394c88605a6fc146a66ac2e2f1c7`. Embedded build fingerprint:
  source paths `/home/runner/work/llama.rn/llama.rn/cpp/ggml-hexagon/htp/main.c`, linked with
  Hexagon SDK **6.4.0.2** / Clang 19.0.04 — i.e. a GitHub Actions build of the binding's OWN
  `cpp/ggml-hexagon` copy (removed 13 commits later in 3ce48142, "refactor: vendor sync instead of
  submodule + no copy"). The CI recon already recorded the plan to "retain the current
  `bin/arm64-v8a/libggml-htp-*.so` assets; rebuilding four DSP skels is unnecessary"
  (app-ci-hexagon-recon REPORT §6) — that retention is what froze the old protocol into every APK.
- Both Hexagon APKs (c26ba8bc 2026-09-30 15:10 and aea90427 2026-09-30 18:35) contain this same
  skel and a post-restructure host, so both carry the skew. c26ba8bc never reached a batch: its
  failure was the earlier `cache_v_l2` SET_ROWS placement abort during graph *reserve*
  (s23-npu-lane-c26ba8bc/DIAGNOSIS.md §2) — fixed by 17446ac4 (`no_kv_offload = true`,
  `cpp/rn-llama.cpp:129`). aea90427 is the first build where an HTP batch was ever submitted
  in-app, and the hang is its result.

### 1.3 Why the response never comes (offset walk)

The old skel's reader, `htp/main.c` `process_opbatch()` (extracted at 3ce48142~1, `/tmp`
scratch copy), decodes the host's 24-byte new-format header with old 32-byte offsets:

| field | old offset reads (from new host's packet) | value |
|---|---|---|
| `id` | bytes 0-3 (low half of `seq`=1) | 1 |
| `n_bufs` | bytes 4-7 (high half of `seq`) | **0** |
| `n_tensors` | bytes 8-11 (host `n_bufs`) | 1 |
| `n_ops` | bytes 12-15 (host `n_tensors`) | the graph's tensor count (hundreds) |
| `n_traces` | bytes 16-19 (host `n_ops`) | the graph's op count |

It then computes `b+t+o+p+tr_size` from those garbage counts — `tr_size =
(HTP_MAX_NTHREADS+1) * req->n_traces * sizeof(htp_trace_desc)` with `n_traces` = the op count, and
`o_size`/`p_size` scaled by the tensor count — and hits:

```c
if (dbuf->size < b_size + t_size + o_size + p_size + tr_size) {
    FARF(ERROR, "invalid opbatch memory block size %u (req %u)", ...);
    return;                                   // <-- NO RESPONSE PACKET IS EVER WRITTEN
}
```

The only `dspqueue_write` of the response sits at the END of `process_opbatch`
(old `main.c:1143-1160`); the early `return` at `:1055-1057` skips it. The DSP worker's read loop
(`htp_main_thread` → `process_ops`, `main.c:1172+`) simply waits for the next packet. From the
host's perspective the batch was accepted (`dspqueue_write` succeeded — a write failure would have
`GGML_ABORT`ed at `ggml-hexagon.cpp:3311-3313`), `htp_iface_start` returned success, control calls
keep working — and the response sequence number never advances. Exactly the observed state.

(Even if the size check had passed, the rsp would be old-format 8 bytes larger, and the host's
sanity check `rsp_size != sizeof(rsp)` at `ggml-hexagon.cpp:3246-3248` would ABORT instead — a
distinguishable but equally broken outcome. The observed "no rsp at all" is the size-check drop.)

### 1.4 H1 REFUTED — the 0x80000414 / method-3 error is benign, proven by the control run

Error decode (Hexagon SDK 6.4.0.2, `incs/stddef/AEEStdErr.h`): `#define AEE_EOFFSET 0x80000400`
(`__hexagon__` branch, line 38) and `#define AEE_EUNSUPPORTED (AEE_EOFFSET + 0x014)` (line 68) →
`0x80000414` = **AEE_EUNSUPPORTED returned by the DSP side**. The host-side URI failure `error
0x14` is the same code with the non-Hexagon `AEE_EOFFSET = 0x00000000` (line 40). `sc 0x3010100`
decodes per `incs/remote.h:87-96` as method 3, 1 in-buffer, 1 out-buffer, 0 scalars — shape of the
public IDL's `is_imported`/`create_queue` stubs (`qualcomm/fastrpc` `idl/dspqueue_rpc.idl`,
`src/dspqueue/dspqueue_rpc_stub.c:472-493`). Whichever of the two it is in the device's proprietary
numbering, the decisive fact is parity:

```
WORKING CLI run (llama-bench, thousands of HTP ops complete; qdc-8g2-npu-upstream-62 logcat 09-04):
  fastrpc_apps_user.c:1513: Error 0x80000414: remote_handle64_invoke failed for handle …,
      method 3 on domain 3 (sc 0x3010100) (errno Success)
  dspqueue_cpu.c:624: dspqueue_create: created Queue 0, 0x…, DSP 0x00000000 for domain 3

HANGING APP run (bug-dspqueue-repro-npua1.txt):
  fastrpc_apps_user.c:1382: Error 0x80000414: remote_handle64_invoke failed for handle …,
      method 3 on domain 3 (sc 0x3010100) (errno Success)
  dspqueue_cpu.c:593: dspqueue_create: created Queue 0, 0x…, DSP 0x00000000 for domain 3
```

Identical pair (only the vendor lib's line numbers differ between lib builds). This error is the
EXPECTED response of the queue-create version probe — `qualcomm/fastrpc/src/dspqueue/dspqueue_cpu.c`
explicitly probes `create_queue` with `header->version = UINT32_MAX` and treats
`AEE_EUNSUPPORTED`/`DSP_AEE_EOFFSET + AEE_EUNSUPPORTED` as the success path
(": First attempt to create the queue with an invalid version…"), and `DSP 0x00000000` prints
normally. `fastrpc_apps_user.c:1382` logs *every* failed invoke at ERROR regardless of whether the
caller treats it as expected. There is no unsigned-PD privilege story here: ggml-hexagon itself
sets `remote_session_control(DSPRPC_CONTROL_UNSIGNED_MODULE, enable=1)` on every path
(`ggml-hexagon.cpp:3737-3747`, constructor — would have thrown and aborted the load had it
failed), so CLI and app both run unsigned PDs; the CLI simply proves an unsigned PD runs dspqueue
fine on this device. In-app the FastRPC file service also resolved and loaded both skels
(`apps_std_imp.c:1002 Successfully opened file libggml-htp-v73.so`, `remote_handle64_open …
libdspqueue_rpc_skel.so`, bug-dspqueue-load-window.txt:2-7).

### 1.5 H3, H4 REFUTED

- H3: the working CLI opens the same single-session fallback URI — `remote_handle64_open …
  file:///libggml-htp-v73.so?htp_iface_skel_handle_invoke&_modver=1.0&_dom=cdsp&_session=0`
  (qdc logcat, 09-04 05:45:29.118) — identical to the app's fallback
  (`ggml-hexagon.cpp:3763-3770`; app quote in bug-dspqueue-load-window.txt:6). `0x14` =
  AEE_EUNSUPPORTED for `FASTRPC_GET_URI` is therefore device-lib behavior, not an app-side fault.
- H4: `warning: failed to mlock …` is `src/llama-mmap.cpp:719` — best-effort `mlock` of the
  host-mapped model under `RLIMIT_MEMLOCK`; the load proceeds without locking and the same code
  runs in the PASSING lane-off run. No connection to the DSP queue path.

## 2. Why there is no recovery, and where the fix goes (Q2)

### 2.1 The unbounded wait

`ggml-hexagon.cpp` (vendored pin d07d0181b), `ggml_hexagon_session::flush_pending()`:

```cpp
3225:    while (this->batch_rsp_seq < this->batch_req_seq) {
3234:        const uint32_t timeo = opt_oppoll ? 0 : DSPQUEUE_TIMEOUT;   // 1 000 000 us
3236:        int err = dspqueue_read(this->queue, &flags, 1, &n_dbufs, &dbuf, …, timeo);
3237:        if (err == AEE_EEXPIRED || err == AEE_EWOULDBLOCK) {
3238:            continue;                                               // <-- forever
3239:        }
3241:        if (err != 0) {
3242:            GGML_ABORT("ggml-hex: dspqueue_read failed: 0x%08x\n", …);
```

`DSPQUEUE_TIMEOUT = 1000000` µs (`htp-drv.h:88`; `DSPQUEUE_TIMEOUT_NONE` under `_WIN32` at :86),
which is exactly the observed ~1.02 s period. On the host (non-`__hexagon__`) `AEE_EOFFSET = 0`
(`AEEStdErr.h:40`), so timeout = `AEE_EEXPIRED (AEE_EOFFSET + 0x00C)` = **0xC** — the logged
`error 0xc` at `dspqueue_cpu.c:963/1014/1779` is the vendor lib's own VERIFY chain timing out once
per `dspqueue_read` and returning 0xC to ggml-hexagon, which swallows it and re-enters. Nothing on
the host ever gives up: no deadline, no cancellation, no error path; the caller
`ggml_backend_hexagon_synchronize` (`:5958-5966`) only ABORTs if a *response* carried
`last_error`, which never arrives. The event path is identical (`ggml_hexagon_event_synchronize`,
`:6330-6348`). Upstream `e3c43a9db` (b11304) has the same loop at `ggml-hexagon.cpp:3575-3580` —
this is upstream behavior, not a fork defect.

The load never aborts because nothing in the hang path aborts; it never completes because
`batch_rsp_seq` can never advance (§1.3). The `mqt_v_native` thread spins in this loop at 1 Hz;
the measured ~85 % of one core (REPORT Part 2) is more than a 1 Hz blocking loop should cost —
flagged as a secondary anomaly (likely vendor-lib behavior inside `dspsignal_wait`/the fastrpc
notifier); it does not change the diagnosis or the fix.

### 2.2 Where a bounded wait + error surface goes (engine)

In `flush_pending` (both the vendored pin and kalsallama main):

1. Keep a monotonic deadline for the whole `while` loop (e.g. `GGML_HEXAGON_FLUSH_TIMEOUT`,
   tens of seconds, optionally an env knob next to `GGML_HEXAGON_OPPOLL`).
2. On deadline: set `this->last_error = HTP_STATUS_INTERNAL_ERR` (new dedicated
   `HTP_STATUS_TIMEOUT = 6+` in `htp/htp-ops.h:9-13` is cleaner), `break`.
3. `ggml_backend_hexagon_synchronize` (`:5958-5966`) and
   `ggml_hexagon_event_synchronize` (`:6330-6348`): replace `GGML_ABORT` with a returned failure
   so `graph_compute` reports `ggml_status` failure up through the scheduler instead of killing
   the process (the current abort path is what produced the previous session's exit-134
   `synchronize failed : dsp-error`).

### 2.3 How the governor/binding sees it (plumbing already exists)

- Native runtime: `owner.governor_npu_fallback` is already a field the JSI layer publishes
  (`cpp/jsi/RNLlamaJSI.cpp:901-925`, `npu_fallback` property).
- Init/load-time degrade: Java sets `KALSA_HTP_FALLBACK=<reason>` (`RNLlama.java`
  `noteHtpFallback`, :129-139; cleared on success :178-182), the native resolver reads it at
  `cpp/rn-llama.cpp:113` and `decide_governor_prefill_device` (`cpp/rn-governor-params.cpp:175-191`)
  turns a non-empty reason into `plan.npu_fallback` + lane-to-GPU degrade.
- App: plan-level `npu_fallback` logs via `KALSA_GOVERNOR_PLAN`; the resolved fallback arrives on
  `KALSA_GOVERNOR` (LlamaService.ts:1787, per AUDIT-app-aea90427.md §"Dead code" note).

So the minimal runtime wiring is: on a (new) graph-compute failure with `last_error` set, the
binding's completion/load error handler sets `owner.governor_npu_fallback` (and/or
`setenv("KALSA_HTP_FALLBACK", "htp-runtime-timeout")`) so the **next** load degrades to the GPU
route; the current turn fails with a visible error instead of hanging. No new plumbing concepts
are needed — only the engine-side bounded wait + non-abort error, and one setter at the binding's
decode/load failure site.

### 2.4 Health-check at init — yes, and it must be a real opbatch roundtrip

`htp_iface_hwinfo` (control plane) provably cannot catch this failure mode — the old skel answers
control calls perfectly (`htp_iface.idl` unchanged; the app logged no hwinfo warning, so it
succeeded). The check that would have caught it is a **one-op batch through the dspqueue
data path with a bounded wait**, i.e. exactly the path that is broken. Placement:

- Engine: new `ggml_backend_hexagon_device_healthcheck(ggml_backend_dev_t dev)` in
  `ggml-hexagon.cpp`, run after the lazy `session()` construction (`:508-520`) — it forces session
  creation at resolver time (fail-fast before any model buffer lands on HTP0): build a 1×1 F32
  unary/fill graph in an HTP0 buffer, `graph_compute` + `synchronize` against the §2.2 deadline,
  return status.
- Binding: call it in `load_governor_models` (`cpp/rn-llama.cpp:105-131`) before
  `decide_governor_prefill_device`; on failure `setenv("KALSA_HTP_FALLBACK",
  "htp-healthcheck", 1)` → the existing §2.3 plumbing degrades the lane to GPU and the plan says
  why.
- Stronger, structural guard: extend `htp_iface.idl` with a version handshake (new
  `htp_iface_protocol(out uint32 ver)`, or a protocol constant passed to `htp_iface_start` and
  verified by the skel) so any future host↔skel skew fails at `start` with a clean error instead
  of a silent data-plane wedge. Requires QAIC regen on the host (the CI already generates the host
  stub from the pinned IDL — c26ba8bc "exact QAIC flags") and rebuilding the skels.

## 3. Upstream state (Q3)

- The wire-protocol break is **upstream `eafe15a5e`** (2026-09-11, PR #28589, in tags b10920+).
  Our vendored pin d07d0181b **contains** it; the binding's old `cpp/ggml-hexagon` snapshot
  (synced to b10829 on 2026-09-13, 95c69e87) predates it. Related earlier change: `192067b72`
  ("multi-NPU devices … fully asynchronous backend", 2026-08-26, #26501, ≤ b11010) added `seq`
  and the async machinery but did NOT flip the req layout.
- Since our 2026-09-16 upstream merge and *after* the pin d07d0181b: `0c3626ec0` "hexagon:
  overhaul of buffer and DMA handling to support 64bit mappings + improvements (#29197)"
  (2026-09-21) is **not** in d07d0181b but **is** in engine main e3c43a9db (b11304 merge,
  2026-09-30, under audit), together with `19e28a277` f16 activation ops, `7fee17846` concat opt,
  `e904318a2` GELU/GEGLU ERF, `7ac59a6e3` tiled Q4_0/Q8_0 GET_ROWS, `2b129ccfa` backend sampler,
  `4de092659` q5_k, `ed319febb` DMA concat, `a02c7f58c` multi-sequence concat, `4e7481175` divide
  tooling (all touching `ggml/src/ggml-hexagon` between d07d0181b..e3c43a9db). Consequence: the
  host↔skel skew window is widening with every engine bump — skels must be built **from the same
  commit as the host, in the same build**, from now on.
- Upstream has NOT changed the unbounded wait: `flush_pending` still `continue`s on
  AEE_EEXPIRED/EWOULDBLOCK at e3c43a9db (`ggml-hexagon.cpp:3575-3580`). No upstream "unsigned PD
  in APK" guidance exists for ggml-hexagon; upstream's own Android CI runs the CLI inside the
  snapdragon docker where host and skels are built from one tree (build-and-test-snapdragon.yml,
  image `ghcr.io/snapdragon-toolchain/arm64-android:v0.7`) — i.e. upstream never ships mismatched
  prebuilt skels, which is why upstream cannot see this bug. Relevant upstream issues:
  #26123 (dspqueue_read 0x2e aborts on 8 Gen 2 — a *returned* error, i.e. the abort path, not our
  silent no-response case; also documents DSP-side session leakage after aborts, error
  0x80000406), #22208 (same on Windows), #27677 (session setup sensitive to `LD_LIBRARY_PATH`
  containing `/vendor/lib64` — a second, independent reason to keep the app's library path
  clean), #19618/#21842 (multi-session/dspqueue_create failures).

## 4. Cheapest device experiment that splits the hypotheses

Skel-swap under the CLI — no app build, no root, reuses the on-device bench from
`/data/local/tmp/govhtp/onecopy-abba/bin` (host = df538c50c = new protocol) and isolates
skel-vs-process with two 30-second runs:

```bash
# Mac: extract the exact skel the APK ships
unzip -j app-release.apk 'assets/ggml-hexagon/libggml-htp-v73.so' -d /tmp/apk-skel
adb -s 192.168.1.152:34673 push /tmp/apk-skel/libggml-htp-v73.so \
    /data/local/tmp/htpskel/apk/libggml-htp-v73.so

# Arm A (prediction: HANGS like the app — new host + old skel):
adb -s 192.168.1.152:34673 shell 'cd /data/local/tmp/govhtp/onecopy-abba/bin && \
  ADSP_LIBRARY_PATH=/data/local/tmp/htpskel/apk GGML_HEXAGON_DEVICES=1 timeout 60 \
  ./llama-bench -m /data/local/tmp/heat3way/ship.gguf -p 32 -n 1 -ub 32 -ngl 1 -dev HTP0 -r 1; echo EXIT=$?'
# Arm B (control, prediction: PASSES — matched docker-built skel):
adb -s 192.168.1.152:34673 shell 'cd /data/local/tmp/govhtp/onecopy-abba/bin && \
  ADSP_LIBRARY_PATH=/data/local/tmp/govhtp/onecopy-abba/dsp GGML_HEXAGON_DEVICES=1 timeout 60 \
  ./llama-bench -m /data/local/tmp/heat3way/ship.gguf -p 32 -n 1 -ub 32 -ngl 1 -dev HTP0 -r 1; echo EXIT=$?'
# Observe (separate window): adb logcat | grep -E "dspqueue_cpu|llama-bench"
# Arm A expected: 1 Hz "error 0xc / wait_signal_locked / DSPQUEUE_SIGNAL_RESP_PACKET" triples, EXIT=124 (timeout)
```

Outcome matrix: A hangs + B passes → H2 confirmed, H1 conclusively dead (same uid, same SELinux
domain, same unsigned PD, only the skel differs). A passes → H2 dead for v73; escalate H1
(process identity) — which then needs a **debuggable** APK and `run-as com.kalsa.app …/llama-bench`
(the release APK is not debuggable, so plain run-as is unavailable today). OptionalArm C: swap
skels across arch dirs (v75 skel on v73 host) as a positive skew control — expected to fail
differently (arch mismatch at load), demonstrating the loader honors ADSP_LIBRARY_PATH.

## 5. Fix plan

**(a) The hang itself — rebuild the skels from the pinned engine, same provenance as the host.**
- Binding `kalsa.rn`: extend the CI hexagon step (the one c26ba8bc gave exact QAIC flags to) to
  also build the DSP skels from `vendor/llama.cpp/ggml/src/ggml-hexagon/htp/` at the SAME pinned
  commit — the repo already has the recipe (`scripts/build-hexagon-htp.sh`, referenced in
  `.github/workflows/ci.yml:184-185` cache key) and upstream proves the one-image approach
  (`ghcr.io/snapdragon-toolchain/arm64-android`). Replace the frozen `bin/arm64-v8a/libggml-htp-*.so`
  with freshly built ones; record engine pin + sha256 of each skel next to them
  (`vendor/VERSIONS`-style manifest) and have `scripts/assert-engine-provenance.sh` verify
  host-pin == skel-pin.
- Add the IDL protocol-version handshake (§2.4) so this class of skew can never silently wedge
  again; regen host stub via QAIC in the same CI step.

**(b) Bounded wait + fallback — engine and binding files:**
- `vendor/llama.cpp/ggml/src/ggml-hexagon/ggml-hexagon.cpp` (and mirror in `~/Projects/kalsallama`
  for the next engine merge):
  - `flush_pending` (:3225-3243 pin / :3570-3588 main): loop deadline → set
    `last_error = HTP_STATUS_TIMEOUT` (new code in `htp/htp-ops.h:9-13`) → `break`.
  - `ggml_backend_hexagon_synchronize` (:5958-5966), `ggml_hexagon_event_synchronize`
    (:6330-6348): return failure instead of `GGML_ABORT`.
  - new `ggml_backend_hexagon_device_healthcheck` + registry export for the binding.
- `kalsa.rn` binding:
  - `cpp/rn-llama.cpp` (`load_governor_models`, :105-131): call the healthcheck before
    `decide_governor_prefill_device`; failure → `KALSA_HTP_FALLBACK="htp-healthcheck"` → existing
    GPU degrade.
  - `cpp/jsi/RNLlamaJSI.cpp` (decode/completion error paths near :901-925): on a graph-compute
    failure with HTP engaged, set `governor_npu_fallback` (+ `KALSA_HTP_FALLBACK` for the next
    load) so `KALSA_GOVERNOR`/`KALSA_GOVERNOR_PLAN` report the degrade.
- App `kalsa`: no code change required — `npu_fallback` already flows (`LlamaService.ts:1787`);
  optionally surface the reason in the model sheet.

Order of operations: rebuild+ship matched skels first (removes the hang); bounded wait second
(removes the class of silent hangs); healthcheck third (converts any residual HTP failure into a
clean lane degrade); version handshake fourth (structural prevention).

## Residual unknowns

- The exact CI run that produced the shipped skel binaries (built from `cpp/ggml-hexagon` at some
  pre-3ce48142 commit; the tree's last content state is the b10829 sync — all candidates predate
  `eafe15a5e`). Binary-level proof of old-format is indirect (GH-runner source paths + the
  never-rebuilt git history); §4 Arm A is the definitive on-device confirmation.
- The ~85 % CPU of the spinning thread vs a 1 Hz blocking loop (§2.1) — not explained by the
  ggml-hexagon code; vendor-lib internals, worth one `simpleperf` capture during the §4 repro if
  it matters for energy numbers.
- The CLI-side `HTP0 dspcall : dsp-rsp INTERNAL-ERROR` at `-p 32 -n 2` on df538c50c
  (onecopy-abba REPORT "Defect candidate") is a separate, matched-protocol CLI bug — unrelated.
