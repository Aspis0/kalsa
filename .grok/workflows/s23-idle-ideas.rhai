let meta = #{
    name: "s23-idle-ideas",
    description: "S23 unplugged fail-fast: typeahead prefill on KEXP + 2B GPU-prefill/CPU-decode ceiling",
    when_to_use: "S23 is idle and unplugged; selfspec queued on PC; test leftover physical ideas",
    phases: [
        #{ title: "Scripts", detail: "write on-device harnesses" },
        #{ title: "Audit scripts", detail: "hostile: RescueParty, plug, reuse lie" },
        #{ title: "Typeahead", detail: "KEXP session growing prefix" },
        #{ title: "Phase 2B", detail: "GPU pp vs CPU tg ceiling + thermal" },
        #{ title: "Audit numbers", detail: "hostile recompute" },
        #{ title: "Report", detail: "reports/moe-s23-idle-ideas.md" },
    ],
};

let ROOT = "C:/Users/gualt/Desktop/Kalsa/moe-experiments";

fn law() {
    let s = "";
    s += "REPO: C:/Users/gualt/Desktop/Kalsa/moe-experiments\n";
    s += "DEVICE: S23 ONLY ssh -p 8022 -i %USERPROFILE%/.ssh/moe_s23 u0_a344@192.168.1.152\n";
    s += "Do NOT touch Xiaomi 192.168.1.193 or Jelly 192.168.1.82.\n";
    s += "Do NOT kill PC jobs (LFM PPL, selfspec waiter). Do NOT update PLAN.md. No git push. No GGUFs.\n";
    s += "SPEED/thermal ONLY while UNPLUGGED (termux-battery-status plugged=UNPLUGGED), batt>=45%, battery temp<=45C.\n";
    s += "ABORT if MemFree < 300 MiB sustained or phone reboots. Workspace ~/gdn_k2/idle_ideas/.\n";
    s += "Never fabricate a number. Raw logs on disk. Use tools.\n";
    s += "K4 already CLOSED 35B GPU-prefill: prefill ~parity, TTFT 0.59x (moe-k4-split.md:311-326). Do NOT rerun 35B -ngl 99.\n";
    s
}

phase("Scripts");
let sc = "";
sc += law();
sc += "TASK: Write PC-side + device harnesses under results/s23_idle_ideas/. Do not SSH yet.\n";
sc += "1) results/s23_idle_ideas/run_typeahead.sh (pushed later) for campaign binary:\n";
sc += "   ~/src/BigMoeOnEdge/build-bmoe/cli/bmoe-cli.CAMPAIGN\n";
sc += "   -m ~/experiments/models/Qwen3.6-35B-A3B-KEXP.gguf\n";
sc += "   -t 4 -c 4096 --ubatch 512 --moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --n-expert-used 6 --drop-cold-experts 0.65 --session --no-think\n";
sc += "   Protocol: JSON lines to stdin. First request: prompt=chunk0, n_predict=1, clear_kv=true.\n";
sc += "   Then 5 times: prompt=prefix grown by ~400-600 ASCII chars (~100-150 tok), n_predict=1, clear_kv=false.\n";
sc += "   Last control: SAME full prompt, n_predict=1, clear_kv=true (full re-prefill).\n";
sc += "   Parse BMOE_DONE prefill_s / tokens / tok_s. Between steps: termux-battery-status + awk MemFree.\n";
sc += "   Abort if plugged or batt<45 or MemFree_kB<300000.\n";
sc += "   Grow text from results/marco_phase1/speed_s23/prompts/p_fact.txt plus extra English paragraphs baked into the script (byte-stable).\n";
sc += "2) results/s23_idle_ideas/run_phase2b.sh using OpenCL llama-cli that already passed 2B correctness.\n";
sc += "   Prefer ~/gdn_k2/k22b/llama-cli or ~/gdn_k2/bin_fix2/llama-cli — VERIFY on device later; script should try those paths.\n";
sc += "   Model: ~/models/Qwen3.5-2B-Q4_K_M.gguf. LD_LIBRARY_PATH=dir_of_cli:/vendor/lib64. -fa off -t 6.\n";
sc += "   Cells (each n=1 after a 3s pause; log temp via termux-battery-status):\n";
sc += "     CPU_PP: -ngl 0 -n 1  with a ~512-token prompt (repeat a paragraph; record time to first/only token / prefill if printed)\n";
sc += "     GPU_PP: -ngl 99 -fa off -n 1 same prompt\n";
sc += "     CPU_TG: -ngl 0 -n 128 short prompt (32 tok) after 20s cooldown\n";
sc += "     GPU_TG: -ngl 99 -fa off -n 128 same short prompt\n";
sc += "     HANDOFF: GPU_PP immediately followed by CPU_TG (no extra cooldown) — thermal only, KV not shared.\n";
sc += "   llama-cli prints eval times in stderr (prompt eval / eval). Capture both stdout+stderr.\n";
sc += "3) results/s23_idle_ideas/push_and_run.ps1: scp scripts, mkdir, run typeahead THEN phase2b, pull logs.\n";
sc += "4) STATUS.txt = SCRIPTS_READY. Do not start device work in this agent.\n";
let a0 = agent(sc, #{ label: "write-scripts", capability_mode: "read-write", agent_type: "sonnet-coder" });
if (a0 == () || !a0.success) { log("script writer failed"); }

phase("Audit scripts");
let au = "";
au += law();
au += "Hostile audit of results/s23_idle_ideas/*.sh and push_and_run.ps1. Be hostile.\n";
au += "Attack: measuring plugged; no MemFree abort; typeahead with clear_kv always true (would fake reuse); ";
au += "35B -ngl 99 sneaking back; two models loaded at once; killing bmoe on PC; Xiaomi host; ";
au += "prompt growth that is NOT a prefix (breaks KV reuse); missing control full-prefill; ";
au += "using GPU tg as if KV were handed off from GPU pp.\n";
au += "Write results/s23_idle_ideas/audit_scripts.md CONFIRMED/PLAUSIBLE/REFUTED. If CONFIRMED, list required fixes.\n";
let a1 = agent(au, #{ label: "audit-scripts", capability_mode: "read-write", agent_type: "reviewer" });
if (a1 == () || !a1.success) { log("script audit failed open"); }

phase("Typeahead");
let ty = "";
ty += law();
ty += "TASK: Fix any CONFIRMED script bugs, then RUN typeahead on S23. Unplugged only.\n";
ty += "Read audit_scripts.md first. Verify termux-battery-status: UNPLUGGED and percentage>=45.\n";
ty += "If llama-cli/bmoe already running (real infer, not this ssh), WAIT do not kill.\n";
ty += "Push and run typeahead only. Pull logs to results/s23_idle_ideas/typeahead/.\n";
ty += "Write typeahead/summary.csv with step, prompt_chars, clear_kv, prefill_s, decode_tok, memfree, batt, temp.\n";
ty += "STATUS.txt = TYPEAHEAD_DONE or BLOCKED_*.\n";
let a2 = agent(ty, #{ label: "run-typeahead", capability_mode: "all", agent_type: "sonnet-coder" });
if (a2 == () || !a2.success) { log("typeahead run failed"); }

phase("Phase 2B");
let ph = "";
ph += law();
ph += "TASK: RUN 2B phase-ceiling + thermal handoff on S23. Typeahead must be finished (no two infer at once).\n";
ph += "Re-check UNPLUGGED batt>=45. Find a llama-cli that actually runs -ngl 99 -fa off on the 2B (k22b/bin_fix2/k4 bmoe-cli).\n";
ph += "If OpenCL binary missing/crashes, mark PHASE2B_BLOCKED with log — do not invent GPU numbers.\n";
ph += "Pull to results/s23_idle_ideas/phase2b/. Write phase2b/summary.csv (cell, ngl, prompt_tok, n_gen, pp_t_s, tg_t_s, ms_per, batt, temp).\n";
ph += "Ceiling (label MODEL): user_turn_s ≈ t_pp + t_tg for 512-pp + 128-tg under CPU-only, GPU-only, and GPU-pp+CPU-tg.\n";
ph += "Handoff does NOT share KV — say so in the CSV notes.\n";
ph += "STATUS.txt = PHASE2B_DONE or BLOCKED_*.\n";
let a3 = agent(ph, #{ label: "run-phase2b", capability_mode: "all", agent_type: "sonnet-coder" });
if (a3 == () || !a3.success) { log("phase2b run failed"); }

phase("Audit numbers");
let an = "";
an += law();
an += "Hostile audit of typeahead/ and phase2b/ logs+CSV. Be hostile.\n";
an += "Recompute every ratio from raw BMOE_DONE / llama-cli eval lines. ";
an += "Attack: calling typeahead a win if later steps re-prefill the whole prefix; GPU-pp+CPU-tg ceiling that adds GPU_TG; ";
an += "plugged rows; first-token including load folded into prefill; n=1 of 2B sold as 35B.\n";
an += "Write results/s23_idle_ideas/audit_numbers.md. Independent arithmetic required.\n";
let a4 = agent(an, #{ label: "audit-numbers", capability_mode: "all", agent_type: "reviewer" });
if (a4 == () || !a4.success) { log("numbers audit failed open"); }

phase("Report");
let rp = "";
rp += law();
rp += "Write reports/moe-s23-idle-ideas.md from CSVs + audits.\n";
rp += "Sections: device snapshot; typeahead table + verdict (LIVE / DEAD / BLOCKED); ";
rp += "2B phase ceiling table + verdict; what this does NOT say about 35B decode; next action.\n";
rp += "End with DONE. Update results/s23_idle_ideas/STATUS.txt.\n";
let a5 = agent(rp, #{ label: "report", capability_mode: "read-write", agent_type: "sonnet-coder" });
if (a5 == () || !a5.success) { log("report failed"); }

let report = "";
report += "s23-idle-ideas: typeahead KEXP + 2B GPU-pp/CPU-tg. No 35B GPU rerun. No PC job kill.\n";
let path = write_scratch_file("report.md", report);
complete(#{ path: path, report: "reports/moe-s23-idle-ideas.md" });
