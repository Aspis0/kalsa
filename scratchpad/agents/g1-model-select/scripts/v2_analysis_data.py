import json
from pathlib import Path


def read_jsonl(path):
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def row_id(row):
    return row.get("id") or f"bakeoff/{row['qid']}/{row['lang']}"


def model_name(row):
    value = str(row.get("model_label") or row.get("model") or "").lower()
    return "LFM" if value.startswith("lfm") else "MiniCPM5"


def annotate(row, model, run):
    row = dict(row)
    row["_model"] = model
    row["_run"] = run
    row["_id"] = row_id(row)
    return row


def affected_ids(root):
    result = set()
    for line in (root / "results" / "v2b-affected-ids.txt").read_text().splitlines():
        model, cell, value = line.split("\t")
        run = "v2-wild" if cell == "wild" else f"v2@{cell.rsplit('@', 1)[-1]}"
        case_id = value if cell == "wild" else f"bakeoff/{value.replace('|', '/') }"
        result.add((model, run, case_id))
    return result


def load_effective_v2(root):
    rows = []
    affected = affected_ids(root)
    for label, model in (("lfm", "LFM"), ("minicpm", "MiniCPM5")):
        for budget in (256, 512):
            run = f"v2@{budget}"
            base = read_jsonl(root / "results" / "bakeoff-v2" / f"{label}@{budget}.jsonl")
            repair = {row_id(r): r for r in read_jsonl(root / "results" / "bakeoff-v2b" / f"{label}@{budget}.jsonl") if (label, run, row_id(r)) in affected}
            rows.extend(annotate(repair.get(row_id(row), row), model, run) for row in base)
        base = read_jsonl(root / "results" / "wild-v2" / f"{label}.jsonl")
        repair = {row_id(r): r for r in read_jsonl(root / "results" / "wild-v2b" / f"{label}.jsonl") if (label, "v2-wild", row_id(r)) in affected}
        rows.extend(annotate(repair.get(row_id(row), row), model, "v2-wild") for row in base)
    return rows


def load_later(root):
    rows = []
    for dirname, run in (("bakeoff-v2c", None), ("wild-v2c", None), ("bakeoff-v2d", "v2d"), ("wild-v2d", "v2d")):
        for path in sorted((root / "results" / dirname).glob("*.jsonl")):
            stem = path.stem
            if dirname.endswith("v2c"):
                run = "v2c-" + stem.rsplit("@", 1)[-1]
            for row in read_jsonl(path):
                rows.append(annotate(row, model_name(row), run))
    return rows


def judge_files(root, spec):
    if spec == "v2":
        directory, prefix = root / "results", "results/"
    else:
        directory, prefix = root / "results", ""
    key = json.loads((directory / f"judge-key-{spec}.json").read_text())
    files = [root / f"{prefix}judge-A-deepseek-{spec}.jsonl", root / f"{prefix}judge-B-mimo-{spec}.jsonl"]
    return key, [read_jsonl(path) for path in files]


def effective_v2_judges(root):
    base_key, base_files = judge_files(root, "v2")
    repair_key, repair_files = judge_files(root, "v2b")
    base = {}
    repair = {}
    for verdicts, target in ((base_files, base), (repair_files, repair)):
        for rows in verdicts:
            for row in rows:
                target.setdefault(row["id"], []).append(row)
    verdicts = []
    for case_id, mapping in base_key.items():
        selected = repair.get(case_id, base[case_id])
        selected_mapping = repair_key.get(case_id, mapping)
        verdicts.extend((case_id, verdict, selected_mapping) for verdict in selected)
    return verdicts


def direct_judges(root, spec):
    key, files = judge_files(root, spec)
    return [(row["id"], row, key[row["id"]]) for rows in files for row in rows]
