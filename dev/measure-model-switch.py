#!/usr/bin/env python3
"""The price of changing the household model.

b10950's server holds exactly one model per process: the task-type enum has
no reload/switch, `/v1/models` is read-only, so switching == restarting.
This measures the whole switch as a household member would live it:

  t0    the running server is killed (the "switch requested" moment)
        -> every slot, every prompt cache in the house dies with it
  then  a fresh process starts with the other model, becomes healthy
        (that span is the load), and the same ~2k-token question is sent;
        the switch ends at that request's first token.

Both directions are measured (Trinity -> gemma-4-12B and back), after a
warm-up phase that also puts the 7.7 GB of gemma into the page cache so the
number reflects the steady-state switch, not a cold-disk first encounter.

Writes a summary JSON + readable log into --results-dir. Prompts and
completions are never written to disk; only timings and token counts.
"""

import argparse
import importlib.util
import json
import os
import signal
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("sp", HERE / "simulate-phones.py")
sp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sp)

QUESTION = "\n\nQuestion: name three items from the notes above. Answer briefly."


def chat_ttft(port: int, doc: str, n_predict: int = 32) -> dict:
    """Stream one chat request; return TTFT and usage. Nothing is stored."""
    body = json.dumps({
        "messages": [{"role": "user", "content": doc + QUESTION}],
        "max_tokens": n_predict, "temperature": 0.0,
        "cache_prompt": True, "stream": True,
        "stream_options": {"include_usage": True},
    }).encode()
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}/v1/chat/completions",
        data=body, headers={"Content-Type": "application/json"})
    t0 = time.perf_counter()
    ttft = None
    usage = {}
    with urllib.request.urlopen(req, timeout=600) as resp:
        for raw in resp:
            line = raw.decode("utf-8", "replace").strip()
            if not line.startswith("data: ") or line == "data: [DONE]":
                continue
            chunk = json.loads(line[6:])
            if ttft is None and chunk.get("choices"):
                # First token = first non-empty delta of any kind; gemma
                # streams reasoning_content first, Trinity streams content.
                delta = chunk["choices"][0].get("delta") or {}
                if any(isinstance(v, str) and v for v in delta.values()):
                    ttft = time.perf_counter() - t0
            if chunk.get("usage"):
                usage = chunk["usage"]
    return {"ttft_s": round(ttft, 2) if ttft else None,
            "prompt_tokens": usage.get("prompt_tokens"),
            "cached_tokens": (usage.get("prompt_tokens_details") or {}).get("cached_tokens"),
            "total_s": round(time.perf_counter() - t0, 2)}


class Server:
    def __init__(self, bin_path: str, model: str, port: int, log: Path):
        self.bin, self.model, self.port, self.log = bin_path, model, port, log
        self.proc = None

    def start(self) -> float:
        argv = [self.bin, "--host", "127.0.0.1", "--port", str(self.port),
                "--model", self.model,
                "--threads", "4", "--threads-batch", "4",
                "--batch-size", "2048", "--ubatch-size", "512",
                "--ctx-size", "16384", "--n-gpu-layers", "all",
                "--flash-attn", "on", "--cache-type-k", "q8_0",
                "--cache-type-v", "q8_0",
                "--sleep-idle-seconds", "3600", "--no-webui",
                "--parallel", "1", "--cache-ram", "384", "-lv", "5"]
        self.out = open(self.log, "w")
        self.proc = subprocess.Popen(argv, stdout=self.out, stderr=self.out,
                                     start_new_session=True)
        t0 = time.perf_counter()
        while time.perf_counter() - t0 < 600:
            try:
                with urllib.request.urlopen(
                        f"http://127.0.0.1:{self.port}/health", timeout=2) as r:
                    if r.status == 200:
                        return time.perf_counter() - t0
            except Exception:
                time.sleep(0.5)
        raise RuntimeError(f"server on :{self.port} never became healthy")

    def kill(self) -> None:
        if self.proc:
            os.killpg(self.proc.pid, signal.SIGTERM)
            for _ in range(30):
                if self.proc.poll() is not None:
                    break
                time.sleep(0.5)
            self.out.close()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--bin", required=True)
    ap.add_argument("--trinity", required=True)
    ap.add_argument("--gemma", required=True)
    ap.add_argument("--results-dir", required=True)
    args = ap.parse_args()
    rd = Path(args.results_dir)

    doc = sp.make_doc(7, 1500)
    rows = []

    def phase(name: str, old: Server, new: Server) -> None:
        # warm-up: bring the running model to its steady state, then switch.
        warm_port = new.port + 10  # scratch server, its own port
        warm = Server(args.bin, old.model, warm_port, rd / f"warm-{name}.log")
        load_old = warm.start()
        w1 = chat_ttft(warm.port, doc)
        warm.kill()
        time.sleep(3)

        running = Server(args.bin, old.model, warm_port, rd / f"running-{name}.log")
        running.start()
        chat_ttft(running.port, doc)  # warm cache in the slot, like a live house

        t0 = time.perf_counter()
        running.kill()               # the switch is requested: everything dies
        fresh = Server(args.bin, new.model, new.port, rd / f"switched-{name}.log")
        load_s = fresh.start()       # process start + model load
        first = chat_ttft(fresh.port, doc)
        switch_s = time.perf_counter() - t0
        steady = chat_ttft(fresh.port, doc)  # the next request, right after
        fresh.kill()

        rows.append({
            "direction": name,
            "warm_ttft_s": w1["ttft_s"],
            "load_s": round(load_s, 2),
            "first_token_after_switch_s": round(switch_s, 2),
            "ttft_of_first_request_s": first["ttft_s"],
            "cached_tokens_first_request": first["cached_tokens"],
            "prompt_tokens": first["prompt_tokens"],
            "steady_ttft_s": steady["ttft_s"],
        })
        print(f"{name}: load={load_s:.1f}s first-token-after-switch={switch_s:.1f}s "
              f"(ttft {first['ttft_s']}s, cached={first['cached_tokens']}, "
              f"next request ttft {steady['ttft_s']}s)", file=sys.stderr)
        time.sleep(10)

    phase("trinity-to-gemma", Server(args.bin, args.trinity, 18341, rd / "x.log"),
          Server(args.bin, args.gemma, 18342, rd / "y.log"))
    phase("gemma-to-trinity", Server(args.bin, args.gemma, 18341, rd / "x.log"),
          Server(args.bin, args.trinity, 18342, rd / "y.log"))

    (rd / "results.json").write_text(json.dumps({"switches": rows}, indent=1))
    print("model-switch measurement written")


if __name__ == "__main__":
    main()
