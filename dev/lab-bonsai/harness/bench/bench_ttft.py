#!/usr/bin/env python3
"""Streaming speed probe on a ~2k-token prompt, thinking off (one responsibility: time first word and decode).

time-to-first-word = request sent -> first streamed content delta.
Prompt cache is disabled and each run carries a unique id, so the prefix is re-processed every time.
"""
import argparse, json, os, statistics, time, urllib.request

ap = argparse.ArgumentParser()
ap.add_argument("--base", default="http://127.0.0.1:8191")
ap.add_argument("--label", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--think-switch", action="store_true", help="send enable_thinking:false (template has the switch)")
ap.add_argument("--runs", type=int, default=3)
args = ap.parse_args()

doc = open(os.path.expanduser("~/lab/bonsai/bench/prompt.txt"), encoding="utf-8").read()


def once(i):
    body = {
        "messages": [{"role": "user", "content": f"[run {i} {time.time_ns()}]\n{doc}\n\nSummarise the text above in one sentence."}],
        "stream": True,
        "max_tokens": 128,
        "cache_prompt": False,
        "temperature": 0.7,
    }
    if args.think_switch:
        body["chat_template_kwargs"] = {"enable_thinking": False}
    req = urllib.request.Request(f"{args.base}/v1/chat/completions", json.dumps(body).encode(), {"Content-Type": "application/json"})
    t0 = time.time()
    t_first = None
    server_timings = None
    usage = None
    with urllib.request.urlopen(req, timeout=900) as resp:
        for raw in resp:
            line = raw.decode("utf-8").strip()
            if not line.startswith("data:") or line == "data: [DONE]":
                continue
            chunk = json.loads(line[5:])
            if chunk.get("timings"):
                server_timings = chunk["timings"]
            if chunk.get("usage"):
                usage = chunk["usage"]
            for choice in chunk.get("choices", []):
                if choice.get("delta", {}).get("content") and t_first is None:
                    t_first = time.time()
    t_end = time.time()
    completion = (usage or {}).get("completion_tokens") or (server_timings or {}).get("predicted_n")
    decode_tps = None
    if t_first is not None and completion and completion > 1 and t_end > t_first:
        decode_tps = (completion - 1) / (t_end - t_first)
    return {
        "ttft_s": round(t_first - t0, 3) if t_first else None,
        "total_s": round(t_end - t0, 3),
        "decode_tok_s_client": round(decode_tps, 2) if decode_tps else None,
        "decode_tok_s_server": round(server_timings["predicted_per_second"], 2) if server_timings else None,
        "prompt_tokens": (usage or {}).get("prompt_tokens") or (server_timings or {}).get("prompt_n"),
        "prompt_tok_s_server": round(server_timings["prompt_per_second"], 2) if server_timings else None,
        "completion_tokens": completion,
    }


runs = [once(i) for i in range(1, args.runs + 1)]
summary = {
    "label": args.label,
    "runs": runs,
    "median_ttft_s": round(statistics.median(r["ttft_s"] for r in runs if r["ttft_s"] is not None), 3),
    "median_decode_tok_s_client": round(statistics.median(r["decode_tok_s_client"] for r in runs if r["decode_tok_s_client"]), 2),
    "median_decode_tok_s_server": round(statistics.median(r["decode_tok_s_server"] for r in runs if r["decode_tok_s_server"]), 2) if any(r["decode_tok_s_server"] for r in runs) else None,
}
os.makedirs(os.path.dirname(args.out), exist_ok=True)
json.dump(summary, open(args.out, "w"), indent=1)
print(json.dumps({k: v for k, v in summary.items() if k != "runs"}))
