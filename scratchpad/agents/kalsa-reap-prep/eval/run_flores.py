#!/usr/bin/env python3
"""FLORES-200 devtest translation eval: chrF++ + wrong-language rate.

EN -> {IT,FR,ES,ZH} over eval/flores-devtest-100.jsonl (build_flores_holdout.py,
CC-BY-SA-4.0). Greedy via the llama.cpp server's /v1/chat/completions (the
server owns the chat template — same product-parity conditions as
run_gen_eval.py). Two metrics per pair:

  chrF++           sacrebleu with word_order=2, over ALL items; the
                   per-sentence chrF values are the paired-bootstrap units
  wrong-language   fastText lid.176.bin (~/kalsa-models/lid.176.bin) top-1
                   label != target, over NON-TRUNCATED items only (audit
                   B4): a truncated item is a token-budget artifact, not a
                   wrong-language answer, and is EXCLUDED from the
                   denominator. `chunks` stays full-length (truncated items
                   carry 0) so two arms' chunk lists stay pairwise aligned
                   for eval/bootstrap_ci.py.

Truncated means any of: finish_reason "length", an unclosed <think>, or a
reply whose text never left the reasoning channel (empty content but
non-empty reasoning_content — audit M10). The run FAILS (exit 1, after the
JSONs are written) when truncations exceed 2% of all items: a 35B thinking
model that cannot finish inside --max-tokens (default 4096) invalidates the
pair's rate.

Instrument self-check: the GOLD references must classify as their target
language for >= 90% of items, else the LID instrument is broken and the run
fails. lid.176 has one Chinese label (`zh`), so a traditional-Chinese answer
counts as correct language there — the metric targets the wrong-LANGUAGE
failure mode (e.g. English answers), not the character-variant one.

Outputs (bpb-shaped, so the EXISTING eval/bootstrap_ci.py --bpb pairs them;
each file records "metric" so the CI tool prints the right label):
  <out-prefix>-chrf.json       {"<en-xx>": {"chunks": [chrF...], "overall": X}}
  <out-prefix>-wronglang.json  {"<en-xx>": {"chunks": [0|1...], "rate": R, ...}}
Items append to <out-prefix>.journal as they complete; a rerun skips done
(pair, id) pairs (audit H4).

Usage: run_flores.py --holdout flores-devtest-100.jsonl --server URL
                     --out-prefix results/arm/flores [--limit N]
                     [--max-tokens 4096] [--concurrency N]
"""

import argparse
import json
import pathlib
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed

import fasttext
import sacrebleu

import journal as journal_mod
import server

TARGET_LABEL = {"it": "__label__it", "fr": "__label__fr",
                "es": "__label__es", "zh": "__label__zh"}
TARGET_NAME = {"it": "Italian", "fr": "French", "es": "Spanish",
               "zh": "Chinese (Simplified)"}
LID_MODEL = str(pathlib.Path.home() / "kalsa-models" / "lid.176.bin")


def strip_think(text: str) -> str:
    """Drop closed <think>...</think> blocks (server-inline reasoning)."""
    while "<think>" in text:
        start = text.index("<think>")
        end = text.find("</think>", start)
        if end == -1:
            return text[:start]  # unclosed: nothing after the block opener
        text = text[:start] + text[end + len("</think>"):]
    return text


def final_answer(reply: dict) -> tuple[str, bool]:
    """(answer, truncated) — the audit B4 separation: a truncated item is a
    token-budget artifact, never a wrong-language answer."""
    content = reply["content"]
    answer_never_left_reasoning = not content.strip() and reply["reasoning_content"].strip()
    if reply["finish_reason"] == "length" or answer_never_left_reasoning:
        return strip_think(content).strip(), True
    if "<think>" in content and "</think>" not in content:
        return "", True  # still inside reasoning at the cap: no answer
    return strip_think(content).strip(), False


def lid_top(text: str, model) -> str:
    text = text.strip().replace("\n", " ")
    if not text:
        return ""
    return model.predict(text, k=1)[0][0]


def score_pair(pair: str, recs: list, refs: list, model, meta: dict) -> tuple[dict, dict, int]:
    """chrF++ over ALL items; wrong-language over NON-TRUNCATED items only
    (audit B4). `chunks` in both outputs stay full-length (truncated items
    carry 0) so two arms' chunk lists stay pairwise aligned for
    eval/bootstrap_ci.py. Returns (chrf_entry, wronglang_entry, n_truncated)."""
    target = pair.split("-")[1]
    target_label = TARGET_LABEL[target]
    ref_hits = sum(lid_top(r, model) == target_label for r in refs)
    floor = (9 * len(refs) + 9) // 10  # >= 90% of the gold refs
    if ref_hits < floor:
        sys.exit(f"flores: LID self-check FAILED on {pair}: gold refs "
                 f"classify as target {ref_hits}/{len(refs)} — instrument broken")

    hyps = [r["answer"] for r in recs]
    trunc = [r["truncated"] for r in recs]
    n_trunc = sum(trunc)
    wrong = [0 if t else int(lid_top(h, model) != target_label)
             for h, t in zip(hyps, trunc)]
    n_scored = len(recs) - n_trunc
    n_wrong = sum(wrong)
    rate = round(n_wrong / n_scored, 4) if n_scored else 0.0
    scores = [sacrebleu.sentence_chrf(h, [r], word_order=2).score
              for h, r in zip(hyps, refs)]
    overall = sacrebleu.corpus_chrf(hyps, [refs], word_order=2).score
    chrf = {"chunks": [round(s, 4) for s in scores],
            "overall": round(overall, 4), "metric": "chrf_pp", **meta}
    wronglang = {"chunks": wrong, "rate": rate, "n_wrong": n_wrong,
                 "n_scored": n_scored, "n_truncated": n_trunc,
                 "truncated": trunc, "metric": "wrong_language", **meta}
    return chrf, wronglang, n_trunc


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--holdout", required=True)
    ap.add_argument("--server", required=True, help="llama-server base URL")
    ap.add_argument("--out-prefix", required=True,
                    help="writes <prefix>-chrf.json and <prefix>-wronglang.json")
    ap.add_argument("--langs", default="en-it,en-fr,en-es,en-zh")
    ap.add_argument("--max-tokens", type=int, default=4096,
                    help="reasoning budget: a translation must survive the "
                         "<think> block (1024 truncated a thinking model)")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--concurrency", type=int, default=1,
                    help="parallel requests — set to the server's -np slot count")
    a = ap.parse_args()

    model = fasttext.load_model(LID_MODEL)
    items = [json.loads(l) for l in open(a.holdout, encoding="utf-8")]
    if a.limit:
        items = items[: a.limit]
    pairs = a.langs.split(",")
    jrnl = journal_mod.Journal(
        pathlib.Path(a.out_prefix + ".journal"),
        [f"{pair}:{it['id']}" for pair in pairs for it in items])
    pending = [(pair, it) for pair in pairs for it in items
               if f"{pair}:{it['id']}" not in jrnl.done_ids]
    done = len(pairs) * len(items) - len(pending)

    def work(pair_item: tuple) -> dict:
        pair, item = pair_item
        target = pair.split("-")[1]
        msg = (f"Translate the following English text into {TARGET_NAME[target]}. "
               f"Reply with the translation only.\n\n{item['source_en']}")
        reply = server.chat(a.server, [{"role": "user", "content": msg}],
                            a.max_tokens)
        answer, truncated = final_answer(reply)
        return {"id": f"{pair}:{item['id']}", "pair": pair,
                "finish_reason": reply["finish_reason"],
                "truncated": int(truncated), "raw": reply["content"],
                "reasoning": reply["reasoning_content"], "answer": answer}

    def run_all() -> None:
        if a.concurrency <= 1:
            for i, pi in enumerate(pending):
                rec = work(pi)
                jrnl.append(rec)
                print(f"[{pi[0]} {done + i + 1}/{len(pairs) * len(items)}] "
                      f"{rec['answer'][:60]!r}", flush=True)
        else:
            with ThreadPoolExecutor(max_workers=a.concurrency) as ex:
                futs = [ex.submit(work, pi) for pi in pending]
                for i, fut in enumerate(as_completed(futs), start=done + 1):
                    rec = fut.result()
                    jrnl.append(rec)
                    print(f"[{rec['pair']} {i}/{len(pairs) * len(items)}] "
                          f"{rec['answer'][:60]!r}", flush=True)

    run_all()
    jrnl.close()

    by_key = {r["id"]: r for r in jrnl.records()}
    chrf_out, wrong_out, n_trunc_total = {}, {}, 0
    meta = {"model": a.server, "max_tokens": a.max_tokens, "lid": LID_MODEL}
    for pair in pairs:
        recs = [by_key[f"{pair}:{it['id']}"] for it in items]  # holdout order
        refs = [it["refs"][pair.split("-")[1]] for it in items]
        chrf_out[pair], wrong_out[pair], n_trunc = score_pair(
            pair, recs, refs, model, meta)
        n_trunc_total += n_trunc
        w = wrong_out[pair]
        print(f"== {pair}: chrF++ {chrf_out[pair]['overall']:.2f}, wrong-language "
              f"{w['n_wrong']}/{w['n_scored']} = {w['rate']:.1%}, "
              f"truncated {n_trunc}/{len(items)} ==")

    pathlib.Path(f"{a.out_prefix}-chrf.json").write_text(json.dumps(chrf_out, indent=1))
    pathlib.Path(f"{a.out_prefix}-wronglang.json").write_text(json.dumps(wrong_out, indent=1))
    print(f"per-sentence units -> {a.out_prefix}-{{chrf,wronglang}}.json")
    if n_trunc_total > 0.02 * len(pairs) * len(items):
        print(f"flores: TRUNCATION {n_trunc_total}/{len(pairs) * len(items)} "
              f"exceeds 2% — the token budget cut answers mid-think; the "
              f"wrong-language rates above are NOT clean", flush=True)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
