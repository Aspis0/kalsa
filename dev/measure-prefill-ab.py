#!/usr/bin/env python3
"""A/B the two engines on PREFILL: is the 16x slow prefill the machine or the
build?

The anomaly, from the committed artifact `dev/results/unload-restore/`
(fork build 11193, commit 833cde99b, load 1m 5.27 at start): a cold 1900-token
prefill took 14,933 ms = 7.86 ms/token. On the RELEASE (build 11195, commit
a7d2cec79) the same prompt prefills in 931.9 ms = 0.49 ms/token - same argv,
same model, same ctx, same flags. 16x. The plan cites none of those
milliseconds, so this closes an anomaly an artifact carries, not a delivered
number.

Two candidates:
  (A) MACHINE - the old run started at load 5.27 and was ALREADY slow in its
      first arm (5.34 ms/token at 600 tokens), on a machine running other
      work, with the engine at nice 10.
  (B) BUILD - between the two engines there are exactly two commits, both in
      the governor (`git log 833cde99b..a7d2cec79`), on the plugged idle
      baseline. The older governor's `pause hot prefill` (f2073505e) is an
      ancestor of BOTH, and the string `thermal ceiling` is present in both
      engines' `libllama` - absent only from v1.1.0.

What this script does, in ONE session so the machine state is shared:
  arms alternate (fork, release, fork, release) at --sizes 600,1900 with a
  fresh engine each, one cold salted send per arm (cache_n must be 0), and
  `loadavg` is recorded per arm - because the question is whether the number
  follows the BUILD or the MACHINE'S state. Then the third case: each engine
  repeated at 1900 tokens under --burners CPU burners for --heat-s seconds
  (both engines under the SAME load, or the comparison would be worthless).

Every engine log is grepped for governor/thermal lines (count + up to 5
verbatim samples per engine, raw logs NOT committed), and the OLD run's own
logs are grepped too when they are still on disk.

The A/B is checked before measuring: the two engines must differ by
`libllama-server-impl.dylib` sha AND `libllama` sha AND `--version` commit.
The launcher alone separates NOTHING (it is byte-identical across releases),
so it is recorded and never used as the separator. Pointing both arms at the
same tree REFUSES to run - there would be no comparison to make.

The `release` block of each engine is inherited from `measure-concurrency.py`
(loaded as a module, never copied), so `release` says which engine is the
delivered one.

Usage:
  python3 dev/measure-prefill-ab.py --out dev/results/prefill-build-ab/results.json
"""

import argparse
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("msr", HERE / "measure-slot-restore.py")
msr = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(msr)

MC_SCRIPT = HERE / "measure-concurrency.py"
_mc = importlib.util.spec_from_file_location("mconc", MC_SCRIPT)
mc = importlib.util.module_from_spec(_mc)
_mc.loader.exec_module(mc)

DEFAULT_FORK = "/Users/marco/Projects/kalsallama/build/bin/llama-server"
DEFAULT_RELEASE = "/tmp/k111/kalsa-server-v1.1.1/kalsa-server"
ENGINE_MODULE_FILE = "libllama-server-impl.dylib"
OLD_ARTIFACT = HERE / "results" / "unload-restore" / "results.json"
OLD_LOG_DIR = Path("/tmp/kalsa-unload-restore")
ENGINE_REPO = "/Users/marco/Projects/kalsallama"
NICE = 10
# The release announcement the supervisor watches
# (crates/kalsa-supervisor/src/child.rs:42-43), used here only to record
# whether a send followed an idle release (it must not: the old run's cold
# send happened with the model resident).
RELEASE_LINE = "server is entering sleeping state"

# The governor's own words (src/llama-governor-runtime.cpp:56 and friends)
# plus the generic thermal vocabulary, as the brief asks for.
GOV_RE = re.compile(r"governor|thermal|ceiling|paus|throttl|hot", re.I)
TIMING_RE = re.compile(r"prompt eval time =")


def arm_extra(slots_dir):
    """The flags the old run's cold send had: same configuration, only the
    engine differs between the arms."""
    return ["--slot-save-path", str(slots_dir), "--ctx-checkpoints", "1",
            "--cache-ram", "0", "--sleep-idle-seconds", "30"]


def version_of(bin_path):
    vp = subprocess.run(["nice", "-n", str(NICE), bin_path, "--version"],
                        capture_output=True, text=True)
    return (vp.stdout + vp.stderr).strip()


def commit_of(version_text):
    m = re.search(r"\bcommit ([0-9a-f]{7,40})", version_text or "")
    return m.group(1) if m else None


def libllama_of(bin_path):
    """The dylib the governor lives in (NOT libllama-server-impl, and NOT the
    launcher): first libllama.0.x.dylib, else libllama.dylib, else None."""
    d = Path(bin_path).parent
    for pat in ("libllama.0.*.dylib", "libllama.dylib", "libllama.*.dylib"):
        hits = sorted(p for p in d.glob(pat) if "impl" not in p.name
                      and "common" not in p.name and "bench" not in p.name
                      and "cli" not in p.name)
        if hits:
            return hits[-1]
    return None


def has_governor_strings(path):
    try:
        blob = Path(path).read_bytes()
    except OSError:
        return None
    return {"thermal_ceiling": b"thermal ceiling" in blob,
            "governor": b"governor" in blob}


def mtime_of(path):
    try:
        return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(Path(path).stat().st_mtime))
    except OSError:
        return None


def engine_identity(label, bin_path):
    version = version_of(bin_path)
    module = Path(bin_path).parent / ENGINE_MODULE_FILE
    libllama = libllama_of(bin_path)
    block = mc.release_provenance(mc.derive_manifest_url(bin_path),
                                  msr.sha256_file(bin_path))
    return {
        "label": label,
        "bin": bin_path,
        "bin_sha256": msr.sha256_file(bin_path),      # launcher: recorded, NOT a separator
        "launcher_note": ("recorded only: the launcher is byte-identical across "
                          "releases, so it separates nothing"),
        "module_file": ENGINE_MODULE_FILE,
        "module_sha256": msr.sha256_file(module) if module.exists() else None,
        "libllama_file": libllama.name if libllama else None,
        "libllama_sha256": msr.sha256_file(libllama) if libllama else None,
        "libllama_governor_strings": has_governor_strings(libllama) if libllama else None,
        "server_impl_governor_strings": has_governor_strings(module) if module.exists() else None,
        "version": version[:200],
        "version_commit": commit_of(version),
        "mtimes": {"bin": mtime_of(bin_path),
                   "module": mtime_of(module) if module.exists() else None,
                   "libllama": mtime_of(libllama) if libllama else None},
        "release_status": block["status"],
        "release_reason_code": block.get("reason_code"),
    }


def ab_control(fork, release):
    """Refuse when the two arms are not two engines. The launcher is excluded
    on purpose: identical launchers across releases are exactly the trap."""
    fields = ("module_sha256", "libllama_sha256", "version_commit")
    same = [f for f in fields
            if fork.get(f) and fork.get(f) == release.get(f)]
    if same:
        raise SystemExit(
            f"REFUSING TO MEASURE: the two arms point at the same engine ({', '.join(same)} "
            f"equal) - this would be one engine measured twice, not an A/B. "
            f"fork={fork['bin']} release={release['bin']}")
    return {"distinct": True,
            "separated_by": [f for f in fields if f not in same],
            "identical_fields": same,
            "checked_fields": list(fields),
            "launcher_excluded": ("the launcher sha is identical across "
                                  "releases; never a separator")}


def scan_governor(lines):
    hits = [ln.strip() for ln in lines if GOV_RE.search(ln)]
    return {"count": len(hits),
            "samples": [h[:220] for h in hits[:5]],
            "pattern": GOV_RE.pattern,
            "verbosity_note": "engine runs at -lv 4; 0 lines means the path never announced at that level"}


def timing_lines(lines):
    return [ln.strip()[:200] for ln in lines if TIMING_RE.search(ln)][:5]


def start_burners(n):
    procs = []
    for _ in range(n):
        procs.append(subprocess.Popen(
            [sys.executable, "-c", "while True: pass"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
    return procs


def stop_burners(procs):
    for p in procs:
        try:
            p.kill()
        except Exception:
            pass
    for p in procs:
        try:
            p.wait(timeout=10)
        except Exception:
            pass


def run_arm(label, ident, size, args, burners=0, heat_s=0):
    """One fresh engine, one cold salted send: the prefill measurement."""
    suffix = f"{label}_{size}" + ("_under_load" if burners else "")
    arm_dir = Path(args.work) / suffix
    if arm_dir.exists():
        shutil.rmtree(arm_dir)
    slots = arm_dir / "slots"
    slots.mkdir(parents=True, exist_ok=True)
    argv = ["nice", "-n", str(NICE)] + msr.engine_argv(
        ident["bin"], args.model, args.port, args.ctx_size, arm_extra(slots))
    server = msr.Server(argv, arm_dir / "engine.log")
    blockers = []
    rec = {"engine": label, "size": size, "under_load": bool(burners),
           "burners": burners, "heat_s": heat_s if burners else 0}
    print(f"[{label} {size}{' under-load' if burners else ''}] starting", flush=True)
    burn = []
    try:
        if burners:
            # Heat BEFORE the boot, and keep the burners through the send: the
            # send then happens with the model resident, exactly like the old
            # run and the low-load arms (sleep-idle is 30 s, so heating after
            # the boot would release the model under us).
            burn = start_burners(burners)
            print(f"  [{burners} burners] heating {heat_s}s ...", flush=True)
            time.sleep(heat_s)
            print(f"  load under burners: {msr.loadavg()}", flush=True)
        server.start(args.port)
        rec["loadavg_arm_start"] = msr.loadavg()
        chat, _, sent = msr.make_chat(args.port, 1000 + size, size)
        chat_tokens = len(msr.tokenize(args.port, chat))
        msr.slot_action(args.port, 0, "erase", None, msr.SALT_HEX)
        pre = server.lines()
        out = msr.send(args.port, chat, msr.SALT_HEX, args.n_predict, 0, server)
        rec.update({
            "chat_tokens": chat_tokens,
            "prompt_n": out.get("prompt_n"),
            "prompt_ms": out.get("prompt_ms"),
            "ms_per_token": (round(out["prompt_ms"] / out["prompt_n"], 3)
                             if out.get("prompt_ms") and out.get("prompt_n") else None),
            "cache_n": out.get("cache_n"),
            "wall_ms": out.get("wall_ms"),
            "loadavg_at_send": out.get("loadavg"),
            "loadavg_after_send": msr.loadavg(),
            "released_before_send": any(RELEASE_LINE in l for l in pre),
            "cold": out.get("cache_n") == 0,
        })
        if out.get("cache_n") != 0:
            blockers.append(f"cache_n={out.get('cache_n')} - the prompt was not "
                            "cold, so prompt_ms is not a prefill measurement")
        rec["governor_lines"] = scan_governor(server.lines())
        rec["prompt_eval_lines"] = timing_lines(server.lines())
        rec["log"] = str(arm_dir / "engine.log")
        rec["_sentinel"] = sent
    finally:
        stop_burners(burn)
        server.stop()
    rec["blockers"] = blockers
    rec["valid"] = not blockers
    print(f"  -> {rec.get('prompt_n')} tok in {rec.get('prompt_ms')} ms = "
          f"{rec.get('ms_per_token')} ms/token, load {rec.get('loadavg_at_send')}, "
          f"governor lines {rec['governor_lines']['count']}, blockers {blockers}",
          flush=True)
    return rec, sent


def old_run_reference():
    """The anomaly, read from the committed artifact and (if still present)
    from the old run's own raw logs - nothing typed by hand."""
    ref = {"artifact": str(OLD_ARTIFACT.relative_to(HERE.parent))
           if OLD_ARTIFACT.exists() else None,
           "raw_logs_available": False, "raw_log_dir": str(OLD_LOG_DIR)}
    if OLD_ARTIFACT.exists():
        d = json.loads(OLD_ARTIFACT.read_text())
        prov = d.get("provenance") or {}
        ref.update({
            "engine_binary": prov.get("engine_binary"),
            "engine_sha256": prov.get("engine_sha256"),
            "engine_version": (prov.get("engine_version") or "").splitlines()[0],
            "loadavg_before": prov.get("loadavg_before"),
        })
        for size in ("600", "1900"):
            arm = ((d.get("arms") or {}).get(size) or {}).get("saved") or {}
            cold = arm.get("cold_send") or {}
            if cold.get("prompt_ms") and cold.get("prompt_n"):
                ref[f"ms_per_token_{size}"] = round(
                    cold["prompt_ms"] / cold["prompt_n"], 3)
                ref[f"prompt_ms_{size}"] = cold["prompt_ms"]
                ref[f"prompt_n_{size}"] = cold["prompt_n"]
    logs = sorted(OLD_LOG_DIR.glob("*/engine.log"))
    if logs:
        ref["raw_logs_available"] = True
        gov_count, samples, timings = 0, [], []
        for lg in logs:
            lines = lg.read_text(errors="replace").splitlines()
            g = scan_governor(lines)
            gov_count += g["count"]
            samples += [f"{lg.parent.name}: {s}" for s in g["samples"]][:3]
            timings += [f"{lg.parent.name}: {t}" for t in timing_lines(lines)][:2]
        ref["governor_lines_old_run"] = {"count": gov_count,
                                         "samples": samples[:5]}
        ref["prompt_eval_lines_old_run"] = timings[:4]
    return ref


def commits_between(old_commit, new_commit):
    """Which commits separate the two engines - read from the engine repo
    (read-only), recorded so the conclusion can name them."""
    try:
        out = subprocess.run(
            ["git", "-C", ENGINE_REPO, "log", "--oneline",
             f"{old_commit}..{new_commit}"],
            capture_output=True, text=True, timeout=20)
        if out.returncode == 0 and out.stdout.strip():
            return [ln.strip() for ln in out.stdout.strip().splitlines()[:10]]
    except Exception:
        pass
    return None


def governor_totals(arms):
    tot = {}
    for key, rec in arms.items():
        eng = rec["engine"]
        tot.setdefault(eng, {"count": 0, "samples": []})
        tot[eng]["count"] += rec["governor_lines"]["count"]
        tot[eng]["samples"] += rec["governor_lines"]["samples"]
        tot[eng]["samples"] = tot[eng]["samples"][:5]
    return tot


def decide(arms, old_ref, between):
    """One sentence: machine or build, with the numbers that say it."""
    def mpt(key):
        rec = arms.get(key)
        return rec.get("ms_per_token") if rec and rec.get("valid") else None

    f600, r600 = mpt("fork/600"), mpt("release/600")
    f19, r19 = mpt("fork/1900"), mpt("release/1900")
    f19l, r19l = mpt("fork/1900/load"), mpt("release/1900/load")
    old19 = old_ref.get("ms_per_token_1900")
    old600 = old_ref.get("ms_per_token_600")
    gov = governor_totals(arms)
    gov_note = ("governor/thermal lines logged: " + ", ".join(
        f"{k}={v['count']}" for k, v in sorted(gov.items()))
        + f", old run={((old_ref.get('governor_lines_old_run') or {}).get('count'))}")
    old_load = (old_ref.get("loadavg_before") or [None])[0]
    old_load = round(old_load, 2) if isinstance(old_load, (int, float)) else old_load

    same_low = (f19 and r19 and max(f19, r19) <= 2 * min(f19, r19))
    fork_slow_low = f19 and r19 and f19 >= 3 * r19
    fork_slow_load = f19l and old19 and f19l >= 0.5 * old19
    release_slow_load = r19l and old19 and r19l >= 0.5 * old19

    if fork_slow_low:
        tail = ""
        fl = arms.get("fork/1900/load") or {}
        rl = arms.get("release/1900/load") or {}
        if fl.get("ms_per_token") is not None and rl.get("ms_per_token") is not None:
            fl_load = (fl.get("loadavg_at_send") or [None])[0]
            rl_load = (rl.get("loadavg_at_send") or [None])[0]
            fl_load = round(fl_load, 1) if isinstance(fl_load, (int, float)) else fl_load
            rl_load = round(rl_load, 1) if isinstance(rl_load, (int, float)) else rl_load
            tail = (f"; under the burners the fork drifts to {fl['ms_per_token']} ms/token "
                    f"while the release holds at {rl['ms_per_token']} at load {rl_load} "
                    f"(the fork was measured at load {fl_load}) - contention hits only the "
                    "fork, which is what a prefill running off the GPU looks like")
        return (f"BUILD: at the same low load the fork prefills 1900 tokens at "
                f"{f19} ms/token against the release's {r19} "
                f"({round(f19 / r19, 1)}x), so the 16x follows the engine, not "
                f"the machine; the two commits between them are "
                f"{', '.join(between) if between else 'unknown (engine repo not readable)'}; "
                f"{gov_note}{tail}.")
    if fork_slow_load and release_slow_load:
        return (f"MACHINE: at low load both builds agree ({f19} vs {r19} ms/token "
                f"at 1900, {f600} vs {r600} at 600) and the old number returns "
                f"under contention - fork {f19l} and release {r19l} ms/token under "
                f"the same burners, against the old {old19} at load "
                f"{old_load}; {gov_note}.")
    if fork_slow_load and r19l is not None and not release_slow_load:
        return (f"BUILD under load: at low load the engines agree ({f19} vs {r19}) "
                f"but under the SAME burners the fork degrades to {f19l} ms/token "
                f"while the release stays at {r19l} - the degradation follows the "
                f"build; {gov_note}.")
    if same_low and not fork_slow_load:
        return (f"NOT DECIDED: the engines agree at low load ({f19} vs {r19} ms/token "
                f"at 1900, {f600} vs {r600} at 600) and the fork under load only "
                f"reached {f19l} against the old {old19}, so 90 s of burners did not "
                f"reproduce the old machine - candidates: MACHINE state (the old run "
                f"started at load {old_load} and was slow in its FIRST arm, "
                f"{old600} ms/token at 600: sustained contention at nice 10, or heat "
                f"this short run did not rebuild; temperature itself was not read, it "
                f"needs sudo) vs BUILD (the governor commits between the engines, see "
                f"provenance.commits_between_engines); separator: repeat at the old run's load level "
                f"for as long as it ran, or read the die temperature; {gov_note}.")
    return (f"NOT DECIDED: numbers do not separate the candidates - fork {f19}/"
            f"{f19l} (idle/load), release {r19}/{r19l} (idle/load), old {old19}; "
            f"candidates MACHINE state vs BUILD, separator: sustained load/heat as "
            f"in the old run, or a temperature reading; {gov_note}.")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--fork-bin", default=DEFAULT_FORK)
    ap.add_argument("--release-bin", default=DEFAULT_RELEASE)
    ap.add_argument("--model", default=msr.DEFAULT_MODEL)
    ap.add_argument("--work", default="/tmp/kalsa-prefill-ab")
    ap.add_argument("--port", type=int, default=19351)
    ap.add_argument("--sizes", default="600,1900")
    ap.add_argument("--ctx-size", type=int, default=8192)
    ap.add_argument("--n-predict", type=int, default=16)
    ap.add_argument("--max-load", type=float, default=6.0,
                    help="refuse to start while the 1-minute load average is "
                         "above this; the load arms then RAISE it on purpose "
                         "and record it per arm")
    ap.add_argument("--burners", type=int, default=7)
    ap.add_argument("--heat-s", type=int, default=90)
    ap.add_argument("--skip-load-arms", action="store_true")
    args = ap.parse_args()

    la0 = os.getloadavg()[0]
    if args.max_load > 0 and la0 > args.max_load:
        raise SystemExit(f"refusing to measure: 1-minute load {la0:.2f} above "
                         f"--max-load {args.max_load}")

    for p in (args.fork_bin, args.release_bin, args.model):
        if not Path(p).exists():
            raise SystemExit(f"missing file: {p}")

    sizes = [int(s) for s in args.sizes.split(",")]
    start_loadavg = msr.loadavg()   # BEFORE any arm: the floor this run passed
    idents = {"fork": engine_identity("fork", args.fork_bin),
              "release": engine_identity("release", args.release_bin)}
    control = ab_control(idents["fork"], idents["release"])
    old_ref = old_run_reference()
    between = commits_between(idents["fork"]["version_commit"],
                              idents["release"]["version_commit"])
    print(f"[A/B] distinct: {control['distinct']}; fork "
          f"{idents['fork']['version_commit']} module {str(idents['fork']['module_sha256'])[:12]}; "
          f"release {idents['release']['version_commit']} module "
          f"{str(idents['release']['module_sha256'])[:12]}", flush=True)

    order = [(eng, size, 0) for size in sizes for eng in ("fork", "release")]
    if not args.skip_load_arms:
        order += [(eng, 1900, args.burners) for eng in ("fork", "release")]

    arms = {}
    for label, size, burners in order:
        key = f"{label}/{size}" + ("/load" if burners else "")
        rec, _ = run_arm(label, idents[label], size, args,
                         burners=burners, heat_s=args.heat_s)
        arms[key] = rec
        time.sleep(2)

    # No chat text in the artifact, and none in the logs we quote from.
    leaked = []
    for rec in arms.values():
        sent = rec.pop("_sentinel", None)
        log = rec.get("log")
        if sent and log and Path(log).exists() \
                and sent in Path(log).read_text(errors="replace"):
            leaked.append(log)
    if leaked:
        raise SystemExit(f"REFUSING TO WRITE: chat text found in {leaked}")

    gov = governor_totals(arms)
    conclusion = decide(arms, old_ref, between)
    record = {
        "measurement": "prefill-build-ab",
        "question": "is the 16x slow cold prefill (7.86 ms/token on the old "
                    "fork run vs 0.49 on the release) the machine or the build?",
        "provenance": {
            "script": str(Path(__file__).resolve()),
            "script_sha256": msr.sha256_file(Path(__file__).resolve()),
            "release_derivation": {"script": "dev/measure-concurrency.py",
                                   "sha256": msr.sha256_file(MC_SCRIPT),
                                   "loaded_as": "importlib module mconc"},
            "model": args.model,
            "model_sha256": msr.sha256_file(args.model),
            "sizes": sizes, "ctx_size": args.ctx_size,
            "n_predict": args.n_predict, "port": args.port,
            "max_load": args.max_load,
            "burners": args.burners, "heat_s": args.heat_s,
            "load_arms": not args.skip_load_arms,
            "arm_order": [f"{e}/{s}" + ("/load" if b else "")
                          for e, s, b in order],
            "engine_nice": NICE,
            "engine_flags_source": ("same flags as the old unload-restore run "
                                    "(arm_extra): only the engine differs"),
            "cold_definition": "cache_n == 0 on the salted send",
            "loadavg_before": start_loadavg,
            "commits_between_engines": between,
            "raw_logs_committed": False,
        },
        "engines": idents,
        "ab_control": control,
        "governor_lines": gov,
        "old_run": old_ref,
        "arms": arms,
        "conclusion": conclusion,
    }
    record["provenance"]["loadavg_after"] = msr.loadavg()

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(record, indent=1) + "\n")
    print("\n" + conclusion)
    print("wrote", out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
