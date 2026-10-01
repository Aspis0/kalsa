#!/usr/bin/env python3
"""FLORES-200 devtest translation eval: chrF++ + wrong-language rate.

EN -> {IT,FR,ES,ZH} over eval/flores-devtest-100.jsonl (build_flores_holdout.py,
CC-BY-SA-4.0). Greedy via the llama.cpp server's /v1/chat/completions (the
server owns the chat template — same product-parity conditions as
run_gen_eval.py). Two metrics per pair:

  chrF++           sacrebleu with word_order=2; the per-sentence chrF values
                   are the paired-bootstrap units
  wrong-language   fastText lid.176.bin (~/kalsa-models/lid.176.bin) top-1
                   label != target (empty output counts as wrong). lid
                   labels are plain ISO-639-1 codes: it, fr, es, zh (no
                   regional variants in this model).

Outputs (both shaped like run_bpb_eval.py files, so the EXISTING
eval/bootstrap_ci.py --bpb gives paired CIs on either metric):
  <out-prefix>-chrf.json       {"<en-xx>": {"chunks": [chrF...], "overall": X}}
  <out-prefix>-wronglang.json  {"<en-xx>": {"chunks": [0|1...], "rate": R}}

Instrument self-check: the GOLD references must classify as their target
language for >= 90% of items, else the LID instrument is broken and the run
fails. lid.176 has one Chinese label (`zh`), so a traditional-Chinese answer
counts as correct language there — the metric targets the wrong-LANGUAGE
failure mode (e.g. English answers), not the character-variant one.

Usage: run_flores.py --holdout flores-devtest-100.jsonl --server URL
                     --out-prefix results/arm/flores [--limit N]
"""

import argparse
import json
import pathlib
import sys
import urllib.request

import fasttext
import sacrebleu

TARGET_LABEL = {"it": "__label__it", "fr": "__label__fr",
                "es": "__label__es", "zh": "__label__zh"}
TARGET_NAME = {"it": "Italian", "fr": "French", "es": "Spanish",
               "zh": "Chinese (Simplified)"}
LID_MODEL = str(pathlib.Path.home() / "kalsa-models" / "lid.176.bin")


def translate(server: str, text: str, target: str, max_tokens: int) -> str:
    msg = (f"Translate the following English text into {TARGET_NAME[target]}. "
           f"Reply with the translation only.\n\n{text}")
    body = {"messages": [{"role": "user", "content": msg}],
            "temperature": 0.0, "max_tokens": max_tokens, "seed": 42,
            "stream": False}
    req = urllib.request.Request(
        f"{server}/v1/chat/completions", data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=600) as r:
        reply = json.load(r)["choices"][0]["message"]["content"] or ""
    # an unclosed reasoning block means the answer never arrived
    if "<think>" in reply and "</think>" not in reply:
        return ""
    if "</think>" in reply:
        reply = reply.split("</think>", 1)[1]
    return reply.strip()


def lid_top(text: str, model) -> str:
    text = text.strip().replace("\n", " ")
    if not text:
        return ""
    return model.predict(text, k=1)[0][0]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--holdout", required=True)
    ap.add_argument("--server", required=True, help="llama-server base URL")
    ap.add_argument("--out-prefix", required=True,
                    help="writes <prefix>-chrf.json and <prefix>-wronglang.json")
    ap.add_argument("--langs", default="en-it,en-fr,en-es,en-zh")
    ap.add_argument("--max-tokens", type=int, default=1024)
    ap.add_argument("--limit", type=int, default=0)
    a = ap.parse_args()

    model = fasttext.load_model(LID_MODEL)
    items = [json.loads(l) for l in open(a.holdout, encoding="utf-8")]
    if a.limit:
        items = items[: a.limit]

    chrf_out, wrong_out = {}, {}
    for pair in a.langs.split(","):
        en, target = pair.split("-")
        hyps = []
        for i, item in enumerate(items):
            hyps.append(translate(a.server, item["source_en"], target, a.max_tokens))
            print(f"[{pair} {i + 1}/{len(items)}] {hyps[-1][:60]!r}", flush=True)
        refs = [item["refs"][target] for item in items]

        ref_hits = sum(lid_top(r, model) == TARGET_LABEL[target] for r in refs)
        floor = (9 * len(refs) + 9) // 10  # >= 90% of the gold refs
        if ref_hits < floor:
            sys.exit(f"flores: LID self-check FAILED on {pair}: gold refs "
                     f"classify as target {ref_hits}/{len(refs)} — instrument broken")
        wrong = [int(lid_top(h, model) != TARGET_LABEL[target]) for h in hyps]
        scores = [sacrebleu.sentence_chrf(h, [r], word_order=2).score
                  for h, r in zip(hyps, refs)]
        overall = sacrebleu.corpus_chrf(hyps, [refs], word_order=2).score
        meta = {"model": a.server, "max_tokens": a.max_tokens, "lid": LID_MODEL}
        chrf_out[pair] = {"chunks": [round(s, 4) for s in scores],
                          "overall": round(overall, 4), **meta}
        wrong_out[pair] = {"chunks": wrong, "rate": round(sum(wrong) / len(wrong), 4),
                           "n_wrong": sum(wrong), **meta}
        print(f"== {pair}: chrF++ {overall:.2f}, wrong-language "
              f"{sum(wrong)}/{len(wrong)} = {wrong_out[pair]['rate']:.1%} ==")

    pathlib.Path(f"{a.out_prefix}-chrf.json").write_text(json.dumps(chrf_out, indent=1))
    pathlib.Path(f"{a.out_prefix}-wronglang.json").write_text(json.dumps(wrong_out, indent=1))
    print(f"per-sentence units -> {a.out_prefix}-{{chrf,wronglang}}.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
