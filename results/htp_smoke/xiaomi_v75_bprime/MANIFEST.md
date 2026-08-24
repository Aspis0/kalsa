# Xiaomi v75 B-prime Q8_0-trunk HTP smoke — MANIFEST

REGISTRA+DICHIARA. Includes (a)(b) HTP, (c) CPU same-harness, energy probes.
SHA256 Python hashlib PC-side.

## Pins

| artifact | value | sha256 |
|---|---|---|
| device | houji / 23127PN0CG / `adb-625689a2-9xEOfw._adb-tls-connect._tcp` | |
| llama-bench | kalsahtp @3f545be | `5db18906bfe159ba97da18404c513886a5b2a07ec715c18dda7a1bc2d6d38507` |
| libggml-htp-v75.so | kalsahtp | `46d3ac923988f20b75d6d3489eea0e1432aa275aaff61c39253e170c17729182` |
| GGUF | 6509642624 B | `bd63fc0f21a8c3aab4b7531ee30aa37f8e6320dfb65e85de74a9056e2feeb419` |
| (b) HTP | `-ngl 99 -dev HTP0 --no-host 1 -p 512 -n 128 -r 2` HOSTBUF=1 | |
| (c) CPU | `-ngl 0` no -dev HTP0 no --no-host, same -p/-n/-r/jsonl | |
| (d) | skipped (ambiguous) | |
| energy | dumpsys Charge counter (sysfs EACCES) | |
| deletions | none | |

## Pulled files

| path | bytes | sha256 |
|---|---:|---|
| `kalsa_bprime_x/a_buffer_sizes.txt` | 240 | `6a8bf0e18eaa84b9654c58e7f835589373c7f24f0b7b21114d416a3581f117de` |
| `kalsa_bprime_x/a_execute_op_attn.txt` | 272809 | `79febb6085ebdd7337f7895ed8220868a231111e9842f1684de084b4c3dd9002` |
| `kalsa_bprime_x/a_execute_op_experts.txt` | 741132 | `97980cb5e3932a187e341b0f9152e0f9174af8032444df0a9872b32422501bdf` |
| `kalsa_bprime_x/a_execute_op_htp0.txt` | 1430651 | `358ad8aa47a2d5455fab184ec6ccee91477d70cc75b96e810aa2086fd402fc21` |
| `kalsa_bprime_x/a_execute_op_mul_mat.txt` | 220408 | `2e4cd632d5ac7bb6555fa09ca6ce9448bf17c6ba4b430ff6bccee69b40287dac` |
| `kalsa_bprime_x/a_offload.txt` | 44 | `822f122099bd759bc038426a1b62648550d0f67082b56f4d08793446614bf0b3` |
| `kalsa_bprime_x/a_proof.txt` | 66 | `a54fe89473586c1f6e8f863d6cb2eee12a872dd324613e41f2147f1a40f45c2d` |
| `kalsa_bprime_x/a_rc.txt` | 2 | `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` |
| `kalsa_bprime_x/a_stderr.txt` | 9114638 | `325a64d9c29245288c74bca1df2cd4eabd8fa2f5db94ec6d97f553ed4355e7d3` |
| `kalsa_bprime_x/a_stdout.jsonl` | 1899 | `a537a9d4dad4c3056f29a2dac1be2484643ad8ef0173685f141767707bcc938b` |
| `kalsa_bprime_x/b_rc.txt` | 2 | `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` |
| `kalsa_bprime_x/b_stderr.txt` | 499 | `ea8ca66b96d7cd125382b80ca3fb1e38e8b3dc24b96439d5e3ccc0b39761fb24` |
| `kalsa_bprime_x/b_stdout.jsonl` | 1964 | `6dbfcd1647c284bc306d88b4e70e9509646f6f1e230e95fe9802e9de4c9107ec` |
| `kalsa_bprime_x/battery_a_post.txt` | 776 | `695a7f3f88952a03ec30b2d25debb626ec0a328f4c76965b1bdea26748987d19` |
| `kalsa_bprime_x/battery_a_pre.txt` | 776 | `870f0f64234a678d0d6589df2d6b2bbd1e5724f520158267a4a68385dd48db9e` |
| `kalsa_bprime_x/battery_b_post.txt` | 775 | `7cccc304407b9bf2af50e290b7aa9e650845543c08b1db6eaf11d40717c154dd` |
| `kalsa_bprime_x/battery_b_pre.txt` | 776 | `695a7f3f88952a03ec30b2d25debb626ec0a328f4c76965b1bdea26748987d19` |
| `kalsa_bprime_x/battery_c_post.txt` | 776 | `602582dfe2dc2490183cd336ffe73aac9d5fecbcac79d2cb88a385ac7f40b15d` |
| `kalsa_bprime_x/battery_c_pre.txt` | 775 | `60c0de6f3f2fa83f16a1c2a7bea2ad9696fe77c808e297278d21bfe769551c73` |
| `kalsa_bprime_x/battery_session_end.txt` | 775 | `7cccc304407b9bf2af50e290b7aa9e650845543c08b1db6eaf11d40717c154dd` |
| `kalsa_bprime_x/battery_session_start.txt` | 776 | `870f0f64234a678d0d6589df2d6b2bbd1e5724f520158267a4a68385dd48db9e` |
| `kalsa_bprime_x/binary_sha.txt` | 286 | `fd86f1182d9908986a250caef6b813679a80b95d217441d36b85f2eac3e24893` |
| `kalsa_bprime_x/c_battery_gate.log` | 44 | `8925791db935fef8f5ad6e63c7f698201ac106e118464f998f283838a9c1d840` |
| `kalsa_bprime_x/c_binary_sha.txt` | 70 | `b4218b63ee9f2e05f1194ad52d2c98c6add3fe4929c4f5f0d9245f88ed53a14f` |
| `kalsa_bprime_x/c_driver.log` | 288 | `02e17d005d2f6cf12e1e40632d3454c14f573a3b33ef80d61c8ca1b75421a221` |
| `kalsa_bprime_x/c_driver.out` | 288 | `02e17d005d2f6cf12e1e40632d3454c14f573a3b33ef80d61c8ca1b75421a221` |
| `kalsa_bprime_x/c_driver.pid` | 6 | `fa0607f6752de4c29007702c4ec482bc2edb1c8714a57bcd92958b8fdd8e6e6a` |
| `kalsa_bprime_x/c_driver.sh` | 3362 | `d30c9d8ce4416f5c44a56a6cc2b2d0b8c9223237bf159dbed03167652718af0c` |
| `kalsa_bprime_x/c_launch.sh` | 294 | `9184aea1a535a487f3dfbfdb909877a03a9ade4e696455b32d9ae02dbb28612a` |
| `kalsa_bprime_x/c_rc.txt` | 2 | `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` |
| `kalsa_bprime_x/c_setsid.pid` | 6 | `fa0607f6752de4c29007702c4ec482bc2edb1c8714a57bcd92958b8fdd8e6e6a` |
| `kalsa_bprime_x/C_STATUS` | 12 | `45a651038e8c020320e83498ff075fac020037701414e8c8edeb133fb505458d` |
| `kalsa_bprime_x/c_stderr.txt` | 499 | `de2b32c06e2ad5c5654e620c76b71a989bb0c6b8ae1c138912ee6076e8b894ef` |
| `kalsa_bprime_x/c_stdout.jsonl` | 1963 | `d32bfbac57c148cc52121f20a0f1a234cb51137d5bca3f7419a5b29e5d0cee62` |
| `kalsa_bprime_x/charge_a_process_post.txt` | 317 | `d7f7fbe0e17e1bb231b4b82f07aaa7c70d6bd8978b3d73afd1787af149787c9d` |
| `kalsa_bprime_x/charge_a_process_pre.txt` | 351 | `f9452c901cc792216abd1ccf15ece715780ed4fe43cfe29cdc4b706178945ab7` |
| `kalsa_bprime_x/charge_b_process_post.txt` | 324 | `a4fa8fa8a72fc7c23d4cb9fe8803321ec6ba77569fc76642063eece3558fa8ed` |
| `kalsa_bprime_x/charge_b_process_pre.txt` | 360 | `b0645ca62f23971f444e815a6bac8adb5e754948a5bddc338b793e68ccdea047` |
| `kalsa_bprime_x/charge_c_process_post.txt` | 324 | `891772b487de8d3454283e2dc8427be64d542f2150e57af5e38b5aa1ea0ed64a` |
| `kalsa_bprime_x/charge_c_process_pre.txt` | 360 | `05cfac3761aa099adb623cfda8a4287d04d5ff1e4e27a31b7af1bfd149cd14bf` |
| `kalsa_bprime_x/device.txt` | 15 | `302649975523b12b9bb20f72a93e344c0254d64902a0269a6739ba981500997c` |
| `kalsa_bprime_x/df.txt` | 100 | `d8b9cb9f6e8af09e4e7eec773ea1bbb9af1832586027fc259bf5f2f2c9683136` |
| `kalsa_bprime_x/driver.log` | 430 | `35bf9ebdc026357ec21df99734dad58712b5bc355023de7bb219a690275a3d02` |
| `kalsa_bprime_x/driver.out` | 430 | `35bf9ebdc026357ec21df99734dad58712b5bc355023de7bb219a690275a3d02` |
| `kalsa_bprime_x/driver.pid` | 6 | `545c6769cfcfee65037c8e43975f8fee38ab81e6eb346a69616a11d55167e79f` |
| `kalsa_bprime_x/driver.sh` | 5944 | `295396ac734d00882b04cf70b963e9ac4613b3636b9a984aa2f194db12182372` |
| `kalsa_bprime_x/energy/b_extra_battery_post.txt` | 775 | `1c5edccf73ea5abd7d7dcdad8d3bad34f9553403587f188545eafa95a40012fd` |
| `kalsa_bprime_x/energy/b_extra_battery_pre.txt` | 776 | `0f0ef9965200ec4357fb64ea30bd9684a3e4aa539132ad4a7e415d3aa8681d31` |
| `kalsa_bprime_x/energy/b_extra_charge_post.txt` | 262 | `fa4050951c5712d0d299d406fb0e2aea7ec9cab539377194a70e4cd50be50eca` |
| `kalsa_bprime_x/energy/b_extra_charge_pre.txt` | 296 | `640203caab74882e71a2d7f7651830e84bdbe1560c296996549edbf0e6f82b62` |
| `kalsa_bprime_x/energy/b_extra_rc.txt` | 2 | `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` |
| `kalsa_bprime_x/energy/b_extra_stderr.txt` | 499 | `4ec4b6c9ae7156cfa986cc79d7abc1f47315ffd7404d83f49e3a6d470eb73ba2` |
| `kalsa_bprime_x/energy/b_extra_stdout.jsonl` | 1902 | `efdb36de75b50485f590ebfe0145c449fd7c0022aac1edee86ef38027885feb1` |
| `kalsa_bprime_x/energy/battery_end.txt` | 775 | `1c5edccf73ea5abd7d7dcdad8d3bad34f9553403587f188545eafa95a40012fd` |
| `kalsa_bprime_x/energy/battery_gate.log` | 288 | `79c26f2e4c85cab2e7d6085ba530652ed7716b4cb4bb97acf1a97d0eef7c5890` |
| `kalsa_bprime_x/energy/c_rep1_battery_post.txt` | 776 | `341cb630f4adc13605cdae9b8557d34e8651b581e65a545084c4dcf1824dae6d` |
| `kalsa_bprime_x/energy/c_rep1_battery_pre.txt` | 776 | `341cb630f4adc13605cdae9b8557d34e8651b581e65a545084c4dcf1824dae6d` |
| `kalsa_bprime_x/energy/c_rep1_charge_post.txt` | 258 | `3cda97470c7ef28e6b32b4c60dfdf56999581fa72994a9cb08274709e492728b` |
| `kalsa_bprime_x/energy/c_rep1_charge_pre.txt` | 269 | `fa496828f7f59bc94c97924c08267512a7615898fafd449d24034e7208075556` |
| `kalsa_bprime_x/energy/c_rep1_rc.txt` | 2 | `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` |
| `kalsa_bprime_x/energy/c_rep1_stderr.txt` | 499 | `484fc8e356fe67112a8be02c3992d42465b2cba6fe1285ac83c9f9061b15f137` |
| `kalsa_bprime_x/energy/c_rep1_stdout.jsonl` | 1898 | `d6f36a0fed123805fa489a35eb3b3e6f7beea6b2a8d8573f3a5b41c9e5765d48` |
| `kalsa_bprime_x/energy/c_rep2_battery_post.txt` | 776 | `0f0ef9965200ec4357fb64ea30bd9684a3e4aa539132ad4a7e415d3aa8681d31` |
| `kalsa_bprime_x/energy/c_rep2_battery_pre.txt` | 776 | `341cb630f4adc13605cdae9b8557d34e8651b581e65a545084c4dcf1824dae6d` |
| `kalsa_bprime_x/energy/c_rep2_charge_post.txt` | 258 | `f070260d27a2518398aeaedb7b64e48fa660cc4aafdd5d36bda8a4483bb110e0` |
| `kalsa_bprime_x/energy/c_rep2_charge_pre.txt` | 269 | `9fb73ef97c7ce1666c9c76a2d07c877e3018f997b828127d8ed5154bd9dd82f1` |
| `kalsa_bprime_x/energy/c_rep2_rc.txt` | 2 | `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` |
| `kalsa_bprime_x/energy/c_rep2_stderr.txt` | 499 | `d618e6505590e1c2df38433ec7aecaeb0d8902a659967db7bd132258466d5565` |
| `kalsa_bprime_x/energy/c_rep2_stdout.jsonl` | 1900 | `fb5838c49519188bf58645b5cd2902f13c2af960369eb318a3eb83733f8a8d3b` |
| `kalsa_bprime_x/energy/driver.log` | 1109 | `3cb5c2000a891a2e21fdc88bb7d65365106b7896eda389d14ffe325c97335983` |
| `kalsa_bprime_x/energy/driver.out` | 1109 | `3cb5c2000a891a2e21fdc88bb7d65365106b7896eda389d14ffe325c97335983` |
| `kalsa_bprime_x/energy/driver.pid` | 6 | `1fc4691f3137a662572e8cf8fd92a4f0a105b5da4be4caded88e14501ca88270` |
| `kalsa_bprime_x/energy/energy_summary.txt` | 1389 | `a5b95220670b00b725540901af3b64797aef71fa226895fd2692f6b6879e179f` |
| `kalsa_bprime_x/energy/setsid.pid` | 6 | `1fc4691f3137a662572e8cf8fd92a4f0a105b5da4be4caded88e14501ca88270` |
| `kalsa_bprime_x/energy/STATUS` | 5 | `8221ac66be71558c921fb44cfb66f7997699aea754d917763882d6d9eddc836e` |
| `kalsa_bprime_x/energy_driver.sh` | 3988 | `031bc806f09457e04401528a830e099f34a609fef47c7456c551fa6593bf3c8c` |
| `kalsa_bprime_x/energy_launch.sh` | 314 | `740c9e2be4a1c8fb66bdbbfc851297d5c41c36488be3f134ea04969383a4bc19` |
| `kalsa_bprime_x/header_a.txt` | 933 | `f8d2c2037e65ecec46ff1f06792571a44529411373a7e101b5c5e34eae1d8fd1` |
| `kalsa_bprime_x/header_b.txt` | 933 | `1cc53199c31c6aded818dbd81523650d2fccfe1f005d65b45b6578c17ad1ccda` |
| `kalsa_bprime_x/header_c.txt` | 898 | `f2d1afe0beba5ec7bd166974fb70138790d9b85bcd6032d20bd58a2199cb8f29` |
| `kalsa_bprime_x/header_c_post.txt` | 898 | `0b8b0ae192692380b2a9d94ae6f18c6ce3bf9b1dcb267a3c6c245cf5c016b895` |
| `kalsa_bprime_x/header_c_pre.txt` | 898 | `f2d1afe0beba5ec7bd166974fb70138790d9b85bcd6032d20bd58a2199cb8f29` |
| `kalsa_bprime_x/header_session.txt` | 933 | `f8d2c2037e65ecec46ff1f06792571a44529411373a7e101b5c5e34eae1d8fd1` |
| `kalsa_bprime_x/HEARTBEAT` | 21 | `62b749c7ffdda6166d8d5e7fa9177f940493858b8ab31fd1f7cb2c59387b34fd` |
| `kalsa_bprime_x/launch.sh` | 336 | `eb245a8673305d22f527ecd6fd848c5b3e9f26479e47bbf5191c5aa7443073a7` |
| `kalsa_bprime_x/model_sha.txt` | 205 | `98464d8bac29ab2ff5381a2c02e535023dfeb6239ed5d3ddd1a2646fa14330ef` |
| `kalsa_bprime_x/setsid.pid` | 6 | `545c6769cfcfee65037c8e43975f8fee38ab81e6eb346a69616a11d55167e79f` |
| `kalsa_bprime_x/STATUS` | 42 | `85f0085eca2c193a482857b9fe1a4e6309b16d8f309a725b8b270f651da96fc3` |
| `kalsa_bprime_x/t_session_end.txt` | 21 | `07e87c8966e977203a5e0d2ffe0b49c0a9e93fc081d489dca93916743e38fad7` |
