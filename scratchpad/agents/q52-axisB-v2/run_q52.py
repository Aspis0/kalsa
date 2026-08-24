#!/usr/bin/env python3
"""Run the locked q52 axis-B v2 matrix, one idle llama-cli at a time."""
from __future__ import annotations

import hashlib
import json
import os
import signal
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(r"C:\Users\gualt\Desktop\Kalsa\moe-experiments")
HERE = ROOT / "scratchpad" / "agents" / "q52-axisB-v2"
PROMPTS_PATH = ROOT / "scratchpad" / "agents" / "q49-marco-bprime-axisB" / "prompts.json"
CLI = ROOT / "build-llama-pc" / "bin" / "llama-cli.exe"
MARCO = ROOT / "scratchpad" / "agents" / "q37-bprime-from-source" / "gguf" / "marco"

PROMPT_SHA = "56574436b342d71464b58fd66982a2dbf8b9fb3f5fb14ddf12bf01cca2aacfb9"
ARM_PATHS = {
    "control": MARCO / "Marco-Mini-Instruct-KEXP-fromsrc-trunk-control.gguf",
    "q8_0": MARCO / "Marco-Mini-Instruct-KEXP-fromsrc-trunk-q8_0.gguf",
}
ARM_SHA = {
    "control": "f3e2826f78c78452afa0765613875c806f1ca3976f1f59ff4e8ff85bea5782ea",
    "q8_0": "bd63fc0f21a8c3aab4b7531ee30aa37f8e6320dfb65e85de74a9056e2feeb419",
}

PREREG_COMMIT = "1a1c9a19"
N_PREDICT = 1024
THREADS = 8
NGLL = 0
MIN_FREE_BYTES = 10 * 1024**3
BASE_SEEDS = (101, 102, 103)
LOOP_SEEDS = tuple(range(201, 211))
LOOP_IDS = ("code_en_05", "long_it_04")
ARMS = ("control", "q8_0")
ESCALATION_ID = "long_it_04"
ESCALATION_SEEDS = tuple(range(301, 311))

LOCKED_FLAGS = (
    "--temp",
    "--top-k",
    "--top-p",
    "--min-p",
    "--repeat-last-n",
    "--repeat-penalty",
    "--mirostat",
    "--seed",
    "-cnv",
    "--single-turn",
    "--no-display-prompt",
    "--log-disable",
    "--no-warmup",
    "--reasoning",
)


def utc() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def sha256_bytes(blob: bytes) -> str:
    return hashlib.sha256(blob).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def append_md(message: str) -> None:
    with (HERE / "RUN_LOG.md").open("a", encoding="utf-8") as handle:
        handle.write(f"\n- `{utc()}` {message}\n")


def slog(message: str) -> None:
    line = f"{utc()} {message}"
    print(line, flush=True)
    with (HERE / "run.log").open("a", encoding="utf-8") as handle:
        handle.write(line + "\n")


def ignore_console_signals() -> None:
    signal.signal(signal.SIGINT, signal.SIG_IGN)
    sigbreak = getattr(signal, "SIGBREAK", None)
    if sigbreak is not None:
        signal.signal(sigbreak, signal.SIG_IGN)
    if os.name == "nt":
        try:
            import ctypes

            ctypes.windll.kernel32.SetConsoleCtrlHandler(None, True)
        except Exception as exc:
            append_md(f"SetConsoleCtrlHandler hardening unavailable: `{type(exc).__name__}: {exc}`")


def strip_chat(raw: str) -> str:
    for marker in ("Assistant:", "assistant\n", "<|im_start|>assistant"):
        if marker in raw:
            raw = raw.split(marker, 1)[1]
            break
    for end in ("<|im_end|>", "</s>", "<|eot_id|>"):
        if end in raw:
            raw = raw.split(end, 1)[0]
    return raw.strip()


def verify_cli_help() -> dict[str, str]:
    result = subprocess.run(
        [str(CLI), "--help"],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    help_text = result.stdout + result.stderr
    missing = [flag for flag in LOCKED_FLAGS if flag not in help_text]
    if result.returncode != 0:
        raise SystemExit(f"STOP llama-cli --help returned rc={result.returncode}")
    if missing:
        raise SystemExit(f"STOP required llama-cli flags missing from --help: {missing}")
    return {flag: "exact" for flag in LOCKED_FLAGS}


def verify_preconditions() -> tuple[dict, str, dict[str, str], int]:
    if not CLI.is_file():
        raise SystemExit(f"STOP missing llama-cli: {CLI}")
    if not PROMPTS_PATH.is_file():
        raise SystemExit(f"STOP missing prompts file: {PROMPTS_PATH}")
    prompt_blob = PROMPTS_PATH.read_bytes()
    prompt_sha = sha256_bytes(prompt_blob)
    if prompt_sha != PROMPT_SHA:
        raise SystemExit(f"STOP prompts.json sha mismatch: {prompt_sha} != {PROMPT_SHA}")
    prompt_data = json.loads(prompt_blob.decode("utf-8"))
    prompts = prompt_data.get("prompts")
    if not isinstance(prompts, list) or len(prompts) != 60:
        raise SystemExit("STOP prompts.json does not contain exactly 60 prompts")
    prompt_map = {item.get("id"): item for item in prompts}
    if len(prompt_map) != 60 or any(not item.get("id") or not item.get("text") for item in prompts):
        raise SystemExit("STOP prompts.json has missing or duplicate prompt IDs/text")
    if any(prompt_id not in prompt_map for prompt_id in LOOP_IDS):
        raise SystemExit("STOP loop-prone prompt IDs are missing")

    observed_arm_sha: dict[str, str] = {}
    for arm, path in ARM_PATHS.items():
        if not path.is_file():
            raise SystemExit(f"STOP missing {arm} GGUF: {path}")
        observed = sha256_file(path)
        observed_arm_sha[arm] = observed
        if observed != ARM_SHA[arm]:
            raise SystemExit(f"STOP GGUF sha mismatch {arm}: {observed} != {ARM_SHA[arm]}")

    cli_sha = sha256_file(CLI)
    free_bytes = shutil.disk_usage(HERE).free
    if free_bytes < MIN_FREE_BYTES:
        raise SystemExit(
            f"STOP insufficient free disk space for gen output: {free_bytes} bytes < {MIN_FREE_BYTES}"
        )
    help_flags = verify_cli_help()
    return prompt_data, cli_sha, help_flags, free_bytes


def matrix_jobs(prompts: list[dict]) -> list[tuple[str, int, str]]:
    jobs: list[tuple[str, int, str]] = []
    for prompt in prompts:
        for seed in BASE_SEEDS:
            for arm in ARMS:
                jobs.append((prompt["id"], seed, arm))
    for prompt_id in LOOP_IDS:
        for seed in LOOP_SEEDS:
            for arm in ARMS:
                jobs.append((prompt_id, seed, arm))
    if len(jobs) != 400 or len(set(jobs)) != 400:
        raise SystemExit(f"STOP matrix construction error: {len(jobs)} jobs")
    return jobs


def manifest_template(cli_sha: str, help_flags: dict[str, str], free_bytes: int) -> dict:
    return {
        "schema": "q52-axisB-v2-run-manifest",
        "phase": 1,
        "prereg_commit": PREREG_COMMIT,
        "start_timestamp_utc": utc(),
        "prompt_path": str(PROMPTS_PATH),
        "prompt_sha256": PROMPT_SHA,
        "arm_paths": {arm: str(path) for arm, path in ARM_PATHS.items()},
        "arm_sha256": ARM_SHA,
        "llama_cli_path": str(CLI),
        "llama_cli_sha256": cli_sha,
        "disk_free_bytes_start": free_bytes,
        "disk_free_gib_start": round(free_bytes / 1024**3, 2),
        "cli_help_flags": help_flags,
        "flag_mapping_notes": "All requested spellings are exact in llama-cli --help; no mapping required.",
        "locked_command": [
            "build-llama-pc/bin/llama-cli.exe",
            "-m MODEL -f prompt.txt -o out.txt",
            "-n 1024",
            "--temp 0.7 --top-k 40 --top-p 0.95 --min-p 0.05",
            "--repeat-last-n 64 --repeat-penalty 1.0",
            "--mirostat 0",
            "--seed SEED",
            "-c 4096 -t 8 -ngl 0",
            "-cnv --single-turn --no-display-prompt --log-disable",
            "--no-warmup --reasoning off",
        ],
        "run_policy": {
            "n_predict": N_PREDICT,
            "threads": THREADS,
            "ngl": NGLL,
            "priority": "Idle",
            "processes": "one llama-cli at a time, sequential",
            "resume_rule": "skip existing non-empty gen/<arm>/<id>_s<seed>.txt",
            "failure_policy": "retry each failed run once; after two failures log FAILED-SKIP and continue",
        },
        "matrix": {
            "base": {
                "prompt_count": 60,
                "prompt_ids": "all prompts from frozen q49 prompts.json",
                "seeds": list(BASE_SEEDS),
                "arms": list(ARMS),
                "generations": 360,
            },
            "loop_prone": {
                "prompt_ids": list(LOOP_IDS),
                "seeds": list(LOOP_SEEDS),
                "arms": list(ARMS),
                "generations": 40,
            },
            "total_generations": 400,
        },
        "runs": [],
        "failed_runs": [],
    }


def write_manifest(path: Path, manifest: dict) -> None:
    temp_path = path.with_suffix(".json.tmp")
    temp_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    temp_path.replace(path)


def generate(
    arm: str,
    prompt_id: str,
    prompt_text: str,
    seed: int,
    gen_dir: Path,
    attempt: int,
    log_tag: str = "",
) -> dict:
    arm_dir = gen_dir / arm
    arm_dir.mkdir(parents=True, exist_ok=True)
    output_path = arm_dir / f"{prompt_id}_s{seed}.txt"
    raw_path = arm_dir / f".{prompt_id}_s{seed}.raw.txt"
    prompt_path = gen_dir / f"._prompt_{prompt_id}_s{seed}.txt"
    stderr_path = arm_dir / f".{prompt_id}_s{seed}.stderr.log"

    prompt_path.write_text(prompt_text, encoding="utf-8")
    raw_path.unlink(missing_ok=True)
    command = [
        str(CLI),
        "-m",
        str(ARM_PATHS[arm]),
        "-f",
        str(prompt_path),
        "-o",
        str(raw_path),
        "-n",
        str(N_PREDICT),
        "--temp",
        "0.7",
        "--top-k",
        "40",
        "--top-p",
        "0.95",
        "--min-p",
        "0.05",
        "--repeat-last-n",
        "64",
        "--repeat-penalty",
        "1.0",
        "--mirostat",
        "0",
        "--seed",
        str(seed),
        "-c",
        "4096",
        "-t",
        str(THREADS),
        "-ngl",
        str(NGLL),
        "-cnv",
        "--single-turn",
        "--no-display-prompt",
        "--log-disable",
        "--no-warmup",
        "--reasoning",
        "off",
    ]
    env = os.environ.copy()
    env["PATH"] = f"{CLI.parent}{os.pathsep}" + env.get("PATH", "")
    idle_priority = getattr(subprocess, "IDLE_PRIORITY_CLASS", 0x00000040)
    started = time.perf_counter()
    tag = f"{log_tag}_" if log_tag else ""
    slog(
        f"{tag}START id={prompt_id} seed={seed} arm={arm} attempt={attempt} "
        f"n_predict={N_PREDICT} threads=8 priority=Idle"
    )
    with stderr_path.open("a", encoding="utf-8", errors="replace") as stderr:
        stderr.write(
            f"\n===== {utc()} {log_tag or 'BASE'} id={prompt_id} seed={seed} "
            f"arm={arm} attempt={attempt} =====\n"
        )
        idle_priority = getattr(subprocess, "IDLE_PRIORITY_CLASS", 0x00000040)
        new_process_group = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0x00000200)
        no_window = getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000)
        process = subprocess.Popen(
            command,
            cwd=str(ROOT),
            env=env,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=stderr,
            creationflags=idle_priority | no_window | new_process_group,
        )
        return_code = process.wait()
    wall_seconds = time.perf_counter() - started
    raw = raw_path.read_text(encoding="utf-8", errors="replace") if raw_path.exists() else ""
    output = strip_chat(raw)
    output_path.write_text(output, encoding="utf-8")
    output_chars = len(output)
    record = {
        "id": prompt_id,
        "seed": seed,
        "arm": arm,
        "attempt": attempt,
        "return_code": return_code,
        "n_predict": N_PREDICT,
        "threads": THREADS,
        "priority": "Idle",
        "wall_seconds": round(wall_seconds, 2),
        "output_chars": output_chars,
        "output_sha256": sha256_bytes(output.encode("utf-8")),
        "timestamp_utc": utc(),
        "output_path": str(output_path),
    }
    slog(
        f"{tag}DONE id={prompt_id} seed={seed} arm={arm} attempt={attempt} rc={return_code} "
        f"wall_s={wall_seconds:.1f} output_chars={output_chars}"
    )
    if return_code != 0 or output_chars == 0:
        output_path.unlink(missing_ok=True)
        slog(
            f"{tag}UNTRUSTED_DELETE id={prompt_id} seed={seed} arm={arm} attempt={attempt} "
            f"rc={return_code} output_chars={output_chars}"
        )
    return record


def run_with_retries(
    arm: str,
    prompt_id: str,
    prompt_text: str,
    seed: int,
    gen_dir: Path,
    manifest: dict,
    manifest_path: Path,
    log_tag: str = "",
) -> dict | None:
    tag = f"{log_tag}_" if log_tag else ""
    attempts: list[dict] = []
    for attempt in (1, 2):
        record = generate(arm, prompt_id, prompt_text, seed, gen_dir, attempt, log_tag)
        attempts.append(record)
        if record["return_code"] == 0 and record["output_chars"] > 0:
            if attempt > 1:
                record["retried"] = True
                slog(f"{tag}RETRY_SUCCESS id={prompt_id} seed={seed} arm={arm} attempts={attempt}")
            return record
        if attempt == 1:
            slog(
                f"{tag}RETRY id={prompt_id} seed={seed} arm={arm} "
                f"rc={record['return_code']} output_chars={record['output_chars']}"
            )

    failed = {
        "id": prompt_id,
        "seed": seed,
        "arm": arm,
        "attempts": attempts,
        "timestamp_utc": utc(),
    }
    manifest.setdefault("failed_runs", []).append(failed)
    write_manifest(manifest_path, manifest)
    slog(
        f"{tag}FAILED-SKIP id={prompt_id} seed={seed} arm={arm} "
        f"attempts=2 rc1={attempts[0]['return_code']} rc2={attempts[1]['return_code']}"
    )
    return None


def escalation_manifest_template(cli_sha: str, help_flags: dict[str, str], free_bytes: int) -> dict:
    return {
        "schema": "q52-axisB-v2-escalation-manifest",
        "phase": 2,
        "prereg_commit": PREREG_COMMIT,
        "start_timestamp_utc": utc(),
        "prompt_path": str(PROMPTS_PATH),
        "prompt_sha256": PROMPT_SHA,
        "arm_paths": {arm: str(path) for arm, path in ARM_PATHS.items()},
        "arm_sha256": ARM_SHA,
        "llama_cli_path": str(CLI),
        "llama_cli_sha256": cli_sha,
        "disk_free_bytes_start": free_bytes,
        "cli_help_flags": help_flags,
        "matrix": {
            "prompt_ids": [ESCALATION_ID],
            "seeds": list(ESCALATION_SEEDS),
            "arms": list(ARMS),
            "generations": 20,
        },
        "run_policy": {
            "n_predict": N_PREDICT,
            "threads": THREADS,
            "ngl": NGLL,
            "priority": "Idle",
            "processes": "one llama-cli at a time, sequential",
            "resume_rule": "skip existing non-empty gen/<arm>/<id>_s<seed>.txt",
            "failure_policy": "retry each failed run once; after two failures log ESC_FAILED-SKIP and continue",
        },
        "runs": [],
        "failed_runs": [],
    }


def main_escalation() -> None:
    ignore_console_signals()
    HERE.mkdir(parents=True, exist_ok=True)
    prompt_data, cli_sha, help_flags, free_bytes = verify_preconditions()
    prompts = prompt_data["prompts"]
    prompt_map = {prompt["id"]: prompt for prompt in prompts}
    if ESCALATION_ID not in prompt_map:
        raise SystemExit(f"STOP missing escalation prompt: {ESCALATION_ID}")
    jobs = [(ESCALATION_ID, seed, arm) for seed in ESCALATION_SEEDS for arm in ARMS]
    if len(jobs) != 20:
        raise SystemExit(f"STOP escalation matrix construction error: {len(jobs)} jobs")

    manifest_path = HERE / "escalation_manifest.json"
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if manifest.get("prereg_commit") != PREREG_COMMIT:
            raise SystemExit("STOP existing escalation_manifest.json has a different prereg commit")
        if manifest.get("prompt_sha256") != PROMPT_SHA or manifest.get("llama_cli_sha256") != cli_sha:
            raise SystemExit("STOP existing escalation manifest precondition hashes do not match")
        prior_runs = manifest.get("runs", [])
        manifest["runs"] = [
            record for record in prior_runs if record.get("return_code") == 0 and record.get("output_chars", 0) > 0
        ]
        manifest.setdefault("failed_runs", [])
        write_manifest(manifest_path, manifest)
    else:
        manifest = escalation_manifest_template(cli_sha, help_flags, free_bytes)
        write_manifest(manifest_path, manifest)

    append_md(
        f"Escalation runner started for `{ESCALATION_ID}` only, seeds `301..310`, both arms, "
        f"20 generations; code_en_05 excluded by per-prompt arbitration."
    )
    slog(
        f"ESC_RUNNER_START prereg_commit={PREREG_COMMIT} prompt_sha={PROMPT_SHA} "
        f"cli_sha={cli_sha} planned=20"
    )
    gen_dir = HERE / "gen"
    gen_dir.mkdir(parents=True, exist_ok=True)
    existing_outputs = 0
    for prompt_id, seed, arm in jobs:
        output_path = gen_dir / arm / f"{prompt_id}_s{seed}.txt"
        if output_path.exists() and output_path.stat().st_size > 0:
            existing_outputs += 1
            slog(f"ESC_SKIP id={prompt_id} seed={seed} arm={arm} existing_output_chars={output_path.stat().st_size}")
            continue
        record = run_with_retries(
            arm,
            prompt_id,
            prompt_map[prompt_id]["text"],
            seed,
            gen_dir,
            manifest,
            manifest_path,
            log_tag="ESC",
        )
        if record is not None:
            record["matrix_set"] = "escalation"
            manifest.setdefault("runs", []).append(record)
            write_manifest(manifest_path, manifest)

    append_md(
        f"Escalation runner completed or reached its resumable frontier; pre-existing non-empty outputs skipped: `{existing_outputs}`."
    )
    slog(f"ESC_ALL_GEN_DONE planned=20 existing_skips={existing_outputs} recorded_runs={len(manifest.get('runs', []))}")


def main() -> None:
    ignore_console_signals()
    HERE.mkdir(parents=True, exist_ok=True)
    prompt_data, cli_sha, help_flags, free_bytes = verify_preconditions()
    prompts = prompt_data["prompts"]
    jobs = matrix_jobs(prompts)
    manifest_path = HERE / "run_manifest.json"
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if manifest.get("prereg_commit") != PREREG_COMMIT:
            raise SystemExit("STOP existing run_manifest.json has a different prereg commit")
        if manifest.get("prompt_sha256") != PROMPT_SHA or manifest.get("llama_cli_sha256") != cli_sha:
            raise SystemExit("STOP existing run_manifest.json precondition hashes do not match")
        prior_runs = manifest.get("runs", [])
        clean_runs = [record for record in prior_runs if record.get("return_code") == 0 and record.get("output_chars", 0) > 0]
        if len(clean_runs) != len(prior_runs):
            manifest["runs"] = clean_runs
        manifest.setdefault("failed_runs", [])
        manifest.setdefault("run_policy", {})["failure_policy"] = "retry each failed run once; after two failures log FAILED-SKIP and continue"
        write_manifest(manifest_path, manifest)
    else:
        manifest = manifest_template(cli_sha, help_flags, free_bytes)
        write_manifest(manifest_path, manifest)

    append_md(
        f"Detached runner verified preconditions again: control sha `{ARM_SHA['control']}`, "
        f"q8_0 sha `{ARM_SHA['q8_0']}`, prompts sha `{PROMPT_SHA}`, llama-cli sha `{cli_sha}`, "
        f"free disk `{free_bytes}` bytes; matrix is `{len(jobs)}` generations."
    )
    slog(
        f"RUNNER_START prereg_commit={PREREG_COMMIT} prompt_sha={PROMPT_SHA} "
        f"cli_sha={cli_sha} free_bytes={free_bytes} planned=400"
    )
    gen_dir = HERE / "gen"
    gen_dir.mkdir(parents=True, exist_ok=True)
    existing_outputs = 0
    for prompt_id, seed, arm in jobs:
        output_path = gen_dir / arm / f"{prompt_id}_s{seed}.txt"
        if output_path.exists() and output_path.stat().st_size > 0:
            existing_outputs += 1
            slog(f"SKIP id={prompt_id} seed={seed} arm={arm} existing_output_chars={output_path.stat().st_size}")
            continue
        prompt = next(item for item in prompts if item["id"] == prompt_id)
        record = run_with_retries(arm, prompt_id, prompt["text"], seed, gen_dir, manifest, manifest_path)
        if record is not None:
            manifest.setdefault("runs", []).append(record)
            write_manifest(manifest_path, manifest)

    append_md(f"Runner completed or reached current resumable frontier; pre-existing non-empty outputs skipped: `{existing_outputs}`.")
    slog(f"ALL_GEN_DONE planned=400 existing_skips={existing_outputs} recorded_runs={len(manifest.get('runs', []))}")


if __name__ == "__main__":
    try:
        if "--escalation" in sys.argv:
            main_escalation()
        else:
            main()
    except Exception as exc:
        append_md(f"Runner exception: `{type(exc).__name__}: {exc}`")
        raise
