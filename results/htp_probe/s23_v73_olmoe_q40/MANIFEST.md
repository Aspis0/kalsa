# OLMoE all-Q4_0 experts-on-NPU probe (v73) S23 — MANIFEST

REGISTRA+DICHIARA. First attempt at MoE experts on the Qualcomm NPU.
SHA256 Python hashlib PC-side (never Get-FileHash).

## Pins

| artifact | value | sha256 |
|---|---|---|
| llama-bench (kalsahtp) | /data/local/tmp/kalsahtp/llama-bench @3f545bec | 5db18906bfe159ba97da18404c513886a5b2a07ec715c18dda7a1bc2d6d38507 |
| libggml-hexagon.so | kalsahtp | f06aa3098f63fd4f419d9943063a07a4718fc32832a919734d0094fccdea6448 |
| libggml-htp-v73.so | kalsahtp | c8f9d14a388455ec364e99d4f63dbee773a4bad6de204b61496fe128f125edd5 |
| OLMoE-1B-7B-0924-Instruct-Q4_0.gguf | /data/local/tmp/ 3928037856 B | 43379486db3178d89b338358d298ea0721d6c123e0107d91c5d6179371000500 |
| env (a) | GGML_HEXAGON_NDEV=1 VERBOSE=1 HOSTBUF unset (v73 llama-bench path) | |
| invocation (a) | -p 16 -n 8 -r 1 --no-warmup -ngl 99 -dev HTP0 -v -o jsonl --load-mode none -fa on --ubatch-size 1024 | |
| (b)(c) | skipped: (a) rc=134, empty jsonl | |
| deletions | none | |

## Pulled files

| path | bytes | sha256 |
|---|---:|---|
| bprime/battery_gate.log | 278 | 5442e914f60c495df02177495b6c9e8eafdf3313d22988e914ebfb6db4352016 |
| bprime/battery_session_end.txt | 10919 | f798391531d321432a330c389cf5a74443fb7e13b99a39121c3aeb3f4e782172 |
| bprime/battery_session_start.txt | 10918 | 9f9581e6dbdd2202f950df783f517be715425952a4d9f781f5e062a5d222ab51 |
| bprime/binary_sha.txt | 216 | 090dd20babe4a93f8fe490634fab1b653ee51fd7f73dbba8b838f9bb4262a77a |
| bprime/bprime_driver.sh | 7386 | 26ad4440441c048ddb8ff8cb1856aed364fc7b33e048f62e8fd3131859cb7fcb |
| bprime/bprime_launch.sh | 282 | 89c784f339c169cf5805b7dbfe25128af7c73711e762faf70b1f33982e814759 |
| bprime/charge_cpu_r1_post.txt | 11125 | f6d15d82150a0d3da9264bd33b854ad883f99195d8f01c218651a2c4d44e2205 |
| bprime/charge_cpu_r1_pre.txt | 11124 | de93f8c25d4f8712532423ab1da9dab243ec3b76a0b77f4b47df82be51893f42 |
| bprime/charge_cpu_r2_post.txt | 11125 | fd97d51480fe42042289350aa94f53076d5ddca958224ad0262c02f6b075ce72 |
| bprime/charge_cpu_r2_pre.txt | 11124 | c308b816e84fc029ea05fd4fc75a75905224ef079938619f11924b4f0dd25019 |
| bprime/charge_htp_r1_post.txt | 11127 | aeb859f0e918ede05c847b00a80b292a5b60db7df8dba6849df8906aca323436 |
| bprime/charge_htp_r1_pre.txt | 11126 | cebc8866c9175775935d9620617b9b7d6901677d3305a7e9e5084fec23448857 |
| bprime/charge_htp_r2_post.txt | 11124 | 5b721c69d17f35308ac2009b7a487635a97664f24476fff87051e654c10b1774 |
| bprime/charge_htp_r2_pre.txt | 11123 | 5ab20651df50b7cdf29f883c6d36e01b797b81d4d2c5ea1a44e4333c5a2f20ef |
| bprime/cpu_r1_rc.txt | 2 | 9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa |
| bprime/cpu_r1_stderr.txt | 2813 | 018dee6c61131000931be0a2fdd3a436922946245eb0805ddfc2a49aa85e3576 |
| bprime/cpu_r1_stdout.jsonl | 1868 | a0fbbd2ace185c25dcd3d96decca36d41926122db8f6a625bf88a8d2e870c77e |
| bprime/cpu_r1_stdout_from_stderr.jsonl | 1868 | a0fbbd2ace185c25dcd3d96decca36d41926122db8f6a625bf88a8d2e870c77e |
| bprime/cpu_r2_rc.txt | 2 | 9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa |
| bprime/cpu_r2_stderr.txt | 2812 | 37242aa3309e3a9e10ed1ac4992170d301113ef84f5c6ad466389cd699298b80 |
| bprime/cpu_r2_stdout.jsonl | 1867 | da5c545506e31236c2436ba49e55193dfb14e44e69765e2cd8296aff6078e8ea |
| bprime/cpu_r2_stdout_from_stderr.jsonl | 1867 | da5c545506e31236c2436ba49e55193dfb14e44e69765e2cd8296aff6078e8ea |
| bprime/df.txt | 100 | 3794abafefc511d95bd5e005800ae82a2f86e7ba0ed67d178b5a06b7610ef02a |
| bprime/driver.log | 1315 | 2e37d7da3b50a98aa480e4825248b3c183b2178cb95f8102caba5117ffd382b2 |
| bprime/driver.out | 1433 | d08474b63a7d390fa1015619c710f934f4e04c7778d8fb64473728a31878c13b |
| bprime/driver.pid | 6 | f4c52803f3fe3366ca73be45244af9f46b044a58b6efbdcc7bd04ff125a09695 |
| bprime/header_cpu_r1.txt | 741 | ffb9656fbe2ff316bc84d08b9988f186571d9b68fa354be007388128266b611a |
| bprime/header_cpu_r2.txt | 741 | 8db258f855fd047b2c9690d534336a65c81df80cccbd52488cd27f737f9840dd |
| bprime/header_htp_r1.txt | 741 | 21e0426bfbb2d9eb443579d988329e5a8319e12cb6ece780dbb67e8e6a54fe71 |
| bprime/header_htp_r2.txt | 741 | 199e873d8e5201cada276f1d9e9d78e0685c29af79dcc0935563307fa92b82ee |
| bprime/header_session.txt | 741 | 0cd727b1aeb71f796468097cf9ea5428b6a910f8d3ebffd22a7f468e6c5ee22a |
| bprime/HEARTBEAT | 21 | 360e37e9da71652666c2833d7caa3bc62d986ce5d2ad599b14d40476af8c7e67 |
| bprime/htp_r1_rc.txt | 4 | e726b440cc164001999e718b51780d80314709efe06e7857282377be9111127b |
| bprime/htp_r1_stderr.txt | 1861 | e297676bb3bc0eb15bcc925d401f0ece096c0edd194b62c5cb50db3604cf9704 |
| bprime/htp_r1_stdout.jsonl | 0 | e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |
| bprime/htp_r1_stdout_from_stderr.jsonl | 0 | e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |
| bprime/htp_r2_rc.txt | 4 | e726b440cc164001999e718b51780d80314709efe06e7857282377be9111127b |
| bprime/htp_r2_stderr.txt | 1861 | 7ef12aa5a27f7f450c7b4225f59fb3a2458d04ac33db3f29bfecc9e4a171c260 |
| bprime/htp_r2_stdout.jsonl | 0 | e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |
| bprime/htp_r2_stdout_from_stderr.jsonl | 0 | e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |
| bprime/model_sha.txt | 118 | c58d764cce945b7268b3050ac5ad8b690b30eaf514bae496d0ecb789fdf1bf0c |
| bprime/n_gen.txt | 8 | 0ff4a1424fbff7bc707a724a08d0948d9a6f075c4afba61bf0dd269e736c8bda |
| bprime/STATUS | 53 | 5e513f14304db08ae332620ec50a86f14d29b1fb321ea46e678e732fd10f44a6 |
| bprime/t_session_end.txt | 21 | e1da6d18e5a912d2fcd5a31f2a533eefce36fe8380d86bf36f581f3e84f8bedd |
| bprime_analysis.txt | 2056 | e868d378057f3e86b4d772d87fe3c3d7a3733b9d06d817de5a1fa2b7e9e3a0b1 |
| crash_context.txt | 8671 | 5f891a2b709583a87ca5802f0177fb6d13154d99aa3c85fab66d9c3b590fe08d |
| device/kalsa_q48/a_buffer_split.txt | 284 | 11cfe2035a194c49ace0703f773915783585ee0fc41aced3e7f42e7dcc58fe8b |
| device/kalsa_q48/a_execute_op_attn.txt | 21444 | 52aeeb5cd5ea2648ba81feb310177cc9bb1cacdd691e8a11c9debdcdf6d070e5 |
| device/kalsa_q48/a_execute_op_count.txt | 4 | 84b983f776fa270eac724d630c27d687dc01bde11f0677e7180eff0ce2797883 |
| device/kalsa_q48/a_execute_op_exps_any.txt | 16294 | cb1490d18dd7cf090d5bb7b532cdbf29312a650a8ebdca72e96f65e93382ca90 |
| device/kalsa_q48/a_execute_op_exps_htp0.txt | 16294 | cb1490d18dd7cf090d5bb7b532cdbf29312a650a8ebdca72e96f65e93382ca90 |
| device/kalsa_q48/a_execute_op_htp0.txt | 109645 | 390dae38a4e5ff5d0d066544e3e2da45983c0f732af0bbf38205942d1b52a43c |
| device/kalsa_q48/a_execute_op_mul_mat_id.txt | 16294 | cb1490d18dd7cf090d5bb7b532cdbf29312a650a8ebdca72e96f65e93382ca90 |
| device/kalsa_q48/a_init_tensor_attn.txt | 10548 | ec8d2a059eaa73c0e0880f0ad15ef96a7de6959562290e9de8c665ff3856cb12 |
| device/kalsa_q48/a_init_tensor_exps.txt | 5554 | 03a48fca5a874d88630fbeb4265c380de70777f92a2f59bcb62fe68f3911ee31 |
| device/kalsa_q48/a_not_supported.txt | 0 | e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |
| device/kalsa_q48/a_proof.txt | 14094 | d2e2215ccf84238b991c254fe202f20dcddf1d504523473f7717675cfd985312 |
| device/kalsa_q48/a_rc.txt | 4 | e726b440cc164001999e718b51780d80314709efe06e7857282377be9111127b |
| device/kalsa_q48/a_reject_why.txt | 54935 | 3d805c662ec85665a6c0261461192c303c20b5240e9b9270cfb97456b36b8bbb |
| device/kalsa_q48/a_stderr.txt | 1995992 | 70292df17a6db8682d6c8a8c10abcbf4c8d3ed7125f48a16dfe3f53ecb7df2ea |
| device/kalsa_q48/a_stdout.jsonl | 0 | e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |
| device/kalsa_q48/a_supports_mul_mat_id.txt | 165347 | d112b05eb48dcf70217fa41101e03211555f9bad86933a3b4291bfabe96168d3 |
| device/kalsa_q48/a_supports_mul_mat_id_no.txt | 12642 | d01404cc66d625565c38de1448c06893c7743f8ce1fa590b1469415344ffeb3a |
| device/kalsa_q48/a_supports_mul_mat_id_yes.txt | 152705 | a9013b9f776432b035f5fc45026d19ecf40bcf4acf858b4494ce2a31335d0e02 |
| device/kalsa_q48/battery_a_post.txt | 10919 | d120ace06e7997c3e95d1c722306d41d1e23e9e9296b226b99d17b963ddb0278 |
| device/kalsa_q48/battery_a_pre.txt | 10919 | d120ace06e7997c3e95d1c722306d41d1e23e9e9296b226b99d17b963ddb0278 |
| device/kalsa_q48/battery_gate.log | 59 | 5924d4f064bc18675723bc042dd13ec57c2831cacf94e0a4202a2eded80a8c62 |
| device/kalsa_q48/battery_session_start.txt | 10919 | d120ace06e7997c3e95d1c722306d41d1e23e9e9296b226b99d17b963ddb0278 |
| device/kalsa_q48/binary_sha.txt | 216 | 090dd20babe4a93f8fe490634fab1b653ee51fd7f73dbba8b838f9bb4262a77a |
| device/kalsa_q48/df.txt | 100 | 3794abafefc511d95bd5e005800ae82a2f86e7ba0ed67d178b5a06b7610ef02a |
| device/kalsa_q48/driver.log | 513 | 3aac53ab52b15cca8dc100194e71a3182053ab8730ea797b7a4a49e2cf9cf745 |
| device/kalsa_q48/driver.out | 513 | 3aac53ab52b15cca8dc100194e71a3182053ab8730ea797b7a4a49e2cf9cf745 |
| device/kalsa_q48/driver.pid | 6 | 62c0dfe75118750a84dcf9c2b6152b8ab8fe67924ea22bc8ee13352214e20390 |
| device/kalsa_q48/header_a.txt | 934 | 79956a3767e62f3c7814e0ed4ea683c696e6a79dc70c16590c90b2e33c83789d |
| device/kalsa_q48/header_session.txt | 934 | 3ed69c540d2672367e15116eaaf050150edb4b5e2a568b9baf0682d68841a22e |
| device/kalsa_q48/HEARTBEAT | 21 | 0e777014eb864208fc83dfee712f69b854cd1bbe5c04cae271334e7d21b25a32 |
| device/kalsa_q48/meminfo_a_post.txt | 1570 | 2fa1095453231b82c315c56267a49a9c0b69552468fc9654c2c3f0b17a6a778c |
| device/kalsa_q48/meminfo_a_pre.txt | 1570 | 0e90eabd02f25e6dd63f0ea92aedb004e5e58dd8a75e3219f557bc6880318494 |
| device/kalsa_q48/meminfo_session_start.txt | 1570 | a8c5ae6f96a45aa43263ac9533c35e8ac50088d9377b052fc8f998d8d3be5cac |
| device/kalsa_q48/model_sha.txt | 118 | c58d764cce945b7268b3050ac5ad8b690b30eaf514bae496d0ecb789fdf1bf0c |
| device/kalsa_q48/phase2_driver.sh | 10070 | 0aa159869c6563b00c2730e5fc120ed366c02d6443efe69120d0b9366e3bbc9d |
| device/kalsa_q48/phase2_launch.sh | 180 | 9ef8449d16bcb71dbcd1369b53fa95113a6c840da0d4d54b7385a91c7270fe89 |
| device/kalsa_q48/STATUS | 28 | 78e70ca89d5b1b40e628013e6b60a5da5aba1ae65dbb42de908cebd6d155733a |
| n0/charge_post.txt | 198 | a71ecc2a0427bc269e0ce4569eed1fb0dbad9a67290f35485ab3edabdd3ddea4 |
| n0/charge_pre.txt | 198 | b649b5c9afbb81dd1e19a6d58ce5d9c72068fa36a39561e28c2ca23e36f8953a |
| n0/rc.txt | 4 | e726b440cc164001999e718b51780d80314709efe06e7857282377be9111127b |
| n0/stderr.txt | 1861 | 881665df50ec013fbd04fafbb2d2a31be3a3cb7104456fab3c9696a58ee13ff7 |
| n0/stdout.jsonl | 0 | e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |
| sanity/counts.txt | 2331 | fa77c816a87a5a673e57a4aa5fba4afce2869b96378016102f59793e2f284f8a |
| sanity/pc_sha256.txt | 121 | 5f0020b25603913f66ff0613bb196e8cb46c89dc7ae6613aacd3684b61730f7a |
| tombstone_08.txt | 73256 | b621fd2630abdbca40f0e65a2a1b43fc1a865a43cb71c5b51ad3f383a23cf271 |
