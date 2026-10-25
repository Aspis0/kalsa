| model                          |       size |     params | backend    | threads | type_k | type_v |  fa |            test |                  t/s |
| ------------------------------ | ---------: | ---------: | ---------- | ------: | -----: | -----: | --: | --------------: | -------------------: |
| gemma4 ?B Q4_K - Medium        |   7.12 GiB |    11.91 B | MTL,BLAS   |       8 |   q8_0 |   q8_0 |   1 |           pp512 |        230.08 ± 0.40 |
| gemma4 ?B Q4_K - Medium        |   7.12 GiB |    11.91 B | MTL,BLAS   |       8 |   q8_0 |   q8_0 |   1 |           tg128 |         20.05 ± 0.65 |
| gemma4 ?B Q4_K - Medium        |   7.12 GiB |    11.91 B | MTL,BLAS   |       8 |   q8_0 |   q8_0 |   1 |   pp512 @ d8192 |        140.15 ± 0.47 |
| gemma4 ?B Q4_K - Medium        |   7.12 GiB |    11.91 B | MTL,BLAS   |       8 |   q8_0 |   q8_0 |   1 |   tg128 @ d8192 |         15.99 ± 0.05 |

build: 5102686dd (11198)
