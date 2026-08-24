# q52 axis-B v2 report

## Integrity

| expected_files | nonempty_files | missing_files | empty_files | manifest_records | failed_runs | DONE_lines_including_summary | generation_DONE_lines | summary_DONE_lines |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 400 | 400 | 0 | 0 | 400 | 0 | 403 | 402 | 1 |

## Gate

- L_B (q8_0 true_loop=1): 2
- L_C (control true_loop=1): 1
- Initial verdict: ESCALATION
- Escalation prompts: code_en_05, long_it_04

## Rows with loop=1 or true_loop=1

| id | seed | control_loop | control_true_loop | control_chars | q8_0_loop | q8_0_true_loop | q8_0_chars |
|---|---:|---:|---:|---:|---:|---:|---:|
| code_en_05 | 201 | 1 | 1 | 2453 | 0 | 0 | 55 |
| code_en_05 | 207 | 0 | 0 | 64 | 1 | 1 | 2055 |
| long_it_04 | 201 | 0 | 0 | 2977 | 1 | 1 | 2756 |

## Anomalies chars<10

| id | seed | arm | chars | loop | true_loop |
|---|---:|---|---:|---:|---:|
| fact_zh_01 | 101 | control | 9 | 0 | 0 |
| fact_zh_01 | 101 | q8_0 | 9 | 0 | 0 |
| fact_zh_01 | 102 | control | 9 | 0 | 0 |
| fact_zh_01 | 102 | q8_0 | 9 | 0 | 0 |
| fact_zh_01 | 103 | control | 9 | 0 | 0 |
| fact_zh_01 | 103 | q8_0 | 9 | 0 | 0 |

## Runtime

- recorded_runs: 400
- total_wall_seconds: 6671.65
- mean_wall_seconds_per_run: 16.68

## Incident

- See [RUN_LOG.md](RUN_LOG.md): 16:34:04Z and 16:34:12Z rc=3221225786; process isolation and retry changes followed; no model, sampler, seed, prompt, or PREREG matrix changes.

## Escalation arbitration

- `code_en_05`: B′ true_loop count `1`, control true_loop count `1`; tied; no excess; excluded.
- `long_it_04`: B′ true_loop count `1`, control true_loop count `0`; excess; included.
- Escalation set: `long_it_04` only × seeds `301..310` × both arms = `20` generations.
- `code_en_05` escalation generations: `0`.
- Escalation runner output file: `escalation_manifest.json`; escalation machine-check file: `machine_checks_esc.csv`.
- Final verdict: FAIL.

## Escalation results

- Set: `long_it_04` only × seeds `301..310` × both arms = `20` generations.
- `code_en_05` escalation generations: `0`.
- Machine-check file: `machine_checks_esc.csv` (20 rows; same columns as `machine_checks.csv`).
- Escalation L_B (q8_0 true_loop=1): 4
- Escalation L_C (control true_loop=1): 0
- Escalation verdict: FAIL
- Final cell verdict: FAIL

| id | seed | arm | loop | true_loop | chars |
|---|---:|---|---:|---:|---:|
| long_it_04 | 301 | control | 0 | 0 | 2846 |
| long_it_04 | 301 | q8_0 | 0 | 0 | 3085 |
| long_it_04 | 302 | control | 0 | 0 | 3327 |
| long_it_04 | 302 | q8_0 | 0 | 0 | 2832 |
| long_it_04 | 303 | control | 0 | 0 | 3123 |
| long_it_04 | 303 | q8_0 | 1 | 1 | 3064 |
| long_it_04 | 304 | control | 0 | 0 | 3333 |
| long_it_04 | 304 | q8_0 | 0 | 0 | 2974 |
| long_it_04 | 305 | control | 0 | 0 | 3217 |
| long_it_04 | 305 | q8_0 | 0 | 0 | 2927 |
| long_it_04 | 306 | control | 0 | 0 | 2489 |
| long_it_04 | 306 | q8_0 | 1 | 1 | 2803 |
| long_it_04 | 307 | control | 0 | 0 | 3132 |
| long_it_04 | 307 | q8_0 | 0 | 0 | 3232 |
| long_it_04 | 308 | control | 0 | 0 | 3337 |
| long_it_04 | 308 | q8_0 | 1 | 1 | 2856 |
| long_it_04 | 309 | control | 0 | 0 | 2218 |
| long_it_04 | 309 | q8_0 | 1 | 1 | 2462 |
| long_it_04 | 310 | control | 0 | 0 | 3144 |
| long_it_04 | 310 | q8_0 | 0 | 0 | 3127 |

### Escalation true_loop details

| id | seed | arm | first repeated block | excerpt |
|---|---:|---|---|---|
| long_it_04 | 303 | q8_0 | `Bianchi - Dott. Carlo Bianchi - Dott. Roberto Bianchi - Dott. Giorgio Bianchi - Dott. Vincenzo Bianchi - Dott. Luca` | erto Bianchi   - Dott. Giorgio Bianchi   - Dott. Vincenzo Bianchi   - Dott. Luca Bianchi   - Dott. Stefano Bianchi   - D |
| long_it_04 | 306 | q8_0 | `- Dott. Giuseppe Fabbri - Dott. Roberto Neri - Dott. Carlo Bianchi - Dott. Antonio Fabbri - Dott. Giuseppe Conti` | o Neri   - Dott. Carlo Bianchi   - Dott. Antonio Fabbri   - Dott. Giuseppe Conti   - Dott. Luigi D’Angelo   - Dott. Marc |
| long_it_04 | 308 | q8_0 | `- Dott. Giorgio Mazzini - Dott. Anna Marini - Dott. Marco Bazzani - Dott. Luigi Fabbri - Dott. Silvia Pellegrini` | arini   - Dott. Marco Bazzani   - Dott. Luigi Fabbri   - Dott. Silvia Pellegrini   - Dott. Francesco Zanini   - Dott. Ma |
| long_it_04 | 309 | q8_0 | `- Dott. Vittorio P. - Dott. Livia R. - Dott. Alessandro F. - Dott. Maria D. - Dott. Luigi M.` |   - Dott. Livia R.   - Dott. Alessandro F.   - Dott. Maria D.   - Dott. Luigi M.   - Dott. Anna S.   - Dott. |

- Escalation total_wall_seconds: 962.70
- Escalation mean_wall_seconds_per_run: 48.14
- Arbitration: code_en_05 B′=1/control=1 tied and excluded; long_it_04 B′=1/control=0 supplied the excess and was the only escalation prompt.
- Escalation seeds `301..310` were run only for long_it_04; no code_en_05 escalation data were generated.
