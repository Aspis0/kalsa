# llama-bench markdown output sample, verbatim from a saved on-device run in
# the lab: scratchpad/agents/inapp-htp-dspqueue-hang/raw/skelswap-B1-run.txt
# lines 13-14 (llama-bench default -o md). The depth suffix "@ d<N>" case is
# not in this log (it ran without -d); that spelling is defined in
# tools/llama-bench/llama-bench.cpp of engine 5b596ce43 and covered by
# test_bench_tsv.py on a row built in exactly this format.
| model                          |       size |     params | backend    | ngl | dev          |            test |                  t/s |
| ------------------------------ | ---------: | ---------: | ---------- | --: | ------------ | --------------: | -------------------: |
| lfm2 2.6B Q4_0                 |   1.48 GiB |     2.70 B | OpenCL,HTP |  99 | HTP0         |            pp64 |        511.18 ± 0.00 |
