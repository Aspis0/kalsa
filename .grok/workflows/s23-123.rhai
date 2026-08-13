let meta = #{
    name: "s23-123",
    description: "S23 CalaQwen-only: speculative-k route peakiness, ngram/mtp lookahead, GDN+KV save probe",
    when_to_use: "S23 idle unplugged; test ideas 1/2/3 on the 35B only; no 4B mix",
    phases: [
        #{ title: "Scripts", detail: "harness + peakiness parser" },
        #{ title: "Audit scripts", detail: "hostile" },
        #{ title: "Run S23", detail: "k6 trace, k1 agree, ngram, mtp, session" },
        #{ title: "Audit numbers", detail: "hostile recompute" },
        #{ title: "Report", detail: "reports/moe-s23-123.md" },
    ],
};

fn law() {
    let s = "";
    s += "REPO: C:/Users/gualt/Desktop/Kalsa/moe-experiments\n";
    s += "S23 ONLY: ssh -p 8022 -i %USERPROFILE%/.ssh/moe_s23 u0_a344@192.168.1.152\n";
    s += "NO Xiaomi, NO Jelly, NO 4B/2B mix, NO 35B -ngl 99, NO PLAN.md, NO git push, NO GGUF writes.\n";
    s += "Do not kill PC LFM/selfspec. Campaign binary only:\n";
    s += "  ~/src/BigMoeOnEdge/build-bmoe/cli/bmoe-cli.CAMPAIGN sha 1ca51420...\n";
    s += "  -m ~/experiments/models/Qwen3.6-35B-A3B-KEXP.gguf\n";
    s += "  -t 4 -c 4096 --ubatch 512 --moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --drop-cold-experts 0.65 --temp 0 --no-think\n";
    s += "UNPLUGGED, batt>=45, batt temp<=45. Abort reboot. Workspace ~/gdn_k2/s23_123/.\n";
    s += "35B loaded MemFree is ~100 MiB — do NOT abort on MemFree<300 MiB or you cannot run. Guard MemAvail<400000 kB + LMKD.\n";
    s += "Never fabricate. Raw logs on disk. Use tools.\n";
    s += "PRIOR ART (do not spend a long bench rediscovering):\n";
    s += "  F5.2-C3 ngram drafted 0/128 on IT prose (reports/moe-f5.2.md). Confirm short, then stop.\n";
    s += "  MTP was missing nextn on older GGUF — smoke KEXP only.\n";
    s
}

phase("Scripts");
let sc = "";
sc += law();
sc += "Write results/s23_123/ on PC:\n";
sc += "1) run_all.sh for the phone. Prompt = results/marco_phase1/speed_s23/prompts/p_fact.txt (copy in).\n";
sc += "   A) IDEA1 peakiness: -n 40 --n-expert-used 6 --route-trace route_k6.csv --progress --csv metrics_k6.csv\n";
sc += "      Save stdout text. Parse later.\n";
sc += "   B) IDEA1 free-run k=1: same prompt -n 40 --n-expert-used 1 (NO route-trace). Save text.\n";
sc += "      After pull, compare generated token/text prefix vs A.\n";
sc += "   C) IDEA2: -n 32 --n-expert-used 6 --ngram --draft 4 --progress. Log drafted/accept if BMOE lines have them.\n";
sc += "   D) IDEA2 mtp: -n 8 --mtp --draft 3. Expect fail-fast if no nextn. Capture stderr. Do not retry.\n";
sc += "   E) IDEA3: --session two JSON gens, n_predict=16, second clear_kv=false with a SECOND user sentence appended\n";
sc += "      (chat-like two turns). Record n_common/n_past/n_prompt from BMOE_DONE. Then grep binary --help for save/load/cache.\n";
sc += "      Do NOT launch llama-cli on the 13GB GGUF (no moe-stream → RescueParty).\n";
sc += "   Between cells: termux-battery-status must be UNPLUGGED. One process at a time. fadvise cold optional on A only.\n";
sc += "2) analyze_peakiness.py: route CSV columns turn,phase,step,layer,slot,expert,weight,residency,expert_bytes.\n";
sc += "   DECODE rows only. Per (step,layer): top1=max weight, share=top1/sum. Hist P(share>=0.50/0.70/0.85).\n";
sc += "   Mean experts-equivalent if skip extras when share>=thr. Write peakiness.json.\n";
sc += "3) push_and_run.ps1. STATUS=SCRIPTS_READY. No SSH yet.\n";
let w = agent(sc, #{ label: "scripts", capability_mode: "read-write", agent_type: "sonnet-coder" });
if (w == () || !w.success) { log("scripts failed"); }

phase("Audit scripts");
let au = "";
au += law();
au += "Hostile audit results/s23_123/*.sh *.py *.ps1. Attack: 4B mix, -ngl 99, llama-cli on 35B, MemFree-300 abort that blocks load, ";
au += "k=1 sold as teacher-force, ngram 20-min ABBA, plugged speed, two bmoe at once, killing PC jobs.\n";
au += "Write results/s23_123/audit_scripts.md. List required fixes.\n";
let a1 = agent(au, #{ label: "audit-scripts", capability_mode: "read-write", agent_type: "reviewer" });
if (a1 == () || !a1.success) { log("audit scripts failed open"); }

phase("Run S23");
let rn = "";
rn += law();
rn += "Fix CONFIRMED script bugs, then RUN on S23. Pull to results/s23_123/{idea1,idea2,idea3}/.\n";
rn += "Run analyze_peakiness.py on the pulled route_k6.csv. Compare k1 vs k6 generated text (first divergence).\n";
rn += "For ngram: count draft steps from logs; if 0, do not add more ngram cells.\n";
rn += "For idea3: also read BigMoeOnEdge/core/src/engine/session.cpp around recurrent rewind (~701) and llama.h save/load session. Write idea3/ENGINE_NOTES.md: is disk save possible today?\n";
rn += "STATUS=RUN_DONE or BLOCKED_*.\n";
let a2 = agent(rn, #{ label: "run", capability_mode: "all", agent_type: "sonnet-coder" });
if (a2 == () || !a2.success) { log("run failed"); }

phase("Audit numbers");
let an = "";
an += law();
an += "Hostile audit of pulled logs + peakiness.json. Recompute shares from CSV. Be hostile.\n";
an += "Attack: prefill rows mixed into decode peakiness; k=1 free-run sold as teacher-force; ngram 0 drafts called a win; ";
an += "in-RAM session called disk serialize; inventing n_common.\n";
an += "Write results/s23_123/audit_numbers.md.\n";
let a3 = agent(an, #{ label: "audit-numbers", capability_mode: "all", agent_type: "reviewer" });
if (a3 == () || !a3.success) { log("audit numbers failed open"); }

phase("Report");
let rp = "";
rp += law();
rp += "Write reports/moe-s23-123.md. One verdict per idea: LIVE / DEAD / BLOCKED_ENGINE / WORTH_PC.\n";
rp += "Idea1: peakiness table + k1/k6 prefix; whether implementing skip-when-peaky is justified.\n";
rp += "Idea2: ngram drafts, mtp, leftover = selfspec/Jacobi only.\n";
rp += "Idea3: in-RAM vs disk; file:line why hybrid save is missing.\n";
rp += "Early-exit: not run (needs PC quality). End DONE.\n";
let a4 = agent(rp, #{ label: "report", capability_mode: "read-write", agent_type: "sonnet-coder" });
if (a4 == () || !a4.success) { log("report failed"); }

complete(#{ report: "reports/moe-s23-123.md" });
