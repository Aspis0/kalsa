# Xiaomi v75 OLMoE-Q4_0 experts-on-NPU probe — MANIFEST

REGISTRA+DICHIARA. SHA256 Python hashlib PC-side.

## Pins

| artifact | value | sha256 |
|---|---|---|
| device | houji / 23127PN0CG / `adb-625689a2-9xEOfw._adb-tls-connect._tcp` | |
| llama-bench | kalsahtp @3f545be | `5db18906bfe159ba97da18404c513886a5b2a07ec715c18dda7a1bc2d6d38507` |
| libggml-htp-v75.so | kalsahtp | `46d3ac923988f20b75d6d3489eea0e1432aa275aaff61c39253e170c17729182` |
| GGUF | OLMoE-1B-7B-0924-Instruct-Q4_0.gguf 3928037856 B | `43379486db3178d89b338358d298ea0721d6c123e0107d91c5d6179371000500` |
| env | HOSTBUF=1 NDEV=1 VERBOSE=1 on HTP cells | |
| HTP flags | `-ngl 99 -dev HTP0 --no-host 1 --load-mode none -fa on --ubatch-size 1024` | |
| deletions | none | |

## Pulled files

| path | bytes | sha256 |
|---|---:|---|
| `kalsa_q48_x/a_buffer_sizes.txt` | 240 | `2a47063e233564b43238c511ccce513cdf9fe248bb61acd874eb43404facb1c1` |
| `kalsa_q48_x/a_errcounts.txt` | 119 | `c2ea058f77b52dfb31e75138d42cdf9448f4198108da67bca538afc0f7e88c2c` |
| `kalsa_q48_x/a_execute_op_attn.txt` | 155564 | `08da28dab8d48bfd0ef91a1e15a7d0df1b56935f174edf680a3aeee6d9d76bb2` |
| `kalsa_q48_x/a_execute_op_exps.txt` | 132966 | `154d31d98fb9a025cc39b2471dba1b954e03e87205e5c09b6174b859282223f2` |
| `kalsa_q48_x/a_execute_op_htp0.txt` | 901085 | `2d3967eaeea381b65c5efbd59bed48e344af560dc3884d917178e24b8e558713` |
| `kalsa_q48_x/a_execute_op_mul_mat_id.txt` | 132966 | `154d31d98fb9a025cc39b2471dba1b954e03e87205e5c09b6174b859282223f2` |
| `kalsa_q48_x/a_init_tensor_exps.txt` | 5554 | `dbaca63e9604892ab40cfc09f23f82ea533bbd2730bd84f91362b1dc66d11144` |
| `kalsa_q48_x/a_offload.txt` | 44 | `11e314619bb6298c0b2c48d0d81aa4a25b44195647fcfd8402d91627d6835cde` |
| `kalsa_q48_x/a_proof.txt` | 55 | `e7ccaeff1e4932165322d805e2d21f441512beaffc316e87e054b3f9291f523d` |
| `kalsa_q48_x/a_rc.txt` | 2 | `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` |
| `kalsa_q48_x/a_stderr.txt` | 4853115 | `f6b74de8df217e9fae56084dfb1c71090d2c587d85621b1ef3eaed0e1aa2753f` |
| `kalsa_q48_x/a_stdout.jsonl` | 1865 | `ad7f76a09750644304c5205921da6c2d17f09d0524d72d94b1ccffce1a369441` |
| `kalsa_q48_x/a_stdout_from_stderr.jsonl` | 1865 | `ad7f76a09750644304c5205921da6c2d17f09d0524d72d94b1ccffce1a369441` |
| `kalsa_q48_x/a_supports_mul_mat_id.txt` | 302947 | `8b581047f03d6bd9b5019517b299639b6ce6b1b15edd88c0375465bd5b68092c` |
| `kalsa_q48_x/a_tombstone.txt` | 799438 | `b44283d40e2ec50958527b775845d4c94737765572d34a345c3d307e04032b51` |
| `kalsa_q48_x/a_tombstone.txt.meta` | 37 | `79f0de0e0c96a5ab9e6be1d6516b636359bcdfb711a3c20b43122ef3e2666734` |
| `kalsa_q48_x/b_r1_errcounts.txt` | 122 | `724b8dbd197249a8af0f17dcd996e20654a57847f25b27577ce346994dc444bb` |
| `kalsa_q48_x/b_r1_rc.txt` | 2 | `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` |
| `kalsa_q48_x/b_r1_stderr.txt` | 2164614 | `3b320a396c6d0b5a261c93b50bea3d98996b5a884b3f1ef03ceaca2c020f4c5d` |
| `kalsa_q48_x/b_r1_stdout.jsonl` | 935 | `384e186e1c031bfe7b88aae407178cdd8eb2a6397ffbfcc66a41a6b19cee5713` |
| `kalsa_q48_x/b_r1_stdout_from_stderr.jsonl` | 935 | `384e186e1c031bfe7b88aae407178cdd8eb2a6397ffbfcc66a41a6b19cee5713` |
| `kalsa_q48_x/b_r1_tombstone.txt` | 799438 | `b44283d40e2ec50958527b775845d4c94737765572d34a345c3d307e04032b51` |
| `kalsa_q48_x/b_r1_tombstone.txt.meta` | 37 | `79f0de0e0c96a5ab9e6be1d6516b636359bcdfb711a3c20b43122ef3e2666734` |
| `kalsa_q48_x/b_r2_errcounts.txt` | 122 | `d6a6f7288b08bceca7af8102873ba9b702303937f959802f7714ef887e071304` |
| `kalsa_q48_x/b_r2_rc.txt` | 2 | `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` |
| `kalsa_q48_x/b_r2_stderr.txt` | 2164614 | `3df178d8c2c588a418aee4142b66cfa217b25db00a6be6ed70255b9c7230c8ae` |
| `kalsa_q48_x/b_r2_stdout.jsonl` | 935 | `b9c01dde1e56f1b15028c6cddd40fc7b2335b82c07fff308e307ab942368557f` |
| `kalsa_q48_x/b_r2_stdout_from_stderr.jsonl` | 935 | `b9c01dde1e56f1b15028c6cddd40fc7b2335b82c07fff308e307ab942368557f` |
| `kalsa_q48_x/b_r2_tombstone.txt` | 799438 | `b44283d40e2ec50958527b775845d4c94737765572d34a345c3d307e04032b51` |
| `kalsa_q48_x/b_r2_tombstone.txt.meta` | 37 | `79f0de0e0c96a5ab9e6be1d6516b636359bcdfb711a3c20b43122ef3e2666734` |
| `kalsa_q48_x/b_survival.txt` | 21 | `4e277bdf9375a83a153dedaf17fd50449eaafa39a0e0aedc76bcbf3eeefa886e` |
| `kalsa_q48_x/b_tg_errcounts.txt` | 122 | `4bbc080b457e15eb5d13dcae67e6654214f3d559e94a108b39875e965f761792` |
| `kalsa_q48_x/b_tg_rc.txt` | 2 | `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` |
| `kalsa_q48_x/b_tg_stderr.txt` | 20488874 | `a20f5266e3963b823a5253f84e424fd672aee55ddc315fffa7baa576e0078f42` |
| `kalsa_q48_x/b_tg_stdout.jsonl` | 936 | `d282a4fa2c12fc30d12d31af07ccbb114c5adf30b2d29f43cf85d2463d5e6b12` |
| `kalsa_q48_x/b_tg_stdout_from_stderr.jsonl` | 936 | `d282a4fa2c12fc30d12d31af07ccbb114c5adf30b2d29f43cf85d2463d5e6b12` |
| `kalsa_q48_x/b_tg_tombstone.txt` | 799438 | `b44283d40e2ec50958527b775845d4c94737765572d34a345c3d307e04032b51` |
| `kalsa_q48_x/b_tg_tombstone.txt.meta` | 37 | `79f0de0e0c96a5ab9e6be1d6516b636359bcdfb711a3c20b43122ef3e2666734` |
| `kalsa_q48_x/battery_a_post.txt` | 776 | `5435f7a235bb87a5a50670a0812a941484999eb17cf06336916fd8c1507a19e9` |
| `kalsa_q48_x/battery_a_pre.txt` | 776 | `5435f7a235bb87a5a50670a0812a941484999eb17cf06336916fd8c1507a19e9` |
| `kalsa_q48_x/battery_b_r1_post.txt` | 776 | `5435f7a235bb87a5a50670a0812a941484999eb17cf06336916fd8c1507a19e9` |
| `kalsa_q48_x/battery_b_r1_pre.txt` | 776 | `5435f7a235bb87a5a50670a0812a941484999eb17cf06336916fd8c1507a19e9` |
| `kalsa_q48_x/battery_b_r2_post.txt` | 775 | `894a2bdcdc5995e75a5ed7e53bc2c0631efa0d4e1999856820f19e6078ff323a` |
| `kalsa_q48_x/battery_b_r2_pre.txt` | 776 | `5435f7a235bb87a5a50670a0812a941484999eb17cf06336916fd8c1507a19e9` |
| `kalsa_q48_x/battery_b_tg_post.txt` | 775 | `894a2bdcdc5995e75a5ed7e53bc2c0631efa0d4e1999856820f19e6078ff323a` |
| `kalsa_q48_x/battery_b_tg_pre.txt` | 775 | `894a2bdcdc5995e75a5ed7e53bc2c0631efa0d4e1999856820f19e6078ff323a` |
| `kalsa_q48_x/battery_c_r1_post.txt` | 775 | `894a2bdcdc5995e75a5ed7e53bc2c0631efa0d4e1999856820f19e6078ff323a` |
| `kalsa_q48_x/battery_c_r1_pre.txt` | 775 | `894a2bdcdc5995e75a5ed7e53bc2c0631efa0d4e1999856820f19e6078ff323a` |
| `kalsa_q48_x/battery_c_r2_post.txt` | 776 | `075c286bacf7d9908c5c4d06d27dc732bae8816b96238b5f0ef393f9cf542744` |
| `kalsa_q48_x/battery_c_r2_pre.txt` | 775 | `894a2bdcdc5995e75a5ed7e53bc2c0631efa0d4e1999856820f19e6078ff323a` |
| `kalsa_q48_x/battery_gate.log` | 315 | `a4617809d64a13c24815e60f297623e43f11068f10319f3b18602e1b30faa773` |
| `kalsa_q48_x/battery_session_end.txt` | 776 | `075c286bacf7d9908c5c4d06d27dc732bae8816b96238b5f0ef393f9cf542744` |
| `kalsa_q48_x/battery_session_start.txt` | 776 | `5435f7a235bb87a5a50670a0812a941484999eb17cf06336916fd8c1507a19e9` |
| `kalsa_q48_x/binary_sha.txt` | 216 | `7c6badb8272d1664ef7dd132725584645e2d4321e82c6bf83fc121a584475bdf` |
| `kalsa_q48_x/c_r1_errcounts.txt` | 122 | `ea21330e12374e1e507ad0562767a2f99640bad7b63f9bd437725766d827f917` |
| `kalsa_q48_x/c_r1_rc.txt` | 2 | `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` |
| `kalsa_q48_x/c_r1_stderr.txt` | 2372 | `4ee16ee0dc67210449a31d05b29c4bea67e63d485c90791527cb1e7522f5693c` |
| `kalsa_q48_x/c_r1_stdout.jsonl` | 1873 | `2ca23939ac107193d71375a1da34aa4c730ef35b1ad036d9644c660e576d2300` |
| `kalsa_q48_x/c_r1_stdout_from_stderr.jsonl` | 1873 | `2ca23939ac107193d71375a1da34aa4c730ef35b1ad036d9644c660e576d2300` |
| `kalsa_q48_x/c_r2_errcounts.txt` | 122 | `6e3b06fa2df0bb82db9435bf14e6eb911fa2357bc819bd72c1f04461e3232cd6` |
| `kalsa_q48_x/c_r2_rc.txt` | 2 | `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` |
| `kalsa_q48_x/c_r2_stderr.txt` | 2372 | `eedfc258ed0eeadb72cdc8016852f082c47a990842575451b4da8408816ccd93` |
| `kalsa_q48_x/c_r2_stdout.jsonl` | 1873 | `232826d878831a0b97b5a003cf386108f0b0ff8fc43acfbd8cd3b5db413f38d8` |
| `kalsa_q48_x/c_r2_stdout_from_stderr.jsonl` | 1873 | `232826d878831a0b97b5a003cf386108f0b0ff8fc43acfbd8cd3b5db413f38d8` |
| `kalsa_q48_x/charge_a_post.txt` | 238 | `ff941c8391ff2ecb01e64921f4e0b1024b601de98ce7bfd185800ea754508bf8` |
| `kalsa_q48_x/charge_a_pre.txt` | 237 | `84a98bc6528df44ac45bd332b92b8c2127c05eb71ac00bc29b42abe10d27ca8b` |
| `kalsa_q48_x/charge_b_r1_post.txt` | 241 | `279cb54400450c7d66dd9b0578b74e2dcf0c10a99573fb0395e3ad12a769a8fd` |
| `kalsa_q48_x/charge_b_r1_pre.txt` | 240 | `aa97a446aab0923002fdc760b7e65bdac36fc8ef52c5d1305dd952547ab0740d` |
| `kalsa_q48_x/charge_b_r2_post.txt` | 241 | `833de0cfa403511b0feef2c735e6c37d7258a10beeba7c30dceef395f4271035` |
| `kalsa_q48_x/charge_b_r2_pre.txt` | 240 | `5921359c60fdc3899c86f0772b6fabd93297ad674ce538ad92c31c845d8da443` |
| `kalsa_q48_x/charge_b_tg_post.txt` | 241 | `1635760f99cf8ee797440b3288bdef367fd4ad71b68ffb4ad9cbe8d6d1f82643` |
| `kalsa_q48_x/charge_b_tg_pre.txt` | 240 | `4df1edd7c230ebb553fef2cf08bdb7afe34e2c6cb3f42413cf3fa11a9baa35fe` |
| `kalsa_q48_x/charge_c_r1_post.txt` | 241 | `9d503cc8f9066de09bc6a832bd3ced5d2de79a22afd0f02619e3126b94d92f51` |
| `kalsa_q48_x/charge_c_r1_pre.txt` | 240 | `2f9a86e8ebcc464c540f15ac07affb0baa8e68503e247b13479c709d545e2fd2` |
| `kalsa_q48_x/charge_c_r2_post.txt` | 241 | `43aaba105361fbbbc88f2e9b02f95da7db6ba1f7c999caaa60ef58571cacbf2a` |
| `kalsa_q48_x/charge_c_r2_pre.txt` | 240 | `ca0012e36745dd826b7f4a7f887b0053f736216c6d261de04733f0fb73a15df5` |
| `kalsa_q48_x/device.txt` | 6 | `c78edf5990e72b6c0aae3c464ea4550dde90fa017aa679ad07428276230dbaf8` |
| `kalsa_q48_x/df.txt` | 100 | `bccc9f3b4a3ab728ddb818f132f8e1fb63ebfdf945f500788451d7e029edb660` |
| `kalsa_q48_x/driver.log` | 1485 | `ab2b0d3157bfb87b258605bc98046e28a9ed361de60a039a09436e2f469ec28a` |
| `kalsa_q48_x/driver.out` | 1485 | `ab2b0d3157bfb87b258605bc98046e28a9ed361de60a039a09436e2f469ec28a` |
| `kalsa_q48_x/driver.pid` | 5 | `741e24afd1632d837b665d599454f3d747cc7485f128d2f3cf5d8ea88118e057` |
| `kalsa_q48_x/driver.sh` | 11306 | `7d099c4097394408fee9384246058020b062275a078a1de464fbc88cbf2450b4` |
| `kalsa_q48_x/header_a.txt` | 834 | `767cf18d1c202d718c13b99f8fa9bd126aea4d460012c76073283add51cc25ed` |
| `kalsa_q48_x/header_b_r1.txt` | 825 | `5792cbf4eb2f12996b0f829f2bc7517025732df2d40afbdcaf77b922773a3d8f` |
| `kalsa_q48_x/header_b_r2.txt` | 825 | `1c576743f730b386d4ef83a4d2e61ebb5c2af1dc2085792ff4988d9c982b978b` |
| `kalsa_q48_x/header_b_tg.txt` | 825 | `fd86bd6e77656bbb0037dd9c55c223841934b976e799acc4a312dd327df5b7bb` |
| `kalsa_q48_x/header_c_r1.txt` | 825 | `31be26dd40380515120741831e5ce95770f25c7c312af13cda833ba49b44d342` |
| `kalsa_q48_x/header_c_r2.txt` | 825 | `34e94e514e9b948ab710955ebc595dee29ab1aff780b7f0f2443e1348d67f155` |
| `kalsa_q48_x/header_session.txt` | 828 | `5c51d5a3df56fc73c0e6c78e36f8b8f325edd9a15feeb965314f0394ed6a40e6` |
| `kalsa_q48_x/HEARTBEAT` | 21 | `0a443b38b8feec5448092430dd159155a663e7286cdf52c6f51f8d0bf020828c` |
| `kalsa_q48_x/launch.sh` | 271 | `6a416f7e7d8a221c21e5718b0e57d05e909c0b2664832446dc7fb7bcd77eb3ac` |
| `kalsa_q48_x/model_sha.txt` | 87 | `d694825f6dae667edca963b569f1782dba215ca97070e9311374de9e2126b648` |
| `kalsa_q48_x/setsid.pid` | 5 | `741e24afd1632d837b665d599454f3d747cc7485f128d2f3cf5d8ea88118e057` |
| `kalsa_q48_x/STATUS` | 40 | `14dea7986a39843dcbe620998e5920ccdd153de200ca67ef6f62def2ac3acb0e` |
| `kalsa_q48_x/t_session_end.txt` | 21 | `3573213a684bd3f07adf73d0973da6001ddc92a0fe403521f99c78cd7ad3089c` |
| `kalsa_q48_x/tombstones_ls.txt` | 505 | `26d510c84c94d389cf942c24a80638d02caf5b4eb7f1853082eaea452a46ddc4` |
