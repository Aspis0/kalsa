# S23 plugged smoke-test — preparation reconnaissance

Role: EXPLORER. Read-only. Nothing was installed, uninstalled, written to the phone, or changed on
either device. No energy number was taken, and no benchmark was run. The Jelly Star was not touched
(it only appears in `adb devices -l`). No file outside this report was written.

Device under reconnaissance: Galaxy S23, `adb -s adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp`
(the `-s` serial is used on every adb call below so the Jelly is never selected).

Trees read, with the revision I read them at:

| label | path | revision |
|---|---|---|
| APP | `/Users/marco/Projects/kalsa` | branch `main`, HEAD `e5788cfee46dd76dacd6893913d6c5f67b6ec762` (2026-09-21 11:22) |
| BINDING | `/Users/marco/Projects/llama.rn-kalsa` | branch `main`, HEAD `0288dc27` |
| BINDING (installed dep) | `/Users/marco/Projects/kalsa/node_modules/llama.rn` | version `0.13.0-rc.4`; **DIVERGENT** from the lockfile pin (see §1.2) |
| ENGINE | `/Users/marco/Projects/kalsallama` | branch `main`, HEAD `5c96b18ddca8c4adefce920f811232be4836f327`, **with uncommitted working-tree changes** to the OpenCL cache and `ggml-opencl.cpp` (see §4) |
| LAB | `/Users/marco/Projects/kalsa-moe-experiments` | `main` |

Prior documents this one leans on, not re-derives:

- `analysis/GOVERNOR-DEVICE-PLAN.md` (Part 3.2 S23 row, Part 5 defects, Part 9 order of work).
- `scratchpad/agents/governor-gpu-recon/REPORT.md` §4 (GPU path, `exit(1)` sites).
- `scratchpad/agents/handover-2026-09-21/RECON.md` §3 (the two APK triples, the 5.1/5.2/5.3 commits).

---

## 1. What is on the phone now

### 1.1 The installed app — MEASURED WITH ADB

```
adb -s adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp shell getprop ro.product.model      -> SM-S911U
adb -s … getprop ro.build.version.release                                              -> 16
adb -s … getprop ro.build.version.sdk                                                  -> 36
adb -s … getprop ro.build.display.id                                                   -> BP2A.250605.031.A3.S911USQS6EYL1
adb -s … getprop ro.soc.model / ro.soc.manufacturer / ro.board.platform                -> SM8550 / QTI / kalama
adb -s … shell pm path com.kalsa.app
  -> package:/data/app/~~eMAkzuW04ohgNfbN86NRPw==/com.kalsa.app-RAjSesyC1pwND9K3Wk0x5g==/base.apk
adb -s … shell sha256sum <that path>
  -> 245c514c32f46acc8b04a9ceb5576d9507a64b614f6b8aa1b314f95bbbcfff3c
adb -s … shell ls -l <that path>          -> 159214430 bytes, mtime 2026-09-20 21:52
adb -s … shell dumpsys package com.kalsa.app
  -> versionCode=1  versionName=0.1.0  primaryCpuAbi=arm64-v8a
  -> lastUpdateTime=2026-09-20 21:52:10   firstInstallTime=2026-08-15 20:52:25
  -> flags=[ DEBUGGABLE HAS_CODE ALLOW_CLEAR_USER_DATA ]
```

The app is not running (`pidof com.kalsa.app` empty). The APK carries the full arm64 JNI variant set,
including `lib/arm64-v8a/librnllama_jni_v8_2_dotprod_i8mm_hexagon_opencl.so` (772 584 bytes) and
`librnllama_v8_2_dotprod_i8mm_hexagon_opencl.so` (13 615 440 bytes), plus the Hexagon assets
`assets/ggml-hexagon/libggml-htp-v73.so` … `v81.so`.

Its embedded engine build id, read from `assets/app.config` inside the APK
(`extra.engineBuildId`, the content hash `scripts/engine-build-id.js` mints):

```
kalsa-eng-v2:0d5c42479bfdfeb3207fc43a25484e5d046e389511a577fd889a008981d9c6b3
```

`generationFor()` maps the SoC to **`V73`** for this phone (`src/engine/governorInputs.ts:62-75`,
regex `SM8550|KALAMA|…`). This matters twice in §3.

### 1.2 The hash maps to one local artifact, and that artifact is recorded

`245c514c…` is byte-identical to `/Users/marco/kalsa-local-artifacts/POLICY-OLD-pulled.apk`
(same size, same `shasum -a 256`). The installed base.apk *is* that pulled copy.

The mapping hash → source is recorded in two places, not in a machine-readable manifest:

- `scratchpad/agents/handover-2026-09-21/RECON.md` §3 names both APK triples explicitly.
- `/Users/marco/kalsa-local-artifacts/MORNING-QUEUE.md:180-183` names the installed "policy APK"
  and forbids restoring it.
- The build conditions are in `/Users/marco/Projects/kalsa/local-artifacts/.build-s23-repack.sh`
  (the only local release-build script found; it is the script a rebuild would invoke).

**Triple for the installed APK** — app commit READ IN THE CODE (`git show 964dd53:package.json:49`),
binding pin READ IN THE CODE, engine commit READ IN THE CODE
(`git show 0f313bab:vendor/VERSIONS:8`):

| artifact | sha256 | app commit | binding pin | engine commit |
|---|---|---|---|---|
| `POLICY-OLD-pulled.apk` = **installed** | `245c514c32f46acc8b04a9ceb5576d9507a64b614f6b8aa1b314f95bbbcfff3c` | `964dd53` | `llama.rn#0f313bab` | `8537d097c` |
| `s23-repack-timing-app-release.apk` | `d56abe5f87cd352ad2e4f826203d1060be3fa8aa93e07c6a950606f51f3f1342` | `6a58ef5` (**recorded**; the build script says "containing `964dd53`") | `kalsa.rn#0288dc27` | `4ccef2f85` |

The engine commit column is the **pinned** commit (from the binding's `vendor/VERSIONS`), not a value
read out of the `.so`: no git commit string is embedded in the engine binaries (verified — `strings`
finds neither `8537d097c`, `4ccef2f85`, `2a290390d` nor `b11010` in either `…_hexagon_opencl.so`).
What the binaries *do* carry is the content-derived `kalsa-eng-v2:…` id, and those differ between the
two APKs (`0d5c4247…` vs `abadd943…`), which proves the two engines are different builds but does not
name the commits. The NEW APK's exact app commit is **UNVERIFIED**: the build script comments
"containing `964dd53`" while the recon of the same worktree recorded HEAD `6a58ef5`; both are before
the governor fixes, which is all §2 needs.

**One trap, MEASURED:** the installed dependency does not match the lockfile.
`scripts/assert-engine-provenance.sh` on the current checkout prints
`DIVERGENT: the installed engine is not Aspis0/kalsa.rn@0288dc278691` (first differing path
`./lib/commonjs/version.js`, 16 entries). `node_modules/llama.rn/vendor/VERSIONS` pins engine
`8537d097c`, while the lockfile pin `0288dc27` vendors `4ccef2f85`. The working tree's own engine id
is `kalsa-eng-v2:56c40cf7…`, matching neither APK. So "build from HEAD" today would bundle whatever
`node_modules` holds, not what `package.json` says — a rebuild must restore or re-install the dep
first, and then re-run the provenance assert.

### 1.3 Every APK on this Mac

Found with `find /Users/marco -maxdepth 6 -iname '*.apk'` (excluding `node_modules`, `Library`,
`.hexagon-sdk`): **42 APKs — 41 Kalsa app builds plus the one competitor APK** listed at the end of
the table. The app-commit column is the 40-hex token in the artifact path (the CI naming convention
`kalsa-apk-arm64-v8a-debuggable-<app-commit>`); "not in path" means the directory is a CI run id and
the app commit is not encoded there. `KALSA_GOVERNOR_FAILED` was searched inside each APK's
`assets/index.android.bundle`.

| file | sha256 | engineBuildId | KALSA_GOVERNOR_FAILED | app commit (from path) |
|---|---|---|---|---|
| `kalsa-apk-gpu/kalsa-apk-arm64-v8a-debuggable-6a0a7a07d4b6ed435c9b24cc69c0181b414be1d1/app-release.apk` | `3f0311cb77450f179a92104c9ef8a32009d3d0933820fde280cf72c0483bab92` | `—` | 0 | `6a0a7a07d4b6ed435c9b24cc69c0181b414be1d1` |
| `kalsa-apk-gpu2/kalsa-apk-arm64-v8a-debuggable-1df593b03219419d59ccc4ca2fff7becf17dc6bc/app-release.apk` | `61d7313a3114e6583627c0f0a1e49e0f3b46faacff66c3911566c0caad3358c7` | `—` | 0 | `1df593b03219419d59ccc4ca2fff7becf17dc6bc` |
| `kalsa-apk-jelly/kalsa-apk-arm64-v8a-debuggable-fb941ef91a4c2c5e56b149ad03c63e3cbf1ca66c/app-release.apk` | `e70745307c22c2b41889b49588a70a7b80bf70d410632ac490091b2c13e6eebf` | `—` | 0 | `fb941ef91a4c2c5e56b149ad03c63e3cbf1ca66c` |
| `kalsa-apk-kexp/kalsa-apk-arm64-v8a-debuggable-f9375ecb28a5d616baef940170e7cd16900d3892/app-release.apk` | `f12a3be7305bce4e8614aa1782d7c55975b410eb02933c9cbcbac53aa81ea53c` | `—` | 0 | `f9375ecb28a5d616baef940170e7cd16900d3892` |
| `kalsa-apks/31c5489/kalsa-apk-arm64-v8a-31c5489791b727c387bc1dad88fb7a5e127c9eb6/app-release.apk` | `59cee4797de86f89e2d7d950681924db33425544487b9d4b94ff57dd6da6ca35` | `—` | 0 | `31c5489791b727c387bc1dad88fb7a5e127c9eb6` |
| `kalsa-apks/32254348018/kalsa-apk-arm64-v8a-debuggable-0378fe8289ac205591a52dad4191a4fd7446c9d9/app-release.apk` | `7942a79a5f12542a88735794777376fd450a6a2f4dec5c6acf454e74e83786d9` | `—` | 0 | `0378fe8289ac205591a52dad4191a4fd7446c9d9` |
| `kalsa-apks/32260408831/kalsa-apk-arm64-v8a-debuggable-7bba05ba23fff5765fc3e864a408969d5db8e92c/app-release.apk` | `3eb6ef9ceca443666b308b7906e14771bd391ed42cbe2d0efb1f27fcd0070dc7` | `—` | 0 | `7bba05ba23fff5765fc3e864a408969d5db8e92c` |
| `kalsa-apks/32913082455/kalsa-apk-arm64-v8a-debuggable-7c8cce71641c6f929677f0b6ae2fa6bac2577acb/app-release.apk` | `5519a11b3aa99e37dd6e1a19e6c3da96b8ab428c2d21a4758cc1cc34fc624983` | `—` | 0 | `7c8cce71641c6f929677f0b6ae2fa6bac2577acb` |
| `kalsa-apks/34627488445/app-release.apk` | `60cfaede79f931536a910400f371fe88096e17e528173c30981b7fafb1111d59` | `kalsa-eng-v1:source:6cb561a17853705c84e4c6660abe536b1703dceea39805c33b70e51918d2b0b1` | 0 | `not in path` |
| `kalsa-apks/35418569854/app-release.apk` | `602a92824b3459e4aee335e66f6847b93548a76ed8399166d3d20c5919f5b857` | `kalsa-eng-v2:63b92e83ba6369602fd5c80118ca4a024a27de5f5e8fec9c3b12ed5c1ad4f665` | 0 | `not in path` |
| `kalsa-apks/35444615003/app-release.apk` | `ea6165eb66a85d01556c62b674a9f819636d5259bd195700d319bd1e1ba99298` | `kalsa-eng-v2:9ab4e848e0d57284dce5267013ab278b7628df39a18f43e12fec45042d289491` | 0 | `not in path` |
| `kalsa-apks/35463417214/kalsa-apk-arm64-v8a-debuggable-809d191c07a4fde14e2d3c1f204c628a772bf506/app-release.apk` | `7555bb1f583e61c6e720135311a4d3da44fe8043f20afd83997ef4068149cada` | `kalsa-eng-v2:9ab4e848e0d57284dce5267013ab278b7628df39a18f43e12fec45042d289491` | 0 | `809d191c07a4fde14e2d3c1f204c628a772bf506` |
| `kalsa-local-artifacts/POLICY-OLD-pulled.apk` | `245c514c32f46acc8b04a9ceb5576d9507a64b614f6b8aa1b314f95bbbcfff3c` | `kalsa-eng-v2:0d5c42479bfdfeb3207fc43a25484e5d046e389511a577fd889a008981d9c6b3` | 0 | `not in path` |
| `kalsa-local-artifacts/s23-repack-timing-app-release.apk` | `d56abe5f87cd352ad2e4f826203d1060be3fa8aa93e07c6a950606f51f3f1342` | `kalsa-eng-v2:abadd943e56bf4f6eaac7c3652b7fe4d1fe142e2ea818aba4f009cf5e5b57e98` | 0 | `not in path` |
| `kalsa-qdc/apk-f32ab/armA/kalsa-apk-arm64-v8a-debuggable-8269aa244141e42c1ce8c5a603ab0ee47f8c0cef/app-release.apk` | `8bbd449117b4948603a0ae6ce6806e919cdf6abdf4f938a5a80159e54a84b34e` | `—` | 0 | `8269aa244141e42c1ce8c5a603ab0ee47f8c0cef` |
| `kalsa-qdc/apk-f32ab/armB/kalsa-apk-arm64-v8a-debuggable-6fc14d17b54ea287746244fe5f27a56eca37985d/app-release.apk` | `f6876534c0987b2f270d65a33c9f58426d6d72c72a8a47bd4af9d1ac62ce0b64` | `—` | 0 | `6fc14d17b54ea287746244fe5f27a56eca37985d` |
| `kalsa-qdc/apk/apk-A-c513f00/app-release.apk` | `e0d56a398bbd1cb102dbab635272b7b88c43b22e6cd8896538c313603b774403` | `—` | 0 | `not in path` |
| `kalsa-qdc/apk/apk-A-debug-c513f00/app-release.apk` | `c645f691a9d16a896415a25d90bd3e179c7d9743c9bcdbde17603017112b0adc` | `—` | 0 | `not in path` |
| `kalsa-qdc/apk/apk-A-debug-c513f00/kalsa-apk-arm64-v8a-debuggable-c513f00fbb463f34449f24b5834178a3fe57682b/app-release.apk` | `c645f691a9d16a896415a25d90bd3e179c7d9743c9bcdbde17603017112b0adc` | `—` | 0 | `c513f00fbb463f34449f24b5834178a3fe57682b` |
| `kalsa-qdc/apk/apk-B-09bdfe9/kalsa-apk-arm64-v8a-09bdfe949403db7cd793da9471c5a78c50d62966/app-release.apk` | `1e2709e57561e97149664ea30588b7df9141c25a6813642cdda1c3ddf9d7f86d` | `—` | 0 | `09bdfe949403db7cd793da9471c5a78c50d62966` |
| `kalsa-qdc/apk/apk-B-debug-09bdfe9/app-release.apk` | `1b8e2793a63d182a1fe422a50519e246d8d4d4e4ce510ed2660c6cbbf8370a46` | `—` | 0 | `not in path` |
| `kalsa-qdc/apk/apk-B-debug-09bdfe9/kalsa-apk-arm64-v8a-debuggable-09bdfe949403db7cd793da9471c5a78c50d62966/app-release.apk` | `1b8e2793a63d182a1fe422a50519e246d8d4d4e4ce510ed2660c6cbbf8370a46` | `—` | 0 | `09bdfe949403db7cd793da9471c5a78c50d62966` |
| `kalsa-qdc/apk/apk-fault-5243755/kalsa-apk-arm64-v8a-debuggable-5243755a3d86994844975fdd8ddcc743588c52a3/app-release.apk` | `3da1fc303dadbb7ac13e0edab403c01d0a3565f3e45afa724cab660df94df6d2` | `—` | 0 | `5243755a3d86994844975fdd8ddcc743588c52a3` |
| `kalsa-qdc/apk/apk-fault-aa4ddf2/kalsa-apk-arm64-v8a-debuggable-aa4ddf2360af342b9617ae7c1ea5b2144616c479/app-release.apk` | `68ddef99c470f6b55b80622a0d7ad7a7a720b56b7c36970b9a6609f93849bdcf` | `—` | 0 | `aa4ddf2360af342b9617ae7c1ea5b2144616c479` |
| `kalsa-qdc/apk/apk-fault-ca3b1b3/kalsa-apk-arm64-v8a-debuggable-ca3b1b37bdf1e375a8abfdd9352702728e552cc7/app-release.apk` | `b6c24011781f0c21bc92636e9ff10e781c43b57449cd74aa1ef5a7ff82dbba18` | `—` | 0 | `ca3b1b37bdf1e375a8abfdd9352702728e552cc7` |
| `kalsa-qdc/apk/apk-fault-e54f529/kalsa-apk-arm64-v8a-debuggable-e54f529c966474e5b0d8b28311e497a6efc8b958/app-release.apk` | `17850b2121b4ff917e519e7e2f3c16b5b0547f4dce7048bc2ff10176a2079fb5` | `—` | 0 | `e54f529c966474e5b0d8b28311e497a6efc8b958` |
| `kalsa-qdc/apk/apk-gov-0265333/kalsa-apk-arm64-v8a-debuggable-0265333681a2070cdfb92ad27a0cdc19e38d7473/app-release.apk` | `38d6321008fe2bc9db320a2955c70876cde87302ef05294d81ee0b3f7672b35b` | `—` | 0 | `0265333681a2070cdfb92ad27a0cdc19e38d7473` |
| `kalsa-qdc/apk/apk-gov-19b67b6/kalsa-apk-arm64-v8a-debuggable-19b67b6e43e99247376916afefe2edae0be93647/app-release.apk` | `c6d24bbd8b7243df7a3dab3d04be261980791d1da92b26310bd27227692afbe7` | `—` | 0 | `19b67b6e43e99247376916afefe2edae0be93647` |
| `kalsa-qdc/apk/apk-gov-28424c3/kalsa-apk-arm64-v8a-debuggable-28424c30f1e6d656b69d52c7414cc59e5d97cc3c/app-release.apk` | `b2cc96757425bcfef56ad4a2014b8f120b764abd25ea7889f543bd65928bdde5` | `—` | 0 | `28424c30f1e6d656b69d52c7414cc59e5d97cc3c` |
| `kalsa-qdc/apk/apk-gov-7e3d6d6/kalsa-apk-arm64-v8a-debuggable-7e3d6d61ef48a2a85e15b1193b051fbf64f65e41/app-release.apk` | `4ae5bf637056d8cbfb75ef258a168c8f72940a15d5a572aa624ca057baea569c` | `—` | 0 | `7e3d6d61ef48a2a85e15b1193b051fbf64f65e41` |
| `kalsa-qdc/apk/apk-gov-8269aa2/kalsa-apk-arm64-v8a-debuggable-8269aa244141e42c1ce8c5a603ab0ee47f8c0cef/app-release.apk` | `8bbd449117b4948603a0ae6ce6806e919cdf6abdf4f938a5a80159e54a84b34e` | `—` | 0 | `8269aa244141e42c1ce8c5a603ab0ee47f8c0cef` |
| `kalsa-qdc/apk/apk-gov-8a56edc/kalsa-apk-arm64-v8a-debuggable-8a56edc8926e388f27ceb575afd86024d35d3057/app-release.apk` | `272f4547b097b0738f278e14fad50da0478b5533504d82e7eaefba99caf59946` | `—` | 0 | `8a56edc8926e388f27ceb575afd86024d35d3057` |
| `kalsa-qdc/apk/apk-gov-8b6d548/kalsa-apk-arm64-v8a-debuggable-8b6d548dfa393fdbe9e6fee8445b3924bb1e7153/app-release.apk` | `9200f23647a0adfc8e63255d23c677ac4f0944a1698377e10660091f511db4bd` | `—` | 0 | `8b6d548dfa393fdbe9e6fee8445b3924bb1e7153` |
| `kalsa-qdc/apk/apk-gov-ac4820d/kalsa-apk-arm64-v8a-debuggable-ac4820d48e60e1d540e15939bf5333a7d6745e2e/app-release.apk` | `1a1356ac1f15c3362d45d7a9a16c1c79789d52130f5b44b1b50ad28371e2e2bc` | `—` | 0 | `ac4820d48e60e1d540e15939bf5333a7d6745e2e` |
| `kalsa-qdc/apk/apk-gov-c5c55a4/kalsa-apk-arm64-v8a-debuggable-c5c55a4897f96398c707987e65afce97274e08d9/app-release.apk` | `12ecb73145ca3ea161c9a259424926523b085caa8b51d683ec6abd0f46c33284` | `—` | 0 | `c5c55a4897f96398c707987e65afce97274e08d9` |
| `kalsa-qdc/apk/apk-gov-c8d137e/kalsa-apk-arm64-v8a-debuggable-c8d137ed4fbc0203322308b602bb825517bcc583/app-release.apk` | `14f48561bf7838bcdac841d49f0c3ccf434c8969cec21e993b7d78e4239b43eb` | `—` | 0 | `c8d137ed4fbc0203322308b602bb825517bcc583` |
| `kalsa-qdc/apk/apk-gov-db1606c/kalsa-apk-arm64-v8a-debuggable-db1606ceb75fdbadf6577573e4fa1a2c75e3e545/app-release.apk` | `dd77516ac3d8a2508985fad9b3e2a1e2c85a5ddfc7dc3f3fdca0d2b4703f2b6a` | `—` | 0 | `db1606ceb75fdbadf6577573e4fa1a2c75e3e545` |
| `kalsa-qdc/apk/apk-gov-e8c2b1f/kalsa-apk-arm64-v8a-debuggable-e8c2b1f7b4dea2960457b32477ba2111cdf2fef7/app-release.apk` | `e16cf0b6fd8fbd77c6566de03150c13ed93cacd7bc21c42ad4df56dd21c08eaf` | `—` | 0 | `e8c2b1f7b4dea2960457b32477ba2111cdf2fef7` |
| `kalsa-qdc/apk/apk-moe-5d8b2eb/kalsa-apk-arm64-v8a-5d8b2eb998cc1f3d62c1da526fa6741f65c31296/app-release.apk` | `6eba835a3ef63c088f552302cffef14d2686cf47495552022d525c4629b847e9` | `—` | 0 | `5d8b2eb998cc1f3d62c1da526fa6741f65c31296` |
| `kalsa-qdc/apks/dl-0b75254/kalsa-apk-arm64-v8a-debuggable-0b752540a1bb27a8de5a3558206157f3df7d7814/app-release.apk` | `ccf25b782c6461bf6532e57d3e391fe1c634b3229b4dfc68260b476b8ea5b705` | `—` | 0 | `0b752540a1bb27a8de5a3558206157f3df7d7814` |
| `kalsa-qdc/apks/dl-3ca6145/kalsa-apk-arm64-v8a-debuggable-3ca6145bf180d0b827ec1de08fb8875ce02361fb/app-release.apk` | `10bc57d4314fe878ac12c17b95acb33cf012658e26608ee7f7ed824a1c6a1583` | `—` | 0 | `3ca6145bf180d0b827ec1de08fb8875ce02361fb` |
| `kalsa-qdc/competitors/gallery/ai-edge-gallery-1.0.19-universal.apk` | `9bd1c7402876c61b5d0fe9b51dbfdac21985b48711346e9501b1d132c31d0175` | `—` | 0 | `not in path` |

(The last row is not a Kalsa build: it is the ai-edge-gallery competitor APK, kept for reference.)

**The decisive scan: every one of the 41 Kalsa APKs returns `0` for `KALSA_GOVERNOR_FAILED` inside
its JS bundle.** That marker exists only in `src/engine/LlamaService.ts:1788` at/after commit
`e5788cf`, so *no APK on this Mac was built from a commit carrying the app-side half of defect 5.2*.
The inventory splits into:

- **39 campaign/CI builds** (`kalsa-apks/*`, `kalsa-qdc/*`, `kalsa-apk-*`) from the pre-`vendor/`
  and early-`vendor/` lines, all older than the fix commits;
- **2 recent artifacts**, both in `/Users/marco/kalsa-local-artifacts/`: the one installed on the S23
  (`POLICY-OLD-pulled.apk`, engine `8537d097c`) and `s23-repack-timing-app-release.apk`
  (engine `4ccef2f85`).

So the set of APKs installable without a build that contains the governor fixes is **empty**.

---

## 2. Does the installed build carry the governor fixes 5.1 / 5.2 / 5.3?

**No. Not one of the three, neither engine-side nor app-side.** Plainly: the phone is running the
pre-fix policy, and there is no local artifact that is not.

### 2.1 Engine commits — READ IN THE CODE

```
cd ~/Projects/kalsallama
git merge-base --is-ancestor 2b1ee43ab 4ccef2f85   -> NO   (5.3 route by requested engine)
git merge-base --is-ancestor f2073505e 4ccef2f85   -> NO   (5.1 pause instead of CPU fallback)
git merge-base --is-ancestor 61db879b8 4ccef2f85   -> NO   (5.2 clear latched baseline on unplug)
                                         8537d097c   -> NO for all three
git merge-base --is-ancestor  <each>   HEAD(5c96b18) -> YES for all three
```

The three fix commits sit **on top of** `2a290390d`; the newest engine pinned by any binding is
`4ccef2f85`, which is *below* them (`8537d097c .. 61db879b8` is 21 commits). The engine `main` HEAD
`5c96b18` does contain all three, but **no binding commit pins it**: `git branch -a` in
`~/Projects/llama.rn-kalsa` shows `main` at `0288dc27` with `vendor/VERSIONS` = `4ccef2f85`, and no
branch pins `2a290390d`/`2b1ee43ab`/`f2073505e`/`61db879b8`.

### 2.2 App-side half of 5.2 — MEASURED inside the APKs

```
unzip -p POLICY-OLD-pulled.apk            assets/index.android.bundle | grep -c KALSA_GOVERNOR_FAILED -> 0
unzip -p POLICY-OLD-pulled.apk            assets/index.android.bundle | grep -c failure_reason       -> 0
unzip -p POLICY-OLD-pulled.apk            assets/index.android.bundle | grep -c t_idle_tenths_c      -> 0
# same three counts are 0 for s23-repack-timing-app-release.apk, and for all 41 APKs
```

At the installed commit `964dd53`: `native/GovernorBatteryModule.kt` has **no** `idleBaselineTenthsC`
latch (the class field and the plug-in-edge latch were added in `e5788cf`, `git diff --stat 964dd53
e5788cf -- '*GovernorBattery*'` = 47 insertions), and `src/engine/governorInputs.ts:166-167` defaults
`idleValid = Boolean(input.t_idle_valid)` → `false`, `idle = numberValue(input.t_idle_c, 0)` → `0`.
`KALSA_GOVERNOR_FAILED` and the `failure_reason` field in `KALSA_GOVERNOR` are absent
(`git show 964dd53:src/engine/LlamaService.ts | grep` finds neither). The installed build therefore
has the *exact* defect the owner's plugged phase-1 run is meant to exercise: plug the cable and the
profile is invalid, the parser throws, and the app silently retries CPU-only — with no
`KALSA_GOVERNOR_FAILED` to say so.

### 2.3 Cheapest honest path to a build that carries them

**No local artifact already has them; a build is required.** The mapping a coder needs (I do not
design or perform the fix):

1. The **app fix is already at HEAD** (`e5788cf`, `~/Projects/kalsa` `main`).
2. A build pinning engine `4ccef2f85` is *not enough*: the engine half (and 5.1/5.3) is missing.
   The binding must pin an engine commit at/after `61db879b8` (engine `main` HEAD `5c96b18` has it),
   and the installed `node_modules/llama.rn` must be refreshed/re-installed to that pin — it is
   currently DIVERGENT (§1.2), so a build run now would bundle neither the intended pin nor the fix.
3. The script that builds this locally is
   `/Users/marco/Projects/kalsa/local-artifacts/.build-s23-repack.sh` (arm64-v8a only, release made
   `debuggable true` because the bench chain needs `run-as`; Hexagon SDK forced off to match CI).
   The alternative is the CI workflow `.github/workflows/apk.yml` (manual `workflow_dispatch`).
4. **It still will not engage on the S23** — see §3.4. Both the V73 table entry and the
   `gpuFit` 8 GiB gate refuse this phone before defect 5.2 is even reached. Phase 1's plugged run
   will exercise 5.2 only if the governor can attach at all, and on this device it cannot without a
   further change that is outside this reconnaissance.

---

## 3. The activation path

### 3.1 The on/off switch

READ IN THE CODE (`src/engine/governorRuntime.ts`):

- `export const GOVERNOR_ENABLED_KEY = "kalsa.governor.enabled";` — line 3.
- `readGovernorEnabled()` — line 15. Returns `true` only for the stored string `"1"` or `"true"`
  (case-insensitive); any error → `false`.
- `writeGovernorEnabled(enabled)` — line 25. Writes `"1"`/`"0"`; never throws, returns whether the
  write landed.

The Settings UI:

- import at `src/screens/SettingsScreen.tsx:60`;
- state `governorEnabled` at `:256`; read on mount at `:457-459`;
- `handleToggleGovernor` at `:497-503` (optimistic write + rollback if the write failed);
- the `<Switch>` at `:2639-2645`, labels `t("settings.governor")` / `t("settings.governorBody")`
  (`src/i18n/en.ts` / `it.ts`).

The switch is the only user-facing control. There is no other writer of the key in `src/`.

### 3.2 What else must hold before the load path uses the governor

READ IN THE CODE (`src/engine/LlamaService.ts:2250-2338`):

```
const governorFeatureEnabled = await readGovernorEnabled();          // :2250
const governorThermo = governorFeatureEnabled ? await readGovernorThermo() : null;   // :2311
const governorBase   = governorFeatureEnabled && pricedModel != null
  ? buildGovernorParams(pricedModel, deviceProfile, {…}, benchGovernorForce) : null; // :2314
const governorLoad =
  governorBase != null &&
  governorBase.enabled &&
  governorThermo != null &&
  governorThermo.sensor_valid &&
  governorBase.gpu_fit !== "NoFit" &&
  !options.mmprojPath &&
  !streamExperts
    ? { ...governorBase, enabled: true, thermo: nativeGovernorThermo(governorThermo) }
    : null;                                                          // :2326-2338
```

`buildGovernorParams` (`src/engine/governorInputs.ts:123-144`) supplies:

- `enabled = force || GPU_PREFILL_CORRECT[generation]` (`:130`). `GPU_PREFILL_CORRECT` is
  `{ V79: true, V75: true, V73: false, Unknown: false }` (`:14-27`). **The S23 is `V73` → enabled is
  false unless forced.**
- `force` comes from the bench key `kalsa.bench.governor_force` (`BENCH_GOVERNOR_FORCE_KEY`, `:10`,
  read at `:146-152`), i.e. `kalsa.bench.governor_force = "1"`.
- `gpu_fit` from `gpuFit()` (`:84-121`).

If the governor is disabled or refused, `params.n_gpu_layers` is forced to `0` twice
(`LlamaService.ts:2421` and `:2442`), so the GPU is not used at all on the non-governor path.
`emitGovernorTelemetry` emits its `KALSA_GOVERNOR` line only when `activeGovernorAttempted` is true
(`:1752`, set at `:2652 = governorFeatureEnabled && governorBase != null && governorBase.enabled`).

### 3.3 The S23 is refused twice, and the second refusal is not bypassable

**Refusal 1 — the V73 table.** `generationFor()` maps `SM8550`/`kalama` to `V73`
(`governorInputs.ts:62-75`), and `GPU_PREFILL_CORRECT[V73] = false` (`:25`). Bypassable with
`kalsa.bench.governor_force = "1"`.

**Refusal 2 — the 8 GiB RAM gate.** `gpuFit()` returns `NoFit` when
`total <= EIGHT_GIB` (`EIGHT_GIB = 8 * 1024 * MiB = 8 589 934 592`; `governorInputs.ts:8`, `:92`).
`total` is `profile.totalMemoryBytes ?? memory.totalMemoryBytes`, and both are
`Device.totalMemory` from expo-device. MEASURED WITH ADB + READ IN THE CODE:

```
adb -s … shell dumpsys meminfo | grep "Total RAM"   -> Total RAM: 7,243,748K
adb -s … shell grep MemTotal /proc/meminfo          -> MemTotal: 7243748 kB   (= 7,417,597,952 B)
node_modules/expo-device/android/.../DeviceModule.kt:65-68
  Constant("totalMemory") { ActivityManager.MemoryInfo().totalMem }
src/engine/governorInputs.test.ts:170-174
  buildGovernorParams(model, device("SM8650", 8 * 1024 ** 3), …).gpu_fit -> "NoFit"
```

7 417 597 952 B (= 6.91 GiB) is below the 8 GiB floor, so **`gpu_fit` is `NoFit` on this S23
regardless of the bench force flag**, and `governorLoad` is `null`. The 12 GiB devices
(`QRD8650`, 12 GiB → `Fit`, test `:183-190`) are the only ones the gate was written for. This is
why the plan's Part 3.2 sentence "governor off by table (`V73: false`), not by measurement" is
incomplete: on this phone it is also off by the RAM gate, which no key turns off. **UNVERIFIED on
device**: the exact value expo-device hands `gpuFit` on this phone (I did not launch the app);
"Total RAM" is exactly the field `DeviceModule.kt` reads, so the inference is deterministic.

### 3.4 Every logcat marker around activation and engagement

App-side, all via `console.log`/`console.warn` (logcat tag `ReactNativeJS`):

| marker | exact shape | file:line | when |
|---|---|---|---|
| `KALSA_GOVERNOR` | `{"engine_prefill","engine_decode","commit_bytes","commit_ms","prefill_ms","prefill_chunks","prefill_ctx_ngl","forced","thermal_state","thermo_source","fit","fallback_reason","failed","failure_reason"}` | `LlamaService.ts:1764-1784` | once per completed turn, only if `activeGovernorAttempted` |
| `KALSA_GOVERNOR_FAILED` | `{"reason","thermal_state"}` | `LlamaService.ts:1788` | when `stats.failure_reason` is set — **not present before `e5788cf`** |
| `KALSA_GOVERNOR_THERMO` | `{"valid":false,"source"}` | `LlamaService.ts:1731,1741` | `setGovernorThermo` reported `false` |
| `KALSA_GOVERNOR_FALLBACK` | `{"stage":"correctness","reason","forced"}` | `LlamaService.ts:2362` | `governorBase != null && !governorBase.enabled` (i.e. V73 without force) |
| `KALSA_GOVERNOR_FALLBACK_RETRY` | `{"ok":true}` / `{"ok":false}` | `governorRuntime.ts:74,77` | after a native governor-load failure, when the CPU retry is attempted |
| `KALSA_NATIVE_VARIANT` | `{"androidLib":…,"nGpuLayers":{"prefill":99,"decode":0}\|number}` | `LlamaService.ts:2565` | after a successful `initLlama` |
| `KALSA_GPU_FALLBACK` | `{"requestedGpuLayers","flashAttn"}` | `LlamaService.ts:2611` | android init failure with `n_gpu_layers > 0` (cannot catch `exit(1)`, §4) |

Native (binding), emitted by the engine wrapper (same strings in the installed `0f313bab` and in
`0288dc27`):

| marker | file:line (binding) |
|---|---|
| `KALSA_GOVERNOR_FALLBACK {stage:"%s", models_loaded:%d, reason:"%s", gpu_fit:%d, profile_valid:%d}` | `cpp/rn-llama.cpp:67`, `:663` |
| `KALSA_GOVERNOR_FALLBACK {stage:"accelerator_backend", … reason:"no accelerator backend" …}` | `cpp/jsi/RNLlamaJSI.cpp:680` |
| `KALSA_GOVERNOR_FALLBACK: governor load failed; see native log` | `cpp/jsi/RNLlamaJSI.cpp:777` |

The **engine itself emits no `KALSA_*` string** (`grep KALSA_ src/ tools/` in `~/Projects/kalsallama`
finds only `mtmd-cli.cpp:512` and `cli-context.cpp:32`). Its governor decisions surface as plain
`LLAMA_LOG_WARN/INFO/ERROR` lines (`llama-governor-runtime.cpp:56,71,82,126,130,185,187`,
`llama-governor.cpp:61,87,93,108,154,216`), so a watcher must also capture the native/llama tag.

A single grep a watcher can run:

```
adb -s adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp logcat -v threadtime \
  | grep -E 'KALSA_GOVERNOR|KALSA_NATIVE_VARIANT|KALSA_GPU_FALLBACK|ggml_opencl: compiling|kernel cache'
```

and, to also catch the `exit(1)` prelude:

```
adb -s … logcat -v threadtime | grep -E 'ggml_opencl|OpenCL error|kernel compile error'
```

---

## 4. The GPU side on this device

Device facts, MEASURED WITH ADB: `ro.hardware.egl=adreno`; kgsl `gpu_model = Adreno740v20`;
`/vendor/lib64/libOpenCL.so` present (163 320 bytes, 2021-12-31); GPU max clock 719 000 000;
`gpubusy` currently `0 0`; `gpu_busy_percentage = 0 %`.

### 4.1 Which JNI variant must load

READ IN THE CODE: `app.config.js:93-99` requests `enableOpenCLAndHexagon: true`, so all arm64 JNI
variants are compiled and only `rnllama_jni_v8_2_dotprod_i8mm_hexagon_opencl` has OpenCL linked
(`governor-gpu-recon/REPORT.md` §4). `RNLlama.java:200-205` tries that variant first
(`tryLoadLibrary`), and `KALSA_NATIVE_VARIANT {"androidLib":…}` (`LlamaService.ts:2565`) reports which
one actually loaded. MEASURED: the installed APK contains
`lib/arm64-v8a/librnllama_jni_v8_2_dotprod_i8mm_hexagon_opencl.so` and
`librnllama_v8_2_dotprod_i8mm_hexagon_opencl.so`; the latter's `strings` contain
`ggml_opencl: compiling %s`, `ggml_opencl: kernel compile error (err=%d)%s%s:`, and the four
`kernel cache …` strings — so **the OpenCL backend is really compiled into the installed build**.

### 4.2 The kernel set is compiled on the phone, at runtime

READ IN THE CODE (ENGINE HEAD `5c96b18`): the first OpenCL buffer allocation calls
`cl_program_cache_init()` and then `load_cl_kernels()`
(`ggml/src/ggml-opencl/ggml-opencl.cpp:13975-13983`); `load_cl_kernels` (`:1508`) builds ~180 programs
through `build_program_from_source` (`:1397`), which calls `build_program_from_source_ex(…, fatal=true)`
(`:1349`). Device init only opens the queue and defers this (`:6896`, "delay kernel loading until the
first buffer is created"). Nothing in the app or binding sets `GGML_OPENCL_KERNEL_CACHE_DIR`
(grep of `src/`, `plugins/`, `app.config.js` is empty).

### 4.3 The two strings that say whether the on-disk program cache is on

READ IN THE CODE — `ggml/src/ggml-opencl/cl-program-cache.cpp` at ENGINE HEAD `5c96b18`:

| outcome | exact string | line |
|---|---|---|
| disabled by env | `ggml_opencl: kernel cache disabled by GGML_OPENCL_KERNEL_CACHE_DIR=%s` | `:315` |
| **disabled (Android default)** | `ggml_opencl: kernel cache disabled (no usable default cache directory)` | `:325` |
| disabled (mkdir failed) | `ggml_opencl: kernel cache disabled (cannot create directory '%s')` | `:333` |
| **enabled** | `ggml_opencl: kernel cache enabled at '%s'` | `:339` |
| enabled (debug) | `ggml_opencl: kernel cache enabled at '%s' (GGML_OPENCL_KERNEL_CACHE_DIR=off to disable)` | `:341` |

The recon (§4) names exactly these two outcomes and is confirmed here. On Android the expected line is
the **disabled** one at `:325`: `default_cache_dir()` (`:184-205`) falls through to
`fs::temp_directory_path(ec)` and returns `{}` when `TMPDIR` is unset, which the function's own
comment (`:211-213`) says is "e.g. Android app contexts with TMPDIR unset". Unless the app exports
`GGML_OPENCL_KERNEL_CACHE_DIR`, every session recompiles the whole kernel set.

**Working-tree drift, flagged:** `~/Projects/kalsallama` has **uncommitted** changes —
`cl-program-cache.cpp` +64, `cl-program-cache.h` +16, `ggml-opencl.cpp` +261 — which move those
strings to `cl-program-cache.cpp:330/340/348/354/356` and add a `compute_verdict_key`/verdict path.
Those changes are in the engine working tree only; the binding vendors its own `vendor/llama.cpp`
(engine `4ccef2f85` per `vendor/VERSIONS`), so a binding build does not include them unless they are
synced. Which tree a future APK uses is therefore a real question, not a detail.

### 4.4 `exit(1)`, and how a GPU failure looks today

READ IN THE CODE (ENGINE HEAD): the reachable `exit(1)` is `ggml-opencl.cpp:1364`
(`if (fatal) exit(1);`, compile failure in `build_program_from_source_ex`), plus `:1390`
(`clCreateProgramWithSource` failure). The other eight sites are unreachable in this app build
(`governor-gpu-recon/REPORT.md` §4). Before dying the engine logs
`ggml_opencl: kernel compile error (err=%d)%s%s:` with the driver build log (`:1386-1390`), or
`OpenCL error creating program` (`:1381`).

`exit(1)` is a **normal process exit, not a crash**: no tombstone, and it runs below any JS
`try/catch`. Therefore:

- the app process disappears mid-load; `KALSA_GPU_FALLBACK` (`LlamaService.ts:2611`) never fires
  because it is reached only when `initLlama` *throws*;
- there is no `KALSA_GOVERNOR` and no `KALSA_NATIVE_VARIANT` line for that attempt;
- the only evidence is the `ggml_opencl` error line followed by the process ending.

A silent refusal is different and is what the S23 will actually show (§3.3): the process survives,
`n_gpu_layers` is 0, and (with the force key) there may be **no** `KALSA_GOVERNOR_FALLBACK` line at
load at all, because that line is gated on `!governorBase.enabled` and the force flag makes
`enabled` true while `gpuFit` independently returns `NoFit`. The refusal then surfaces only in the
per-turn `KALSA_GOVERNOR` line as `fit:"NoFit"` and `fallback_reason:"governor not eligible"`.

---

## 5. The plugged smoke test, pre-registered

Phase 1 is a **functional** smoke test. **No energy number is taken with the cable in** (project
rule), and the trace key `kalsa.bench.energy_trace` stays **OFF/absent** — it is a phase-2
instrument (`src/engine/governorBatterySampler.ts:11`, `BENCH_ENERGY_TRACE_KEY`; and the Meter is the
open item in `handover-2026-09-21/RECON.md` §3). Reading level/temperature for the record is fine;
reading charge-counter/current for a number is not.

### 5.0 Device state at reconnaissance time (record these as the starting condition)

MEASURED WITH ADB: `AC powered: true`, `USB powered: false`, level 100, `temperature: 306`
(30.6 °C), `status: 5` (full), `Thermal Status: 0`, screen `mWakefulness=Dozing`,
`MemAvailable 3 284 932 kB`, swap used 1 530 124 kB of 4 194 300 kB. Background contaminant:
`adsprpcd` (pid 2251) accumulated **114 ticks over a 5 s window ≈ 23 % of one core**, `cdsprpcd`
(pid 2252) idle — the plan's Part 3.2 daemon background, present but not at the 100 % once recorded.
The app is not running; `kalsa.governor.enabled` is **absent** (reads false), `kalsa.bench.governor_force`
absent, `kalsa.bench.energy_trace` absent, `kalsa.bench.thermo` absent, `kalsa.model.id = qwen3.5-4b`.

**Model choice for the run:** use **LFM2.5-2.6B** (downloaded, 1 593 894 944 B, text-only). The current
model `qwen3.5-4b` has `files/models/qwen3.5-4b/mmproj-F16.gguf` present, and `mmprojPath` alone
refuses the governor (`LlamaService.ts:2331`, `!options.mmprojPath`).
**UI trap:** be *inside a conversation* before sending, or the send emits markers and no turn.

### 5.1 The test list, with exact commands

Pin the serial for every call (the Jelly is attached too):

```
export ANDROID_SERIAL='adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp'
export OUT=/tmp/s23-phase1-$(date +%s); mkdir -p "$OUT"
```

Keys are written with the repo's own helper (`sql_write` in `scripts/ci-lib.sh`, reached through
`scripts/device-env.sh`), **after `adb shell am force-stop com.kalsa.app`** — the helper enforces
that ordering. Raw SQL for the record:

```
INSERT OR REPLACE INTO catalystLocalStorage (key,value) VALUES ('kalsa.governor.enabled','0'|'1');
INSERT OR REPLACE INTO catalystLocalStorage (key,value) VALUES ('kalsa.bench.governor_force','1');
DELETE FROM catalystLocalStorage WHERE key IN ('kalsa.bench.thermo','kalsa.bench.energy_trace');
```

`kalsa.bench.thermo` must be deleted: `readGovernorThermo()` prefers it over the battery module
(`governorInputs.ts:190-200`), which would skip the battery path that phase 1 is testing.

**T0 — functional preflight (does not need the governor).**

```
OUT="$OUT/preflight" bash /Users/marco/Projects/kalsa/scripts/device-preflight.sh
# expect PASS lines: one attached non-emulator device; debuggable APK; database read path.
# USB powered: true produces only a WARNING here (scripts/device-preflight.sh:155-156).
```

Start the watcher before the turn:

```
adb -s "$ANDROID_SERIAL" logcat -v threadtime -c
( adb -s "$ANDROID_SERIAL" logcat -v threadtime | grep -E \
  'KALSA_GOVERNOR|KALSA_NATIVE_VARIANT|KALSA_GPU_FALLBACK|ggml_opencl|kernel (cache|compile)' \
  > "$OUT/logcat.txt" ) &
```

**T1 — governor OFF (baseline).** Keys: `enabled=0`, force deleted, thermo deleted, energy_trace
deleted. Launch app, open a chat, select LFM2.5-2.6B, send one short prompt.

Assertions:
- `KALSA_NATIVE_VARIANT` present with `nGpuLayers` 0 (no governor attempted);
- **no** `KALSA_GOVERNOR` line (`activeGovernorAttempted` false);
- `KALSA_TELEMETRY` completion and `KALSA_STALL` absent;
- `pidof com.kalsa.app` non-empty after the turn.

**T2 — governor ON, cable IN.** Keys: `enabled=1`, `governor_force=1`, thermo deleted,
energy_trace deleted; `AC powered` stays true.

Assertions, each with the marker that proves it:

| what | marker that proves it | what falsifies it |
|---|---|---|
| governor attempted | `KALSA_NATIVE_VARIANT` with `nGpuLayers:{prefill:99,decode:0}` | no such line → never attempted |
| **governor engaged** | `KALSA_GOVERNOR` with empty/absent `fallback_reason`, `engine_prefill=="GPU"`, `prefill_ctx_ngl==99`, `failed==false`, `failure_reason` null | `fallback_reason:"governor not eligible"` or `"governor: thermo profile invalid"`, or `KALSA_GOVERNOR_FALLBACK` |
| GPU path really used | engine-native log of the prefill on the 99-layer context; **external**: `cat /sys/class/kgsl/kgsl-3d0/gpubusy` leaving 0 *between* turns (global counter, never sampled during a turn) | `gpubusy` flat 0 while the app claims GPU |
| kernel set compiled | ≥1 `ggml_opencl: compiling <tag>` (cache disabled) or `kernel cache …` lines | `ggml_opencl: kernel compile error` / `OpenCL error creating program` |
| app survived | `pidof com.kalsa.app` non-empty after the turn + `KALSA_TELEMETRY` | process gone, no `KALSA_GOVERNOR`, logcat ends on a `ggml_opencl` error → the `exit(1)` path (§4.4) |
| silent refusal (no crash) | process alive, `KALSA_GOVERNOR` with `fit:"NoFit"` and `fallback_reason:"governor not eligible"`, `nGpuLayers` 0, **no** `KALSA_GOVERNOR_FALLBACK` at load | — |

**Pre-registered expectation for the S23 (do not dress the result up):** T2 will **not** show
engagement. `gpuFit` is `NoFit` (§3.3) for a 7.42 GB device, so `governorLoad` is null regardless of
`governor_force`. The honest phase-1 result is "the app loads and survives, and reports the refusal",
not "the governor activates".

### 5.2 What "attivazione" can and cannot be proven from logcat alone

**Can be proven:** that the app attempted the native governor load; that the native load returned
and on which context shape (`prefill:99`); whether the governor attached or refused and with which
reason; that the OpenCL kernel set compiled or hit a cache; that the process survived the turn.

**Cannot be proven:** that the GPU *executed* the prefill (`KALSA_GOVERNOR` is "the app talking about
itself" — the plan Part 6.1 ranks it the weakest evidence); that the tokens were correct; anything
about energy or sustained performance. The only external corroboration available is the global
`gpubusy` counter, and it can only be correlated by time, never attributed.

### 5.3 The preflight gates, and which of them forbid a plugged run

| gate | where | effect on a plugged run |
|---|---|---|
| functional preflight | `scripts/device-preflight.sh:145-156` | reads level / USB powered / temperature; **WARNING only** on `USB powered: true` — plugged run allowed |
| campaign charge gate | `scripts/campaign/run-t20c.sh:117` (`CAMPAIGN_MIN_BATTERY_LEVEL=85`), `:226-249` | **REFUSES**: "battery preflight refused: charging state unreadable or device is charging" |
| per-turn charge stamp | `scripts/campaign/oneTurn.sh:76-84` | does not abort, but records the timing as invalid while charging |
| thermal gate | `scripts/ci-lib.sh:23-38`, `device_thermal_gate` `:1362-1420` | pauses at Thermal Status ≥ 3 or battery ≥ 44.0 °C, resumes ≤ 1 / ≤ 39.0; no charge clause |
| ciswire harness | `scripts/device-ciswire-cache.sh:1985-1987` | **aborts**: "device is charging (plugged=true) … (project rule)" |
| energy sweep | `scripts/device-energy-sweep.sh:150,170,191` | **aborts** on charging |

So: the harnesses that produce *numbers* all forbid a plugged run, correctly. The functional
preflight does not. Phase 1 must therefore run `device-preflight.sh` plus a manual/short turn, and
must **not** invoke `run-t20c.sh`, `device-ciswire-cache.sh`, `device-energy-sweep.sh`,
`device-energy-trace.sh` or `device-decode-lineup.sh` (`:49` aborts on charging too).

---

## What I could NOT verify

- The exact app commit baked into `s23-repack-timing-app-release.apk` (`6a58ef5` recorded vs
  `964dd53` in the build-script comment). Both predate the fixes, so §2 is unaffected.
- The exact engine commit inside each APK: no commit string is embedded; only the content hash
  `kalsa-eng-v2:…` is. The commit column in §1.2 comes from the binding's `vendor/VERSIONS`.
- That `Device.totalMemory` on this phone equals `dumpsys meminfo` "Total RAM"
  (`7 243 748 K`). `DeviceModule.kt` reads exactly that field, so the inference is deterministic, but
  the app was not launched.
- Whether the engine working-tree OpenCL-cache changes (§4.3) are meant for this line of work; they
  are uncommitted in `~/Projects/kalsallama` and not vendored by any binding.
- No `KALSA_GOVERNOR` line from an S23 could be found on disk to confirm the `gpuFit` refusal
  empirically; the S23 governor has never been exercised in-app (plan Part 7).
