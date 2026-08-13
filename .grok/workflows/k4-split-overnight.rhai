let meta = #{
    name: "k4-split-overnight",
    description: "K4 residency kernel: GPU trunk + CPU streamed experts, both A and B plus auto, hostile audit each phase",
    when_to_use: "Overnight CalaQwen split: place trunk on Adreno, keep experts on CPU/mmap, wire -ngl into bmoe-cli",
    phases: [
        #{ title: "Recon", detail: "trace placement, session, dense, hook, build" },
        #{ title: "Audit recon", detail: "hostile check of traces" },
        #{ title: "Design", detail: "residency ISA: A + B + auto" },
        #{ title: "Audit design", detail: "hostile design review" },
        #{ title: "Implement", detail: "one kernel, three policies" },
        #{ title: "Audit impl", detail: "hostile code review" },
        #{ title: "Fix", detail: "repair confirmed findings" },
        #{ title: "Final audit", detail: "three hostile angles" },
        #{ title: "Fix final", detail: "last repair pass" },
        #{ title: "Build", detail: "PC + Android OpenCL out of tree" },
        #{ title: "Pack", detail: "STATUS, morning harness, report stub" },
    ],
};

let ROOT = "C:/Users/gualt/Desktop/Kalsa/moe-experiments";
let MANDATE = ROOT + "/mandates/k4-split-overnight.md";
let OUT = ROOT + "/results/k4split";

fn common_law() {
    let s = "";
    s += "REPO: C:/Users/gualt/Desktop/Kalsa/moe-experiments\n";
    s += "MANDATE: mandates/k4-split-overnight.md — read it before writing anything.\n";
    s += "THIS IS A RESIDENCY KERNEL, not an OpenCL shader. Do NOT write or edit ggml-opencl kernels, ";
    s += "FLASH_ATTN sources, or kernel_gemv_*. M1 already proved GEMV rewrites fail (NMSE + DRAM roof).\n";
    s += "INVARIANT: routed ffn_*_exps stay CPU/mmap so CPU mul_mat_id fires the expert-ready hook. ";
    s += "Trunk (GDN, attention, shared expert, router, dense) may go GPU via -ngl. Always -fa off on A7X.\n";
    s += "Do NOT update PLAN.md. Do NOT git push. Do NOT kill other PC jobs (MarcoKEXP PPL may be running). ";
    s += "Builds cap at -j4. Never write GGUFs. Do NOT touch Xiaomi or Jelly. Do NOT SSH the S23 tonight ";
    s += "(device tests are tomorrow morning). Device workspace later: ~/gdn_k2/k4split/.\n";
    s += "Commits: small, English, local only. llama.cpp patches only if parent-engine wiring is not enough; ";
    s += "if needed, branch kalsa/split-trunk-gpu from kalsa/opencl-q6k-dispatch-fix @ 04c5d362a.\n";
    s += "Write English in code/commits/docs. Keep diffs minimal. No placeholders. No drive-by refactors.\n";
    s += "Use read_file, grep, list_dir on the real tree. Do not answer from memory.\n";
    s
}

fn recon_prompt(focus, outfile) {
    let p = "";
    p += common_law();
    p += "TASK: N0 recon only. Read-only except you MUST write the markdown file: ";
    p += outfile;
    p += "\nFOCUS: ";
    p += focus;
    p += "\nRequired reading order: mandate; reports/moe-gdn-k0-op-inventory.md; ";
    p += "reports/moe-gdn-k21-parity.md; reports/moe-gdn-k22-fix.md; reports/moe-gdn-750.md; ";
    p += "reports/moe-mld-m1.md; BigMoeOnEdge/docs/moe-streaming.md if present.\n";
    p += "Then grep and read the actual source. Every claim needs file:line.\n";
    p += "Write: call chain, what already works, what is hardcoded shut, RAM/double-residency risk, ";
    p += "smallest surface to change, open questions. End with BLOCKERS if any.\n";
    p += "Create results/k4split/ if missing. Update results/k4split/STATUS.md with one dated line.\n";
    p
}

phase("Recon");
log("N0 recon: five parallel traces");

let recon_jobs = [];
recon_jobs.push(#{
    prompt: recon_prompt(
        "Mechanism A — ggml_opencl_supports_op for MUL_MAT and MUL_MAT_ID (Q2_K/Q3_K vs Q4_K/Q5_K/Q6_K). llama-model-loader.cpp weight_buft_supported / select_weight_buft dummy MUL_MAT_ID. What happens to expert tensors under -ngl 99. Can a non-CPU -ot force Q2_K onto OpenCL?",
        ROOT + "/results/k4split/recon_a_supports_op.md"),
    label: "recon-a",
    capability_mode: "read-write",
    agent_type: "explore",
});
recon_jobs.push(#{
    prompt: recon_prompt(
        "Mechanism B and parent engine — Session::open in BigMoeOnEdge/core/src/engine/session.cpp hardcodes n_gpu_layers=0. SessionConfig in session.h, RunConfig in config.h, CLI flags in BigMoeOnEdge/cli/main.cpp. Does tensor_buft_overrides exist on llama_model_params? How would --ngl / --moe-cpu-experts / --override-tensor / flash-attn-off flow from CLI to open().",
        ROOT + "/results/k4split/recon_b_session.md"),
    label: "recon-b",
    capability_mode: "read-write",
    agent_type: "explore",
});
recon_jobs.push(#{
    prompt: recon_prompt(
        "Dense weights and RAM — core/src/moe/dense_weights.cpp + dense_weights.h + DenseWeightsMode. Does GPU upload ever happen? After llama offload, is the host anon copy freed? Double residency of ~1.75 GiB dense + cache 2000 + KV c=4096 on 8GB S23. Existing cache_auto / cache_floor_mb. What anon-gpu should do (one DRAM copy).",
        ROOT + "/results/k4split/recon_dense_ram.md"),
    label: "recon-dense",
    capability_mode: "read-write",
    agent_type: "explore",
});
recon_jobs.push(#{
    prompt: recon_prompt(
        "Expert-ready hook — ggml_cpu_set_expert_ready_hook, CPU mul_mat_id in ggml-cpu.c, parent registration under --moe-stream --overlap in expert_stream_source.cpp (~1375). OpenCL MUL_MAT_ID never calls it. How to prove hook is alive at runtime (streaming stats). What would kill it.",
        ROOT + "/results/k4split/recon_hook.md"),
    label: "recon-hook",
    capability_mode: "read-write",
    agent_type: "explore",
});
recon_jobs.push(#{
    prompt: recon_prompt(
        "Build paths — BigMoeOnEdge/scripts/build-android.ps1 (GGML_OPENCL=OFF by design, do NOT flip the default). results/gdn_gpu_k2/BUILD_MANIFEST.md OpenCL llama-cli. scripts/build_bmoe_ndk.sh. How to out-of-tree build Android bmoe-cli WITH OpenCL + Adreno kernels AND keep the hook statically linked (no GGML_BACKEND_DL). PC build of bmoe-cli. SHA recording. -j4. Do not start a full build in this recon.",
        ROOT + "/results/k4split/recon_build.md"),
    label: "recon-build",
    capability_mode: "read-write",
    agent_type: "explore",
});

let recon = parallel(recon_jobs);
let recon_ok = 0;
for r in recon {
    if r != () && r.success { recon_ok += 1; }
}
log("recon slots ok: " + recon_ok.to_string() + "/5");

phase("Audit recon");
let audit_recon_p = "";
audit_recon_p += common_law();
audit_recon_p += "TASK: Hostile audit of N0 recon. Be hostile. Find everything wrong.\n";
audit_recon_p += "Read ALL of: results/k4split/recon_a_supports_op.md, recon_b_session.md, ";
audit_recon_p += "recon_dense_ram.md, recon_hook.md, recon_build.md. Then independently grep/read ";
audit_recon_p += "the cited file:line. Attack: wrong line cites, claims that contradict source, ";
audit_recon_p += "missed double-residency, hook bypass, supports_op vs -ot override, build flipping ";
audit_recon_p += "default OpenCL ON (that ships GPU into APK — forbidden), missed SessionConfig fields.\n";
audit_recon_p += "Write results/k4split/audit_recon.md with CONFIRMED / PLAUSIBLE / REFUTED items ";
audit_recon_p += "and a go/no-go for design. Update STATUS.md.\n";
let ar = agent(audit_recon_p, #{
    label: "audit-recon",
    capability_mode: "read-write",
    agent_type: "reviewer",
});
if (ar == () || !ar.success) { log("audit-recon failed open — design still runs"); }

phase("Design");
let design_p = "";
design_p += common_law();
design_p += "TASK: Write the residency-kernel design that implementers will follow exactly.\n";
design_p += "Read mandate + all recon_*.md + audit_recon.md + the real headers:\n";
design_p += "  BigMoeOnEdge/core/include/bmoe/session.h (SessionConfig — NO n_gpu_layers today)\n";
design_p += "  BigMoeOnEdge/core/include/bmoe/config.h (RunConfig, MoeStreamConfig, DenseWeightsMode)\n";
design_p += "  BigMoeOnEdge/cli/main.cpp flags\n";
design_p += "  session.cpp around n_gpu_layers=0\n";
design_p += "  dense_weights.cpp\n";
design_p += "ONE kernel, THREE policies (same binary, flags select the arm):\n";
design_p += "  A  --ngl 99 --moe-cpu-experts off   natural supports_op (Q2_K/Q3_K stay CPU)\n";
design_p += "  B  --ngl 99 --moe-cpu-experts on    force ffn_(up|down|gate)_exps (+ ch variants) to CPU via tensor_buft_overrides\n";
design_p += "  AUTO --ngl 99 --moe-cpu-experts auto  if moe.enabled then B else A; plus RAM policy\n";
design_p += "Also: --dense-weights anon-gpu = Anonymous host copy THEN after GPU offload release host dense ";
design_p += "(madvise DONTNEED / free) so DRAM holds ONE copy. Never free expert mmap.\n";
design_p += "RAM: compose with existing cache_auto / cache_floor_mb. If GPU trunk + dense + cache + KV ";
design_p += "would leave MemFree < 300 MiB, AUTO must refuse GPU or require anon-gpu and log the decision. ";
design_p += "Fail closed, never silent double residency.\n";
design_p += "Wire --ngl (int, default 0) and --flash-attn off|on (default off) through RunConfig -> SessionConfig -> ";
design_p += "llama_model_params.n_gpu_layers and context flash-attn. Default remains CPU-only so campaign configs stay valid.\n";
design_p += "Prefer parent engine only. llama.cpp patch only if you prove Session cannot express B.\n";
design_p += "Do NOT flip build-android.ps1 GGML_OPENCL default. New out-of-tree dir build-android-opencl-k4split/.\n";
design_p += "Write results/k4split/N0_DESIGN_NOTES.md: ISA, file:line surfaces, flag table, RAM table, ";
design_p += "test matrix A/B/AUTO, kill-gates, what not to touch. Update STATUS.md.\n";
let des = agent(design_p, #{
    label: "design",
    capability_mode: "read-write",
    agent_type: "architect",
});
if (des == () || !des.success) { log("design agent failed — implementer must still read recon and invent minimally"); }

phase("Audit design");
let audit_des_p = "";
audit_des_p += common_law();
audit_des_p += "TASK: Hostile audit of N0_DESIGN_NOTES.md. Be hostile.\n";
audit_des_p += "Read the design and the headers it cites. Attack: over-engineering, two code paths that should be one, ";
audit_des_p += "kernel work sneaking in, default behavior change that breaks campaign CPU, APK OpenCL flip, ";
audit_des_p += "hook not preserved, RAM estimator fantasy numbers, missing SessionConfig field, ";
audit_des_p += "anon-gpu freeing expert buffers, flash-attn default on, GGML_BACKEND_DL killing the hook.\n";
audit_des_p += "Write results/k4split/audit_design.md CONFIRMED/PLAUSIBLE/REFUTED. If CONFIRMED issues exist, ";
audit_des_p += "append a 'BINDING CORRECTIONS' section that implementers must obey. Update STATUS.md.\n";
let ad = agent(audit_des_p, #{
    label: "audit-design",
    capability_mode: "read-write",
    agent_type: "reviewer",
});
if (ad == () || !ad.success) { log("audit-design failed open"); }

phase("Implement");
let impl_p = "";
impl_p += common_law();
impl_p += "TASK: Implement the residency kernel per results/k4split/N0_DESIGN_NOTES.md and ";
impl_p += "BINDING CORRECTIONS in audit_design.md. If those files are thin, implement the minimum below.\n";
impl_p += "MINIMUM WIRING:\n";
impl_p += "1. RunConfig + SessionConfig + session_config_from: n_gpu_layers (default 0), flash_attn (default false), ";
impl_p += "   moe_cpu_experts enum Off/On/Auto (default Auto when documenting; CLI default Auto only if moe-stream else Off), ";
impl_p += "   DenseWeightsMode add AnonGpu or equivalent without breaking mmap|warm|anon|ahwb.\n";
impl_p += "2. CLI BigMoeOnEdge/cli/main.cpp: --ngl N, --flash-attn off|on, --moe-cpu-experts off|on|auto, ";
impl_p += "   --override-tensor extra regex (optional), --dense-weights accepts anon-gpu. Help text. ";
impl_p += "   Existing campaign flags unchanged.\n";
impl_p += "3. Session::open: stop hardcoding n_gpu_layers=0; set from config. Build llama_model_params.tensor_buft_overrides ";
impl_p += "   for B/Auto. Context flash attn off unless asked. Log placement decisions.\n";
impl_p += "4. anon-gpu: after successful GPU offload of dense, release host anon dense only. Experts stay mmap. ";
impl_p += "   If n_gpu_layers==0, anon-gpu behaves as anon and logs it.\n";
impl_p += "5. RAM guard at open when n_gpu_layers>0: estimate and refuse or fall back per design. Never crash the phone later.\n";
impl_p += "6. Tests if the engine already has unit tests for config/validate — extend them. No new giant framework.\n";
impl_p += "7. Do not modify ggml-opencl kernels. Do not change build-android.ps1 OpenCL default.\n";
impl_p += "After code: write results/k4split/IMPL_NOTES.md (files touched, flags, how A/B/AUTO differ). ";
impl_p += "Update STATUS.md. Commit locally if the tree is clean enough — English message, no GGUF, no PLAN.md.\n";
impl_p += "Compile-check what you can on PC without saturating: prefer existing build-pc / BigMoeOnEdge build dir, -j4.\n";
let impl = agent(impl_p, #{
    label: "implement",
    capability_mode: "all",
    agent_type: "sonnet-coder",
});
if (impl == () || !impl.success) { log("implement failed — fix pass will try"); }

phase("Audit impl");
let audit_impl_p = "";
audit_impl_p += common_law();
audit_impl_p += "TASK: Hostile code review of the residency-kernel diff. Be hostile.\n";
audit_impl_p += "Read IMPL_NOTES.md, N0_DESIGN_NOTES.md, then git diff and every touched file.\n";
audit_impl_p += "Attack: correctness (n_gpu_layers still 0, overrides lifetime/dangling, hook dead), ";
audit_impl_p += "RAM (double residency, anon-gpu frees experts, MemFree guard missing), ";
audit_impl_p += "races (override array dies before llama_model_load), ";
audit_impl_p += "defaults changed (campaign CPU path broken), OpenCL shader edits, APK build flip, ";
audit_impl_p += "missing --help, flash-attn left auto, Auto != documented.\n";
audit_impl_p += "Write results/k4split/audit_impl.md with CONFIRMED findings only if you read the line. ";
audit_impl_p += "Update STATUS.md.\n";
let ai = agent(audit_impl_p, #{
    label: "audit-impl",
    capability_mode: "read-write",
    agent_type: "reviewer",
});
if (ai == () || !ai.success) { log("audit-impl failed open"); }

phase("Fix");
let fix_p = "";
fix_p += common_law();
fix_p += "TASK: Fix every CONFIRMED item in results/k4split/audit_impl.md. ";
fix_p += "If the file is missing, re-read the diff yourself and fix the obvious residency bugs: ";
fix_p += "dangling tensor_buft_overrides, n_gpu_layers still hardcoded, anon-gpu freeing experts, ";
fix_p += "default ngl!=0, flash-attn on.\n";
fix_p += "Do not add features. Update IMPL_NOTES.md and STATUS.md. Commit if appropriate.\n";
let fx = agent(fix_p, #{
    label: "fix",
    capability_mode: "all",
    agent_type: "sonnet-coder",
});
if (fx == () || !fx.success) { log("fix failed"); }

phase("Final audit");
log("triple hostile audit");
let final_jobs = [];
let a1 = "";
a1 += common_law();
a1 += "ANGLE: hook liveness + expert placement. Read the shipped code after the fix. ";
a1 += "Can any path put routed experts on OpenCL MUL_MAT_ID under --moe-stream? ";
a1 += "Does the hook still register? Dangling overrides? Write results/k4split/audit_final_hook.md ";
a1 += "CONFIRMED/PLAUSIBLE/REFUTED. Be hostile.\n";
final_jobs.push(#{
    prompt: a1,
    label: "final-hook",
    capability_mode: "read-write",
    agent_type: "reviewer",
});
let a2 = "";
a2 += common_law();
a2 += "ANGLE: RAM / double residency / RescueParty. Read dense_weights + Session::open. ";
a2 += "Is there a path where dense lives twice in DRAM with ngl>0 and anon? Does anon-gpu actually release? ";
a2 += "Is the 300 MiB floor real code or a comment? Write results/k4split/audit_final_ram.md. Be hostile.\n";
final_jobs.push(#{
    prompt: a2,
    label: "final-ram",
    capability_mode: "read-write",
    agent_type: "reviewer",
});
let a3 = "";
a3 += common_law();
a3 += "ANGLE: product defaults + build + flags. Campaign command without --ngl must behave as today. ";
a3 += "build-android.ps1 must still be GGML_OPENCL=OFF. --help documents A/B/AUTO. No shader files touched. ";
a3 += "Write results/k4split/audit_final_product.md. Be hostile.\n";
final_jobs.push(#{
    prompt: a3,
    label: "final-product",
    capability_mode: "read-write",
    agent_type: "reviewer",
});
let finals = parallel(final_jobs);
let final_ok = 0;
for r in finals {
    if r != () && r.success { final_ok += 1; }
}
log("final audit ok: " + final_ok.to_string() + "/3");

phase("Fix final");
let fix2_p = "";
fix2_p += common_law();
fix2_p += "TASK: Read audit_final_hook.md, audit_final_ram.md, audit_final_product.md. ";
fix2_p += "Fix CONFIRMED items only. If none, write results/k4split/NO_FINAL_FIXES.txt saying so with evidence. ";
fix2_p += "Update STATUS.md. Commit if you changed code.\n";
let fx2 = agent(fix2_p, #{
    label: "fix-final",
    capability_mode: "all",
    agent_type: "sonnet-coder",
});
if (fx2 == () || !fx2.success) { log("fix-final failed"); }

phase("Build");
let build_p = "";
build_p += common_law();
build_p += "TASK: Produce binaries and a BUILD_MANIFEST. Do not start device work.\n";
build_p += "1. Confirm MarcoKEXP/other heavy jobs: do not kill them. Use -j4 only.\n";
build_p += "2. PC: build bmoe-cli from BigMoeOnEdge with existing Windows/PC recipe if present ";
build_p += "(search scripts/, build-pc/, BigMoeOnEdge build dirs). Record sha256.\n";
build_p += "3. Android: NEW out-of-tree dir C:/Users/gualt/Desktop/Kalsa/moe-experiments/build-android-opencl-k4split/ ";
build_p += "Do NOT reuse build-android/ and do NOT edit build-android.ps1 defaults.\n";
build_p += "OpenCL ON + GGML_OPENCL_USE_ADRENO_KERNELS=ON following results/gdn_gpu_k2/BUILD_MANIFEST.md ";
build_p += "AND parent engine so the binary is bmoe-cli (hook stays statically linked). ";
build_p += "If a full parent+OpenCL Android build is blocked, build llama-cli OpenCL as fallback AND ";
build_p += "document that hook+ngl do not compose in that binary — then still try parent+OpenCL.\n";
build_p += "NDK r27b, android-29, arm64-v8a, OpenCL headers/lib in deps/opencl-android/. HOST_CXX if needed.\n";
build_p += "4. Write results/k4split/BUILD_MANIFEST.md (cmake line, sha256, sizes, what failed).\n";
build_p += "5. Copy binaries to results/k4split/bin/ if they exist. Update STATUS.md.\n";
let bld = agent(build_p, #{
    label: "build",
    capability_mode: "all",
    agent_type: "sonnet-coder",
});
if (bld == () || !bld.success) { log("build failed — pack still writes morning harness"); }

phase("Pack");
let pack_p = "";
pack_p += common_law();
pack_p += "TASK: Close the night for a human morning test. No SSH.\n";
pack_p += "Write:\n";
pack_p += "1. results/k4split/STATUS.md — current milestone (expect N0 done or BLOCKED_ARCH/partial), ";
pack_p += "   what landed, sha of binaries, open CONFIRMED bugs.\n";
pack_p += "2. results/k4split/MORNING.md — exact commands for three arms on S23 once 4B marathon is dead:\n";
pack_p += "   ARM_A:  --moe-stream ...campaign... --ngl 99 --flash-attn off --moe-cpu-experts off\n";
pack_p += "   ARM_B:  same --moe-cpu-experts on\n";
pack_p += "   ARM_AUTO: same --moe-cpu-experts auto --dense-weights anon-gpu\n";
pack_p += "   Campaign k6d065: -t 4 -c 4096 --moe-stream --cache-mb 2000 --dense-weights anon ";
pack_p += "(or anon-gpu on AUTO) --overlap --io-threads 4 --ubatch 512 --n-expert-used 6 --drop-cold-experts 0.65\n";
pack_p += "   Device: ssh -p 8022 -i %USERPROFILE%/.ssh/moe_s23 u0_a344@192.168.1.152\n";
pack_p += "   Workspace ~/gdn_k2/k4split/. Wait pgrep llama-cli. MemFree abort <300 MiB. ";
pack_p += "   Correctness may be plugged. Speed UNPLUGGED batt>=45. Push path + sha check for KEXP ac44e20c.\n";
pack_p += "3. results/k4split/run_n1_n2.sh or .ps1 helper that only documents/pushes — do not run it.\n";
pack_p += "4. reports/moe-k4-split.md stub: design as-built, empty N1-N4 tables, caveats.\n";
pack_p += "Do not update PLAN.md. Do not push.\n";
let pack = agent(pack_p, #{
    label: "pack",
    capability_mode: "read-write",
    agent_type: "sonnet-coder",
});
if (pack == () || !pack.success) { log("pack failed"); }

let report = "";
report += "# K4-split overnight workflow result\n\n";
report += "Residency kernel (not an OpenCL shader). Arms A / B / AUTO implemented in one binary if N0 succeeded.\n";
report += "Device tests are NOT in this run. Read results/k4split/STATUS.md and MORNING.md.\n";
report += "recon_ok=" + recon_ok.to_string() + " final_audit_ok=" + final_ok.to_string() + "\n";
let path = write_scratch_file("report.md", report);
complete(#{
    path: path,
    recon_ok: recon_ok,
    final_audit_ok: final_ok,
    out_dir: "results/k4split",
});
