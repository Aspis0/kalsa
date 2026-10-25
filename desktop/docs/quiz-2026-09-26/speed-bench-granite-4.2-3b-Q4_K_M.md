| model                          |       size |     params | backend    | threads | type_k | type_v |  fa |            test |                  t/s |
| ------------------------------ | ---------: | ---------: | ---------- | ------: | -----: | -----: | --: | --------------: | -------------------: |
| granite 3B Q4_K - Medium       |   2.09 GiB |     3.66 B | MTL,BLAS   |       8 |   q8_0 |   q8_0 |   1 |           pp512 |        810.45 ± 6.43 |
| granite 3B Q4_K - Medium       |   2.09 GiB |     3.66 B | MTL,BLAS   |       8 |   q8_0 |   q8_0 |   1 |           tg128 |         70.87 ± 0.00 |
| granite 3B Q4_K - Medium       |   2.09 GiB |     3.66 B | MTL,BLAS   |       8 |   q8_0 |   q8_0 |   1 |   pp512 @ d8192 |        438.94 ± 0.56 |
| granite 3B Q4_K - Medium       |   2.09 GiB |     3.66 B | MTL,BLAS   |       8 |   q8_0 |   q8_0 |   1 |   tg128 @ d8192 |         47.92 ± 0.52 |

build: 5102686dd (11198)
