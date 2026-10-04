#!/usr/bin/env python3
"""CORD test receipts → the lab's dataset shape (one responsibility: extract).

Reads the CORD v1 test parquet (CC BY 4.0, © Clova AI — cite in any output),
writes the first N receipts whose ground truth has a parseable total and at
least one menu item, as <out>/cord-<id>.png plus one <out>/cord-<id>.json in
the lab's normalized shape:

    {"kind": "cord", "merchant": null, "total": 60000.0,
     "items": [{"name": "-TICKET CP", "price": 60000.0}], "raw_total": "60.000"}

Indonesian amount convention (thousands '.', decimals ','): "60.000" is sixty
thousand. The parsed float goes in "total"; the printed string in "raw_total".
"""
import json
import sys
from pathlib import Path

import pyarrow.parquet as pq


def idr_amount(text):
    """An Indonesian-formatted amount → float, or None when not an amount."""
    if not isinstance(text, str) or not text.strip():
        return None
    t = text.strip().replace("Rp", "").replace(" ", "")
    if not any(c.isdigit() for c in t):
        return None
    # Thousands are '.', decimals are ','; the common shape is integral IDR.
    if "," in t:
        whole, _, frac = t.partition(",")
        return float(whole.replace(".", "") or "0") + float("0." + frac if frac else 0)
    return float(t.replace(".", "")) if "." in t else float(t)


def menu_items(menu):
    items = []
    entries = menu if isinstance(menu, list) else [menu]
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        name = entry.get("nm")
        price = idr_amount(entry.get("price"))
        if name is None or price is None:
            continue
        items.append({"name": name.strip(), "price": price})
    return items


def main(parquet_path, out_dir, count):
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    pf = pq.ParquetFile(parquet_path)
    written = 0
    manifest = []
    for batch in pf.iter_batches(batch_size=8):
        for row in batch.to_pylist():
            if written >= count:
                break
            gt = json.loads(row["ground_truth"])["gt_parse"]
            total = idr_amount(gt.get("total", {}).get("total_price"))
            items = menu_items(gt.get("menu", []))
            if total is None or not items:
                continue
            image_id = json.loads(row["ground_truth"])["meta"]["image_id"]
            stem = f"cord-{image_id:03d}"
            (out / f"{stem}.png").write_bytes(row["image"]["bytes"])
            record = {
                "kind": "cord",
                "merchant": None,
                "total": total,
                "raw_total": gt["total"]["total_price"],
                "items": items,
                "licence": "CORD v1 (c) Clova AI, CC BY 4.0",
            }
            (out / f"{stem}.json").write_text(json.dumps(record, ensure_ascii=False, indent=1))
            manifest.append(stem)
            written += 1
        if written >= count:
            break
    print(f"extracted {written} receipts: {', '.join(manifest[:5])} ...")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 20)
