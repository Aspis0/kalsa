#!/usr/bin/env python3
"""Does the re-rendered history reproduce the tokens the KV already holds?

Measures, for a Qwen-3.5-style chat template, whether replaying an assistant
turn back into the prompt yields the SAME token ids the live cache got when
that turn was generated. If it does not, the engine drops the whole prefix and
re-prefills: on the 2026-09-18 e2e that was 2213 of 2383 tokens thrown away.

The answer depends on WHERE the assistant turn sits, which is the whole point:

    older turn   content = the raw <think>...</think>answer span
                 reasoning_content = any NON-EMPTY string (never rendered;
                 it exists only to stop the template splitting </think> out)

    final turn   content = the answer after "</think>\\n\\n"
    (prewarm)    reasoning_content = the inner reasoning, rstrip("\\n")
                 -- passing it raw breaks at 195/235 over ONE newline

Counts only. No prompt text is printed: the output is positions and ids.
"""

import json
import re
import subprocess
import sys
import urllib.request

SEED = "<think>\n"
ENDPOINT = "http://127.0.0.1:8899/apply-template"


def render(messages, model, generation_prompt=True, enable_thinking=None):
    body = {"messages": messages}
    if not generation_prompt:
        body["add_generation_prompt"] = False
    if enable_thinking is not None:
        body["chat_template_kwargs"] = {"enable_thinking": enable_thinking}
    req = urllib.request.Request(
        ENDPOINT,
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
    )
    return json.load(urllib.request.urlopen(req))["prompt"]


def tokenize(text, model):
    with open("/tmp/_probe_prompt.txt", "w", encoding="utf-8") as fh:
        fh.write(text)
    out = subprocess.run(
        ["llama-tokenize", "-m", model, "-f", "/tmp/_probe_prompt.txt", "--ids", "--no-bos"],
        capture_output=True,
        text=True,
    ).stdout
    body = re.search(r"\[(.*)\]", out, re.S)
    return [int(x) for x in body.group(1).split(",") if x.strip()]


def common_prefix(a, b):
    n = 0
    while n < min(len(a), len(b)) and a[n] == b[n]:
        n += 1
    return n


def split_span(span):
    """Canonical stored emission: <think>\\n + inner + \\n</think>\\n\\n + answer."""
    head, _, tail = span.partition("</think>")
    inner = head[len(SEED):].rstrip("\n") if head.startswith(SEED) else ""
    answer = tail[2:] if tail.startswith("\n\n") else tail.lstrip("\n")
    return inner, answer


def assistant_fields(span, is_final):
    inner, answer = split_span(span)
    if is_final:
        return {"content": answer, "reasoning_content": inner}
    return {"content": span, "reasoning_content": " "}


def main():
    if len(sys.argv) < 3:
        sys.exit("usage: qwen_think_replay_probe.py <model.gguf> <history.json>")
    model, history_path = sys.argv[1], sys.argv[2]
    history = json.load(open(history_path))
    user = history[0]["text"]
    later_user = history[2]["text"]
    spans = {
        f"stored-{i}": m["modelEmittedText"]
        for i, m in enumerate(history)
        if m.get("role") == "assistant" and m.get("modelEmittedText")
    }
    spans["empty-think"] = "<think>\n\n</think>\n\nCiao! Come posso aiutarti oggi?"

    print(f"{'position':9} {'shape':12} {'live':>5} {'common':>6}  verdict")
    failures = 0
    for position in ("older", "final"):
        for name, span in spans.items():
            live = tokenize(
                render([{"role": "user", "content": user}], model) + span[len(SEED):],
                model,
            )
            message = {"role": "assistant"}
            message.update(assistant_fields(span, position == "final"))
            messages = [{"role": "user", "content": user}, message]
            if position == "older":
                messages.append({"role": "user", "content": later_user})
            got = common_prefix(live, tokenize(render(messages, model), model))
            ok = got == len(live)
            failures += 0 if ok else 1
            verdict = "REUSES ALL" if ok else f"breaks at {got}"
            print(f"{position:9} {name:12} {len(live):5d} {got:6d}  {verdict}")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
