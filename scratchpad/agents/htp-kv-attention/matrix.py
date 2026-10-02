"""The measured arms and their llama-bench command lines.

Question under test: with the HTP backend, does `no_kv_offload` (KV in host
memory, attention nodes pinned to CPU by src/llama-graph.cpp:2746) explain the
128-token prefill chunks slowing with context and the modest NPU/GPU ratio?
"""

DEVICE_DIR = "/data/local/tmp/htp-kv-attention"
DEPTHS = "0,512,1700,3100"
PROFILE_DEPTH = "1700"
# The route-proof run per arm: short (depth 0, one rep), verbose; the timing
# run then repeats the same arm clean.
ROUTE_DEPTH = "0"
ROUTE_REPS = "1"
REPS = "3"
THREADS = "5"
CHUNK_TOKENS = 128
COOLDOWN_S = 120

# The app sends flash_attn_type "auto" (src/engine/LlamaService.ts:2471) and
# ships v q4_0, which the engine refuses to init with FA off — so "auto"
# resolves to FA on in production. -fa auto on every arm IS the app setting;
# the planned extra -fa 1 arms only apply when the app's setting is off.
FLASH_ATTN = "auto"


class Arm:
    def __init__(self, name, ctk, ctv, nkvo, why):
        self.name = name
        self.ctk = ctk
        self.ctv = ctv
        self.nkvo = nkvo
        self.why = why


ARMS = [
    Arm("A-nkvo", "q8_0", "q8_0", 1,
        "KV on host -> attention pinned to CPU (the suspected app path)"),
    Arm("B-offload", "q8_0", "q8_0", 0,
        "KV on HTP -> attention on HTP (the path the app cannot ship)"),
    Arm("C-app-vq4", "q8_0", "q4_0", 1,
        "shipping app KV (src/engine/ModelRegistry.ts kvCache q8_0/q4_0)"),
]

# No -v here: logging skews timing. The route-proof run adds -v (llama-bench
# drops every log line without it, tools/llama-bench/llama-bench.cpp:2283) via
# bench_cmd(verbose=True); only clean runs feed the TSV.
BASE_FLAGS = ["-ngl", "99", "-dev", "HTP0", "-p", str(CHUNK_TOKENS), "-n", "0",
              "-b", "128", "-ub", "128", "-t", THREADS, "-fa", FLASH_ATTN,
              "--no-warmup", "-o", "md"]


def bench_cmd(arm, depths=DEPTHS, reps=REPS, verbose=False):
    flags = BASE_FLAGS + (["-v"] if verbose else [])
    return ["./bin/llama-bench", "-m", "ship.gguf", *flags,
            "-d", depths, "-r", reps,
            "-ctk", arm.ctk, "-ctv", arm.ctv, "-nkvo", str(arm.nkvo)]


def remote_env(arch, verbose=False):
    # LD_LIBRARY_PATH is the kit lib dir only, never /vendor/lib64; the DSP
    # skel libggml-htp-<arch>.so is found through ADSP_LIBRARY_PATH. The
    # execute-op route lines need GGML_HEXAGON_VERBOSE=1, the timing run must
    # not carry it.
    verbose_env = " GGML_HEXAGON_VERBOSE=1" if verbose else ""
    return (f"export LD_LIBRARY_PATH='{DEVICE_DIR}/lib' "
            f"ADSP_LIBRARY_PATH='{DEVICE_DIR}/lib' GGML_HEXAGON_NDEV=1"
            + verbose_env)


def profiled_env():
    # Placement proof: GGML_SCHED_DEBUG=2 prints each op's backend assignment;
    # GGML_HEXAGON_PROFILE=1 adds per-op HTP microseconds.
    return "GGML_HEXAGON_PROFILE=1 GGML_SCHED_DEBUG=2"


def _run_minutes(depths, reps, load_s=90, ctx_alloc_s=8, htp_pp_tps=400,
                 rep_s=3):
    sweep = sum(int(d) / htp_pp_tps + ctx_alloc_s + reps * rep_s
                for d in depths.split(","))
    return (load_s + sweep) / 60.0


def estimate_minutes(target_kind):
    """Documented rough order of magnitude, not a promise: it lets the
    deadline knob be set honestly before the first device minute is spent.
    QDC is reached over a network tunnel: slower push, same on-device time.
    Counts the per-arm route-proof run and the between-arm cool-downs."""
    push_min = 3.0 if target_kind == "qrd-tunnel" else 2.0
    route = len(ARMS) * _run_minutes(ROUTE_DEPTH, int(ROUTE_REPS))
    arms = sum(_run_minutes(DEPTHS, int(REPS)) for _ in ARMS)
    profiled = 2 * _run_minutes(PROFILE_DEPTH, 1)
    cooldowns = (len(ARMS) - 1) * COOLDOWN_S + 2 * COOLDOWN_S
    return push_min + route + arms + profiled + cooldowns / 60.0
