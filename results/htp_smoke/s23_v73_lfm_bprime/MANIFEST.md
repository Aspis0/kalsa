# LFM2.5-8B-A1B B-prime Q8_0-trunk HTP smoke (v73) S23 — MANIFEST

REGISTRA+DICHIARA. First NPU smoke of a KEXP-class model that fits the S23.
SHA256 Python hashlib PC-side (never Get-FileHash).

## Pins

| artifact | value | sha256 |
|---|---|---|
| llama-bench (kalsahtp) | /data/local/tmp/kalsahtp/llama-bench @3f545bec | 5db18906bfe159ba97da18404c513886a5b2a07ec715c18dda7a1bc2d6d38507 |
| libggml-hexagon.so | kalsahtp | f06aa3098f63fd4f419d9943063a07a4718fc32832a919734d0094fccdea6448 |
| libggml-htp-v73.so | kalsahtp | c8f9d14a388455ec364e99d4f63dbee773a4bad6de204b61496fe128f125edd5 |
| LFM2.5-8B-A1B-KEXP-fromsrc-trunk-q8_0.gguf | /data/local/tmp/ 3580407296 B | 38a93d7120ef217effba39e4490d341ce02a0ed04fef899d65b03c1322a1b13a |
| env (a)(b) | GGML_HEXAGON_NDEV=1 VERBOSE=1 HOSTBUF unset (v73 llama-bench path) | |
| env (c) | same binary; -ngl 0; HEXAGON_NDEV unset; HOSTBUF unset | |
| invocation (a) | -p 16 -n 8 -r 1 --no-warmup -ngl 99 -dev HTP0 -v -o jsonl --load-mode none -fa on --ubatch-size 1024 | |
| invocation (b) | -p 512 -n 128 -r 2 -ngl 99 -dev HTP0 -o jsonl --load-mode none -fa on --ubatch-size 1024 | |
| invocation (c) | -p 512 -n 128 -r 2 -ngl 0 -o jsonl --load-mode none -fa on --ubatch-size 1024 | |
| deletions | none (Marco B-prime 6509642624 B left on device) | |

## Pulled files

| path | bytes | sha256 |
|---|---:|---|
| device/kalsa_q46/a_buffer_split.txt | 284 | 3500cc62285fe2180f4aff7ce48205a3b582248c279ed567b002fd2910d5126c |
| device/kalsa_q46/a_execute_op_attn.txt | 62149 | 65741116e71140302a8c645b502d12693fc0c0da66fa670c3f96e31c650259b3 |
| device/kalsa_q46/a_execute_op_count.txt | 5 | 958038ca73fb104089c81be560e3fe60a01ea86ec4227592edeec63c55c9d619 |
| device/kalsa_q46/a_execute_op_experts.txt | 390521 | f840db218aba40fc3380ebb974f276816d999216b0803ea0822c6131be93e4b4 |
| device/kalsa_q46/a_execute_op_htp0.txt | 960514 | 6ea04b0910f848c1880d7ba77f5480eeaca6a83345261be0aa59722aa3851d3d |
| device/kalsa_q46/a_execute_op_shortconv.txt | 119034 | d1c9a2b5c718a8867e3e8b38ded6a3468bad6a500cbf8967e2b832e956618607 |
| device/kalsa_q46/a_proof.txt | 400 | 150b202a1c0050676f0c88aea21b7f694619ff766a149fdd643523e2e752616b |
| device/kalsa_q46/a_rc.txt | 2 | 9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa |
| device/kalsa_q46/a_stderr.txt | 6867430 | dd5a3e25e66b89df76e6a8042bff01f3271373d5230601575878bc817909f8b0 |
| device/kalsa_q46/a_stdout.jsonl | 1888 | 3712daf32138339de00d754c96dfffc70f4f92285580005ac59ae3fe3169fb60 |
| device/kalsa_q46/b_buffer_split.txt | 0 | e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |
| device/kalsa_q46/b_rc.txt | 2 | 9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa |
| device/kalsa_q46/b_stderr.txt | 1039 | d9c7ec3904c10175c47b8a8c1223811c978273bf8a3f765813e77e93115fdeea |
| device/kalsa_q46/b_stdout.jsonl | 1955 | f8c9ffe2e45f1c0c5e789a61b01e64e5d4f70e5ee9df56a1721837f21c0552b9 |
| device/kalsa_q46/battery_a_post.txt | 9277 | 008fc929a11825c71d963b1bd071c3e1003f24977068622b51e6b5603eae6b31 |
| device/kalsa_q46/battery_a_pre.txt | 9277 | 008fc929a11825c71d963b1bd071c3e1003f24977068622b51e6b5603eae6b31 |
| device/kalsa_q46/battery_b_post.txt | 10098 | 19971fd955b9f353a9682f04e10eb74fcaee5f144141023d425bc103a2a9d22d |
| device/kalsa_q46/battery_b_pre.txt | 9277 | 008fc929a11825c71d963b1bd071c3e1003f24977068622b51e6b5603eae6b31 |
| device/kalsa_q46/battery_c_post.txt | 10508 | 454d961d8a70512346de34331a1d3e7f6733ee6f421cd31c573146bf6b1cdefd |
| device/kalsa_q46/battery_c_pre.txt | 10098 | 19971fd955b9f353a9682f04e10eb74fcaee5f144141023d425bc103a2a9d22d |
| device/kalsa_q46/battery_gate.log | 187 | 246885882ffde30230c2d5744ebc0550d46e54b729814973677de3fb15cbe5dd |
| device/kalsa_q46/battery_session_end.txt | 10508 | 454d961d8a70512346de34331a1d3e7f6733ee6f421cd31c573146bf6b1cdefd |
| device/kalsa_q46/battery_session_start.txt | 9277 | 8a9b75b3dae842814ba09901ff0cd5cc13a70780b8e362cd33c258861d690e8e |
| device/kalsa_q46/binary_sha.txt | 216 | 090dd20babe4a93f8fe490634fab1b653ee51fd7f73dbba8b838f9bb4262a77a |
| device/kalsa_q46/c_buffer_split.txt | 0 | e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |
| device/kalsa_q46/c_rc.txt | 2 | 9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa |
| device/kalsa_q46/c_stderr.txt | 781 | f24b7a8d0b3f0a04fc9676d57f29d8dccfc0d490a6031bfdc810178cefb863ef |
| device/kalsa_q46/c_stdout.jsonl | 1952 | 58132f029d2970729e07d9d59beadbde4a7edd56bb97401d1cc205a4492eb2d4 |
| device/kalsa_q46/df.txt | 100 | 77531299a7fe67c8f4467116b64f03a8f55c52da1b781b14ae5980955be65929 |
| device/kalsa_q46/driver.log | 982 | 9b2ace4a274f62d5bc4f130de06bdfa736a627d3d55aa6a46de9e7b28fda2484 |
| device/kalsa_q46/driver.out | 1159 | bba70a505ca08b5e1d6e8bb401c2ed38ebdc0c3bf9e9698ff603a6780322464c |
| device/kalsa_q46/driver.pid | 6 | cf495bf60da0808ee0630ab14d8fecf55c3f0e86ed0c884e959421a91a232b06 |
| device/kalsa_q46/header_a.txt | 942 | c482dac544ec834c44b0c6c379af2873e73982128baef404f855816da5c76142 |
| device/kalsa_q46/header_b.txt | 942 | 95cfdd331bb7579f07140d03634ad405707f013b39e8f220c3645ac19f24e34b |
| device/kalsa_q46/header_c.txt | 942 | e2f827d725def9df43c23c37fe0cfca9f45915638d7a5c14ed70b40a74811ecf |
| device/kalsa_q46/header_session.txt | 942 | 4da28e70a8047671b43637badfe78ef5c2219f9887c5e93a910374a7a8224c63 |
| device/kalsa_q46/HEARTBEAT | 21 | 5f9006b7ed975a4a1d7ebdfaf1236e46820694b769aa01da4e3b927a6d03a32f |
| device/kalsa_q46/meminfo_a_post.txt | 1570 | 1d55bbe047ef49f80af1423bf27901374e81292ac917b4c50e794d84df94f72f |
| device/kalsa_q46/meminfo_a_pre.txt | 1570 | 3c4e8f61af79c7ac8727c8edf682928614a6d430b7a0882dd5ca7174b3a08209 |
| device/kalsa_q46/meminfo_b_post.txt | 1570 | f4a6e85252310723de8a8103de94e684f169d15445f3aee6185b5dd11768325c |
| device/kalsa_q46/meminfo_b_pre.txt | 1570 | 4182a1458ec410e0b2863f74163139cf1d0dbffeb4cf138fa64aec0050c99c67 |
| device/kalsa_q46/meminfo_c_post.txt | 1570 | 0ec0ab93b109c38fee70026fcbbdc13ee4b869d1026bb259ebf80b0db61ffb0a |
| device/kalsa_q46/meminfo_c_pre.txt | 1570 | c1d68f14752d99bf6e658b4017a5c4785c45068a5c76f6bc9150bda3892aadc7 |
| device/kalsa_q46/meminfo_session_end.txt | 1570 | a415ff5e517feac05abb4e0e7463b750e7d7ecbbabbea2df6087260f2904fe20 |
| device/kalsa_q46/meminfo_session_start.txt | 1570 | 7da6c1ca092a1f318aefc5dc968fd2375a30ec6516d2c999b6ccc403f80291a9 |
| device/kalsa_q46/model_sha.txt | 125 | 2afdc5f3027de22e78d1dd7363d3c767ec387982a876d0bd4540e838b84cfe59 |
| device/kalsa_q46/phase2_driver.sh | 8518 | 871d60e9202d4b229789c3bef8d8bfc607350ab5216fb55812572c1769935dd5 |
| device/kalsa_q46/phase2_launch.sh | 180 | aba385e1586303b69e6c792148c4ce49148eb68d95729724623882ab25ea9a14 |
| device/kalsa_q46/STATUS | 48 | 5b6e1b6492a269fa89361258e21082a2262318984e80565ab5c453fe5568908e |
| device/kalsa_q46/t_session_end.txt | 21 | 1a1eba598f26ce2930563bf213300a49844b3266b0eaf237eab6778490926340 |
| sanity/pc_sha256.txt | 128 | 2985e8d233ce5118dd82d55af68b969b412a763c11b3b48b74046eec4cdd1397 |
| sanity/verify_q8_vs_control.json | 1199 | 18e4967486930f29bbf547fbd2f40f405ec347dc33b6671d7b2a0e5dcee98896 |
| sanity/verify_q8_vs_control.txt | 496 | ffdb5428dab89785e78f3d99ea7d3f3e55a91cf5838bfbb454df4f051deaa9be |
