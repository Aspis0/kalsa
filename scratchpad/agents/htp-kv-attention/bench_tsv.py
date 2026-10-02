"""Parse llama-bench markdown tables into the campaign TSV rows."""

import re

# Markdown row: | value | value | ... | — the parser only names the columns it
# keeps (test, t/s); the others are positional filler. llama-bench renders the
# test name as pp<N>, tg<N>, pp<N>+tg<M> with " @ d<D>" appended when a depth
# was set (tools/llama-bench/llama-bench.cpp at 5b596ce43).
ROW = re.compile(r"^\|\s*(.+?)\s*\|$")
CELL_SPLIT = re.compile(r"\s*\|\s*")
TS = re.compile(r"^([0-9.]+)\s*±\s*([0-9.]+)$")
DEPTH = re.compile(r"@ d(\d+)$")

TSV_HEADER = ["arm", "depth", "fa", "nkvo", "ctk", "ctv", "test",
              "pp_tok_s", "per_chunk_ms", "src_log"]


def parse_markdown(text):
    """Return [{test, mean_ts, std_ts}] for every data row of the table."""
    rows = []
    for line in text.splitlines():
        if not line.startswith("|"):
            continue
        cells = [c for c in CELL_SPLIT.split(line.strip().strip("|"))]
        if len(cells) < 2 or set(cells[0]) <= {"-", " ", ":"}:
            continue  # the header separator renders as dashes
        if cells[-1].replace(".", "", 1).replace(" ", "") == "":
            continue
        m = TS.match(cells[-1].strip())
        if not m or "pp" not in cells[-2] and "tg" not in cells[-2]:
            continue
        rows.append({
            "test": cells[-2].strip(),
            "mean_ts": float(m.group(1)),
            "std_ts": float(m.group(2)),
        })
    return rows


def depth_of(test):
    m = DEPTH.search(test)
    return int(m.group(1)) if m else 0


def tsv_line(arm, parsed, fa, nkvo, ctk, ctv, src_log, chunk_tokens):
    ms = chunk_tokens / parsed["mean_ts"] * 1000.0
    fields = [arm.name, str(depth_of(parsed["test"])), fa, str(nkvo),
              ctk, ctv, parsed["test"], f"{parsed['mean_ts']:.2f}",
              f"{ms:.1f}", src_log]
    return "\t".join(fields)
