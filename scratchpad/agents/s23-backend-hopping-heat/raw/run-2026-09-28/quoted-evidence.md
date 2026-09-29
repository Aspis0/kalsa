# Quoted run evidence

This appendix quotes exact raw log/marker rows and the generated per-arm analysis rows. The temperature evidence TSVs include each value, sensor name, and the exact source sample line number. All output is under `/tmp/s23-heat-abc/`.

## Prefill arms

### archival-primary-cpu — P-cpu-1

> `/tmp/s23-heat-abc/prior/raw/device-out/out/markers.tsv:L5` `1790599101	START_P-cpu-1	cmd=timeout -s KILL 300 ./bin/llama-completion -m /data/local/tmp/heat3way/ship.gguf -lm none --ignore-eos --seed 1 --temp 0 --no-conversation -c 2048 -b 2048 -ub 1024 -t 5 -fa 1 --no-warmup --perf --simple-io --no-display-prompt -f /data/local/tmp/heat3way/prompt.txt -n 16 -lv 4 -dev none -ngl 0`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/markers.tsv:L6` `1790599116	END_P-cpu-1	rc=0`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/P-cpu-1.log:L181` `0.14.645.256 I common_perf_print: prompt eval time =   10143.54 ms /   962 tokens (   10.54 ms per token,    94.84 tokens per second)`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/P-cpu-1.log:L182` `0.14.645.258 I common_perf_print:        eval time =     655.92 ms /    15 runs   (   43.73 ms per token,    22.87 tokens per second)`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/P-cpu-1.log:L189` `EXIT=0`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/P-cpu-1.log:L125` `0.00.750.884 I load_tensors:          CPU model buffer size =   206.07 MiB`
> `/tmp/s23-heat-abc/prefill-run-summary.tsv:L2` `archival-primary-cpu	1	P-cpu-1	none -ngl 0	962	15	10143.54	15.0	29.7	30.2	0.5	30.4	30.9	0.5	0.5	30.9	0.5	49.0	86.3	89.9	41.2	54.7	61.0	37.8	51.3	56.1	0	PASS	not-recorded-in-archival-marker	markers.tsv:L5	markers.tsv:L6	3	14	/tmp/s23-heat-abc/prior/raw/device-out/out/P-cpu-1.log`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L2` `archival-primary-cpu	P-cpu-1	battery_start	29.7	battery_dC	3	1790599101	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790599101 battery_dC=297 skin_C=30.4 battery_dC=297`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L3` `archival-primary-cpu	P-cpu-1	battery_peak	30.2	battery_dC	11	1790599112	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790599112 battery_dC=302 skin_C=30.9 battery_dC=302`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L4` `archival-primary-cpu	P-cpu-1	battery_end	30.2	battery_dC	14	1790599117	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790599117 battery_dC=302 skin_C=30.9 battery_dC=302`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L5` `archival-primary-cpu	P-cpu-1	skin_start	30.4	skin_C	3	1790599101	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790599101 battery_dC=297 skin_C=30.4 skin_C=30.4`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L6` `archival-primary-cpu	P-cpu-1	skin_peak	30.9	skin_C	8	1790599107	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790599107 battery_dC=297 skin_C=30.9 skin_C=30.9`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L7` `archival-primary-cpu	P-cpu-1	skin_end	30.9	skin_C	14	1790599117	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790599117 battery_dC=302 skin_C=30.9 skin_C=30.9`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L9` `archival-primary-cpu	P-cpu-1	CPU_peak	89.9	cpu-1-10	8	1790599107	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790599107 battery_dC=297 skin_C=30.9 cpu-1-10=89900`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L12` `archival-primary-cpu	P-cpu-1	GPU_peak	61.0	gpuss-4	12	1790599113	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790599113 battery_dC=302 skin_C=30.9 gpuss-4=61000`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L15` `archival-primary-cpu	P-cpu-1	NSP_peak	56.1	nspss-0	13	1790599115	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790599115 battery_dC=302 skin_C=30.9 nspss-0=56100`

### archival-primary-cpu — P-cpu-1-2

> `/tmp/s23-heat-abc/prior/raw/device-out/out/markers.tsv:L9` `1790599116	START_P-cpu-1-2	cmd=timeout -s KILL 300 ./bin/llama-completion -m /data/local/tmp/heat3way/ship.gguf -lm none --ignore-eos --seed 1 --temp 0 --no-conversation -c 2048 -b 2048 -ub 1024 -t 5 -fa 1 --no-warmup --perf --simple-io --no-display-prompt -f /data/local/tmp/heat3way/prompt.txt -n 16 -lv 4 -dev none -ngl 0`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/markers.tsv:L10` `1790599319	END_P-cpu-1-2	rc=0`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/P-cpu-1-2.log:L181` `3.22.191.475 I common_perf_print: prompt eval time =   18716.11 ms /   962 tokens (   19.46 ms per token,    51.40 tokens per second)`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/P-cpu-1-2.log:L182` `3.22.191.477 I common_perf_print:        eval time =  179993.78 ms /    15 runs   (11999.59 ms per token,     0.08 tokens per second)`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/P-cpu-1-2.log:L189` `EXIT=0`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/P-cpu-1-2.log:L125` `0.00.570.795 I load_tensors:          CPU model buffer size =   206.07 MiB`
> `/tmp/s23-heat-abc/prefill-run-summary.tsv:L3` `archival-primary-cpu	2	P-cpu-1-2	none -ngl 0	962	15	18716.11	203.0	30.2	37.0	6.8	30.9	38.4	7.5	8.0	38.5	8.1	89.1	71.7	90.8	57.0	54.7	61.8	56.1	50.9	55.7	0	PASS	not-recorded-in-archival-marker	markers.tsv:L9	markers.tsv:L10	13	150	/tmp/s23-heat-abc/prior/raw/device-out/out/P-cpu-1-2.log`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L17` `archival-primary-cpu	P-cpu-1-2	battery_start	30.2	battery_dC	13	1790599115	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790599115 battery_dC=302 skin_C=30.9 battery_dC=302`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L18` `archival-primary-cpu	P-cpu-1-2	battery_peak	37.0	battery_dC	133	1790599293	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790599293 battery_dC=370 skin_C=38.2 battery_dC=370`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L19` `archival-primary-cpu	P-cpu-1-2	battery_end	37.0	battery_dC	150	1790599320	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790599320 battery_dC=370 skin_C=38.4 battery_dC=370`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L20` `archival-primary-cpu	P-cpu-1-2	skin_start	30.9	skin_C	13	1790599115	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790599115 battery_dC=302 skin_C=30.9 skin_C=30.9`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L21` `archival-primary-cpu	P-cpu-1-2	skin_peak	38.5	skin_C	142	1790599307	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790599307 battery_dC=370 skin_C=38.5 skin_C=38.5`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L22` `archival-primary-cpu	P-cpu-1-2	skin_end	38.4	skin_C	150	1790599320	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790599320 battery_dC=370 skin_C=38.4 skin_C=38.4`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L24` `archival-primary-cpu	P-cpu-1-2	CPU_peak	90.8	cpu-1-9	22	1790599128	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790599128 battery_dC=302 skin_C=32.6 cpu-1-9=90800`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L27` `archival-primary-cpu	P-cpu-1-2	GPU_peak	61.8	gpuss-4	26	1790599134	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790599134 battery_dC=302 skin_C=32.6 gpuss-4=61800`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L30` `archival-primary-cpu	P-cpu-1-2	NSP_peak	55.7	nspss-0	104	1790599250	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790599250 battery_dC=356 skin_C=37.3 nspss-0=55700`

### archival-primary-cpu — P-cpu-1-2-3

> `/tmp/s23-heat-abc/prior/raw/device-out/out/markers.tsv:L13` `1790599320	START_P-cpu-1-2-3	cmd=timeout -s KILL 300 ./bin/llama-completion -m /data/local/tmp/heat3way/ship.gguf -lm none --ignore-eos --seed 1 --temp 0 --no-conversation -c 2048 -b 2048 -ub 1024 -t 5 -fa 1 --no-warmup --perf --simple-io --no-display-prompt -f /data/local/tmp/heat3way/prompt.txt -n 16 -lv 4 -dev none -ngl 0`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/markers.tsv:L14` `1790599343	END_P-cpu-1-2-3	rc=0`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/P-cpu-1-2-3.log:L181` `0.23.546.654 I common_perf_print: prompt eval time =   19352.73 ms /   962 tokens (   20.12 ms per token,    49.71 tokens per second)`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/P-cpu-1-2-3.log:L182` `0.23.546.656 I common_perf_print:        eval time =     686.00 ms /    15 runs   (   45.73 ms per token,    21.87 tokens per second)`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/P-cpu-1-2-3.log:L189` `EXIT=0`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/P-cpu-1-2-3.log:L125` `0.00.637.785 I load_tensors:          CPU model buffer size =   206.07 MiB`
> `/tmp/s23-heat-abc/prefill-run-summary.tsv:L4` `archival-primary-cpu	3	P-cpu-1-2-3	none -ngl 0	962	15	19352.73	23.0	37.0	37.3	0.3	38.4	38.8	0.4	8.4	38.8	8.4	71.7	64.4	89.5	54.7	55.9	62.2	50.9	53.7	56.9	0	PASS	not-recorded-in-archival-marker	markers.tsv:L13	markers.tsv:L14	150	164	/tmp/s23-heat-abc/prior/raw/device-out/out/P-cpu-1-2-3.log`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L32` `archival-primary-cpu	P-cpu-1-2-3	battery_start	37.0	battery_dC	150	1790599320	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790599320 battery_dC=370 skin_C=38.4 battery_dC=370`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L33` `archival-primary-cpu	P-cpu-1-2-3	battery_peak	37.3	battery_dC	153	1790599324	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790599324 battery_dC=373 skin_C=38.4 battery_dC=373`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L34` `archival-primary-cpu	P-cpu-1-2-3	battery_end	37.3	battery_dC	164	1790599344	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790599344 battery_dC=373 skin_C=38.8 battery_dC=373`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L35` `archival-primary-cpu	P-cpu-1-2-3	skin_start	38.4	skin_C	150	1790599320	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790599320 battery_dC=370 skin_C=38.4 skin_C=38.4`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L36` `archival-primary-cpu	P-cpu-1-2-3	skin_peak	38.8	skin_C	161	1790599338	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790599338 battery_dC=373 skin_C=38.8 skin_C=38.8`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L37` `archival-primary-cpu	P-cpu-1-2-3	skin_end	38.8	skin_C	164	1790599344	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790599344 battery_dC=373 skin_C=38.8 skin_C=38.8`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L39` `archival-primary-cpu	P-cpu-1-2-3	CPU_peak	89.5	cpu-1-10	154	1790599325	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790599325 battery_dC=373 skin_C=38.4 cpu-1-10=89500`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L42` `archival-primary-cpu	P-cpu-1-2-3	GPU_peak	62.2	gpuss-4	156	1790599328	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790599328 battery_dC=373 skin_C=38.6 gpuss-4=62200`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L45` `archival-primary-cpu	P-cpu-1-2-3	NSP_peak	56.9	nspss-0	163	1790599342	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790599342 battery_dC=373 skin_C=38.8 nspss-0=56900`

### archival-primary-cpu — P-cpu-1-2-3-4

> `/tmp/s23-heat-abc/prior/raw/device-out/out/markers.tsv:L17` `1790599344	START_P-cpu-1-2-3-4	cmd=timeout -s KILL 300 ./bin/llama-completion -m /data/local/tmp/heat3way/ship.gguf -lm none --ignore-eos --seed 1 --temp 0 --no-conversation -c 2048 -b 2048 -ub 1024 -t 5 -fa 1 --no-warmup --perf --simple-io --no-display-prompt -f /data/local/tmp/heat3way/prompt.txt -n 16 -lv 4 -dev none -ngl 0`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/markers.tsv:L18` `1790599361	END_P-cpu-1-2-3-4	rc=0`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/P-cpu-1-2-3-4.log:L181` `0.16.374.170 I common_perf_print: prompt eval time =   11788.44 ms /   962 tokens (   12.25 ms per token,    81.61 tokens per second)`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/P-cpu-1-2-3-4.log:L182` `0.16.374.172 I common_perf_print:        eval time =     784.09 ms /    15 runs   (   52.27 ms per token,    19.13 tokens per second)`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/P-cpu-1-2-3-4.log:L189` `EXIT=0`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/P-cpu-1-2-3-4.log:L125` `0.00.698.018 I load_tensors:          CPU model buffer size =   206.07 MiB`
> `/tmp/s23-heat-abc/prefill-run-summary.tsv:L5` `archival-primary-cpu	4	P-cpu-1-2-3-4	none -ngl 0	962	15	11788.44	17.0	37.3	37.8	0.5	38.8	39.1	0.3	8.7	39.1	8.7	64.4	59.9	86.7	55.9	55.1	63.4	53.7	54.1	58.1	0	PASS	not-recorded-in-archival-marker	markers.tsv:L17	markers.tsv:L18	164	174	/tmp/s23-heat-abc/prior/raw/device-out/out/P-cpu-1-2-3-4.log`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L47` `archival-primary-cpu	P-cpu-1-2-3-4	battery_start	37.3	battery_dC	164	1790599344	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790599344 battery_dC=373 skin_C=38.8 battery_dC=373`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L48` `archival-primary-cpu	P-cpu-1-2-3-4	battery_peak	37.8	battery_dC	170	1790599353	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790599353 battery_dC=378 skin_C=38.8 battery_dC=378`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L49` `archival-primary-cpu	P-cpu-1-2-3-4	battery_end	37.8	battery_dC	174	1790599361	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790599361 battery_dC=378 skin_C=39.1 battery_dC=378`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L50` `archival-primary-cpu	P-cpu-1-2-3-4	skin_start	38.8	skin_C	164	1790599344	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790599344 battery_dC=373 skin_C=38.8 skin_C=38.8`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L51` `archival-primary-cpu	P-cpu-1-2-3-4	skin_peak	39.1	skin_C	172	1790599357	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790599357 battery_dC=378 skin_C=39.1 skin_C=39.1`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L52` `archival-primary-cpu	P-cpu-1-2-3-4	skin_end	39.1	skin_C	174	1790599361	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790599361 battery_dC=378 skin_C=39.1 skin_C=39.1`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L54` `archival-primary-cpu	P-cpu-1-2-3-4	CPU_peak	86.7	cpu-1-10	170	1790599353	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790599353 battery_dC=378 skin_C=38.8 cpu-1-10=86700`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L57` `archival-primary-cpu	P-cpu-1-2-3-4	GPU_peak	63.4	gpuss-4	171	1790599355	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790599355 battery_dC=378 skin_C=38.8 gpuss-4=63400`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L60` `archival-primary-cpu	P-cpu-1-2-3-4	NSP_peak	58.1	nspss-0	173	1790599359	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790599359 battery_dC=378 skin_C=39.1 nspss-0=58100`

### archival-primary-cpu — P-cpu-1-2-3-4-5

> `/tmp/s23-heat-abc/prior/raw/device-out/out/markers.tsv:L21` `1790599361	START_P-cpu-1-2-3-4-5	cmd=timeout -s KILL 300 ./bin/llama-completion -m /data/local/tmp/heat3way/ship.gguf -lm none --ignore-eos --seed 1 --temp 0 --no-conversation -c 2048 -b 2048 -ub 1024 -t 5 -fa 1 --no-warmup --perf --simple-io --no-display-prompt -f /data/local/tmp/heat3way/prompt.txt -n 16 -lv 4 -dev none -ngl 0`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/markers.tsv:L22` `1790599380	END_P-cpu-1-2-3-4-5	rc=0`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/P-cpu-1-2-3-4-5.log:L181` `0.17.989.390 I common_perf_print: prompt eval time =   13127.28 ms /   962 tokens (   13.65 ms per token,    73.28 tokens per second)`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/P-cpu-1-2-3-4-5.log:L182` `0.17.989.393 I common_perf_print:        eval time =     814.53 ms /    15 runs   (   54.30 ms per token,    18.42 tokens per second)`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/P-cpu-1-2-3-4-5.log:L189` `EXIT=0`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/P-cpu-1-2-3-4-5.log:L125` `0.00.800.325 I load_tensors:          CPU model buffer size =   206.07 MiB`
> `/tmp/s23-heat-abc/prefill-run-summary.tsv:L6` `archival-primary-cpu	5	P-cpu-1-2-3-4-5	none -ngl 0	962	15	13127.28	19.0	37.8	37.8	0.0	39.1	39.1	0.0	8.7	39.1	8.7	59.9	59.5	74.1	55.1	53.5	57.8	54.1	52.5	56.1	0	PASS	not-recorded-in-archival-marker	markers.tsv:L21	markers.tsv:L22	174	185	/tmp/s23-heat-abc/prior/raw/device-out/out/P-cpu-1-2-3-4-5.log`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L62` `archival-primary-cpu	P-cpu-1-2-3-4-5	battery_start	37.8	battery_dC	174	1790599361	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790599361 battery_dC=378 skin_C=39.1 battery_dC=378`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L63` `archival-primary-cpu	P-cpu-1-2-3-4-5	battery_peak	37.8	battery_dC	174	1790599361	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790599361 battery_dC=378 skin_C=39.1 battery_dC=378`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L64` `archival-primary-cpu	P-cpu-1-2-3-4-5	battery_end	37.8	battery_dC	185	1790599381	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790599381 battery_dC=378 skin_C=39.1 battery_dC=378`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L65` `archival-primary-cpu	P-cpu-1-2-3-4-5	skin_start	39.1	skin_C	174	1790599361	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790599361 battery_dC=378 skin_C=39.1 skin_C=39.1`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L66` `archival-primary-cpu	P-cpu-1-2-3-4-5	skin_peak	39.1	skin_C	174	1790599361	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790599361 battery_dC=378 skin_C=39.1 skin_C=39.1`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L67` `archival-primary-cpu	P-cpu-1-2-3-4-5	skin_end	39.1	skin_C	185	1790599381	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790599381 battery_dC=378 skin_C=39.1 skin_C=39.1`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L69` `archival-primary-cpu	P-cpu-1-2-3-4-5	CPU_peak	74.1	cpu-1-10	183	1790599377	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790599377 battery_dC=378 skin_C=39.1 cpu-1-10=74100`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L72` `archival-primary-cpu	P-cpu-1-2-3-4-5	GPU_peak	57.8	gpuss-4	179	1790599369	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790599369 battery_dC=378 skin_C=39.1 gpuss-4=57800`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L75` `archival-primary-cpu	P-cpu-1-2-3-4-5	NSP_peak	56.1	nspss-0	184	1790599379	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790599379 battery_dC=378 skin_C=39.1 nspss-0=56100`

### archival-primary-cpu — P-cpu-1-2-3-4-5-6

> `/tmp/s23-heat-abc/prior/raw/device-out/out/markers.tsv:L25` `1790599380	START_P-cpu-1-2-3-4-5-6	cmd=timeout -s KILL 300 ./bin/llama-completion -m /data/local/tmp/heat3way/ship.gguf -lm none --ignore-eos --seed 1 --temp 0 --no-conversation -c 2048 -b 2048 -ub 1024 -t 5 -fa 1 --no-warmup --perf --simple-io --no-display-prompt -f /data/local/tmp/heat3way/prompt.txt -n 16 -lv 4 -dev none -ngl 0`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/markers.tsv:L26` `1790599408	END_P-cpu-1-2-3-4-5-6	rc=0`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/P-cpu-1-2-3-4-5-6.log:L181` `0.27.199.644 I common_perf_print: prompt eval time =   22047.84 ms /   962 tokens (   22.92 ms per token,    43.63 tokens per second)`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/P-cpu-1-2-3-4-5-6.log:L182` `0.27.199.646 I common_perf_print:        eval time =     962.66 ms /    15 runs   (   64.18 ms per token,    15.58 tokens per second)`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/P-cpu-1-2-3-4-5-6.log:L189` `EXIT=0`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/P-cpu-1-2-3-4-5-6.log:L125` `0.00.814.654 I load_tensors:          CPU model buffer size =   206.07 MiB`
> `/tmp/s23-heat-abc/prefill-run-summary.tsv:L7` `archival-primary-cpu	6	P-cpu-1-2-3-4-5-6	none -ngl 0	962	15	22047.84	28.0	37.8	38.2	0.4	39.1	39.0	-0.1	8.6	39.2	8.8	68.5	53.1	70.9	56.6	49.1	55.5	56.1	49.7	53.7	0	PASS	not-recorded-in-archival-marker	markers.tsv:L25	markers.tsv:L26	184	200	/tmp/s23-heat-abc/prior/raw/device-out/out/P-cpu-1-2-3-4-5-6.log`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L77` `archival-primary-cpu	P-cpu-1-2-3-4-5-6	battery_start	37.8	battery_dC	184	1790599379	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790599379 battery_dC=378 skin_C=39.1 battery_dC=378`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L78` `archival-primary-cpu	P-cpu-1-2-3-4-5-6	battery_peak	38.2	battery_dC	187	1790599384	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790599384 battery_dC=382 skin_C=39.1 battery_dC=382`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L79` `archival-primary-cpu	P-cpu-1-2-3-4-5-6	battery_end	38.2	battery_dC	200	1790599408	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790599408 battery_dC=382 skin_C=39.0 battery_dC=382`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L80` `archival-primary-cpu	P-cpu-1-2-3-4-5-6	skin_start	39.1	skin_C	184	1790599379	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790599379 battery_dC=378 skin_C=39.1 skin_C=39.1`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L81` `archival-primary-cpu	P-cpu-1-2-3-4-5-6	skin_peak	39.2	skin_C	190	1790599388	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790599388 battery_dC=382 skin_C=39.2 skin_C=39.2`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L82` `archival-primary-cpu	P-cpu-1-2-3-4-5-6	skin_end	39.0	skin_C	200	1790599408	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790599408 battery_dC=382 skin_C=39.0 skin_C=39.0`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L84` `archival-primary-cpu	P-cpu-1-2-3-4-5-6	CPU_peak	70.9	cpu-1-10	189	1790599387	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790599387 battery_dC=382 skin_C=39.1 cpu-1-10=70900`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L87` `archival-primary-cpu	P-cpu-1-2-3-4-5-6	GPU_peak	55.5	gpuss-4	188	1790599385	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790599385 battery_dC=382 skin_C=39.1 gpuss-4=55500`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L90` `archival-primary-cpu	P-cpu-1-2-3-4-5-6	NSP_peak	53.7	nspss-0	199	1790599407	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790599407 battery_dC=382 skin_C=39.1 nspss-0=53700`

### archival-primary-gpu — P-gpu-1

> `/tmp/s23-heat-abc/prior/raw/device-out/out/markers.tsv:L33` `1790600111	START_P-gpu-1	cmd=timeout -s KILL 300 ./bin/llama-completion -m /data/local/tmp/heat3way/ship.gguf -lm none --ignore-eos --seed 1 --temp 0 --no-conversation -c 2048 -b 2048 -ub 1024 -t 5 -fa 1 --no-warmup --perf --simple-io --no-display-prompt -f /data/local/tmp/heat3way/prompt.txt -n 16 -lv 4 -dev GPUOpenCL -ngl 99`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/markers.tsv:L34` `1790600126	END_P-gpu-1	rc=0`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/P-gpu-1.log:L206` `0.14.936.038 I common_perf_print: prompt eval time =    6939.62 ms /   962 tokens (    7.21 ms per token,   138.62 tokens per second)`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/P-gpu-1.log:L207` `0.14.936.041 I common_perf_print:        eval time =    1176.29 ms /    15 runs   (   78.42 ms per token,    12.75 tokens per second)`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/P-gpu-1.log:L215` `EXIT=0`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/P-gpu-1.log:L131` `0.01.125.461 I load_tensors:       OpenCL model buffer size =  1307.20 MiB`
> `/tmp/s23-heat-abc/prefill-run-summary.tsv:L8` `archival-primary-gpu	1	P-gpu-1	GPUOpenCL -ngl 99	962	15	6939.62	15.0	33.0	33.0	0.0	33.1	33.3	0.2	0.2	33.3	0.2	55.5	76.2	88.7	42.4	59.8	74.9	39.0	54.1	58.9	0	PASS	not-recorded-in-archival-marker	markers.tsv:L33	markers.tsv:L34	619	631	/tmp/s23-heat-abc/prior/raw/device-out/out/P-gpu-1.log`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L92` `archival-primary-gpu	P-gpu-1	battery_start	33.0	battery_dC	619	1790600111	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600111 battery_dC=330 skin_C=33.1 battery_dC=330`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L93` `archival-primary-gpu	P-gpu-1	battery_peak	33.0	battery_dC	619	1790600111	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600111 battery_dC=330 skin_C=33.1 battery_dC=330`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L94` `archival-primary-gpu	P-gpu-1	battery_end	33.0	battery_dC	631	1790600126	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600126 battery_dC=330 skin_C=33.3 battery_dC=330`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L95` `archival-primary-gpu	P-gpu-1	skin_start	33.1	skin_C	619	1790600111	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600111 battery_dC=330 skin_C=33.1 skin_C=33.1`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L96` `archival-primary-gpu	P-gpu-1	skin_peak	33.3	skin_C	625	1790600118	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600118 battery_dC=330 skin_C=33.3 skin_C=33.3`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L97` `archival-primary-gpu	P-gpu-1	skin_end	33.3	skin_C	631	1790600126	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600126 battery_dC=330 skin_C=33.3 skin_C=33.3`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L99` `archival-primary-gpu	P-gpu-1	CPU_peak	88.7	cpu-1-9	630	1790600125	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600125 battery_dC=330 skin_C=33.3 cpu-1-9=88700`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L102` `archival-primary-gpu	P-gpu-1	GPU_peak	74.9	gpuss-2	629	1790600123	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600123 battery_dC=330 skin_C=33.3 gpuss-2=74900`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L105` `archival-primary-gpu	P-gpu-1	NSP_peak	58.9	nspss-0	630	1790600125	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600125 battery_dC=330 skin_C=33.3 nspss-0=58900`

### archival-primary-gpu — P-gpu-1-2

> `/tmp/s23-heat-abc/prior/raw/device-out/out/markers.tsv:L37` `1790600127	START_P-gpu-1-2	cmd=timeout -s KILL 300 ./bin/llama-completion -m /data/local/tmp/heat3way/ship.gguf -lm none --ignore-eos --seed 1 --temp 0 --no-conversation -c 2048 -b 2048 -ub 1024 -t 5 -fa 1 --no-warmup --perf --simple-io --no-display-prompt -f /data/local/tmp/heat3way/prompt.txt -n 16 -lv 4 -dev GPUOpenCL -ngl 99`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/markers.tsv:L38` `1790600142	END_P-gpu-1-2	rc=0`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/P-gpu-1-2.log:L206` `0.14.788.349 I common_perf_print: prompt eval time =    6941.77 ms /   962 tokens (    7.22 ms per token,   138.58 tokens per second)`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/P-gpu-1-2.log:L207` `0.14.788.355 I common_perf_print:        eval time =    1165.94 ms /    15 runs   (   77.73 ms per token,    12.87 tokens per second)`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/P-gpu-1-2.log:L215` `EXIT=0`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/P-gpu-1-2.log:L131` `0.01.047.832 I load_tensors:       OpenCL model buffer size =  1307.20 MiB`
> `/tmp/s23-heat-abc/prefill-run-summary.tsv:L9` `archival-primary-gpu	2	P-gpu-1-2	GPUOpenCL -ngl 99	962	15	6941.77	15.0	33.0	34.5	1.5	33.3	34.7	1.4	1.6	34.7	1.6	76.2	79.4	83.5	59.8	59.8	78.5	54.1	55.7	59.7	0	PASS	not-recorded-in-archival-marker	markers.tsv:L37	markers.tsv:L38	631	643	/tmp/s23-heat-abc/prior/raw/device-out/out/P-gpu-1-2.log`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L107` `archival-primary-gpu	P-gpu-1-2	battery_start	33.0	battery_dC	631	1790600126	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600126 battery_dC=330 skin_C=33.3 battery_dC=330`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L108` `archival-primary-gpu	P-gpu-1-2	battery_peak	34.5	battery_dC	640	1790600138	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600138 battery_dC=345 skin_C=34.7 battery_dC=345`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L109` `archival-primary-gpu	P-gpu-1-2	battery_end	34.5	battery_dC	643	1790600143	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600143 battery_dC=345 skin_C=34.7 battery_dC=345`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L110` `archival-primary-gpu	P-gpu-1-2	skin_start	33.3	skin_C	631	1790600126	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600126 battery_dC=330 skin_C=33.3 skin_C=33.3`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L111` `archival-primary-gpu	P-gpu-1-2	skin_peak	34.7	skin_C	640	1790600138	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600138 battery_dC=345 skin_C=34.7 skin_C=34.7`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L112` `archival-primary-gpu	P-gpu-1-2	skin_end	34.7	skin_C	643	1790600143	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600143 battery_dC=345 skin_C=34.7 skin_C=34.7`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L114` `archival-primary-gpu	P-gpu-1-2	CPU_peak	83.5	cpu-1-0	641	1790600140	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600140 battery_dC=345 skin_C=34.7 cpu-1-0=83500`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L117` `archival-primary-gpu	P-gpu-1-2	GPU_peak	78.5	gpuss-2	640	1790600138	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600138 battery_dC=345 skin_C=34.7 gpuss-2=78500`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L120` `archival-primary-gpu	P-gpu-1-2	NSP_peak	59.7	nspss-0	641	1790600140	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600140 battery_dC=345 skin_C=34.7 nspss-0=59700`

### archival-primary-gpu — P-gpu-1-2-3

> `/tmp/s23-heat-abc/prior/raw/device-out/out/markers.tsv:L41` `1790600142	START_P-gpu-1-2-3	cmd=timeout -s KILL 300 ./bin/llama-completion -m /data/local/tmp/heat3way/ship.gguf -lm none --ignore-eos --seed 1 --temp 0 --no-conversation -c 2048 -b 2048 -ub 1024 -t 5 -fa 1 --no-warmup --perf --simple-io --no-display-prompt -f /data/local/tmp/heat3way/prompt.txt -n 16 -lv 4 -dev GPUOpenCL -ngl 99`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/markers.tsv:L42` `1790600157	END_P-gpu-1-2-3	rc=0`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/P-gpu-1-2-3.log:L206` `0.14.576.403 I common_perf_print: prompt eval time =    7028.13 ms /   962 tokens (    7.31 ms per token,   136.88 tokens per second)`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/P-gpu-1-2-3.log:L207` `0.14.576.406 I common_perf_print:        eval time =    1126.73 ms /    15 runs   (   75.12 ms per token,    13.31 tokens per second)`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/P-gpu-1-2-3.log:L215` `EXIT=0`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/P-gpu-1-2-3.log:L131` `0.01.051.914 I load_tensors:       OpenCL model buffer size =  1307.20 MiB`
> `/tmp/s23-heat-abc/prefill-run-summary.tsv:L10` `archival-primary-gpu	3	P-gpu-1-2-3	GPUOpenCL -ngl 99	962	15	7028.13	15.0	34.5	34.5	0.0	34.7	36.1	1.4	3.0	35.3	2.2	70.1	79.0	87.1	60.6	62.6	79.6	58.1	57.3	62.5	0	PASS	not-recorded-in-archival-marker	markers.tsv:L41	markers.tsv:L42	642	654	/tmp/s23-heat-abc/prior/raw/device-out/out/P-gpu-1-2-3.log`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L122` `archival-primary-gpu	P-gpu-1-2-3	battery_start	34.5	battery_dC	642	1790600141	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600141 battery_dC=345 skin_C=34.7 battery_dC=345`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L123` `archival-primary-gpu	P-gpu-1-2-3	battery_peak	34.5	battery_dC	643	1790600143	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600143 battery_dC=345 skin_C=34.7 battery_dC=345`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L124` `archival-primary-gpu	P-gpu-1-2-3	battery_end	34.5	battery_dC	654	1790600158	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600158 battery_dC=345 skin_C=36.1 battery_dC=345`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L125` `archival-primary-gpu	P-gpu-1-2-3	skin_start	34.7	skin_C	642	1790600141	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600141 battery_dC=345 skin_C=34.7 skin_C=34.7`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L126` `archival-primary-gpu	P-gpu-1-2-3	skin_peak	35.3	skin_C	647	1790600148	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600148 battery_dC=345 skin_C=35.3 skin_C=35.3`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L127` `archival-primary-gpu	P-gpu-1-2-3	skin_end	36.1	skin_C	654	1790600158	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600158 battery_dC=345 skin_C=36.1 skin_C=36.1`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L129` `archival-primary-gpu	P-gpu-1-2-3	CPU_peak	87.1	cpu-1-1	652	1790600155	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600155 battery_dC=345 skin_C=35.3 cpu-1-1=87100`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L132` `archival-primary-gpu	P-gpu-1-2-3	GPU_peak	79.6	gpuss-2	651	1790600153	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600153 battery_dC=345 skin_C=35.3 gpuss-2=79600`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L135` `archival-primary-gpu	P-gpu-1-2-3	NSP_peak	62.5	nspss-0	653	1790600156	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600156 battery_dC=345 skin_C=35.3 nspss-0=62500`

### archival-primary-gpu — P-gpu-1-2-3-4

> `/tmp/s23-heat-abc/prior/raw/device-out/out/markers.tsv:L45` `1790600158	START_P-gpu-1-2-3-4	cmd=timeout -s KILL 300 ./bin/llama-completion -m /data/local/tmp/heat3way/ship.gguf -lm none --ignore-eos --seed 1 --temp 0 --no-conversation -c 2048 -b 2048 -ub 1024 -t 5 -fa 1 --no-warmup --perf --simple-io --no-display-prompt -f /data/local/tmp/heat3way/prompt.txt -n 16 -lv 4 -dev GPUOpenCL -ngl 99`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/markers.tsv:L46` `1790600175	END_P-gpu-1-2-3-4	rc=0`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/P-gpu-1-2-3-4.log:L206` `0.16.954.028 I common_perf_print: prompt eval time =    7346.39 ms /   962 tokens (    7.64 ms per token,   130.95 tokens per second)`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/P-gpu-1-2-3-4.log:L207` `0.16.954.034 I common_perf_print:        eval time =    1194.82 ms /    15 runs   (   79.65 ms per token,    12.55 tokens per second)`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/P-gpu-1-2-3-4.log:L215` `EXIT=0`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/P-gpu-1-2-3-4.log:L131` `0.01.037.561 I load_tensors:       OpenCL model buffer size =  1307.20 MiB`
> `/tmp/s23-heat-abc/prefill-run-summary.tsv:L11` `archival-primary-gpu	4	P-gpu-1-2-3-4	GPUOpenCL -ngl 99	962	15	7346.39	17.0	34.5	36.3	1.8	36.1	36.1	0.0	3.0	36.1	3.0	79.0	79.4	88.3	62.6	61.0	80.0	57.3	57.3	62.5	0	PASS	not-recorded-in-archival-marker	markers.tsv:L45	markers.tsv:L46	654	667	/tmp/s23-heat-abc/prior/raw/device-out/out/P-gpu-1-2-3-4.log`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L137` `archival-primary-gpu	P-gpu-1-2-3-4	battery_start	34.5	battery_dC	654	1790600158	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600158 battery_dC=345 skin_C=36.1 battery_dC=345`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L138` `archival-primary-gpu	P-gpu-1-2-3-4	battery_peak	36.3	battery_dC	662	1790600168	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600168 battery_dC=363 skin_C=36.1 battery_dC=363`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L139` `archival-primary-gpu	P-gpu-1-2-3-4	battery_end	36.3	battery_dC	667	1790600175	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600175 battery_dC=363 skin_C=36.1 battery_dC=363`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L140` `archival-primary-gpu	P-gpu-1-2-3-4	skin_start	36.1	skin_C	654	1790600158	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600158 battery_dC=345 skin_C=36.1 skin_C=36.1`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L141` `archival-primary-gpu	P-gpu-1-2-3-4	skin_peak	36.1	skin_C	654	1790600158	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600158 battery_dC=345 skin_C=36.1 skin_C=36.1`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L142` `archival-primary-gpu	P-gpu-1-2-3-4	skin_end	36.1	skin_C	667	1790600175	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600175 battery_dC=363 skin_C=36.1 skin_C=36.1`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L144` `archival-primary-gpu	P-gpu-1-2-3-4	CPU_peak	88.3	cpu-1-1	665	1790600172	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600172 battery_dC=363 skin_C=36.1 cpu-1-1=88300`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L147` `archival-primary-gpu	P-gpu-1-2-3-4	GPU_peak	80.0	gpuss-2	665	1790600172	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600172 battery_dC=363 skin_C=36.1 gpuss-2=80000`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L150` `archival-primary-gpu	P-gpu-1-2-3-4	NSP_peak	62.5	nspss-0	666	1790600174	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600174 battery_dC=363 skin_C=36.1 nspss-0=62500`

### archival-primary-gpu — P-gpu-1-2-3-4-5

> `/tmp/s23-heat-abc/prior/raw/device-out/out/markers.tsv:L49` `1790600176	START_P-gpu-1-2-3-4-5	cmd=timeout -s KILL 300 ./bin/llama-completion -m /data/local/tmp/heat3way/ship.gguf -lm none --ignore-eos --seed 1 --temp 0 --no-conversation -c 2048 -b 2048 -ub 1024 -t 5 -fa 1 --no-warmup --perf --simple-io --no-display-prompt -f /data/local/tmp/heat3way/prompt.txt -n 16 -lv 4 -dev GPUOpenCL -ngl 99`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/markers.tsv:L50` `1790600194	END_P-gpu-1-2-3-4-5	rc=0`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/P-gpu-1-2-3-4-5.log:L206` `0.18.173.499 I common_perf_print: prompt eval time =    8411.25 ms /   962 tokens (    8.74 ms per token,   114.37 tokens per second)`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/P-gpu-1-2-3-4-5.log:L207` `0.18.173.505 I common_perf_print:        eval time =    1388.42 ms /    15 runs   (   92.56 ms per token,    10.80 tokens per second)`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/P-gpu-1-2-3-4-5.log:L215` `EXIT=0`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/P-gpu-1-2-3-4-5.log:L131` `0.01.058.316 I load_tensors:       OpenCL model buffer size =  1307.20 MiB`
> `/tmp/s23-heat-abc/prefill-run-summary.tsv:L12` `archival-primary-gpu	5	P-gpu-1-2-3-4-5	GPUOpenCL -ngl 99	962	15	8411.25	18.0	36.3	36.3	0.0	36.1	37.0	0.9	3.9	37.0	3.9	79.4	79.4	89.1	61.0	61.8	73.7	57.3	56.5	60.1	0	PASS	not-recorded-in-archival-marker	markers.tsv:L49	markers.tsv:L50	667	681	/tmp/s23-heat-abc/prior/raw/device-out/out/P-gpu-1-2-3-4-5.log`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L152` `archival-primary-gpu	P-gpu-1-2-3-4-5	battery_start	36.3	battery_dC	667	1790600175	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600175 battery_dC=363 skin_C=36.1 battery_dC=363`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L153` `archival-primary-gpu	P-gpu-1-2-3-4-5	battery_peak	36.3	battery_dC	668	1790600177	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600177 battery_dC=363 skin_C=36.1 battery_dC=363`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L154` `archival-primary-gpu	P-gpu-1-2-3-4-5	battery_end	36.3	battery_dC	681	1790600195	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600195 battery_dC=363 skin_C=37.0 battery_dC=363`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L155` `archival-primary-gpu	P-gpu-1-2-3-4-5	skin_start	36.1	skin_C	667	1790600175	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600175 battery_dC=363 skin_C=36.1 skin_C=36.1`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L156` `archival-primary-gpu	P-gpu-1-2-3-4-5	skin_peak	37.0	skin_C	676	1790600187	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600187 battery_dC=363 skin_C=37.0 skin_C=37.0`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L157` `archival-primary-gpu	P-gpu-1-2-3-4-5	skin_end	37.0	skin_C	681	1790600195	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600195 battery_dC=363 skin_C=37.0 skin_C=37.0`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L159` `archival-primary-gpu	P-gpu-1-2-3-4-5	CPU_peak	89.1	cpu-1-5	680	1790600193	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600193 battery_dC=363 skin_C=37.0 cpu-1-5=89100`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L162` `archival-primary-gpu	P-gpu-1-2-3-4-5	GPU_peak	73.7	gpuss-3	678	1790600190	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600190 battery_dC=363 skin_C=37.0 gpuss-3=73700`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L165` `archival-primary-gpu	P-gpu-1-2-3-4-5	NSP_peak	60.1	nspss-0	680	1790600193	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600193 battery_dC=363 skin_C=37.0 nspss-0=60100`

### archival-primary-gpu — P-gpu-1-2-3-4-5-6

> `/tmp/s23-heat-abc/prior/raw/device-out/out/markers.tsv:L53` `1790600195	START_P-gpu-1-2-3-4-5-6	cmd=timeout -s KILL 300 ./bin/llama-completion -m /data/local/tmp/heat3way/ship.gguf -lm none --ignore-eos --seed 1 --temp 0 --no-conversation -c 2048 -b 2048 -ub 1024 -t 5 -fa 1 --no-warmup --perf --simple-io --no-display-prompt -f /data/local/tmp/heat3way/prompt.txt -n 16 -lv 4 -dev GPUOpenCL -ngl 99`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/markers.tsv:L54` `1790600214	END_P-gpu-1-2-3-4-5-6	rc=0`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/P-gpu-1-2-3-4-5-6.log:L206` `0.18.781.377 I common_perf_print: prompt eval time =    8784.58 ms /   962 tokens (    9.13 ms per token,   109.51 tokens per second)`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/P-gpu-1-2-3-4-5-6.log:L207` `0.18.781.382 I common_perf_print:        eval time =    1512.48 ms /    15 runs   (  100.83 ms per token,     9.92 tokens per second)`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/P-gpu-1-2-3-4-5-6.log:L215` `EXIT=0`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/P-gpu-1-2-3-4-5-6.log:L131` `0.01.046.371 I load_tensors:       OpenCL model buffer size =  1307.20 MiB`
> `/tmp/s23-heat-abc/prefill-run-summary.tsv:L13` `archival-primary-gpu	6	P-gpu-1-2-3-4-5-6	GPUOpenCL -ngl 99	962	15	8784.58	19.0	36.3	37.2	0.9	37.0	37.5	0.5	4.4	37.5	4.4	79.4	85.1	87.1	61.8	61.0	71.3	56.5	56.1	59.7	0	PASS	not-recorded-in-archival-marker	markers.tsv:L53	markers.tsv:L54	681	695	/tmp/s23-heat-abc/prior/raw/device-out/out/P-gpu-1-2-3-4-5-6.log`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L167` `archival-primary-gpu	P-gpu-1-2-3-4-5-6	battery_start	36.3	battery_dC	681	1790600195	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600195 battery_dC=363 skin_C=37.0 battery_dC=363`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L168` `archival-primary-gpu	P-gpu-1-2-3-4-5-6	battery_peak	37.2	battery_dC	683	1790600198	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600198 battery_dC=372 skin_C=37.3 battery_dC=372`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L169` `archival-primary-gpu	P-gpu-1-2-3-4-5-6	battery_end	37.2	battery_dC	695	1790600215	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600215 battery_dC=372 skin_C=37.5 battery_dC=372`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L170` `archival-primary-gpu	P-gpu-1-2-3-4-5-6	skin_start	37.0	skin_C	681	1790600195	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600195 battery_dC=363 skin_C=37.0 skin_C=37.0`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L171` `archival-primary-gpu	P-gpu-1-2-3-4-5-6	skin_peak	37.5	skin_C	691	1790600208	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600208 battery_dC=372 skin_C=37.5 skin_C=37.5`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L172` `archival-primary-gpu	P-gpu-1-2-3-4-5-6	skin_end	37.5	skin_C	695	1790600215	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600215 battery_dC=372 skin_C=37.5 skin_C=37.5`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L174` `archival-primary-gpu	P-gpu-1-2-3-4-5-6	CPU_peak	87.1	cpu-1-5	694	1790600213	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600213 battery_dC=372 skin_C=37.5 cpu-1-5=87100`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L177` `archival-primary-gpu	P-gpu-1-2-3-4-5-6	GPU_peak	71.3	gpuss-2	691	1790600208	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600208 battery_dC=372 skin_C=37.5 gpuss-2=71300`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L180` `archival-primary-gpu	P-gpu-1-2-3-4-5-6	NSP_peak	59.7	nspss-0	694	1790600213	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600213 battery_dC=372 skin_C=37.5 nspss-0=59700`

### archival-primary-gpu — P-gpu-1-2-3-4-5-6-7

> `/tmp/s23-heat-abc/prior/raw/device-out/out/markers.tsv:L57` `1790600215	START_P-gpu-1-2-3-4-5-6-7	cmd=timeout -s KILL 300 ./bin/llama-completion -m /data/local/tmp/heat3way/ship.gguf -lm none --ignore-eos --seed 1 --temp 0 --no-conversation -c 2048 -b 2048 -ub 1024 -t 5 -fa 1 --no-warmup --perf --simple-io --no-display-prompt -f /data/local/tmp/heat3way/prompt.txt -n 16 -lv 4 -dev GPUOpenCL -ngl 99`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/markers.tsv:L58` `1790600234	END_P-gpu-1-2-3-4-5-6-7	rc=0`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/P-gpu-1-2-3-4-5-6-7.log:L206` `0.18.812.271 I common_perf_print: prompt eval time =    8775.81 ms /   962 tokens (    9.12 ms per token,   109.62 tokens per second)`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/P-gpu-1-2-3-4-5-6-7.log:L207` `0.18.812.276 I common_perf_print:        eval time =    1578.69 ms /    15 runs   (  105.25 ms per token,     9.50 tokens per second)`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/P-gpu-1-2-3-4-5-6-7.log:L215` `EXIT=0`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/P-gpu-1-2-3-4-5-6-7.log:L131` `0.01.072.930 I load_tensors:       OpenCL model buffer size =  1307.20 MiB`
> `/tmp/s23-heat-abc/prefill-run-summary.tsv:L14` `archival-primary-gpu	7	P-gpu-1-2-3-4-5-6-7	GPUOpenCL -ngl 99	962	15	8775.81	19.0	37.2	37.7	0.5	37.5	37.9	0.4	4.8	37.9	4.8	85.1	82.6	89.1	61.0	61.0	71.7	56.1	55.7	58.9	0	PASS	not-recorded-in-archival-marker	markers.tsv:L57	markers.tsv:L58	695	709	/tmp/s23-heat-abc/prior/raw/device-out/out/P-gpu-1-2-3-4-5-6-7.log`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L182` `archival-primary-gpu	P-gpu-1-2-3-4-5-6-7	battery_start	37.2	battery_dC	695	1790600215	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600215 battery_dC=372 skin_C=37.5 battery_dC=372`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L183` `archival-primary-gpu	P-gpu-1-2-3-4-5-6-7	battery_peak	37.7	battery_dC	705	1790600228	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600228 battery_dC=377 skin_C=37.9 battery_dC=377`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L184` `archival-primary-gpu	P-gpu-1-2-3-4-5-6-7	battery_end	37.7	battery_dC	709	1790600234	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600234 battery_dC=377 skin_C=37.9 battery_dC=377`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L185` `archival-primary-gpu	P-gpu-1-2-3-4-5-6-7	skin_start	37.5	skin_C	695	1790600215	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600215 battery_dC=372 skin_C=37.5 skin_C=37.5`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L186` `archival-primary-gpu	P-gpu-1-2-3-4-5-6-7	skin_peak	37.9	skin_C	705	1790600228	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600228 battery_dC=377 skin_C=37.9 skin_C=37.9`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L187` `archival-primary-gpu	P-gpu-1-2-3-4-5-6-7	skin_end	37.9	skin_C	709	1790600234	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600234 battery_dC=377 skin_C=37.9 skin_C=37.9`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L189` `archival-primary-gpu	P-gpu-1-2-3-4-5-6-7	CPU_peak	89.1	cpu-1-5	708	1790600233	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600233 battery_dC=377 skin_C=37.9 cpu-1-5=89100`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L192` `archival-primary-gpu	P-gpu-1-2-3-4-5-6-7	GPU_peak	71.7	gpuss-2	705	1790600228	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600228 battery_dC=377 skin_C=37.9 gpuss-2=71700`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L195` `archival-primary-gpu	P-gpu-1-2-3-4-5-6-7	NSP_peak	58.9	nspss-0	708	1790600233	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600233 battery_dC=377 skin_C=37.9 nspss-0=58900`

### archival-primary-gpu — P-gpu-1-2-3-4-5-6-7-8

> `/tmp/s23-heat-abc/prior/raw/device-out/out/markers.tsv:L61` `1790600235	START_P-gpu-1-2-3-4-5-6-7-8	cmd=timeout -s KILL 300 ./bin/llama-completion -m /data/local/tmp/heat3way/ship.gguf -lm none --ignore-eos --seed 1 --temp 0 --no-conversation -c 2048 -b 2048 -ub 1024 -t 5 -fa 1 --no-warmup --perf --simple-io --no-display-prompt -f /data/local/tmp/heat3way/prompt.txt -n 16 -lv 4 -dev GPUOpenCL -ngl 99`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/markers.tsv:L62` `1790600254	END_P-gpu-1-2-3-4-5-6-7-8	rc=0`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/P-gpu-1-2-3-4-5-6-7-8.log:L206` `0.18.710.374 I common_perf_print: prompt eval time =    8799.08 ms /   962 tokens (    9.15 ms per token,   109.33 tokens per second)`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/P-gpu-1-2-3-4-5-6-7-8.log:L207` `0.18.710.382 I common_perf_print:        eval time =    1500.03 ms /    15 runs   (  100.00 ms per token,    10.00 tokens per second)`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/P-gpu-1-2-3-4-5-6-7-8.log:L215` `EXIT=0`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/P-gpu-1-2-3-4-5-6-7-8.log:L131` `0.01.058.955 I load_tensors:       OpenCL model buffer size =  1307.20 MiB`
> `/tmp/s23-heat-abc/prefill-run-summary.tsv:L15` `archival-primary-gpu	8	P-gpu-1-2-3-4-5-6-7-8	GPUOpenCL -ngl 99	962	15	8799.08	19.0	37.7	37.7	0.0	37.9	38.3	0.4	5.2	38.3	5.2	82.6	77.4	80.2	61.0	62.2	72.1	55.7	56.9	60.1	0	PASS	not-recorded-in-archival-marker	markers.tsv:L61	markers.tsv:L62	709	723	/tmp/s23-heat-abc/prior/raw/device-out/out/P-gpu-1-2-3-4-5-6-7-8.log`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L197` `archival-primary-gpu	P-gpu-1-2-3-4-5-6-7-8	battery_start	37.7	battery_dC	709	1790600234	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600234 battery_dC=377 skin_C=37.9 battery_dC=377`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L198` `archival-primary-gpu	P-gpu-1-2-3-4-5-6-7-8	battery_peak	37.7	battery_dC	710	1790600236	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600236 battery_dC=377 skin_C=37.9 battery_dC=377`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L199` `archival-primary-gpu	P-gpu-1-2-3-4-5-6-7-8	battery_end	37.7	battery_dC	723	1790600254	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600254 battery_dC=377 skin_C=38.3 battery_dC=377`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L200` `archival-primary-gpu	P-gpu-1-2-3-4-5-6-7-8	skin_start	37.9	skin_C	709	1790600234	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600234 battery_dC=377 skin_C=37.9 skin_C=37.9`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L201` `archival-primary-gpu	P-gpu-1-2-3-4-5-6-7-8	skin_peak	38.3	skin_C	719	1790600248	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600248 battery_dC=377 skin_C=38.3 skin_C=38.3`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L202` `archival-primary-gpu	P-gpu-1-2-3-4-5-6-7-8	skin_end	38.3	skin_C	723	1790600254	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600254 battery_dC=377 skin_C=38.3 skin_C=38.3`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L204` `archival-primary-gpu	P-gpu-1-2-3-4-5-6-7-8	CPU_peak	80.2	cpu-1-3	721	1790600251	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600251 battery_dC=377 skin_C=38.3 cpu-1-3=80200`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L207` `archival-primary-gpu	P-gpu-1-2-3-4-5-6-7-8	GPU_peak	72.1	gpuss-2	719	1790600248	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600248 battery_dC=377 skin_C=38.3 gpuss-2=72100`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L210` `archival-primary-gpu	P-gpu-1-2-3-4-5-6-7-8	NSP_peak	60.1	nspss-0	722	1790600253	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600253 battery_dC=377 skin_C=38.3 nspss-0=60100`

### archival-primary-gpu — P-gpu-1-2-3-4-5-6-7-8-9

> `/tmp/s23-heat-abc/prior/raw/device-out/out/markers.tsv:L65` `1790600254	START_P-gpu-1-2-3-4-5-6-7-8-9	cmd=timeout -s KILL 300 ./bin/llama-completion -m /data/local/tmp/heat3way/ship.gguf -lm none --ignore-eos --seed 1 --temp 0 --no-conversation -c 2048 -b 2048 -ub 1024 -t 5 -fa 1 --no-warmup --perf --simple-io --no-display-prompt -f /data/local/tmp/heat3way/prompt.txt -n 16 -lv 4 -dev GPUOpenCL -ngl 99`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/markers.tsv:L66` `1790600273	END_P-gpu-1-2-3-4-5-6-7-8-9	rc=0`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/P-gpu-1-2-3-4-5-6-7-8-9.log:L206` `0.18.690.042 I common_perf_print: prompt eval time =    8760.99 ms /   962 tokens (    9.11 ms per token,   109.80 tokens per second)`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/P-gpu-1-2-3-4-5-6-7-8-9.log:L207` `0.18.690.047 I common_perf_print:        eval time =    1579.13 ms /    15 runs   (  105.28 ms per token,     9.50 tokens per second)`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/P-gpu-1-2-3-4-5-6-7-8-9.log:L215` `EXIT=0`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/P-gpu-1-2-3-4-5-6-7-8-9.log:L131` `0.01.064.246 I load_tensors:       OpenCL model buffer size =  1307.20 MiB`
> `/tmp/s23-heat-abc/prefill-run-summary.tsv:L16` `archival-primary-gpu	9	P-gpu-1-2-3-4-5-6-7-8-9	GPUOpenCL -ngl 99	962	15	8760.99	19.0	37.7	38.4	0.7	38.3	38.7	0.4	5.6	38.7	5.6	77.4	79.8	82.2	62.2	62.6	73.3	56.9	56.9	59.7	0	PASS	not-recorded-in-archival-marker	markers.tsv:L65	markers.tsv:L66	723	737	/tmp/s23-heat-abc/prior/raw/device-out/out/P-gpu-1-2-3-4-5-6-7-8-9.log`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L212` `archival-primary-gpu	P-gpu-1-2-3-4-5-6-7-8-9	battery_start	37.7	battery_dC	723	1790600254	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600254 battery_dC=377 skin_C=38.3 battery_dC=377`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L213` `archival-primary-gpu	P-gpu-1-2-3-4-5-6-7-8-9	battery_peak	38.4	battery_dC	726	1790600258	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600258 battery_dC=384 skin_C=38.5 battery_dC=384`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L214` `archival-primary-gpu	P-gpu-1-2-3-4-5-6-7-8-9	battery_end	38.4	battery_dC	737	1790600274	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600274 battery_dC=384 skin_C=38.7 battery_dC=384`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L215` `archival-primary-gpu	P-gpu-1-2-3-4-5-6-7-8-9	skin_start	38.3	skin_C	723	1790600254	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600254 battery_dC=377 skin_C=38.3 skin_C=38.3`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L216` `archival-primary-gpu	P-gpu-1-2-3-4-5-6-7-8-9	skin_peak	38.7	skin_C	733	1790600267	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600267 battery_dC=384 skin_C=38.7 skin_C=38.7`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L217` `archival-primary-gpu	P-gpu-1-2-3-4-5-6-7-8-9	skin_end	38.7	skin_C	737	1790600274	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600274 battery_dC=384 skin_C=38.7 skin_C=38.7`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L219` `archival-primary-gpu	P-gpu-1-2-3-4-5-6-7-8-9	CPU_peak	82.2	cpu-1-7	736	1790600272	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600272 battery_dC=384 skin_C=38.7 cpu-1-7=82200`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L222` `archival-primary-gpu	P-gpu-1-2-3-4-5-6-7-8-9	GPU_peak	73.3	gpuss-2	734	1790600269	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600269 battery_dC=384 skin_C=38.7 gpuss-2=73300`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L225` `archival-primary-gpu	P-gpu-1-2-3-4-5-6-7-8-9	NSP_peak	59.7	nspss-0	736	1790600272	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600272 battery_dC=384 skin_C=38.7 nspss-0=59700`

### archival-primary-gpu — P-gpu-1-2-3-4-5-6-7-8-9-10

> `/tmp/s23-heat-abc/prior/raw/device-out/out/markers.tsv:L69` `1790600274	START_P-gpu-1-2-3-4-5-6-7-8-9-10	cmd=timeout -s KILL 300 ./bin/llama-completion -m /data/local/tmp/heat3way/ship.gguf -lm none --ignore-eos --seed 1 --temp 0 --no-conversation -c 2048 -b 2048 -ub 1024 -t 5 -fa 1 --no-warmup --perf --simple-io --no-display-prompt -f /data/local/tmp/heat3way/prompt.txt -n 16 -lv 4 -dev GPUOpenCL -ngl 99`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/markers.tsv:L70` `1790600293	END_P-gpu-1-2-3-4-5-6-7-8-9-10	rc=0`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/P-gpu-1-2-3-4-5-6-7-8-9-10.log:L206` `0.18.840.792 I common_perf_print: prompt eval time =    8771.68 ms /   962 tokens (    9.12 ms per token,   109.67 tokens per second)`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/P-gpu-1-2-3-4-5-6-7-8-9-10.log:L207` `0.18.840.798 I common_perf_print:        eval time =    1613.95 ms /    15 runs   (  107.60 ms per token,     9.29 tokens per second)`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/P-gpu-1-2-3-4-5-6-7-8-9-10.log:L215` `EXIT=0`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/P-gpu-1-2-3-4-5-6-7-8-9-10.log:L131` `0.01.064.190 I load_tensors:       OpenCL model buffer size =  1307.20 MiB`
> `/tmp/s23-heat-abc/prefill-run-summary.tsv:L17` `archival-primary-gpu	10	P-gpu-1-2-3-4-5-6-7-8-9-10	GPUOpenCL -ngl 99	962	15	8771.68	19.0	38.4	38.8	0.4	38.7	39.0	0.3	5.9	39.0	5.9	79.8	90.8	85.1	62.6	62.2	72.5	56.9	56.9	60.1	0	PASS	not-recorded-in-archival-marker	markers.tsv:L69	markers.tsv:L70	737	751	/tmp/s23-heat-abc/prior/raw/device-out/out/P-gpu-1-2-3-4-5-6-7-8-9-10.log`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L227` `archival-primary-gpu	P-gpu-1-2-3-4-5-6-7-8-9-10	battery_start	38.4	battery_dC	737	1790600274	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600274 battery_dC=384 skin_C=38.7 battery_dC=384`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L228` `archival-primary-gpu	P-gpu-1-2-3-4-5-6-7-8-9-10	battery_peak	38.8	battery_dC	748	1790600289	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600289 battery_dC=388 skin_C=39.0 battery_dC=388`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L229` `archival-primary-gpu	P-gpu-1-2-3-4-5-6-7-8-9-10	battery_end	38.8	battery_dC	751	1790600294	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600294 battery_dC=388 skin_C=39.0 battery_dC=388`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L230` `archival-primary-gpu	P-gpu-1-2-3-4-5-6-7-8-9-10	skin_start	38.7	skin_C	737	1790600274	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600274 battery_dC=384 skin_C=38.7 skin_C=38.7`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L231` `archival-primary-gpu	P-gpu-1-2-3-4-5-6-7-8-9-10	skin_peak	39.0	skin_C	747	1790600287	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600287 battery_dC=384 skin_C=39.0 skin_C=39.0`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L232` `archival-primary-gpu	P-gpu-1-2-3-4-5-6-7-8-9-10	skin_end	39.0	skin_C	751	1790600294	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600294 battery_dC=388 skin_C=39.0 skin_C=39.0`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L234` `archival-primary-gpu	P-gpu-1-2-3-4-5-6-7-8-9-10	CPU_peak	85.1	cpu-1-7	750	1790600292	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600292 battery_dC=388 skin_C=39.0 cpu-1-7=85100`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L237` `archival-primary-gpu	P-gpu-1-2-3-4-5-6-7-8-9-10	GPU_peak	72.5	gpuss-3	747	1790600287	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600287 battery_dC=384 skin_C=39.0 gpuss-3=72500`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L240` `archival-primary-gpu	P-gpu-1-2-3-4-5-6-7-8-9-10	NSP_peak	60.1	nspss-0	750	1790600292	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600292 battery_dC=388 skin_C=39.0 nspss-0=60100`

### archival-primary-gpu — P-gpu-1-2-3-4-5-6-7-8-9-10-11

> `/tmp/s23-heat-abc/prior/raw/device-out/out/markers.tsv:L73` `1790600294	START_P-gpu-1-2-3-4-5-6-7-8-9-10-11	cmd=timeout -s KILL 300 ./bin/llama-completion -m /data/local/tmp/heat3way/ship.gguf -lm none --ignore-eos --seed 1 --temp 0 --no-conversation -c 2048 -b 2048 -ub 1024 -t 5 -fa 1 --no-warmup --perf --simple-io --no-display-prompt -f /data/local/tmp/heat3way/prompt.txt -n 16 -lv 4 -dev GPUOpenCL -ngl 99`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/markers.tsv:L74` `1790600313	END_P-gpu-1-2-3-4-5-6-7-8-9-10-11	rc=0`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/P-gpu-1-2-3-4-5-6-7-8-9-10-11.log:L206` `0.18.886.431 I common_perf_print: prompt eval time =    8818.89 ms /   962 tokens (    9.17 ms per token,   109.08 tokens per second)`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/P-gpu-1-2-3-4-5-6-7-8-9-10-11.log:L207` `0.18.886.435 I common_perf_print:        eval time =    1567.50 ms /    15 runs   (  104.50 ms per token,     9.57 tokens per second)`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/P-gpu-1-2-3-4-5-6-7-8-9-10-11.log:L215` `EXIT=0`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/P-gpu-1-2-3-4-5-6-7-8-9-10-11.log:L131` `0.01.083.809 I load_tensors:       OpenCL model buffer size =  1307.20 MiB`
> `/tmp/s23-heat-abc/prefill-run-summary.tsv:L18` `archival-primary-gpu	11	P-gpu-1-2-3-4-5-6-7-8-9-10-11	GPUOpenCL -ngl 99	962	15	8818.89	19.0	38.8	38.8	0.0	39.0	39.3	0.3	6.2	39.3	6.2	90.8	74.9	90.8	62.2	61.0	73.3	56.9	57.3	60.5	0	PASS	not-recorded-in-archival-marker	markers.tsv:L73	markers.tsv:L74	751	765	/tmp/s23-heat-abc/prior/raw/device-out/out/P-gpu-1-2-3-4-5-6-7-8-9-10-11.log`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L242` `archival-primary-gpu	P-gpu-1-2-3-4-5-6-7-8-9-10-11	battery_start	38.8	battery_dC	751	1790600294	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600294 battery_dC=388 skin_C=39.0 battery_dC=388`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L243` `archival-primary-gpu	P-gpu-1-2-3-4-5-6-7-8-9-10-11	battery_peak	38.8	battery_dC	751	1790600294	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600294 battery_dC=388 skin_C=39.0 battery_dC=388`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L244` `archival-primary-gpu	P-gpu-1-2-3-4-5-6-7-8-9-10-11	battery_end	38.8	battery_dC	765	1790600313	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600313 battery_dC=388 skin_C=39.3 battery_dC=388`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L245` `archival-primary-gpu	P-gpu-1-2-3-4-5-6-7-8-9-10-11	skin_start	39.0	skin_C	751	1790600294	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600294 battery_dC=388 skin_C=39.0 skin_C=39.0`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L246` `archival-primary-gpu	P-gpu-1-2-3-4-5-6-7-8-9-10-11	skin_peak	39.3	skin_C	762	1790600308	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600308 battery_dC=388 skin_C=39.3 skin_C=39.3`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L247` `archival-primary-gpu	P-gpu-1-2-3-4-5-6-7-8-9-10-11	skin_end	39.3	skin_C	765	1790600313	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600313 battery_dC=388 skin_C=39.3 skin_C=39.3`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L249` `archival-primary-gpu	P-gpu-1-2-3-4-5-6-7-8-9-10-11	CPU_peak	90.8	cpu-1-9	751	1790600294	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600294 battery_dC=388 skin_C=39.0 cpu-1-9=90800`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L252` `archival-primary-gpu	P-gpu-1-2-3-4-5-6-7-8-9-10-11	GPU_peak	73.3	gpuss-2	761	1790600307	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600307 battery_dC=388 skin_C=39.2 gpuss-2=73300`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L255` `archival-primary-gpu	P-gpu-1-2-3-4-5-6-7-8-9-10-11	NSP_peak	60.5	nspss-0	764	1790600312	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600312 battery_dC=388 skin_C=39.3 nspss-0=60500`

### archival-primary-gpu — P-gpu-1-2-3-4-5-6-7-8-9-10-11-12

> `/tmp/s23-heat-abc/prior/raw/device-out/out/markers.tsv:L77` `1790600314	START_P-gpu-1-2-3-4-5-6-7-8-9-10-11-12	cmd=timeout -s KILL 300 ./bin/llama-completion -m /data/local/tmp/heat3way/ship.gguf -lm none --ignore-eos --seed 1 --temp 0 --no-conversation -c 2048 -b 2048 -ub 1024 -t 5 -fa 1 --no-warmup --perf --simple-io --no-display-prompt -f /data/local/tmp/heat3way/prompt.txt -n 16 -lv 4 -dev GPUOpenCL -ngl 99`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/markers.tsv:L78` `1790600333	END_P-gpu-1-2-3-4-5-6-7-8-9-10-11-12	rc=0`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/P-gpu-1-2-3-4-5-6-7-8-9-10-11-12.log:L206` `0.18.726.085 I common_perf_print: prompt eval time =    8786.13 ms /   962 tokens (    9.13 ms per token,   109.49 tokens per second)`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/P-gpu-1-2-3-4-5-6-7-8-9-10-11-12.log:L207` `0.18.726.089 I common_perf_print:        eval time =    1520.58 ms /    15 runs   (  101.37 ms per token,     9.86 tokens per second)`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/P-gpu-1-2-3-4-5-6-7-8-9-10-11-12.log:L215` `EXIT=0`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/P-gpu-1-2-3-4-5-6-7-8-9-10-11-12.log:L131` `0.01.064.152 I load_tensors:       OpenCL model buffer size =  1307.20 MiB`
> `/tmp/s23-heat-abc/prefill-run-summary.tsv:L19` `archival-primary-gpu	12	P-gpu-1-2-3-4-5-6-7-8-9-10-11-12	GPUOpenCL -ngl 99	962	15	8786.13	19.0	38.8	39.3	0.5	39.3	39.6	0.3	6.5	39.6	6.5	74.9	71.7	87.5	61.0	58.6	74.5	57.3	58.5	60.5	0	PASS	not-recorded-in-archival-marker	markers.tsv:L77	markers.tsv:L78	765	779	/tmp/s23-heat-abc/prior/raw/device-out/out/P-gpu-1-2-3-4-5-6-7-8-9-10-11-12.log`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L257` `archival-primary-gpu	P-gpu-1-2-3-4-5-6-7-8-9-10-11-12	battery_start	38.8	battery_dC	765	1790600313	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600313 battery_dC=388 skin_C=39.3 battery_dC=388`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L258` `archival-primary-gpu	P-gpu-1-2-3-4-5-6-7-8-9-10-11-12	battery_peak	39.3	battery_dC	769	1790600319	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600319 battery_dC=393 skin_C=39.4 battery_dC=393`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L259` `archival-primary-gpu	P-gpu-1-2-3-4-5-6-7-8-9-10-11-12	battery_end	39.3	battery_dC	779	1790600333	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600333 battery_dC=393 skin_C=39.6 battery_dC=393`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L260` `archival-primary-gpu	P-gpu-1-2-3-4-5-6-7-8-9-10-11-12	skin_start	39.3	skin_C	765	1790600313	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600313 battery_dC=388 skin_C=39.3 skin_C=39.3`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L261` `archival-primary-gpu	P-gpu-1-2-3-4-5-6-7-8-9-10-11-12	skin_peak	39.6	skin_C	776	1790600328	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600328 battery_dC=393 skin_C=39.6 skin_C=39.6`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L262` `archival-primary-gpu	P-gpu-1-2-3-4-5-6-7-8-9-10-11-12	skin_end	39.6	skin_C	779	1790600333	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600333 battery_dC=393 skin_C=39.6 skin_C=39.6`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L264` `archival-primary-gpu	P-gpu-1-2-3-4-5-6-7-8-9-10-11-12	CPU_peak	87.5	cpu-1-9	766	1790600315	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600315 battery_dC=388 skin_C=39.3 cpu-1-9=87500`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L267` `archival-primary-gpu	P-gpu-1-2-3-4-5-6-7-8-9-10-11-12	GPU_peak	74.5	gpuss-2	776	1790600328	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600328 battery_dC=393 skin_C=39.6 gpuss-2=74500`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L270` `archival-primary-gpu	P-gpu-1-2-3-4-5-6-7-8-9-10-11-12	NSP_peak	60.5	nspss-0	778	1790600331	/tmp/s23-heat-abc/prior/raw/device-out/out/samples.tsv	epoch=1790600331 battery_dC=393 skin_C=39.6 nspss-0=60500`

### archival-supplement-htp — P-npu-supp-01

> `/tmp/s23-heat-abc/prior/raw/device-out/supplement/markers.tsv:L4` `1790604777983298868	START_P-npu-supp-01	HTP0 -ngl 99 -nkvo`
> `/tmp/s23-heat-abc/prior/raw/device-out/supplement/markers.tsv:L5` `1790604783797261313	END_P-npu-supp-01	rc=0`
> `/tmp/s23-heat-abc/prior/raw/device-out/supplement/P-npu-supp-01.log:L187` `0.05.535.638 I common_perf_print: prompt eval time =    1521.49 ms /   962 tokens (    1.58 ms per token,   632.28 tokens per second)`
> `/tmp/s23-heat-abc/prior/raw/device-out/supplement/P-npu-supp-01.log:L188` `0.05.535.648 I common_perf_print:        eval time =    1072.70 ms /    15 runs   (   71.51 ms per token,    13.98 tokens per second)`
> `/tmp/s23-heat-abc/prior/raw/device-out/supplement/P-npu-supp-01.log:L195` `EXIT=0`
> `/tmp/s23-heat-abc/prior/raw/device-out/supplement/P-npu-supp-01.log:L132` `0.00.692.722 I load_tensors:         HTP0 model buffer size =  1525.87 MiB`
> `/tmp/s23-heat-abc/prefill-run-summary.tsv:L20` `archival-supplement-htp	1	P-npu-supp-01	HTP0 -ngl 99 -nkvo	962	15	1521.49	5.814	29.6	29.6	0.0	30.3	30.3	0.0	0.0	30.3	0.0	38.2	57.7	82.2	35.2	49.9	56.6	34.6	50.5	76.8	0	PASS	not-recorded-in-archival-marker	markers.tsv:L4	markers.tsv:L5	2	8	/tmp/s23-heat-abc/prior/raw/device-out/supplement/P-npu-supp-01.log`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L272` `archival-supplement-htp	P-npu-supp-01	battery_start	29.6	hal_bat_C	2	1790604777297065014	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604777297065014 hal_bat_C=29.6 skin_C=30.3 hal_bat_C=29.6`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L273` `archival-supplement-htp	P-npu-supp-01	battery_peak	29.6	hal_bat_C	3	1790604778418272722	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604778418272722 hal_bat_C=29.6 skin_C=30.3 hal_bat_C=29.6`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L274` `archival-supplement-htp	P-npu-supp-01	battery_end	29.6	hal_bat_C	8	1790604783860436157	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604783860436157 hal_bat_C=29.6 skin_C=30.3 hal_bat_C=29.6`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L275` `archival-supplement-htp	P-npu-supp-01	skin_start	30.3	skin_C	2	1790604777297065014	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604777297065014 hal_bat_C=29.6 skin_C=30.3 skin_C=30.3`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L276` `archival-supplement-htp	P-npu-supp-01	skin_peak	30.3	skin_C	3	1790604778418272722	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604778418272722 hal_bat_C=29.6 skin_C=30.3 skin_C=30.3`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L277` `archival-supplement-htp	P-npu-supp-01	skin_end	30.3	skin_C	8	1790604783860436157	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604783860436157 hal_bat_C=29.6 skin_C=30.3 skin_C=30.3`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L279` `archival-supplement-htp	P-npu-supp-01	CPU_peak	82.2	cpu-1-9	7	1790604782733687668	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604782733687668 hal_bat_C=29.6 skin_C=30.3 cpu-1-9=82200`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L282` `archival-supplement-htp	P-npu-supp-01	GPU_peak	56.6	gpuss-4	7	1790604782733687668	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604782733687668 hal_bat_C=29.6 skin_C=30.3 gpuss-4=56600`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L285` `archival-supplement-htp	P-npu-supp-01	NSP_peak	76.8	nspss-3	6	1790604781658469856	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604781658469856 hal_bat_C=29.6 skin_C=30.3 nspss-3=76800`

### archival-supplement-htp — P-npu-supp-02

> `/tmp/s23-heat-abc/prior/raw/device-out/supplement/markers.tsv:L8` `1790604784441309803	START_P-npu-supp-02	HTP0 -ngl 99 -nkvo`
> `/tmp/s23-heat-abc/prior/raw/device-out/supplement/markers.tsv:L9` `1790604790638882977	END_P-npu-supp-02	rc=0`
> `/tmp/s23-heat-abc/prior/raw/device-out/supplement/P-npu-supp-02.log:L187` `0.05.968.090 I common_perf_print: prompt eval time =    1539.28 ms /   962 tokens (    1.60 ms per token,   624.97 tokens per second)`
> `/tmp/s23-heat-abc/prior/raw/device-out/supplement/P-npu-supp-02.log:L188` `0.05.968.103 I common_perf_print:        eval time =    1013.37 ms /    15 runs   (   67.56 ms per token,    14.80 tokens per second)`
> `/tmp/s23-heat-abc/prior/raw/device-out/supplement/P-npu-supp-02.log:L195` `EXIT=0`
> `/tmp/s23-heat-abc/prior/raw/device-out/supplement/P-npu-supp-02.log:L132` `0.00.646.735 I load_tensors:         HTP0 model buffer size =  1525.87 MiB`
> `/tmp/s23-heat-abc/prefill-run-summary.tsv:L21` `archival-supplement-htp	2	P-npu-supp-02	HTP0 -ngl 99 -nkvo	962	15	1539.28	6.198	29.6	29.6	0.0	30.3	31.0	0.7	0.7	31.0	0.7	57.7	75.3	86.7	49.9	54.3	59.4	50.5	50.9	74.4	0	PASS	not-recorded-in-archival-marker	markers.tsv:L8	markers.tsv:L9	8	15	/tmp/s23-heat-abc/prior/raw/device-out/supplement/P-npu-supp-02.log`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L287` `archival-supplement-htp	P-npu-supp-02	battery_start	29.6	hal_bat_C	8	1790604783860436157	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604783860436157 hal_bat_C=29.6 skin_C=30.3 hal_bat_C=29.6`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L288` `archival-supplement-htp	P-npu-supp-02	battery_peak	29.6	hal_bat_C	9	1790604784923355011	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604784923355011 hal_bat_C=29.6 skin_C=30.3 hal_bat_C=29.6`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L289` `archival-supplement-htp	P-npu-supp-02	battery_end	29.6	hal_bat_C	15	1790604791560076258	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604791560076258 hal_bat_C=29.6 skin_C=31.0 hal_bat_C=29.6`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L290` `archival-supplement-htp	P-npu-supp-02	skin_start	30.3	skin_C	8	1790604783860436157	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604783860436157 hal_bat_C=29.6 skin_C=30.3 skin_C=30.3`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L291` `archival-supplement-htp	P-npu-supp-02	skin_peak	31.0	skin_C	12	1790604788253169332	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604788253169332 hal_bat_C=29.6 skin_C=31.0 skin_C=31.0`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L292` `archival-supplement-htp	P-npu-supp-02	skin_end	31.0	skin_C	15	1790604791560076258	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604791560076258 hal_bat_C=29.6 skin_C=31.0 skin_C=31.0`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L294` `archival-supplement-htp	P-npu-supp-02	CPU_peak	86.7	cpu-1-1	13	1790604789381876884	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604789381876884 hal_bat_C=29.6 skin_C=31.0 cpu-1-1=86700`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L297` `archival-supplement-htp	P-npu-supp-02	GPU_peak	59.4	gpuss-4	13	1790604789381876884	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604789381876884 hal_bat_C=29.6 skin_C=31.0 gpuss-4=59400`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L300` `archival-supplement-htp	P-npu-supp-02	NSP_peak	74.4	nspss-0	13	1790604789381876884	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604789381876884 hal_bat_C=29.6 skin_C=31.0 nspss-0=74400`

### archival-supplement-htp — P-npu-supp-03

> `/tmp/s23-heat-abc/prior/raw/device-out/supplement/markers.tsv:L12` `1790604791303956519	START_P-npu-supp-03	HTP0 -ngl 99 -nkvo`
> `/tmp/s23-heat-abc/prior/raw/device-out/supplement/markers.tsv:L13` `1790604797312631412	END_P-npu-supp-03	rc=0`
> `/tmp/s23-heat-abc/prior/raw/device-out/supplement/P-npu-supp-03.log:L187` `0.05.768.706 I common_perf_print: prompt eval time =    1543.11 ms /   962 tokens (    1.60 ms per token,   623.42 tokens per second)`
> `/tmp/s23-heat-abc/prior/raw/device-out/supplement/P-npu-supp-03.log:L188` `0.05.768.714 I common_perf_print:        eval time =    1023.22 ms /    15 runs   (   68.21 ms per token,    14.66 tokens per second)`
> `/tmp/s23-heat-abc/prior/raw/device-out/supplement/P-npu-supp-03.log:L195` `EXIT=0`
> `/tmp/s23-heat-abc/prior/raw/device-out/supplement/P-npu-supp-03.log:L132` `0.00.663.722 I load_tensors:         HTP0 model buffer size =  1525.87 MiB`
> `/tmp/s23-heat-abc/prefill-run-summary.tsv:L22` `archival-supplement-htp	3	P-npu-supp-03	HTP0 -ngl 99 -nkvo	962	15	1543.11	6.009	29.6	29.6	0.0	31.0	31.9	0.9	1.6	31.0	0.7	71.3	62.4	85.9	55.1	56.6	61.4	56.1	53.3	75.2	0	PASS	not-recorded-in-archival-marker	markers.tsv:L12	markers.tsv:L13	14	21	/tmp/s23-heat-abc/prior/raw/device-out/supplement/P-npu-supp-03.log`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L302` `archival-supplement-htp	P-npu-supp-03	battery_start	29.6	hal_bat_C	14	1790604790479115894	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604790479115894 hal_bat_C=29.6 skin_C=31.0 hal_bat_C=29.6`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L303` `archival-supplement-htp	P-npu-supp-03	battery_peak	29.6	hal_bat_C	15	1790604791560076258	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604791560076258 hal_bat_C=29.6 skin_C=31.0 hal_bat_C=29.6`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L304` `archival-supplement-htp	P-npu-supp-03	battery_end	29.6	hal_bat_C	21	1790604798193509745	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604798193509745 hal_bat_C=29.6 skin_C=31.9 hal_bat_C=29.6`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L305` `archival-supplement-htp	P-npu-supp-03	skin_start	31.0	skin_C	14	1790604790479115894	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604790479115894 hal_bat_C=29.6 skin_C=31.0 skin_C=31.0`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L306` `archival-supplement-htp	P-npu-supp-03	skin_peak	31.0	skin_C	15	1790604791560076258	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604791560076258 hal_bat_C=29.6 skin_C=31.0 skin_C=31.0`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L307` `archival-supplement-htp	P-npu-supp-03	skin_end	31.9	skin_C	21	1790604798193509745	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604798193509745 hal_bat_C=29.6 skin_C=31.9 skin_C=31.9`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L309` `archival-supplement-htp	P-npu-supp-03	CPU_peak	85.9	cpu-1-1	19	1790604796009953027	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604796009953027 hal_bat_C=29.6 skin_C=31.0 cpu-1-1=85900`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L312` `archival-supplement-htp	P-npu-supp-03	GPU_peak	61.4	gpuss-4	19	1790604796009953027	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604796009953027 hal_bat_C=29.6 skin_C=31.0 gpuss-4=61400`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L315` `archival-supplement-htp	P-npu-supp-03	NSP_peak	75.2	nspss-0	19	1790604796009953027	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604796009953027 hal_bat_C=29.6 skin_C=31.0 nspss-0=75200`

### archival-supplement-htp — P-npu-supp-04

> `/tmp/s23-heat-abc/prior/raw/device-out/supplement/markers.tsv:L16` `1790604797981355475	START_P-npu-supp-04	HTP0 -ngl 99 -nkvo`
> `/tmp/s23-heat-abc/prior/raw/device-out/supplement/markers.tsv:L17` `1790604804045255056	END_P-npu-supp-04	rc=0`
> `/tmp/s23-heat-abc/prior/raw/device-out/supplement/P-npu-supp-04.log:L187` `0.05.833.188 I common_perf_print: prompt eval time =    1512.45 ms /   962 tokens (    1.57 ms per token,   636.05 tokens per second)`
> `/tmp/s23-heat-abc/prior/raw/device-out/supplement/P-npu-supp-04.log:L188` `0.05.833.192 I common_perf_print:        eval time =    1056.63 ms /    15 runs   (   70.44 ms per token,    14.20 tokens per second)`
> `/tmp/s23-heat-abc/prior/raw/device-out/supplement/P-npu-supp-04.log:L195` `EXIT=0`
> `/tmp/s23-heat-abc/prior/raw/device-out/supplement/P-npu-supp-04.log:L132` `0.00.689.580 I load_tensors:         HTP0 model buffer size =  1525.87 MiB`
> `/tmp/s23-heat-abc/prefill-run-summary.tsv:L23` `archival-supplement-htp	4	P-npu-supp-04	HTP0 -ngl 99 -nkvo	962	15	1512.45	6.064	29.6	29.6	0.0	31.0	31.9	0.9	1.6	31.9	1.6	72.5	90.8	89.1	57.4	55.5	61.4	59.7	53.7	76.8	0	PASS	not-recorded-in-archival-marker	markers.tsv:L16	markers.tsv:L17	20	27	/tmp/s23-heat-abc/prior/raw/device-out/supplement/P-npu-supp-04.log`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L317` `archival-supplement-htp	P-npu-supp-04	battery_start	29.6	hal_bat_C	20	1790604797101672506	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604797101672506 hal_bat_C=29.6 skin_C=31.0 hal_bat_C=29.6`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L318` `archival-supplement-htp	P-npu-supp-04	battery_peak	29.6	hal_bat_C	21	1790604798193509745	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604798193509745 hal_bat_C=29.6 skin_C=31.9 hal_bat_C=29.6`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L319` `archival-supplement-htp	P-npu-supp-04	battery_end	29.6	hal_bat_C	27	1790604804740827139	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604804740827139 hal_bat_C=29.6 skin_C=31.9 hal_bat_C=29.6`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L320` `archival-supplement-htp	P-npu-supp-04	skin_start	31.0	skin_C	20	1790604797101672506	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604797101672506 hal_bat_C=29.6 skin_C=31.0 skin_C=31.0`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L321` `archival-supplement-htp	P-npu-supp-04	skin_peak	31.9	skin_C	21	1790604798193509745	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604798193509745 hal_bat_C=29.6 skin_C=31.9 skin_C=31.9`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L322` `archival-supplement-htp	P-npu-supp-04	skin_end	31.9	skin_C	27	1790604804740827139	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604804740827139 hal_bat_C=29.6 skin_C=31.9 skin_C=31.9`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L324` `archival-supplement-htp	P-npu-supp-04	CPU_peak	89.1	cpu-1-9	26	1790604803652786410	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604803652786410 hal_bat_C=29.6 skin_C=31.9 cpu-1-9=89100`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L327` `archival-supplement-htp	P-npu-supp-04	GPU_peak	61.4	gpuss-4	25	1790604802533793181	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604802533793181 hal_bat_C=29.6 skin_C=31.9 gpuss-4=61400`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L330` `archival-supplement-htp	P-npu-supp-04	NSP_peak	76.8	nspss-0	25	1790604802533793181	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604802533793181 hal_bat_C=29.6 skin_C=31.9 nspss-0=76800`

### archival-supplement-htp — P-npu-supp-05

> `/tmp/s23-heat-abc/prior/raw/device-out/supplement/markers.tsv:L20` `1790604804768594847	START_P-npu-supp-05	HTP0 -ngl 99 -nkvo`
> `/tmp/s23-heat-abc/prior/raw/device-out/supplement/markers.tsv:L21` `1790604810901632813	END_P-npu-supp-05	rc=0`
> `/tmp/s23-heat-abc/prior/raw/device-out/supplement/P-npu-supp-05.log:L187` `0.05.893.888 I common_perf_print: prompt eval time =    1544.03 ms /   962 tokens (    1.61 ms per token,   623.05 tokens per second)`
> `/tmp/s23-heat-abc/prior/raw/device-out/supplement/P-npu-supp-05.log:L188` `0.05.893.892 I common_perf_print:        eval time =    1047.24 ms /    15 runs   (   69.82 ms per token,    14.32 tokens per second)`
> `/tmp/s23-heat-abc/prior/raw/device-out/supplement/P-npu-supp-05.log:L195` `EXIT=0`
> `/tmp/s23-heat-abc/prior/raw/device-out/supplement/P-npu-supp-05.log:L132` `0.00.674.210 I load_tensors:         HTP0 model buffer size =  1525.87 MiB`
> `/tmp/s23-heat-abc/prefill-run-summary.tsv:L24` `archival-supplement-htp	5	P-npu-supp-05	HTP0 -ngl 99 -nkvo	962	15	1544.03	6.133	29.6	29.6	0.0	31.9	32.4	0.5	2.1	32.4	2.1	90.8	67.6	89.9	55.5	57.0	65.0	53.7	57.3	91.5	0	PASS	not-recorded-in-archival-marker	markers.tsv:L20	markers.tsv:L21	27	33	/tmp/s23-heat-abc/prior/raw/device-out/supplement/P-npu-supp-05.log`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L332` `archival-supplement-htp	P-npu-supp-05	battery_start	29.6	hal_bat_C	27	1790604804740827139	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604804740827139 hal_bat_C=29.6 skin_C=31.9 hal_bat_C=29.6`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L333` `archival-supplement-htp	P-npu-supp-05	battery_peak	29.6	hal_bat_C	28	1790604805794922138	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604805794922138 hal_bat_C=29.6 skin_C=31.9 hal_bat_C=29.6`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L334` `archival-supplement-htp	P-npu-supp-05	battery_end	29.6	hal_bat_C	33	1790604811212281824	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604811212281824 hal_bat_C=29.6 skin_C=32.4 hal_bat_C=29.6`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L335` `archival-supplement-htp	P-npu-supp-05	skin_start	31.9	skin_C	27	1790604804740827139	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604804740827139 hal_bat_C=29.6 skin_C=31.9 skin_C=31.9`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L336` `archival-supplement-htp	P-npu-supp-05	skin_peak	32.4	skin_C	30	1790604807980026356	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604807980026356 hal_bat_C=29.6 skin_C=32.4 skin_C=32.4`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L337` `archival-supplement-htp	P-npu-supp-05	skin_end	32.4	skin_C	33	1790604811212281824	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604811212281824 hal_bat_C=29.6 skin_C=32.4 skin_C=32.4`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L339` `archival-supplement-htp	P-npu-supp-05	CPU_peak	89.9	cpu-1-9	32	1790604810116447293	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604810116447293 hal_bat_C=29.6 skin_C=32.4 cpu-1-9=89900`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L342` `archival-supplement-htp	P-npu-supp-05	GPU_peak	65.0	gpuss-4	32	1790604810116447293	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604810116447293 hal_bat_C=29.6 skin_C=32.4 gpuss-4=65000`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L345` `archival-supplement-htp	P-npu-supp-05	NSP_peak	91.5	nspss-2	31	1790604809045095418	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604809045095418 hal_bat_C=29.6 skin_C=32.4 nspss-2=91500`

### archival-supplement-htp — P-npu-supp-06

> `/tmp/s23-heat-abc/prior/raw/device-out/supplement/markers.tsv:L24` `1790604811495973490	START_P-npu-supp-06	HTP0 -ngl 99 -nkvo`
> `/tmp/s23-heat-abc/prior/raw/device-out/supplement/markers.tsv:L25` `1790604817486393852	END_P-npu-supp-06	rc=0`
> `/tmp/s23-heat-abc/prior/raw/device-out/supplement/P-npu-supp-06.log:L187` `0.05.766.617 I common_perf_print: prompt eval time =    1588.94 ms /   962 tokens (    1.65 ms per token,   605.43 tokens per second)`
> `/tmp/s23-heat-abc/prior/raw/device-out/supplement/P-npu-supp-06.log:L188` `0.05.766.669 I common_perf_print:        eval time =     986.83 ms /    15 runs   (   65.79 ms per token,    15.20 tokens per second)`
> `/tmp/s23-heat-abc/prior/raw/device-out/supplement/P-npu-supp-06.log:L195` `EXIT=0`
> `/tmp/s23-heat-abc/prior/raw/device-out/supplement/P-npu-supp-06.log:L132` `0.00.695.885 I load_tensors:         HTP0 model buffer size =  1525.87 MiB`
> `/tmp/s23-heat-abc/prefill-run-summary.tsv:L25` `archival-supplement-htp	6	P-npu-supp-06	HTP0 -ngl 99 -nkvo	962	15	1588.94	5.99	29.6	29.6	0.0	32.4	32.4	0.0	2.1	32.4	2.1	67.6	66.5	89.9	57.0	57.8	65.8	57.3	58.5	78.8	0	PASS	not-recorded-in-archival-marker	markers.tsv:L24	markers.tsv:L25	33	39	/tmp/s23-heat-abc/prior/raw/device-out/supplement/P-npu-supp-06.log`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L347` `archival-supplement-htp	P-npu-supp-06	battery_start	29.6	hal_bat_C	33	1790604811212281824	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604811212281824 hal_bat_C=29.6 skin_C=32.4 hal_bat_C=29.6`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L348` `archival-supplement-htp	P-npu-supp-06	battery_peak	29.6	hal_bat_C	34	1790604812329625104	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604812329625104 hal_bat_C=29.6 skin_C=32.4 hal_bat_C=29.6`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L349` `archival-supplement-htp	P-npu-supp-06	battery_end	29.6	hal_bat_C	39	1790604817700724269	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604817700724269 hal_bat_C=29.6 skin_C=32.4 hal_bat_C=29.6`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L350` `archival-supplement-htp	P-npu-supp-06	skin_start	32.4	skin_C	33	1790604811212281824	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604811212281824 hal_bat_C=29.6 skin_C=32.4 skin_C=32.4`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L351` `archival-supplement-htp	P-npu-supp-06	skin_peak	32.4	skin_C	34	1790604812329625104	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604812329625104 hal_bat_C=29.6 skin_C=32.4 skin_C=32.4`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L352` `archival-supplement-htp	P-npu-supp-06	skin_end	32.4	skin_C	39	1790604817700724269	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604817700724269 hal_bat_C=29.6 skin_C=32.4 skin_C=32.4`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L354` `archival-supplement-htp	P-npu-supp-06	CPU_peak	89.9	cpu-1-9	38	1790604816572443488	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604816572443488 hal_bat_C=29.6 skin_C=32.4 cpu-1-9=89900`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L357` `archival-supplement-htp	P-npu-supp-06	GPU_peak	65.8	gpuss-4	38	1790604816572443488	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604816572443488 hal_bat_C=29.6 skin_C=32.4 gpuss-4=65800`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L360` `archival-supplement-htp	P-npu-supp-06	NSP_peak	78.8	nspss-0	38	1790604816572443488	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604816572443488 hal_bat_C=29.6 skin_C=32.4 nspss-0=78800`

### archival-supplement-htp — P-npu-supp-07

> `/tmp/s23-heat-abc/prior/raw/device-out/supplement/markers.tsv:L28` `1790604818167264373	START_P-npu-supp-07	HTP0 -ngl 99 -nkvo`
> `/tmp/s23-heat-abc/prior/raw/device-out/supplement/markers.tsv:L29` `1790604824237228590	END_P-npu-supp-07	rc=0`
> `/tmp/s23-heat-abc/prior/raw/device-out/supplement/P-npu-supp-07.log:L187` `0.05.855.465 I common_perf_print: prompt eval time =    1540.15 ms /   962 tokens (    1.60 ms per token,   624.61 tokens per second)`
> `/tmp/s23-heat-abc/prior/raw/device-out/supplement/P-npu-supp-07.log:L188` `0.05.855.484 I common_perf_print:        eval time =     902.21 ms /    15 runs   (   60.15 ms per token,    16.63 tokens per second)`
> `/tmp/s23-heat-abc/prior/raw/device-out/supplement/P-npu-supp-07.log:L195` `EXIT=0`
> `/tmp/s23-heat-abc/prior/raw/device-out/supplement/P-npu-supp-07.log:L132` `0.00.700.827 I load_tensors:         HTP0 model buffer size =  1525.87 MiB`
> `/tmp/s23-heat-abc/prefill-run-summary.tsv:L26` `archival-supplement-htp	7	P-npu-supp-07	HTP0 -ngl 99 -nkvo	962	15	1540.15	6.07	29.6	32.3	2.7	32.4	33.6	1.2	3.3	33.6	3.3	66.5	70.4	89.1	57.8	61.0	64.6	58.5	62.1	78.4	0	PASS	not-recorded-in-archival-marker	markers.tsv:L28	markers.tsv:L29	39	45	/tmp/s23-heat-abc/prior/raw/device-out/supplement/P-npu-supp-07.log`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L362` `archival-supplement-htp	P-npu-supp-07	battery_start	29.6	hal_bat_C	39	1790604817700724269	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604817700724269 hal_bat_C=29.6 skin_C=32.4 hal_bat_C=29.6`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L363` `archival-supplement-htp	P-npu-supp-07	battery_peak	32.3	hal_bat_C	40	1790604818722724581	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604818722724581 hal_bat_C=32.3 skin_C=33.6 hal_bat_C=32.3`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L364` `archival-supplement-htp	P-npu-supp-07	battery_end	32.3	hal_bat_C	45	1790604824281599839	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604824281599839 hal_bat_C=32.3 skin_C=33.6 hal_bat_C=32.3`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L365` `archival-supplement-htp	P-npu-supp-07	skin_start	32.4	skin_C	39	1790604817700724269	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604817700724269 hal_bat_C=29.6 skin_C=32.4 skin_C=32.4`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L366` `archival-supplement-htp	P-npu-supp-07	skin_peak	33.6	skin_C	40	1790604818722724581	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604818722724581 hal_bat_C=32.3 skin_C=33.6 skin_C=33.6`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L367` `archival-supplement-htp	P-npu-supp-07	skin_end	33.6	skin_C	45	1790604824281599839	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604824281599839 hal_bat_C=32.3 skin_C=33.6 skin_C=33.6`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L369` `archival-supplement-htp	P-npu-supp-07	CPU_peak	89.1	cpu-1-9	44	1790604823171497288	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604823171497288 hal_bat_C=32.3 skin_C=33.6 cpu-1-9=89100`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L372` `archival-supplement-htp	P-npu-supp-07	GPU_peak	64.6	gpuss-4	44	1790604823171497288	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604823171497288 hal_bat_C=32.3 skin_C=33.6 gpuss-4=64600`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L375` `archival-supplement-htp	P-npu-supp-07	NSP_peak	78.4	nspss-0	44	1790604823171497288	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604823171497288 hal_bat_C=32.3 skin_C=33.6 nspss-0=78400`

### archival-supplement-htp — P-npu-supp-08

> `/tmp/s23-heat-abc/prior/raw/device-out/supplement/markers.tsv:L32` `1790604824815657860	START_P-npu-supp-08	HTP0 -ngl 99 -nkvo`
> `/tmp/s23-heat-abc/prior/raw/device-out/supplement/markers.tsv:L33` `1790604830861099837	END_P-npu-supp-08	rc=0`
> `/tmp/s23-heat-abc/prior/raw/device-out/supplement/P-npu-supp-08.log:L187` `0.05.793.459 I common_perf_print: prompt eval time =    1506.64 ms /   962 tokens (    1.57 ms per token,   638.50 tokens per second)`
> `/tmp/s23-heat-abc/prior/raw/device-out/supplement/P-npu-supp-08.log:L188` `0.05.793.480 I common_perf_print:        eval time =     985.91 ms /    15 runs   (   65.73 ms per token,    15.21 tokens per second)`
> `/tmp/s23-heat-abc/prior/raw/device-out/supplement/P-npu-supp-08.log:L195` `EXIT=0`
> `/tmp/s23-heat-abc/prior/raw/device-out/supplement/P-npu-supp-08.log:L132` `0.00.664.482 I load_tensors:         HTP0 model buffer size =  1525.87 MiB`
> `/tmp/s23-heat-abc/prefill-run-summary.tsv:L27` `archival-supplement-htp	8	P-npu-supp-08	HTP0 -ngl 99 -nkvo	962	15	1506.64	6.045	32.3	32.3	0.0	33.6	34.1	0.5	3.8	34.1	3.8	70.4	67.2	87.1	61.0	59.4	65.0	62.1	56.1	82.4	0	PASS	not-recorded-in-archival-marker	markers.tsv:L32	markers.tsv:L33	45	52	/tmp/s23-heat-abc/prior/raw/device-out/supplement/P-npu-supp-08.log`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L377` `archival-supplement-htp	P-npu-supp-08	battery_start	32.3	hal_bat_C	45	1790604824281599839	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604824281599839 hal_bat_C=32.3 skin_C=33.6 hal_bat_C=32.3`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L378` `archival-supplement-htp	P-npu-supp-08	battery_peak	32.3	hal_bat_C	46	1790604825313560256	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604825313560256 hal_bat_C=32.3 skin_C=33.6 hal_bat_C=32.3`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L379` `archival-supplement-htp	P-npu-supp-08	battery_end	32.3	hal_bat_C	52	1790604831881262805	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604831881262805 hal_bat_C=32.3 skin_C=34.1 hal_bat_C=32.3`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L380` `archival-supplement-htp	P-npu-supp-08	skin_start	33.6	skin_C	45	1790604824281599839	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604824281599839 hal_bat_C=32.3 skin_C=33.6 skin_C=33.6`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L381` `archival-supplement-htp	P-npu-supp-08	skin_peak	34.1	skin_C	49	1790604828582936661	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604828582936661 hal_bat_C=32.3 skin_C=34.1 skin_C=34.1`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L382` `archival-supplement-htp	P-npu-supp-08	skin_end	34.1	skin_C	52	1790604831881262805	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604831881262805 hal_bat_C=32.3 skin_C=34.1 skin_C=34.1`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L384` `archival-supplement-htp	P-npu-supp-08	CPU_peak	87.1	cpu-1-9	46	1790604825313560256	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604825313560256 hal_bat_C=32.3 skin_C=33.6 cpu-1-9=87100`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L387` `archival-supplement-htp	P-npu-supp-08	GPU_peak	65.0	gpuss-4	50	1790604829622176973	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604829622176973 hal_bat_C=32.3 skin_C=34.1 gpuss-4=65000`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L390` `archival-supplement-htp	P-npu-supp-08	NSP_peak	82.4	nspss-0	50	1790604829622176973	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604829622176973 hal_bat_C=32.3 skin_C=34.1 nspss-0=82400`

### archival-supplement-htp — P-npu-supp-09

> `/tmp/s23-heat-abc/prior/raw/device-out/supplement/markers.tsv:L36` `1790604831639774837	START_P-npu-supp-09	HTP0 -ngl 99 -nkvo`
> `/tmp/s23-heat-abc/prior/raw/device-out/supplement/markers.tsv:L37` `1790604837782212907	END_P-npu-supp-09	rc=0`
> `/tmp/s23-heat-abc/prior/raw/device-out/supplement/P-npu-supp-09.log:L187` `0.05.899.797 I common_perf_print: prompt eval time =    1503.38 ms /   962 tokens (    1.56 ms per token,   639.89 tokens per second)`
> `/tmp/s23-heat-abc/prior/raw/device-out/supplement/P-npu-supp-09.log:L188` `0.05.899.804 I common_perf_print:        eval time =    1078.31 ms /    15 runs   (   71.89 ms per token,    13.91 tokens per second)`
> `/tmp/s23-heat-abc/prior/raw/device-out/supplement/P-npu-supp-09.log:L195` `EXIT=0`
> `/tmp/s23-heat-abc/prior/raw/device-out/supplement/P-npu-supp-09.log:L132` `0.00.655.243 I load_tensors:         HTP0 model buffer size =  1525.87 MiB`
> `/tmp/s23-heat-abc/prefill-run-summary.tsv:L28` `archival-supplement-htp	9	P-npu-supp-09	HTP0 -ngl 99 -nkvo	962	15	1503.38	6.142	32.3	32.3	0.0	34.1	34.7	0.6	4.4	34.1	3.8	73.6	81.0	89.5	60.6	59.4	63.8	62.5	58.5	78.0	0	PASS	not-recorded-in-archival-marker	markers.tsv:L36	markers.tsv:L37	51	58	/tmp/s23-heat-abc/prior/raw/device-out/supplement/P-npu-supp-09.log`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L392` `archival-supplement-htp	P-npu-supp-09	battery_start	32.3	hal_bat_C	51	1790604830754986608	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604830754986608 hal_bat_C=32.3 skin_C=34.1 hal_bat_C=32.3`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L393` `archival-supplement-htp	P-npu-supp-09	battery_peak	32.3	hal_bat_C	52	1790604831881262805	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604831881262805 hal_bat_C=32.3 skin_C=34.1 hal_bat_C=32.3`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L394` `archival-supplement-htp	P-npu-supp-09	battery_end	32.3	hal_bat_C	58	1790604838437416292	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604838437416292 hal_bat_C=32.3 skin_C=34.7 hal_bat_C=32.3`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L395` `archival-supplement-htp	P-npu-supp-09	skin_start	34.1	skin_C	51	1790604830754986608	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604830754986608 hal_bat_C=32.3 skin_C=34.1 skin_C=34.1`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L396` `archival-supplement-htp	P-npu-supp-09	skin_peak	34.1	skin_C	52	1790604831881262805	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604831881262805 hal_bat_C=32.3 skin_C=34.1 skin_C=34.1`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L397` `archival-supplement-htp	P-npu-supp-09	skin_end	34.7	skin_C	58	1790604838437416292	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604838437416292 hal_bat_C=32.3 skin_C=34.7 skin_C=34.7`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L399` `archival-supplement-htp	P-npu-supp-09	CPU_peak	89.5	cpu-1-9	57	1790604837364652178	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604837364652178 hal_bat_C=32.3 skin_C=34.1 cpu-1-9=89500`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L402` `archival-supplement-htp	P-npu-supp-09	GPU_peak	63.8	gpuss-4	56	1790604836232952804	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604836232952804 hal_bat_C=32.3 skin_C=34.1 gpuss-4=63800`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L405` `archival-supplement-htp	P-npu-supp-09	NSP_peak	78.0	nspss-0	56	1790604836232952804	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604836232952804 hal_bat_C=32.3 skin_C=34.1 nspss-0=78000`

### archival-supplement-htp — P-npu-supp-10

> `/tmp/s23-heat-abc/prior/raw/device-out/supplement/markers.tsv:L40` `1790604838373453376	START_P-npu-supp-10	HTP0 -ngl 99 -nkvo`
> `/tmp/s23-heat-abc/prior/raw/device-out/supplement/markers.tsv:L41` `1790604844439047436	END_P-npu-supp-10	rc=0`
> `/tmp/s23-heat-abc/prior/raw/device-out/supplement/P-npu-supp-10.log:L187` `0.05.815.766 I common_perf_print: prompt eval time =    1582.70 ms /   962 tokens (    1.65 ms per token,   607.82 tokens per second)`
> `/tmp/s23-heat-abc/prior/raw/device-out/supplement/P-npu-supp-10.log:L188` `0.05.815.769 I common_perf_print:        eval time =     958.17 ms /    15 runs   (   63.88 ms per token,    15.65 tokens per second)`
> `/tmp/s23-heat-abc/prior/raw/device-out/supplement/P-npu-supp-10.log:L195` `EXIT=0`
> `/tmp/s23-heat-abc/prior/raw/device-out/supplement/P-npu-supp-10.log:L132` `0.00.669.458 I load_tensors:         HTP0 model buffer size =  1525.87 MiB`
> `/tmp/s23-heat-abc/prefill-run-summary.tsv:L29` `archival-supplement-htp	10	P-npu-supp-10	HTP0 -ngl 99 -nkvo	962	15	1582.7	6.066	32.3	32.3	0.0	34.1	34.7	0.6	4.4	34.7	4.4	89.5	64.9	89.9	63.4	60.2	66.6	67.3	58.5	95.9	0	PASS	not-recorded-in-archival-marker	markers.tsv:L40	markers.tsv:L41	57	64	/tmp/s23-heat-abc/prior/raw/device-out/supplement/P-npu-supp-10.log`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L407` `archival-supplement-htp	P-npu-supp-10	battery_start	32.3	hal_bat_C	57	1790604837364652178	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604837364652178 hal_bat_C=32.3 skin_C=34.1 hal_bat_C=32.3`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L408` `archival-supplement-htp	P-npu-supp-10	battery_peak	32.3	hal_bat_C	58	1790604838437416292	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604838437416292 hal_bat_C=32.3 skin_C=34.7 hal_bat_C=32.3`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L409` `archival-supplement-htp	P-npu-supp-10	battery_end	32.3	hal_bat_C	64	1790604844860783373	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604844860783373 hal_bat_C=32.3 skin_C=34.7 hal_bat_C=32.3`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L410` `archival-supplement-htp	P-npu-supp-10	skin_start	34.1	skin_C	57	1790604837364652178	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604837364652178 hal_bat_C=32.3 skin_C=34.1 skin_C=34.1`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L411` `archival-supplement-htp	P-npu-supp-10	skin_peak	34.7	skin_C	58	1790604838437416292	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604838437416292 hal_bat_C=32.3 skin_C=34.7 skin_C=34.7`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L412` `archival-supplement-htp	P-npu-supp-10	skin_end	34.7	skin_C	64	1790604844860783373	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604844860783373 hal_bat_C=32.3 skin_C=34.7 skin_C=34.7`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L414` `archival-supplement-htp	P-npu-supp-10	CPU_peak	89.9	cpu-1-9	63	1790604843817174728	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604843817174728 hal_bat_C=32.3 skin_C=34.7 cpu-1-9=89900`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L417` `archival-supplement-htp	P-npu-supp-10	GPU_peak	66.6	gpuss-4	63	1790604843817174728	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604843817174728 hal_bat_C=32.3 skin_C=34.7 gpuss-4=66600`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L420` `archival-supplement-htp	P-npu-supp-10	NSP_peak	95.9	nspss-2	62	1790604842748911968	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604842748911968 hal_bat_C=32.3 skin_C=34.7 nspss-2=95900`

### archival-supplement-htp — P-npu-supp-11

> `/tmp/s23-heat-abc/prior/raw/device-out/supplement/markers.tsv:L44` `1790604845149121498	START_P-npu-supp-11	HTP0 -ngl 99 -nkvo`
> `/tmp/s23-heat-abc/prior/raw/device-out/supplement/markers.tsv:L45` `1790604851150036444	END_P-npu-supp-11	rc=0`
> `/tmp/s23-heat-abc/prior/raw/device-out/supplement/P-npu-supp-11.log:L187` `0.05.780.171 I common_perf_print: prompt eval time =    1552.44 ms /   962 tokens (    1.61 ms per token,   619.67 tokens per second)`
> `/tmp/s23-heat-abc/prior/raw/device-out/supplement/P-npu-supp-11.log:L188` `0.05.780.175 I common_perf_print:        eval time =     964.39 ms /    15 runs   (   64.29 ms per token,    15.55 tokens per second)`
> `/tmp/s23-heat-abc/prior/raw/device-out/supplement/P-npu-supp-11.log:L195` `EXIT=0`
> `/tmp/s23-heat-abc/prior/raw/device-out/supplement/P-npu-supp-11.log:L132` `0.00.689.262 I load_tensors:         HTP0 model buffer size =  1525.87 MiB`
> `/tmp/s23-heat-abc/prefill-run-summary.tsv:L30` `archival-supplement-htp	11	P-npu-supp-11	HTP0 -ngl 99 -nkvo	962	15	1552.44	6.001	32.3	34.2	1.9	34.7	35.4	0.7	5.1	35.4	5.1	64.9	68.1	89.5	60.2	58.6	67.7	58.5	60.1	91.1	0	PASS	not-recorded-in-archival-marker	markers.tsv:L44	markers.tsv:L45	64	70	/tmp/s23-heat-abc/prior/raw/device-out/supplement/P-npu-supp-11.log`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L422` `archival-supplement-htp	P-npu-supp-11	battery_start	32.3	hal_bat_C	64	1790604844860783373	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604844860783373 hal_bat_C=32.3 skin_C=34.7 hal_bat_C=32.3`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L423` `archival-supplement-htp	P-npu-supp-11	battery_peak	34.2	hal_bat_C	67	1790604848131817955	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604848131817955 hal_bat_C=34.2 skin_C=35.4 hal_bat_C=34.2`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L424` `archival-supplement-htp	P-npu-supp-11	battery_end	34.2	hal_bat_C	70	1790604851480774048	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604851480774048 hal_bat_C=34.2 skin_C=35.4 hal_bat_C=34.2`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L425` `archival-supplement-htp	P-npu-supp-11	skin_start	34.7	skin_C	64	1790604844860783373	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604844860783373 hal_bat_C=32.3 skin_C=34.7 skin_C=34.7`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L426` `archival-supplement-htp	P-npu-supp-11	skin_peak	35.4	skin_C	67	1790604848131817955	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604848131817955 hal_bat_C=34.2 skin_C=35.4 skin_C=35.4`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L427` `archival-supplement-htp	P-npu-supp-11	skin_end	35.4	skin_C	70	1790604851480774048	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604851480774048 hal_bat_C=34.2 skin_C=35.4 skin_C=35.4`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L429` `archival-supplement-htp	P-npu-supp-11	CPU_peak	89.5	cpu-1-9	65	1790604845929071029	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604845929071029 hal_bat_C=32.3 skin_C=34.7 cpu-1-9=89500`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L432` `archival-supplement-htp	P-npu-supp-11	GPU_peak	67.7	gpuss-4	69	1790604850381678527	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604850381678527 hal_bat_C=34.2 skin_C=35.4 gpuss-4=67700`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L435` `archival-supplement-htp	P-npu-supp-11	NSP_peak	91.1	nspss-2	68	1790604849254595559	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604849254595559 hal_bat_C=34.2 skin_C=35.4 nspss-2=91100`

### archival-supplement-htp — P-npu-supp-12

> `/tmp/s23-heat-abc/prior/raw/device-out/supplement/markers.tsv:L48` `1790604851820190975	START_P-npu-supp-12	HTP0 -ngl 99 -nkvo`
> `/tmp/s23-heat-abc/prior/raw/device-out/supplement/markers.tsv:L49` `1790604857964202014	END_P-npu-supp-12	rc=0`
> `/tmp/s23-heat-abc/prior/raw/device-out/supplement/P-npu-supp-12.log:L187` `0.05.900.113 I common_perf_print: prompt eval time =    1533.85 ms /   962 tokens (    1.59 ms per token,   627.18 tokens per second)`
> `/tmp/s23-heat-abc/prior/raw/device-out/supplement/P-npu-supp-12.log:L188` `0.05.900.159 I common_perf_print:        eval time =    1014.28 ms /    15 runs   (   67.62 ms per token,    14.79 tokens per second)`
> `/tmp/s23-heat-abc/prior/raw/device-out/supplement/P-npu-supp-12.log:L195` `EXIT=0`
> `/tmp/s23-heat-abc/prior/raw/device-out/supplement/P-npu-supp-12.log:L132` `0.00.665.637 I load_tensors:         HTP0 model buffer size =  1525.87 MiB`
> `/tmp/s23-heat-abc/prefill-run-summary.tsv:L31` `archival-supplement-htp	12	P-npu-supp-12	HTP0 -ngl 99 -nkvo	962	15	1533.85	6.144	34.2	34.2	0.0	35.4	35.4	0.0	5.1	35.4	5.1	68.1	73.3	89.9	58.6	61.4	67.4	60.1	63.7	90.7	0	PASS	not-recorded-in-archival-marker	markers.tsv:L48	markers.tsv:L49	70	76	/tmp/s23-heat-abc/prior/raw/device-out/supplement/P-npu-supp-12.log`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L437` `archival-supplement-htp	P-npu-supp-12	battery_start	34.2	hal_bat_C	70	1790604851480774048	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604851480774048 hal_bat_C=34.2 skin_C=35.4 hal_bat_C=34.2`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L438` `archival-supplement-htp	P-npu-supp-12	battery_peak	34.2	hal_bat_C	71	1790604852533341339	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604852533341339 hal_bat_C=34.2 skin_C=35.4 hal_bat_C=34.2`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L439` `archival-supplement-htp	P-npu-supp-12	battery_end	34.2	hal_bat_C	76	1790604857883663212	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604857883663212 hal_bat_C=34.2 skin_C=35.4 hal_bat_C=34.2`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L440` `archival-supplement-htp	P-npu-supp-12	skin_start	35.4	skin_C	70	1790604851480774048	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604851480774048 hal_bat_C=34.2 skin_C=35.4 skin_C=35.4`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L441` `archival-supplement-htp	P-npu-supp-12	skin_peak	35.4	skin_C	71	1790604852533341339	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604852533341339 hal_bat_C=34.2 skin_C=35.4 skin_C=35.4`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L442` `archival-supplement-htp	P-npu-supp-12	skin_end	35.4	skin_C	76	1790604857883663212	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604857883663212 hal_bat_C=34.2 skin_C=35.4 skin_C=35.4`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L444` `archival-supplement-htp	P-npu-supp-12	CPU_peak	89.9	cpu-1-9	71	1790604852533341339	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604852533341339 hal_bat_C=34.2 skin_C=35.4 cpu-1-9=89900`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L447` `archival-supplement-htp	P-npu-supp-12	GPU_peak	67.4	gpuss-4	75	1790604856795476129	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604856795476129 hal_bat_C=34.2 skin_C=35.4 gpuss-4=67400`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L450` `archival-supplement-htp	P-npu-supp-12	NSP_peak	90.7	nspss-2	74	1790604855741917119	/tmp/s23-heat-abc/prior/raw/device-out/supplement/samples.tsv	epoch=1790604855741917119 hal_bat_C=34.2 skin_C=35.4 nspss-2=90700`

### no-cool-htp-recovery — P-npu-rerun-01

> `/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/markers.tsv:L1` `1790648461.830038349	START_P-npu-rerun-01	cmd=./bin/llama-completion -m /data/local/tmp/heat3way/ship.gguf -lm none --ignore-eos --seed 1 --temp 0 --no-conversation -c 2048 -b 2048 -ub 1024 -t 5 -fa 1 --no-warmup --perf --simple-io --no-display-prompt -f /data/local/tmp/heat3way/prompt.txt -n 16 -lv 4 -dev HTP0 -ngl 99 -nkvo`
> `/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/markers.tsv:L2` `1790648467.614543712	END_P-npu-rerun-01	rc=0 backend_proof=PASS`
> `/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/P-npu-rerun-01.log:L187` `0.05.510.096 I common_perf_print: prompt eval time =    1538.86 ms /   962 tokens (    1.60 ms per token,   625.14 tokens per second)`
> `/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/P-npu-rerun-01.log:L188` `0.05.510.100 I common_perf_print:        eval time =    1000.07 ms /    15 runs   (   66.67 ms per token,    15.00 tokens per second)`
> `/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/P-npu-rerun-01.log:L195` `EXIT=0`
> `/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/P-npu-rerun-01.log:L132` `0.00.658.830 I load_tensors:         HTP0 model buffer size =  1525.87 MiB`
> `/tmp/s23-heat-abc/prefill-run-summary.tsv:L32` `no-cool-htp-recovery	1	P-npu-rerun-01	HTP0 -ngl 99 -nkvo	962	15	1538.86	5.785	29.5	29.5	0.0	30.2	30.4	0.2	0.2	30.4	0.2	44.6	54.1	83.5	38.0	46.7	54.7	35.8	47.7	67.7	0	PASS	PASS	markers.tsv:L1	markers.tsv:L2	3	9	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/P-npu-rerun-01.log`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L452` `no-cool-htp-recovery	P-npu-rerun-01	battery_start	29.5	battery_dC	3	1790648461.581819027	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648461.581819027 battery_dC=295 skin_C=30.2 battery_dC=295`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L453` `no-cool-htp-recovery	P-npu-rerun-01	battery_peak	29.5	battery_dC	4	1790648462.693647516	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648462.693647516 battery_dC=295 skin_C=30.2 battery_dC=295`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L454` `no-cool-htp-recovery	P-npu-rerun-01	battery_end	29.5	battery_dC	9	1790648468.135130951	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648468.135130951 battery_dC=295 skin_C=30.4 battery_dC=295`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L455` `no-cool-htp-recovery	P-npu-rerun-01	skin_start	30.2	skin_C	3	1790648461.581819027	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648461.581819027 battery_dC=295 skin_C=30.2 skin_C=30.2`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L456` `no-cool-htp-recovery	P-npu-rerun-01	skin_peak	30.4	skin_C	5	1790648463.816817515	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648463.816817515 battery_dC=295 skin_C=30.4 skin_C=30.4`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L457` `no-cool-htp-recovery	P-npu-rerun-01	skin_end	30.4	skin_C	9	1790648468.135130951	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648468.135130951 battery_dC=295 skin_C=30.4 skin_C=30.4`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L459` `no-cool-htp-recovery	P-npu-rerun-01	CPU_peak	83.5	cpu-1-5	8	1790648467.092952618	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648467.092952618 battery_dC=295 skin_C=30.4 cpu-1-5=83500`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L462` `no-cool-htp-recovery	P-npu-rerun-01	GPU_peak	54.7	gpuss-4	7	1790648466.042326733	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648466.042326733 battery_dC=295 skin_C=30.4 gpuss-4=54700`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L465` `no-cool-htp-recovery	P-npu-rerun-01	NSP_peak	67.7	nspss-1	7	1790648466.042326733	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648466.042326733 battery_dC=295 skin_C=30.4 nspss-1=67700`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L632` `validator-aborted-attempt	P-npu-rerun-01	battery_start	29.4	battery_dC	3	1790648316.895330644	/tmp/s23-heat-abc/npu-rerun/device-raw/attempt-1-pull/npu-rerun-20260928/samples.tsv	epoch=1790648316.895330644 battery_dC=294 skin_C=30.1 battery_dC=294`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L633` `validator-aborted-attempt	P-npu-rerun-01	battery_peak	29.4	battery_dC	4	1790648317.964583821	/tmp/s23-heat-abc/npu-rerun/device-raw/attempt-1-pull/npu-rerun-20260928/samples.tsv	epoch=1790648317.964583821 battery_dC=294 skin_C=30.1 battery_dC=294`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L634` `validator-aborted-attempt	P-npu-rerun-01	battery_end	29.4	battery_dC	9	1790648323.470515590	/tmp/s23-heat-abc/npu-rerun/device-raw/attempt-1-pull/npu-rerun-20260928/samples.tsv	epoch=1790648323.470515590 battery_dC=294 skin_C=30.6 battery_dC=294`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L635` `validator-aborted-attempt	P-npu-rerun-01	skin_start	30.1	skin_C	3	1790648316.895330644	/tmp/s23-heat-abc/npu-rerun/device-raw/attempt-1-pull/npu-rerun-20260928/samples.tsv	epoch=1790648316.895330644 battery_dC=294 skin_C=30.1 skin_C=30.1`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L636` `validator-aborted-attempt	P-npu-rerun-01	skin_peak	30.1	skin_C	4	1790648317.964583821	/tmp/s23-heat-abc/npu-rerun/device-raw/attempt-1-pull/npu-rerun-20260928/samples.tsv	epoch=1790648317.964583821 battery_dC=294 skin_C=30.1 skin_C=30.1`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L637` `validator-aborted-attempt	P-npu-rerun-01	skin_end	30.6	skin_C	9	1790648323.470515590	/tmp/s23-heat-abc/npu-rerun/device-raw/attempt-1-pull/npu-rerun-20260928/samples.tsv	epoch=1790648323.470515590 battery_dC=294 skin_C=30.6 skin_C=30.6`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L639` `validator-aborted-attempt	P-npu-rerun-01	CPU_peak	89.5	cpu-1-9	8	1790648322.357459600	/tmp/s23-heat-abc/npu-rerun/device-raw/attempt-1-pull/npu-rerun-20260928/samples.tsv	epoch=1790648322.357459600 battery_dC=294 skin_C=30.1 cpu-1-9=89500`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L642` `validator-aborted-attempt	P-npu-rerun-01	GPU_peak	56.3	gpuss-4	8	1790648322.357459600	/tmp/s23-heat-abc/npu-rerun/device-raw/attempt-1-pull/npu-rerun-20260928/samples.tsv	epoch=1790648322.357459600 battery_dC=294 skin_C=30.1 gpuss-4=56300`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L645` `validator-aborted-attempt	P-npu-rerun-01	NSP_peak	69.6	nspss-0	7	1790648321.300209497	/tmp/s23-heat-abc/npu-rerun/device-raw/attempt-1-pull/npu-rerun-20260928/samples.tsv	epoch=1790648321.300209497 battery_dC=294 skin_C=30.1 nspss-0=69600`

### no-cool-htp-recovery — P-npu-rerun-02

> `/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/markers.tsv:L3` `1790648468.888974388	START_P-npu-rerun-02	cmd=./bin/llama-completion -m /data/local/tmp/heat3way/ship.gguf -lm none --ignore-eos --seed 1 --temp 0 --no-conversation -c 2048 -b 2048 -ub 1024 -t 5 -fa 1 --no-warmup --perf --simple-io --no-display-prompt -f /data/local/tmp/heat3way/prompt.txt -n 16 -lv 4 -dev HTP0 -ngl 99 -nkvo`
> `/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/markers.tsv:L4` `1790648475.036044751	END_P-npu-rerun-02	rc=0 backend_proof=PASS`
> `/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/P-npu-rerun-02.log:L187` `0.05.832.189 I common_perf_print: prompt eval time =    1491.04 ms /   962 tokens (    1.55 ms per token,   645.19 tokens per second)`
> `/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/P-npu-rerun-02.log:L188` `0.05.832.193 I common_perf_print:        eval time =     986.66 ms /    15 runs   (   65.78 ms per token,    15.20 tokens per second)`
> `/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/P-npu-rerun-02.log:L195` `EXIT=0`
> `/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/P-npu-rerun-02.log:L132` `0.00.650.099 I load_tensors:         HTP0 model buffer size =  1525.87 MiB`
> `/tmp/s23-heat-abc/prefill-run-summary.tsv:L33` `no-cool-htp-recovery	2	P-npu-rerun-02	HTP0 -ngl 99 -nkvo	962	15	1491.04	6.147	29.5	30.2	0.7	30.4	31.1	0.7	0.9	31.1	0.9	54.1	59.5	85.5	46.7	49.1	58.6	47.7	50.1	91.9	0	PASS	PASS	markers.tsv:L3	markers.tsv:L4	9	16	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/P-npu-rerun-02.log`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L467` `no-cool-htp-recovery	P-npu-rerun-02	battery_start	29.5	battery_dC	9	1790648468.135130951	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648468.135130951 battery_dC=295 skin_C=30.4 battery_dC=295`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L468` `no-cool-htp-recovery	P-npu-rerun-02	battery_peak	30.2	battery_dC	15	1790648474.612465428	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648474.612465428 battery_dC=302 skin_C=31.1 battery_dC=302`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L469` `no-cool-htp-recovery	P-npu-rerun-02	battery_end	30.2	battery_dC	16	1790648475.703560740	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648475.703560740 battery_dC=302 skin_C=31.1 battery_dC=302`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L470` `no-cool-htp-recovery	P-npu-rerun-02	skin_start	30.4	skin_C	9	1790648468.135130951	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648468.135130951 battery_dC=295 skin_C=30.4 skin_C=30.4`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L471` `no-cool-htp-recovery	P-npu-rerun-02	skin_peak	31.1	skin_C	14	1790648473.509974022	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648473.509974022 battery_dC=295 skin_C=31.1 skin_C=31.1`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L472` `no-cool-htp-recovery	P-npu-rerun-02	skin_end	31.1	skin_C	16	1790648475.703560740	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648475.703560740 battery_dC=302 skin_C=31.1 skin_C=31.1`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L474` `no-cool-htp-recovery	P-npu-rerun-02	CPU_peak	85.5	cpu-1-1	14	1790648473.509974022	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648473.509974022 battery_dC=295 skin_C=31.1 cpu-1-1=85500`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L477` `no-cool-htp-recovery	P-npu-rerun-02	GPU_peak	58.6	gpuss-4	14	1790648473.509974022	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648473.509974022 battery_dC=295 skin_C=31.1 gpuss-4=58600`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L480` `no-cool-htp-recovery	P-npu-rerun-02	NSP_peak	91.9	nspss-2	13	1790648472.441865481	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648472.441865481 battery_dC=295 skin_C=30.4 nspss-2=91900`

### no-cool-htp-recovery — P-npu-rerun-03

> `/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/markers.tsv:L5` `1790648476.309219646	START_P-npu-rerun-03	cmd=./bin/llama-completion -m /data/local/tmp/heat3way/ship.gguf -lm none --ignore-eos --seed 1 --temp 0 --no-conversation -c 2048 -b 2048 -ub 1024 -t 5 -fa 1 --no-warmup --perf --simple-io --no-display-prompt -f /data/local/tmp/heat3way/prompt.txt -n 16 -lv 4 -dev HTP0 -ngl 99 -nkvo`
> `/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/markers.tsv:L6` `1790648482.685386987	END_P-npu-rerun-03	rc=0 backend_proof=PASS`
> `/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/P-npu-rerun-03.log:L187` `0.06.049.593 I common_perf_print: prompt eval time =    1610.31 ms /   962 tokens (    1.67 ms per token,   597.40 tokens per second)`
> `/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/P-npu-rerun-03.log:L188` `0.06.049.596 I common_perf_print:        eval time =    1041.57 ms /    15 runs   (   69.44 ms per token,    14.40 tokens per second)`
> `/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/P-npu-rerun-03.log:L195` `EXIT=0`
> `/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/P-npu-rerun-03.log:L132` `0.00.661.906 I load_tensors:         HTP0 model buffer size =  1525.87 MiB`
> `/tmp/s23-heat-abc/prefill-run-summary.tsv:L34` `no-cool-htp-recovery	3	P-npu-rerun-03	HTP0 -ngl 99 -nkvo	962	15	1610.31	6.376	30.2	30.2	0.0	31.1	31.1	0.0	0.9	31.1	0.9	59.5	61.6	86.7	49.1	51.9	60.2	50.1	52.9	77.6	0	PASS	PASS	markers.tsv:L5	markers.tsv:L6	16	23	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/P-npu-rerun-03.log`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L482` `no-cool-htp-recovery	P-npu-rerun-03	battery_start	30.2	battery_dC	16	1790648475.703560740	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648475.703560740 battery_dC=302 skin_C=31.1 battery_dC=302`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L483` `no-cool-htp-recovery	P-npu-rerun-03	battery_peak	30.2	battery_dC	17	1790648476.766311156	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648476.766311156 battery_dC=302 skin_C=31.1 battery_dC=302`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L484` `no-cool-htp-recovery	P-npu-rerun-03	battery_end	30.2	battery_dC	23	1790648483.200469227	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648483.200469227 battery_dC=302 skin_C=31.1 battery_dC=302`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L485` `no-cool-htp-recovery	P-npu-rerun-03	skin_start	31.1	skin_C	16	1790648475.703560740	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648475.703560740 battery_dC=302 skin_C=31.1 skin_C=31.1`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L486` `no-cool-htp-recovery	P-npu-rerun-03	skin_peak	31.1	skin_C	17	1790648476.766311156	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648476.766311156 battery_dC=302 skin_C=31.1 skin_C=31.1`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L487` `no-cool-htp-recovery	P-npu-rerun-03	skin_end	31.1	skin_C	23	1790648483.200469227	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648483.200469227 battery_dC=302 skin_C=31.1 skin_C=31.1`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L489` `no-cool-htp-recovery	P-npu-rerun-03	CPU_peak	86.7	cpu-1-1	21	1790648481.014015946	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648481.014015946 battery_dC=302 skin_C=31.1 cpu-1-1=86700`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L492` `no-cool-htp-recovery	P-npu-rerun-03	GPU_peak	60.2	gpuss-4	21	1790648481.014015946	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648481.014015946 battery_dC=302 skin_C=31.1 gpuss-4=60200`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L495` `no-cool-htp-recovery	P-npu-rerun-03	NSP_peak	77.6	nspss-3	20	1790648479.978597978	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648479.978597978 battery_dC=302 skin_C=31.1 nspss-3=77600`

### no-cool-htp-recovery — P-npu-rerun-04

> `/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/markers.tsv:L7` `1790648483.824060945	START_P-npu-rerun-04	cmd=./bin/llama-completion -m /data/local/tmp/heat3way/ship.gguf -lm none --ignore-eos --seed 1 --temp 0 --no-conversation -c 2048 -b 2048 -ub 1024 -t 5 -fa 1 --no-warmup --perf --simple-io --no-display-prompt -f /data/local/tmp/heat3way/prompt.txt -n 16 -lv 4 -dev HTP0 -ngl 99 -nkvo`
> `/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/markers.tsv:L8` `1790648490.147768807	END_P-npu-rerun-04	rc=0 backend_proof=PASS`
> `/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/P-npu-rerun-04.log:L187` `0.06.019.745 I common_perf_print: prompt eval time =    1631.30 ms /   962 tokens (    1.70 ms per token,   589.71 tokens per second)`
> `/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/P-npu-rerun-04.log:L188` `0.06.019.749 I common_perf_print:        eval time =     989.26 ms /    15 runs   (   65.95 ms per token,    15.16 tokens per second)`
> `/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/P-npu-rerun-04.log:L195` `EXIT=0`
> `/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/P-npu-rerun-04.log:L132` `0.00.663.804 I load_tensors:         HTP0 model buffer size =  1525.87 MiB`
> `/tmp/s23-heat-abc/prefill-run-summary.tsv:L35` `no-cool-htp-recovery	4	P-npu-rerun-04	HTP0 -ngl 99 -nkvo	962	15	1631.3	6.324	30.2	30.2	0.0	31.1	32.0	0.9	1.8	32.0	1.8	61.6	59.3	87.1	51.9	52.3	61.0	52.9	52.9	78.0	0	PASS	PASS	markers.tsv:L7	markers.tsv:L8	23	30	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/P-npu-rerun-04.log`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L497` `no-cool-htp-recovery	P-npu-rerun-04	battery_start	30.2	battery_dC	23	1790648483.200469227	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648483.200469227 battery_dC=302 skin_C=31.1 battery_dC=302`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L498` `no-cool-htp-recovery	P-npu-rerun-04	battery_peak	30.2	battery_dC	24	1790648484.240907872	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648484.240907872 battery_dC=302 skin_C=32.0 battery_dC=302`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L499` `no-cool-htp-recovery	P-npu-rerun-04	battery_end	30.2	battery_dC	30	1790648490.701533807	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648490.701533807 battery_dC=302 skin_C=32.0 battery_dC=302`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L500` `no-cool-htp-recovery	P-npu-rerun-04	skin_start	31.1	skin_C	23	1790648483.200469227	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648483.200469227 battery_dC=302 skin_C=31.1 skin_C=31.1`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L501` `no-cool-htp-recovery	P-npu-rerun-04	skin_peak	32.0	skin_C	24	1790648484.240907872	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648484.240907872 battery_dC=302 skin_C=32.0 skin_C=32.0`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L502` `no-cool-htp-recovery	P-npu-rerun-04	skin_end	32.0	skin_C	30	1790648490.701533807	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648490.701533807 battery_dC=302 skin_C=32.0 skin_C=32.0`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L504` `no-cool-htp-recovery	P-npu-rerun-04	CPU_peak	87.1	cpu-1-3	28	1790648488.503778443	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648488.503778443 battery_dC=302 skin_C=32.0 cpu-1-3=87100`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L507` `no-cool-htp-recovery	P-npu-rerun-04	GPU_peak	61.0	gpuss-4	28	1790648488.503778443	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648488.503778443 battery_dC=302 skin_C=32.0 gpuss-4=61000`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L510` `no-cool-htp-recovery	P-npu-rerun-04	NSP_peak	78.0	nspss-0	28	1790648488.503778443	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648488.503778443 battery_dC=302 skin_C=32.0 nspss-0=78000`

### no-cool-htp-recovery — P-npu-rerun-05

> `/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/markers.tsv:L9` `1790648491.445807869	START_P-npu-rerun-05	cmd=./bin/llama-completion -m /data/local/tmp/heat3way/ship.gguf -lm none --ignore-eos --seed 1 --temp 0 --no-conversation -c 2048 -b 2048 -ub 1024 -t 5 -fa 1 --no-warmup --perf --simple-io --no-display-prompt -f /data/local/tmp/heat3way/prompt.txt -n 16 -lv 4 -dev HTP0 -ngl 99 -nkvo`
> `/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/markers.tsv:L10` `1790648497.647118752	END_P-npu-rerun-05	rc=0 backend_proof=PASS`
> `/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/P-npu-rerun-05.log:L187` `0.05.881.858 I common_perf_print: prompt eval time =    1489.30 ms /   962 tokens (    1.55 ms per token,   645.94 tokens per second)`
> `/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/P-npu-rerun-05.log:L188` `0.05.881.866 I common_perf_print:        eval time =     988.75 ms /    15 runs   (   65.92 ms per token,    15.17 tokens per second)`
> `/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/P-npu-rerun-05.log:L195` `EXIT=0`
> `/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/P-npu-rerun-05.log:L132` `0.00.662.792 I load_tensors:         HTP0 model buffer size =  1525.87 MiB`
> `/tmp/s23-heat-abc/prefill-run-summary.tsv:L36` `no-cool-htp-recovery	5	P-npu-rerun-05	HTP0 -ngl 99 -nkvo	962	15	1489.3	6.201	30.2	30.2	0.0	32.0	32.6	0.6	2.4	32.6	2.4	59.3	60.5	88.7	52.3	52.7	64.6	52.9	53.3	78.4	0	PASS	PASS	markers.tsv:L9	markers.tsv:L10	30	37	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/P-npu-rerun-05.log`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L512` `no-cool-htp-recovery	P-npu-rerun-05	battery_start	30.2	battery_dC	30	1790648490.701533807	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648490.701533807 battery_dC=302 skin_C=32.0 battery_dC=302`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L513` `no-cool-htp-recovery	P-npu-rerun-05	battery_peak	30.2	battery_dC	31	1790648491.820599744	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648491.820599744 battery_dC=302 skin_C=32.0 battery_dC=302`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L514` `no-cool-htp-recovery	P-npu-rerun-05	battery_end	30.2	battery_dC	37	1790648498.311025627	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648498.311025627 battery_dC=302 skin_C=32.6 battery_dC=302`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L515` `no-cool-htp-recovery	P-npu-rerun-05	skin_start	32.0	skin_C	30	1790648490.701533807	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648490.701533807 battery_dC=302 skin_C=32.0 skin_C=32.0`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L516` `no-cool-htp-recovery	P-npu-rerun-05	skin_peak	32.6	skin_C	33	1790648494.006412556	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648494.006412556 battery_dC=302 skin_C=32.6 skin_C=32.6`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L517` `no-cool-htp-recovery	P-npu-rerun-05	skin_end	32.6	skin_C	37	1790648498.311025627	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648498.311025627 battery_dC=302 skin_C=32.6 skin_C=32.6`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L519` `no-cool-htp-recovery	P-npu-rerun-05	CPU_peak	88.7	cpu-1-9	35	1790648496.200816357	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648496.200816357 battery_dC=302 skin_C=32.6 cpu-1-9=88700`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L522` `no-cool-htp-recovery	P-npu-rerun-05	GPU_peak	64.6	gpuss-4	35	1790648496.200816357	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648496.200816357 battery_dC=302 skin_C=32.6 gpuss-4=64600`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L525` `no-cool-htp-recovery	P-npu-rerun-05	NSP_peak	78.4	nspss-0	35	1790648496.200816357	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648496.200816357 battery_dC=302 skin_C=32.6 nspss-0=78400`

### no-cool-htp-recovery — P-npu-rerun-06

> `/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/markers.tsv:L11` `1790648499.040216460	START_P-npu-rerun-06	cmd=./bin/llama-completion -m /data/local/tmp/heat3way/ship.gguf -lm none --ignore-eos --seed 1 --temp 0 --no-conversation -c 2048 -b 2048 -ub 1024 -t 5 -fa 1 --no-warmup --perf --simple-io --no-display-prompt -f /data/local/tmp/heat3way/prompt.txt -n 16 -lv 4 -dev HTP0 -ngl 99 -nkvo`
> `/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/markers.tsv:L12` `1790648505.178159010	END_P-npu-rerun-06	rc=0 backend_proof=PASS`
> `/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/P-npu-rerun-06.log:L187` `0.05.842.404 I common_perf_print: prompt eval time =    1503.58 ms /   962 tokens (    1.56 ms per token,   639.81 tokens per second)`
> `/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/P-npu-rerun-06.log:L188` `0.05.842.408 I common_perf_print:        eval time =     950.06 ms /    15 runs   (   63.34 ms per token,    15.79 tokens per second)`
> `/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/P-npu-rerun-06.log:L195` `EXIT=0`
> `/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/P-npu-rerun-06.log:L132` `0.00.662.278 I load_tensors:         HTP0 model buffer size =  1525.87 MiB`
> `/tmp/s23-heat-abc/prefill-run-summary.tsv:L37` `no-cool-htp-recovery	6	P-npu-rerun-06	HTP0 -ngl 99 -nkvo	962	15	1503.58	6.138	30.2	32.6	2.4	32.6	33.1	0.5	2.9	33.1	2.9	60.5	61.2	89.5	52.7	53.5	64.2	53.3	53.3	81.2	0	PASS	PASS	markers.tsv:L11	markers.tsv:L12	37	44	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/P-npu-rerun-06.log`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L527` `no-cool-htp-recovery	P-npu-rerun-06	battery_start	30.2	battery_dC	37	1790648498.311025627	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648498.311025627 battery_dC=302 skin_C=32.6 battery_dC=302`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L528` `no-cool-htp-recovery	P-npu-rerun-06	battery_peak	32.6	battery_dC	43	1790648504.837679114	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648504.837679114 battery_dC=326 skin_C=33.1 battery_dC=326`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L529` `no-cool-htp-recovery	P-npu-rerun-06	battery_end	32.6	battery_dC	44	1790648505.956712603	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648505.956712603 battery_dC=326 skin_C=33.1 battery_dC=326`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L530` `no-cool-htp-recovery	P-npu-rerun-06	skin_start	32.6	skin_C	37	1790648498.311025627	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648498.311025627 battery_dC=302 skin_C=32.6 skin_C=32.6`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L531` `no-cool-htp-recovery	P-npu-rerun-06	skin_peak	33.1	skin_C	42	1790648503.768149375	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648503.768149375 battery_dC=302 skin_C=33.1 skin_C=33.1`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L532` `no-cool-htp-recovery	P-npu-rerun-06	skin_end	33.1	skin_C	44	1790648505.956712603	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648505.956712603 battery_dC=326 skin_C=33.1 skin_C=33.1`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L534` `no-cool-htp-recovery	P-npu-rerun-06	CPU_peak	89.5	cpu-1-9	42	1790648503.768149375	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648503.768149375 battery_dC=302 skin_C=33.1 cpu-1-9=89500`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L537` `no-cool-htp-recovery	P-npu-rerun-06	GPU_peak	64.2	gpuss-4	42	1790648503.768149375	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648503.768149375 battery_dC=302 skin_C=33.1 gpuss-4=64200`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L540` `no-cool-htp-recovery	P-npu-rerun-06	NSP_peak	81.2	nspss-1	42	1790648503.768149375	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648503.768149375 battery_dC=302 skin_C=33.1 nspss-1=81200`

### no-cool-htp-recovery — P-npu-rerun-07

> `/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/markers.tsv:L13` `1790648506.446250676	START_P-npu-rerun-07	cmd=./bin/llama-completion -m /data/local/tmp/heat3way/ship.gguf -lm none --ignore-eos --seed 1 --temp 0 --no-conversation -c 2048 -b 2048 -ub 1024 -t 5 -fa 1 --no-warmup --perf --simple-io --no-display-prompt -f /data/local/tmp/heat3way/prompt.txt -n 16 -lv 4 -dev HTP0 -ngl 99 -nkvo`
> `/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/markers.tsv:L14` `1790648512.659862913	END_P-npu-rerun-07	rc=0 backend_proof=PASS`
> `/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/P-npu-rerun-07.log:L187` `0.05.927.608 I common_perf_print: prompt eval time =    1522.31 ms /   962 tokens (    1.58 ms per token,   631.93 tokens per second)`
> `/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/P-npu-rerun-07.log:L188` `0.05.927.612 I common_perf_print:        eval time =     973.19 ms /    15 runs   (   64.88 ms per token,    15.41 tokens per second)`
> `/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/P-npu-rerun-07.log:L195` `EXIT=0`
> `/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/P-npu-rerun-07.log:L132` `0.00.705.777 I load_tensors:         HTP0 model buffer size =  1525.87 MiB`
> `/tmp/s23-heat-abc/prefill-run-summary.tsv:L38` `no-cool-htp-recovery	7	P-npu-rerun-07	HTP0 -ngl 99 -nkvo	962	15	1522.31	6.214	32.6	32.6	0.0	33.1	34.1	1.0	3.9	33.1	2.9	61.2	66.1	86.3	53.5	53.5	65.0	53.3	54.5	93.5	0	PASS	PASS	markers.tsv:L13	markers.tsv:L14	44	51	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/P-npu-rerun-07.log`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L542` `no-cool-htp-recovery	P-npu-rerun-07	battery_start	32.6	battery_dC	44	1790648505.956712603	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648505.956712603 battery_dC=326 skin_C=33.1 battery_dC=326`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L543` `no-cool-htp-recovery	P-npu-rerun-07	battery_peak	32.6	battery_dC	45	1790648507.084296197	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648507.084296197 battery_dC=326 skin_C=33.1 battery_dC=326`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L544` `no-cool-htp-recovery	P-npu-rerun-07	battery_end	32.6	battery_dC	51	1790648513.499730465	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648513.499730465 battery_dC=326 skin_C=34.1 battery_dC=326`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L545` `no-cool-htp-recovery	P-npu-rerun-07	skin_start	33.1	skin_C	44	1790648505.956712603	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648505.956712603 battery_dC=326 skin_C=33.1 skin_C=33.1`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L546` `no-cool-htp-recovery	P-npu-rerun-07	skin_peak	33.1	skin_C	45	1790648507.084296197	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648507.084296197 battery_dC=326 skin_C=33.1 skin_C=33.1`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L547` `no-cool-htp-recovery	P-npu-rerun-07	skin_end	34.1	skin_C	51	1790648513.499730465	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648513.499730465 battery_dC=326 skin_C=34.1 skin_C=34.1`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L549` `no-cool-htp-recovery	P-npu-rerun-07	CPU_peak	86.3	cpu-1-9	49	1790648511.367355518	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648511.367355518 battery_dC=326 skin_C=33.1 cpu-1-9=86300`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L552` `no-cool-htp-recovery	P-npu-rerun-07	GPU_peak	65.0	gpuss-4	49	1790648511.367355518	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648511.367355518 battery_dC=326 skin_C=33.1 gpuss-4=65000`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L555` `no-cool-htp-recovery	P-npu-rerun-07	NSP_peak	93.5	nspss-2	48	1790648510.309795362	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648510.309795362 battery_dC=326 skin_C=33.1 nspss-2=93500`

### no-cool-htp-recovery — P-npu-rerun-08

> `/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/markers.tsv:L15` `1790648514.007581663	START_P-npu-rerun-08	cmd=./bin/llama-completion -m /data/local/tmp/heat3way/ship.gguf -lm none --ignore-eos --seed 1 --temp 0 --no-conversation -c 2048 -b 2048 -ub 1024 -t 5 -fa 1 --no-warmup --perf --simple-io --no-display-prompt -f /data/local/tmp/heat3way/prompt.txt -n 16 -lv 4 -dev HTP0 -ngl 99 -nkvo`
> `/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/markers.tsv:L16` `1790648520.336142858	END_P-npu-rerun-08	rc=0 backend_proof=PASS`
> `/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/P-npu-rerun-08.log:L187` `0.06.018.843 I common_perf_print: prompt eval time =    1530.60 ms /   962 tokens (    1.59 ms per token,   628.51 tokens per second)`
> `/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/P-npu-rerun-08.log:L188` `0.06.018.853 I common_perf_print:        eval time =    1023.13 ms /    15 runs   (   68.21 ms per token,    14.66 tokens per second)`
> `/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/P-npu-rerun-08.log:L195` `EXIT=0`
> `/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/P-npu-rerun-08.log:L132` `0.00.717.271 I load_tensors:         HTP0 model buffer size =  1525.87 MiB`
> `/tmp/s23-heat-abc/prefill-run-summary.tsv:L39` `no-cool-htp-recovery	8	P-npu-rerun-08	HTP0 -ngl 99 -nkvo	962	15	1530.6	6.329	32.6	32.6	0.0	34.1	34.1	0.0	3.9	34.1	3.9	66.1	70.5	89.9	53.5	54.7	65.0	54.5	55.7	79.6	0	PASS	PASS	markers.tsv:L15	markers.tsv:L16	51	58	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/P-npu-rerun-08.log`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L557` `no-cool-htp-recovery	P-npu-rerun-08	battery_start	32.6	battery_dC	51	1790648513.499730465	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648513.499730465 battery_dC=326 skin_C=34.1 battery_dC=326`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L558` `no-cool-htp-recovery	P-npu-rerun-08	battery_peak	32.6	battery_dC	52	1790648514.584089735	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648514.584089735 battery_dC=326 skin_C=34.1 battery_dC=326`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L559` `no-cool-htp-recovery	P-npu-rerun-08	battery_end	32.6	battery_dC	58	1790648520.956100983	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648520.956100983 battery_dC=326 skin_C=34.1 battery_dC=326`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L560` `no-cool-htp-recovery	P-npu-rerun-08	skin_start	34.1	skin_C	51	1790648513.499730465	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648513.499730465 battery_dC=326 skin_C=34.1 skin_C=34.1`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L561` `no-cool-htp-recovery	P-npu-rerun-08	skin_peak	34.1	skin_C	52	1790648514.584089735	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648514.584089735 battery_dC=326 skin_C=34.1 skin_C=34.1`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L562` `no-cool-htp-recovery	P-npu-rerun-08	skin_end	34.1	skin_C	58	1790648520.956100983	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648520.956100983 battery_dC=326 skin_C=34.1 skin_C=34.1`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L564` `no-cool-htp-recovery	P-npu-rerun-08	CPU_peak	89.9	cpu-1-9	56	1790648518.831985567	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648518.831985567 battery_dC=326 skin_C=34.1 cpu-1-9=89900`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L567` `no-cool-htp-recovery	P-npu-rerun-08	GPU_peak	65.0	gpuss-4	56	1790648518.831985567	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648518.831985567 battery_dC=326 skin_C=34.1 gpuss-4=65000`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L570` `no-cool-htp-recovery	P-npu-rerun-08	NSP_peak	79.6	nspss-0	56	1790648518.831985567	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648518.831985567 battery_dC=326 skin_C=34.1 nspss-0=79600`

### no-cool-htp-recovery — P-npu-rerun-09

> `/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/markers.tsv:L17` `1790648521.541672077	START_P-npu-rerun-09	cmd=./bin/llama-completion -m /data/local/tmp/heat3way/ship.gguf -lm none --ignore-eos --seed 1 --temp 0 --no-conversation -c 2048 -b 2048 -ub 1024 -t 5 -fa 1 --no-warmup --perf --simple-io --no-display-prompt -f /data/local/tmp/heat3way/prompt.txt -n 16 -lv 4 -dev HTP0 -ngl 99 -nkvo`
> `/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/markers.tsv:L18` `1790648527.910793116	END_P-npu-rerun-09	rc=0 backend_proof=PASS`
> `/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/P-npu-rerun-09.log:L187` `0.06.065.204 I common_perf_print: prompt eval time =    1525.27 ms /   962 tokens (    1.59 ms per token,   630.71 tokens per second)`
> `/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/P-npu-rerun-09.log:L188` `0.06.065.225 I common_perf_print:        eval time =    1021.45 ms /    15 runs   (   68.10 ms per token,    14.69 tokens per second)`
> `/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/P-npu-rerun-09.log:L195` `EXIT=0`
> `/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/P-npu-rerun-09.log:L132` `0.00.706.651 I load_tensors:         HTP0 model buffer size =  1525.87 MiB`
> `/tmp/s23-heat-abc/prefill-run-summary.tsv:L40` `no-cool-htp-recovery	9	P-npu-rerun-09	HTP0 -ngl 99 -nkvo	962	15	1525.27	6.369	32.6	32.6	0.0	34.1	34.5	0.4	4.3	34.5	4.3	70.5	72.1	89.5	54.7	56.3	65.4	55.7	57.3	91.1	0	PASS	PASS	markers.tsv:L17	markers.tsv:L18	58	65	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/P-npu-rerun-09.log`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L572` `no-cool-htp-recovery	P-npu-rerun-09	battery_start	32.6	battery_dC	58	1790648520.956100983	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648520.956100983 battery_dC=326 skin_C=34.1 battery_dC=326`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L573` `no-cool-htp-recovery	P-npu-rerun-09	battery_peak	32.6	battery_dC	59	1790648522.044914628	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648522.044914628 battery_dC=326 skin_C=34.1 battery_dC=326`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L574` `no-cool-htp-recovery	P-npu-rerun-09	battery_end	32.6	battery_dC	65	1790648528.568127699	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648528.568127699 battery_dC=326 skin_C=34.5 battery_dC=326`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L575` `no-cool-htp-recovery	P-npu-rerun-09	skin_start	34.1	skin_C	58	1790648520.956100983	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648520.956100983 battery_dC=326 skin_C=34.1 skin_C=34.1`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L576` `no-cool-htp-recovery	P-npu-rerun-09	skin_peak	34.5	skin_C	61	1790648524.261762544	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648524.261762544 battery_dC=326 skin_C=34.5 skin_C=34.5`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L577` `no-cool-htp-recovery	P-npu-rerun-09	skin_end	34.5	skin_C	65	1790648528.568127699	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648528.568127699 battery_dC=326 skin_C=34.5 skin_C=34.5`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L579` `no-cool-htp-recovery	P-npu-rerun-09	CPU_peak	89.5	cpu-1-9	63	1790648526.391018689	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648526.391018689 battery_dC=326 skin_C=34.5 cpu-1-9=89500`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L582` `no-cool-htp-recovery	P-npu-rerun-09	GPU_peak	65.4	gpuss-4	63	1790648526.391018689	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648526.391018689 battery_dC=326 skin_C=34.5 gpuss-4=65400`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L585` `no-cool-htp-recovery	P-npu-rerun-09	NSP_peak	91.1	nspss-3	62	1790648525.308326606	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648525.308326606 battery_dC=326 skin_C=34.5 nspss-3=91100`

### no-cool-htp-recovery — P-npu-rerun-10

> `/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/markers.tsv:L19` `1790648529.053235667	START_P-npu-rerun-10	cmd=./bin/llama-completion -m /data/local/tmp/heat3way/ship.gguf -lm none --ignore-eos --seed 1 --temp 0 --no-conversation -c 2048 -b 2048 -ub 1024 -t 5 -fa 1 --no-warmup --perf --simple-io --no-display-prompt -f /data/local/tmp/heat3way/prompt.txt -n 16 -lv 4 -dev HTP0 -ngl 99 -nkvo`
> `/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/markers.tsv:L20` `1790648535.432896394	END_P-npu-rerun-10	rc=0 backend_proof=PASS`
> `/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/P-npu-rerun-10.log:L187` `0.06.037.289 I common_perf_print: prompt eval time =    1580.87 ms /   962 tokens (    1.64 ms per token,   608.53 tokens per second)`
> `/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/P-npu-rerun-10.log:L188` `0.06.037.293 I common_perf_print:        eval time =    1013.07 ms /    15 runs   (   67.54 ms per token,    14.81 tokens per second)`
> `/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/P-npu-rerun-10.log:L195` `EXIT=0`
> `/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/P-npu-rerun-10.log:L132` `0.00.667.149 I load_tensors:         HTP0 model buffer size =  1525.87 MiB`
> `/tmp/s23-heat-abc/prefill-run-summary.tsv:L41` `no-cool-htp-recovery	10	P-npu-rerun-10	HTP0 -ngl 99 -nkvo	962	15	1580.87	6.38	32.6	34.2	1.6	34.5	34.9	0.4	4.7	34.9	4.7	72.1	64.5	89.5	56.3	55.5	66.2	57.3	56.5	89.6	0	PASS	PASS	markers.tsv:L19	markers.tsv:L20	65	72	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/P-npu-rerun-10.log`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L587` `no-cool-htp-recovery	P-npu-rerun-10	battery_start	32.6	battery_dC	65	1790648528.568127699	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648528.568127699 battery_dC=326 skin_C=34.5 battery_dC=326`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L588` `no-cool-htp-recovery	P-npu-rerun-10	battery_peak	34.2	battery_dC	71	1790648535.006581342	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648535.006581342 battery_dC=342 skin_C=34.9 battery_dC=342`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L589` `no-cool-htp-recovery	P-npu-rerun-10	battery_end	34.2	battery_dC	72	1790648536.092048894	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648536.092048894 battery_dC=342 skin_C=34.9 battery_dC=342`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L590` `no-cool-htp-recovery	P-npu-rerun-10	skin_start	34.5	skin_C	65	1790648528.568127699	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648528.568127699 battery_dC=326 skin_C=34.5 skin_C=34.5`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L591` `no-cool-htp-recovery	P-npu-rerun-10	skin_peak	34.9	skin_C	70	1790648533.938642020	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648533.938642020 battery_dC=326 skin_C=34.9 skin_C=34.9`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L592` `no-cool-htp-recovery	P-npu-rerun-10	skin_end	34.9	skin_C	72	1790648536.092048894	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648536.092048894 battery_dC=342 skin_C=34.9 skin_C=34.9`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L594` `no-cool-htp-recovery	P-npu-rerun-10	CPU_peak	89.5	cpu-1-9	70	1790648533.938642020	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648533.938642020 battery_dC=326 skin_C=34.9 cpu-1-9=89500`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L597` `no-cool-htp-recovery	P-npu-rerun-10	GPU_peak	66.2	gpuss-4	70	1790648533.938642020	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648533.938642020 battery_dC=326 skin_C=34.9 gpuss-4=66200`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L600` `no-cool-htp-recovery	P-npu-rerun-10	NSP_peak	89.6	nspss-3	69	1790648532.853649208	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648532.853649208 battery_dC=326 skin_C=34.5 nspss-3=89600`

### no-cool-htp-recovery — P-npu-rerun-11

> `/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/markers.tsv:L21` `1790648536.705440665	START_P-npu-rerun-11	cmd=./bin/llama-completion -m /data/local/tmp/heat3way/ship.gguf -lm none --ignore-eos --seed 1 --temp 0 --no-conversation -c 2048 -b 2048 -ub 1024 -t 5 -fa 1 --no-warmup --perf --simple-io --no-display-prompt -f /data/local/tmp/heat3way/prompt.txt -n 16 -lv 4 -dev HTP0 -ngl 99 -nkvo`
> `/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/markers.tsv:L22` `1790648543.092734412	END_P-npu-rerun-11	rc=0 backend_proof=PASS`
> `/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/P-npu-rerun-11.log:L187` `0.06.077.139 I common_perf_print: prompt eval time =    1545.41 ms /   962 tokens (    1.61 ms per token,   622.49 tokens per second)`
> `/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/P-npu-rerun-11.log:L188` `0.06.077.145 I common_perf_print:        eval time =    1020.64 ms /    15 runs   (   68.04 ms per token,    14.70 tokens per second)`
> `/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/P-npu-rerun-11.log:L195` `EXIT=0`
> `/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/P-npu-rerun-11.log:L132` `0.00.687.807 I load_tensors:         HTP0 model buffer size =  1525.87 MiB`
> `/tmp/s23-heat-abc/prefill-run-summary.tsv:L42` `no-cool-htp-recovery	11	P-npu-rerun-11	HTP0 -ngl 99 -nkvo	962	15	1545.41	6.387	34.2	34.2	0.0	34.9	35.7	0.8	5.5	34.9	4.7	64.5	66.5	87.5	55.5	56.6	64.2	56.5	56.9	93.5	0	PASS	PASS	markers.tsv:L21	markers.tsv:L22	72	79	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/P-npu-rerun-11.log`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L602` `no-cool-htp-recovery	P-npu-rerun-11	battery_start	34.2	battery_dC	72	1790648536.092048894	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648536.092048894 battery_dC=342 skin_C=34.9 battery_dC=342`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L603` `no-cool-htp-recovery	P-npu-rerun-11	battery_peak	34.2	battery_dC	73	1790648537.213587435	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648537.213587435 battery_dC=342 skin_C=34.9 battery_dC=342`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L604` `no-cool-htp-recovery	P-npu-rerun-11	battery_end	34.2	battery_dC	79	1790648543.644713943	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648543.644713943 battery_dC=342 skin_C=35.7 battery_dC=342`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L605` `no-cool-htp-recovery	P-npu-rerun-11	skin_start	34.9	skin_C	72	1790648536.092048894	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648536.092048894 battery_dC=342 skin_C=34.9 skin_C=34.9`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L606` `no-cool-htp-recovery	P-npu-rerun-11	skin_peak	34.9	skin_C	73	1790648537.213587435	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648537.213587435 battery_dC=342 skin_C=34.9 skin_C=34.9`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L607` `no-cool-htp-recovery	P-npu-rerun-11	skin_end	35.7	skin_C	79	1790648543.644713943	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648543.644713943 battery_dC=342 skin_C=35.7 skin_C=35.7`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L609` `no-cool-htp-recovery	P-npu-rerun-11	CPU_peak	87.5	cpu-1-9	73	1790648537.213587435	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648537.213587435 battery_dC=342 skin_C=34.9 cpu-1-9=87500`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L612` `no-cool-htp-recovery	P-npu-rerun-11	GPU_peak	64.2	gpuss-4	77	1790648541.469733475	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648541.469733475 battery_dC=342 skin_C=34.9 gpuss-4=64200`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L615` `no-cool-htp-recovery	P-npu-rerun-11	NSP_peak	93.5	nspss-2	76	1790648540.372853736	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648540.372853736 battery_dC=342 skin_C=34.9 nspss-2=93500`

### no-cool-htp-recovery — P-npu-rerun-12

> `/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/markers.tsv:L23` `1790648544.370670089	START_P-npu-rerun-12	cmd=./bin/llama-completion -m /data/local/tmp/heat3way/ship.gguf -lm none --ignore-eos --seed 1 --temp 0 --no-conversation -c 2048 -b 2048 -ub 1024 -t 5 -fa 1 --no-warmup --perf --simple-io --no-display-prompt -f /data/local/tmp/heat3way/prompt.txt -n 16 -lv 4 -dev HTP0 -ngl 99 -nkvo`
> `/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/markers.tsv:L24` `1790648550.614267430	END_P-npu-rerun-12	rc=0 backend_proof=PASS`
> `/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/P-npu-rerun-12.log:L187` `0.05.905.052 I common_perf_print: prompt eval time =    1460.93 ms /   962 tokens (    1.52 ms per token,   658.48 tokens per second)`
> `/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/P-npu-rerun-12.log:L188` `0.05.905.062 I common_perf_print:        eval time =     979.19 ms /    15 runs   (   65.28 ms per token,    15.32 tokens per second)`
> `/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/P-npu-rerun-12.log:L195` `EXIT=0`
> `/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/P-npu-rerun-12.log:L132` `0.00.673.836 I load_tensors:         HTP0 model buffer size =  1525.87 MiB`
> `/tmp/s23-heat-abc/prefill-run-summary.tsv:L43` `no-cool-htp-recovery	12	P-npu-rerun-12	HTP0 -ngl 99 -nkvo	962	15	1460.93	6.244	34.2	34.2	0.0	35.7	35.7	0.0	5.5	35.7	5.5	66.5	70.9	89.9	56.6	61.0	66.2	56.9	63.3	84.8	0	PASS	PASS	markers.tsv:L23	markers.tsv:L24	79	85	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/P-npu-rerun-12.log`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L617` `no-cool-htp-recovery	P-npu-rerun-12	battery_start	34.2	battery_dC	79	1790648543.644713943	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648543.644713943 battery_dC=342 skin_C=35.7 battery_dC=342`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L618` `no-cool-htp-recovery	P-npu-rerun-12	battery_peak	34.2	battery_dC	80	1790648544.730649047	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648544.730649047 battery_dC=342 skin_C=35.7 battery_dC=342`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L619` `no-cool-htp-recovery	P-npu-rerun-12	battery_end	34.2	battery_dC	85	1790648550.263299930	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648550.263299930 battery_dC=342 skin_C=35.7 battery_dC=342`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L620` `no-cool-htp-recovery	P-npu-rerun-12	skin_start	35.7	skin_C	79	1790648543.644713943	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648543.644713943 battery_dC=342 skin_C=35.7 skin_C=35.7`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L621` `no-cool-htp-recovery	P-npu-rerun-12	skin_peak	35.7	skin_C	80	1790648544.730649047	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648544.730649047 battery_dC=342 skin_C=35.7 skin_C=35.7`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L622` `no-cool-htp-recovery	P-npu-rerun-12	skin_end	35.7	skin_C	85	1790648550.263299930	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648550.263299930 battery_dC=342 skin_C=35.7 skin_C=35.7`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L624` `no-cool-htp-recovery	P-npu-rerun-12	CPU_peak	89.9	cpu-1-9	84	1790648549.149292483	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648549.149292483 battery_dC=342 skin_C=35.7 cpu-1-9=89900`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L627` `no-cool-htp-recovery	P-npu-rerun-12	GPU_peak	66.2	gpuss-4	84	1790648549.149292483	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648549.149292483 battery_dC=342 skin_C=35.7 gpuss-4=66200`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L630` `no-cool-htp-recovery	P-npu-rerun-12	NSP_peak	84.8	nspss-2	83	1790648548.090579150	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648548.090579150 battery_dC=342 skin_C=35.7 nspss-2=84800`

### validator-aborted-attempt — P-npu-rerun-01

> `/tmp/s23-heat-abc/npu-rerun/device-raw/attempt-1-pull/npu-rerun-20260928/markers.tsv:L1` `1790648317.165007780	START_P-npu-rerun-01	cmd=./bin/llama-completion -m /data/local/tmp/heat3way/ship.gguf -lm none --ignore-eos --seed 1 --temp 0 --no-conversation -c 2048 -b 2048 -ub 1024 -t 5 -fa 1 --no-warmup --perf --simple-io --no-display-prompt -f /data/local/tmp/heat3way/prompt.txt -n 16 -lv 4 -dev HTP0 -ngl 99 -nkvo`
> `/tmp/s23-heat-abc/npu-rerun/device-raw/attempt-1-pull/npu-rerun-20260928/markers.tsv:L2` `1790648323.041520538	END_P-npu-rerun-01	rc=0 backend_proof=FAIL`
> `/tmp/s23-heat-abc/npu-rerun/device-raw/attempt-1-pull/npu-rerun-20260928/P-npu-rerun-01.log:L187` `0.05.554.213 I common_perf_print: prompt eval time =    1620.49 ms /   962 tokens (    1.68 ms per token,   593.65 tokens per second)`
> `/tmp/s23-heat-abc/npu-rerun/device-raw/attempt-1-pull/npu-rerun-20260928/P-npu-rerun-01.log:L188` `0.05.554.218 I common_perf_print:        eval time =     966.18 ms /    15 runs   (   64.41 ms per token,    15.52 tokens per second)`
> `/tmp/s23-heat-abc/npu-rerun/device-raw/attempt-1-pull/npu-rerun-20260928/P-npu-rerun-01.log:L195` `EXIT=0`
> `/tmp/s23-heat-abc/npu-rerun/device-raw/attempt-1-pull/npu-rerun-20260928/P-npu-rerun-01.log:L132` `0.00.718.338 I load_tensors:         HTP0 model buffer size =  1525.87 MiB`
> `/tmp/s23-heat-abc/prefill-run-summary.tsv:L44` `validator-aborted-attempt	1	P-npu-rerun-01	HTP0 -ngl 99 -nkvo	962	15	1620.49	5.877	29.4	29.4	0.0	30.1	30.6	0.5	0.5	30.1	0.0	42.5	51.7	89.5	37.6	46.3	56.3	34.6	47.3	69.6	0	PASS	FAIL	markers.tsv:L1	markers.tsv:L2	3	9	/tmp/s23-heat-abc/npu-rerun/device-raw/attempt-1-pull/npu-rerun-20260928/P-npu-rerun-01.log`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L452` `no-cool-htp-recovery	P-npu-rerun-01	battery_start	29.5	battery_dC	3	1790648461.581819027	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648461.581819027 battery_dC=295 skin_C=30.2 battery_dC=295`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L453` `no-cool-htp-recovery	P-npu-rerun-01	battery_peak	29.5	battery_dC	4	1790648462.693647516	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648462.693647516 battery_dC=295 skin_C=30.2 battery_dC=295`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L454` `no-cool-htp-recovery	P-npu-rerun-01	battery_end	29.5	battery_dC	9	1790648468.135130951	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648468.135130951 battery_dC=295 skin_C=30.4 battery_dC=295`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L455` `no-cool-htp-recovery	P-npu-rerun-01	skin_start	30.2	skin_C	3	1790648461.581819027	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648461.581819027 battery_dC=295 skin_C=30.2 skin_C=30.2`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L456` `no-cool-htp-recovery	P-npu-rerun-01	skin_peak	30.4	skin_C	5	1790648463.816817515	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648463.816817515 battery_dC=295 skin_C=30.4 skin_C=30.4`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L457` `no-cool-htp-recovery	P-npu-rerun-01	skin_end	30.4	skin_C	9	1790648468.135130951	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648468.135130951 battery_dC=295 skin_C=30.4 skin_C=30.4`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L459` `no-cool-htp-recovery	P-npu-rerun-01	CPU_peak	83.5	cpu-1-5	8	1790648467.092952618	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648467.092952618 battery_dC=295 skin_C=30.4 cpu-1-5=83500`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L462` `no-cool-htp-recovery	P-npu-rerun-01	GPU_peak	54.7	gpuss-4	7	1790648466.042326733	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648466.042326733 battery_dC=295 skin_C=30.4 gpuss-4=54700`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L465` `no-cool-htp-recovery	P-npu-rerun-01	NSP_peak	67.7	nspss-1	7	1790648466.042326733	/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/samples.tsv	epoch=1790648466.042326733 battery_dC=295 skin_C=30.4 nspss-1=67700`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L632` `validator-aborted-attempt	P-npu-rerun-01	battery_start	29.4	battery_dC	3	1790648316.895330644	/tmp/s23-heat-abc/npu-rerun/device-raw/attempt-1-pull/npu-rerun-20260928/samples.tsv	epoch=1790648316.895330644 battery_dC=294 skin_C=30.1 battery_dC=294`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L633` `validator-aborted-attempt	P-npu-rerun-01	battery_peak	29.4	battery_dC	4	1790648317.964583821	/tmp/s23-heat-abc/npu-rerun/device-raw/attempt-1-pull/npu-rerun-20260928/samples.tsv	epoch=1790648317.964583821 battery_dC=294 skin_C=30.1 battery_dC=294`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L634` `validator-aborted-attempt	P-npu-rerun-01	battery_end	29.4	battery_dC	9	1790648323.470515590	/tmp/s23-heat-abc/npu-rerun/device-raw/attempt-1-pull/npu-rerun-20260928/samples.tsv	epoch=1790648323.470515590 battery_dC=294 skin_C=30.6 battery_dC=294`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L635` `validator-aborted-attempt	P-npu-rerun-01	skin_start	30.1	skin_C	3	1790648316.895330644	/tmp/s23-heat-abc/npu-rerun/device-raw/attempt-1-pull/npu-rerun-20260928/samples.tsv	epoch=1790648316.895330644 battery_dC=294 skin_C=30.1 skin_C=30.1`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L636` `validator-aborted-attempt	P-npu-rerun-01	skin_peak	30.1	skin_C	4	1790648317.964583821	/tmp/s23-heat-abc/npu-rerun/device-raw/attempt-1-pull/npu-rerun-20260928/samples.tsv	epoch=1790648317.964583821 battery_dC=294 skin_C=30.1 skin_C=30.1`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L637` `validator-aborted-attempt	P-npu-rerun-01	skin_end	30.6	skin_C	9	1790648323.470515590	/tmp/s23-heat-abc/npu-rerun/device-raw/attempt-1-pull/npu-rerun-20260928/samples.tsv	epoch=1790648323.470515590 battery_dC=294 skin_C=30.6 skin_C=30.6`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L639` `validator-aborted-attempt	P-npu-rerun-01	CPU_peak	89.5	cpu-1-9	8	1790648322.357459600	/tmp/s23-heat-abc/npu-rerun/device-raw/attempt-1-pull/npu-rerun-20260928/samples.tsv	epoch=1790648322.357459600 battery_dC=294 skin_C=30.1 cpu-1-9=89500`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L642` `validator-aborted-attempt	P-npu-rerun-01	GPU_peak	56.3	gpuss-4	8	1790648322.357459600	/tmp/s23-heat-abc/npu-rerun/device-raw/attempt-1-pull/npu-rerun-20260928/samples.tsv	epoch=1790648322.357459600 battery_dC=294 skin_C=30.1 gpuss-4=56300`
> `/tmp/s23-heat-abc/prefill-temperature-evidence.tsv:L645` `validator-aborted-attempt	P-npu-rerun-01	NSP_peak	69.6	nspss-0	7	1790648321.300209497	/tmp/s23-heat-abc/npu-rerun/device-raw/attempt-1-pull/npu-rerun-20260928/samples.tsv	epoch=1790648321.300209497 battery_dC=294 skin_C=30.1 nspss-0=69600`

## Decode arms

### D-cpu-1

> `/tmp/s23-heat-abc/repeat/session-host-final.log:L7` `GATE BEFORE-D-cpu-1 ac=false usb=false wireless=false battery_dC=285 level=98 status=0 wake=Awake screen=ON traced=0`
> `/tmp/s23-heat-abc/repeat/device-raw/final/markers.tsv:L3` `1790646264.261882261	START_D-cpu-1	cmd=./bin/llama-bench -m /data/local/tmp/heat3way/ship.gguf -p 0 -n 256 -r 1 -t 5 -ngl 0 -dev none -fa 1 --no-warmup -o md`
> `/tmp/s23-heat-abc/repeat/device-raw/final/markers.tsv:L4` `1790646277.025217568	END_D-cpu-1	rc=0 backend_proof=PASS`
> `/tmp/s23-heat-abc/repeat/device-raw/final/D-cpu-1.log:L14` `| lfm2 2.6B Q4_0                 |   1.48 GiB |     2.70 B | OpenCL,HTP |   0 |       5 |   1 | none         |           tg256 |         22.89 ± 0.00 |`
> `/tmp/s23-heat-abc/repeat/device-raw/final/D-cpu-1.log:L17` `EXIT=0`
> `/tmp/s23-heat-abc/decode-arm-summary.tsv:L2` `D-cpu-1	cpu	1	none -ngl 0	0	256	22.89	28.5	30.3	1.8	29.8	1.3	0.2905	29.7	31.5	1.8	30.9	1.2	0.3785	0	90.3	67.4	61.7	0	PASS	session-host-final.log:L7	markers.tsv:L3	markers.tsv:L4	NA	D-cpu-1.log:L14	7	75	/tmp/s23-heat-abc/repeat/device-raw/final/D-cpu-1.log`
> `/tmp/s23-heat-abc/decode-temperature-summary.tsv:L2` `D-cpu-1	28.5	30.3	29.8	1.8	1.3	29.7	31.5	30.9	1.8	1.2	0	90.3	cpu-1-10	67.4	gpuss-4	61.7	nspss-0	7	75`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L2` `D-cpu-1	battery_start	28.5	battery_dC	7	1790646263.966846063	epoch=1790646263.966846063 battery_dC=285 skin_C=29.7 status=0 battery_dC=285`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L3` `D-cpu-1	skin_start	29.7	skin_C	7	1790646263.966846063	epoch=1790646263.966846063 battery_dC=285 skin_C=29.7 status=0 skin_C=29.7`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L4` `D-cpu-1	battery_peak	30.3	battery_dC	43	1790646303.499164850	epoch=1790646303.499164850 battery_dC=303 skin_C=31.3 status=0 battery_dC=303`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L5` `D-cpu-1	skin_peak	31.5	skin_C	25	1790646284.206580690	epoch=1790646284.206580690 battery_dC=290 skin_C=31.5 status=0 skin_C=31.5`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L6` `D-cpu-1	status_peak	0	status	7	1790646263.966846063	epoch=1790646263.966846063 battery_dC=285 skin_C=29.7 status=0 status=0`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L7` `D-cpu-1	CPU_zone_peak	90.3	cpu-1-10	9	1790646266.363493093	epoch=1790646266.363493093 battery_dC=285 skin_C=29.7 status=0 cpu-1-10=90300`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L8` `D-cpu-1	GPU_zone_peak	67.4	gpuss-4	15	1790646273.261142986	epoch=1790646273.261142986 battery_dC=290 skin_C=31.0 status=0 gpuss-4=67400`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L9` `D-cpu-1	NSP_zone_peak	61.7	nspss-0	16	1790646274.426422309	epoch=1790646274.426422309 battery_dC=290 skin_C=31.0 status=0 nspss-0=61700`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L10` `D-cpu-1	battery_end	29.8	battery_dC	75	1790646338.014115305	epoch=1790646338.014115305 battery_dC=298 skin_C=30.9 status=0 battery_dC=298`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L11` `D-cpu-1	skin_end	30.9	skin_C	75	1790646338.014115305	epoch=1790646338.014115305 battery_dC=298 skin_C=30.9 status=0 skin_C=30.9`

### D-gpu-1

> `/tmp/s23-heat-abc/repeat/session-host-final.log:L18` `GATE BEFORE-D-gpu-1 ac=false usb=false wireless=false battery_dC=298 level=98 status=0 wake=Awake screen=ON traced=0`
> `/tmp/s23-heat-abc/repeat/device-raw/final/markers.tsv:L9` `1790646347.501173323	START_D-gpu-1	cmd=./bin/llama-bench -m /data/local/tmp/heat3way/ship.gguf -p 0 -n 256 -r 1 -t 5 -ngl 99 -dev GPUOpenCL -fa 1 --no-warmup -o md`
> `/tmp/s23-heat-abc/repeat/device-raw/final/markers.tsv:L10` `1790646371.740424772	END_D-gpu-1	rc=0 backend_proof=PASS`
> `/tmp/s23-heat-abc/repeat/device-raw/final/D-gpu-1.log:L14` `| lfm2 2.6B Q4_0                 |   1.48 GiB |     2.70 B | OpenCL,HTP |  99 |       5 |   1 | GPUOpenCL    |           tg256 |         14.15 ± 0.00 |`
> `/tmp/s23-heat-abc/repeat/device-raw/final/D-gpu-1.log:L17` `EXIT=0`
> `/tmp/s23-heat-abc/repeat/device-raw/final/D-gpu-1.log:L3` `ggml_opencl: device: 'QUALCOMM Adreno(TM) (OpenCL 3.0 Adreno(TM) 740)'`
> `/tmp/s23-heat-abc/repeat/device-raw/final/BPROOF-gpu-1.log:L131` `0.00.997.603 I load_tensors:       OpenCL model buffer size =  1307.20 MiB`
> `/tmp/s23-heat-abc/decode-arm-summary.tsv:L3` `D-gpu-1	gpu	1	GPUOpenCL -ngl 99	0	256	14.15	29.8	32.2	2.4	31.3	1.5	0.4298	31.0	33.5	2.5	32.4	1.4	0.5253	0	90.3	76.9	64.9	0	PASS	session-host-final.log:L18	markers.tsv:L9	markers.tsv:L10	BPROOF-gpu-1.log:L131	D-gpu-1.log:L14	83	163	/tmp/s23-heat-abc/repeat/device-raw/final/D-gpu-1.log`
> `/tmp/s23-heat-abc/decode-temperature-summary.tsv:L3` `D-gpu-1	29.8	32.2	31.3	2.4	1.5	31.0	33.5	32.4	2.5	1.4	0	90.3	cpu-1-9	76.9	gpuss-4	64.9	nspss-0	83	163`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L12` `D-gpu-1	battery_start	29.8	battery_dC	83	1790646346.814640406	epoch=1790646346.814640406 battery_dC=298 skin_C=31.0 status=0 battery_dC=298`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L13` `D-gpu-1	skin_start	31.0	skin_C	83	1790646346.814640406	epoch=1790646346.814640406 battery_dC=298 skin_C=31.0 status=0 skin_C=31.0`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L14` `D-gpu-1	battery_peak	32.2	battery_dC	126	1790646393.211030493	epoch=1790646393.211030493 battery_dC=322 skin_C=33.1 status=0 battery_dC=322`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L15` `D-gpu-1	skin_peak	33.5	skin_C	108	1790646373.781236229	epoch=1790646373.781236229 battery_dC=306 skin_C=33.5 status=0 skin_C=33.5`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L16` `D-gpu-1	status_peak	0	status	83	1790646346.814640406	epoch=1790646346.814640406 battery_dC=298 skin_C=31.0 status=0 status=0`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L17` `D-gpu-1	CPU_zone_peak	90.3	cpu-1-9	99	1790646364.139073472	epoch=1790646364.139073472 battery_dC=306 skin_C=32.6 status=0 cpu-1-9=90300`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L18` `D-gpu-1	GPU_zone_peak	76.9	gpuss-4	103	1790646368.434776335	epoch=1790646368.434776335 battery_dC=306 skin_C=32.6 status=0 gpuss-4=76900`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L19` `D-gpu-1	NSP_zone_peak	64.9	nspss-0	105	1790646370.593093210	epoch=1790646370.593093210 battery_dC=306 skin_C=32.6 status=0 nspss-0=64900`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L20` `D-gpu-1	battery_end	31.3	battery_dC	163	1790646432.988566415	epoch=1790646432.988566415 battery_dC=313 skin_C=32.4 status=0 battery_dC=313`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L21` `D-gpu-1	skin_end	32.4	skin_C	163	1790646432.988566415	epoch=1790646432.988566415 battery_dC=313 skin_C=32.4 status=0 skin_C=32.4`

### D-npu-1

> `/tmp/s23-heat-abc/repeat/session-host-final.log:L30` `GATE BEFORE-D-npu-1 ac=false usb=false wireless=false battery_dC=313 level=97 status=0 wake=Awake screen=ON traced=0`
> `/tmp/s23-heat-abc/repeat/device-raw/final/markers.tsv:L15` `1790646438.261252819	START_D-npu-1	cmd=./bin/llama-bench -m /data/local/tmp/heat3way/ship.gguf -p 0 -n 256 -r 1 -t 5 -ngl 99 -dev HTP0 -fa 1 --no-warmup -o md`
> `/tmp/s23-heat-abc/repeat/device-raw/final/markers.tsv:L16` `1790646452.218333335	END_D-npu-1	rc=0 backend_proof=PASS`
> `/tmp/s23-heat-abc/repeat/device-raw/final/D-npu-1.log:L14` `| lfm2 2.6B Q4_0                 |   1.48 GiB |     2.70 B | OpenCL,HTP |  99 |       5 |   1 | HTP0         |           tg256 |         22.25 ± 0.00 |`
> `/tmp/s23-heat-abc/repeat/device-raw/final/D-npu-1.log:L17` `EXIT=0`
> `/tmp/s23-heat-abc/repeat/device-raw/final/D-npu-1.log:L10` `ggml-hex: Hexagon Arch version v73`
> `/tmp/s23-heat-abc/repeat/device-raw/final/BPROOF-npu-1.log:L132` `0.00.789.210 I load_tensors:         HTP0 model buffer size =  1525.87 MiB`
> `/tmp/s23-heat-abc/decode-arm-summary.tsv:L4` `D-npu-1	npu	1	HTP0 -ngl 99	0	256	22.25	31.3	31.9	0.6	31.5	0.2	0.1404	32.3	33.5	1.2	32.5	0.2	0.1885	0	72.9	56.6	84.4	0	PASS	session-host-final.log:L30	markers.tsv:L15	markers.tsv:L16	BPROOF-npu-1.log:L132	D-npu-1.log:L14	167	238	/tmp/s23-heat-abc/repeat/device-raw/final/D-npu-1.log`
> `/tmp/s23-heat-abc/decode-temperature-summary.tsv:L4` `D-npu-1	31.3	31.9	31.5	0.6	0.2	32.3	33.5	32.5	1.2	0.2	0	72.9	cpu-1-9	56.6	gpuss-7	84.4	nspss-1	167	238`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L22` `D-npu-1	battery_start	31.3	battery_dC	167	1790646437.283112976	epoch=1790646437.283112976 battery_dC=313 skin_C=32.3 status=0 battery_dC=313`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L23` `D-npu-1	skin_start	32.3	skin_C	167	1790646437.283112976	epoch=1790646437.283112976 battery_dC=313 skin_C=32.3 status=0 skin_C=32.3`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L24` `D-npu-1	battery_peak	31.9	battery_dC	182	1790646453.388885522	epoch=1790646453.388885522 battery_dC=319 skin_C=33.5 status=0 battery_dC=319`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L25` `D-npu-1	skin_peak	33.5	skin_C	182	1790646453.388885522	epoch=1790646453.388885522 battery_dC=319 skin_C=33.5 status=0 skin_C=33.5`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L26` `D-npu-1	status_peak	0	status	167	1790646437.283112976	epoch=1790646437.283112976 battery_dC=313 skin_C=32.3 status=0 status=0`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L27` `D-npu-1	CPU_zone_peak	72.9	cpu-1-9	169	1790646439.464627090	epoch=1790646439.464627090 battery_dC=313 skin_C=32.3 status=0 cpu-1-9=72900`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L28` `D-npu-1	GPU_zone_peak	56.6	gpuss-7	178	1790646449.106721253	epoch=1790646449.106721253 battery_dC=313 skin_C=32.7 status=0 gpuss-7=56600`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L29` `D-npu-1	NSP_zone_peak	84.4	nspss-1	178	1790646449.106721253	epoch=1790646449.106721253 battery_dC=313 skin_C=32.7 status=0 nspss-1=84400`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L30` `D-npu-1	battery_end	31.5	battery_dC	238	1790646513.800774978	epoch=1790646513.800774978 battery_dC=315 skin_C=32.5 status=0 battery_dC=315`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L31` `D-npu-1	skin_end	32.5	skin_C	238	1790646513.800774978	epoch=1790646513.800774978 battery_dC=315 skin_C=32.5 status=0 skin_C=32.5`

### D-gpu-2

> `/tmp/s23-heat-abc/repeat/session-host-final.log:L42` `GATE BEFORE-D-gpu-2 ac=false usb=false wireless=false battery_dC=315 level=97 status=0 wake=Awake screen=ON traced=0`
> `/tmp/s23-heat-abc/repeat/device-raw/final/markers.tsv:L21` `1790646523.016146797	START_D-gpu-2	cmd=./bin/llama-bench -m /data/local/tmp/heat3way/ship.gguf -p 0 -n 256 -r 1 -t 5 -ngl 99 -dev GPUOpenCL -fa 1 --no-warmup -o md`
> `/tmp/s23-heat-abc/repeat/device-raw/final/markers.tsv:L22` `1790646547.759446996	END_D-gpu-2	rc=0 backend_proof=PASS`
> `/tmp/s23-heat-abc/repeat/device-raw/final/D-gpu-2.log:L14` `| lfm2 2.6B Q4_0                 |   1.48 GiB |     2.70 B | OpenCL,HTP |  99 |       5 |   1 | GPUOpenCL    |           tg256 |         14.03 ± 0.00 |`
> `/tmp/s23-heat-abc/repeat/device-raw/final/D-gpu-2.log:L17` `EXIT=0`
> `/tmp/s23-heat-abc/repeat/device-raw/final/D-gpu-2.log:L3` `ggml_opencl: device: 'QUALCOMM Adreno(TM) (OpenCL 3.0 Adreno(TM) 740)'`
> `/tmp/s23-heat-abc/repeat/device-raw/final/BPROOF-gpu-2.log:L131` `0.01.043.924 I load_tensors:       OpenCL model buffer size =  1307.20 MiB`
> `/tmp/s23-heat-abc/decode-arm-summary.tsv:L5` `D-gpu-2	gpu	2	GPUOpenCL -ngl 99	0	256	14.03	31.5	33.6	2.1	32.8	1.3	0.4579	32.5	35.0	2.5	33.8	1.3	0.5293	0	90.3	77.3	65.3	0	PASS	session-host-final.log:L42	markers.tsv:L21	markers.tsv:L22	BPROOF-gpu-2.log:L131	D-gpu-2.log:L14	246	326	/tmp/s23-heat-abc/repeat/device-raw/final/D-gpu-2.log`
> `/tmp/s23-heat-abc/decode-temperature-summary.tsv:L5` `D-gpu-2	31.5	33.6	32.8	2.1	1.3	32.5	35.0	33.8	2.5	1.3	0	90.3	cpu-1-9	77.3	gpuss-4	65.3	nspss-0	246	326`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L32` `D-gpu-2	battery_start	31.5	battery_dC	246	1790646522.669994922	epoch=1790646522.669994922 battery_dC=315 skin_C=32.5 status=0 battery_dC=315`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L33` `D-gpu-2	skin_start	32.5	skin_C	246	1790646522.669994922	epoch=1790646522.669994922 battery_dC=315 skin_C=32.5 status=0 skin_C=32.5`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L34` `D-gpu-2	battery_peak	33.6	battery_dC	294	1790646574.834688132	epoch=1790646574.834688132 battery_dC=336 skin_C=34.3 status=0 battery_dC=336`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L35` `D-gpu-2	skin_peak	35.0	skin_C	274	1790646553.285131838	epoch=1790646553.285131838 battery_dC=331 skin_C=35.0 status=0 skin_C=35.0`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L36` `D-gpu-2	status_peak	0	status	246	1790646522.669994922	epoch=1790646522.669994922 battery_dC=315 skin_C=32.5 status=0 status=0`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L37` `D-gpu-2	CPU_zone_peak	90.3	cpu-1-9	256	1790646533.614947054	epoch=1790646533.614947054 battery_dC=315 skin_C=33.4 status=0 cpu-1-9=90300`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L38` `D-gpu-2	GPU_zone_peak	77.3	gpuss-4	268	1790646546.722429653	epoch=1790646546.722429653 battery_dC=331 skin_C=34.5 status=0 gpuss-4=77300`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L39` `D-gpu-2	NSP_zone_peak	65.3	nspss-0	264	1790646542.241325800	epoch=1790646542.241325800 battery_dC=315 skin_C=33.4 status=0 nspss-0=65300`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L40` `D-gpu-2	battery_end	32.8	battery_dC	326	1790646609.414319629	epoch=1790646609.414319629 battery_dC=328 skin_C=33.8 status=0 battery_dC=328`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L41` `D-gpu-2	skin_end	33.8	skin_C	326	1790646609.414319629	epoch=1790646609.414319629 battery_dC=328 skin_C=33.8 status=0 skin_C=33.8`

### D-npu-2

> `/tmp/s23-heat-abc/repeat/session-host-final.log:L54` `GATE BEFORE-D-npu-2 ac=false usb=false wireless=false battery_dC=328 level=96 status=0 wake=Awake screen=ON traced=0`
> `/tmp/s23-heat-abc/repeat/device-raw/final/markers.tsv:L27` `1790646613.972554419	START_D-npu-2	cmd=./bin/llama-bench -m /data/local/tmp/heat3way/ship.gguf -p 0 -n 256 -r 1 -t 5 -ngl 99 -dev HTP0 -fa 1 --no-warmup -o md`
> `/tmp/s23-heat-abc/repeat/device-raw/final/markers.tsv:L28` `1790646628.117770091	END_D-npu-2	rc=0 backend_proof=PASS`
> `/tmp/s23-heat-abc/repeat/device-raw/final/D-npu-2.log:L14` `| lfm2 2.6B Q4_0                 |   1.48 GiB |     2.70 B | OpenCL,HTP |  99 |       5 |   1 | HTP0         |           tg256 |         22.03 ± 0.00 |`
> `/tmp/s23-heat-abc/repeat/device-raw/final/D-npu-2.log:L17` `EXIT=0`
> `/tmp/s23-heat-abc/repeat/device-raw/final/D-npu-2.log:L10` `ggml-hex: Hexagon Arch version v73`
> `/tmp/s23-heat-abc/repeat/device-raw/final/BPROOF-npu-2.log:L132` `0.00.712.487 I load_tensors:         HTP0 model buffer size =  1525.87 MiB`
> `/tmp/s23-heat-abc/decode-arm-summary.tsv:L6` `D-npu-2	npu	2	HTP0 -ngl 99	0	256	22.03	32.8	33.8	1.0	33.3	0.5	0.1659	33.8	34.6	0.8	33.8	0.0	0.1135	0	77.0	58.2	86.0	0	PASS	session-host-final.log:L54	markers.tsv:L27	markers.tsv:L28	BPROOF-npu-2.log:L132	D-npu-2.log:L14	330	400	/tmp/s23-heat-abc/repeat/device-raw/final/D-npu-2.log`
> `/tmp/s23-heat-abc/decode-temperature-summary.tsv:L6` `D-npu-2	32.8	33.8	33.3	1.0	0.5	33.8	34.6	33.8	0.8	0.0	0	77.0	cpu-1-9	58.2	gpuss-7	86.0	nspss-1	330	400`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L42` `D-npu-2	battery_start	32.8	battery_dC	330	1790646613.790032023	epoch=1790646613.790032023 battery_dC=328 skin_C=33.8 status=0 battery_dC=328`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L43` `D-npu-2	skin_start	33.8	skin_C	330	1790646613.790032023	epoch=1790646613.790032023 battery_dC=328 skin_C=33.8 status=0 skin_C=33.8`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L44` `D-npu-2	battery_peak	33.8	battery_dC	349	1790646634.438781546	epoch=1790646634.438781546 battery_dC=338 skin_C=34.6 status=0 battery_dC=338`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L45` `D-npu-2	skin_peak	34.6	skin_C	348	1790646633.371648526	epoch=1790646633.371648526 battery_dC=328 skin_C=34.6 status=0 skin_C=34.6`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L46` `D-npu-2	status_peak	0	status	330	1790646613.790032023	epoch=1790646613.790032023 battery_dC=328 skin_C=33.8 status=0 status=0`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L47` `D-npu-2	CPU_zone_peak	77.0	cpu-1-9	331	1790646614.870587075	epoch=1790646614.870587075 battery_dC=328 skin_C=33.8 status=0 cpu-1-9=77000`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L48` `D-npu-2	GPU_zone_peak	58.2	gpuss-7	342	1790646626.893141393	epoch=1790646626.893141393 battery_dC=328 skin_C=34.3 status=0 gpuss-7=58200`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L49` `D-npu-2	NSP_zone_peak	86.0	nspss-1	340	1790646624.739188686	epoch=1790646624.739188686 battery_dC=328 skin_C=34.3 status=0 nspss-1=86000`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L50` `D-npu-2	battery_end	33.3	battery_dC	400	1790646688.910165224	epoch=1790646688.910165224 battery_dC=333 skin_C=33.8 status=0 battery_dC=333`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L51` `D-npu-2	skin_end	33.8	skin_C	400	1790646688.910165224	epoch=1790646688.910165224 battery_dC=333 skin_C=33.8 status=0 skin_C=33.8`

### D-cpu-2

> `/tmp/s23-heat-abc/repeat/session-host-final.log:L62` `GATE BEFORE-D-cpu-2 ac=false usb=false wireless=false battery_dC=333 level=96 status=0 wake=Awake screen=ON traced=0`
> `/tmp/s23-heat-abc/repeat/device-raw/final/markers.tsv:L31` `1790646690.120040431	START_D-cpu-2	cmd=./bin/llama-bench -m /data/local/tmp/heat3way/ship.gguf -p 0 -n 256 -r 1 -t 5 -ngl 0 -dev none -fa 1 --no-warmup -o md`
> `/tmp/s23-heat-abc/repeat/device-raw/final/markers.tsv:L32` `1790646703.550609697	END_D-cpu-2	rc=0 backend_proof=PASS`
> `/tmp/s23-heat-abc/repeat/device-raw/final/D-cpu-2.log:L14` `| lfm2 2.6B Q4_0                 |   1.48 GiB |     2.70 B | OpenCL,HTP |   0 |       5 |   1 | none         |           tg256 |         22.13 ± 0.00 |`
> `/tmp/s23-heat-abc/repeat/device-raw/final/D-cpu-2.log:L17` `EXIT=0`
> `/tmp/s23-heat-abc/decode-arm-summary.tsv:L7` `D-cpu-2	cpu	2	none -ngl 0	0	256	22.13	33.3	34.3	1.0	33.6	0.3	0.1278	33.8	35.2	1.4	34.1	0.3	0.2413	0	90.3	69.7	64.9	0	PASS	session-host-final.log:L62	markers.tsv:L31	markers.tsv:L32	NA	D-cpu-2.log:L14	401	469	/tmp/s23-heat-abc/repeat/device-raw/final/D-cpu-2.log`
> `/tmp/s23-heat-abc/decode-temperature-summary.tsv:L7` `D-cpu-2	33.3	34.3	33.6	1.0	0.3	33.8	35.2	34.1	1.4	0.3	0	90.3	cpu-1-10	69.7	gpuss-4	64.9	nspss-0	401	469`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L52` `D-cpu-2	battery_start	33.3	battery_dC	401	1790646690.037848140	epoch=1790646690.037848140 battery_dC=333 skin_C=33.8 status=0 battery_dC=333`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L53` `D-cpu-2	skin_start	33.8	skin_C	401	1790646690.037848140	epoch=1790646690.037848140 battery_dC=333 skin_C=33.8 status=0 skin_C=33.8`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L54` `D-cpu-2	battery_peak	34.3	battery_dC	433	1790646725.495094585	epoch=1790646725.495094585 battery_dC=343 skin_C=34.8 status=0 battery_dC=343`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L55` `D-cpu-2	skin_peak	35.2	skin_C	413	1790646703.825611051	epoch=1790646703.825611051 battery_dC=329 skin_C=35.2 status=0 skin_C=35.2`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L56` `D-cpu-2	status_peak	0	status	401	1790646690.037848140	epoch=1790646690.037848140 battery_dC=333 skin_C=33.8 status=0 status=0`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L57` `D-cpu-2	CPU_zone_peak	90.3	cpu-1-10	405	1790646694.770123659	epoch=1790646694.770123659 battery_dC=329 skin_C=34.0 status=0 cpu-1-10=90300`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L58` `D-cpu-2	GPU_zone_peak	69.7	gpuss-4	411	1790646701.620650062	epoch=1790646701.620650062 battery_dC=329 skin_C=34.0 status=0 gpuss-4=69700`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L59` `D-cpu-2	NSP_zone_peak	64.9	nspss-0	411	1790646701.620650062	epoch=1790646701.620650062 battery_dC=329 skin_C=34.0 status=0 nspss-0=64900`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L60` `D-cpu-2	battery_end	33.6	battery_dC	469	1790646764.436811236	epoch=1790646764.436811236 battery_dC=336 skin_C=34.1 status=0 battery_dC=336`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L61` `D-cpu-2	skin_end	34.1	skin_C	469	1790646764.436811236	epoch=1790646764.436811236 battery_dC=336 skin_C=34.1 status=0 skin_C=34.1`

### D-npu-3

> `/tmp/s23-heat-abc/repeat/session-host-final.log:L73` `GATE BEFORE-D-npu-3 ac=false usb=false wireless=false battery_dC=336 level=96 status=0 wake=Awake screen=ON traced=0`
> `/tmp/s23-heat-abc/repeat/device-raw/final/markers.tsv:L37` `1790646769.807899620	START_D-npu-3	cmd=./bin/llama-bench -m /data/local/tmp/heat3way/ship.gguf -p 0 -n 256 -r 1 -t 5 -ngl 99 -dev HTP0 -fa 1 --no-warmup -o md`
> `/tmp/s23-heat-abc/repeat/device-raw/final/markers.tsv:L38` `1790646783.942474458	END_D-npu-3	rc=0 backend_proof=PASS`
> `/tmp/s23-heat-abc/repeat/device-raw/final/D-npu-3.log:L14` `| lfm2 2.6B Q4_0                 |   1.48 GiB |     2.70 B | OpenCL,HTP |  99 |       5 |   1 | HTP0         |           tg256 |         22.09 ± 0.00 |`
> `/tmp/s23-heat-abc/repeat/device-raw/final/D-npu-3.log:L17` `EXIT=0`
> `/tmp/s23-heat-abc/repeat/device-raw/final/D-npu-3.log:L10` `ggml-hex: Hexagon Arch version v73`
> `/tmp/s23-heat-abc/repeat/device-raw/final/BPROOF-npu-3.log:L132` `0.00.760.395 I load_tensors:         HTP0 model buffer size =  1525.87 MiB`
> `/tmp/s23-heat-abc/decode-arm-summary.tsv:L8` `D-npu-3	npu	3	HTP0 -ngl 99	0	256	22.09	33.6	34.2	0.6	33.7	0.1	0.1265	34.1	35.1	1.0	34.2	0.1	0.1708	0	72.1	59.0	86.0	0	PASS	session-host-final.log:L73	markers.tsv:L37	markers.tsv:L38	BPROOF-npu-3.log:L132	D-npu-3.log:L14	474	544	/tmp/s23-heat-abc/repeat/device-raw/final/D-npu-3.log`
> `/tmp/s23-heat-abc/decode-temperature-summary.tsv:L8` `D-npu-3	33.6	34.2	33.7	0.6	0.1	34.1	35.1	34.2	1.0	0.1	0	72.1	cpu-1-9	59.0	gpuss-7	86.0	nspss-0	474	544`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L62` `D-npu-3	battery_start	33.6	battery_dC	474	1790646769.765663370	epoch=1790646769.765663370 battery_dC=336 skin_C=34.1 status=0 battery_dC=336`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L63` `D-npu-3	skin_start	34.1	skin_C	474	1790646769.765663370	epoch=1790646769.765663370 battery_dC=336 skin_C=34.1 status=0 skin_C=34.1`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L64` `D-npu-3	battery_peak	34.2	battery_dC	489	1790646786.072212999	epoch=1790646786.072212999 battery_dC=342 skin_C=35.1 status=0 battery_dC=342`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L65` `D-npu-3	skin_peak	35.1	skin_C	487	1790646783.863598677	epoch=1790646783.863598677 battery_dC=336 skin_C=35.1 status=0 skin_C=35.1`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L66` `D-npu-3	status_peak	0	status	474	1790646769.765663370	epoch=1790646769.765663370 battery_dC=336 skin_C=34.1 status=0 status=0`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L67` `D-npu-3	CPU_zone_peak	72.1	cpu-1-9	475	1790646770.856306078	epoch=1790646770.856306078 battery_dC=336 skin_C=34.1 status=0 cpu-1-9=72100`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L68` `D-npu-3	GPU_zone_peak	59.0	gpuss-7	486	1790646782.761772844	epoch=1790646782.761772844 battery_dC=336 skin_C=34.4 status=0 gpuss-7=59000`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L69` `D-npu-3	NSP_zone_peak	86.0	nspss-0	486	1790646782.761772844	epoch=1790646782.761772844 battery_dC=336 skin_C=34.4 status=0 nspss-0=86000`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L70` `D-npu-3	battery_end	33.7	battery_dC	544	1790646845.567890945	epoch=1790646845.567890945 battery_dC=337 skin_C=34.2 status=0 battery_dC=337`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L71` `D-npu-3	skin_end	34.2	skin_C	544	1790646845.567890945	epoch=1790646845.567890945 battery_dC=337 skin_C=34.2 status=0 skin_C=34.2`

### D-cpu-3

> `/tmp/s23-heat-abc/repeat/session-host-final.log:L81` `GATE BEFORE-D-cpu-3 ac=false usb=false wireless=false battery_dC=341 level=95 status=0 wake=Awake screen=ON traced=0`
> `/tmp/s23-heat-abc/repeat/device-raw/final/markers.tsv:L41` `1790646845.852884018	START_D-cpu-3	cmd=./bin/llama-bench -m /data/local/tmp/heat3way/ship.gguf -p 0 -n 256 -r 1 -t 5 -ngl 0 -dev none -fa 1 --no-warmup -o md`
> `/tmp/s23-heat-abc/repeat/device-raw/final/markers.tsv:L42` `1790646859.120555575	END_D-cpu-3	rc=0 backend_proof=PASS`
> `/tmp/s23-heat-abc/repeat/device-raw/final/D-cpu-3.log:L14` `| lfm2 2.6B Q4_0                 |   1.48 GiB |     2.70 B | OpenCL,HTP |   0 |       5 |   1 | none         |           tg256 |         22.02 ± 0.00 |`
> `/tmp/s23-heat-abc/repeat/device-raw/final/D-cpu-3.log:L17` `EXIT=0`
> `/tmp/s23-heat-abc/decode-arm-summary.tsv:L9` `D-cpu-3	cpu	3	none -ngl 0	0	256	22.02	33.7	35.1	1.4	34.4	0.7	0.2018	34.2	35.6	1.4	34.7	0.5	0.2474	0	91.6	70.1	65.3	0	PASS	session-host-final.log:L81	markers.tsv:L41	markers.tsv:L42	NA	D-cpu-3.log:L14	544	613	/tmp/s23-heat-abc/repeat/device-raw/final/D-cpu-3.log`
> `/tmp/s23-heat-abc/decode-temperature-summary.tsv:L9` `D-cpu-3	33.7	35.1	34.4	1.4	0.7	34.2	35.6	34.7	1.4	0.5	0	91.6	cpu-1-10	70.1	gpuss-4	65.3	nspss-1	544	613`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L72` `D-cpu-3	battery_start	33.7	battery_dC	544	1790646845.567890945	epoch=1790646845.567890945 battery_dC=337 skin_C=34.2 status=0 battery_dC=337`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L73` `D-cpu-3	skin_start	34.2	skin_C	544	1790646845.567890945	epoch=1790646845.567890945 battery_dC=337 skin_C=34.2 status=0 skin_C=34.2`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L74` `D-cpu-3	battery_peak	35.1	battery_dC	572	1790646876.553274839	epoch=1790646876.553274839 battery_dC=351 skin_C=35.4 status=0 battery_dC=351`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L75` `D-cpu-3	skin_peak	35.6	skin_C	560	1790646863.657367344	epoch=1790646863.657367344 battery_dC=337 skin_C=35.6 status=0 skin_C=35.6`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L76` `D-cpu-3	status_peak	0	status	544	1790646845.567890945	epoch=1790646845.567890945 battery_dC=337 skin_C=34.2 status=0 status=0`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L77` `D-cpu-3	CPU_zone_peak	91.6	cpu-1-10	550	1790646852.530860422	epoch=1790646852.530860422 battery_dC=337 skin_C=34.2 status=0 cpu-1-10=91600`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L78` `D-cpu-3	GPU_zone_peak	70.1	gpuss-4	554	1790646857.046956201	epoch=1790646857.046956201 battery_dC=337 skin_C=34.9 status=0 gpuss-4=70100`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L79` `D-cpu-3	NSP_zone_peak	65.3	nspss-1	554	1790646857.046956201	epoch=1790646857.046956201 battery_dC=337 skin_C=34.9 status=0 nspss-1=65300`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L80` `D-cpu-3	battery_end	34.4	battery_dC	613	1790646920.739286177	epoch=1790646920.739286177 battery_dC=344 skin_C=34.7 status=0 battery_dC=344`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L81` `D-cpu-3	skin_end	34.7	skin_C	613	1790646920.739286177	epoch=1790646920.739286177 battery_dC=344 skin_C=34.7 status=0 skin_C=34.7`

### D-gpu-3

> `/tmp/s23-heat-abc/repeat/session-host-final.log:L92` `GATE BEFORE-D-gpu-3 ac=false usb=false wireless=false battery_dC=344 level=95 status=0 wake=Awake screen=ON traced=0`
> `/tmp/s23-heat-abc/repeat/device-raw/final/markers.tsv:L47` `1790646929.741875392	START_D-gpu-3	cmd=./bin/llama-bench -m /data/local/tmp/heat3way/ship.gguf -p 0 -n 256 -r 1 -t 5 -ngl 99 -dev GPUOpenCL -fa 1 --no-warmup -o md`
> `/tmp/s23-heat-abc/repeat/device-raw/final/markers.tsv:L48` `1790646954.802639341	END_D-gpu-3	rc=0 backend_proof=PASS`
> `/tmp/s23-heat-abc/repeat/device-raw/final/D-gpu-3.log:L14` `| lfm2 2.6B Q4_0                 |   1.48 GiB |     2.70 B | OpenCL,HTP |  99 |       5 |   1 | GPUOpenCL    |           tg256 |         13.53 ± 0.00 |`
> `/tmp/s23-heat-abc/repeat/device-raw/final/D-gpu-3.log:L17` `EXIT=0`
> `/tmp/s23-heat-abc/repeat/device-raw/final/D-gpu-3.log:L3` `ggml_opencl: device: 'QUALCOMM Adreno(TM) (OpenCL 3.0 Adreno(TM) 740)'`
> `/tmp/s23-heat-abc/repeat/device-raw/final/BPROOF-gpu-3.log:L131` `0.01.028.636 I load_tensors:       OpenCL model buffer size =  1307.20 MiB`
> `/tmp/s23-heat-abc/decode-arm-summary.tsv:L10` `D-gpu-3	gpu	3	GPUOpenCL -ngl 99	0	256	13.53	34.4	36.7	2.3	35.5	1.1	0.3526	34.7	36.7	2.0	35.5	0.8	0.4358	0	90.3	78.5	66.9	0	PASS	session-host-final.log:L92	markers.tsv:L47	markers.tsv:L48	BPROOF-gpu-3.log:L131	D-gpu-3.log:L14	621	701	/tmp/s23-heat-abc/repeat/device-raw/final/D-gpu-3.log`
> `/tmp/s23-heat-abc/decode-temperature-summary.tsv:L10` `D-gpu-3	34.4	36.7	35.5	2.3	1.1	34.7	36.7	35.5	2.0	0.8	0	90.3	cpu-1-9	78.5	gpuss-4	66.9	nspss-0	621	701`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L82` `D-gpu-3	battery_start	34.4	battery_dC	621	1790646929.512359663	epoch=1790646929.512359663 battery_dC=344 skin_C=34.7 status=0 battery_dC=344`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L83` `D-gpu-3	skin_start	34.7	skin_C	621	1790646929.512359663	epoch=1790646929.512359663 battery_dC=344 skin_C=34.7 status=0 skin_C=34.7`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L84` `D-gpu-3	battery_peak	36.7	battery_dC	655	1790646966.094755795	epoch=1790646966.094755795 battery_dC=367 skin_C=36.6 status=0 battery_dC=367`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L85` `D-gpu-3	skin_peak	36.7	skin_C	643	1790646953.421691112	epoch=1790646953.421691112 battery_dC=343 skin_C=36.7 status=0 skin_C=36.7`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L86` `D-gpu-3	status_peak	0	status	621	1790646929.512359663	epoch=1790646929.512359663 battery_dC=344 skin_C=34.7 status=0 status=0`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L87` `D-gpu-3	CPU_zone_peak	90.3	cpu-1-9	630	1790646939.253318722	epoch=1790646939.253318722 battery_dC=343 skin_C=34.9 status=0 cpu-1-9=90300`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L88` `D-gpu-3	GPU_zone_peak	78.5	gpuss-4	641	1790646951.244191165	epoch=1790646951.244191165 battery_dC=343 skin_C=35.7 status=0 gpuss-4=78500`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L89` `D-gpu-3	NSP_zone_peak	66.9	nspss-0	640	1790646950.190560228	epoch=1790646950.190560228 battery_dC=343 skin_C=35.7 status=0 nspss-0=66900`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L90` `D-gpu-3	battery_end	35.5	battery_dC	701	1790647015.783929057	epoch=1790647015.783929057 battery_dC=355 skin_C=35.5 status=0 battery_dC=355`
> `/tmp/s23-heat-abc/decode-temperature-evidence.tsv:L91` `D-gpu-3	skin_end	35.5	skin_C	701	1790647015.783929057	epoch=1790647015.783929057 battery_dC=355 skin_C=35.5 status=0 skin_C=35.5`

## Block-level, validity, and app evidence

> `/tmp/s23-heat-abc/prior/raw/device-out/out/markers.tsv:L29` `1790600019	VOID_HOT	P-npu battery_dC=332 status=0 wait=610`
> `/tmp/s23-heat-abc/repeat/device-raw/final/P-NPU-decode-proof-verbose.log:L10` `ggml-hex: Hexagon Arch version v73`
> `/tmp/s23-heat-abc/repeat/device-raw/final/P-NPU-decode-proof-verbose.log:L277` `ggml-hex: HTP0 failed to get URI (physical 0, virtual 0) : error 0x14. Falling back to single session URI: file:///libggml-htp-v73.so?htp_iface_skel_handle_invoke&_modver=1.0&_dom=cdsp&_session=0`
> `/tmp/s23-heat-abc/repeat/device-raw/final/P-NPU-decode-proof-verbose.log:L16459` `ggml-hex: HTP0 execute-op MUL_MAT|blk.0.shortconv.in_proj.weight x model.layers.{}.operator_norm-0 (reshaped) -> model.layers.{}.conv.in_proj-0|2048:6144 x 2048:1 -> 6144:1|q4_0 x f32 -> f32|18:1152 x 4:8192 -> 4:24576|HTP0 x HTP0 -> HTP0|hvx-tiled vtcm 2727936|flags 0x0`
> `/tmp/s23-heat-abc/repeat/session-host-final.log:L101` `SESSION_END fatal= markers=/data/local/tmp/heat3way/hopping/repeat/markers.tsv samples=/data/local/tmp/heat3way/hopping/repeat/samples.tsv`
> `/tmp/s23-heat-abc/repeat/session-host-final.log:L102` `HOST_END EXIT=0 disconnected=0`
> `/tmp/s23-heat-abc/npu-rerun-validated/session-host.log:L55` `SESSION_END sampler_exit=0 end_gate_exit=0 fatal= markers=/data/local/tmp/heat3way/hopping/npu-rerun-20260928-valid/markers.tsv samples=/data/local/tmp/heat3way/hopping/npu-rerun-20260928-valid/samples.tsv`
> `/tmp/s23-heat-abc/npu-rerun-validated/session-host.log:L56` `HOST_END EXIT=0 disconnected=0`
### getenforce.log
> `/tmp/s23-heat-abc/preflight/getenforce.log:L1` `Enforcing`
> `/tmp/s23-heat-abc/preflight/getenforce.log:L2` `EXIT=0`

### app-id.log
> `/tmp/s23-heat-abc/preflight/app-id.log:L1` `uid=10347(u0_a347) gid=10347(u0_a347) groups=10347(u0_a347),1004(input),1007(log),1011(adb),1015(sdcard_rw),1028(sdcard_r),1078(ext_data_rw),1079(ext_obb_rw),3001(net_bt_admin),3002(net_bt),3003(inet),3006(net_bw_stats),3009(readproc),3011(uhid),3012(readtracefs),50347(all_a347) context=u:r:runas_app:s0:c91,c257,c512,c768`
> `/tmp/s23-heat-abc/preflight/app-id.log:L2` `EXIT=0`

### app-context.log
> `/tmp/s23-heat-abc/preflight/app-context.log:L1` `u:r:runas_app:s0:c91,c257,c512,c768`
> `/tmp/s23-heat-abc/preflight/app-context.log:L2` `EXIT=0`

### app-zone0.log
> `/tmp/s23-heat-abc/preflight/app-zone0.log:L1` `27900`
> `/tmp/s23-heat-abc/preflight/app-zone0.log:L2` `EXIT=0`

### app-zones.log
> `/tmp/s23-heat-abc/preflight/app-zones.log:L1` `/sys/class/thermal/thermal_zone1 cpuss-0 29100`
> `/tmp/s23-heat-abc/preflight/app-zones.log:L2` `/sys/class/thermal/thermal_zone10 cpu-1-5 28700`
> `/tmp/s23-heat-abc/preflight/app-zones.log:L3` `/sys/class/thermal/thermal_zone11 cpu-1-6 27900`
> `/tmp/s23-heat-abc/preflight/app-zones.log:L4` `/sys/class/thermal/thermal_zone12 cpu-1-7 32000`
> `/tmp/s23-heat-abc/preflight/app-zones.log:L5` `/sys/class/thermal/thermal_zone13 cpu-1-8 29500`
> `/tmp/s23-heat-abc/preflight/app-zones.log:L6` `/sys/class/thermal/thermal_zone14 cpu-1-9 29100`
> `/tmp/s23-heat-abc/preflight/app-zones.log:L7` `/sys/class/thermal/thermal_zone15 cpu-1-10 29500`
> `/tmp/s23-heat-abc/preflight/app-zones.log:L8` `/sys/class/thermal/thermal_zone17 cpu-0-0 31800`
> `/tmp/s23-heat-abc/preflight/app-zones.log:L9` `/sys/class/thermal/thermal_zone18 cpu-0-1 33000`
> `/tmp/s23-heat-abc/preflight/app-zones.log:L10` `/sys/class/thermal/thermal_zone19 cpu-0-2 31800`
> `/tmp/s23-heat-abc/preflight/app-zones.log:L11` `/sys/class/thermal/thermal_zone2 cpuss-1 29900`
> `/tmp/s23-heat-abc/preflight/app-zones.log:L12` `/sys/class/thermal/thermal_zone20 nspss-0 30200`
> `/tmp/s23-heat-abc/preflight/app-zones.log:L13` `/sys/class/thermal/thermal_zone21 nspss-1 29400`
> `/tmp/s23-heat-abc/preflight/app-zones.log:L14` `/sys/class/thermal/thermal_zone22 nspss-2 29400`
> `/tmp/s23-heat-abc/preflight/app-zones.log:L15` `/sys/class/thermal/thermal_zone23 nspss-3 29400`
> `/tmp/s23-heat-abc/preflight/app-zones.log:L16` `/sys/class/thermal/thermal_zone3 cpuss-2 29100`
> `/tmp/s23-heat-abc/preflight/app-zones.log:L17` `/sys/class/thermal/thermal_zone33 gpuss-0 30500`
> `/tmp/s23-heat-abc/preflight/app-zones.log:L18` `/sys/class/thermal/thermal_zone34 gpuss-1 30500`
> `/tmp/s23-heat-abc/preflight/app-zones.log:L19` `/sys/class/thermal/thermal_zone35 gpuss-2 29700`
> `/tmp/s23-heat-abc/preflight/app-zones.log:L20` `/sys/class/thermal/thermal_zone36 gpuss-3 29700`
> `/tmp/s23-heat-abc/preflight/app-zones.log:L21` `/sys/class/thermal/thermal_zone37 gpuss-4 29700`
> `/tmp/s23-heat-abc/preflight/app-zones.log:L22` `/sys/class/thermal/thermal_zone38 gpuss-5 30100`
> `/tmp/s23-heat-abc/preflight/app-zones.log:L23` `/sys/class/thermal/thermal_zone39 gpuss-6 29700`
> `/tmp/s23-heat-abc/preflight/app-zones.log:L24` `/sys/class/thermal/thermal_zone4 cpuss-3 29100`
> `/tmp/s23-heat-abc/preflight/app-zones.log:L25` `/sys/class/thermal/thermal_zone40 gpuss-7 30100`
> `/tmp/s23-heat-abc/preflight/app-zones.log:L26` `/sys/class/thermal/thermal_zone5 cpu-1-0 28700`
> `/tmp/s23-heat-abc/preflight/app-zones.log:L27` `/sys/class/thermal/thermal_zone6 cpu-1-1 28300`
> `/tmp/s23-heat-abc/preflight/app-zones.log:L28` `/sys/class/thermal/thermal_zone7 cpu-1-2 29500`
> `/tmp/s23-heat-abc/preflight/app-zones.log:L29` `/sys/class/thermal/thermal_zone8 cpu-1-3 29500`
> `/tmp/s23-heat-abc/preflight/app-zones.log:L30` `/sys/class/thermal/thermal_zone9 cpu-1-4 29500`
> `/tmp/s23-heat-abc/preflight/app-zones.log:L31` `EXIT=0`

### avc-matches.log
> `/tmp/s23-heat-abc/preflight/avc-matches.log:L1` `MATCH_EXIT=1`

### api-level.log
> `/tmp/s23-heat-abc/preflight/api-level.log:L1` `36`
> `/tmp/s23-heat-abc/preflight/api-level.log:L2` `EXIT=0`

### android-release.log
> `/tmp/s23-heat-abc/preflight/android-release.log:L1` `16`
> `/tmp/s23-heat-abc/preflight/android-release.log:L2` `EXIT=0`

### package-dump.log
> `/tmp/s23-heat-abc/preflight/package-dump.log:L276` `    versionCode=1 minSdk=33 targetSdk=36`
> `/tmp/s23-heat-abc/preflight/package-dump.log:L283` `    flags=[ DEBUGGABLE HAS_CODE ALLOW_CLEAR_USER_DATA ]`

### zone-inventory-summary.log
> `/tmp/s23-heat-abc/zone-inventory-summary.log:L1` `zone_count=95 type_readable=95 temp_readable=86 temp_unreadable=9 unreadable=75:pm8550b_tz;76:pm8550b_lite_tz;77:pm8550b-ibat-lvl0;78:pm8550b-ibat-lvl1;79:pm8550b-bcl-lvl0;80:pm8550b-bcl-lvl1;81:pm8550b-bcl-lvl2;90:pm8010m_tz;91:pm8010n_tz`
> `/tmp/s23-heat-abc/zone-inventory-summary.log:L2` `run_as_family_zones_readable=30 cpu_cpuss=18 gpu=8 nsp=4`
> `/tmp/s23-heat-abc/zone-inventory-summary.log:L3` `EXIT=0`


## Superseded archival decode runs and hashes

> `/tmp/s23-heat-abc/prior/raw/device-out/decode-results.tsv:L1` `backend	rep	log_tag	tg256_tok_s	battery_start_C	battery_delta_C	battery_area_Cs	battery_Cs_per_token	skin_start_C	skin_delta_C	skin_area_Cs	skin_Cs_per_token	peak_cpu_C	peak_gpu_C	peak_nsp_C	exit0`
> `/tmp/s23-heat-abc/prior/raw/device-out/decode-results.tsv:L2` `cpu	1	D-cpu-1	19.68	33.0	1.7	83.7	0.327	33.1	1.9	91.4	0.357	90.8	69.7	64.5	True`
> `/tmp/s23-heat-abc/prior/raw/device-out/decode-results.tsv:L3` `gpu	1	D-gpu-1	14.2	33.0	2.3	110.2	0.4305	33.1	2.4	134.95	0.5271	90.8	76.5	66.5	True`
> `/tmp/s23-heat-abc/prior/raw/device-out/decode-results.tsv:L4` `npu	1	D-npu-1	22.78	33.0	1.1	54.6	0.2133	33.1	1.2	54.8	0.2141	63.2	58.2	86.4	True`
> `/tmp/s23-heat-abc/prior/raw/device-out/decode-results.tsv:L5` `gpu	2	D-gpu-2	14.11	33.0	2.3	110.15	0.4303	33.2	2.3	125.75	0.4912	91.2	78.5	66.5	True`
> `/tmp/s23-heat-abc/prior/raw/device-out/decode-results.tsv:L6` `npu	2	D-npu-2	22.75	33.0	1.0	51.6	0.2016	33.1	1.1	53.15	0.2076	77.8	57.8	86.8	True`
> `/tmp/s23-heat-abc/prior/raw/device-out/decode-results.tsv:L7` `cpu	2	D-cpu-2	21.59	33.0	1.4	75.8	0.2961	33.1	1.9	94.0	0.3672	90.3	70.1	64.9	True`
> `/tmp/s23-heat-abc/prior/raw/device-out/decode-results.tsv:L8` `npu	3	D-npu-3	22.52	33.0	0.8	43.2	0.1687	33.1	1.2	51.8	0.2023	66.4	57.4	86.4	True`
> `/tmp/s23-heat-abc/prior/raw/device-out/decode-results.tsv:L9` `cpu	3	D-cpu-3	16.61	33.0	1.0	57.3	0.2238	33.4	1.8	83.65	0.3268	90.8	68.9	63.7	True`
> `/tmp/s23-heat-abc/prior/raw/device-out/decode-results.tsv:L10` `gpu	3	D-gpu-3	14.11	33.0	2.2	102.75	0.4014	33.7	2.3	109.6	0.4281	89.9	77.3	66.5	True`
> `/tmp/s23-heat-abc/prior/analyze.log:L1` `samples=2579 cadence_median_s=2.0 cadence_max_s=3.0`
> `/tmp/s23-heat-abc/prior/analyze.log:L2` `prefill_runs=18 decode_runs=9`
> `/tmp/s23-heat-abc/prior/analyze.log:L3` `prefill_cpu=6 prompt_eval_ms=10143.54,18716.11,19352.73,11788.44,13127.28,22047.84`
> `/tmp/s23-heat-abc/prior/analyze.log:L6` `decode_cpu=3 tg256=19.68,21.59,16.61`
> `/tmp/s23-heat-abc/prior/analyze.log:L9` `decode_gpu=3 tg256=14.2,14.11,14.11`
> `/tmp/s23-heat-abc/prior/analyze.log:L12` `decode_npu=3 tg256=22.78,22.75,22.52`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/markers.tsv:L29` `1790600019	VOID_HOT	P-npu battery_dC=332 status=0 wait=610`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/markers.tsv:L81` `1790600943	VOID_HOT	P-NPU-DECODE-PROOF battery_dC=338 status=0 wait=610`
> `/tmp/s23-heat-abc/prior/raw/device-out/out/markers.tsv:L82` `1790600943	NPU_DECODE_PROOF_VOID	cooldown=1`
> `/tmp/s23-heat-abc/repeat/device-raw/final/input-sha256.txt:L1` `a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03  /data/local/tmp/heat3way/ship.gguf`
> `/tmp/s23-heat-abc/repeat/device-raw/final/input-sha256.txt:L2` `f516905dd5a86926279b3bf08999539557aee3af6467c84a9df99a9323d4ba0a  /data/local/tmp/heat3way/prompt.txt`
> `/tmp/s23-heat-abc/repeat/device-raw/final/input-sha256.txt:L3` `EXIT=0`
> `/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/input-sha256.txt:L1` `a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03  /data/local/tmp/heat3way/ship.gguf`
> `/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/input-sha256.txt:L2` `f516905dd5a86926279b3bf08999539557aee3af6467c84a9df99a9323d4ba0a  /data/local/tmp/heat3way/prompt.txt`
> `/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/npu-rerun-20260928-valid/input-sha256.txt:L3` `EXIT=0`

## Derived aggregate rows

> `/tmp/s23-heat-abc/decode-group-summary.tsv:L1` `backend	n	median_tg256_tok_s	range_tg256_tok_s	median_battery_Cs_per_token	range_battery_Cs_per_token	median_skin_Cs_per_token	range_skin_Cs_per_token	source_per_rep_rows`
> `/tmp/s23-heat-abc/decode-group-summary.tsv:L2` `cpu	3	22.1300	22.0200-22.8900	0.2018	0.1278-0.2905	0.2474	0.2413-0.3785	D-cpu-1,D-cpu-2,D-cpu-3`
> `/tmp/s23-heat-abc/decode-group-summary.tsv:L3` `gpu	3	14.0300	13.5300-14.1500	0.4298	0.3526-0.4579	0.5253	0.4358-0.5293	D-gpu-1,D-gpu-2,D-gpu-3`
> `/tmp/s23-heat-abc/decode-group-summary.tsv:L4` `npu	3	22.0900	22.0300-22.2500	0.1404	0.1265-0.1659	0.1708	0.1135-0.1885	D-npu-1,D-npu-2,D-npu-3`
> `/tmp/s23-heat-abc/prefill-block-summary.tsv:L1` `block	n	block_start_skin_C	block_end_skin_C	end_skin_rise_by_unit_C	skin_nondecreasing	largest_skin_step_C	largest_skin_step_unit	max_skin_rise_C	max_skin_unit	block_start_NSP_max_C	end_NSP_max_by_unit_C	NSP_end_nondecreasing	largest_NSP_step_C	largest_NSP_step_unit	max_NSP_endpoint_rise_C	max_NSP_endpoint_unit	max_within_unit_NSP_peak_C	max_within_unit_peak_unit	source_run_summary_rows`
> `/tmp/s23-heat-abc/prefill-block-summary.tsv:L2` `archival-primary-gpu	12	33.1	39.6	0.2,1.6,3.0,3.0,3.9,4.4,4.8,5.2,5.6,5.9,6.2,6.5	True	1.4	2	6.5	12	39.0	54.1,55.7,57.3,57.3,56.5,56.1,55.7,56.9,56.9,56.9,57.3,58.5	False	1.6	2	19.5	12	62.5	3	8,9,10,11,12,13,14,15,16,17,18,19`
> `/tmp/s23-heat-abc/prefill-block-summary.tsv:L3` `no-cool-htp-recovery	12	30.2	35.7	0.2,0.9,0.9,1.8,2.4,2.9,3.9,3.9,4.3,4.7,5.5,5.5	True	1.0	7	5.5	11	35.8	47.7,50.1,52.9,52.9,53.3,53.3,54.5,55.7,57.3,56.5,56.9,63.3	False	6.4	12	27.5	12	93.5	7	32,33,34,35,36,37,38,39,40,41,42,43`
> `/tmp/s23-heat-abc/prefill-block-summary.tsv:L4` `archival-supplement-htp	12	30.3	35.4	0.0,0.7,1.6,1.6,2.1,2.1,3.3,3.8,4.4,4.4,5.1,5.1	True	1.2	7	5.1	11	34.6	50.5,50.9,53.3,53.7,57.3,58.5,62.1,56.1,58.5,58.5,60.1,63.7	False	3.6	7	29.1	12	95.9	10	20,21,22,23,24,25,26,27,28,29,30,31`
> `/tmp/s23-heat-abc/prefill-block-summary.tsv:L5` `crossover_check	12																		no_crossover_pairs=[]`
