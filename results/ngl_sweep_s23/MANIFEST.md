# q44 ngl sweep S23 — MANIFEST

Pulled from `/data/local/tmp/kalsa_q44/`. SHA256 via Python hashlib (PC-side).
On-device binary/model pins also in `device/kalsa_q44/binary_sha.txt` (`sha256sum`).

## Pins

| artifact | path / value | sha256 |
|---|---|---|
| llama-bench stub | `/data/local/tmp/s3oracle/llama-bench` | `b2ae0fa6c413a5049a87b0706f2687cd7035ae5e43985fe40779dc0a7d225b2c` |
| libllama-bench-impl.so | `/data/local/tmp/s3oracle/` | `8adc148c0909e8ebbbf6ed41970b2c07ac0319db96454ad0dd7b2f281a9b8807` |
| libggml-opencl.so | `/data/local/tmp/s3oracle/` | `f432548328af0429fd0f885ccde70cae69f40666118836c713491602dedd6d6d` |
| LFM2.5-8B-A1B-KEXP.gguf | `/data/local/tmp/LFM2.5-8B-A1B-KEXP.gguf` | `b07c80870f8a864549f4a419ccbfb4d4282ba2d55a2e8d808b7c377d3fc6c3f4` |
| threads | `-t 4` (n5 #18 pin, verified) | |
| flags ngl0 | `-nr -fa off -t 4 -p 512 -n 128 -r 1 -o jsonl` | |
| flags ngl>0 | same + `-v` + `GGML_OPENCL_LOG_ALLOC=1` | |
| N | 25 (`load_tensors: offloaded 1/25 layers to GPU`) | |
| points | 0, 7, 13, 19, 99 | |

## Pulled files (`results/ngl_sweep_s23/device/kalsa_q44/`)

| path | bytes | sha256 |
|---|---:|---|
| `battery_gate.log` | 269 | `2bdab030d20a6e39478f1646c3eec779a43e5006921e120db1c73587d373df33` |
| `battery_session_end.txt` | 11333 | `03f5c7b9bc239719444954d55e5acce90736311de4ed65c3c6137aba98e17a0e` |
| `battery_session_start.txt` | 11343 | `bf00b1350f10ac1bc94307f20647a657496c0b7420d047d1a63b2c58a5f6494c` |
| `binary_sha.txt` | 654 | `714d500f48f078368ef7cf9965351a9d30ce4296da75753823853856ce8a07ae` |
| `continue.out` | 4898 | `5e8da2a01173f607a6b492011856ad02adbf0eb5aa013dffa9e096bb9d8cdba9` |
| `continue_driver.sh` | 15418 | `320bb8c4c9d3e3aa846fe5d000a787f4216e072393d97a99220b6b989ac76014` |
| `continue_launch.sh` | 229 | `d94f461907d65ba4ab8bc38237fecc59716abcbcdecc8b4f9465801139800b11` |
| `df.txt` | 100 | `14eee6f5fa039dcb4a27af5927478b6422605f6e0d81abfe39e535d4e30f0c71` |
| `driver.log` | 6319 | `48b8833003d06b864643c5941ca066784212e4b4a2b585a536d4e0ea4e362193` |
| `driver.out` | 960 | `e0f3fd3df9943cc9ed99bc505bfcc2589d5a28a9d385c559ebb3520121d32d04` |
| `driver.pid` | 6 | `9f1a482df0fcd89775f72247686973177a9fb6c7afe6542b151b46a7d3ffd2b9` |
| `driver.sh` | 13787 | `1ce4185c350007463812e2f38aef76ee5552c833611c8498610a1572d5851e52` |
| `env_ggml_raw.txt` | 17 | `8b4c8933930c388b59716e9dd590f15d5b439460d2456ad76814d0dba4236b5a` |
| `fingerprint.txt` | 75 | `0f05fb43db4aaddcbe54d1fb493afc81c075228a25734194a8c1b17d1dfe3589` |
| `HEARTBEAT` | 21 | `0eff23ae1eed70e85ce1a18787e0c50cdda5acf0f2c4675ca2e4cb65d2501d41` |
| `launch.sh` | 218 | `7c4af0a2012fc2043ce57cf3e857e9bd768af441d2dcc162b55de2480401d856` |
| `meminfo_session_end.txt` | 1570 | `d57d52c5d3f43db96f97a9575efa64fc1fba3ca078bd364d33c28c5e9e87eda3` |
| `meminfo_session_start.txt` | 1570 | `868dba18bf92e131389e5fd3a42a5f7fdae2d5c405bc53161560b6026518863c` |
| `model_bytes.txt` | 11 | `258ff4072d7aaf8514fdea1ddeb3f6288437e83fe24cf652a2f63c7e7cfd6a86` |
| `model_ls.txt` | 93 | `6b18cbd75797e4767b2e6d5d65792cc103f31952b33a5b05d5423e800747c73a` |
| `N_MAP.txt` | 130 | `85c60774a9b8f7ae753b3f4ad038db1bc7ce665a83f917c6eb9e7ee8e0d06a14` |
| `nproc.txt` | 2 | `10159baf262b43a92d95db59dae1f72c645127301661e0a3ce4e38b295a97c58` |
| `offload_line_raw.txt` | 43 | `d3fb31cb96103c0f41685bb4a0ba20a1a933612b778576874214eda864525430` |
| `PINS.txt` | 520 | `a76e70d87d7a6668e9df18205f3190f089637e09a8d7b6d23fd8edd36be14b45` |
| `points/ngl0/battery_post.txt` | 11349 | `e2732cc20aebede59e531c0c061d6a5667ed4ed7ecc3e206cc0a1c929135ce9c` |
| `points/ngl0/battery_pre.txt` | 11338 | `f0e15045b685aa3ac78b77b0cb9a66de5dba65cdf61939ab22a848c4eb403a8c` |
| `points/ngl0/bench.pid` | 6 | `f0735cbee138aa655faca15462536272babf192ef5d92704a7efc313ef92f9cb` |
| `points/ngl0/captured_pid.txt` | 6 | `f0735cbee138aa655faca15462536272babf192ef5d92704a7efc313ef92f9cb` |
| `points/ngl0/cmd.txt` | 519 | `b73fe493e81ed38dbe004cc9613a62e3c365ae3d16fa34186655a72fc0b1d0c8` |
| `points/ngl0/cmdline.txt` | 109 | `d805c28042c93b7494c9c563ebc2ebe1b00f9d3a30b2075a070aadd1dbff9e4d` |
| `points/ngl0/cpus_allowed.txt` | 40 | `45103286681fb8e0616db521f58caea79a248866ac5641deb0c258f1d95b0f32` |
| `points/ngl0/cpuset.txt` | 2 | `f465c3739385890c221dff1a05e578c6cae0d0430e46996d319db7439f884336` |
| `points/ngl0/kgsl_proc_ls.txt` | 68 | `c6aecf2efc92850a87e71684184d31411f3748ba8144f9e18480095e014693c9` |
| `points/ngl0/meminfo_post.txt` | 1570 | `ea121ac36b4a383ddabb59a374e29062cc9adcd3fb1ae1133f3bc81f79744222` |
| `points/ngl0/meminfo_pre.txt` | 1570 | `e36436c5ad0ff05b952457c334ee24a27cd5050582159f41bf3fb1adae622b6a` |
| `points/ngl0/nproc.txt` | 2 | `10159baf262b43a92d95db59dae1f72c645127301661e0a3ce4e38b295a97c58` |
| `points/ngl0/rc.txt` | 2 | `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` |
| `points/ngl0/sampler.csv` | 2890 | `3fbda18d5b8fc7cb28d7a090fb690c021ef0f092749ca66dd05df92f7b0446e9` |
| `points/ngl0/sampler.pid` | 6 | `3359d1054c471f62e33c06570472e3cfe6c5f9a636f228871a64e45d4cd96fd7` |
| `points/ngl0/status_live.txt` | 1107 | `9f9d3a826c33f54c5c17689d651e335f55d4f881bdf8d6f83dd89b3ff95948e3` |
| `points/ngl0/stderr.txt` | 814 | `11341a4f4a9000f8aec7b062d3f0a17df819a571062e9463c2afc48b6ded346a` |
| `points/ngl0/stdout.jsonl` | 1984 | `b4ae52c5f4739279859fd18a5453445a4ac46fbefec27676a553229002bedc75` |
| `points/ngl0/t_end.txt` | 21 | `c3d8e53ca3fd45b15a82f2551f57f8cbb4c6153906e134e3f50ef816b3c9b609` |
| `points/ngl0/t_start.txt` | 21 | `8b252d841252ac947d78e2b96495324638e9aa162e49d89db568bcfa401da8da` |
| `points/ngl13/battery_post.txt` | 11329 | `0555ef3d7739e3bfc66c6c300e9e502026cb8443c9ab385ac477f5d6e2eb4492` |
| `points/ngl13/battery_pre.txt` | 11326 | `23d2363c4c0f657cbe2cb7c3adcb7eeb71d4f4fb7b24c19c901884022d71db6c` |
| `points/ngl13/bench.pid` | 6 | `6446ac3d2db489c3abd05da9b54c1e753cb4c491c044466606e39aae496c68bf` |
| `points/ngl13/captured_pid.txt` | 6 | `6446ac3d2db489c3abd05da9b54c1e753cb4c491c044466606e39aae496c68bf` |
| `points/ngl13/cmd.txt` | 523 | `d459328cd3ca9d7a2293ff2b41fafade5643ca48e56b52b0300860a7f7ad9850` |
| `points/ngl13/cmdline.txt` | 113 | `ca5252c1ef497aeaeb3b1f5630d4bb135d5a112a023abefee0d6185e55f38fc6` |
| `points/ngl13/cpus_allowed.txt` | 40 | `45103286681fb8e0616db521f58caea79a248866ac5641deb0c258f1d95b0f32` |
| `points/ngl13/cpuset.txt` | 2 | `f465c3739385890c221dff1a05e578c6cae0d0430e46996d319db7439f884336` |
| `points/ngl13/kgsl_proc_ls.txt` | 68 | `953511e0d4467e79ef04ff23be4ee316f8e8a790fd35c37dac633b10c9e88cd8` |
| `points/ngl13/meminfo_post.txt` | 1570 | `29db9d7085ec70af7f71f82da58acd235f9e81b0a80c35293c269db7a5632c74` |
| `points/ngl13/meminfo_pre.txt` | 1570 | `7235efa2fb473905673484832e443bf5cff474a755a5c5b805e461f01d0278b6` |
| `points/ngl13/nproc.txt` | 2 | `10159baf262b43a92d95db59dae1f72c645127301661e0a3ce4e38b295a97c58` |
| `points/ngl13/rc.txt` | 2 | `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` |
| `points/ngl13/sampler.csv` | 4755 | `84b116542028134904ad64ac990daae4b8978c725ea50b9cd39b8e8e748132af` |
| `points/ngl13/sampler.pid` | 6 | `cb6b0ba4e36b96d4cfbdac20202153baa70eb3633246d89172d7a7847e536fc7` |
| `points/ngl13/status_live.txt` | 1105 | `76f262d182c79f6f394ca50c0affd384811e7ec83f4ee695ed49e50a60d56dde` |
| `points/ngl13/stderr.txt` | 179697 | `30853c514524b55083ab44fdb731e6634409016c4f7ee09f69c94bf8e06bbb7a` |
| `points/ngl13/stdout.jsonl` | 1987 | `449fd75342fcc99ee1c6eae2d9dc835d25c25a7ae09d6df1edec4f9799196038` |
| `points/ngl13/t_end.txt` | 21 | `2a0b1f2ae4f30ac9d540dcaceb07722dffcfc69e42be4e66f3e373861caaf125` |
| `points/ngl13/t_start.txt` | 21 | `a8955eba0b52addf5d029e61db5a1d9c294138b9bbd631be128b101fa1854c13` |
| `points/ngl19/battery_post.txt` | 11326 | `2ce1983118b0d46c4798290e6d30cbbc8e36c452ce1fc1c5cff2ee388859b9b8` |
| `points/ngl19/battery_pre.txt` | 11328 | `c6bcb3f7cc6cfe3ee98befc877fe2e2b82341718c88003c0382b405d030cfa31` |
| `points/ngl19/bench.pid` | 6 | `1fe3ad70a418cb8d5ce24e17facf59c2179eb0104db968df247c468ba8bb79f0` |
| `points/ngl19/captured_pid.txt` | 6 | `1fe3ad70a418cb8d5ce24e17facf59c2179eb0104db968df247c468ba8bb79f0` |
| `points/ngl19/cmd.txt` | 523 | `63f42eb6c1240ddceda678d2e84aac3cf9249c87eb6a1091295fb6e5f19fcd01` |
| `points/ngl19/cmdline.txt` | 113 | `3972550160de1f7c2ff46df870aa59d65af5086cfa18701e7e87b3923ecffc51` |
| `points/ngl19/cpus_allowed.txt` | 40 | `45103286681fb8e0616db521f58caea79a248866ac5641deb0c258f1d95b0f32` |
| `points/ngl19/cpuset.txt` | 2 | `f465c3739385890c221dff1a05e578c6cae0d0430e46996d319db7439f884336` |
| `points/ngl19/kgsl_proc_ls.txt` | 68 | `dc17da6d61ec04a000cb674ee67a777c40f49e9821d0d35ec95befe935993b08` |
| `points/ngl19/meminfo_post.txt` | 1570 | `fe233e3eda4eec950d5ea3b489f0aad86e6da0667b01299b556753d20f399b78` |
| `points/ngl19/meminfo_pre.txt` | 1570 | `93e17477b078c1f9d6ef392534d5733cff7593792a208ef6599c4c07513d4db3` |
| `points/ngl19/nproc.txt` | 2 | `06e9d52c1720fca412803e3b07c4b228ff113e303f4c7ab94665319d832bbfb7` |
| `points/ngl19/rc.txt` | 2 | `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` |
| `points/ngl19/sampler.csv` | 3607 | `65ef5602341b6ba3499885033847cd9154858fcb2ef63cea2149233e5dfb1199` |
| `points/ngl19/sampler.pid` | 6 | `d1f3b26a4703627f0b4fa0b27a80cde87c61a536fa76d02e7d7c247fe8fe372f` |
| `points/ngl19/status_live.txt` | 1105 | `22bb5db10f6e14b34af6c1a5fc69c588d14e89850345c1fe2311ae77b5028c96` |
| `points/ngl19/stderr.txt` | 190270 | `586b4e52b9d7229a56652183f105af344e5e42e0c7f15def5378dd22e96cb8a5` |
| `points/ngl19/stdout.jsonl` | 1987 | `408b764e8f6970d3b51d4cb73239bdb96b330336eb1d48ebdba93fbc452c8cb1` |
| `points/ngl19/t_end.txt` | 21 | `97c8353691ee55c7f03ea46ef3fd9fde057008c4f5f5d247ce3f8a7ec2bdba92` |
| `points/ngl19/t_start.txt` | 21 | `b6417f664edfff8435ac8ec72bd504288be00d7303688e079849e942682086ce` |
| `points/ngl7/battery_post.txt` | 11326 | `2346dc465bc17b5c3e3d70f7292dfb4fe998b0820636ee246a19238193a07af1` |
| `points/ngl7/battery_pre.txt` | 11344 | `931ef5cde1523081bb886049da4368030ebd43de64a68d67e8f37c9e44e753d1` |
| `points/ngl7/bench.pid` | 6 | `02ad74603d74b7eebab014cbe1723b1020ccfa9ee3aaff1c1691ce859475a3f5` |
| `points/ngl7/captured_pid.txt` | 6 | `02ad74603d74b7eebab014cbe1723b1020ccfa9ee3aaff1c1691ce859475a3f5` |
| `points/ngl7/cmd.txt` | 522 | `b1bf87d1a8dfc6761eeb12a9ef77d77c43bbb66479e8adb0a0cf21e6bd8c1ba9` |
| `points/ngl7/cmdline.txt` | 112 | `0c04a4c41a7eede8515b1875bd8843e06ff4b58b66fb387baeb162a07ec90cd6` |
| `points/ngl7/cpus_allowed.txt` | 40 | `45103286681fb8e0616db521f58caea79a248866ac5641deb0c258f1d95b0f32` |
| `points/ngl7/cpuset.txt` | 2 | `f465c3739385890c221dff1a05e578c6cae0d0430e46996d319db7439f884336` |
| `points/ngl7/kgsl_proc_ls.txt` | 68 | `53c0e169c435cd1b7b4f11821b4225854ad0593087a3dbc7be67dd8699b2ebc0` |
| `points/ngl7/meminfo_post.txt` | 1570 | `d97eb5523d6eb391b377319093f1a04b4f66fd289859a8e9230f058f61c9e815` |
| `points/ngl7/meminfo_pre.txt` | 1570 | `9de1110d8c420b50d8d7c880e07b3bb0ed47c3b73126557437c1e2abc027ad40` |
| `points/ngl7/nproc.txt` | 2 | `aa67a169b0bba217aa0aa88a65346920c84c42447c36ba5f7ea65f422c1fe5d8` |
| `points/ngl7/rc.txt` | 2 | `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` |
| `points/ngl7/sampler.csv` | 3799 | `f7701dbb54f8acb8a4a73b6ee2639b950d2995302fe6fa778a98fd1d36b6d130` |
| `points/ngl7/sampler.pid` | 6 | `b34bac1af5c70fb7a3759d02175a3dc7d1874905a7c94337fe3a5cc1852aa6e1` |
| `points/ngl7/status_live.txt` | 1105 | `40c38d79d1a6142314efce41e3a5604cb08e6d1df65bb8834d7ac32137c5fc78` |
| `points/ngl7/stderr.txt` | 168969 | `c1b4e3a77e80cbd8f1a7d9f820759bfb8f0ee377736f9853fc3021e7394513e9` |
| `points/ngl7/stdout.jsonl` | 1985 | `9302e1080050e73f892342c3c29734c50cda5951034995734060bc01753b32f6` |
| `points/ngl7/t_end.txt` | 21 | `1dd6a4b748327141b67d6d3c16af6edb053e7daf440e595056b478b78c862445` |
| `points/ngl7/t_start.txt` | 21 | `670fa8c4e19e9a693ddc044308b41cf267c6aa1d856ad0c01b7fa7ecbb2c60ca` |
| `points/ngl99/battery_post.txt` | 11333 | `278476e68010ee44be1ab636a969673906f378519266ca255d759ecdf83ec2da` |
| `points/ngl99/battery_pre.txt` | 11325 | `aa05b6282558f6b696b0fc52f4c5af4945961503afe45c6787bc1a7970a6f929` |
| `points/ngl99/bench.pid` | 6 | `4e35bc0558f5e364037311104458b836804ac5197f77bc575aa65d7d5eb06929` |
| `points/ngl99/captured_pid.txt` | 6 | `4e35bc0558f5e364037311104458b836804ac5197f77bc575aa65d7d5eb06929` |
| `points/ngl99/cmd.txt` | 523 | `0966916da0a99486a7df13a1282ecf784e83afcf72e4f722811d5e6f2d9d63d0` |
| `points/ngl99/cmdline.txt` | 113 | `c63b9aa2a48435ce32239365db859e7469cc5fe5cb7ae82d34303b4a4907de27` |
| `points/ngl99/cpus_allowed.txt` | 40 | `45103286681fb8e0616db521f58caea79a248866ac5641deb0c258f1d95b0f32` |
| `points/ngl99/cpuset.txt` | 2 | `f465c3739385890c221dff1a05e578c6cae0d0430e46996d319db7439f884336` |
| `points/ngl99/kgsl_proc_ls.txt` | 68 | `201470e2cd480a6fa255b05eb7b91c9e8bb0bbc2e2c0c81668c10fdf19bbc385` |
| `points/ngl99/meminfo_post.txt` | 1570 | `bdaecc46eedf53f18a7bf0775b2979d5a74477eff156ab7ebcb51f0ea32a7b8f` |
| `points/ngl99/meminfo_pre.txt` | 1570 | `13276e7c5a6bc759b1d7fd69ef57acb04427835d3c8fbf84a0d1afc8c9509694` |
| `points/ngl99/nproc.txt` | 2 | `10159baf262b43a92d95db59dae1f72c645127301661e0a3ce4e38b295a97c58` |
| `points/ngl99/rc.txt` | 2 | `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` |
| `points/ngl99/sampler.csv` | 3218 | `fc41678cfb5fe75eeea9217852622933912d88c723faf3dd801b4455490f08c3` |
| `points/ngl99/sampler.pid` | 6 | `ca71dcb7cc8e0de93ca848125786e89702282cdbbfb7a2d8773b7e72a24ea2e7` |
| `points/ngl99/status_live.txt` | 1105 | `dc3b141b384bb6942c264c5cab859f329c35e96dc11210f9784febcb2079ef7c` |
| `points/ngl99/stderr.txt` | 172609 | `05294b6bc749e9355c407d6a9113db68db80e3b891789f5bf25219bf7ccae7ef` |
| `points/ngl99/stdout.jsonl` | 1984 | `f5d586aee28a952ae148bcdb382fdd98d1378ac5b0310da043bc2dc528e2692d` |
| `points/ngl99/t_end.txt` | 21 | `104486e089c5fd14e008cee6e94a824866e23e13ac4624cee0d8fe9d642f9804` |
| `points/ngl99/t_start.txt` | 21 | `858230091df56cc26803f0c3700238768e621a1f0a381b290043067c54538763` |
| `points/probe_ngl1/rc.txt` | 2 | `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` |
| `points/probe_ngl1/stderr.txt` | 1931 | `79b887c70a16844d26951c4024e10a86be77847985e79765472cdc258873f3f1` |
| `points/probe_ngl1/stdout.jsonl` | 989 | `4d94e6c5da1bbc1b114e9e75ab4eee27c10493b19e3283e9a573e3944c41c7b4` |
| `points/probe_ngl1_v/rc.txt` | 2 | `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` |
| `points/probe_ngl1_v/stderr.txt` | 41239 | `11547f610e9d5ab80fabb756fbfbf85cda7c928156d2f5cebe1fe591bc59d37e` |
| `points/probe_ngl1_v/stdout.jsonl` | 989 | `9c204b671cc614e54459eeb9011d1a3888ca0acfe7b12912a60186312f71f3b5` |
| `progress.txt` | 53 | `9317c9a59b021db0505206f4a9d4b78878fc7cfc8b98d7e269e56aaac74aabb0` |
| `SMOKE.txt` | 16 | `02cc466cf9703917028357b74f0f82696baff2aa1021e7b4acb3984671494fea` |
| `STATUS` | 5 | `8221ac66be71558c921fb44cfb66f7997699aea754d917763882d6d9eddc836e` |
| `t_session_end.txt` | 21 | `019519268b70b8d9cc3baf0da7edb366bbbbf13d001e30f1edcbae38650a46b6` |
| `t_session_start.txt` | 21 | `24f3b3104e10776d9ba2f0edfcf1628a96baff2009425c9d6255c7fdb6c57ddb` |
| `uname.txt` | 120 | `25351ba99ecad928e453bdee2391ce38050bbb4ca0077edc04015d4f38ece99a` |
