# Quoted arm result lines

## A-cpu-1
- Proof log: `A-cpu-1-proof.log`; measured log: `A-cpu-1.log`.
- `A-cpu-1.log:L204` `0.15.031.566 I common_perf_print: prompt eval time =    7474.35 ms /  1010 tokens (    7.40 ms per token,   135.13 tokens per second)`
- `A-cpu-1.log:L205` `0.15.031.568 I common_perf_print:        eval time =    4543.85 ms /   126 runs   (   36.06 ms per token,    27.73 tokens per second)`
- `A-cpu-1.log:L214` `EXIT=0`
- CPU route `A-cpu-1-proof.log:L817` `0.00.383.228 I load_tensors: offloaded 0/31 layers to GPU`

## A-gpu-1
- Proof log: `A-gpu-1-proof.log`; measured log: `A-gpu-1.log`.
- `A-gpu-1.log:L203` `0.23.099.630 I common_perf_print: prompt eval time =    6875.73 ms /  1010 tokens (    6.81 ms per token,   146.89 tokens per second)`
- `A-gpu-1.log:L204` `0.23.099.631 I common_perf_print:        eval time =    9540.55 ms /   126 runs   (   75.72 ms per token,    13.21 tokens per second)`
- `A-gpu-1.log:L212` `EXIT=0`
- OpenCL identity `A-gpu-1-proof.log:L53` `0.00.174.107 I llama_prepare_model_devices: using device GPUOpenCL (QUALCOMM Adreno(TM) 750) (unknown id) - 4560 MiB free`
- GPU placement `A-gpu-1-proof.log:L819` `0.00.410.558 I load_tensors: offloaded 31/31 layers to GPU`

## A-npu-1
- Proof log: `A-npu-1-proof.log`; measured log: `A-npu-1.log`.
- `A-npu-1.log:L183` `0.12.219.888 I common_perf_print: prompt eval time =    1467.37 ms /  1010 tokens (    1.45 ms per token,   688.31 tokens per second)`
- `A-npu-1.log:L184` `0.12.219.898 I common_perf_print:        eval time =    7955.33 ms /   126 runs   (   63.14 ms per token,    15.84 tokens per second)`
- `A-npu-1.log:L191` `EXIT=0`
- v75 session `A-npu-1-proof.log:L272` `0.00.530.753 I ggml-hex: HTP0 new session : session-id 0 domain-id 3 uri file:///libggml-htp-v75.so?htp_iface_skel_handle_invoke&_modver=1.0&_dom=cdsp&_session=0 handle 0xb400006fdac33f10`
- HTP0 model buffer `A-npu-1-proof.log:L12283` `0.01.332.342 I load_tensors:         HTP0 model buffer size =  1525.87 MiB`
- HTP0 dispatch `A-npu-1-proof.log:L24763` `0.03.727.620 D ggml-hex: HTP0 execute-op MUL_MAT|blk.0.shortconv.in_proj.weight x model.layers.{}.operator_norm-0 (reshaped) -> model.layers.{}.conv.in_proj-0|2048:6144 x 2048:2 -> 6144:2|q4_0 x f32 -> f32|18:1152 x 4:8192 -> 4:24576|HTP0 x HTP0 -> HTP0|hvx-tiled vtcm 2801664|flags 0x0`

## A-npu-2
- Proof log: `A-npu-2-proof.log`; measured log: `A-npu-2.log`.
- `A-npu-2.log:L183` `0.11.683.737 I common_perf_print: prompt eval time =    1428.57 ms /  1010 tokens (    1.41 ms per token,   707.00 tokens per second)`
- `A-npu-2.log:L184` `0.11.683.739 I common_perf_print:        eval time =    7570.02 ms /   126 runs   (   60.08 ms per token,    16.64 tokens per second)`
- `A-npu-2.log:L191` `EXIT=0`
- v75 session `A-npu-2-proof.log:L272` `0.00.367.645 I ggml-hex: HTP0 new session : session-id 0 domain-id 3 uri file:///libggml-htp-v75.so?htp_iface_skel_handle_invoke&_modver=1.0&_dom=cdsp&_session=0 handle 0xb40000714e4b2a50`
- HTP0 model buffer `A-npu-2-proof.log:L12283` `0.01.039.011 I load_tensors:         HTP0 model buffer size =  1525.87 MiB`
- HTP0 dispatch `A-npu-2-proof.log:L24763` `0.03.301.308 D ggml-hex: HTP0 execute-op MUL_MAT|blk.0.shortconv.in_proj.weight x model.layers.{}.operator_norm-0 (reshaped) -> model.layers.{}.conv.in_proj-0|2048:6144 x 2048:2 -> 6144:2|q4_0 x f32 -> f32|18:1152 x 4:8192 -> 4:24576|HTP0 x HTP0 -> HTP0|hvx-tiled vtcm 2801664|flags 0x0`

## A-gpu-2
- Proof log: `A-gpu-2-proof.log`; measured log: `A-gpu-2.log`.
- `A-gpu-2.log:L203` `0.23.334.565 I common_perf_print: prompt eval time =    6834.82 ms /  1010 tokens (    6.77 ms per token,   147.77 tokens per second)`
- `A-gpu-2.log:L204` `0.23.334.570 I common_perf_print:        eval time =    9463.79 ms /   126 runs   (   75.11 ms per token,    13.31 tokens per second)`
- `A-gpu-2.log:L212` `EXIT=0`
- OpenCL identity `A-gpu-2-proof.log:L53` `0.00.171.796 I llama_prepare_model_devices: using device GPUOpenCL (QUALCOMM Adreno(TM) 750) (unknown id) - 4560 MiB free`
- GPU placement `A-gpu-2-proof.log:L819` `0.00.429.233 I load_tensors: offloaded 31/31 layers to GPU`

## A-cpu-2
- Proof log: `A-cpu-2-proof.log`; measured log: `A-cpu-2.log`.
- `A-cpu-2.log:L204` `0.14.947.788 I common_perf_print: prompt eval time =    7610.82 ms /  1010 tokens (    7.54 ms per token,   132.71 tokens per second)`
- `A-cpu-2.log:L205` `0.14.947.790 I common_perf_print:        eval time =    4611.08 ms /   126 runs   (   36.60 ms per token,    27.33 tokens per second)`
- `A-cpu-2.log:L214` `EXIT=0`
- CPU route `A-cpu-2-proof.log:L817` `0.00.489.108 I load_tensors: offloaded 0/31 layers to GPU`

## B-cpu-1
- Proof log: `B-cpu-1-proof.log`; measured log: `B-cpu-1.log`.
- `B-cpu-1.log:L13` `| lfm2 2.6B Q4_0                 |   1.48 GiB |     2.70 B | OpenCL,HTP |   0 |       5 |   1 | none         |           tg256 |         29.31 ± 0.00 |`
- `B-cpu-1.log:L16` `EXIT=0`
- CPU route `B-cpu-1-proof.log:L817` `0.00.470.406 I load_tensors: offloaded 0/31 layers to GPU`

## B-gpu-1
- Proof log: `B-gpu-1-proof.log`; measured log: `B-gpu-1.log`.
- `B-gpu-1.log:L13` `| lfm2 2.6B Q4_0                 |   1.48 GiB |     2.70 B | OpenCL,HTP |  99 |       5 |   1 | GPUOpenCL    |           tg256 |         17.23 ± 0.00 |`
- `B-gpu-1.log:L16` `EXIT=0`
- OpenCL identity `B-gpu-1-proof.log:L53` `0.00.156.601 I llama_prepare_model_devices: using device GPUOpenCL (QUALCOMM Adreno(TM) 750) (unknown id) - 4560 MiB free`
- GPU placement `B-gpu-1-proof.log:L819` `0.00.401.551 I load_tensors: offloaded 31/31 layers to GPU`

## B-npu-1
- Proof log: `B-npu-1-proof.log`; measured log: `B-npu-1.log`.
- `B-npu-1.log:L13` `| lfm2 2.6B Q4_0                 |   1.48 GiB |     2.70 B | OpenCL,HTP |  99 |       5 |   1 | HTP0         |           tg256 |         24.09 ± 0.00 |`
- `B-npu-1.log:L16` `EXIT=0`
- v75 session `B-npu-1-proof.log:L272` `0.00.498.693 I ggml-hex: HTP0 new session : session-id 0 domain-id 3 uri file:///libggml-htp-v75.so?htp_iface_skel_handle_invoke&_modver=1.0&_dom=cdsp&_session=0 handle 0xb40000737af1ab10`
- HTP0 model buffer `B-npu-1-proof.log:L12283` `0.01.284.097 I load_tensors:         HTP0 model buffer size =  1525.87 MiB`
- HTP0 dispatch `B-npu-1-proof.log:L24763` `0.04.287.181 D ggml-hex: HTP0 execute-op MUL_MAT|blk.0.shortconv.in_proj.weight x model.layers.{}.operator_norm-0 (reshaped) -> model.layers.{}.conv.in_proj-0|2048:6144 x 2048:2 -> 6144:2|q4_0 x f32 -> f32|18:1152 x 4:8192 -> 4:24576|HTP0 x HTP0 -> HTP0|hvx-tiled vtcm 2801664|flags 0x0`

## B-gpu-2
- Proof log: `B-gpu-2-proof.log`; measured log: `B-gpu-2.log`.
- `B-gpu-2.log:L13` `| lfm2 2.6B Q4_0                 |   1.48 GiB |     2.70 B | OpenCL,HTP |  99 |       5 |   1 | GPUOpenCL    |           tg256 |         15.49 ± 0.00 |`
- `B-gpu-2.log:L16` `EXIT=0`
- OpenCL identity `B-gpu-2-proof.log:L53` `0.00.157.549 I llama_prepare_model_devices: using device GPUOpenCL (QUALCOMM Adreno(TM) 750) (unknown id) - 4560 MiB free`
- GPU placement `B-gpu-2-proof.log:L819` `0.00.415.225 I load_tensors: offloaded 31/31 layers to GPU`

## B-npu-2
- Proof log: `B-npu-2-proof.log`; measured log: `B-npu-2.log`.
- `B-npu-2.log:L13` `| lfm2 2.6B Q4_0                 |   1.48 GiB |     2.70 B | OpenCL,HTP |  99 |       5 |   1 | HTP0         |           tg256 |         23.33 ± 0.00 |`
- `B-npu-2.log:L16` `EXIT=0`
- v75 session `B-npu-2-proof.log:L272` `0.00.532.871 I ggml-hex: HTP0 new session : session-id 0 domain-id 3 uri file:///libggml-htp-v75.so?htp_iface_skel_handle_invoke&_modver=1.0&_dom=cdsp&_session=0 handle 0xb400007dcf8b6890`
- HTP0 model buffer `B-npu-2-proof.log:L12283` `0.01.377.872 I load_tensors:         HTP0 model buffer size =  1525.87 MiB`
- HTP0 dispatch `B-npu-2-proof.log:L24763` `0.04.973.377 D ggml-hex: HTP0 execute-op MUL_MAT|blk.0.shortconv.in_proj.weight x model.layers.{}.operator_norm-0 (reshaped) -> model.layers.{}.conv.in_proj-0|2048:6144 x 2048:2 -> 6144:2|q4_0 x f32 -> f32|18:1152 x 4:8192 -> 4:24576|HTP0 x HTP0 -> HTP0|hvx-tiled vtcm 2801664|flags 0x0`

## B-cpu-2
- Proof log: `B-cpu-2-proof.log`; measured log: `B-cpu-2.log`.
- `B-cpu-2.log:L13` `| lfm2 2.6B Q4_0                 |   1.48 GiB |     2.70 B | OpenCL,HTP |   0 |       5 |   1 | none         |           tg256 |         29.17 ± 0.00 |`
- `B-cpu-2.log:L16` `EXIT=0`
- CPU route `B-cpu-2-proof.log:L817` `0.00.377.187 I load_tensors: offloaded 0/31 layers to GPU`

## B-npu-3
- Proof log: `B-npu-3-proof.log`; measured log: `B-npu-3.log`.
- `B-npu-3.log:L13` `| lfm2 2.6B Q4_0                 |   1.48 GiB |     2.70 B | OpenCL,HTP |  99 |       5 |   1 | HTP0         |           tg256 |         23.17 ± 0.00 |`
- `B-npu-3.log:L16` `EXIT=0`
- v75 session `B-npu-3-proof.log:L272` `0.00.411.394 I ggml-hex: HTP0 new session : session-id 0 domain-id 3 uri file:///libggml-htp-v75.so?htp_iface_skel_handle_invoke&_modver=1.0&_dom=cdsp&_session=0 handle 0xb400006f3f2a0810`
- HTP0 model buffer `B-npu-3-proof.log:L12283` `0.01.165.264 I load_tensors:         HTP0 model buffer size =  1525.87 MiB`
- HTP0 dispatch `B-npu-3-proof.log:L24763` `0.04.119.423 D ggml-hex: HTP0 execute-op MUL_MAT|blk.0.shortconv.in_proj.weight x model.layers.{}.operator_norm-0 (reshaped) -> model.layers.{}.conv.in_proj-0|2048:6144 x 2048:2 -> 6144:2|q4_0 x f32 -> f32|18:1152 x 4:8192 -> 4:24576|HTP0 x HTP0 -> HTP0|hvx-tiled vtcm 2801664|flags 0x0`

## B-cpu-3
- Proof log: `B-cpu-3-proof.log`; measured log: `B-cpu-3.log`.
- `B-cpu-3.log:L13` `| lfm2 2.6B Q4_0                 |   1.48 GiB |     2.70 B | OpenCL,HTP |   0 |       5 |   1 | none         |           tg256 |         29.21 ± 0.00 |`
- `B-cpu-3.log:L16` `EXIT=0`
- CPU route `B-cpu-3-proof.log:L817` `0.00.377.561 I load_tensors: offloaded 0/31 layers to GPU`

## B-gpu-3
- Proof log: `B-gpu-3-proof.log`; measured log: `B-gpu-3.log`.
- `B-gpu-3.log:L13` `| lfm2 2.6B Q4_0                 |   1.48 GiB |     2.70 B | OpenCL,HTP |  99 |       5 |   1 | GPUOpenCL    |           tg256 |         14.55 ± 0.00 |`
- `B-gpu-3.log:L16` `EXIT=0`
- OpenCL identity `B-gpu-3-proof.log:L53` `0.00.152.372 I llama_prepare_model_devices: using device GPUOpenCL (QUALCOMM Adreno(TM) 750) (unknown id) - 4560 MiB free`
- GPU placement `B-gpu-3-proof.log:L819` `0.00.369.304 I load_tensors: offloaded 31/31 layers to GPU`

