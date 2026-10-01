#!/usr/bin/env python3
"""Self-test for eval/run_flores.py — truncation vs wrong-language (audit B4).

The 1.2B smoke model never emits <think>, so the thinking-model path is
covered here on canned replies: think-stripping, the truncation shapes
(length cut, unclosed block, answer stuck in reasoning_content), a
truncated item excluded from the wrong-language denominator while chunks
stay full-length, and the metric labels bootstrap_ci prints (audit M11).

Run: ~/kalsa-models/venv-eval/bin/python eval/test_flores_logic.py
(exit 0 = all cases pass; needs fasttext + sacrebleu + lid.176.bin)
"""

import json
import pathlib
import subprocess
import sys
import tempfile

import fasttext

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import run_flores as rf  # noqa: E402


def reply(content: str, finish: str = "stop", reasoning: str = "") -> dict:
    return {"content": content, "reasoning_content": reasoning,
            "tool_calls": [], "finish_reason": finish}


def check(name: str, got, want, log: list) -> None:
    ok = got == want
    print(f"{name}: got {got!r} want {want!r} -> {'ok' if ok else 'FAIL'}")
    if not ok:
        log.append(name)


def main() -> int:
    log: list = []

    # think-stripping, three shapes
    check("strip closed think",
          rf.strip_think("<think>hmm</think>Ciao."), "Ciao.", log)
    check("strip two closed blocks",
          rf.strip_think("<think>a</think>Salut <think>b</think>!"), "Salut !", log)
    check("unclosed think keeps nothing after opener",
          rf.strip_think("Bonjour <think>hmm"), "Bonjour ", log)

    # the truncation shapes (B4): none of these may count wrong-language
    ans, trunc = rf.final_answer(reply("<think>still going", "length"))
    check("unclosed think + length cut -> truncated", (ans, trunc), ("", True), log)
    ans, trunc = rf.final_answer(reply("<think>long</think>Ecco.", "length"))
    check("length cut after closed think -> truncated", trunc, True, log)
    ans, trunc = rf.final_answer(reply("", "stop", reasoning="reasoning only"))
    check("answer stuck in reasoning_content -> truncated", (ans, trunc), ("", True), log)
    ans, trunc = rf.final_answer(reply("<think>thought</think>Voilà."))
    check("closed think -> clean answer, not truncated", (ans, trunc),
          ("Voilà.", False), log)
    ans, trunc = rf.final_answer(reply(""))
    check("honest empty answer is NOT truncated (it IS wrong-language)",
          (ans, trunc), ("", False), log)

    # score_pair on canned items with the REAL lid model (instrument check)
    model = fasttext.load_model(rf.LID_MODEL)
    refs_it = ["Questa è una frase di prova numero uno.",
               "Questa è una frase di prova numero due.",
               "Questa è una frase di prova numero tre.",
               "Questa è una frase di prova numero quattro."]
    recs = [
        {"answer": "Questa è una frase di prova numero uno.", "truncated": 0},
        {"answer": "This is a test sentence number two.", "truncated": 0},
        {"answer": "", "truncated": 1},  # cut mid-think: excluded, not wrong-lang
        {"answer": "Questa è una frase di prova numero quattro.", "truncated": 0},
    ]
    meta = {"model": "test", "max_tokens": 4096, "lid": rf.LID_MODEL}
    chrf, wrong, n_trunc = rf.score_pair("en-it", recs, refs_it, model, meta)
    check("truncated count", n_trunc, 1, log)
    check("wrong-language counted on NON-truncated only", wrong["n_wrong"], 1, log)
    check("rate denominator excludes truncated", wrong["rate"], round(1 / 3, 4), log)
    check("chunks stay full-length for pairing", len(wrong["chunks"]), 4, log)
    check("truncated slot in chunks is 0", wrong["chunks"][2], 0, log)
    check("per-item truncated flags recorded", wrong["truncated"], [0, 0, 1, 0], log)
    check("chrf over all items (truncation hurts quality)", len(chrf["chunks"]), 4, log)
    check("metric labels for bootstrap_ci (M11)",
          (chrf["metric"], wrong["metric"]), ("chrf_pp", "wrong_language"), log)

    # an all-truncated pair reports rate 0.0 — the 2% rule fails the run instead
    _, wrong_all, n_trunc_all = rf.score_pair(
        "en-it", [{"answer": "", "truncated": 1}] * 4, refs_it, model, meta)
    check("all truncated -> rate 0.0 but n_scored 0",
          (wrong_all["rate"], wrong_all["n_scored"]), (0.0, 0), log)

    # bootstrap_ci prints the file's metric, not a bare "bpb" (M11)
    with tempfile.TemporaryDirectory() as tmp:
        for side in "ab":
            pathlib.Path(tmp, side + ".json").write_text(json.dumps(
                {"en-it": {"chunks": [0, 1, 0, 0], "rate": 0.25,
                           "metric": "wrong_language"}}))
        out = subprocess.run(
            [sys.executable, str(pathlib.Path(__file__).parent / "bootstrap_ci.py"),
             "--a", tmp + "/a.json", "--b", tmp + "/b.json", "--bpb"],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        check("bootstrap_ci label from file metric",
              out.stdout.startswith("wrong_language en-it:"), True, log)

    print(f"\n{'ALL OK' if not log else 'FAILED: ' + ', '.join(log)}")
    return 1 if log else 0


if __name__ == "__main__":
    sys.exit(main())
