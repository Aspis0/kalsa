| model                          |       size |     params | backend    | threads | type_k | type_v |  fa |            test |                  t/s |
| ------------------------------ | ---------: | ---------: | ---------- | ------: | -----: | -----: | --: | --------------: | -------------------: |
| gemma4 E4B Q4_K - Medium       |   4.62 GiB |     7.52 B | MTL,BLAS   |       8 |   q8_0 |   q8_0 |   1 |           pp512 |        615.15 ± 0.48 |
| gemma4 E4B Q4_K - Medium       |   4.62 GiB |     7.52 B | MTL,BLAS   |       8 |   q8_0 |   q8_0 |   1 |           tg128 |         38.72 ± 0.01 |
| gemma4 E4B Q4_K - Medium       |   4.62 GiB |     7.52 B | MTL,BLAS   |       8 |   q8_0 |   q8_0 |   1 |   pp512 @ d8192 |        361.58 ± 0.70 |
| gemma4 E4B Q4_K - Medium       |   4.62 GiB |     7.52 B | MTL,BLAS   |       8 |   q8_0 |   q8_0 |   1 |   tg128 @ d8192 |         36.30 ± 0.26 |

build: 5102686dd (11198)
