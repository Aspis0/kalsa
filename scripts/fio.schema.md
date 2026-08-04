# Schema `fio_runs.csv` — F2.1 UFS random-read

File telefono: `~/experiments/results/fio_runs.csv`  
Copia PC: `results/fio_runs.csv`  
Harness: `scripts/run_fio_bench.sh`

Una riga = un job fio (bs × iodepth × rep). **Non** riusa le colonne timing di `runs.csv`.

## Colonne

| Colonna | Tipo | Note |
|---|---|---|
| run_id | string | `fio-<bs>-qd<qd>-r<rep>-<ts>` |
| date | ISO-8601 | avvio job |
| phase | string | `F2.1` |
| bs | string | `4k` `16k` `64k` `256k` `1m` |
| iodepth | int | `1` o `4` |
| rep | int | 1..3 |
| size | string | es. `2G` |
| runtime_s | int | durata time_based |
| bw_kib_s | float | bandwidth KiB/s (fio) |
| bw_mib_s | float | KiB/s / 1024 |
| iops | float | |
| lat_mean_us | float | latenza media µs |
| lat_p99_us | float | p99 µs se disponibile |
| batt_temp_start | float °C | gate ≤32 |
| batt_temp_end | float °C | |
| plugged | string | deve essere UNPLUGGED per run validi |
| data_path | string | file 2GB in home Termux |
| notes | string | FAIL rc=… se errore |

## Protocollo

- File test: **2GB** sotto home Termux (`~/experiments/fio/…`), mai `/sdcard`.
- Random read, `ioengine=psync`, `direct=1` (libaio spesso assente su Android).
- 3 ripetizioni; report mediano per (bs, iodepth).
- Gate batteria/temperatura come `run_bench.sh` (exit 4/5/7).
