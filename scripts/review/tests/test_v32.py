"""Regressions: incremental results, concurrent readers, wall-clock budgets, batch order."""

import json
import sys
import threading

import pytest

from review import batch, batch as batch_mod, pr_step, results, review, timebudget, weekly
from review.reader import client, runner
from review.verdict import TIME_VERDICT
import reader_responses
from test_v18 import TEXT_FILE, scan_files


class Clock:
    def __init__(self, now=0.0):
        self.now = now

    def __call__(self):
        return self.now

    def advance(self, seconds):
        self.now += seconds


def config(model="m"):
    return client.Config("https://example.invalid/v1", model, "k", effort="max", session="s")


def blocks(count, pad=0):
    return [
        {"id": f"b{i}", "path": f"f{i}.py", "text": f"return {i}000\n" + "x" * pad}
        for i in range(count)
    ]


def rows_for(request):
    body = request["messages"][0]["content"]
    start = body.index('"blocks": ') + len('"blocks": ')
    return [
        {"id": b["id"], "verdict": "harmless", "reason": "ok", "quoted_line": b["text"]}
        for b in json.JSONDecoder().raw_decode(body[start:])[0]
    ]


def test_readers_a_and_b_run_concurrently(monkeypatch):
    monkeypatch.setenv("REVIEW_A_BASE_URL", "https://a.invalid/v1")
    monkeypatch.setenv("REVIEW_A_MODEL", "a")
    monkeypatch.setenv("REVIEW_A_KEY", "k")
    monkeypatch.setenv("REVIEW_B_BASE_URL", "https://b.invalid/v1")
    monkeypatch.setenv("REVIEW_B_MODEL", "b")
    monkeypatch.setenv("REVIEW_B_KEY", "k")
    barrier = threading.Barrier(2, timeout=10)

    def http(cfg, request, effort):
        barrier.wait()  # deadlocks unless both readers are in flight together
        return reader_responses.results(rows_for(request))

    monkeypatch.setattr(client, "_http", http)
    a, b, decisions = runner.run(blocks(1), {}, {}, {})
    assert len(a) == 1 and len(b) == 1
    assert decisions == {"b0": "auto-clean"}


def test_groups_run_concurrently_within_the_bound(monkeypatch):
    assert client.GROUP_CONCURRENCY == 4
    live = 0
    peak = 0
    lock = threading.Lock()

    def http(cfg, request, effort):
        nonlocal live, peak
        with lock:
            live += 1
            peak = max(peak, live)
        try:
            threading.Event().wait(0.05)
            return reader_responses.results(rows_for(request))
        finally:
            with lock:
                live -= 1

    many = blocks(40, pad=4000)  # enough text to form many request groups
    budget = client.TokenBudget(limit=10_000_000)
    rows = client.read(config(), many, [], [], http=http, budget=budget)
    assert peak > 1, "groups must overlap"
    assert peak <= client.GROUP_CONCURRENCY
    assert [row["id"] for row in rows] == [block["id"] for block in many]


def test_one_verdict_per_block_id_even_when_groups_finish_out_of_order():
    def http(cfg, request, effort):
        rows = rows_for(request)
        return reader_responses.results(list(reversed(rows)))

    many = blocks(12)
    rows = client.read(config(), many, [], [], http=http)
    assert [row["id"] for row in rows] == [block["id"] for block in many]
    assert len({row["id"] for row in rows}) == len(many)
    assert all(row["verdict"] == "harmless" for row in rows)


def test_token_budget_is_thread_safe():
    # Force frequent thread switches: without a lock the read-modify-write in
    # spend() lets two threads both pass the limit check and overshoot it.
    budget = client.TokenBudget(limit=1000)
    granted = []
    lock = threading.Lock()
    previous = sys.getswitchinterval()
    sys.setswitchinterval(1e-6)

    def worker():
        for _ in range(200):
            ok = budget.spend(1)
            with lock:
                granted.append(ok)

    try:
        threads = [threading.Thread(target=worker) for _ in range(8)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
    finally:
        sys.setswitchinterval(previous)
    assert sum(granted) == 1000
    assert budget.used == 1000


def test_results_write_is_atomic(tmp_path, monkeypatch):
    monkeypatch.setenv("REVIEW_RESULTS_DIR", str(tmp_path))
    replaced = []
    real_replace = results.os.replace
    monkeypatch.setattr(results.os, "replace", lambda src, dst: replaced.append(str(dst)) or real_replace(src, dst))
    results.write("weekly", "summary", [{"id": "a"}], {"forks": 1})
    assert len(replaced) == 2
    assert (tmp_path / "weekly-results.json").is_file()


def test_started_line_precedes_each_fork(tmp_path, monkeypatch, capsys):
    reviews = tmp_path / "reviews"
    reviews.mkdir()
    monkeypatch.setattr(weekly.review, "REVIEWS", reviews)
    monkeypatch.setenv("REVIEW_RESULTS_DIR", str(tmp_path / "results"))

    def fake_scan(engine_id, *a, **k):
        (reviews / f"{engine_id}-{'a' * 40}.json").write_text(
            json.dumps({"verdict": "no findings", "blocks": [], "stats": {"files": 1}})
        )

    monkeypatch.setattr(weekly.review, "scan", fake_scan)
    monkeypatch.setattr(weekly, "_batch", lambda n: [{"id": "aaa", "head": "a" * 40}, {"id": "bbb", "head": "a" * 40}])
    monkeypatch.setattr(sys, "argv", ["weekly"])
    weekly.main()
    err = capsys.readouterr().err.splitlines()
    assert err[0] == "started aaa"
    assert "started bbb" in err
    assert err.index("started bbb") > err.index("started aaa")


def test_cancel_keeps_the_forks_already_done(tmp_path, monkeypatch):
    reviews = tmp_path / "reviews"
    reviews.mkdir()
    monkeypatch.setattr(weekly.review, "REVIEWS", reviews)
    monkeypatch.setenv("REVIEW_RESULTS_DIR", str(tmp_path / "results"))

    def fake_scan(engine_id, *a, **k):
        if engine_id == "bbb":
            raise KeyboardInterrupt("job cancelled")
        (reviews / f"{engine_id}-{'a' * 40}.json").write_text(
            json.dumps({"verdict": "no findings", "blocks": [], "stats": {"files": 1}})
        )

    monkeypatch.setattr(weekly.review, "scan", fake_scan)
    monkeypatch.setattr(weekly, "_batch", lambda n: [{"id": "aaa", "head": "a" * 40}, {"id": "bbb", "head": "a" * 40}])
    monkeypatch.setattr(sys, "argv", ["weekly"])
    with pytest.raises(KeyboardInterrupt):
        weekly.main()
    data = json.loads((tmp_path / "results" / "weekly-results.json").read_text())
    assert [record["id"] for record in data["records"]] == ["aaa"]


def test_run_deadline_stops_the_batch_cleanly(tmp_path, monkeypatch):
    monkeypatch.setenv("REVIEW_RESULTS_DIR", str(tmp_path / "results"))
    reviews = tmp_path / "reviews"
    reviews.mkdir()
    monkeypatch.setattr(weekly.review, "REVIEWS", reviews)
    clock = Clock()
    monkeypatch.setattr(timebudget, "run_deadline", lambda: timebudget.Deadline(60, clock))
    scanned = []

    def fake_scan(engine_id, *a, **k):
        scanned.append(engine_id)
        (reviews / f"{engine_id}-{'a' * 40}.json").write_text(
            json.dumps({"verdict": "no findings", "blocks": [], "stats": {"files": 1}})
        )
        clock.advance(120)

    monkeypatch.setattr(weekly.review, "scan", fake_scan)
    monkeypatch.setattr(weekly, "_batch", lambda n: [{"id": "aaa", "head": "a" * 40}, {"id": "bbb", "head": "a" * 40}])
    monkeypatch.setattr(sys, "argv", ["weekly"])
    weekly.main()
    assert scanned == ["aaa"], "the batch must stop once the run budget is spent"
    assert (tmp_path / "results" / "weekly-results.json").is_file()


def test_expired_deadline_gives_the_time_verdict(tmp_path, monkeypatch):
    clock = Clock()
    deadline = timebudget.Deadline(1, clock)
    clock.advance(2)
    rows = client.read(config(), blocks(2), [], [], deadline=deadline)
    assert [row["reason"] for row in rows] == ["time budget reached"] * 2
    data = scan_files(tmp_path, monkeypatch, TEXT_FILE, deadline=deadline)
    assert data["verdict"] == TIME_VERDICT
    assert data["stats"]["reason"] == "time exhausted"
    assert not data.get("decisions")
    path = tmp_path / "report.json"
    path.write_text(json.dumps(data))
    assert "src/mod.py" not in pr_step.digest([path], tmp_path)


def test_time_skip_is_retried_next_week():
    engines = [{"id": "aaa", "kind": "fork", "repo": "o/aaa", "upstream": "u/aaa"}]
    head = "b" * 40
    reports = {
        ("aaa", "a" * 40): {"verdict": "no findings", "created_at": "2026-01-01"},
        ("aaa", head): {"verdict": TIME_VERDICT, "created_at": "2026-02-01"},
    }
    picked = batch.pick(engines, reports, {"aaa": head}, {}, 5)
    assert [row["id"] for row in picked] == ["aaa"]
    assert picked[0]["base_sha"] == "a" * 40


def test_time_verdict_cannot_apply(tmp_path, monkeypatch):
    from review import apply as review_apply

    data = scan_files(tmp_path, monkeypatch, TEXT_FILE, deadline=timebudget.Deadline(-1))
    sha = data["inputs"]["commit"]
    reviews = tmp_path / "apply-reviews"
    reviews.mkdir()
    (reviews / f"synthetic-{sha}.json").write_text(json.dumps(data))
    catalog = tmp_path / "engines.toml"
    catalog.write_text('[[engine]]\nid = "synthetic"\nkind = "fork"\nupstream = "u/up"\nrepo = "o/fork"\n')
    monkeypatch.setattr(review_apply, "REVIEWS", reviews)
    monkeypatch.setattr(review_apply, "current_head", lambda repo, branch="": sha)
    with pytest.raises(ValueError):
        review_apply.apply_review("synthetic", catalog)


def test_batch_orders_never_reviewed_smallest_diff_first():
    engines = [
        {"id": "big", "kind": "fork", "repo": "o/big", "upstream": "u/up"},
        {"id": "small", "kind": "fork", "repo": "o/small", "upstream": "u/up"},
    ]
    heads = {"big": "b" * 40, "small": "s" * 40}
    picked = batch_mod.pick(engines, {}, heads, {"big": 900000, "small": 12}, 5)
    assert [row["id"] for row in picked] == ["small", "big"]


def test_weekly_populates_diff_sizes(monkeypatch):
    engines = [
        {"id": "big", "kind": "fork", "repo": "o/big", "upstream": "u/up"},
        {"id": "small", "kind": "fork", "repo": "o/small", "upstream": "u/up"},
    ]
    monkeypatch.setattr(weekly.catalog, "load", lambda: {"engine": engines})
    monkeypatch.setattr(weekly.github, "token", lambda: "t")
    monkeypatch.setattr(weekly.github, "fork_head", lambda repo, token: ("h" * 40, "main"))
    monkeypatch.setattr(weekly.github, "default_branch", lambda repo, token: "master")
    monkeypatch.setattr(weekly, "_reports", lambda: {})
    sizes = {"o/big": 900000, "o/small": 12}
    monkeypatch.setattr(weekly.github, "diff_size", lambda repo, base, head, token: sizes[repo])
    rows = weekly._batch(5)
    assert [row["id"] for row in rows] == ["small", "big"]
