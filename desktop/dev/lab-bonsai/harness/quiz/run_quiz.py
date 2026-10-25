#!/usr/bin/env python3
"""Italian quiz runner for the lab server (one responsibility: send each quiz question, record raw answers).

Adapted from docs/quiz-2026-09-26/official-sampling/run_official.py: no server spawn (the lab server
is started by hand on port 8191), thinking mode switch, per-answer timings from llama-server.
"""
import json, sys, time, urllib.request, os, argparse

ap = argparse.ArgumentParser()
ap.add_argument("--label", required=True)
ap.add_argument("--seeds", default="1")
ap.add_argument("--limit", type=int, default=0, help="first N questions only (0 = all)")
ap.add_argument("--think", choices=["on", "off"], default="on")
ap.add_argument("--out", default=os.path.expanduser("~/lab/bonsai/results/quiz"))
ap.add_argument("--base", default="http://127.0.0.1:8191")
args = ap.parse_args()

QUESTIONS = os.path.expanduser("~/lab/bonsai/harness/quiz/questions.txt")
qs = [l.strip() for l in open(QUESTIONS, encoding="utf-8") if l.strip()]
if args.limit:
    qs = qs[: args.limit]

# Thinking on: the card's own sampling (temp 1.0 / top_p 0.95 / top_k 20 / min_p 0.05) is the server default,
# so no sampling fields are sent. Thinking off: the card's non-thinking sampling, sent per request.
NOTHINK_SAMPLING = {"temperature": 0.7, "top_p": 0.8, "top_k": 20, "min_p": 0.0, "presence_penalty": 1.5}


def post(body):
    req = urllib.request.Request(
        f"{args.base}/v1/chat/completions",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
    )
    return json.loads(urllib.request.urlopen(req, timeout=900).read())


os.makedirs(args.out, exist_ok=True)
for seed in [int(x) for x in args.seeds.split(",")]:
    path = os.path.join(args.out, f"official-{args.label}-s{seed}.jsonl")
    with open(path, "w", encoding="utf-8") as f:
        for i, q in enumerate(qs, 1):
            body = {"messages": [{"role": "user", "content": q}], "max_tokens": 6000, "seed": seed}
            if args.think == "off":
                body.update(NOTHINK_SAMPLING)
                body["chat_template_kwargs"] = {"enable_thinking": False}
            t = time.time()
            r = post(body)
            m = r["choices"][0]["message"]
            rec = {
                "n": i,
                "q": q,
                "answer": m.get("content"),
                "reasoning": m.get("reasoning_content"),
                "reasoning_chars": len(m.get("reasoning_content") or ""),
                "finish": r["choices"][0].get("finish_reason"),
                "tokens": r.get("usage", {}).get("completion_tokens"),
                "prompt_tokens": r.get("usage", {}).get("prompt_tokens"),
                "timings": r.get("timings"),
                "seconds": round(time.time() - t, 1),
            }
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
            f.flush()
            print(args.label, seed, i, rec["finish"], rec["tokens"], flush=True)
