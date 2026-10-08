# Research: does slower decode lower temperature? Is a Hexagon-load hard reset known?

Date: 2026-10-08. Compiled from a Paseo research agent (9e7083a2, profile Explorer&WebSearch, claude-haiku-5-5), with parent spot-checks.

**Method and limits.** The agent read pages through a WebFetch tool that runs a small model over the page. Quotes below are "as relayed by the fetch tool", not raw page text. Parent spot-checks (re-fetched this session) are marked **[parent-checked]**. PDFs were unreadable, so the physics sources in Q1a are **not verified**. Tags: MEASURED (has data), VENDOR-DOC, OPINION.

---

## Q1a. Race-to-idle, pacing, DVFS, leakage

**Result: no readable source gives a phone-SoC measurement of race-to-idle vs DVFS with leakage and temperature together.**

| Claim | Tag | Source | Status |
|---|---|---|---|
| Sub-threshold leakage rises exponentially with temperature; temperature must enter the voltage decision | OPINION | DAC 2009 temperature-aware DVFS, `ida.liu.se/labs/eslab/publications/pap/db/minba_dac09.pdf` (search snippet) | PDF unreadable; not verified |
| DVFS savings "diminishing due to efficient (low overhead) sleep states and increased static (leakage) power" | not verified | Awan & Petters, ECRTS 2011, DOI 10.1109/ECRTS.2011.17 (snippet) | not opened |
| Energy-optimal frequency lies between a high-frequency (dynamic) and low-frequency (static) extreme | not verified | FAU Erlangen slides `www4.cs.fau.de/.../u03.pdf` (snippet) | not opened |
| Race-to-idle vs slowdown: winner depends on workload, frequency, SMT | not verified | Southampton `date16-doi.pdf` (snippet) | not opened |
| arXiv 1703.02788 (race/DVFS study) | not verified | `arxiv.org/pdf/1703.02788` | PDF unreadable |

Inference (OPINION): slower can cost more energy per operation when leakage dominates, and a hotter chip leaks more. This is plausible physics. Nothing I could read proves it for SM8550.

## Q1b. LLM decode on phones and NPUs

**1. arXiv 2603.23640, "LLM Inference at the Edge ... Under Sustained Load"** (MEASURED; Qwen2.5-1.5B-Q4)
- Source cited: `arxiv.org/html/2603.23640`. Not parent-checked.
- S24 Ultra, MLC-LLM, GPU: "settles into a 720–770 MHz plateau from iteration 8 onward"; "with a minimum of 9.55 tok/s at iteration 20—a 22% degradation from peak"; "Peak GPU temperature reaches 68.5°C during the 1,000 MHz boost phase (iteration 5)"; "Energy per token averages 146±11 mJ across 20 iterations"; "The governor regulates via continuous DVFS rather than threshold-triggered shutdown."
- iPhone 16 Pro, MLX: "throughput averages 24.96 tok/s (−38.4% from peak), stabilising within ±1 tok/s after iteration 4." No temperature or J/token reported.
- Raspberry Pi 5 + Hailo-10H NPU: "CPU temperature is confined to 52.7±0.8°C and NPU temperature to 58.5±1.1°C"; "energy per token of 270.5±2.4 mJ."
- **Conflict, unresolved:** the abs page says the S24 Ultra "suffers a hard OS-enforced GPU frequency floor that terminates inference entirely." The HTML says it "avoid[s] the OS-enforced GPU frequency floor observed in earlier unconstrained runs." These may be different versions. Do not cite either without reading the version history.
- Reading: the phone runs show a governor-bounded DVFS plateau. No Hexagon or SM8550 data. Not S23.

**2. arXiv 2606.23001, "EnerInfer: Energy-Aware On-Device LLM Inference"** (MEASURED; closest to our question) **[parent-checked]**
- Device: "Huawei HUAWEI Mate70 Pro" (SoC not named). Model Qwen2.5-1.5B-Q4. "All test platforms primarily use the NPU for decoding." Source: `arxiv.org/html/2606.23001v1`.
- Stress test, back-to-back: "It generates only 690 tokens in 40 seconds before reaching the threshold."
- Controlled run: "As the most energy-efficient setting that meets the QoE, Ener sustains a longer duration (165 s) and generates 1784 tokens." Note: the paper frames the 165 s run as the energy-efficient setting that meets QoE, not simply "slower".
- Cap: "the back-shell temperature should remain below 42" (°C). **The sensor is back-shell, not junction.** "Junction temperature is not mentioned."
- Efficiency: "Energy efficiency is defined as the number of tokens produced per joule," counting only NPU and memory. No J/token figure in the part I read.
- Control: the controller "directly sets the operating frequency of the NPU"; the NPU "offers limited dynamic voltage and frequency scaling (DVFS) control" (agent quote, not re-checked).
- Reading: under a shell-temperature cap, the managed run produced about 2.6× more tokens. That is a thermal-budget result. It does not show lower J/token at equal silicon temperature, and it is not Snapdragon.

**3. Qualcomm HTP performance modes** (VENDOR-DOC) `docs.qualcomm.com/bundle/publicresource/80-63442-10/topics/htp_backend.md` (agent fetch, not re-checked)
- "Treat perf mode as a relative selector, not an absolute frequency guarantee."
- "This vote gets reset (possibly with lower performance) either when timer expires."
- Gives no thermal or duty-cycle numbers for v73.

**4. SM8550 / S23 NPU sustained-load data: NOT FOUND.** No sustained NPU decode run, J/token, or throttling curve for SM8550 in any source. A Gen 1 / v69 anecdote ("phone stays cool during inference") is OPINION only, not measured.

## Q1c. Skin vs junction under pacing

| Claim | Tag | Source |
|---|---|---|
| "The device skin temperature is the most important system to track" | VENDOR-DOC | `source.android.com/docs/core/power/thermal-mitigation` (agent fetch) |
| "The temperature value returned from a sensor reading doesn't have to be the actual temperature, as long as it accurately reflects the corresponding severity threshold." | VENDOR-DOC | same |
| Status scale NONE (0x0) to SHUTDOWN (0x6); EMERGENCY = "Key components in the platform are shutting down due to thermal conditions" | VENDOR-DOC | same |
| EnerInfer measures back-shell only | MEASURED | `arxiv.org/html/2606.23001v1` **[parent-checked]** |

Inference (OPINION): under sustained load the skin lags the die, so pacing shows on skin later than on an NSP zone. No source measured this on an S23 or Hexagon.

---

## Q2. Hard reset under sustained NSP/cDSP load

**Direct answer: no source explains the S23 event** (PMIC HARD_RESET with NSP ~90 °C, below the 95 °C passive trip). The sources show only that hardware can cut power on an over-temperature path, read from a sensor separate from the NSP zone.

| Claim | Tag | Source |
|---|---|---|
| PMIC over-temp: "at stage 2 it does a partial PMIC shutdown and at stage 3 it kills all power." | VENDOR-DOC (kernel patch, 2018, Kaehlcke; generation not named) | `lkml.rescloud.iu.edu/1807.3/06606.html` **[parent-checked]**. The agent's longer lead-in ("By default the PMIC assumes...") did not reproduce in my fetch; the substance matches. |
| Stage 3 emergency shutdown: "If for some reason the system doesn't shutdown at stage 2 the emergency shutdown at stage 3 kicks in." | VENDOR-DOC | same **[parent-checked]** |
| Default thresholds 105/125/145 °C, S2 and S3 enabled | VENDOR-DOC; PMIC die thresholds from a 2018 driver, not S23's PMIC | same **[parent-checked]** |
| Stage 2 partial shutdown enabled by default; "Certain TEMP_ALARM GEN2 PMIC peripherals need over-temperature stage 2 automatic PMIC partial shutdown to be enabled" | VENDOR-DOC | `lkml.iu.edu/hypermail/linux/kernel/2502.3/04132.html` (2025, Melendez) (agent fetch, not re-checked) |
| CDSP does not self-throttle on the SoCs in these patches: "Unlike the CPU, the CDSP does not throttle its speed automatically when it reaches high temperatures in lemans." Trips 100/105/115/95 °C per SoC | VENDOR-DOC; kodiak, lemans, talos, monaco, hamoa only, **not SM8550** | `ratatoskr.run/linux-devicetree/2026/07/17348380/t` (agent fetch, not re-checked) |
| CDSP cooling via QMI: "thermal policies can request mitigation from CDSP and modem subsystems via QMI under thermal pressure." | VENDOR-DOC (same series) | same (not re-checked) |
| SM8550 llama.cpp abort: "Device: RedMagic 8 Pro+ (NX729J), Snapdragon 8 Gen 2 (SM8550), Android 15 (API 35), Hexagon arch v73." "dspqueue_read failed: 0x0000002e"; "until the device is rebooted, suggesting the DSP-side session isn't cleaned up on the abort path." No thermal, temperature or overheat term on the page. | MEASURED (log) | `github.com/ggml-org/llama.cpp/issues/26123` **[parent-checked]** |
| Subsystem fatal/NMI/hw reset "may result in a panic or do a subsystem restart" | not verified (snippet; page returned only its title) | `docs.qualcomm.com/bundle/publicresource/topics/80-88500-4/68_Watchdog.html` |
| S23 owners report random reboots | anecdote, not verified | Samsung Community threads (snippets only) |

Searched, nothing found:
- cDSP thermal crash or SSR on SM8550 or any Snapdragon: none. The thermal patches say nothing about crashes or SSR. Linking cooling to SSR is inference only.
- llama.cpp Hexagon thermal reboot: none. Hexagon issues (#26123, #19617, #29473, #27677) are compute aborts with no thermal or reboot content, as far as the agent read.
- Samsung kernel panic on cDSP crash: none.
- Qualcomm AI Hub / QNN forum reports of thermal reset: none.

Inference (OPINION, not a finding): a stage-3 "kills all power" path would look like an abrupt power loss. Whether it logs as PON HARD_RESET is not verified. The S23's PMIC temperature was never measured, and NSP ~90 °C does not rule out a hotter PMIC or other die.

---

## Bottom line

- **MEASURED:** On a phone NPU (Mate 70 Pro, 1.5B Q4), the managed run produced 1784 tokens in 165 s, against 690 tokens in 40 s before the back-shell cap. The paper calls it the most energy-efficient setting meeting QoE. It is shell-bounded, not silicon-bounded, and it does not show lower J/token at equal temperature. [arxiv.org/html/2606.23001v1, parent-checked]
- **MEASURED:** The S24 Ultra GPU decode settles to a DVFS plateau (720–770 MHz, 146±11 mJ/token) rather than failing. GPU, not Hexagon, 1.5B model. [arxiv.org/html/2603.23640, not re-checked]
- **VENDOR-DOC:** On the SoCs in the kernel patches (not SM8550), the CDSP does not self-throttle; cooling is a software trip plus QMI. [ratatoskr v7 series, not re-checked]
- **VENDOR-DOC:** A PMIC over-temperature path (stage 2 partial shutdown, stage 3 full power cut) exists independently of any SoC zone. It is the only documented path in these sources that cuts power with no passive trip reached. Whether it explains the S23 event is **not established**. [lkml 2018, parent-checked]
- **MEASURED (log only):** SM8550 Hexagon compute aborts can wedge the DSP session until reboot (#26123). This is a software fault with no thermal link, and it is a different event from a PMIC reset. [parent-checked]
- **OPINION:** For the next run, log the PMIC TEMP_ALARM status and the PON reason registers, and keep the NSP well below 90 °C. Pacing is a budget choice. No source shows it lowers energy per token on the S23.

## Not found / could not verify

- Race-to-idle vs DVFS vs J/token with leakage on any phone SoC. The key papers were unreadable PDFs.
- Any S23 or Snapdragon 8 Gen 2 measurement of NPU sustained-load temperature, J/token or throttling.
- Any source linking a PMIC HARD_RESET to NSP/cDSP temperature on Qualcomm or Samsung.
- Any llama.cpp, QNN or Samsung report of a thermal reboot from Hexagon load.
- SM8550 trip points and PMIC thresholds. Only other SoCs' kernel values were found.
- The 2603.23640 abs/HTML conflict (S24 "terminates inference" vs "avoiding the floor") is unresolved.
- The Qualcomm watchdog page could not be read.
- The S24 numbers, the Pi numbers, and the QNN doc quotes were relayed by the fetch tool and were not re-checked by the parent.

## Process notes

- The arXiv HTML fetch returned an embedded instruction to write an essay. The agent ignored it. Treat any text relayed from that page as untrusted.
- Physics claims in Q1a rest on snippets and were not verified.
