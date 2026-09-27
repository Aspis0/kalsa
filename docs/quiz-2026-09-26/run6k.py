import json, subprocess, sys, time, urllib.request, os
SERVER = "/Users/marco/Library/Application Support/kalsa-brain/runtime/builds/metal/kalsa-server-v1.1.2/kalsa-server"
PORT = 8199
def post(path, body, timeout=600):
    req = urllib.request.Request(f"http://127.0.0.1:{PORT}{path}", data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(req, timeout=timeout).read())
def healthy():
    try: return urllib.request.urlopen(f"http://127.0.0.1:{PORT}/health", timeout=2).status == 200
    except Exception: return False
label, model = sys.argv[1], sys.argv[2]
out = os.path.expanduser(f"~/kalsa-bench-models/quiz/answers-{label}.jsonl")
qs = [l.strip() for l in open(os.path.expanduser("~/kalsa-bench-models/quiz/questions.txt")) if l.strip()]
log = open(f"/tmp/quiz-server-{label}.log", "w")
p = subprocess.Popen([SERVER, "--host", "127.0.0.1", "--port", str(PORT), "--model", model, "-ngl", "99", "--ctx-size", "8192", "--flash-attn", "on", "--cache-type-k", "q8_0", "--cache-type-v", "q8_0", "--no-webui", "--parallel", "1"], stdout=log, stderr=log)
try:
    for _ in range(300):
        if healthy(): break
        time.sleep(1)
    else: sys.exit("server did not start")
    with open(out, "w") as f:
        for i, q in enumerate(qs, 1):
            t = time.time()
            r = post("/v1/chat/completions", {"messages": [{"role": "user", "content": q}], "temperature": 0, "max_tokens": 6000})
            m = r["choices"][0]["message"]
            f.write(json.dumps({"n": i, "q": q, "answer": m.get("content"), "reasoning": m.get("reasoning_content"), "tokens": r.get("usage", {}).get("completion_tokens"), "seconds": round(time.time() - t, 1)}, ensure_ascii=False) + "\n"); f.flush()
            print(label, i, flush=True)
finally:
    p.terminate(); p.wait(timeout=30)
