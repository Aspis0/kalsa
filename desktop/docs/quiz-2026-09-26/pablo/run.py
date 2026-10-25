import json, os, random, subprocess, sys, time, urllib.request
SERVER = "/Users/marco/Library/Application Support/kalsa-brain/runtime/builds/metal/kalsa-server-v1.1.2/kalsa-server"
PORT = 8199
DEPTHS = [1, 3, 5, 8, 10, 15, 20, 30]
SEEDS = [1, 2, 3]
label, model, sampling = sys.argv[1], sys.argv[2], json.loads(sys.argv[3])
filler = json.load(open(os.path.expanduser("~/kalsa-bench-models/pablo/filler.json")))
def post(body):
    req = urllib.request.Request(f"http://127.0.0.1:{PORT}/v1/chat/completions", data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(req, timeout=900).read())
def healthy():
    try: return urllib.request.urlopen(f"http://127.0.0.1:{PORT}/health", timeout=2).status == 200
    except Exception: return False
log = open(f"/tmp/pablo-server-{label}.log", "w")
p = subprocess.Popen([SERVER, "--host", "127.0.0.1", "--port", str(PORT), "--model", model, "-ngl", "99", "--ctx-size", "65536", "--flash-attn", "on", "--cache-type-k", "q8_0", "--cache-type-v", "q8_0", "--no-webui", "--parallel", "1"], stdout=log, stderr=log)
out = open(os.path.expanduser(f"~/kalsa-bench-models/pablo/results-{label}.jsonl"), "w")
try:
    for _ in range(300):
        if healthy(): break
        time.sleep(1)
    else: sys.exit("server did not start")
    for depth in DEPTHS:
        for seed in SEEDS:
            turns = filler[:]; random.Random(seed).shuffle(turns)
            msgs = [{"role": "user", "content": "Il mio cane si chiama Pablo."},
                    {"role": "assistant", "content": "Che bel nome! Come posso aiutarti oggi?"}]
            for q, a in turns[:depth]:
                msgs += [{"role": "user", "content": q}, {"role": "assistant", "content": a}]
            msgs.append({"role": "user", "content": "Come si chiama il mio cane?"})
            r = post(dict({"messages": msgs, "max_tokens": 3000, "seed": seed}, **sampling))
            ans = r["choices"][0]["message"].get("content") or ""
            low = ans.lower()
            out.write(json.dumps({"depth": depth, "seed": seed, "pass": "pablo" in low,
                                  "refusal": any(k in low for k in ["non ho accesso", "non posso sapere", "non conosco", "non lo so", "non me lo hai"]),
                                  "answer": ans[:300]}, ensure_ascii=False) + "\n"); out.flush()
            print(label, depth, seed, "pablo" in low, flush=True)
finally:
    p.terminate(); p.wait(timeout=30)
