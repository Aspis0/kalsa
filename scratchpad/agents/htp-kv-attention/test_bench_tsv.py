"""Unit check of the llama-bench markdown parser on a saved lab sample."""

from pathlib import Path

import bench_tsv

HERE = Path(__file__).parent


def test_parses_saved_lab_sample():
    text = (HERE / "bench-sample.md").read_text()
    rows = bench_tsv.parse_markdown(text)
    assert len(rows) == 1
    assert rows[0]["test"] == "pp64"
    assert rows[0]["mean_ts"] == 511.18
    assert rows[0]["std_ts"] == 0.00
    assert bench_tsv.depth_of(rows[0]["test"]) == 0


def test_parses_depth_row_and_per_chunk_ms():
    # Same cell spelling as the saved sample, with the depth suffix llama-bench
    # appends when -d is set ("pp128 @ d1700", llama-bench.cpp at 5b596ce43).
    row = "| lfm2 2.6B Q4_0 | 1.48 GiB | 2.70 B | HTP | 99 | HTP0 | pp128 @ d1700 | 107.33 ± 1.10 |"
    rows = bench_tsv.parse_markdown(row)
    assert rows[0]["test"] == "pp128 @ d1700"
    assert rows[0]["mean_ts"] == 107.33
    assert bench_tsv.depth_of(rows[0]["test"]) == 1700
    line = bench_tsv.tsv_line(
        type("Arm", (), {"name": "A-nkvo", "ctk": "q8_0", "ctv": "q8_0",
                         "nkvo": 1})(),
        rows[0], "auto", 1, "q8_0", "q8_0", "A-nkvo.log", chunk_tokens=128)
    fields = line.split("\t")
    # per-chunk ms = 128 tokens / 107.33 tok/s * 1000 = 1192.6 ms
    assert fields[1] == "1700" and fields[7] == "107.33"
    assert fields[8] == "1192.6"


def test_skips_separator_and_non_bench_rows():
    text = (HERE / "bench-sample.md").read_text() + "\nsome stray line\n"
    assert len(bench_tsv.parse_markdown(text)) == 1
    assert bench_tsv.parse_markdown("no table here") == []
