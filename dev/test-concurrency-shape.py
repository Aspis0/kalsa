#!/usr/bin/env python3
"""Shape control for the N-stream concurrency artifact - offline.

No engine, no network, no writes into dev/results/: the result dict is built
from SYNTHETIC arms through mc.build_result() and compared with the
COMMITTED artifact's key tree, and the engine argv is pinned against the
committed provenance.argv element for element.

  (1) engine_argv at N=2, fed the committed artifact's own inputs (bin,
      model, port, ctx-size, slots-dir, streams=parallel as recorded),
      equals provenance.argv EXACTLY: at N=2 the argv is still what it was,
      every flag included.
  (2) build_result fed synthetic arms at N=2 yields the committed
      artifact's key tree - every committed path present, and the only
      NEW paths are the listed provenance additions:
      provenance.context_size_per_slot (commit 2),
      provenance.ctx_checkpoints / provenance.flash_attn (commit 3: null
      when the flag was not rendered), and
      provenance.release.status_by_exe_sha256 / provenance.release.identity.*
      (commit 1's veto fields, which live under provenance.release).
      Anything else new, or anything missing, is red.
  (3) at N=4: `--parallel` appears in engine_argv exactly once and carries
      "4"; build_result yields per_stream_slot0..3_over_A,
      tokens_per_second.B_slot0..3 + B_aggregate, arms.B_four_slots with
      slot0..slot3, provenance.parallel == 4, context_size_per_slot =
      ctx_size // 4, and a question that says 4 devices.
  (4) the launch flags: at defaults NEITHER is in the argv (and the argv is
      still the committed one); given a value it lands as the exact PAIR,
      exactly once, in the app's position - and `--ctx-checkpoints 1` does
      NOT pass for `12` (the substring trap, pinned: joining the argv would
      yield "--ctx-checkpoints 12", which contains "--ctx-checkpoints 1").

The synthetic arm records mirror run_one()/run_streams() key for key (the
engine lines are produced by mc.extract() itself, from lines in the
engine's own format), so the comparison bites on the generator, not on the
fixture: delete a key from build_result's dict and this goes red.

Exit 0 green, 1 a check failed, 2 the committed artifact is missing.

Run: python3 dev/test-concurrency-shape.py
"""

import argparse
import importlib.util
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ARTIFACT = HERE / "results" / "concurrency-two-devices" / "results.json"

if not ARTIFACT.exists():
    print(f"cannot run: missing {ARTIFACT}", file=sys.stderr)
    sys.exit(2)

spec = importlib.util.spec_from_file_location("mconc", HERE / "measure-concurrency.py")
mc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mc)

COMMITTED = json.loads(ARTIFACT.read_text())

# The ONLY paths the built result may add beyond the committed artifact's -
# each one introduced by this work and listed in its commit message. A new
# unlisted key anywhere (provenance included) turns case (2) red.
EXPECTED_EXTRA = {
    "provenance.context_size_per_slot",
    "provenance.ctx_checkpoints",
    "provenance.flash_attn",
    "provenance.release.status_by_exe_sha256",
    "provenance.release.identity",
} | {f"provenance.release.identity.{k}" for k in (
    "why", "module_file", "module_path", "module_sha256", "version_full",
    "version_commit", "manifest_commit", "commit_agrees", "ok")}

FAILED = 0


def check(name, ok, detail=""):
    global FAILED
    if not ok:
        FAILED += 1
    print(f"  [{'ok' if ok else 'FAIL'}] {name}"
          + (f": {detail}" if detail else ""), file=sys.stderr)


def key_paths(obj, prefix=""):
    """Every key path of a nested structure; list elements share one `[]`."""
    paths = set()
    if isinstance(obj, dict):
        for k, v in obj.items():
            p = f"{prefix}.{k}" if prefix else str(k)
            paths.add(p)
            paths |= key_paths(v, p)
    elif isinstance(obj, list):
        for v in obj:
            paths |= key_paths(v, prefix + "[]")
    return paths


# --------------------------------------------------------------- synthetic arms
ENGINE_LINES = (
    "0.00.000.000 I slot print_timing: id {k:2d} | task 1 | n_gen =    157, "
    "tg =  51.85 t/s, tg_3s =  52.18 t/s",
    "0.00.000.001 I slot print_timing: id {k:2d} | task 1 | prompt eval time "
    "=     479.54 ms /   512 tokens (    0.94 ms per token,  1067.69 tokens "
    "per second)",
    "0.00.000.002 I slot print_timing: id {k:2d} | task 1 |        eval time "
    "=    3612.09 ms /   256 tokens (   14.17 ms per token,    70.60 tokens "
    "per second)",
)


def raw_lines(slot):
    return [t.format(k=slot) for t in ENGINE_LINES]


def engine_lines_for(slot):
    return mc.extract(raw_lines(slot))


def solo_record(slot, pps):
    """A run_one()-shaped record: same keys, same order, synthetic values."""
    return {
        "slot": slot,
        "salt_label": "f" * 16,
        "status": 200,
        "wall_ms": 1000.0 + slot,
        "loadavg_at_start": [1.0, 1.0, 1.0],
        "tokens_evaluated": 512,
        "tokens_predicted": 256,
        "stop_type": "length",
        "cache_n": 0,
        "prompt_n": 512,
        "prompt_ms": 480.0,
        "prompt_per_second": 1067.0,
        "predicted_n": 256,
        "predicted_ms": 3600.0,
        "predicted_per_second": pps,
        "engine_lines": engine_lines_for(slot),
    }


def b_arm(n):
    """A run_streams()-shaped arm: slot{k} plus the arm's own line splits."""
    all_lines = [ln for k in range(n) for ln in raw_lines(k)]
    arm = {f"slot{k}": solo_record(k, 60.0 - k) for k in range(n)}
    for k in range(n):
        arm[f"slot{k}"]["engine_lines"] = []   # run_streams() empties them
    arm["engine_lines"] = mc.extract(all_lines)
    for k in range(n):
        arm[f"engine_lines_slot{k}"] = [x for x in arm["engine_lines"]
                                        if x["slot"] == k]
    arm["arm_wall_ms"] = 999.0
    arm["loadavg_at_start"] = [1.0, 1.0, 1.0]
    return arm


def synthetic_attempt(n, index=0):
    a = solo_record(0, 80.0)
    b = b_arm(n)
    a2 = solo_record(0, 81.0)
    return {"index": index, "A_solo_slot0": a, mc.ARM_KEYS[n]: b,
            "A2_solo_repeat": a2, "A2_over_A": 1.0123, "bracket_ok": True}


def fake_args(**over):
    """The Namespace main() builds from the parser; only values differ, and
    no value is this test's subject except where a case says otherwise."""
    base = dict(port=19311, out="results.json", log="server.log",
                slots_dir="/tmp/slots", bin=COMMITTED["provenance"]["engine_binary"],
                # build_result hashes args.model; the gguf's VALUE is not the
                # subject here (and a later reader may not have the file), so
                # a small committed file stands in.
                model=str(ARTIFACT),
                ctx_size=COMMITTED["provenance"]["context_size_total"],
                streams=COMMITTED["provenance"]["parallel"],
                n_predict=256, prompt_tokens=512, attempts=4,
                bracket_tol=0.03, keep_server=False, max_load=6.0,
                release_manifest_url=None,
                # commit 3's launch flags: unrendered by default, null in
                # provenance - run_parameters reads them off the namespace.
                ctx_checkpoints=None, flash_attn=None)
    base.update(over)
    return argparse.Namespace(**base)


def build(args):
    """build_result exactly as main() feeds it, with synthetic arms."""
    n = args.streams
    attempt = synthetic_attempt(n)
    release = dict(COMMITTED["provenance"]["release"])
    release["status_by_exe_sha256"] = release["status"]
    release["identity"] = mc.engine_identity(
        "/nowhere/kalsa-server",
        "version: 0.4.1-dev (build 11195, commit deadbeefcafe)",
        release)
    argv = mc.engine_argv(args.bin, args.model, args.port, args.ctx_size,
                          Path(args.slots_dir), args.streams)
    boot = {"init_lines": COMMITTED["provenance"]["engine_init_line"],
            "kv_lines": COMMITTED["provenance"]["engine_kv_lines"],
            "ctx_check": COMMITTED["provenance"]["checkpoint_line"],
            "swa_lines": COMMITTED["provenance"]["engine_swa_lines"]}
    n_verify = [COMMITTED["provenance"]["prompt_tokens"]] * n
    return mc.build_result(args, release,
                           COMMITTED["provenance"]["engine_version"],
                           COMMITTED["provenance"]["engine_sha256"], argv,
                           Path(args.slots_dir), "2026-01-01T00:00:00Z",
                           [0.0, 0.0, 0.0], boot, n_verify,
                           [attempt], attempt)


# ------------------------------------------------------------------- the cases
def case_1():
    print("(1) engine_argv at N=2 == the committed provenance.argv", file=sys.stderr)
    p = COMMITTED["provenance"]
    built = mc.engine_argv(p["engine_binary"], p["model"],
                           int(p["argv"][p["argv"].index("--port") + 1]),
                           p["context_size_total"], Path(p["slots_dir"]),
                           p["parallel"])
    diff = [i for i, (x, y) in enumerate(zip(built, p["argv"])) if x != y]
    if len(built) != len(p["argv"]):
        diff.append("length")
    check("(1) argv is element-for-element the committed one", not diff,
          f"differs at {diff}")
    check("(1) the committed argv really carries --parallel 2 "
          "(else (1) pins the wrong thing)",
          p["argv"][p["argv"].index("--parallel") + 1] == "2")


def case_2():
    print("(2) build_result at N=2 == the committed key tree, provenance "
          "additions listed", file=sys.stderr)
    built = build(fake_args())
    got = key_paths(built)
    want = key_paths(COMMITTED)
    missing = sorted(want - got)
    extra = got - want
    check("(2) every committed key path exists in the built result",
          not missing, f"missing {missing[:6]}")
    check("(2) the new keys are EXACTLY the listed provenance additions",
          extra == EXPECTED_EXTRA,
          f"unexpected {sorted(extra - EXPECTED_EXTRA)[:6]}, "
          f"unlisted-but-expected {sorted(EXPECTED_EXTRA - extra)[:6]}")
    check("(2) hence no new key outside provenance",
          all(p.startswith("provenance.") for p in extra),
          sorted(p for p in extra if not p.startswith("provenance."))[:6])
    check("(2) the N=2 ratios are exactly the committed names",
          set(built["ratios"]) == set(COMMITTED["ratios"]),
          sorted(set(COMMITTED["ratios"]) ^ set(built["ratios"])))


def case_3():
    print("(3) N=4: --parallel 4 exactly once, ratios carry slot0..slot3",
          file=sys.stderr)
    args = fake_args(streams=4, ctx_size=16384)
    p = COMMITTED["provenance"]
    argv4 = mc.engine_argv(p["engine_binary"], p["model"], 19311, 16384,
                           Path(p["slots_dir"]), 4)
    hits = [i for i, x in enumerate(argv4) if x == "--parallel"]
    check("(3) --parallel appears exactly once", len(hits) == 1, str(hits))
    check("(3) and its value is exactly '4'",
          len(hits) == 1 and argv4[hits[0] + 1] == "4",
          argv4[hits[0] + 1] if hits else "absent")
    built = build(args)
    ratios = built["ratios"]
    for k in range(4):
        check(f"(3) ratios carry per_stream_slot{k}_over_A",
              f"per_stream_slot{k}_over_A" in ratios)
        check(f"(3) tokens_per_second carries B_slot{k}",
              f"B_slot{k}" in built["tokens_per_second"])
    check("(3) aggregate_over_A present", "aggregate_over_A" in ratios)
    check("(3) B_aggregate present",
          "B_aggregate" in built["tokens_per_second"])
    check("(3) arms key is B_four_slots with slot0..slot3",
          "B_four_slots" in built["arms"]
          and all(f"slot{k}" in built["arms"]["B_four_slots"] for k in range(4)),
          sorted(built["arms"]))
    check("(3) provenance.parallel == 4", built["provenance"]["parallel"] == 4,
          repr(built["provenance"]["parallel"]))
    check("(3) provenance.context_size_per_slot == 16384 // 4 == 4096",
          built["provenance"]["context_size_per_slot"] == 4096,
          repr(built["provenance"]["context_size_per_slot"]))
    check("(3) the question says 4 devices",
          "4 devices" in built["question"], built["question"])


def case_4():
    print("(4) launch flags: exact pair, exactly once, nothing at default",
          file=sys.stderr)
    p = COMMITTED["provenance"]

    def argv_with(**kw):
        return mc.engine_argv(p["engine_binary"], p["model"],
                              int(p["argv"][p["argv"].index("--port") + 1]),
                              p["context_size_total"], Path(p["slots_dir"]),
                              p["parallel"], **kw)

    dflt = argv_with()
    check("(4) at defaults neither flag is rendered",
          "--flash-attn" not in dflt and "--ctx-checkpoints" not in dflt)
    check("(4) and the argv at defaults is still the committed one",
          dflt == p["argv"])
    one = argv_with(ctx_checkpoints=1, flash_attn="on")
    pairs = list(zip(one, one[1:]))
    check("(4) `--ctx-checkpoints 1` lands as the exact pair, exactly once",
          one.count("--ctx-checkpoints") == 1
          and pairs.count(("--ctx-checkpoints", "1")) == 1)
    check("(4) `--flash-attn on` lands as the exact pair, exactly once",
          one.count("--flash-attn") == 1
          and pairs.count(("--flash-attn", "on")) == 1)
    twelve = argv_with(ctx_checkpoints=12)
    pairs12 = list(zip(twelve, twelve[1:]))
    check("(4) the pin: `--ctx-checkpoints 1` does NOT pass for 12 - the pair "
          "is absent, and the pair for 12 is exactly once",
          pairs12.count(("--ctx-checkpoints", "1")) == 0
          and pairs12.count(("--ctx-checkpoints", "12")) == 1,
          str(pairs12[pairs12.index(("--ctx-checkpoints", "12"))]
              if ("--ctx-checkpoints", "12") in pairs12 else "pair missing"))
    check("(4) placement follows the app: flash-attn immediately before the "
          "cache types (argv.rs:56-57)",
          one[one.index("--flash-attn") + 1] == "on"
          and one[one.index("--flash-attn") + 2] == "--cache-type-k",
          str(one[one.index("--flash-attn"):one.index("--flash-attn") + 3]))
    check("(4) placement follows the app: ctx-checkpoints immediately after "
          "--slot-save-path (argv.rs:105-108)",
          one[one.index("--slot-save-path") + 2] == "--ctx-checkpoints",
          str(one[one.index("--slot-save-path"):one.index("--slot-save-path") + 4]))


def main():
    case_1()
    case_2()
    case_3()
    case_4()
    print(f"concurrency shape: {'GREEN' if FAILED == 0 else 'RED'} "
          f"({FAILED} failing check(s))", file=sys.stderr)
    sys.exit(0 if FAILED == 0 else 1)


if __name__ == "__main__":
    main()
