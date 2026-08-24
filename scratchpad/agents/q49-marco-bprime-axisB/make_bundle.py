#!/usr/bin/env python3
"""Build blind pairs + key.json + machine_checks.csv. No quality judging."""
from __future__ import annotations

import csv
import hashlib
import json
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
PROMPT_SHA = "56574436b342d71464b58fd66982a2dbf8b9fb3f5fb14ddf12bf01cca2aacfb9"

STOP = {
    "en": {"the", "and", "of", "to", "a", "in", "is", "that", "for", "it", "on", "with", "as", "was", "be", "this"},
    "it": {"il", "lo", "la", "di", "che", "e", "un", "una", "per", "in", "è", "sono", "del", "della", "con", "non", "nel", "alla"},
    "es": {"el", "los", "las", "una", "que", "y", "un", "es", "por", "para", "como", "más", "pero", "se", "del", "año"},
    "fr": {"le", "la", "les", "de", "des", "une", "est", "dans", "du", "pour", "qui", "au", "aux", "pas", "par", "sur", "avec", "plus", "eu", "lieu"},
}


def utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def tokens_ws(s: str) -> list[str]:
    return re.findall(r"\S+", s)


def cjk_chars(s: str) -> str:
    return "".join(ch for ch in s if "\u4e00" <= ch <= "\u9fff")


def loop_flag(text: str, lang: str) -> int:
    if lang == "zh":
        seq = cjk_chars(text)
        n = 20
        if len(seq) < n * 3:
            # also check whitespace tokens
            pass
        else:
            grams = [seq[i : i + n] for i in range(len(seq) - n + 1)]
            cnt = Counter(grams)
            if cnt and cnt.most_common(1)[0][1] >= 3:
                return 1
            for i in range(len(seq) - 2 * n):
                if seq[i : i + n] == seq[i + n : i + 2 * n]:
                    return 1
    toks = tokens_ws(text)
    n = 20
    if len(toks) >= n * 3:
        grams = [" ".join(toks[i : i + n]) for i in range(len(toks) - n + 1)]
        cnt = Counter(grams)
        if cnt and cnt.most_common(1)[0][1] >= 3:
            return 1
        for i in range(len(toks) - 2 * n):
            if toks[i : i + n] == toks[i + n : i + 2 * n]:
                return 1
    # consecutive short-cycle: same 8-gram 4 times in a row
    n8 = 8
    if len(toks) >= n8 * 4:
        for i in range(len(toks) - n8 * 4 + 1):
            g = toks[i : i + n8]
            if all(toks[i + k * n8 : i + (k + 1) * n8] == g for k in range(4)):
                return 1
    return 0


def letters_only(s: str, lang: str) -> str:
    if lang == "zh":
        return cjk_chars(s)
    return "".join(ch for ch in s if ch.isalpha())


def detect_lang(text: str, expected: str | None = None) -> str:
    cjk = len(cjk_chars(text))
    letters = letters_only(text, "en")
    if cjk >= 4 and cjk >= 0.4 * (cjk + max(len(letters), 1)):
        return "zh"
    words = [w.lower().strip(".,;:!?«»\"'()[]") for w in tokens_ws(text)]
    scores = {lang: 0 for lang in STOP}
    for lang, stops in STOP.items():
        scores[lang] = sum(1 for w in words if w in stops)
    if re.search(r"[àèéìòù]", text.lower()):
        scores["it"] += 2
    if re.search(r"[áéíóúñ¿¡]", text.lower()):
        scores["es"] += 2
    if re.search(r"[âçêëïîôûœ]", text.lower()):
        scores["fr"] += 2
    mx = max(scores.values())
    if mx == 0:
        return "und"
    winners = [l for l, s in scores.items() if s == mx]
    if expected in winners:
        return expected
    return winners[0]


def format_ok(fmt: str | None, text: str) -> str:
    if not fmt:
        return ""
    t = text.strip().replace("\r\n", "\n")
    lines = t.split("\n")
    if fmt == "json_ok_n":
        try:
            obj = json.loads(t)
        except json.JSONDecodeError:
            m = re.search(r"\{.*\}", t, re.S)
            if not m:
                return "0"
            try:
                obj = json.loads(m.group(0))
            except json.JSONDecodeError:
                return "0"
        if not isinstance(obj, dict):
            return "0"
        if set(obj.keys()) != {"ok", "n"}:
            return "0"
        return "1" if obj.get("ok") is True and obj.get("n") == 7 else "0"
    if fmt == "three_lines_ready":
        if len(lines) != 3:
            return "0"
        return "1" if lines[0].strip() == "READY" and lines[1].strip() == "3" and lines[2].strip() == "END" else "0"
    if fmt == "csv_two_rows":
        body = [ln.strip() for ln in lines if ln.strip()]
        if body != ["name,year", "Ada,1815", "Alan,1912"]:
            return "0"
        return "1"
    if fmt == "xml_answer_42":
        m = re.fullmatch(r"<answer>\s*42\s*</answer>", t, re.I)
        return "1" if m else "0"
    if fmt == "hash_protocol":
        return "1" if t == "# PROTOCOL\nOK" or t == "# PROTOCOL\r\nOK" else "0"
    if fmt == "four_numbered_colors":
        want = ["1. rosso", "2. blu", "3. giallo", "4. verde"]
        got = [ln.strip() for ln in lines if ln.strip()]
        return "1" if got == want else "0"
    if fmt == "posneg_plus_sentence":
        if len(lines) < 2:
            return "0"
        if lines[0].strip() != "POSITIVO":
            return "0"
        rest = " ".join(lines[1:]).lower()
        return "1" if ("due" in rest or "2") and ("quattro" in rest or "4") else "0"
    if fmt == "yaml_torino":
        body = [ln.rstrip() for ln in lines if ln.strip() != ""]
        if not body or body[0].strip() != "---":
            return "0"
        joined = "\n".join(body)
        return "1" if re.search(r"(?m)^citta:\s*Torino\s*$", joined) else "0"
    if fmt == "three_bullets_abg":
        got = [ln.rstrip() for ln in lines if ln.strip()]
        return "1" if got == ["- alfa", "- beta", "- gamma"] else "0"
    if fmt == "data_moon":
        return "1" if t.strip() == "DATA=1969-07-20" else "0"
    return "0"


def arm_is_a(prompt_id: str) -> str:
    """Deterministic coin flip: sha256(id|q49) first byte even => control is A."""
    h = hashlib.sha256(f"{prompt_id}|q49-marco-bprime-axisB".encode()).digest()
    return "control" if h[0] % 2 == 0 else "q8_0"


def main() -> None:
    blob = (HERE / "prompts.json").read_bytes()
    if hashlib.sha256(blob).hexdigest() != PROMPT_SHA:
        raise SystemExit("prompts.json mutated after freeze")
    data = json.loads(blob.decode("utf-8"))
    gen = HERE / "gen"
    pairs = HERE / "pairs"
    pairs.mkdir(exist_ok=True)
    key = {}
    rows = []
    missing = []
    for pr in data["prompts"]:
        pid = pr["id"]
        ctrl = gen / f"{pid}__control.txt"
        q8 = gen / f"{pid}__q8_0.txt"
        if not ctrl.exists() or not q8.exists():
            missing.append(pid)
            continue
        ctext = ctrl.read_text(encoding="utf-8", errors="replace")
        qtext = q8.read_text(encoding="utf-8", errors="replace")
        a_arm = arm_is_a(pid)
        b_arm = "q8_0" if a_arm == "control" else "control"
        a_txt = ctext if a_arm == "control" else qtext
        b_txt = qtext if a_arm == "control" else ctext
        key[pid] = {"A": a_arm, "B": b_arm}
        pair = (
            f"# Pair `{pid}`\n\n"
            f"Category: `{pr['cat']}`  \n"
            f"Prompt language (do not infer arms from this): `{pr['lang']}`\n\n"
            f"Judge: pick `winner=A` or `winner=B` or `winner=tie` or `winner=undecidable`. "
            f"Do not try to guess which model is which. Prefer the response that better "
            f"follows the prompt (correctness, language of the prompt, format, no loops).\n\n"
            f"## Prompt\n\n{pr['text']}\n\n"
            f"## Response A\n\n{a_txt}\n\n"
            f"## Response B\n\n{b_txt}\n"
        )
        (pairs / f"{pid}.md").write_text(pair, encoding="utf-8")
        for arm, text in (("control", ctext), ("q8_0", qtext)):
            loop = loop_flag(text, pr["lang"])
            n_let = len(letters_only(text, pr["lang"]))
            short_fmt = pr["cat"] == "instruction" and n_let < 20
            det = detect_lang(text, expected=pr["lang"])
            if short_fmt:
                lang_ok = 1
                lang_note = "exempt_short_format"
            elif pr["cat"] == "code" and det in ("und", "en"):
                lang_ok = 1
                lang_note = f"exempt_code:{det}"
            else:
                lang_ok = 1 if det == pr["lang"] else 0
                lang_note = det
            fmt = format_ok(pr.get("format"), text)
            rows.append(
                {
                    "id": pid,
                    "arm": arm,
                    "cat": pr["cat"],
                    "lang": pr["lang"],
                    "chars": len(text),
                    "loop": loop,
                    "lang_detected": det,
                    "lang_ok": lang_ok,
                    "lang_note": lang_note,
                    "format_id": pr.get("format") or "",
                    "format_ok": fmt,
                }
            )
    if missing:
        raise SystemExit(f"missing gens: {missing[:10]} ... n={len(missing)}")
    (HERE / "key.json").write_text(
        json.dumps({"note": "BLIND JUDGE MUST NOT READ THIS FILE", "map": key}, indent=2),
        encoding="utf-8",
    )
    with (HERE / "machine_checks.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)

    def summarize(arm: str) -> dict:
        rr = [r for r in rows if r["arm"] == arm]
        return {
            "n": len(rr),
            "loop": sum(r["loop"] for r in rr),
            "lang_fail": sum(1 for r in rr if r["lang_ok"] == 0),
            "format_fail": sum(1 for r in rr if r["format_ok"] == "0"),
            "format_pass": sum(1 for r in rr if r["format_ok"] == "1"),
        }

    summary = {"control": summarize("control"), "q8_0": summarize("q8_0")}
    (HERE / "machine_checks_summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print("pairs", len(key), "checks", len(rows))
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
