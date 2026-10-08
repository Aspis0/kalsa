# Audit: HTP voltage-corner knob

Target: 6e06ce5a1 on parent 2d970bdf3. Read-only review. Only allowed test run: standalone host parser test.

## Findings

### P1 — PLAUSIBLE: a stopped session may leave its HAP power client/vote behind

The DCVS request uses the session context as its HAP client. Stop frees that context without an explicit client destroy.

> htp/main.c:393 — return HAP_power_set((void *) ctx, &request);
> htp/main.c:677 — free(ctx);
> htp/main.c:678 — h->ctx = NULL;

The HAP_power.h API contract (public source copy) says at [lines 671–683](https://git.konn3kt.com/IQ.Lvbs/IQ.Pilot/src/commit/ee1dca77c7b5f64c4c19e54c61567a42bb0f8b0e/artifacts/package_sources/tinygrad/extra/dsp/include/HAP_power.h?display=source#L671-L685): “Method to destroy clients created through HAP_power_set”; “context - To uniquely identify the client”; “static inline int HAP_power_destroy(void *client){”. No HAP_power_destroy call appears in htp/. If HAP retains votes until that client is destroyed, a prior MAX leg can remain as a separate client and defeat a later low-corner leg. This is the main campaign no-op risk; lifetime/aggregation was not device-tested.

### P1 — CONFIRMED: failed override does not fail the benchmark

> htp/main.c:727 — return htp_set_dcvs_v3_corners(h->ctx, core_corner, bus_corner);
> ggml-hexagon.cpp:4495 — int perr = htp_iface_power(this->handle, (uint32_t) core_corner, (uint32_t) bus_corner);
> ggml-hexagon.cpp:4496 — GGML_LOG_INFO("ggml-hex: %s lab vcorner request core %d bus %d : 0x%08x\n",

The DSP returns the HAP status, but the host only logs it; no branch aborts or invalidates the run. A rejected corner or old-skel RPC error can leave startup MAX/MAX in effect while the campaign records results.

### P2 — CONFIRMED: validation is a range, not enum membership

> htp-vcorner.h:37-41 — unsigned long v = strtoul(s, &end, 10); / if (end == s || *end != '\0' || v > 255ul) / return (int) v;
> htp/main.c:721-722 — if (core_corner < HAP_DCVS_VCORNER_SVS2 || core_corner > HAP_DCVS_VCORNER_MAX || / bus_corner  < HAP_DCVS_VCORNER_SVS2 || bus_corner  > HAP_DCVS_VCORNER_MAX)

Any interior ordinal through MAX passes the local checks, including enum holes; the exact target HAP header was not installed here, so HAP rejection or clamping is unverified. Qualcomm’s [QNN HTP voltage-corner list](https://docs.qualcomm.com/nav/home/api-rst_file_include_QNN_HTP_QnnHtpPerfInfrastructure_h.html?product=924033590759186372) maps TURBO_L5 (0x95) and MAX (0xA0) to HAP corners, leaving 0x96–0x9F as a concrete gap in that corner list. Separately, host parsing accepts zero but DSP rejects it:

> test-htp-vcorner.c:53 — CHECK_NAME("0",     0);

The test proves parser acceptance, not a valid HAP vote.

### P2 — PLAUSIBLE: mixed host/skel versions fail only on the new lab RPC

> htp/htp_iface.idl:14-21 — existing start/stop/mmap/munmap/profiler/etm/hwinfo declarations end with:
> htp/htp_iface.idl:20 — AEEResult hwinfo(rout uint32 n_threads, rout uint32 n_hvx, rout uint32 n_hmx, rout uint64 vtcm_size);
> htp/htp_iface.idl:21 — AEEResult power(in uint32 core_corner, in uint32 bus_corner);

Appending power should leave existing method ordinals stable: old host + new skel can still use existing methods. New host + old skel lacks the appended slot when LAB/env enables the call. The old-skel dispatch case was not runtime-tested; the host’s nonfatal status handling can contaminate the measurement if it fails.

### P3 — CONFIRMED: the host test does not exercise the DSP contract

> tests/CMakeLists.txt:1 — # Standalone host test for the GGML_HEXAGON_VCORNER parser. Not wired into the
> tests/CMakeLists.txt:2 — # main ggml build; configure and run on the build host:
> tests/CMakeLists.txt:11 — add_test(NAME htp-vcorner COMMAND test-htp-vcorner)

The passing test cannot catch an invalid HAP ordinal, a failed FastRPC call, or a retained HAP client vote.

## Requested angles / non-findings

- **Shipped path: REFUTED (no start-request regression).** Parent request was memset-zeroed and set all the same DCVS v3 fields to MAX/MAX, including the same protected-bus helper. New helper makes the same assignments and its start caller passes MAX/MAX:
  > 2d970bdf3:htp/main.c:498 — memset(&request, 0, sizeof(request));
  > 2d970bdf3:htp/main.c:500 — request.type                              = HAP_power_set_DCVS_v3;
  > 2d970bdf3:htp/main.c:504 — request.dcvs_v3.bus_params.min_corner     = HAP_DCVS_VCORNER_MAX;
  > 2d970bdf3:htp/main.c:508 — request.dcvs_v3.core_params.min_corner    = HAP_DCVS_VCORNER_MAX;
  > 2d970bdf3:htp/main.c:515 — HAP_set_dcvs_v3_protected_bus_corners(&request, 1);
  > htp/main.c:374 — memset(&request, 0, sizeof(request));
  > htp/main.c:376 — request.type                              = HAP_power_set_DCVS_v3;
  > htp/main.c:380 — request.dcvs_v3.bus_params.min_corner     = bus_corner;
  > htp/main.c:384 — request.dcvs_v3.core_params.min_corner    = core_corner;
  > htp/main.c:391 — HAP_set_dcvs_v3_protected_bus_corners(&request, 1);
  > htp/main.c:527 — err = htp_set_dcvs_v3_corners(ctx, HAP_DCVS_VCORNER_MAX, HAP_DCVS_VCORNER_MAX);

  Source-level request contents are unchanged after substituting MAX for both parameters. The default host does not inspect env or call power:
  > CMakeLists.txt:28 — option(GGML_HEXAGON_LAB  "ggml-hexagon: lab-only knobs (env-gated, not for production)" OFF)
  > CMakeLists.txt:62 — if (GGML_HEXAGON_LAB)
  > ggml-hexagon.cpp:4482 — #ifdef GGML_HEXAGON_LAB
  > ggml-hexagon.cpp:4486 — const char * str_vcorner = getenv("GGML_HEXAGON_VCORNER");

  The new DSP method/IDL still ships in the skel when LAB is off, but the default host does not invoke it.
- **Later in-tree re-pin: REFUTED for core/bus.** Grep of every HAP_power_set/power vote in htp/ and ggml-hexagon.cpp found only app-type, startup DCVS/HVX/HMX votes, and the new method; no per-op or later core/bus vote. Startup HVX/HMX calls precede the host override:
  > htp/main.c:535 — request.type         = HAP_power_set_HVX;
  > htp/main.c:537 — if ((err = HAP_power_set((void *) ctx, &request)) != 0) {
  > htp/main.c:548 — request.type = HAP_power_set_HMX_v2;
  > htp/main.c:552 — request.hmx_v2.target_corner = HAP_DCVS_EXP_VCORNER_MAX;
  > htp/main.c:569 — request.type         = HAP_power_set_HMX;
  > htp/main.c:570 — request.hmx.power_up = TRUE;
  > ggml-hexagon.cpp:4495 — int perr = htp_iface_power(this->handle, (uint32_t) core_corner, (uint32_t) bus_corner);

  The v75+ HMX vote separately requests MAX HMX clock; v73 only requests HMX power-up. No effective-corner readback exists, so successful request status does not prove the S23’s observed frequency/voltage. Other HAP clients and platform thermal limits remain outside this source audit.
- **Compute serialization: REFUTED for this one-shot call path, not a general RPC guarantee.** The host call occurs during allocation, before the session constructor returns:
  > ggml-hexagon.cpp:4583 — allocate(config);
  
  The new session cannot enqueue batches before construction completes. DSP has no explicit queue mutex around htp_iface_power, so a future concurrent caller would not be serialized by this method.
- **Restart:** every fresh start writes MAX/MAX again (htp/main.c:527); stop has no explicit reset/destroy (P1). The env is sampled once in allocate (ggml-hexagon.cpp:4486), so each leg must create a fresh backend session/process; changing env while reusing a session has no effect.
- **Test hygiene:** tests/CMakeLists.txt:1 says “Not wired into the main ggml build”; it covers the host parser only. Existing build: build-vcorner-test. Ran exactly the requested test: EXIT=0; 1/1 htp-vcorner passed; 100% passed.

## Verdict

The default shipped path preserves the prior start request and does not read the new env knob. The lab feature can request a lower core/bus corner after startup votes, but do not treat leg results as valid until vote-client teardown and nonzero RPC/HAP statuses are gated, and effective corners are verified on-device.
