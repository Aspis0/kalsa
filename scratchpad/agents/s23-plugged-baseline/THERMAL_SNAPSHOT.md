# S23 plugged-idle thermal snapshot

Status: READ-ONLY. Device: `adb-R3CW406P8CV-zyLM4b (2)._adb-tls-connect._tcp`.

## Battery / screen samples

Five samples were taken 60 seconds apart at idle. Screen state was `mWakefulness=Dozing` for every sample. **The device was not plugged during sampling:** AC, USB, and wireless power were all `false`; battery status was discharging (`status=3`). Therefore this is an unplugged idle observation, not a valid plugged-idle reference for the plan.

| # | device time | level | battery temp | AC | USB | wireless | max readable thermal zone |
|---:|---|---:|---:|---|---|---|---|
| 1 | 2026-08-26 15:35:13 -04:00 | 96% | 25.3 °C | false | false | false | 37.0 °C (`pmr735d_k_tz`, `pmr735d_l_tz`) |
| 2 | 2026-08-26 15:36:21 -04:00 | 96% | 25.4 °C | false | false | false | 37.0 °C (`pmr735d_k_tz`, `pmr735d_l_tz`) |
| 3 | 2026-08-26 15:37:29 -04:00 | 96% | 25.4 °C | false | false | false | 37.0 °C (`pmr735d_k_tz`, `pmr735d_l_tz`) |
| 4 | 2026-08-26 15:38:36 -04:00 | 96% | 25.5 °C | false | false | false | 37.0 °C (`pmr735d_k_tz`, `pmr735d_l_tz`) |
| 5 | 2026-08-26 15:39:44 -04:00 | 95% | 25.5 °C | false | false | false | 37.0 °C (`pmr735d_k_tz`, `pmr735d_l_tz`) |

Battery idle range: **25.3–25.5 °C**. Readable thermal values were 86/95; 9 `temp` files returned `Invalid argument`: zones 75–81, 90, 91. All 95 `type` files were readable. The complete type/temp read at sample 5 follows.

## Thermal zones (sample 5; m°C)

| zone | type | temp |
|---:|---|---:|
| 0 | aoss-0 | 25900 |
| 1 | cpuss-0 | 27500 |
| 2 | cpuss-1 | 27500 |
| 3 | cpuss-2 | 27500 |
| 4 | cpuss-3 | 28300 |
| 5 | cpu-1-0 | 27500 |
| 6 | cpu-1-1 | 27500 |
| 7 | cpu-1-2 | 27500 |
| 8 | cpu-1-3 | 27500 |
| 9 | cpu-1-4 | 27900 |
| 10 | cpu-1-5 | 26300 |
| 11 | cpu-1-6 | 26300 |
| 12 | cpu-1-7 | 26700 |
| 13 | cpu-1-8 | 26300 |
| 14 | cpu-1-9 | 26700 |
| 15 | cpu-1-10 | 27500 |
| 16 | aoss-1 | 27800 |
| 17 | cpu-0-0 | 28600 |
| 18 | cpu-0-1 | 28600 |
| 19 | cpu-0-2 | 29000 |
| 20 | nspss-0 | 27400 |
| 21 | nspss-1 | 27000 |
| 22 | nspss-2 | 27400 |
| 23 | nspss-3 | 27000 |
| 24 | video | 29000 |
| 25 | ddr | 27800 |
| 26 | mdmss-0 | 27800 |
| 27 | mdmss-1 | 27000 |
| 28 | mdmss-2 | 27400 |
| 29 | mdmss-3 | 27400 |
| 30 | camera-0 | 27400 |
| 31 | camera-1 | 27800 |
| 32 | aoss-2 | 26900 |
| 33 | gpuss-0 | 27300 |
| 34 | gpuss-1 | 27700 |
| 35 | gpuss-2 | 26900 |
| 36 | gpuss-3 | 27700 |
| 37 | gpuss-4 | 26900 |
| 38 | gpuss-5 | 27300 |
| 39 | gpuss-6 | 27700 |
| 40 | gpuss-7 | 27700 |
| 41 | pa | 16643 |
| 42 | pa1 | 27000 |
| 43 | bcl_warn | -273000 |
| 44 | sdr0_pa | 0 |
| 45 | sdr0 | 0 |
| 46 | sdr1_pa | 0 |
| 47 | sdr1 | 0 |
| 48 | mmw0 | 0 |
| 49 | mmw1 | 0 |
| 50 | mmw2 | 0 |
| 51 | mmw3 | 0 |
| 52 | mmw_pa1 | 25705 |
| 53 | mmw_pa2 | 27000 |
| 54 | mmw_pa3 | 27000 |
| 55 | mmw_ific0 | 0 |
| 56 | epm0 | -273000 |
| 57 | epm1 | -273000 |
| 58 | epm2 | -273000 |
| 59 | epm3 | -273000 |
| 60 | epm4 | -273000 |
| 61 | epm5 | -273000 |
| 62 | epm6 | -273000 |
| 63 | epm7 | -273000 |
| 64 | sdr_mmw_therm | 27000 |
| 65 | sub1_modem_cfg | -273000 |
| 66 | sub1_lte_cc | -273000 |
| 67 | sub1_mcg_fr1_cc | -273000 |
| 68 | sub1_mcg_fr2_cc | -273000 |
| 69 | sub1_scg_fr1_cc | -273000 |
| 70 | sub1_scg_fr2_cc | -273000 |
| 71 | pm8550_tz | 29011 |
| 72 | pm8550-bcl-lvl0 | 0 |
| 73 | pm8550-bcl-lvl1 | 0 |
| 74 | pm8550-bcl-lvl2 | 0 |
| 75 | pm8550b_tz | UNREADABLE |
| 76 | pm8550b_lite_tz | UNREADABLE |
| 77 | pm8550b-ibat-lvl0 | UNREADABLE |
| 78 | pm8550b-ibat-lvl1 | UNREADABLE |
| 79 | pm8550b-bcl-lvl0 | UNREADABLE |
| 80 | pm8550b-bcl-lvl1 | UNREADABLE |
| 81 | pm8550b-bcl-lvl2 | UNREADABLE |
| 82 | socd | 5 |
| 83 | pm8550ve_f_tz | 21553 |
| 84 | pm8550vs_c_tz | 23024 |
| 85 | pm8550vs_d_tz | 24061 |
| 86 | pm8550vs_e_tz | 23727 |
| 87 | pm8550vs_g_tz | 23426 |
| 88 | pmr735d_k_tz | 37000 |
| 89 | pmr735d_l_tz | 37000 |
| 90 | pm8010m_tz | UNREADABLE |
| 91 | pm8010n_tz | UNREADABLE |
| 92 | xo-therm | 26190 |
| 93 | ac | 24800 |
| 94 | battery | 25300 |

Unplugged-only observation: cool-start class was **not established** from that sample. The observed unplugged idle is <=32 °C, but §0 requires a plugged idle sample to set the class. No CPU/GPU load was run.

## Plugged idle reference — compact recapture

The first 30-minute capture was lost when the terminal buffer truncated before persistence. Per the status instruction, this is the one compact recapture used for the datum. It contains 25 samples at nominal 30 s cadence, with all 95 mapped thermal zones on every row, in `raw/plugged_idle_reference.csv`. Due to wireless ADB round-trip latency, the timestamp span was 14m50s; the settled last-10-minute window contains 17 samples spanning 9m54s. No device file was written.

Start verification: AC powered `true`, USB powered `false`, wireless powered `false`, battery level 100%, status `5` (full), screen `OFF` (`Display State=OFF`, Dozing). These values remained unchanged through the capture.

| window | samples | battery temperature | battery level | charge state |
|---|---:|---:|---:|---|
| full compact recapture | 25 | 27.6–28.0 °C | 100% → 100% | AC/full → AC/full |
| settled last 10 min | 17 | **27.7–28.0 °C**, median **T_idle_plugged = 27.8 °C** | 100% → 100% | status 5 → 5 |

Settled drift was **0.0 °C end-minus-start** (27.7 → 27.7 °C); settled range was 0.3 °C. Full recapture drift was -0.2 °C (27.9 → 27.7 °C). The maximum numeric thermal-zone reading was 37.0 °C; battery temperature did not rise monotonically past 38 °C.

Delta versus the unplugged reference (25.3–25.5 °C): **+2.3 to +2.5 °C** for the plugged median, or **+2.4 °C** versus the 25.4 °C midpoint.

The plugged result establishes `cool_start_class=cool` under the draft scheme (`T_idle_plugged < 32 °C`). The previously pending class is now filled in the preregistration draft; the draft remains **NOT LOCKED**.
