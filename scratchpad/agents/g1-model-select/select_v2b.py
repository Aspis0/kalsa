#!/usr/bin/env python3
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent
RESULTS = ROOT / "results"


def rows(path):
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def affected(row, bakeoff=False):
    finish = row.get("finish")
    if not bakeoff:
        choices = (row.get("raw_response") or {}).get("choices") or []
        finish = choices[0].get("finish_reason") if choices else None
    content = row.get("content", "") if bakeoff else row.get("assistant_text_raw", "")
    return finish == "tool_calls" or not content


def main():
    selection_dir = RESULTS / "v2b-selection"
    selection_dir.mkdir(parents=True, exist_ok=True)
    affected_rows = []
    for model in ("lfm", "minicpm"):
        wild = [(row["id"], row) for row in rows(RESULTS / "wild-v2" / f"{model}.jsonl") if affected(row)]
        path = selection_dir / f"{model}-wild.txt"
        path.write_text("\n".join(row_id for row_id, _ in wild) + ("\n" if wild else ""), encoding="utf-8")
        for row_id, _row in wild:
            affected_rows.append((model, "wild", row_id))
        for budget in (256, 512):
            selected = []
            for row in rows(RESULTS / "bakeoff-v2" / f"{model}@{budget}.jsonl"):
                if affected(row, bakeoff=True):
                    selected.append(f"{row['qid']}|{row['lang']}")
                    affected_rows.append((model, f"bakeoff@{budget}", f"{row['qid']}|{row['lang']}"))
            (selection_dir / f"{model}-bakeoff-{budget}.txt").write_text(
                "\n".join(selected) + ("\n" if selected else ""), encoding="utf-8")
    with (RESULTS / "v2b-affected-ids.txt").open("w", encoding="utf-8") as handle:
        for model, block, row_id in affected_rows:
            handle.write(f"{model}\t{block}\t{row_id}\n")
    print(f"selected={len(affected_rows)} rows")
    for model in ("lfm", "minicpm"):
        for block in ("wild", "bakeoff@256", "bakeoff@512"):
            print(model, block, sum(1 for item in affected_rows if item[:2] == (model, block)))


if __name__ == "__main__":
    main()
