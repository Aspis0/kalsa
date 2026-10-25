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
      the headers are EXACTLY the salt header, and the engine argv still
      equals the committed provenance.argv element for element.
  (2) the door road differs ONLY as specified: same body minus id_slot;
      headers are EXACTLY `Authorization: Bearer` - a salt is PASSED and
      still no salt header appears.
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
  (7) no salt material in a door-mode artifact: driven through the REAL
      producer (run_attempt_arms over the fake transport) - no produced
      record and no built artifact field may contain any credential or
      derived salt (full, 16- or 8-char prefix), every produced record's
      salt_label is `device-{slot}`; plus the warm-arm refusal
      (require_arms_cold: cold passes, one warm arm refuses with
      `door mode refuses`), and the warm_prefix prose: the door verdict
      says the ERASE before each arm (device salt fixed) keeps arms cold
      and never says "fresh salt per arm" - which stays the direct-mode
      text, data-derived in both.
  (8) THE ROAD, through the real attempt function over the fake
      transport: in door mode EVERY completion (A, each of the N B slots,
      A2) goes to the DOOR port with a per-device Bearer, no id_slot and
      no salt header, while every erase goes direct to the engine port;
      in direct mode EVERY completion goes to the ENGINE port with
      id_slot and the run's salt label and no Bearer. (G1's regression:
      A and A2 used to bypass the door.)
  (9) n5 fail-closed: with the pre-A2 erase suppressed, A2 reads B's
      warmth under the fixed device salt and require_arms_cold REFUSES -
      no artifact, no number.

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
    payload, headers = mc.completion_request("P", 256, 3, "ab" * 32, None)
    expected = {"prompt": "P", "n_predict": 256, "temperature": 0.0, "seed": 1,
                "cache_prompt": True, "ignore_eos": True, "id_slot": 3}
    check("(1) direct payload is the historical literal, id_slot included",
          payload == expected, json.dumps(payload, sort_keys=True))
    check("(1) direct headers are EXACTLY the salt header",
          headers == {"x-kalsa-cache-salt": "ab" * 32}, repr(headers))

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
    direct, _ = mc.completion_request("P", 256, 3, "ab" * 32, None)
    payload, headers = mc.completion_request("P", 256, 3, "ab" * 32,
                                             "c" * 64)
    check("(2) same body as direct MINUS id_slot, nothing else changed",
          payload == {k: v for k, v in direct.items() if k != "id_slot"},
          json.dumps(payload, sort_keys=True))
    check("(2) no id_slot in the door payload", "id_slot" not in payload)
    check("(2) headers are EXACTLY the Bearer pair - the salt was PASSED "
          "and still appears nowhere",
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


def fake_args(door_bin, **over):
    base = dict(
        port=19311, out="o", log="l", slots_dir="/tmp/door-shape-slots",
        bin=COMMITTED["provenance"]["engine_binary"], model=str(ARTIFACT),
        ctx_size=COMMITTED["provenance"]["context_size_total"], streams=2,
        n_predict=256, prompt_tokens=512, attempts=1, bracket_tol=0.03,
        keep_server=False, max_load=6.0, release_manifest_url=None,
        ctx_checkpoints=None, flash_attn=None, door_bin=door_bin)
    base.update(over)
    return argparse.Namespace(**base)


def synthetic_attempt():
    """The fields build_result actually reads - no server, no network."""
    def rec(slot, pps):
        return {"slot": slot, "cache_n": 0, "predicted_n": 256,
                "predicted_per_second": pps,
                # the door road's labels: what a door record CARRIES is
                # the device label, never the device salt
                "salt_label": f"device-{slot}"}
    return {"index": 0, "A_solo_slot0": rec(0, 80.0),
            mc.ARM_KEYS[2]: {"slot0": rec(0, 60.0), "slot1": rec(1, 59.0)},
            "A2_solo_repeat": rec(0, 81.0), "A2_over_A": 1.0123,
            "bracket_ok": True}


def build(args, door_probe=None, attempt=None):
    if attempt is None:
        attempt = synthetic_attempt()
    boot = {"init_lines": [], "kv_lines": [], "ctx_check": [],
            "swa_lines": []}
    return mc.build_result(args, {"status": "matched"}, "version 0.4.1-dev",
                           "0" * 64, [], Path(args.slots_dir),
                           "2026-01-01T00:00:00Z", [0.0, 0.0, 0.0], boot,
                           [512] * args.streams, [attempt], attempt,
                           door_probe=door_probe)


class FakeServer:
    """The engine log the harness reads: empty. The attempt sequence does
    not demand engine lines (that is main's require_engine_lines), so an
    empty log keeps these tests about ROADS and namespaces."""
    def lines(self):
        return []


class FakeEngine:
    """A fake transport that records (port, path, headers, body keys) for
    EVERY request and models the engine's per-slot salt namespace: a
    completion reads warm only when its salt matches the one stamped on
    that slot, and an erase clears the slot. Slot choice mirrors the real
    road - direct requests carry id_slot; door requests land on the
    device's sticky slot (credential order = first-fit order, device k ->
    slot k, exactly as slots.rs assigns)."""

    def __init__(self, engine_port, door_port, credentials, prompt_len=512):
        self.engine_port = engine_port
        self.door_port = door_port
        self.credentials = credentials
        self.prompt_len = prompt_len
        self.requests = []
        self.warm = {}          # slot -> (salt, tokens)

    def __call__(self, port, path, payload, headers):
        self.requests.append({"port": port, "path": path,
                              "headers": dict(headers),
                              "body_keys": sorted(payload)})
        if path.startswith("/slots/"):
            slot = int(path.split("?")[0].rstrip("/").split("/")[-1])
            if "action=erase" in path:
                self.warm.pop(slot, None)
            return 200, {"n_erased": 0}
        auth = headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            cred = auth[len("Bearer "):]
            slot = self.credentials.index(cred)
            salt = mc.device_cache_salt(cred)
        else:
            slot = payload["id_slot"]
            salt = headers.get("x-kalsa-cache-salt")
        cached = self.warm.get(slot)
        cache_n = cached[1] if cached and cached[0] == salt else 0
        self.warm[slot] = (salt, self.prompt_len)
        n_predict = payload.get("n_predict", 1)
        return 200, {
            "id_slot": slot,
            "tokens_evaluated": self.prompt_len,
            "tokens_predicted": n_predict,
            "stop_type": "length",
            "timings": {"cache_n": cache_n, "prompt_n": self.prompt_len,
                        "prompt_ms": 1.0, "prompt_per_second": 999.0,
                        "predicted_n": n_predict, "predicted_ms": 10.0,
                        "predicted_per_second": 70.0},
        }

    def completions(self):
        return [r for r in self.requests if r["path"] == "/completion"]

    def erases(self):
        return [r for r in self.requests if r["path"].startswith("/slots/")]


def drive_attempt(door, n=4, suppress_a2_erase=False, probe_after_s=0.0):
    """Drive the REAL run_attempt_arms against the fake transport.
    suppress_a2_erase drops the LAST erase of the sequence (the pre-A2
    one, reviewer B's n5) by wrapping mc.slot_action for the drive only.
    probe_after_s lets a case anchor the probe's timestamp UNITS (case
    (10): sent must land ~that many MILLISECONDS after the barrier)."""
    credentials = [hashlib.sha256(f"door-test-device-{k}".encode()).hexdigest()
                   for k in range(n)]
    salts = [mc.device_cache_salt(c) for c in credentials]
    engine_port, door_port = 41311, 41411
    fake = FakeEngine(engine_port, door_port, credentials)
    prompts = [f"prompt-{k}" for k in range(n)]
    real = mc.slot_action
    calls = {"n": 0}

    def spy(port, slot, action, salt_hex, send=None):
        calls["n"] += 1
        if suppress_a2_erase and calls["n"] == n + 2:
            # attempt's erase order: A (1) + B (n) + A2 (1) - drop the A2
            return {"status": 200, "wall_ms": 0.0, "body": {}}
        return real(port, slot, action, salt_hex, send=send)

    mc.slot_action = spy
    try:
        arm_a, arm_b, arm_a2, probe = mc.run_attempt_arms(
            engine_port, door_port, prompts, 1, credentials, salts,
            FakeServer(), door, 0, send=fake, pause_s=0.0,
            probe_after_s=probe_after_s)
    finally:
        mc.slot_action = real
    return fake, arm_a, arm_b, arm_a2, probe, credentials, salts


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
             "probe_sent_ms": 1100.0, "probe_answered_ms": 1112.3,
             "streams_sent_ms": [99.8, 100.0],
             "streams_done_ms": [1000.5, 1050.0],
             "streams_done_before_probe_answered": 2,
             "note": "the probe is an ACTIVE fifth request ..."}
    door = build(fake_args(str(HARNESS)), door_probe=probe)
    check("(6) provenance.via == door", door["provenance"]["via"] == "door")
    check("(6) door_queue_probe rides through with the real probe's "
          "field set (G4: the recorded series included)",
          door.get("door_queue_probe") == probe
          and set(door["door_queue_probe"]) == {
              "sent_after_ms", "wall_ms", "status", "probe_sent_ms",
              "probe_answered_ms", "streams_sent_ms", "streams_done_ms",
              "streams_done_before_probe_answered", "note"},
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


def case_7():
    print("(7) door mode: no salt material in the PRODUCER's records or "
          "the artifact it builds", file=sys.stderr)
    n = 4
    fake, arm_a, arm_b, arm_a2, probe, creds, salts = drive_attempt(True, n)
    records = [arm_a, arm_a2] + [arm_b[f"slot{k}"] for k in range(n)]
    blob_records = json.dumps(records)
    for i, (cred, salt) in enumerate(zip(creds, salts)):
        check(f"(7) PRODUCED records carry no credential {i} "
              "(full / 16-hex / 8-hex)",
              cred not in blob_records and cred[:16] not in blob_records
              and cred[:8] not in blob_records)
        check(f"(7) PRODUCED records carry no salt {i} "
              "(full / 16-hex / 8-hex)",
              salt not in blob_records and salt[:16] not in blob_records
              and salt[:8] not in blob_records, salt[:16])
    labels = sorted(r["salt_label"] for r in records)
    check("(7) every PRODUCED record's salt_label is device-{slot}",
          labels == [f"device-{s}" for s in (0, 0, 0, 1, 2, 3)],
          repr(labels))

    attempt = {"index": 0, "A_solo_slot0": arm_a, mc.ARM_KEYS[n]: arm_b,
               "A2_solo_repeat": arm_a2, "A2_over_A": 1.0,
               "bracket_ok": True}
    built = build(fake_args(str(HARNESS), streams=n), door_probe=probe,
                  attempt=attempt)
    blob = json.dumps(built)
    for i, (cred, salt) in enumerate(zip(creds, salts)):
        check(f"(7) the BUILT artifact carries no credential {i}",
              cred not in blob and cred[:16] not in blob)
        check(f"(7) the BUILT artifact carries no salt {i} "
              "(full / 16-hex / 8-hex)",
              salt not in blob and salt[:16] not in blob
              and salt[:8] not in blob, salt[:16])

    cold = {"A": {"cache_n": 0}, "B_slot0": {"cache_n": 0},
            "B_slot1": {"cache_n": 0}, "A2": {"cache_n": 0}}
    check("(7) require_arms_cold: all-cold passes",
          mc.require_arms_cold(cold) is None)
    warm = dict(cold, B_slot1={"cache_n": 512})
    msg = raised(mc.require_arms_cold, warm)
    check("(7) require_arms_cold: one warm arm refuses with "
          "'door mode refuses' naming it",
          msg is not None and "door mode refuses" in msg
          and "B_slot1" in msg, (msg or "")[:160])

    v_door = (built["warm_prefix_in_play"].get("verdict") or "")
    check("(7) the door verdict says the ERASE before each arm keeps arms "
          "cold (salt fixed per device)",
          "erase before each arm" in v_door and "fixed salt" in v_door,
          v_door)
    check("(7) the door verdict never claims a fresh salt per arm",
          "fresh salt per arm" not in v_door, v_door)
    check("(7) the produced door arms are COLD (the fake's namespaces "
          "agree: the erases landed)",
          arm_a["cache_n"] == 0 and arm_a2["cache_n"] == 0
          and all(arm_b[f"slot{k}"]["cache_n"] == 0 for k in range(n)),
          json.dumps({"A": arm_a["cache_n"], "A2": arm_a2["cache_n"]}))
    direct = build(fake_args(None))
    v_direct = (direct["warm_prefix_in_play"].get("verdict") or "")
    check("(7) the direct verdict keeps the fresh-salt-per-arm prose "
          "(unchanged, data-derived in both)",
          "fresh salt per arm" in v_direct, v_direct)
    check("(7) both verdicts are cold because the DATA says cache_n 0",
          all(v == 0 for v in built["warm_prefix_in_play"]["cache_n"].values()),
          json.dumps(built["warm_prefix_in_play"]["cache_n"]))


def case_8():
    print("(8) THE ROAD: every completion of the real attempt function",
          file=sys.stderr)
    n = 4
    fake, arm_a, arm_b, arm_a2, probe, creds, salts = drive_attempt(True, n)
    completions = fake.completions()
    check("(8) door: A + N B + A2 = %d completions were sent" % (n + 2),
          len(completions) == n + 2, f"{len(completions)}")
    wrong_port = [c["port"] for c in completions
                  if c["port"] != fake.door_port]
    check("(8) door: EVERY completion went to the DOOR port (G1: A and A2 "
          "used to bypass it and hit the engine)",
          not wrong_port, str(wrong_port))
    check("(8) door: no completion carries id_slot (the door seals slots)",
          all("id_slot" not in c["body_keys"] for c in completions))
    check("(8) door: no completion carries a salt header",
          all("x-kalsa-cache-salt" not in c["headers"]
              for c in completions))
    auths = [c["headers"].get("Authorization", "") for c in completions]
    check("(8) door: every completion carries a Bearer of a real device",
          all(a.startswith("Bearer ") and a[7:] in creds for a in auths),
          repr(auths[:2]))
    check("(8) door: A (first) and A2 (last) carry device 0's Bearer",
          auths[0] == f"Bearer {creds[0]}"
          and auths[-1] == f"Bearer {creds[0]}")
    check("(8) door: the N B completions use each device exactly once",
          sorted(a[7:] for a in auths[1:-1]) == sorted(creds))
    erases = fake.erases()
    check("(8) door: all %d erases (A, N B, A2) went DIRECT to the "
          "engine port" % (n + 2),
          len(erases) == n + 2
          and all(e["port"] == fake.engine_port for e in erases),
          str([(e["port"], e["path"]) for e in erases]))
    check("(8) door: probe ran (the fifth request) and A/A2 are cold",
          probe is not None and arm_a["cache_n"] == 0
          and arm_a2["cache_n"] == 0,
          str((probe is not None, arm_a["cache_n"], arm_a2["cache_n"])))
    recs = {"A": arm_a, **{f"B_slot{k}": arm_b[f"slot{k}"]
                           for k in range(n)}, "A2": arm_a2}
    check("(8) door: require_arms_cold passes on the produced recs "
          "(all cold)", mc.require_arms_cold(recs) is None)

    fake2, da, db, da2, dprobe, _, _ = drive_attempt(False, n)
    d_completions = fake2.completions()
    check("(8) direct: every completion went to the ENGINE port",
          all(c["port"] == fake2.engine_port for c in d_completions),
          str([c["port"] for c in d_completions]))
    check("(8) direct: every completion carries id_slot",
          all("id_slot" in c["body_keys"] for c in d_completions))
    check("(8) direct: every completion carries the salt header and NO "
          "Bearer",
          all("x-kalsa-cache-salt" in c["headers"]
              and "Authorization" not in c["headers"]
              for c in d_completions))
    want_salts = sorted([mc.salt_of("arm-A-0"), mc.salt_of("arm-A2-0")]
                        + [mc.salt_of(f"arm-B-slot{k}-0") for k in range(n)])
    check("(8) direct: the salts are the run's own labels "
          "(arm-A / arm-B-slot{k} / arm-A2, attempt 0)",
          sorted(c["headers"]["x-kalsa-cache-salt"]
                 for c in d_completions) == want_salts)
    d_erases = fake2.erases()
    check("(8) direct: %d erases (no pre-A2 erase in direct mode), all "
          "engine port" % (n + 1),
          len(d_erases) == n + 1
          and all(e["port"] == fake2.engine_port for e in d_erases),
          str([(e["port"], e["path"]) for e in d_erases]))
    check("(8) direct: NO probe (the fifth request is door mode's)",
          dprobe is None)


def case_9():
    print("(9) n5 fail-closed: without the pre-A2 erase the guard refuses",
          file=sys.stderr)
    n = 4
    fake, arm_a, arm_b, arm_a2, probe, creds, salts = drive_attempt(
        True, n, suppress_a2_erase=True)
    recs = {"A": arm_a, **{f"B_slot{k}": arm_b[f"slot{k}"]
                           for k in range(n)}, "A2": arm_a2}
    check("(9) with the A2 erase dropped, A2 reads B's warmth under the "
          "fixed device salt (the fake models the namespace)",
          arm_a2["cache_n"] > 0, repr(arm_a2["cache_n"]))
    check("(9) every OTHER arm is still cold (only A2 went warm)",
          arm_a["cache_n"] == 0
          and all(arm_b[f"slot{k}"]["cache_n"] == 0 for k in range(n)))
    msg = raised(mc.require_arms_cold, recs)
    check("(9) require_arms_cold REFUSES - door mode dies, no artifact, "
          "and the message names A2",
          msg is not None and "door mode refuses" in msg and "A2" in msg,
          (msg or "")[:160])


def case_10():
    print("(10) G4/H6: the probe count recomputes from the artifact's own "
          "fields, at 3 decimals", file=sys.stderr)
    n = 4
    # probe_after_s = 0.3 anchors the UNITS: the probe must be recorded
    # ~300 MILLISECONDS after the barrier - a seconds-labeled field would
    # read ~0.3 and fail here (it did: the first live run recorded
    # streams_done 7.4 for a 7404 ms generation). The drive repeats until
    # EVERY property the checks below assert holds on this probe: index 0
    # not at the max of streams_sent_ms (only then does the max() baseline
    # of sent_after_ms differ from streams_sent_ms[0], so B's P3 can go
    # red deterministically), and a sub-0.1 fraction in EACH field (S2: a
    # set-level any() let probe_sent_ms alone go back to 1 dp unnoticed;
    # per-field, Q5 dies). Retrying until the fractions exist keeps the
    # unmutated run deterministic; a 1-dp-rounded field can NEVER satisfy
    # its condition, so that mutation exhausts the loop and then fails its
    # own field's check.
    probe = None
    spread = 0.0

    def conditions_ok(p):
        sent = p["streams_sent_ms"]
        return (
            max(sent) != sent[0]
            and any(v != round(v, 1) for v in sent)
            and any(v != round(v, 1) for v in p["streams_done_ms"])
            and p["probe_sent_ms"] != round(p["probe_sent_ms"], 1)
            and p["probe_answered_ms"] != round(p["probe_answered_ms"], 1)
        )

    for _ in range(30):
        fake, arm_a, arm_b, arm_a2, probe, creds, salts = drive_attempt(
            True, n, probe_after_s=0.3)
        spread = (max(probe["streams_sent_ms"])
                  - min(probe["streams_sent_ms"]))
        if conditions_ok(probe):
            break
    for key in ("probe_sent_ms", "probe_answered_ms", "streams_sent_ms",
                "streams_done_ms", "streams_done_before_probe_answered",
                "note"):
        check(f"(10) the probe records {key}", key in probe,
              str(sorted(probe)))
    check("(10) per-stream stamps: sent <= done for every stream, N each",
          len(probe["streams_sent_ms"]) == n
          and len(probe["streams_done_ms"]) == n
          and all(s <= d for s, d in zip(probe["streams_sent_ms"],
                                         probe["streams_done_ms"])),
          json.dumps([probe["streams_sent_ms"], probe["streams_done_ms"]]))
    check("(10) THE UNITS: probe_sent_ms is ~300 (milliseconds), not 0.3 "
          "- perf_counter differences are seconds and must be scaled",
          300.0 <= probe["probe_sent_ms"] <= 450.0,
          repr(probe["probe_sent_ms"]))
    check("(10) H6/B-P3: streams_sent_ms has a spread AND index 0 is NOT "
          "the max - the max() baseline of sent_after_ms is exercised",
          max(probe["streams_sent_ms"]) != probe["streams_sent_ms"][0]
          and spread > 0,
          f"spread={spread} ms, series={json.dumps(probe['streams_sent_ms'])}")
    # S2: each field on its OWN - the set-level any() let probe_sent_ms
    # alone go back to 1 dp while the other fields kept their fractions.
    fields = {
        "streams_sent_ms": list(probe["streams_sent_ms"]),
        "streams_done_ms": list(probe["streams_done_ms"]),
        "probe_sent_ms": [probe["probe_sent_ms"]],
        "probe_answered_ms": [probe["probe_answered_ms"]],
    }
    for fname, values in fields.items():
        check(f"(10) H6: {fname} carries at most 3 decimals",
              all(v == round(v, 3) for v in values), json.dumps(values))
        check(f"(10) H6/S2/Q5: {fname} shows a SUB-0.1 fraction OF ITS OWN "
              "- recorded at 3 decimals, per field",
              any(v != round(v, 1) for v in values), json.dumps(values))
    recomputed = mc.count_done_before(probe["streams_done_ms"],
                                      probe["probe_answered_ms"])
    check("(10) streams_done_before_probe_answered == a recomputation from "
          "streams_done_ms and probe_answered_ms ALONE",
          recomputed == probe["streams_done_before_probe_answered"],
          f"{recomputed} vs {probe['streams_done_before_probe_answered']}")
    check("(10) sent_after_ms recomputes from the recorded series with "
          "max(streams_sent_ms) (B's P3 used streams_sent_ms[0])",
          probe["sent_after_ms"]
          == round(probe["probe_sent_ms"] - max(probe["streams_sent_ms"]), 3),
          json.dumps(probe["sent_after_ms"]))
    drift = abs(probe["wall_ms"] - (probe["probe_answered_ms"]
                                    - probe["probe_sent_ms"]))
    check("(10) wall_ms agrees with the recorded instants within the "
          "rounding bound (<= 0.25 ms: wall to 0.01, instants to 0.001)",
          drift <= 0.25, f"{drift} ms")
    check("(10) the note declares the probe an ACTIVE fifth request "
          "through the door's worker path (proxy.rs:51)",
          "ACTIVE fifth request" in probe["note"]
          and "proxy.rs:51" in probe["note"], probe["note"][:90])
    check("(10) the count formula: streams finishing at 10/20/30/40 vs an "
          "answer at 25 -> exactly 2",
          mc.count_done_before([10.0, 20.0, 30.0, 40.0], 25.0) == 2)
    check("(10) THE <= BOUNDARY: a stream done at EXACTLY the probe's "
          "answered instant counts as done before it",
          mc.count_done_before([10.0], 10.0) == 1)
    check("(10) ...and one tick after it does NOT count",
          mc.count_done_before([10.001], 10.0) == 0)
    check("(10) a stream with no stamp (None) never counts",
          mc.count_done_before([10.0, None, 40.0], 25.0) == 1)


def main():
    case_1()
    case_2()
    case_3()
    case_4()
    case_5()
    case_6()
    case_7()
    case_8()
    case_9()
    case_10()
    print(f"door harness: {'GREEN' if FAILED == 0 else 'RED'} "
          f"({FAILED} failing check(s))", file=sys.stderr)
    sys.exit(0 if FAILED == 0 else 1)


if __name__ == "__main__":
    main()
