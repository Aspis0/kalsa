# B-prime Q8_0-trunk HTP smoke (v73) S23 — MANIFEST

REGISTRA+DICHIARA. Phase 2 after q44 ngl sweep. SHA256 Python hashlib PC-side.

## Pins

| artifact | value | sha256 |
|---|---|---|
| llama-bench (kalsahtp) | /data/local/tmp/kalsahtp/llama-bench @3f545be | 5db18906bfe159ba97da18404c513886a5b2a07ec715c18dda7a1bc2d6d38507 |
| libggml-hexagon.so | kalsahtp | 06aa3098f63fd4f419d9943063a07a4718fc32832a919734d0094fccdea6448 |
| libggml-htp-v73.so | kalsahtp | c8f9d14a388455ec364e99d4f63dbee773a4bad6de204b61496fe128f125edd5 |
| Marco-Mini-Instruct-KEXP-fromsrc-trunk-q8_0.gguf | /data/local/tmp/ 6509642624 B | d63fc0f21a8c3aab4b7531ee30aa37f8e6320dfb65e85de74a9056e2feeb419 |
| env | GGML_HEXAGON_NDEV=1 VERBOSE=1 HOSTBUF unset (v73 llama-bench path) | |
| invocation (a) | -p 16 -n 8 -r 1 --no-warmup -ngl 99 -dev HTP0 -v -o jsonl --load-mode none -fa on --ubatch-size 1024 | |
| deletions | none | |

## Pulled files

| path | bytes | sha256 |
|---|---:|---|
| phase2/a_stderr.txt | 196051 | 87a8ec8d58f2e22157fb0ea3bb560bac09c4a0317b9380b28bfbb2b54325e331 |
| phase2/a_stdout.jsonl | 0 | e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |
| phase2/attempt1/a_stderr.txt | 196051 | 95869c1c2eb02918d7d9aceb16615691733dcf0677d8e057213ed56b8a499347 |
| phase2/attempt1/a_stdout.jsonl | 0 | e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |
| phase2/attempt1/driver.log | 306 | 85c5b8c546e8527a43fdfb86874f55b29fec2192f82a2edaf07244e469ac02e2 |
| phase2/attempt1/driver.out | 365 | 14f6ddddb90ff3683603144fec671d9cd973564bb4d7ce2c525bc8e0275ec1ed |
| phase2/attempt1/HEARTBEAT | 21 | 9eaf7cde27e7aa7f12a0f4a67bbcf490d8f9aea361c20b2d9946da99e5f66559 |
| phase2/attempt1/STATUS | 9 | 3c2713b99750867b99f437df3da8d039a8cada71974c2d1ceb44be7e75e49a87 |
| phase2/battery_a_pre.txt | 8458 | 54ed4cb524511a516ad530e782b1b86aae24b06756fb24ce99a05945d7509ade |
| phase2/battery_gate.log | 118 | a2adbf27e36ad2a3a0a2cae39dfcd54211da13d15150ea524e6ede4d5bf89ab1 |
| phase2/battery_session_start.txt | 8458 | 54ed4cb524511a516ad530e782b1b86aae24b06756fb24ce99a05945d7509ade |
| phase2/binary_sha.txt | 216 | 090dd20babe4a93f8fe490634fab1b653ee51fd7f73dbba8b838f9bb4262a77a |
| phase2/df.txt | 100 | e91c443d0398071f0e329199f74fe58c6855bbfdec5afcbdd6ebcf609ccb3831 |
| phase2/driver.log | 306 | 627beac3718fa3ccc36ef2ef8d3253f274d34cd8ac8b1a52962af11ad3913745 |
| phase2/driver.out | 306 | 627beac3718fa3ccc36ef2ef8d3253f274d34cd8ac8b1a52962af11ad3913745 |
| phase2/driver.pid | 6 | d09302e4df50ee9800bb17f070801b7f1d41033a4f48ee0246681f43f00d207b |
| phase2/header_a.txt | 793 | 4f141e188d07338bd2ddeb5d6059ee7606ff3470069c961c55affb371a461c5f |
| phase2/header_session.txt | 793 | fab442f7716ba23a28fddc9937008f15d84a1ad7a418471e9b86a6d068a08fd4 |
| phase2/HEARTBEAT | 21 | 5e4ee011ac1c63674598866df4b39b72d603604a66c12514dfb58cbcd3aecfba |
| phase2/model_sha.txt | 131 | e10513b1a218845549c60afbe106b4b8f0f93cd5966bfce5db056ae669b5f8e7 |
| phase2/phase2_driver.sh | 6245 | d6f6f5a5e1fa283b7daaea8e0e45929fee9aa56ce0bf7788fa3eb9e3bbc0e5bb |
| phase2/phase2_launch.sh | 194 | 4ca023b04ee4ac53065f3eba1508dc0de01bf0276c017057eeec67df5082756c |
| phase2/setsid.pid | 6 | d09302e4df50ee9800bb17f070801b7f1d41033a4f48ee0246681f43f00d207b |
| phase2/STATUS | 9 | 3c2713b99750867b99f437df3da8d039a8cada71974c2d1ceb44be7e75e49a87 |
