#!/usr/bin/env python3
"""Simulate a household of phones against one llama-server.

Each phone holds its own multi-turn conversation of a realistic shape: a chunk
of context (household notes, distinct per phone) that it keeps re-sending
because a phone is a stateless HTTP client, then a short question. The phones
overlap in time — nobody waits politely for anybody.

Measured per request:
  - time to first streamed token (TTFT, includes queue wait — user-perceived);
  - usage.prompt_tokens_details.cached_tokens (did the warm context survive?);
  - the native timings.cache_n from the same final chunk (cross-check);
  - the server's /metrics gauges (requests_processing / requests_deferred)
    polled in the background for queue depth.

Stdlib only. Exit 0 when every request succeeded, 1 otherwise.
"""

import argparse
import json
import random
import threading
import time
import urllib.request

QUESTIONS = [
    "When is the rubbish collected this week? Reply with one short sentence.",
    "What did the notes say about the boiler pressure? One short sentence.",
    "Who is picking up the kids on Thursday? One short sentence.",
    "Summarise the wifi situation in the house in one short sentence.",
    "What is planned for Sunday lunch? One short sentence.",
    "Which neighbour has our spare key? One short sentence.",
    "What is the plumber's arrival window? One short sentence.",
    "What did we promise to bring to the school fair? One short sentence.",
    "When does the parking permit expire? One short sentence.",
    "What is the password hint for the heating app? One short sentence.",
]

WORD_POOL = [
    "kitchen", "radiator", "school", "practice", "match", "market", "onions",
    "laundry", "bicycle", "tutor", "piano", "dentist", " ferry", "curtain",
    "gutter", "compost", "battery", "shelf", "recipe", "blanket", "pillow",
    "traffic", "parcel", "neighbour", "garden", "hedge", "paint", "ladder",
    "roomba", "charger", "cable", "thermostat", "invoice", "receipt", "budget",
    "holiday", "train", "ticket", "passport", "locker", "uniform", "trainer",
]


def make_doc(phone: int, words: int) -> str:
    """Deterministic per-phone household notes, low overlap between phones."""
    rng = random.Random(9000 + phone)
    name = f"phone-{phone}"
    parts = [
        f"Household notes for device {name}, maintained over the last month. "
        "Everything below is context the assistant is expected to know."
    ]
    n = 0
    while n < words:
        template = rng.choice([
            "The {a} was checked on the {d}th and the note says {b} should happen next week.",
            "{b} reminded everyone that the {a} needs attention before month end.",
            "We agreed at dinner that the {a} rota swaps on the {d}th, {b} takes the early one.",
            "A parcel for {b} is with the neighbour; it contains a {a} and nothing else.",
            "The {a} budget line moved by {d}0 euros because {b} booked the summer trip.",
            "Reminder from {b}: the {a} appointment moved, the window is {d}-{d2} pm.",
            "The {a} broke once already; the receipt is in the {b} drawer upstairs.",
            "{b} fixed the {a} with tape, a proper repair is still on the list.",
            "Shopping list item: {a}, two of them, because {b} used the last one.",
            "The {a} code was changed to the birth year of {b}, minus {d}.",
        ])
        sentence = template.format(
            a=rng.choice(WORD_POOL).strip(),
            b=rng.choice(WORD_POOL).strip().capitalize(),
            d=rng.randint(2, 28),
            d2=rng.randint(2, 8),
        )
        parts.append(sentence)
        n += len(sentence.split())
    return "\n".join(parts)


def messages_for(phone: int, doc: str, turn: int, history: list) -> list:
    # The shape of a stateless phone: system, then the context chunk resent
    # every turn, then the turns so far, then the new question — so the
    # rendered prompt grows strictly at the end and any prefix cache the
    # server kept can bite on the whole conversation so far.
    msgs = [{"role": "system",
             "content": f"You are the household assistant serving device phone-{phone}. Be brief."}]
    msgs.append({"role": "user",
                 "content": f"Here are the household notes I keep on my phone:\n\n{doc}"})
    msgs.extend(history)
    msgs.append({"role": "user",
                 "content": f"Question {turn}: {QUESTIONS[(phone * 3 + turn) % len(QUESTIONS)]}"})
    return msgs


class MetricsPoller(threading.Thread):
    def __init__(self, port: int, every_s: float, stop_event: threading.Event):
        super().__init__(daemon=True)
        self.url = f"http://127.0.0.1:{port}/metrics"
        self.every_s = every_s
        self.stop_event = stop_event
        self.max_processing = 0
        self.max_deferred = 0
        self.samples = 0
        self.deferred_samples = 0

    def run(self):
        while not self.stop_event.is_set():
            try:
                with urllib.request.urlopen(self.url, timeout=2) as r:
                    text = r.read().decode()
                proc = deferred = None
                for line in text.splitlines():
                    if line.startswith("llamacpp:requests_processing "):
                        proc = int(float(line.split()[1]))
                    elif line.startswith("llamacpp:requests_deferred "):
                        deferred = int(float(line.split()[1]))
                if proc is not None:
                    self.max_processing = max(self.max_processing, proc)
                    self.samples += 1
                if deferred is not None:
                    self.max_deferred = max(self.max_deferred, deferred)
                    if deferred > 0:
                        self.deferred_samples += 1
            except Exception:
                pass
            self.stop_event.wait(self.every_s)


def one_request(port: int, msgs: list, seed: int, n_predict: int) -> dict:
    body = json.dumps({
        "messages": msgs,
        "max_tokens": n_predict,
        "temperature": 0.7,
        "seed": seed,
        "cache_prompt": True,
        "stream": True,
        "stream_options": {"include_usage": True},
    }).encode()
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}/v1/chat/completions",
        data=body,
        headers={"Content-Type": "application/json"},
    )
    rec = {"ttft_ms": None, "total_ms": None, "prompt_tokens": None,
           "cached_tokens": None, "cache_n": None, "completion_tokens": None,
           "answer": "", "error": None}
    parts = []
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=300) as resp:
            for raw in resp:
                line = raw.decode("utf-8", "replace").strip()
                if not line.startswith("data: ") or line == "data: [DONE]":
                    continue
                chunk = json.loads(line[len("data: "):])
                if chunk.get("choices"):
                    delta = chunk["choices"][0].get("delta") or {}
                    # First token = first non-empty delta field: models with
                    # a reasoning phase stream reasoning_content first.
                    if any(isinstance(v, str) and v for v in delta.values()):
                        parts.append(delta.get("content") or "")
                        if rec["ttft_ms"] is None:
                            rec["ttft_ms"] = round((time.perf_counter() - t0) * 1000)
                if chunk.get("usage"):
                    u = chunk["usage"]
                    rec["prompt_tokens"] = u.get("prompt_tokens")
                    rec["cached_tokens"] = (u.get("prompt_tokens_details") or {}).get("cached_tokens")
                    rec["completion_tokens"] = u.get("completion_tokens")
                    tim = chunk.get("timings") or {}
                    rec["cache_n"] = tim.get("cache_n")
                    rec["prompt_ms"] = tim.get("prompt_ms")
                    rec["prompt_per_second"] = round(tim.get("prompt_per_second") or 0, 1)
        rec["answer"] = "".join(parts)
        rec["total_ms"] = round((time.perf_counter() - t0) * 1000)
    except Exception as e:  # noqa: BLE001 - record and let the exit code fail the run
        rec["error"] = f"{type(e).__name__}: {e}"
        rec["total_ms"] = round((time.perf_counter() - t0) * 1000)
    return rec


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, required=True)
    ap.add_argument("--phones", type=int, required=True)
    ap.add_argument("--turns", type=int, default=3)
    ap.add_argument("--doc-words", type=int, default=1500,
                    help="approx words of persistent context per phone (~1.33 tokens each)")
    ap.add_argument("--n-predict", type=int, default=72)
    ap.add_argument("--think-ms", type=int, default=300)
    ap.add_argument("--metrics-every-ms", type=int, default=150)
    ap.add_argument("--label", default="")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    docs = {p: make_doc(p, args.doc_words) for p in range(args.phones)}
    lock = threading.Lock()
    records = []
    stop_event = threading.Event()
    poller = MetricsPoller(args.port, args.metrics_every_ms / 1000.0, stop_event)
    poller.start()

    wall0 = time.perf_counter()

    def phone_thread(phone: int):
        history = []
        for turn in range(args.turns):
            msgs = messages_for(phone, docs[phone], turn, history)
            rec = one_request(args.port, msgs, 1000 * phone + turn, args.n_predict)
            rec["phone"] = phone
            rec["turn"] = turn
            with lock:
                records.append(rec)
                done = len(records)
            if rec["error"] is None:
                history.append({"role": "user",
                                "content": f"Question {turn}: {QUESTIONS[(phone * 3 + turn) % len(QUESTIONS)]}"})
                history.append({"role": "assistant", "content": rec["answer"]})
            time.sleep(args.think_ms / 1000.0)

    threads = [threading.Thread(target=phone_thread, args=(p,)) for p in range(args.phones)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    wall_s = round(time.perf_counter() - wall0, 2)
    stop_event.set()
    poller.join(timeout=2)

    # Per-turn rows keep the answers aligned with their question only when the
    # request succeeded; the history above stays deterministic regardless.
    records.sort(key=lambda r: (r["phone"], r["turn"]))
    ok = all(r["error"] is None for r in records)
    out = {
        "label": args.label,
        "port": args.port,
        "phones": args.phones,
        "turns": args.turns,
        "doc_words": args.doc_words,
        "n_predict": args.n_predict,
        "wall_s": wall_s,
        "metrics": {
            "max_processing": poller.max_processing,
            "max_deferred": poller.max_deferred,
            "samples": poller.samples,
            "deferred_samples": poller.deferred_samples,
        },
        "requests": records,
    }
    with open(args.out, "w") as f:
        json.dump(out, f, indent=1)
    ttfts = [r["ttft_ms"] for r in records if r["ttft_ms"] is not None]
    print(f"[{args.label}] phones={args.phones} wall={wall_s}s "
          f"ttft_avg={round(sum(ttfts) / len(ttfts)) if ttfts else '-'}ms "
          f"ttft_max={max(ttfts) if ttfts else '-'}ms "
          f"max_deferred={poller.max_deferred} ok={ok}")
    raise SystemExit(0 if ok else 1)


if __name__ == "__main__":
    main()
