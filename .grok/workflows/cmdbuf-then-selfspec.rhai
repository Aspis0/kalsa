let meta = #{
    name: "cmdbuf-then-selfspec",
    description: "First cmdbuf recon (web+source, no device), then selfspec F0 acceptance on PC",
    when_to_use: "After K4 split failed: research cl_khr_command_buffer, then measure KEXP k=2 draft acceptance",
    phases: [
        #{ title: "Cmdbuf recon", detail: "driver, upstream, fork stream, fusion fallback" },
        #{ title: "Cmdbuf audit", detail: "hostile check of claims" },
        #{ title: "Cmdbuf report", detail: "reports/research-cmdbuf.md + verdict" },
        #{ title: "Selfspec wait", detail: "PC idle; no phones" },
        #{ title: "Selfspec run", detail: "target streams + draft acceptance" },
        #{ title: "Selfspec audit", detail: "hostile method/gate check" },
        #{ title: "Selfspec report", detail: "moe-selfspec-f0.md + DONE" },
    ],
};

let ROOT = "C:/Users/gualt/Desktop/Kalsa/moe-experiments";

fn law() {
    let s = "";
    s += "REPO: C:/Users/gualt/Desktop/Kalsa/moe-experiments\n";
    s += "K4 split on-device FAILED. These two mandates are the next lanes. Do not re-open GEMV kernels.\n";
    s += "NO PHONES. No SSH to S23/Xiaomi/Jelly. No PLAN.md edits. No git push. No GGUF writes.\n";
    s += "Do not kill MarcoKEXP/LFM/other PC jobs. Builds/runs -j4 max if you compile.\n";
    s += "Every factual claim needs URL or file:line. Never fabricate a number. Use tools, not memory.\n";
    s
}

phase("Cmdbuf recon");
log("cmdbuf recon: four parallel traces");

let q1 = "";
q1 += law();
q1 += "MANDATE: mandates/cmdbuf-recon.md question 1 ONLY.\n";
q1 += "Do Adreno drivers expose cl_khr_command_buffer or cl_qcom recordable queues? ";
q1 += "Specifically Adreno 740 driver 0676.73 / compiler E031.41 and Adreno 750 0762.36 / E031.45.\n";
q1 += "Search the web: Qualcomm OpenCL SDK, Adreno GPU developer guides, clinfo dumps, ";
q1 += "Khronos cl_khr_command_buffer and cl_khr_command_buffer_mutable_dispatch, ";
q1 += "qualcomm forum, github clinfo outputs mentioning Adreno.\n";
q1 += "Also grep our repo for command_buffer / clCreateCommandBuffer / CL_DEVICE_EXTENSIONS dumps ";
q1 += "in results/ (gdn_gpu_k2, gdn_gpu_750, mld_m1) and reports.\n";
q1 += "Write results/cmdbuf/recon_q1_driver.md with URLs, quoted extension strings, and a ";
q1 += "yes/no/unknown per 740 and 750. Unknown is allowed if you searched and found nothing — list queries.\n";
q1 += "Create results/cmdbuf/ if missing.\n";

let q2 = "";
q2 += law();
q2 += "MANDATE: mandates/cmdbuf-recon.md question 2 ONLY.\n";
q2 += "Upstream llama.cpp: PRs/issues/commits on command buffers or OpenCL dispatch-overhead reduction.\n";
q2 += "Web search GitHub ggml-org/llama.cpp: command_buffer, recordable, enqueue overhead, graph replay OpenCL, ";
q2 += "cl_khr_command_buffer, ggml_graph reuse OpenCL.\n";
q2 += "Also search our fork BigMoeOnEdge/third_party/llama.cpp/ggml/src/ggml-opencl for those strings.\n";
q2 += "Write results/cmdbuf/recon_q2_upstream.md: table of hits (URL, date, status, relevance). Empty table OK if none.\n";

let q3 = "";
q3 += law();
q3 += "MANDATE: mandates/cmdbuf-recon.md question 3 ONLY. Fork source, file:line required.\n";
q3 += "In BigMoeOnEdge/third_party/llama.cpp/ggml/src/ggml-opencl/ggml-opencl.cpp: is the per-token ";
q3 += "command stream stable across tokens (same kernels/args except buffer offsets / KV positions)?\n";
q3 += "Find set_arg / clSetKernelArg / clEnqueueNDRangeKernel sites that change per token ";
q3 += "(positions, masks, KV n_past, GDN state). Count typical launches per token if comments/logs exist.\n";
q3 += "Read reports/moe-gdn-k0-op-inventory.md and reports/moe-mld-m1.md for the ~1000 launches / 82 splits claim — ";
q3 += "cite where that number is measured vs estimated.\n";
q3 += "Does the code or any dumped clinfo mention cl_khr_command_buffer_mutable_dispatch?\n";
q3 += "Write results/cmdbuf/recon_q3_stream.md.\n";

let q4 = "";
q4 += law();
q4 += "MANDATE: mandates/cmdbuf-recon.md question 4 ONLY. Fallback if no driver command-buffer.\n";
q4 += "From reports/moe-gdn-k0-op-inventory.md count elementwise / glue ops per GDN hybrid layer. ";
q4 += "Estimate how many launches a realistic fuse of elementwise chains could remove.\n";
q4 += "From K4 reports (results/k4split/, reports/moe-k4-split.md if present) and M1: ";
q4 += "what if small glue ops stay CPU-side to cut graph splits? Honest ceiling, not a wish.\n";
q4 += "Write results/cmdbuf/recon_q4_fallback.md with a table: lever, launches saved (range), week-estimate, risk.\n";

let recon_jobs = [];
recon_jobs.push(#{ prompt: q1, label: "cmdbuf-q1", capability_mode: "all", agent_type: "general-purpose" });
recon_jobs.push(#{ prompt: q2, label: "cmdbuf-q2", capability_mode: "all", agent_type: "general-purpose" });
recon_jobs.push(#{ prompt: q3, label: "cmdbuf-q3", capability_mode: "read-write", agent_type: "explore" });
recon_jobs.push(#{ prompt: q4, label: "cmdbuf-q4", capability_mode: "read-write", agent_type: "explore" });
let recon = parallel(recon_jobs);
let recon_ok = 0;
for r in recon {
    if r != () && r.success { recon_ok += 1; }
}
log("cmdbuf recon ok: " + recon_ok.to_string() + "/4");

phase("Cmdbuf audit");
let audit_c = "";
audit_c += law();
audit_c += "Hostile audit of results/cmdbuf/recon_q1_driver.md q2 q3 q4. Be hostile.\n";
audit_c += "Independently open cited URLs/files. Mark each major claim CONFIRMED / PLAUSIBLE / REFUTED.\n";
audit_c += "Attack: treating missing clinfo as 'driver has it'; mixing 830/desktop Adreno with 740/750; ";
audit_c += "calling the 1000-launch figure measured if it was an estimate; claiming mutable_dispatch without the extension string.\n";
audit_c += "Write results/cmdbuf/audit_recon.md. Do not write the final verdict yet.\n";
let ac = agent(audit_c, #{ label: "cmdbuf-audit", capability_mode: "all", agent_type: "reviewer" });
if (ac == () || !ac.success) { log("cmdbuf audit failed open"); }

phase("Cmdbuf report");
let rep_c = "";
rep_c += law();
rep_c += "Write reports/research-cmdbuf.md answering all 5 mandate questions.\n";
rep_c += "Read recon_q*.md + audit_recon.md + mandates/cmdbuf-recon.md.\n";
rep_c += "VERDICT must be exactly one of: FEASIBLE(driver+scope) / FEASIBLE_PARTIAL(fusion only) / DEAD.\n";
rep_c += "Include: single best entry point, honest week-estimate, what is measured vs guessed, ";
rep_c += "and why this is or is not the answer to K4 dispatch overhead (60-150ms/token).\n";
rep_c += "End the report with a line: DONE\n";
rep_c += "Also write results/cmdbuf/STATUS.md one paragraph + verdict.\n";
let rc = agent(rep_c, #{ label: "cmdbuf-report", capability_mode: "read-write", agent_type: "sonnet-coder" });
if (rc == () || !rc.success) { log("cmdbuf report failed"); }

phase("Selfspec wait");
log("selfspec F0: wait for PC idle, then measure acceptance");
let wait_p = "";
wait_p += law();
wait_p += "MANDATE: mandates/selfspec-f0-acceptance.md — setup only, do not start the 300-token grid yet.\n";
wait_p += "1. Do NOT touch phones.\n";
wait_p += "2. Check PC jobs: Get-Process bmoe-cli, python run_multi5, marcokexp. If a PPL/quantize job ";
wait_p += "   owns the KEXP model or is using >4 cores on bmoe-cli, WAIT (poll up to several times). ";
wait_p += "   Do not kill them. If they are still busy after reasonable polls, write ";
wait_p += "   results/selfspec_f0/PC_BUSY.txt with pids and continue only if a second bmoe-cli can run ";
wait_p += "   without fighting the same GGUF (otherwise STOP and write BLOCKED_PC).\n";
wait_p += "3. Locate KEXP: C:/Users/gualt/Desktop/Kalsa/moe-experiments/models/Qwen3.6-35B-A3B-KEXP.gguf ";
wait_p += "   (sha ac44e20c…). Record sha256 if cheap, else size+path.\n";
wait_p += "4. Pick PC binary: prefer build-pc/cli/bmoe-cli.exe if not locked; else ";
wait_p += "   results/k4split/bin/bmoe-cli-pc.exe + its DLLs. Record sha.\n";
wait_p += "5. Read --help for session mode, --n-expert-used, --ppl-decode, logits dump. ";
wait_p += "   Write results/selfspec_f0/METHOD_PLAN.md: how you will teacher-force honestly ";
wait_p += "   (exact per-position preferred; windowed OK if cost explodes — label which). ";
wait_p += "   Prompts: results/marco_phase1/speed_s23/prompts/p_fact.txt and p_creative.txt ";
wait_p += "   PLUS two longer ones you write under results/selfspec_f0/prompts/.\n";
wait_p += "6. Create results/selfspec_f0/ and STATUS.txt = PLANNED.\n";
let wp = agent(wait_p, #{ label: "selfspec-wait", capability_mode: "all", agent_type: "sonnet-coder" });
if (wp == () || !wp.success) { log("selfspec wait/setup failed"); }

phase("Selfspec run");
let run_p = "";
run_p += law();
run_p += "MANDATE: mandates/selfspec-f0-acceptance.md — EXECUTE the measurement on PC only.\n";
run_p += "Read results/selfspec_f0/METHOD_PLAN.md and follow it. If missing, invent the cheapest honest method.\n";
run_p += "Binary + model from METHOD_PLAN / STATUS. Campaign flags:\n";
run_p += "  -t 8 (PC) -c 4096 --ubatch 512 --moe-stream --cache-mb 2000 --dense-weights anon ";
run_p += "  --overlap --io-threads 4 --n-expert-used K --drop-cold-experts D --flash-attn off --ngl 0\n";
run_p += "TARGET: K=6 D=0.65, greedy temp=0, N=300 tokens, 4+ prompts. Save token streams under ";
run_p += "results/selfspec_f0/streams/.\n";
run_p += "DRAFT: K=2 with drop 0.65 AND drop 0. For each position t, teacher-force target[0..t-1], ";
run_p += "see if draft greedy next == target[t]. Exact preferred. Windowed approximation allowed if ";
run_p += "cost explodes — MUST label window size in the CSV.\n";
run_p += "If k=2 pooled acceptance is clearly <50% early, still finish enough positions to draw a curve; ";
run_p += "then run k=3 on the same target streams.\n";
run_p += "Also measure PC draft speed: k=2 vs k=6 tok/s ratio on one prompt n=64 or n=128 (not a device number).\n";
run_p += "Write results/selfspec_f0/acceptance.csv (prompt, k_draft, drop, pos, accept 0/1) and ";
run_p += "results/selfspec_f0/summary.json (per-prompt and pooled rates, n positions).\n";
run_p += "Speedup model: E[tokens/step] = f(acceptance, gamma) for gamma 2..6. Combine with ";
run_p += "device speeds from the mandate (CPU k6 2.90 @cache1000 and 5.86 @cache2000; GPU-split k6 2.02) ";
run_p += "and the PC k2/k6 ratio (note device ratios will differ).\n";
run_p += "Gate: pooled acceptance >= 60% at gamma<=4. Write results/selfspec_f0/VERDICT.txt ";
run_p += "PASS_LANE_OPEN or SELFSPEC_DEAD.\n";
run_p += "STATUS.txt = RUNNING then DONE or BLOCKED_*. Do not fabricate tokens.\n";
let rp = agent(run_p, #{ label: "selfspec-run", capability_mode: "all", agent_type: "sonnet-coder" });
if (rp == () || !rp.success) { log("selfspec run failed"); }

phase("Selfspec audit");
let audit_s = "";
audit_s += law();
audit_s += "Hostile audit of the selfspec F0 method and numbers. Be hostile.\n";
audit_s += "Read METHOD_PLAN.md, streams/, acceptance.csv, summary.json, VERDICT.txt.\n";
audit_s += "Attack: free-run agreement sold as teacher-forcing; too few positions; prompts too similar; ";
audit_s += "pooling that hides a dead prompt; gamma math wrong; using PC tok/s as if it were S23; ";
audit_s += "gate PASS without >=60% pooled; invented CSV rows without matching streams.\n";
audit_s += "Independently recompute pooled acceptance from the CSV. Write results/selfspec_f0/audit.md ";
audit_s += "CONFIRMED/PLAUSIBLE/REFUTED. If the verdict is unjustified, say so.\n";
let as_ = agent(audit_s, #{ label: "selfspec-audit", capability_mode: "read-write", agent_type: "reviewer" });
if (as_ == () || !as_.success) { log("selfspec audit failed open"); }

phase("Selfspec report");
let rep_s = "";
rep_s += law();
rep_s += "Write reports/moe-selfspec-f0.md from streams + CSV + summary + audit + mandate.\n";
rep_s += "Include: method (exact vs windowed), per-prompt table, pooled rate, acceptance-vs-position, ";
rep_s += "k=3 if run, speedup model, gate verdict, epitaph if dead. End with DONE.\n";
rep_s += "If audit CONFIRMED that the run is invalid, do not claim PASS. Status honest.\n";
rep_s += "Update results/selfspec_f0/STATUS.txt.\n";
let rs = agent(rep_s, #{ label: "selfspec-report", capability_mode: "read-write", agent_type: "sonnet-coder" });
if (rs == () || !rs.success) { log("selfspec report failed"); }

let report = "";
report += "# cmdbuf-then-selfspec\n\n";
report += "Phase 1: reports/research-cmdbuf.md (cmdbuf recon).\n";
report += "Phase 2: reports/moe-selfspec-f0.md + results/selfspec_f0/ (acceptance gate).\n";
report += "cmdbuf_recon_ok=" + recon_ok.to_string() + "/4\n";
report += "No device work in this run.\n";
let path = write_scratch_file("report.md", report);
complete(#{
    path: path,
    cmdbuf_recon_ok: recon_ok,
    cmdbuf_report: "reports/research-cmdbuf.md",
    selfspec_report: "reports/moe-selfspec-f0.md",
});
