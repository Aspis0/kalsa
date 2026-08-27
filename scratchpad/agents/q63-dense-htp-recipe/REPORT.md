# q63 REPORT — numbers-only

| arm | corpus | chunks | PPL | err | control PPL | delta % | gate |
|---|---|---:|---:|---:|---:|---:|---|
| candidate1 | wiki | 64 | 8.4976 | 0.0891 | 8.6983 | -2.3073% | PASS |
| candidate1 | it | 60 | 7.6313 | 0.0775 | 7.5985 | +0.4317% | PASS |
| candidate1 | es | 59 | 7.2920 | 0.0742 | 7.2232 | +0.9525% | PASS |
| candidate1 | fr | 59 | 7.1874 | 0.0721 | 7.1786 | +0.1226% | PASS |
| candidate1 | zh | 61 | 12.9734 | 0.1490 | 12.8935 | +0.6197% | PASS |
| candidate2 | wiki | 64 | 8.4235 | 0.0877 | 8.6983 | -3.1592% | PASS |
| candidate2 | it | 60 | 7.6978 | 0.0783 | 7.5985 | +1.3068% | FAIL |
| candidate2 | es | 59 | 7.3478 | 0.0750 | 7.2232 | +1.7250% | FAIL |
| candidate2 | fr | 59 | 7.2387 | 0.0727 | 7.1786 | +0.8372% | PASS |
| candidate2 | zh | 61 | 13.1110 | 0.1509 | 12.8935 | +1.6869% | FAIL |

| arm | bytes | sha256 | readability | all five gate |
|---|---:|---|---|---|
| candidate1 | 3098664160 | c54e95f8a8be9e444428fe89519be241bb4f15d3436e5864e4bd85ec54b9d89d | PASS | True |
| candidate2 | 2765741280 | 0836af5e4e61d459a32a36d17e0f8cef2c658d39bad00f962e0e6b4509c36ded | PASS | False |
