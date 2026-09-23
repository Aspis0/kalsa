#!/usr/bin/env python3
"""Door mode's offline contract: the payload/argv deltas, the salt vector,
the release gate, the door provenance - no engine, no door, no network.

What this pins and what it cannot is stated first: the salt vector in (3)
is computed with a SEPARATE hashlib call in THIS file, so it pins the
Python side of `device_cache_salt` (label, order, encoding) against the
door's documented formula - it cannot prove the Rust side. The live proof
is the harness's own pinning check (`pin_device_slots`, run before the
first arm: through the door the answer must be `id_slot == k`, then a
DIRECT read of slot k in this harness-computed salt must be warm), and
that check's refusal under the v1 -> v2 label mutation is shown, run live,
in the commit message of the change that added it.

Cases:
  (1) the direct road is exactly what it always was: id_slot in the body,
      the salt header chosen (credential None -> headers None ->
      http_json_salted), and the engine argv still equals the committed
      provenance.argv element for element.
  (2) the door road differs ONLY as specified: same body minus id_slot;
      `Authorization: Bearer` present; NO x-kalsa-cache-salt anywhere.
  (3) device_cache_salt("a"*64) == sha256(b"kalsa-cache-salt-v1" +
      b"a"*64), the expected digest computed here with hashlib.
  (4) require_matched_for_door: matched -> returns; not-the-release /
      unverified -> SystemExit naming --door-bin and the reason_code.
  (5) door_pool_from_source reads integers out of the door's lib.rs and
      names the file; door_provenance records path + an independently
      recomputed sha256, the git commit, the door subtree's porcelain
      (a DIRTY door is a recorded fact, not an error) and that pool.
  (6) build_result in door mode: provenance.via == "door", the four
      door_queue_probe fields ride through verbatim, the door_* provenance
      keys are present; in direct mode via == "direct", there is NO
      door_queue_probe key at the top level and no door_bin key.

Exit 0 green, 1 red, 2 the committed artifact (an input here) is missing.
Run: python3 dev/test-door-harness.py
"""

import argparse
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
HARNESS = HERE / "measure-concurrency.py"
ARTIFACT = HERE / "results" / "concurrency-two-devices" / "results.json"

for src in (HARNESS, ARTIFACT):
    if not src.exists():
        print(f"cannot run: missing {src}", file=sys.stderr)
        sys.exit(2)

spec = importlib.util.spec_from_file_location("mconc", HARNESS)
mc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mc)

COMMITTED = json.loads(ARTIFACT.read_text())
FAILED = 0


def check(name, ok, detail=""):
    global FAILED
    if not ok:
        FAILED += 1
    print(f"  [{'ok' if ok else 'FAIL'}] {name}"
          + (f": {detail}" if detail else ""), file=sys.stderr)


def raised(fn, *a, **kw):
    try:
        fn(*a, **kw)
    except SystemExit as e:
        return str(e)
    return None


# ------------------------------------------------------------------ the roads
def case_1():
    print("(1) the direct road is untouched", file=sys.stderr)
    payload, headers = mc.completion_request("P", 256, 3, None)
    expected = {"prompt": "P", "n_predict": 256, "temperature": 0.0, "seed": 1,
                "cache_prompt": True, "ignore_eos": True, "id_slot": 3}
    check("(1) direct payload is the historical literal, id_slot included",
          payload == expected, json.dumps(payload, sort_keys=True))
    check("(1) direct chooses the salt header (headers None -> "
          "http_json_salted)", headers is None, repr(headers))

    p = COMMITTED["provenance"]
    argv = mc.engine_argv(p["engine_binary"], p["model"],
                          int(p["argv"][p["argv"].index("--port") + 1]),
                          p["context_size_total"], Path(p["slots_dir"]),
                          p["parallel"])
    check("(1) engine argv still equals the committed provenance.argv "
          "(door mode adds nothing to it)", argv == p["argv"],
          str([i for i, (x, y) in enumerate(zip(argv, p["argv"])) if x != y]))


def case_2():
    print("(2) the door road differs only as specified", file=sys.stderr)
    direct, _ = mc.completion_request("P", 256, 3, None)
    payload, headers = mc.completion_request("P", 256, 3, "c" * 64)
    check("(2) same body as direct MINUS id_slot, nothing else changed",
          payload == {k: v for k, v in direct.items() if k != "id_slot"},
          json.dumps(payload, sort_keys=True))
    check("(2) no id_slot in the door payload", "id_slot" not in payload)
    check("(2) bearer present as the exact pair",
          headers == {"Authorization": "Bearer " + "c" * 64}, repr(headers))
    check("(2) no salt header anywhere on the door road",
          "x-kalsa-cache-salt" not in headers, repr(sorted(headers)))


def case_3():
    print("(3) the salt vector (Python side only - see the header)", file=sys.stderr)
    expected = hashlib.sha256(b"kalsa-cache-salt-v1" + b"a" * 64).hexdigest()
    got = mc.device_cache_salt("a" * 64)
    check("(3) device_cache_salt('a'*64) == sha256(b'kalsa-cache-salt-v1' + "
          "b'a'*64) computed here, independently", got == expected,
          f"{got} vs {expected}")
    check("(3) the harness's label constant is the door's v1",
          mc.DOOR_SALT_LABEL == b"kalsa-cache-salt-v1",
          repr(mc.DOOR_SALT_LABEL))
    check("(3) a different credential gives a different salt "
          "(the vector is not a constant)",
          mc.device_cache_salt("b" * 64) != got)


def case_4():
    print("(4) the release gate for --door-bin", file=sys.stderr)
    check("(4) matched returns (no refusal)",
          mc.require_matched_for_door({"status": "matched"}) is None)
    msg = raised(mc.require_matched_for_door,
                 {"status": "not-the-release",
                  "reason_code": "engine-commit-mismatch"})
    check("(4) not-the-release refuses", msg is not None, repr(msg))
    check("(4) the refusal names --door-bin and the reason_code",
          msg is not None and "--door-bin refuses" in msg
          and "engine-commit-mismatch" in msg, (msg or "")[:160])
    msg2 = raised(mc.require_matched_for_door,
                  {"status": "unverified", "reason_code": "no-manifest-url"})
    check("(4) unverified refuses too (never promoted)", msg2 is not None,
          repr(msg2))
    check("(4) the refusal says why, not just that",
          msg2 is not None and "EnginePrivateHeaders::Consumed" in msg2,
          (msg2 or "")[:160])


def fake_args(door_bin):
    return argparse.Namespace(
        port=19311, out="o", log="l", slots_dir="/tmp/door-shape-slots",
        bin=COMMITTED["provenance"]["engine_binary"], model=str(ARTIFACT),
        ctx_size=COMMITTED["provenance"]["context_size_total"], streams=2,
        n_predict=256, prompt_tokens=512, attempts=1, bracket_tol=0.03,
        keep_server=False, max_load=6.0, release_manifest_url=None,
        ctx_checkpoints=None, flash_attn=None, door_bin=door_bin)


def synthetic_attempt():
    """The fields build_result actually reads - no server, no network."""
    def rec(slot, pps):
        return {"slot": slot, "cache_n": 0, "predicted_n": 256,
                "predicted_per_second": pps}
    return {"index": 0, "A_solo_slot0": rec(0, 80.0),
            mc.ARM_KEYS[2]: {"slot0": rec(0, 60.0), "slot1": rec(1, 59.0)},
            "A2_solo_repeat": rec(0, 81.0), "A2_over_A": 1.0123,
            "bracket_ok": True}


def build(args, door_probe=None):
    attempt = synthetic_attempt()
    boot = {"init_lines": [], "kv_lines": [], "ctx_check": [],
            "swa_lines": []}
    return mc.build_result(args, {"status": "matched"}, "version 0.4.1-dev",
                           "0" * 64, [], Path(args.slots_dir),
                           "2026-01-01T00:00:00Z", [0.0, 0.0, 0.0], boot,
                           [512, 512], [attempt], attempt,
                           door_probe=door_probe)


def case_5():
    print("(5) door provenance: pool from source, dirty recorded", file=sys.stderr)
    pool = mc.door_pool_from_source()
    check("(5) WORKERS and QUEUE read as integers from the source",
          isinstance(pool.get("workers"), int) and isinstance(pool.get("queue"), int),
          json.dumps(pool))
    check("(5) the source is named", "crates/kalsa-door/src/lib.rs"
          in (pool.get("source") or ""), repr(pool.get("source")))
    check("(5) labelled source-derived (the binary exposes nothing)",
          "source-derived" in (pool.get("derived") or ""),
          repr(pool.get("derived")))

    prov = mc.door_provenance(fake_args(str(HARNESS)))
    check("(5) door_bin path recorded", prov["door_bin"] == str(HARNESS))
    independent = hashlib.sha256(HARNESS.read_bytes()).hexdigest()
    check("(5) door_bin_sha256 == an independent hashlib of that file",
          prov["door_bin_sha256"] == independent,
          f"{prov['door_bin_sha256'][:16]} vs {independent[:16]}")
    check("(5) door_source.commit recorded",
          isinstance(prov["door_source"]["commit"], str)
          and len(prov["door_source"]["commit"]) >= 7,
          repr(prov["door_source"]["commit"]))
    check("(5) door_source.porcelain is a STRING (dirty or clean - the "
          "fact is recorded, never refused)",
          isinstance(prov["door_source"]["porcelain"], str),
          repr(prov["door_source"]["porcelain"][:40]))


def case_6():
    print("(6) build_result: door vs direct", file=sys.stderr)
    probe = {"sent_after_ms": 1000.2, "wall_ms": 12.3, "status": 200,
             "streams_done_before_probe_answered": 1}
    door = build(fake_args(str(HARNESS)), door_probe=probe)
    check("(6) provenance.via == door", door["provenance"]["via"] == "door")
    check("(6) door_queue_probe rides through with its four fields",
          door.get("door_queue_probe") == probe
          and set(door["door_queue_probe"]) == {
              "sent_after_ms", "wall_ms", "status",
              "streams_done_before_probe_answered"},
          json.dumps(door.get("door_queue_probe")))
    for key in ("door_bin", "door_bin_sha256", "door_source",
                "door_pool_from_source"):
        check(f"(6) provenance.{key} present in door mode",
              key in door["provenance"])

    direct = build(fake_args(None))
    check("(6) provenance.via == direct on the historical road",
          direct["provenance"]["via"] == "direct")
    check("(6) NO door_queue_probe at the top level in direct mode",
          "door_queue_probe" not in direct, str(sorted(direct)))
    check("(6) no door_* provenance key in direct mode",
          not [k for k in direct["provenance"] if k.startswith("door_")],
          str([k for k in direct["provenance"] if k.startswith("door_")]))


def main():
    case_1()
    case_2()
    case_3()
    case_4()
    case_5()
    case_6()
    print(f"door harness: {'GREEN' if FAILED == 0 else 'RED'} "
          f"({FAILED} failing check(s))", file=sys.stderr)
    sys.exit(0 if FAILED == 0 else 1)


if __name__ == "__main__":
    main()
