# Per-arm battery, skin, and CPU maximum-frequency evidence

Source rows are in `live-samples.tsv`. Policy mapping from `cpufreq-policy-map.log`: policy0 cpu0-1, policy2 cpu2-4, policy5 cpu5-6, policy7 cpu7. Frequencies are kHz.

## A-cpu-1
- start: `live-samples.tsv:L3` `2026-09-29T05:12:39.575537+00:00	A-cpu-1	arm_before	63	274	27.4	28.11	0	Awake	true	false	false	AC=false,USB=false,Wireless=false,Dock=false	cpu0=2035200,cpu1=2035200,cpu2=2630400,cpu3=2630400,cpu4=2630400,cpu5=2630400,cpu6=2630400,cpu7=2630400`
- battery peak: `live-samples.tsv:L18` `2026-09-29T05:13:13.084064+00:00	A-cpu-1	tail	63	285	28.5	31.24	0	Awake	true	false	false	AC=false,USB=false,Wireless=false,Dock=false	cpu0=2035200,cpu1=2035200,cpu2=2630400,cpu3=2630400,cpu4=2630400,cpu5=2630400,cpu6=2630400,cpu7=2630400`
- skin peak: `live-samples.tsv:L19` `2026-09-29T05:13:15.956738+00:00	A-cpu-1	tail	63	285	28.5	31.312	0	Awake	true	false	false	AC=false,USB=false,Wireless=false,Dock=false	cpu0=2035200,cpu1=2035200,cpu2=2630400,cpu3=2630400,cpu4=2630400,cpu5=2630400,cpu6=2630400,cpu7=2630400`
- end: `live-samples.tsv:L37` `2026-09-29T05:14:05.588807+00:00	A-cpu-1	arm_after_tail	63	285	28.5	30.037	0	Awake	true	false	false	AC=false,USB=false,Wireless=false,Dock=false	cpu0=2035200,cpu1=2035200,cpu2=2630400,cpu3=2630400,cpu4=2630400,cpu5=2630400,cpu6=2630400,cpu7=2630400`
- Minimum sampled frequency rows by policy: policy0:L3,policy2:L3,policy5:L3,policy7:L3.

## A-gpu-1
- start: `live-samples.tsv:L38` `2026-09-29T05:14:06.472729+00:00	A-gpu-1	arm_before	63	285	28.5	30.037	0	Awake	true	false	false	AC=false,USB=false,Wireless=false,Dock=false	cpu0=2035200,cpu1=2035200,cpu2=2630400,cpu3=2630400,cpu4=2630400,cpu5=2630400,cpu6=2630400,cpu7=2630400`
- battery peak: `live-samples.tsv:L59` `2026-09-29T05:14:56.662665+00:00	A-gpu-1	measured_live	62	292	29.2	31.461	0	Awake	true	false	false	AC=false,USB=false,Wireless=false,Dock=false	cpu0=2035200,cpu1=2035200,cpu2=2630400,cpu3=2630400,cpu4=2630400,cpu5=2630400,cpu6=2630400,cpu7=2630400`
- skin peak: `live-samples.tsv:L65` `2026-09-29T05:15:11.308749+00:00	A-gpu-1	tail	62	292	29.6	32.819	0	Awake	true	false	false	AC=false,USB=false,Wireless=false,Dock=false	cpu0=2035200,cpu1=2035200,cpu2=2630400,cpu3=2630400,cpu4=2630400,cpu5=2630400,cpu6=2630400,cpu7=2630400`
- end: `live-samples.tsv:L83` `2026-09-29T05:16:00.932063+00:00	A-gpu-1	arm_after_tail	62	292	29.6	31.356	0	Awake	true	false	false	AC=false,USB=false,Wireless=false,Dock=false	cpu0=2035200,cpu1=2035200,cpu2=2630400,cpu3=2630400,cpu4=2630400,cpu5=2630400,cpu6=2630400,cpu7=2630400`
- Minimum sampled frequency rows by policy: policy0:L38,policy2:L38,policy5:L38,policy7:L38.

## A-npu-1
- start: `live-samples.tsv:L84` `2026-09-29T05:16:01.704964+00:00	A-npu-1	arm_before	62	292	29.6	31.339	0	Awake	true	false	false	AC=false,USB=false,Wireless=false,Dock=false	cpu0=2035200,cpu1=2035200,cpu2=2630400,cpu3=2630400,cpu4=2630400,cpu5=2630400,cpu6=2630400,cpu7=2630400`
- battery peak: `live-samples.tsv:L105` `2026-09-29T05:16:51.639992+00:00	A-npu-1	tail	62	304	30.4	32.623	0	Awake	true	false	false	AC=false,USB=false,Wireless=false,Dock=false	cpu0=2035200,cpu1=2035200,cpu2=2630400,cpu3=2630400,cpu4=2630400,cpu5=2630400,cpu6=2630400,cpu7=2630400`
- skin peak: `live-samples.tsv:L99` `2026-09-29T05:16:34.450091+00:00	A-npu-1	tail	62	301	30.1	33.301	0	Awake	true	false	false	AC=false,USB=false,Wireless=false,Dock=false	cpu0=2035200,cpu1=2035200,cpu2=2630400,cpu3=2630400,cpu4=2630400,cpu5=2630400,cpu6=2630400,cpu7=2630400`
- end: `live-samples.tsv:L117` `2026-09-29T05:17:23.939224+00:00	A-npu-1	arm_after_tail	62	304	30.2	31.802	0	Awake	true	false	false	AC=false,USB=false,Wireless=false,Dock=false	cpu0=2035200,cpu1=2035200,cpu2=2630400,cpu3=2630400,cpu4=2630400,cpu5=2630400,cpu6=2630400,cpu7=2630400`
- Minimum sampled frequency rows by policy: policy0:L84,policy2:L84,policy5:L84,policy7:L84.

## A-npu-2
- start: `live-samples.tsv:L118` `2026-09-29T05:17:24.814834+00:00	A-npu-2	arm_before	62	304	30.2	31.797	0	Awake	true	false	false	AC=false,USB=false,Wireless=false,Dock=false	cpu0=2035200,cpu1=2035200,cpu2=2630400,cpu3=2630400,cpu4=2630400,cpu5=2630400,cpu6=2630400,cpu7=2630400`
- battery peak: `live-samples.tsv:L133` `2026-09-29T05:18:00.033794+00:00	A-npu-2	tail	61	308	30.8	33.567	0	Awake	true	false	false	AC=false,USB=false,Wireless=false,Dock=false	cpu0=2035200,cpu1=2035200,cpu2=2630400,cpu3=2630400,cpu4=2630400,cpu5=2630400,cpu6=2630400,cpu7=2169600`
- skin peak: `live-samples.tsv:L132` `2026-09-29T05:17:57.234049+00:00	A-npu-2	tail	61	305	30.5	33.64	0	Awake	true	false	false	AC=false,USB=false,Wireless=false,Dock=false	cpu0=2035200,cpu1=2035200,cpu2=2630400,cpu3=2630400,cpu4=2630400,cpu5=2630400,cpu6=2630400,cpu7=2169600`
- end: `live-samples.tsv:L150` `2026-09-29T05:18:46.626586+00:00	A-npu-2	arm_after_tail	61	308	30.6	32.244	0	Awake	true	false	false	AC=false,USB=false,Wireless=false,Dock=false	cpu0=2035200,cpu1=2035200,cpu2=2630400,cpu3=2630400,cpu4=2630400,cpu5=2630400,cpu6=2630400,cpu7=2630400`
- Minimum sampled frequency rows by policy: policy0:L118,policy2:L118,policy5:L118,policy7:L128.

## A-gpu-2
- start: `live-samples.tsv:L151` `2026-09-29T05:18:47.569216+00:00	A-gpu-2	arm_before	61	308	30.6	32.233	0	Awake	true	false	false	AC=false,USB=false,Wireless=false,Dock=false	cpu0=2035200,cpu1=2035200,cpu2=2630400,cpu3=2630400,cpu4=2630400,cpu5=2630400,cpu6=2630400,cpu7=2630400`
- battery peak: `live-samples.tsv:L170` `2026-09-29T05:19:32.210971+00:00	A-gpu-2	tail	61	313	31.3	34.095	0	Awake	true	false	false	AC=false,USB=false,Wireless=false,Dock=false	cpu0=2035200,cpu1=2035200,cpu2=2630400,cpu3=2630400,cpu4=2630400,cpu5=2630400,cpu6=2630400,cpu7=2169600`
- skin peak: `live-samples.tsv:L171` `2026-09-29T05:19:35.071365+00:00	A-gpu-2	tail	61	313	31.3	34.176	0	Awake	true	false	false	AC=false,USB=false,Wireless=false,Dock=false	cpu0=2035200,cpu1=2035200,cpu2=2630400,cpu3=2630400,cpu4=2630400,cpu5=2630400,cpu6=2630400,cpu7=2169600`
- end: `live-samples.tsv:L190` `2026-09-29T05:20:27.750578+00:00	A-gpu-2	arm_after_tail	61	313	31.1	32.745	0	Awake	true	false	false	AC=false,USB=false,Wireless=false,Dock=false	cpu0=2035200,cpu1=2035200,cpu2=2630400,cpu3=2630400,cpu4=2630400,cpu5=2630400,cpu6=2630400,cpu7=2438400`
- Minimum sampled frequency rows by policy: policy0:L151,policy2:L151,policy5:L151,policy7:L166.

## A-cpu-2
- start: `live-samples.tsv:L191` `2026-09-29T05:20:28.661170+00:00	A-cpu-2	arm_before	61	313	31.1	32.728	0	Awake	true	false	false	AC=false,USB=false,Wireless=false,Dock=false	cpu0=2035200,cpu1=2035200,cpu2=2630400,cpu3=2630400,cpu4=2630400,cpu5=2630400,cpu6=2630400,cpu7=2438400`
- battery peak: `live-samples.tsv:L191` `2026-09-29T05:20:28.661170+00:00	A-cpu-2	arm_before	61	313	31.1	32.728	0	Awake	true	false	false	AC=false,USB=false,Wireless=false,Dock=false	cpu0=2035200,cpu1=2035200,cpu2=2630400,cpu3=2630400,cpu4=2630400,cpu5=2630400,cpu6=2630400,cpu7=2438400`
- skin peak: `live-samples.tsv:L206` `2026-09-29T05:21:04.803452+00:00	A-cpu-2	tail	61	313	31.9	35.084	0	Awake	true	false	false	AC=false,USB=false,Wireless=false,Dock=false	cpu0=2035200,cpu1=2035200,cpu2=2630400,cpu3=2630400,cpu4=2630400,cpu5=2630400,cpu6=2630400,cpu7=2169600`
- end: `live-samples.tsv:L224` `2026-09-29T05:21:54.634039+00:00	A-cpu-2	arm_after_tail	61	313	31.7	33.352	0	Awake	true	false	false	AC=false,USB=false,Wireless=false,Dock=false	cpu0=2035200,cpu1=2035200,cpu2=2630400,cpu3=2630400,cpu4=2630400,cpu5=2630400,cpu6=2630400,cpu7=2169600`
- Minimum sampled frequency rows by policy: policy0:L191,policy2:L191,policy5:L191,policy7:L198.

## B-cpu-1
- start: `live-samples.tsv:L225` `2026-09-29T05:21:55.555562+00:00	B-cpu-1	arm_before	60	316	31.6	33.335	0	Awake	true	false	false	AC=false,USB=false,Wireless=false,Dock=false	cpu0=2035200,cpu1=2035200,cpu2=2630400,cpu3=2630400,cpu4=2630400,cpu5=2630400,cpu6=2630400,cpu7=2169600`
- battery peak: `live-samples.tsv:L239` `2026-09-29T05:22:27.623753+00:00	B-cpu-1	tail	60	323	32.3	35.267	0	Awake	true	false	false	AC=false,USB=false,Wireless=false,Dock=false	cpu0=2035200,cpu1=2035200,cpu2=2630400,cpu3=2630400,cpu4=2630400,cpu5=2630400,cpu6=2630400,cpu7=2169600`
- skin peak: `live-samples.tsv:L239` `2026-09-29T05:22:27.623753+00:00	B-cpu-1	tail	60	323	32.3	35.267	0	Awake	true	false	false	AC=false,USB=false,Wireless=false,Dock=false	cpu0=2035200,cpu1=2035200,cpu2=2630400,cpu3=2630400,cpu4=2630400,cpu5=2630400,cpu6=2630400,cpu7=2169600`
- end: `live-samples.tsv:L257` `2026-09-29T05:23:17.426753+00:00	B-cpu-1	arm_after_tail	60	319	31.9	33.476	0	Awake	true	false	false	AC=false,USB=false,Wireless=false,Dock=false	cpu0=2035200,cpu1=2035200,cpu2=2630400,cpu3=2630400,cpu4=2630400,cpu5=2630400,cpu6=2630400,cpu7=2169600`
- Minimum sampled frequency rows by policy: policy0:L225,policy2:L225,policy5:L225,policy7:L225.

## B-gpu-1
- start: `live-samples.tsv:L258` `2026-09-29T05:23:18.341759+00:00	B-gpu-1	arm_before	60	319	31.9	33.46	0	Awake	true	false	false	AC=false,USB=false,Wireless=false,Dock=false	cpu0=2035200,cpu1=2035200,cpu2=2630400,cpu3=2630400,cpu4=2630400,cpu5=2630400,cpu6=2630400,cpu7=2169600`
- battery peak: `live-samples.tsv:L272` `2026-09-29T05:23:48.508724+00:00	B-gpu-1	measured_live	60	320	32.0	34.211	0	Awake	true	false	false	AC=false,USB=false,Wireless=false,Dock=false	cpu0=2035200,cpu1=2035200,cpu2=2630400,cpu3=2630400,cpu4=2630400,cpu5=2630400,cpu6=2630400,cpu7=2169600`
- skin peak: `live-samples.tsv:L277` `2026-09-29T05:24:02.526523+00:00	B-gpu-1	tail	60	320	32.5	35.605	0	Awake	true	false	false	AC=false,USB=false,Wireless=false,Dock=false	cpu0=2035200,cpu1=2035200,cpu2=2323200,cpu3=2323200,cpu4=2323200,cpu5=2323200,cpu6=2323200,cpu7=1939200`
- end: `live-samples.tsv:L295` `2026-09-29T05:24:54.778777+00:00	B-gpu-1	arm_after_tail	60	320	32.2	33.69	0	Awake	true	false	false	AC=false,USB=false,Wireless=false,Dock=false	cpu0=2035200,cpu1=2035200,cpu2=2630400,cpu3=2630400,cpu4=2630400,cpu5=2630400,cpu6=2630400,cpu7=2169600`
- Minimum sampled frequency rows by policy: policy0:L258,policy2:L275,policy5:L275,policy7:L274.

## B-npu-1
- start: `live-samples.tsv:L296` `2026-09-29T05:24:55.669778+00:00	B-npu-1	arm_before	60	320	32.2	33.673	0	Awake	true	false	false	AC=false,USB=false,Wireless=false,Dock=false	cpu0=2035200,cpu1=2035200,cpu2=2630400,cpu3=2630400,cpu4=2630400,cpu5=2630400,cpu6=2630400,cpu7=2169600`
- battery peak: `live-samples.tsv:L312` `2026-09-29T05:25:32.770608+00:00	B-npu-1	tail	59	324	32.4	34.777	0	Awake	true	false	false	AC=false,USB=false,Wireless=false,Dock=false	cpu0=2035200,cpu1=2035200,cpu2=2630400,cpu3=2630400,cpu4=2630400,cpu5=2630400,cpu6=2630400,cpu7=2169600`
- skin peak: `live-samples.tsv:L310` `2026-09-29T05:25:27.053544+00:00	B-npu-1	tail	60	322	32.2	34.918	0	Awake	true	false	false	AC=false,USB=false,Wireless=false,Dock=false	cpu0=2035200,cpu1=2035200,cpu2=2438400,cpu3=2438400,cpu4=2438400,cpu5=2438400,cpu6=2438400,cpu7=2112000`
- end: `live-samples.tsv:L330` `2026-09-29T05:26:22.485510+00:00	B-npu-1	arm_after_tail	59	319	31.9	33.295	0	Awake	true	false	false	AC=false,USB=false,Wireless=false,Dock=false	cpu0=2035200,cpu1=2035200,cpu2=2630400,cpu3=2630400,cpu4=2630400,cpu5=2630400,cpu6=2630400,cpu7=2169600`
- Minimum sampled frequency rows by policy: policy0:L296,policy2:L308,policy5:L308,policy7:L307.

## B-gpu-2
- start: `live-samples.tsv:L331` `2026-09-29T05:26:23.300060+00:00	B-gpu-2	arm_before	59	319	31.9	33.278	0	Awake	true	false	false	AC=false,USB=false,Wireless=false,Dock=false	cpu0=2035200,cpu1=2035200,cpu2=2630400,cpu3=2630400,cpu4=2630400,cpu5=2630400,cpu6=2630400,cpu7=2169600`
- battery peak: `live-samples.tsv:L345` `2026-09-29T05:26:54.424210+00:00	B-gpu-2	measured_live	59	321	32.1	34.245	0	Awake	true	false	false	AC=false,USB=false,Wireless=false,Dock=false	cpu0=2035200,cpu1=2035200,cpu2=2630400,cpu3=2630400,cpu4=2630400,cpu5=2630400,cpu6=2630400,cpu7=2169600`
- skin peak: `live-samples.tsv:L351` `2026-09-29T05:27:11.701537+00:00	B-gpu-2	tail	59	321	32.5	35.848	0	Awake	true	false	false	AC=false,USB=false,Wireless=false,Dock=false	cpu0=2035200,cpu1=2035200,cpu2=2323200,cpu3=2323200,cpu4=2323200,cpu5=2323200,cpu6=2323200,cpu7=1939200`
- end: `live-samples.tsv:L370` `2026-09-29T05:28:04.454818+00:00	B-gpu-2	arm_after_tail	59	321	32.4	34.089	0	Awake	true	false	false	AC=false,USB=false,Wireless=false,Dock=false	cpu0=2035200,cpu1=2035200,cpu2=2630400,cpu3=2630400,cpu4=2630400,cpu5=2630400,cpu6=2630400,cpu7=2169600`
- Minimum sampled frequency rows by policy: policy0:L331,policy2:L347,policy5:L347,policy7:L347.

## B-npu-2
- start: `live-samples.tsv:L371` `2026-09-29T05:28:05.312707+00:00	B-npu-2	arm_before	59	321	32.4	34.071	0	Awake	true	false	false	AC=false,USB=false,Wireless=false,Dock=false	cpu0=2035200,cpu1=2035200,cpu2=2630400,cpu3=2630400,cpu4=2630400,cpu5=2630400,cpu6=2630400,cpu7=2169600`
- battery peak: `live-samples.tsv:L371` `2026-09-29T05:28:05.312707+00:00	B-npu-2	arm_before	59	321	32.4	34.071	0	Awake	true	false	false	AC=false,USB=false,Wireless=false,Dock=false	cpu0=2035200,cpu1=2035200,cpu2=2630400,cpu3=2630400,cpu4=2630400,cpu5=2630400,cpu6=2630400,cpu7=2169600`
- skin peak: `live-samples.tsv:L385` `2026-09-29T05:28:37.995903+00:00	B-npu-2	tail	59	321	32.7	35.506	0	Awake	true	false	false	AC=false,USB=false,Wireless=false,Dock=false	cpu0=2035200,cpu1=2035200,cpu2=2323200,cpu3=2323200,cpu4=2323200,cpu5=2323200,cpu6=2323200,cpu7=1939200`
- end: `live-samples.tsv:L405` `2026-09-29T05:29:32.945159+00:00	B-npu-2	arm_after_tail	59	321	32.5	34.013	0	Awake	true	false	false	AC=false,USB=false,Wireless=false,Dock=false	cpu0=2035200,cpu1=2035200,cpu2=2630400,cpu3=2630400,cpu4=2630400,cpu5=2630400,cpu6=2630400,cpu7=2169600`
- Minimum sampled frequency rows by policy: policy0:L371,policy2:L383,policy5:L383,policy7:L382.

## B-cpu-2
- start: `live-samples.tsv:L406` `2026-09-29T05:29:33.848369+00:00	B-cpu-2	arm_before	59	321	32.5	33.996	0	Awake	true	false	false	AC=false,USB=false,Wireless=false,Dock=false	cpu0=2035200,cpu1=2035200,cpu2=2630400,cpu3=2630400,cpu4=2630400,cpu5=2630400,cpu6=2630400,cpu7=2169600`
- battery peak: `live-samples.tsv:L420` `2026-09-29T05:30:08.001403+00:00	B-cpu-2	tail	58	332	33.2	35.944	0	Awake	true	false	false	AC=false,USB=false,Wireless=false,Dock=false	cpu0=2035200,cpu1=2035200,cpu2=2323200,cpu3=2323200,cpu4=2323200,cpu5=2323200,cpu6=2323200,cpu7=1939200`
- skin peak: `live-samples.tsv:L419` `2026-09-29T05:30:05.146133+00:00	B-cpu-2	tail	58	324	32.8	35.998	0	Awake	true	false	false	AC=false,USB=false,Wireless=false,Dock=false	cpu0=2035200,cpu1=2035200,cpu2=2323200,cpu3=2323200,cpu4=2323200,cpu5=2323200,cpu6=2323200,cpu7=1939200`
- end: `live-samples.tsv:L437` `2026-09-29T05:30:54.799475+00:00	B-cpu-2	arm_after_tail	58	329	32.8	34.43	0	Awake	true	false	false	AC=false,USB=false,Wireless=false,Dock=false	cpu0=2035200,cpu1=2035200,cpu2=2630400,cpu3=2630400,cpu4=2630400,cpu5=2630400,cpu6=2630400,cpu7=2169600`
- Minimum sampled frequency rows by policy: policy0:L406,policy2:L416,policy5:L416,policy7:L415.

## B-npu-3
- start: `live-samples.tsv:L438` `2026-09-29T05:30:55.682692+00:00	B-npu-3	arm_before	58	329	32.8	34.412	0	Awake	true	false	false	AC=false,USB=false,Wireless=false,Dock=false	cpu0=2035200,cpu1=2035200,cpu2=2630400,cpu3=2630400,cpu4=2630400,cpu5=2630400,cpu6=2630400,cpu7=2169600`
- battery peak: `live-samples.tsv:L453` `2026-09-29T05:31:29.399583+00:00	B-npu-3	tail	58	332	33.2	35.801	0	Awake	true	false	false	AC=false,USB=false,Wireless=false,Dock=false	cpu0=2035200,cpu1=2035200,cpu2=2323200,cpu3=2323200,cpu4=2323200,cpu5=2323200,cpu6=2323200,cpu7=1939200`
- skin peak: `live-samples.tsv:L452` `2026-09-29T05:31:26.586333+00:00	B-npu-3	tail	58	329	32.9	35.807	0	Awake	true	false	false	AC=false,USB=false,Wireless=false,Dock=false	cpu0=2035200,cpu1=2035200,cpu2=2323200,cpu3=2323200,cpu4=2323200,cpu5=2323200,cpu6=2323200,cpu7=1939200`
- end: `live-samples.tsv:L472` `2026-09-29T05:32:22.217765+00:00	B-npu-3	arm_after_tail	58	329	32.8	34.309	0	Awake	true	false	false	AC=false,USB=false,Wireless=false,Dock=false	cpu0=2035200,cpu1=2035200,cpu2=2630400,cpu3=2630400,cpu4=2630400,cpu5=2630400,cpu6=2630400,cpu7=2169600`
- Minimum sampled frequency rows by policy: policy0:L438,policy2:L448,policy5:L448,policy7:L448.

## B-cpu-3
- start: `live-samples.tsv:L473` `2026-09-29T05:32:23.141429+00:00	B-cpu-3	arm_before	58	329	32.8	34.291	0	Awake	true	false	false	AC=false,USB=false,Wireless=false,Dock=false	cpu0=2035200,cpu1=2035200,cpu2=2630400,cpu3=2630400,cpu4=2630400,cpu5=2630400,cpu6=2630400,cpu7=2169600`
- battery peak: `live-samples.tsv:L485` `2026-09-29T05:32:51.688444+00:00	B-cpu-3	tail	58	333	33.3	36.208	0	Awake	true	false	false	AC=false,USB=false,Wireless=false,Dock=false	cpu0=2035200,cpu1=2035200,cpu2=2323200,cpu3=2323200,cpu4=2323200,cpu5=2323200,cpu6=2323200,cpu7=1939200`
- skin peak: `live-samples.tsv:L486` `2026-09-29T05:32:54.560559+00:00	B-cpu-3	tail	58	333	33.3	36.232	0	Awake	true	false	false	AC=false,USB=false,Wireless=false,Dock=false	cpu0=2035200,cpu1=2035200,cpu2=2323200,cpu3=2323200,cpu4=2323200,cpu5=2323200,cpu6=2323200,cpu7=1939200`
- end: `live-samples.tsv:L504` `2026-09-29T05:33:44.032612+00:00	B-cpu-3	arm_after_tail	57	332	33.1	34.721	0	Awake	true	false	false	AC=false,USB=false,Wireless=false,Dock=false	cpu0=2035200,cpu1=2035200,cpu2=2630400,cpu3=2630400,cpu4=2630400,cpu5=2630400,cpu6=2630400,cpu7=2169600`
- Minimum sampled frequency rows by policy: policy0:L473,policy2:L481,policy5:L481,policy7:L481.

## B-gpu-3
- start: `live-samples.tsv:L505` `2026-09-29T05:33:44.945414+00:00	B-gpu-3	arm_before	57	332	33.1	34.704	0	Awake	true	false	false	AC=false,USB=false,Wireless=false,Dock=false	cpu0=2035200,cpu1=2035200,cpu2=2630400,cpu3=2630400,cpu4=2630400,cpu5=2630400,cpu6=2630400,cpu7=2169600`
- battery peak: `live-samples.tsv:L539` `2026-09-29T05:35:14.427474+00:00	B-gpu-3	tail	57	335	33.5	35.214	0	Awake	true	false	false	AC=false,USB=false,Wireless=false,Dock=false	cpu0=2035200,cpu1=2035200,cpu2=2323200,cpu3=2323200,cpu4=2323200,cpu5=2323200,cpu6=2323200,cpu7=1939200`
- skin peak: `live-samples.tsv:L525` `2026-09-29T05:34:34.104359+00:00	B-gpu-3	tail	57	332	33.7	36.623	0	Awake	true	false	false	AC=false,USB=false,Wireless=false,Dock=false	cpu0=2035200,cpu1=2035200,cpu2=2323200,cpu3=2323200,cpu4=2323200,cpu5=2323200,cpu6=2323200,cpu7=1939200`
- end: `live-samples.tsv:L544` `2026-09-29T05:35:26.202325+00:00	B-gpu-3	arm_after_tail	57	335	33.4	35.025	0	Awake	true	false	false	AC=false,USB=false,Wireless=false,Dock=false	cpu0=2035200,cpu1=2035200,cpu2=2323200,cpu3=2323200,cpu4=2323200,cpu5=2323200,cpu6=2323200,cpu7=1939200`
- Minimum sampled frequency rows by policy: policy0:L505,policy2:L517,policy5:L517,policy7:L516.

