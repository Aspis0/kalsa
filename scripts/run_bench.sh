#!/usr/bin/env bash
# =============================================================================
# run_bench.sh — harness di telemetria per run llama.cpp / bmoe-cli su Termux (S23)
#
# Scopo: wrappare un run di llama-cli o bmoe-cli, catturare telemetria pre/durante/post
# e appendere UNA riga a runs.csv (schema §8.3).
#
# Uso:
#   ./run_bench.sh --model <gguf> --prompt-file <file> [opzioni]
#
# Esempi:
#   # F3 mainline mmap naive
#   ./run_bench.sh -m ~/models/qwen35b-udiq2m.gguf -p ~/experiments/prompts/short.txt \
#       --phase F3 --runtime mainline --run-type cold --n-gen 32
#
#   # F4.2 BigMoeOnEdge
#   ./run_bench.sh -m ~/models/qwen35b-udiq2m.gguf -p ~/experiments/prompts/short.txt \
#       --phase F4.2 --runtime bigmoe --flags "--moe-stream --cache-mb 2000"
#
#   # Solo stampa cmdline (niente run, niente CSV)
#   ./run_bench.sh -m m.gguf -p p.txt --runtime bigmoe --print-cmd --allow-no-battery
#
# Riferimenti: PLAN.md §8.1 (metriche), §8.2 (regole di misura), §8.3 (schema CSV)
# Exit: 0=ok+riga · 1=llama fail (riga con FAIL) · 3=usage · 4=in carica ·
#       5=troppo caldo · 6=binario assente · 7=gate batteria non disponibile/incerto
#
# Test: source con RUN_BENCH_LIB_ONLY=1 per caricare solo le helper di parsing.
# =============================================================================

set -o pipefail
export LC_ALL=C

# ---------------------------------------------------------------------------
# Default
# ---------------------------------------------------------------------------
MODEL=""
PROMPT_FILE=""
PROMPT_ID="short"
PHASE="F2"
QUANT=""
FILE_GB=""
RUNTIME="mainline"
RUNTIME_COMMIT=""
EXTRA_FLAGS=""
THREADS=4
N_CTX=512
KV_TYPE="q8_0"
N_GEN=64
RUN_TYPE="warm"
LOG_PATH=""
NOTES_USER=""
CSV_PATH="${RUNS_CSV:-$HOME/experiments/results/runs.csv}"
RUN_ID=""
# Vuoto = scelto da --runtime (mainline/ik/custom→llama-cli, bigmoe→bmoe-cli)
BINARY=""
PRINT_CMD=0
ALLOW_NO_BATTERY=0
# Run-level wall timeout (s). Floor 2700 (45 min): 35B naive load alone can take 10–30+ min.
# Harness timeout is NOT scientific data (exit 8, notes BLOCKED/timeout); only lmkd/OOM is.
RUN_TIMEOUT_S="${RUN_TIMEOUT_S:-2700}"
# 1 = drop --simple-io so classic llama_perf_context_print (and ttft_ms) appears (F3+).
# Default 0 keeps compact summary for F2/F4-compat.
CLASSIC_PERF=0
# ISA preflight: 1=sempre · 0=UNSAFE esplicito (vietato F1–F4) · auto=default (mandatory su F1–F4)
PREFLIGHT_ISA="${PREFLIGHT_ISA:-auto}"

# ---------------------------------------------------------------------------
# Helper: parsing /proc (esposte per i test via RUN_BENCH_LIB_ONLY=1)
# PROC_ROOT override (default /proc) permette ai test di puntare a un albero fake.
# ---------------------------------------------------------------------------
PROC_ROOT="${PROC_ROOT:-/proc}"

# Path script (per preflight + lib)
_RUN_BENCH_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}" 2>/dev/null || dirname "$0")" && pwd 2>/dev/null || true)"

# Estrae minflt e majflt da <PROC_ROOT>/<pid>/stat in modo robusto
# (campo 2 = comm tra parentesi, può contenere spazi)
# Dopo strip fino all'ULTIMA ')', nel resto: minflt=campo 8, majflt=campo 10
read_flt() {
    _pid="$1"
    _stat="${PROC_ROOT}/${_pid}/stat"
    if [ ! -r "$_stat" ]; then
        echo "0 0"
        return
    fi
    # strip fino all'ultima ')' inclusa
    _rest="$(sed 's/.*) //' "$_stat" 2>/dev/null)"
    if [ -z "$_rest" ]; then
        echo "0 0"
        return
    fi
    # shell word-split sul resto
    # shellcheck disable=SC2086
    set -- $_rest
    # $1=state ... $8=minflt $10=majflt
    _minflt="${8:-0}"
    _majflt="${10:-0}"
    echo "${_minflt} ${_majflt}"
}

read_read_bytes() {
    _pid="$1"
    _io="${PROC_ROOT}/${_pid}/io"
    if [ ! -r "$_io" ]; then
        echo "0"
        return
    fi
    awk '/^read_bytes:/{print $2; found=1} END{if(!found) print 0}' "$_io" 2>/dev/null
}

read_vmrss_kb() {
    _pid="$1"
    _st="${PROC_ROOT}/${_pid}/status"
    if [ ! -r "$_st" ]; then
        echo "0"
        return
    fi
    awk '/^VmRSS:/{print $2; found=1} END{if(!found) print 0}' "$_st" 2>/dev/null
}

read_meminfo() {
    # stampa: MemFree_kB MemAvailable_kB
    if [ ! -r "${PROC_ROOT}/meminfo" ]; then
        echo "0 0"
        return
    fi
    awk '
        /^MemFree:/{free=$2}
        /^MemAvailable:/{avail=$2}
        END{print free+0, avail+0}
    ' "${PROC_ROOT}/meminfo"
}

# Sanitizza notes per CSV: niente virgole/newline
sanitize_notes() {
    printf '%s' "$1" | tr ',\n\r' ';;;' | tr -s ';' | sed 's/^;//;s/;$//'
}

# ---------------------------------------------------------------------------
# Helper: parsing timings da log (esposte per i test via RUN_BENCH_LIB_ONLY=1)
# ---------------------------------------------------------------------------
# parse_timings <logfile> [runtime] [binary]
# Imposta: PROMPT_TOK_S EVAL_TOK_S TTFT_MS EXPERT_HIT_RATE TIMING_NOTE
#
# Formati supportati (mai inventare numeri):
#   llama-cli  → blocco llama_perf_context_print (prompt eval / eval time)
#   bmoe-cli   → summary lines (BigMoeOnEdge/cli/main.cpp):
#     generation: %d tokens, %.3f s/token (%.3f tok/s)
#     prefill: %d tokens, %.3f s (%.1f tok/s) | model load %.3f s | TTFT %.3f s
#     moe-cache: %.1f%% hit, resident %.1f MiB[, budget %.0f MiB (auto)]
# Preferenza: bigmoe runtime o binario bmoe-cli → bmoe first; altrimenti llama first.
# Se il formato preferito manca, prova l'altro. Se entrambi assenti → TIMING_NOTE.
parse_timings() {
    _pt_log="${1:-}"
    _pt_runtime="${2:-}"
    _pt_binary="${3:-}"

    PROMPT_TOK_S=""
    EVAL_TOK_S=""
    TTFT_MS=""
    EXPERT_HIT_RATE=""
    TIMING_NOTE=""

    if [ -z "$_pt_log" ] || [ ! -r "$_pt_log" ]; then
        TIMING_NOTE="no timings in log"
        return 0
    fi

    _prefer_bmoe=0
    if [ "$_pt_runtime" = "bigmoe" ]; then
        _prefer_bmoe=1
    fi
    case "$_pt_binary" in
        bmoe-cli|*bmoe-cli*) _prefer_bmoe=1 ;;
    esac

    if [ "$_prefer_bmoe" -eq 1 ]; then
        _parse_bmoe_timings "$_pt_log"
        if [ -z "$PROMPT_TOK_S" ] && [ -z "$EVAL_TOK_S" ] && [ -z "$TTFT_MS" ]; then
            _parse_llama_timings "$_pt_log"
        fi
    else
        _parse_llama_timings "$_pt_log"
        if [ -z "$PROMPT_TOK_S" ] && [ -z "$EVAL_TOK_S" ] && [ -z "$TTFT_MS" ]; then
            _parse_bmoe_timings "$_pt_log"
        fi
    fi

    # expert_hit_rate: formato esplicito moe-cache (bmoe) prima; fallback best-effort
    _parse_expert_hit_rate "$_pt_log"

    if [ -z "$PROMPT_TOK_S" ] && [ -z "$EVAL_TOK_S" ] && [ -z "$TTFT_MS" ]; then
        TIMING_NOTE="no timings in log"
    fi
    return 0
}

# bmoe-cli summary lines (cli/main.cpp ~787, 834, 847-855)
_parse_bmoe_timings() {
    _log="$1"

    # prefill: N tokens, X.XXX s (Y.Y tok/s) | model load Z.ZZZ s | TTFT W.WWW s
    _pline="$(grep -E '^prefill:|^[[:space:]]*prefill:' "$_log" 2>/dev/null | tail -n1 || true)"
    if [ -n "$_pline" ]; then
        _ptps="$(printf '%s\n' "$_pline" | sed -n -E 's/.*\(([0-9.]+)[[:space:]]*tok\/s\).*/\1/p')"
        _ttft_s="$(printf '%s\n' "$_pline" | sed -n -E 's/.*TTFT[[:space:]]+([0-9.]+)[[:space:]]*s.*/\1/p')"
        if [ -n "$_ptps" ]; then
            PROMPT_TOK_S="$(awk -v x="$_ptps" 'BEGIN{printf "%.2f", x+0}')"
        fi
        if [ -n "$_ttft_s" ]; then
            # TTFT seconds → ms (round to int)
            TTFT_MS="$(awk -v s="$_ttft_s" 'BEGIN{printf "%d", (s+0)*1000 + 0.5}')"
        fi
    fi

    # generation: N tokens, X.XXX s/token (Y.YYY tok/s)
    _eline="$(grep -E '^generation:|^[[:space:]]*generation:' "$_log" 2>/dev/null | tail -n1 || true)"
    if [ -n "$_eline" ]; then
        _etps="$(printf '%s\n' "$_eline" | sed -n -E 's/.*\(([0-9.]+)[[:space:]]*tok\/s\).*/\1/p')"
        if [ -n "$_etps" ]; then
            EVAL_TOK_S="$(awk -v x="$_etps" 'BEGIN{printf "%.2f", x+0}')"
        fi
    fi
}

# llama_perf_context_print block (llama-cli)
_parse_llama_timings() {
    _log="$1"

    # prompt eval time line
    _pline="$(grep -E 'prompt eval time' "$_log" 2>/dev/null | tail -n1 || true)"
    if [ -n "$_pline" ]; then
        # ms: primo numero dopo '='
        _pms="$(printf '%s\n' "$_pline" | sed -n -E 's/.*prompt eval time[[:space:]]*=[[:space:]]*([0-9.]+).*/\1/p')"
        # tokens: numero prima di 'tokens' o 'token'
        _ptok="$(printf '%s\n' "$_pline" | sed -n -E 's/.*\/[[:space:]]*([0-9]+)[[:space:]]+tokens?.*/\1/p')"
        # tokens per second se presente
        _ptps="$(printf '%s\n' "$_pline" | sed -n -E 's/.*[[:space:]]([0-9.]+)[[:space:]]+tokens per second.*/\1/p')"
        if [ -n "$_ptps" ]; then
            PROMPT_TOK_S="$(awk -v x="$_ptps" 'BEGIN{printf "%.2f", x+0}')"
        elif [ -n "$_pms" ] && [ -n "$_ptok" ]; then
            PROMPT_TOK_S="$(awk -v ms="$_pms" -v n="$_ptok" 'BEGIN{
                if (ms+0 > 0) printf "%.2f", n / (ms/1000.0);
                else print "";
            }')"
        fi
        if [ -n "$_pms" ]; then
            # ttft_ms = prompt eval ms (proxy first-token latency, v. schema)
            TTFT_MS="$(awk -v ms="$_pms" 'BEGIN{printf "%d", ms+0.5}')"
        fi
    fi

    # eval time line (attenzione: NON matchare "prompt eval time")
    _eline="$(grep -E '[[:space:]]eval time' "$_log" 2>/dev/null | grep -v 'prompt eval' | tail -n1 || true)"
    if [ -n "$_eline" ]; then
        _ems="$(printf '%s\n' "$_eline" | sed -n -E 's/.*eval time[[:space:]]*=[[:space:]]*([0-9.]+).*/\1/p')"
        # token count: "N runs" oppure "N tokens"
        _etok="$(printf '%s\n' "$_eline" | sed -n -E 's/.*\/[[:space:]]*([0-9]+)[[:space:]]+(runs|tokens).*/\1/p')"
        _etps="$(printf '%s\n' "$_eline" | sed -n -E 's/.*[[:space:]]([0-9.]+)[[:space:]]+tokens per second.*/\1/p')"
        if [ -n "$_etps" ]; then
            EVAL_TOK_S="$(awk -v x="$_etps" 'BEGIN{printf "%.2f", x+0}')"
        elif [ -n "$_ems" ] && [ -n "$_etok" ]; then
            EVAL_TOK_S="$(awk -v ms="$_ems" -v n="$_etok" 'BEGIN{
                if (ms+0 > 0) printf "%.2f", n / (ms/1000.0);
                else print "";
            }')"
        fi
    fi

    # New llama-cli chat summary (observed on b10244 / S23):
    #   [ Prompt: 18.1 t/s | Generation: 6.0 t/s ]
    if [ -z "$PROMPT_TOK_S" ] || [ -z "$EVAL_TOK_S" ]; then
        _sumline="$(grep -E '\[\s*Prompt:[[:space:]]*[0-9.]+[[:space:]]*t/s' "$_log" 2>/dev/null | tail -n1 || true)"
        if [ -n "$_sumline" ]; then
            _ptps="$(printf '%s\n' "$_sumline" | sed -n -E 's/.*Prompt:[[:space:]]*([0-9.]+)[[:space:]]*t\/s.*/\1/p')"
            _etps="$(printf '%s\n' "$_sumline" | sed -n -E 's/.*Generation:[[:space:]]*([0-9.]+)[[:space:]]*t\/s.*/\1/p')"
            if [ -z "$PROMPT_TOK_S" ] && [ -n "$_ptps" ]; then
                PROMPT_TOK_S="$(awk -v x="$_ptps" 'BEGIN{printf "%.2f", x+0}')"
            fi
            if [ -z "$EVAL_TOK_S" ] && [ -n "$_etps" ]; then
                EVAL_TOK_S="$(awk -v x="$_etps" 'BEGIN{printf "%.2f", x+0}')"
            fi
        fi
    fi
}

# expert_hit_rate: moe-cache esplicito, poi best-effort generico
_parse_expert_hit_rate() {
    _log="$1"
    EXPERT_HIT_RATE=""

    # bmoe: "moe-cache: 94.2% hit, resident …"
    _hitline="$(grep -E 'moe-cache:[[:space:]]*[0-9.]+%[[:space:]]*hit' "$_log" 2>/dev/null | tail -n1 || true)"
    if [ -n "$_hitline" ]; then
        _hit="$(printf '%s\n' "$_hitline" | sed -n -E 's/.*moe-cache:[[:space:]]*([0-9.]+)%[[:space:]]*hit.*/\1/p')"
        if [ -n "$_hit" ]; then
            EXPERT_HIT_RATE="${_hit}%"
            return 0
        fi
    fi

    # fallback best-effort: percentuale vicino a "hit"
    _hitline="$(grep -iE 'hit[[:space:]]*[:=]|hit_rate|expert.*hit|cache hit' "$_log" 2>/dev/null | tail -n1 || true)"
    if [ -n "$_hitline" ]; then
        EXPERT_HIT_RATE="$(printf '%s\n' "$_hitline" | sed -n -E 's/.*([0-9]+[.]?[0-9]*[[:space:]]*%).*/\1/p' | head -n1)"
        EXPERT_HIT_RATE="$(printf '%s' "$EXPERT_HIT_RATE" | tr -d ' ')"
    fi
    return 0
}

# Mappa runtime → binario di default
default_binary_for_runtime() {
    case "$1" in
        bigmoe) echo "bmoe-cli" ;;
        mainline|ik|custom) echo "llama-cli" ;;
        *) echo "llama-cli" ;;
    esac
}

# Costruisce la cmdline (stringa) con flag runtime-appropriate.
# Argomento opzionale: testo prompt (default: placeholder per --print-cmd).
# --temp 0 sempre hardcodato (§8.2 determinismo).
# llama-cli: -ctk/-ctv + --no-display-prompt + --no-conversation
# IMPORTANT: use long form --no-conversation (NOT -no-cnv).
# Short -no-cnv is ambiguous with -n <n_predict> in common CLI parsers and can
# leave conversation mode ON → infinite interactive ">" spam (observed on S23).
# bmoe-cli:  NO -ctk/-ctv, NO --no-display-prompt/--no-conversation
build_run_cmdline() {
    _prompt_text="${1:-<prompt>}"
    _bin="${BINARY}"
    _cmd="$_bin"
    _cmd="$_cmd -m $(printf '%q' "$MODEL")"
    _cmd="$_cmd -p $(printf '%q' "$_prompt_text")"
    _cmd="$_cmd -n $(printf '%q' "$N_GEN")"
    _cmd="$_cmd -t $(printf '%q' "$THREADS")"
    _cmd="$_cmd -c $(printf '%q' "$N_CTX")"
    case "$RUNTIME" in
        bigmoe)
            # bmoe gestisce KV internamente; -ctk/-ctv e --no-display-prompt non supportati
            _cmd="$_cmd --temp 0"
            ;;
        *)
            # Chat models default to conversation/interactive and spam ">" forever
            # unless single-turn + no-conversation. Prefer long forms only.
            _cmd="$_cmd -ctk $(printf '%q' "$KV_TYPE")"
            _cmd="$_cmd -ctv $(printf '%q' "$KV_TYPE")"
            _cmd="$_cmd --temp 0"
            _cmd="$_cmd --no-display-prompt"
            _cmd="$_cmd --no-conversation"
            _cmd="$_cmd --single-turn"
            # --simple-io: compact [Prompt|Generation] only (no ttft_ms).
            # --classic-perf drops it so llama_perf_context_print fills ttft_ms (F3+).
            if [ "${CLASSIC_PERF:-0}" -eq 0 ]; then
                _cmd="$_cmd --simple-io"
            fi
            ;;
    esac
    if [ -n "$EXTRA_FLAGS" ]; then
        # EXTRA_FLAGS word-split intenzionale (flag forniti dall'operatore)
        # shellcheck disable=SC2086
        _cmd="$_cmd $EXTRA_FLAGS"
    fi
    printf '%s\n' "$_cmd"
}

# ---------------------------------------------------------------------------
# Helper: batteria (termux-api)
# ---------------------------------------------------------------------------
# Ritorna via stdout: "plugged temperature_c" oppure vuoto se non disponibile.
# temperature_c normalizzata in °C (gestisce sia float °C sia 0.1°C interi).
BATTERY_AVAILABLE=0

read_battery() {
    if ! command -v termux-battery-status >/dev/null 2>&1; then
        echo ""
        return 1
    fi
    # termux-api can hang indefinitely after heavy loads; hard timeout
    if command -v timeout >/dev/null 2>&1; then
        _json="$(timeout 12 termux-battery-status 2>/dev/null)" || {
            echo ""
            return 1
        }
    else
        _json="$(termux-battery-status 2>/dev/null)" || {
            echo ""
            return 1
        }
    fi
    if [ -z "$_json" ]; then
        echo ""
        return 1
    fi

    # Preferisci jq se presente; fallback a sed/grep grezzo
    if command -v jq >/dev/null 2>&1; then
        _plugged="$(printf '%s\n' "$_json" | jq -r '.plugged // empty' 2>/dev/null)"
        _temp_raw="$(printf '%s\n' "$_json" | jq -r '.temperature // empty' 2>/dev/null)"
    else
        _plugged="$(printf '%s\n' "$_json" | sed -n 's/.*"plugged"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)"
        _temp_raw="$(printf '%s\n' "$_json" | sed -n 's/.*"temperature"[[:space:]]*:[[:space:]]*\([0-9.][0-9.]*\).*/\1/p' | head -n1)"
    fi

    if [ -z "$_temp_raw" ]; then
        _temp_c=""
    else
        # se >100, interpreta come decimi di °C (es. 285 → 28.5)
        _temp_c="$(awk -v t="$_temp_raw" 'BEGIN{
            if (t+0 > 100) printf "%.1f", t/10.0;
            else printf "%.1f", t+0;
        }')"
    fi

    echo "${_plugged} ${_temp_c}"
    return 0
}

# Helper ISA (path/arch/extra-flags) — usati da run e da test
if [ -n "${_RUN_BENCH_SCRIPT_DIR:-}" ] && [ -f "$_RUN_BENCH_SCRIPT_DIR/lib_isa_safe.sh" ]; then
    # shellcheck disable=SC1091
    source "$_RUN_BENCH_SCRIPT_DIR/lib_isa_safe.sh"
fi

# Solo le helper (per scripts/test_run_bench.sh)
if [ "${RUN_BENCH_LIB_ONLY:-0}" = "1" ]; then
    return 0 2>/dev/null || exit 0
fi

usage() {
    cat <<'EOF' >&2
Uso: run_bench.sh --model <gguf> --prompt-file <file> [opzioni]

Obbligatori:
  -m, --model PATH          percorso GGUF
  -p, --prompt-file PATH    file testo del prompt

Opzionali:
  --prompt-id ID            id prompt (default: short)
  --phase PHASE             es. F2.2|F3|F4.2 (default: F2)
  --quant NAME              nome quant (default: derivato dal filename)
  --file-gb NUM             dimensione file in GB
  --runtime NAME            mainline|bigmoe|ik|custom (default: mainline)
                            → binario default: mainline/ik/custom=llama-cli,
                              bigmoe=bmoe-cli
  --runtime-commit HASH     commit del runtime
  --flags "STR"             flag extra per il binario (es. "--moe-stream --cache-mb 2000")
  -t, --threads N           thread (default: 4)
  -c, --ctx N               contesto (default: 512)
  --kv-type TYPE            f16|q8_0 (default: q8_0)
                            → passato come -ctk/-ctv SOLO a llama-cli;
                              con bmoe-cli resta informativo in CSV (bmoe gestisce KV)
  -n, --n-gen N             token da generare (default: 64)
  --run-type TYPE           cold|warm|pressure (default: warm)
  --log PATH                log grezzo (default: auto in results/logs/)
  --notes "TEXT"            note utente (una riga)
  --csv PATH                CSV destinazione (default: ~/experiments/results/runs.csv
                            o env RUNS_CSV)
  --run-id ID               override run_id
  --binary NAME             override binario (default: da --runtime)
  --print-cmd               stampa la cmdline esatta (flag runtime-appropriate)
                            ed esce 0 SENZA eseguire nulla e SENZA riga CSV
  --allow-no-battery        SOLO smoke/dry-run: salta il gate batteria fail-closed.
                            MAI per run scientifici (senza di questo: exit 7 se
                            termux-battery-status assente o plugged sconosciuto)
  --run-timeout SEC         per-run wall timeout (default 2700 = 45 min; floor 2700).
                            On expiry: kill llama, notes BLOCKED/timeout, exit 8
                            (NOT valid F3 data; only lmkd/OOM exit 1 is data).
  --classic-perf            drop --simple-io so llama_perf_context_print appears
                            (fills ttft_ms via prompt eval ms). Use for F3+.
                            Default keeps --simple-io (compact [Prompt|Generation] only).

Env:
  PREFLIGHT_ISA=auto|1|0    auto/1 = preflight ISA obbligatorio su F1–F4;
                            0 = UNSAFE esplicito (rifiutato per fasi scientifiche)
  RUN_TIMEOUT_S=SEC         same as --run-timeout (default 2700, floor 2700)
  --flags NON può sovrascrivere -m/-p/-n/--temp/-t/-c/-ctk/-ctv/--no-display-prompt

Exit: 0 ok · 1 llama fail (lmkd/OOM = valid F3 data) · 3 usage · 4 charging ·
      5 too hot · 6 binary missing · 7 gate batteria · 8 harness run-timeout
EOF
}

# ---------------------------------------------------------------------------
# Parsing argomenti (getopt-style, senza getopt esterno)
# ---------------------------------------------------------------------------
while [ $# -gt 0 ]; do
    case "$1" in
        -m|--model)
            [ $# -ge 2 ] || { echo "ERRORE: $1 richiede un argomento" >&2; usage; exit 3; }
            MODEL="$2"; shift 2 ;;
        -p|--prompt-file)
            [ $# -ge 2 ] || { echo "ERRORE: $1 richiede un argomento" >&2; usage; exit 3; }
            PROMPT_FILE="$2"; shift 2 ;;
        --prompt-id)
            [ $# -ge 2 ] || { echo "ERRORE: $1 richiede un argomento" >&2; usage; exit 3; }
            PROMPT_ID="$2"; shift 2 ;;
        --phase)
            [ $# -ge 2 ] || { echo "ERRORE: $1 richiede un argomento" >&2; usage; exit 3; }
            PHASE="$2"; shift 2 ;;
        --quant)
            [ $# -ge 2 ] || { echo "ERRORE: $1 richiede un argomento" >&2; usage; exit 3; }
            QUANT="$2"; shift 2 ;;
        --file-gb)
            [ $# -ge 2 ] || { echo "ERRORE: $1 richiede un argomento" >&2; usage; exit 3; }
            FILE_GB="$2"; shift 2 ;;
        --runtime)
            [ $# -ge 2 ] || { echo "ERRORE: $1 richiede un argomento" >&2; usage; exit 3; }
            RUNTIME="$2"; shift 2 ;;
        --runtime-commit)
            [ $# -ge 2 ] || { echo "ERRORE: $1 richiede un argomento" >&2; usage; exit 3; }
            RUNTIME_COMMIT="$2"; shift 2 ;;
        --flags)
            [ $# -ge 2 ] || { echo "ERRORE: $1 richiede un argomento" >&2; usage; exit 3; }
            EXTRA_FLAGS="$2"; shift 2 ;;
        -t|--threads)
            [ $# -ge 2 ] || { echo "ERRORE: $1 richiede un argomento" >&2; usage; exit 3; }
            THREADS="$2"; shift 2 ;;
        -c|--ctx)
            [ $# -ge 2 ] || { echo "ERRORE: $1 richiede un argomento" >&2; usage; exit 3; }
            N_CTX="$2"; shift 2 ;;
        --kv-type)
            [ $# -ge 2 ] || { echo "ERRORE: $1 richiede un argomento" >&2; usage; exit 3; }
            KV_TYPE="$2"; shift 2 ;;
        -n|--n-gen)
            [ $# -ge 2 ] || { echo "ERRORE: $1 richiede un argomento" >&2; usage; exit 3; }
            N_GEN="$2"; shift 2 ;;
        --run-type)
            [ $# -ge 2 ] || { echo "ERRORE: $1 richiede un argomento" >&2; usage; exit 3; }
            RUN_TYPE="$2"; shift 2 ;;
        --log)
            [ $# -ge 2 ] || { echo "ERRORE: $1 richiede un argomento" >&2; usage; exit 3; }
            LOG_PATH="$2"; shift 2 ;;
        --notes)
            [ $# -ge 2 ] || { echo "ERRORE: $1 richiede un argomento" >&2; usage; exit 3; }
            NOTES_USER="$2"; shift 2 ;;
        --csv)
            [ $# -ge 2 ] || { echo "ERRORE: $1 richiede un argomento" >&2; usage; exit 3; }
            CSV_PATH="$2"; shift 2 ;;
        --run-id)
            [ $# -ge 2 ] || { echo "ERRORE: $1 richiede un argomento" >&2; usage; exit 3; }
            RUN_ID="$2"; shift 2 ;;
        --binary)
            [ $# -ge 2 ] || { echo "ERRORE: $1 richiede un argomento" >&2; usage; exit 3; }
            BINARY="$2"; shift 2 ;;
        --print-cmd)
            PRINT_CMD=1; shift ;;
        --allow-no-battery)
            ALLOW_NO_BATTERY=1; shift ;;
        --run-timeout)
            [ $# -ge 2 ] || { echo "ERRORE: $1 richiede un argomento" >&2; usage; exit 3; }
            RUN_TIMEOUT_S="$2"; shift 2 ;;
        --classic-perf|--no-simple-io)
            CLASSIC_PERF=1; shift ;;
        -h|--help)
            usage; exit 0 ;;
        --)
            shift; break ;;
        -*)
            echo "ERRORE: argomento sconosciuto: $1" >&2
            usage
            exit 3
            ;;
        *)
            echo "ERRORE: argomento posizionale non atteso: $1" >&2
            usage
            exit 3
            ;;
    esac
done

# ---------------------------------------------------------------------------
# Validazione input
# ---------------------------------------------------------------------------
if [ -z "$MODEL" ] || [ -z "$PROMPT_FILE" ]; then
    echo "ERRORE: --model e --prompt-file sono obbligatori" >&2
    usage
    exit 3
fi

# Con --print-cmd i path possono essere fittizi (operator sanity / test)
if [ "$PRINT_CMD" -eq 0 ]; then
    if [ ! -f "$MODEL" ]; then
        echo "ERRORE: modello non trovato: $MODEL" >&2
        exit 3
    fi
    if [ ! -f "$PROMPT_FILE" ]; then
        echo "ERRORE: prompt-file non trovato: $PROMPT_FILE" >&2
        exit 3
    fi
fi

case "$RUNTIME" in
    mainline|bigmoe|ik|custom) ;;
    *)
        echo "ERRORE: --runtime deve essere mainline|bigmoe|ik|custom (got: $RUNTIME)" >&2
        exit 3
        ;;
esac

case "$RUN_TYPE" in
    cold|warm|pressure) ;;
    *)
        echo "ERRORE: --run-type deve essere cold|warm|pressure (got: $RUN_TYPE)" >&2
        exit 3
        ;;
esac

case "$KV_TYPE" in
    f16|q8_0) ;;
    *)
        echo "ERRORE: --kv-type deve essere f16|q8_0 (got: $KV_TYPE)" >&2
        exit 3
        ;;
esac

# Run-level timeout: integer, floor 2700 s (45 min). Never silent-clamp below floor.
case "$RUN_TIMEOUT_S" in
    ''|*[!0-9]*)
        echo "ERRORE: --run-timeout deve essere intero secondi (got: $RUN_TIMEOUT_S)" >&2
        exit 3
        ;;
esac
if [ "$RUN_TIMEOUT_S" -lt 2700 ]; then
    echo "ERRORE: --run-timeout $RUN_TIMEOUT_S < 2700 (floor 45 min; 35B naive load can take 10–30+ min)" >&2
    exit 3
fi

# PREFLIGHT_ISA: solo auto|1|0 (e sinonimi espliciti)
case "$PREFLIGHT_ISA" in
    1|yes|true|on|auto|0|no|false|off) ;;
    *)
        echo "ERRORE: PREFLIGHT_ISA non valido: '$PREFLIGHT_ISA' (usa auto|1|0)" >&2
        exit 3
        ;;
esac

# EXTRA_FLAGS non può sovrascrivere opzioni di misura obbligatorie
if declare -f isa_check_reserved_extra_flags >/dev/null 2>&1; then
    if ! isa_check_reserved_extra_flags "$EXTRA_FLAGS"; then
        exit 3
    fi
else
    # fallback minimale se lib assente
    case " $EXTRA_FLAGS " in
        *" -m "*|*' --model '*|*' -p '*|*' --prompt '*|*' --temp '*|*' -n '*)
            echo "ERRORE: EXTRA_FLAGS contiene opzioni riservate (-m/-p/-n/--temp/…)" >&2
            exit 3
            ;;
    esac
fi

# Runtime → binario default (solo se --binary non ha override)
if [ -z "$BINARY" ]; then
    BINARY="$(default_binary_for_runtime "$RUNTIME")"
fi

# Quant derivato dal filename se non specificato
if [ -z "$QUANT" ]; then
    _base="$(basename "$MODEL")"
    # rimuovi estensione .gguf
    _base="${_base%.gguf}"
    _base="${_base%.GGUF}"
    # cerca pattern tipo UD-IQ2_M, Q4_K_M, IQ2_XXS, Q2_K_XL
    QUANT="$(printf '%s\n' "$_base" | sed -n -E 's/.*[-_]((UD-)?(IQ|Q)[0-9]+[_A-Z0-9]*)$/\1/p')"
    if [ -z "$QUANT" ]; then
        QUANT="unknown"
    fi
fi

# run_id
MODEL_SHORT="$(basename "$MODEL")"
MODEL_SHORT="${MODEL_SHORT%.gguf}"
MODEL_SHORT="${MODEL_SHORT%.GGUF}"
# accorcia se troppo lungo (max ~40 char per leggibilità CSV)
_ms_len=${#MODEL_SHORT}
if [ "$_ms_len" -gt 40 ]; then
    MODEL_SHORT="$(printf '%s\n' "$MODEL_SHORT" | cut -c1-40)"
fi

TS_STAMP="$(date +%Y%m%d-%H%M%S)"
DATE_ISO="$(date -Iseconds 2>/dev/null || date +%Y-%m-%dT%H:%M:%S%z)"

if [ -z "$RUN_ID" ]; then
    RUN_ID="${MODEL_SHORT}-${TS_STAMP}"
fi

# Log path auto
if [ -z "$LOG_PATH" ]; then
    LOG_DIR="$(dirname "$CSV_PATH")/logs"
    LOG_PATH="${LOG_DIR}/${RUN_ID}.log"
fi

# ---------------------------------------------------------------------------
# Pre-run checks (hard rules §8.2)
# ---------------------------------------------------------------------------

# 1) batteria — FAIL-CLOSED (exit 7) salvo --allow-no-battery (solo smoke/dry-run)
_batt="$(read_battery)"
_batt_rc=$?
if [ $_batt_rc -ne 0 ] || [ -z "$_batt" ]; then
    if [ "$ALLOW_NO_BATTERY" -eq 1 ]; then
        echo "AVVISO: termux-battery-status non disponibile — proseguo (--allow-no-battery)" >&2
        echo "         MAI usare --allow-no-battery per run scientifici" >&2
        BATTERY_AVAILABLE=0
        BATT_PLUGGED="UNKNOWN"
        BATT_TEMP_START=""
    else
        echo "ERRORE: gate batteria non disponibile/incerto (termux-battery-status assente o fallito)" >&2
        echo "        Installa: pkg install termux-api" >&2
        echo "        Oppure, SOLO per smoke/dry-run: --allow-no-battery" >&2
        exit 7
    fi
else
    BATTERY_AVAILABLE=1
    # shellcheck disable=SC2086
    set -- $_batt
    BATT_PLUGGED="${1:-UNKNOWN}"
    BATT_TEMP_START="${2:-}"

    case "$BATT_PLUGGED" in
        UNPLUGGED)
            ;;
        UNKNOWN|"")
            if [ "$ALLOW_NO_BATTERY" -eq 1 ]; then
                echo "AVVISO: campo plugged assente/sconosciuto — proseguo (--allow-no-battery)" >&2
            else
                echo "ERRORE: gate batteria non disponibile/incerto (plugged=$BATT_PLUGGED)" >&2
                echo "        Serve plugged=UNPLUGGED. SOLO smoke: --allow-no-battery" >&2
                exit 7
            fi
            ;;
        *)
            # PLUGGED / AC / USB / WIRELESS / ecc.
            echo "ERRORE: misure invalide in carica (plugged=$BATT_PLUGGED)" >&2
            echo "Stacca il cavo USB / wireless charging e riprova." >&2
            exit 4
            ;;
    esac

    # Gate temperatura ≤ 32.0°C
    if [ -n "$BATT_TEMP_START" ]; then
        _too_hot="$(awk -v t="$BATT_TEMP_START" 'BEGIN{ print (t+0 > 32.0) ? 1 : 0 }')"
        if [ "$_too_hot" = "1" ]; then
            echo "ERRORE: run scartato: temperatura iniziale >32°C (got ${BATT_TEMP_START}°C)" >&2
            exit 5
        fi
    else
        if [ "$ALLOW_NO_BATTERY" -eq 1 ]; then
            echo "AVVISO: temperatura batteria non leggibile — proseguo (--allow-no-battery)" >&2
        else
            echo "ERRORE: gate batteria non disponibile/incerto (temperatura assente)" >&2
            echo "        SOLO smoke/dry-run: --allow-no-battery" >&2
            exit 7
        fi
    fi
fi

# --print-cmd: stampa cmdline runtime-appropriate ed esce (niente binario, niente CSV)
if [ "$PRINT_CMD" -eq 1 ]; then
    if [ -f "$PROMPT_FILE" ]; then
        _pcontent="$(cat "$PROMPT_FILE")"
    else
        _pcontent="<prompt>"
    fi
    build_run_cmdline "$_pcontent"
    exit 0
fi

# 2) binario (dopo --print-cmd: non serve per la sola stampa)
if ! command -v "$BINARY" >/dev/null 2>&1; then
    echo "ERRORE: binario non trovato: $BINARY (command -v fallito)" >&2
    echo "Suggerimento: builda llama.cpp / BigMoeOnEdge, oppure --binary <nome>" >&2
    echo "              mainline safe: scripts/build_llama_termux.sh" >&2
    exit 6
fi

# 2b) preflight ISA — blocca binari con GGML_NATIVE / mcpu=native prima di -m
#     (reports/moe-f1-sigill.md: probe SVE/SME → SIGILL su S23)
#     Fasi F1–F4: SEMPRE mandatory; PREFLIGHT_ISA=0 rifiutato (niente misura valida).
_scientific=0
if declare -f isa_is_scientific_phase >/dev/null 2>&1; then
    if isa_is_scientific_phase "$PHASE"; then
        _scientific=1
    fi
else
    case "$PHASE" in F1|F1.*|F2|F2.*|F3|F3.*|F4|F4.*) _scientific=1 ;; esac
fi

_run_isa_preflight=0
_preflight_mode=""
case "$PREFLIGHT_ISA" in
    1|yes|true|on)
        _run_isa_preflight=1
        _preflight_mode="forced"
        ;;
    0|no|false|off)
        if [ "$_scientific" -eq 1 ]; then
            echo "ERRORE: PREFLIGHT_ISA=0 rifiutato per fase scientifica ($PHASE)" >&2
            echo "        le misure F1–F4 richiedono provenance ISA (CMakeCache + preflight)" >&2
            echo "        rimuovi PREFLIGHT_ISA=0 o usa una fase non scientifica per smoke" >&2
            exit 6
        fi
        echo "AVVISO: PREFLIGHT_ISA=0 — check ISA disattivato (NON scientifico; niente misura valida)" >&2
        _run_isa_preflight=0
        _preflight_mode="unsafe_skip"
        ;;
    auto)
        # Default: mandatory su F1–F4; altrimenti se c'è CMakeCache vicino al binario
        if [ "$_scientific" -eq 1 ]; then
            _run_isa_preflight=1
            _preflight_mode="scientific_mandatory"
        else
            _bin_path="$(command -v "$BINARY" 2>/dev/null || true)"
            if [ -n "$_bin_path" ] && [ -e "$_bin_path" ]; then
                # risolvi symlink
                if [ -L "$_bin_path" ] && declare -f isa_realpath >/dev/null 2>&1; then
                    _rp="$(isa_realpath "$_bin_path")"
                    if [ -n "$_rp" ]; then _bin_path="$_rp"; fi
                fi
                _bin_dir="$(cd "$(dirname "$_bin_path")" && pwd -P)"
                for _cand in "$_bin_dir/../CMakeCache.txt" "$_bin_dir/../../CMakeCache.txt" \
                             "$_bin_dir/CMakeCache.txt"; do
                    if [ -f "$_cand" ]; then
                        _run_isa_preflight=1
                        _preflight_mode="auto_cache"
                        break
                    fi
                done
            fi
        fi
        ;;
esac

if [ "$_run_isa_preflight" -eq 1 ]; then
    _pre_script=""
    _here="${_RUN_BENCH_SCRIPT_DIR:-}"
    if [ -z "$_here" ]; then
        _here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    fi
    if [ -f "$_here/preflight_llama_isa.sh" ]; then
        _pre_script="$_here/preflight_llama_isa.sh"
    elif [ -f "$HOME/experiments/scripts/preflight_llama_isa.sh" ]; then
        _pre_script="$HOME/experiments/scripts/preflight_llama_isa.sh"
    fi
    if [ -z "$_pre_script" ]; then
        echo "ERRORE: preflight_llama_isa.sh assente — NON avvio -m" >&2
        echo "        richiesto per PREFLIGHT_ISA=$PREFLIGHT_ISA (mode=$_preflight_mode)" >&2
        exit 6
    fi

    _bin_path="$(command -v "$BINARY" 2>/dev/null || echo "$BINARY")"
    if [ -L "$_bin_path" ] && declare -f isa_realpath >/dev/null 2>&1; then
        _rp="$(isa_realpath "$_bin_path")"
        if [ -n "$_rp" ] && [ -e "$_rp" ]; then
            _bin_path="$_rp"
        fi
    fi
    if [ ! -e "$_bin_path" ]; then
        echo "ERRORE: binario non risolvibile per preflight: $BINARY" >&2
        exit 6
    fi
    _bin_dir="$(cd "$(dirname "$_bin_path")" && pwd -P)"
    _bdir=""
    for _cand in "$_bin_dir/.." "$_bin_dir/../.." "$_bin_dir"; do
        if [ -f "$_cand/CMakeCache.txt" ]; then
            _bdir="$(cd "$_cand" && pwd -P)"
            break
        fi
    done

    # Run scientifici: provenance (build-dir + cache) OBBLIGATORIA
    if [ "$_scientific" -eq 1 ] && [ -z "$_bdir" ]; then
        echo "ERRORE: fase scientifica ($PHASE) senza CMakeCache accanto al binario" >&2
        echo "        binario=$_bin_path" >&2
        echo "        rebuild safe: bash scripts/build_llama_termux.sh" >&2
        echo "        (GGML_NATIVE=OFF + compile_commands; v. reports/moe-f1-sigill.md)" >&2
        exit 6
    fi

    echo "--- preflight ISA (PREFLIGHT_ISA=$PREFLIGHT_ISA mode=$_preflight_mode) ---"
    _pf_args=(--binary "$_bin_path")
    if [ -n "$_bdir" ]; then
        _pf_args+=(--build-dir "$_bdir")
    elif [ "$_scientific" -eq 1 ]; then
        # già gestito sopra; difesa in profondità
        echo "ERRORE: preflight scientifico richiede --build-dir" >&2
        exit 6
    fi
    # binary-only (senza build-dir) non è ammesso per F1–F4 (già bloccato);
    # per smoke non-scientifici senza cache si salta solo se mode non force
    if [ -z "$_bdir" ] && [ "$_scientific" -eq 0 ] && [ "$_preflight_mode" != "forced" ]; then
        echo "AVVISO: nessun CMakeCache — preflight binary-only non eseguito (non scientifico)" >&2
    else
        if ! bash "$_pre_script" "${_pf_args[@]}"; then
            echo "ERRORE: preflight ISA fallito — NON avvio -m" >&2
            echo "        rebuild: bash scripts/build_llama_termux.sh" >&2
            echo "        (GGML_NATIVE=OFF + arch esplicita; v. reports/moe-f1-sigill.md)" >&2
            exit 6
        fi
    fi
fi

# ---------------------------------------------------------------------------
# Prepara directory output
# ---------------------------------------------------------------------------
mkdir -p "$(dirname "$CSV_PATH")" 2>/dev/null || true
mkdir -p "$(dirname "$LOG_PATH")" 2>/dev/null || true

# Header CSV se assente
CSV_HEADER="run_id,date,phase,model,quant,file_gb,runtime,runtime_commit,flags,threads,n_ctx,kv_type,n_gen,run_type,prompt_id,prompt_tok_s,eval_tok_s,ttft_ms,majflt_delta,minflt_delta,read_bytes_delta,vmrss_peak_mb,memfree_min_mb,batt_temp_start,batt_temp_end,expert_hit_rate,notes"

if [ ! -f "$CSV_PATH" ]; then
    printf '%s\n' "$CSV_HEADER" > "$CSV_PATH"
fi

# ---------------------------------------------------------------------------
# Snapshot PRE
# ---------------------------------------------------------------------------
# shellcheck disable=SC2046
set -- $(read_meminfo)
MEMFREE_START_KB="${1:-0}"
MEMAVAIL_START_KB="${2:-0}"
# memfree_min traccia il minimo durante il run (inizializza a start)
MEMFREE_MIN_KB="$MEMFREE_START_KB"

# Prompt content (cat una sola volta; gestisce spazi/newline)
PROMPT_CONTENT="$(cat "$PROMPT_FILE")"

# Header log (sovrascrittura: ogni run ha il suo file)
# --temp 0 hardcodato (§8.2 determinismo)
# llama-cli: -ctk/-ctv; bmoe-cli: KV interno (kv_type solo informativo in CSV)
echo "=== run_bench ===" | tee "$LOG_PATH" >&2
echo "run_id=$RUN_ID phase=$PHASE runtime=$RUNTIME run_type=$RUN_TYPE" | tee -a "$LOG_PATH" >&2
echo "model=$MODEL quant=$QUANT" | tee -a "$LOG_PATH" >&2
echo "binary=$BINARY threads=$THREADS ctx=$N_CTX kv=$KV_TYPE n_gen=$N_GEN" | tee -a "$LOG_PATH" >&2
echo "flags=$EXTRA_FLAGS" | tee -a "$LOG_PATH" >&2
echo "batt_plugged=$BATT_PLUGGED batt_temp_start=$BATT_TEMP_START" | tee -a "$LOG_PATH" >&2
echo "log=$LOG_PATH csv=$CSV_PATH" | tee -a "$LOG_PATH" >&2
echo "--- llama start $(date -Iseconds 2>/dev/null || date) ---" | tee -a "$LOG_PATH" >&2

# Temp dir: Termux/Android often cannot write /tmp (Permission denied).
# Prefer TMPDIR, then PREFIX/tmp, HOME/tmp, /data/local/tmp, finally /tmp.
_RB_TMPDIR=""
for _cand in \
    "${TMPDIR:-}" \
    "${PREFIX:-}/tmp" \
    "${HOME:-}/tmp" \
    "${HOME:-}/.tmp" \
    "${HOME:-}/experiments/tmp" \
    /data/local/tmp \
    /tmp
do
    [ -n "$_cand" ] || continue
    mkdir -p "$_cand" 2>/dev/null || true
    if [ -d "$_cand" ] && [ -w "$_cand" ]; then
        _RB_TMPDIR="$_cand"
        break
    fi
done
if [ -z "$_RB_TMPDIR" ]; then
    echo "ERRORE: nessuna directory temp scrivibile (TMPDIR/PREFIX/tmp/HOME/tmp)" >&2
    exit 3
fi
export TMPDIR="$_RB_TMPDIR"

# Prompt su tempfile (evita quoting di newline nella cmdline)
PROMPT_TMP="$(mktemp "$_RB_TMPDIR/run_bench_prompt.XXXXXX" 2>/dev/null || echo "$_RB_TMPDIR/run_bench_prompt.$$")"
printf '%s' "$PROMPT_CONTENT" > "$PROMPT_TMP" || {
    echo "ERRORE: non scrivo prompt tmp ($PROMPT_TMP)" >&2
    exit 3
}

# FIFO + tee: output su log E stderr, PID = processo llama reale (no subshell)
FIFO="$(mktemp -u "$_RB_TMPDIR/run_bench_fifo.XXXXXX" 2>/dev/null || echo "$_RB_TMPDIR/run_bench_fifo.$$")"
mkfifo "$FIFO" || {
    echo "ERRORE: mkfifo fallito ($FIFO)" >&2
    rm -f "$PROMPT_TMP"
    exit 3
}
tee -a "$LOG_PATH" < "$FIFO" >&2 &
TEE_PID=$!

# Lancia binario in background: stdout+stderr → FIFO
# Flag set runtime-appropriate (v. build_run_cmdline)
# EXTRA_FLAGS word-split intenzionale (flag forniti dall'operatore).
# shellcheck disable=SC2086
_PROMPT_ARG="$(cat "$PROMPT_TMP")"
if [ "$RUNTIME" = "bigmoe" ]; then
    if [ -n "$EXTRA_FLAGS" ]; then
        "$BINARY" \
            -m "$MODEL" \
            -p "$_PROMPT_ARG" \
            -n "$N_GEN" \
            -t "$THREADS" \
            -c "$N_CTX" \
            --temp 0 \
            $EXTRA_FLAGS \
            < /dev/null > "$FIFO" 2>&1 &
    else
        "$BINARY" \
            -m "$MODEL" \
            -p "$_PROMPT_ARG" \
            -n "$N_GEN" \
            -t "$THREADS" \
            -c "$N_CTX" \
            --temp 0 \
            < /dev/null > "$FIFO" 2>&1 &
    fi
else
    # CLASSIC_PERF=1 drops --simple-io so llama_perf_context_print (ttft_ms) appears.
    if [ "$CLASSIC_PERF" -eq 1 ]; then
        if [ -n "$EXTRA_FLAGS" ]; then
            "$BINARY" \
                -m "$MODEL" \
                -p "$_PROMPT_ARG" \
                -n "$N_GEN" \
                -t "$THREADS" \
                -c "$N_CTX" \
                -ctk "$KV_TYPE" \
                -ctv "$KV_TYPE" \
                --temp 0 \
                --no-display-prompt \
                --no-conversation \
                --single-turn \
                $EXTRA_FLAGS \
                < /dev/null > "$FIFO" 2>&1 &
        else
            "$BINARY" \
                -m "$MODEL" \
                -p "$_PROMPT_ARG" \
                -n "$N_GEN" \
                -t "$THREADS" \
                -c "$N_CTX" \
                -ctk "$KV_TYPE" \
                -ctv "$KV_TYPE" \
                --temp 0 \
                --no-display-prompt \
                --no-conversation \
                --single-turn \
                < /dev/null > "$FIFO" 2>&1 &
        fi
    else
        if [ -n "$EXTRA_FLAGS" ]; then
            "$BINARY" \
                -m "$MODEL" \
                -p "$_PROMPT_ARG" \
                -n "$N_GEN" \
                -t "$THREADS" \
                -c "$N_CTX" \
                -ctk "$KV_TYPE" \
                -ctv "$KV_TYPE" \
                --temp 0 \
                --no-display-prompt \
                --no-conversation \
                --single-turn \
                --simple-io \
                $EXTRA_FLAGS \
                < /dev/null > "$FIFO" 2>&1 &
        else
            "$BINARY" \
                -m "$MODEL" \
                -p "$_PROMPT_ARG" \
                -n "$N_GEN" \
                -t "$THREADS" \
                -c "$N_CTX" \
                -ctk "$KV_TYPE" \
                -ctv "$KV_TYPE" \
                --temp 0 \
                --no-display-prompt \
                --no-conversation \
                --single-turn \
                --simple-io \
                < /dev/null > "$FIFO" 2>&1 &
        fi
    fi
fi
LLAMA_PID=$!
LLAMA_START_EPOCH="$(date +%s 2>/dev/null || echo 0)"

echo "llama_pid=$LLAMA_PID tee_pid=$TEE_PID classic_perf=$CLASSIC_PERF run_timeout_s=$RUN_TIMEOUT_S" >&2

# Attendi che /proc/<pid> esista (max ~2s)
_i=0
while [ "$_i" -lt 20 ]; do
    if [ -d "/proc/$LLAMA_PID" ]; then
        break
    fi
    # se già morto, esci dal loop
    if ! kill -0 "$LLAMA_PID" 2>/dev/null; then
        break
    fi
    _i=$((_i + 1))
    # sleep 0.1 non sempre supportato: usa sleep 1 al primo e poi break-ish
    sleep 0.1 2>/dev/null || sleep 1
done

# Snapshot iniziale del processo (se ancora vivo)
if [ -d "/proc/$LLAMA_PID" ]; then
    # shellcheck disable=SC2046
    set -- $(read_flt "$LLAMA_PID")
    MINFLT_START="${1:-0}"
    MAJFLT_START="${2:-0}"
    READ_BYTES_START="$(read_read_bytes "$LLAMA_PID")"
    VMRSS_START_KB="$(read_vmrss_kb "$LLAMA_PID")"
else
    MINFLT_START=0
    MAJFLT_START=0
    READ_BYTES_START=0
    VMRSS_START_KB=0
fi

VMRSS_PEAK_KB="$VMRSS_START_KB"

# Loop di campionamento ogni 0.5s in background.
# IMPORTANTE: dopo wait /proc/<pid> sparisce, quindi minflt/majflt/read_bytes
# di FINE devono essere l'ultimo sample preso a processo ancora vivo.
PEAK_FILE="$(mktemp "${TMPDIR:-/tmp}/run_bench_peak.XXXXXX" 2>/dev/null || echo "${TMPDIR:-/tmp}/run_bench_peak.$$")"
PROC_FILE="$(mktemp "${TMPDIR:-/tmp}/run_bench_proc.XXXXXX" 2>/dev/null || echo "${TMPDIR:-/tmp}/run_bench_proc.$$")"
MEMFREE_FILE="$(mktemp "${TMPDIR:-/tmp}/run_bench_memfree.XXXXXX" 2>/dev/null || echo "${TMPDIR:-/tmp}/run_bench_memfree.$$")"
printf '%s\n' "$VMRSS_PEAK_KB" > "$PEAK_FILE"
printf '%s %s %s\n' "$MINFLT_START" "$MAJFLT_START" "$READ_BYTES_START" > "$PROC_FILE"
printf '%s\n' "$MEMFREE_MIN_KB" > "$MEMFREE_FILE"

(
    _peak="$VMRSS_PEAK_KB"
    _mmin="$MEMFREE_MIN_KB"
    while kill -0 "$LLAMA_PID" 2>/dev/null; do
        if [ -d "/proc/$LLAMA_PID" ]; then
            _rss="$(read_vmrss_kb "$LLAMA_PID")"
            if [ "${_rss:-0}" -gt "${_peak:-0}" ] 2>/dev/null; then
                _peak="$_rss"
                printf '%s\n' "$_peak" > "$PEAK_FILE"
            fi
            # shellcheck disable=SC2046
            set -- $(read_flt "$LLAMA_PID")
            _mf_last="${1:-0}"
            _Mj_last="${2:-0}"
            _rb_last="$(read_read_bytes "$LLAMA_PID")"
            printf '%s %s %s\n' "$_mf_last" "$_Mj_last" "$_rb_last" > "$PROC_FILE"
        fi
        # shellcheck disable=SC2046
        set -- $(read_meminfo)
        _mf="${1:-0}"
        if [ "${_mf:-0}" -gt 0 ] 2>/dev/null; then
            if [ "${_mmin:-0}" -eq 0 ] || [ "${_mf}" -lt "${_mmin}" ] 2>/dev/null; then
                _mmin="$_mf"
                printf '%s\n' "$_mmin" > "$MEMFREE_FILE"
            fi
        fi
        sleep 0.5 2>/dev/null || sleep 1
    done
) &
SAMPLER_PID=$!

# Attendi llama con run-level wall timeout (≥2700 s default).
# Harness timeout → kill llama, notes BLOCKED/timeout, exit 8 (NOT valid data).
# lmkd/OOM → natural death, exit 1, VALID F3 data.
HARNESS_TIMEOUT=0
LLAMA_RC=0
if command -v timeout >/dev/null 2>&1; then
    # Use a separate wait-wrapper via background + sleep watchdog so we keep
    # the real LLAMA_PID for /proc sampling (timeout(1) would re-parent).
    (
        sleep "$RUN_TIMEOUT_S"
        if kill -0 "$LLAMA_PID" 2>/dev/null; then
            echo "--- HARNESS RUN-TIMEOUT ${RUN_TIMEOUT_S}s exceeded; killing llama_pid=$LLAMA_PID ---" | tee -a "$LOG_PATH" >&2
            # TERM then KILL; process group if possible
            kill -TERM "$LLAMA_PID" 2>/dev/null || true
            sleep 2
            kill -KILL "$LLAMA_PID" 2>/dev/null || true
            # mark timeout file for parent
            printf '1\n' > "${TMPDIR:-/tmp}/run_bench_timeout.$$"
        fi
    ) &
    WATCHDOG_PID=$!
    wait "$LLAMA_PID"
    LLAMA_RC=$?
    # stop watchdog if llama finished first
    kill "$WATCHDOG_PID" 2>/dev/null || true
    wait "$WATCHDOG_PID" 2>/dev/null || true
    if [ -f "${TMPDIR:-/tmp}/run_bench_timeout.$$" ]; then
        HARNESS_TIMEOUT=1
        rm -f "${TMPDIR:-/tmp}/run_bench_timeout.$$" 2>/dev/null || true
        echo "BLOCKED/timeout: harness run-timeout ${RUN_TIMEOUT_S}s killed llama (rc=$LLAMA_RC) — NOT valid F3 data" | tee -a "$LOG_PATH" >&2
    fi
else
    # No timeout(1) / sleep watchdog still works with pure bash sleep above;
    # if even sleep fails we fall back to unconditional wait (should not happen).
    wait "$LLAMA_PID"
    LLAMA_RC=$?
fi

LLAMA_END_EPOCH="$(date +%s 2>/dev/null || echo 0)"
WALL_S=""
if [ "${LLAMA_START_EPOCH:-0}" -gt 0 ] 2>/dev/null && [ "${LLAMA_END_EPOCH:-0}" -gt 0 ] 2>/dev/null; then
    WALL_S="$((LLAMA_END_EPOCH - LLAMA_START_EPOCH))"
fi

# tee termina quando la FIFO si chiude (writer morto); attendilo
wait "$TEE_PID" 2>/dev/null || true

# Ferma sampler e attendi che flush-i gli ultimi sample
kill "$SAMPLER_PID" 2>/dev/null || true
wait "$SAMPLER_PID" 2>/dev/null || true

# Cleanup tmp
rm -f "$PROMPT_TMP" "$FIFO" 2>/dev/null || true

echo "--- llama end rc=$LLAMA_RC harness_timeout=$HARNESS_TIMEOUT wall_s=${WALL_S:-?} $(date -Iseconds 2>/dev/null || date) ---" | tee -a "$LOG_PATH" >&2

# Valori di fine: ultimo sample del loop (o start se mai campionato)
MINFLT_END="$MINFLT_START"
MAJFLT_END="$MAJFLT_START"
READ_BYTES_END="$READ_BYTES_START"
if [ -f "$PROC_FILE" ]; then
    # shellcheck disable=SC2046
    set -- $(cat "$PROC_FILE" 2>/dev/null)
    MINFLT_END="${1:-$MINFLT_START}"
    MAJFLT_END="${2:-$MAJFLT_START}"
    READ_BYTES_END="${3:-$READ_BYTES_START}"
fi

if [ -f "$PEAK_FILE" ]; then
    VMRSS_PEAK_KB="$(cat "$PEAK_FILE" 2>/dev/null || echo "$VMRSS_PEAK_KB")"
fi
if [ -f "$MEMFREE_FILE" ]; then
    MEMFREE_MIN_KB="$(cat "$MEMFREE_FILE" 2>/dev/null || echo "$MEMFREE_MIN_KB")"
fi
rm -f "$PEAK_FILE" "$MEMFREE_FILE" "$PROC_FILE" 2>/dev/null || true

# Snapshot meminfo post
# shellcheck disable=SC2046
set -- $(read_meminfo)
MEMFREE_END_KB="${1:-0}"
# aggiorna min con end
if [ "${MEMFREE_END_KB:-0}" -gt 0 ] 2>/dev/null; then
    if [ "${MEMFREE_MIN_KB:-0}" -eq 0 ] || [ "${MEMFREE_END_KB}" -lt "${MEMFREE_MIN_KB}" ] 2>/dev/null; then
        MEMFREE_MIN_KB="$MEMFREE_END_KB"
    fi
fi

# Batteria end
BATT_TEMP_END=""
if [ "$BATTERY_AVAILABLE" -eq 1 ]; then
    _batt2="$(read_battery)"
    if [ -n "$_batt2" ]; then
        # shellcheck disable=SC2086
        set -- $_batt2
        BATT_TEMP_END="${2:-}"
    fi
fi

# ---------------------------------------------------------------------------
# Delta e conversioni
# ---------------------------------------------------------------------------
# majflt/minflt/read_bytes: clamp a 0 se end < start (wrap/unreadable)
MAJFLT_DELTA="$(awk -v a="$MAJFLT_START" -v b="$MAJFLT_END" 'BEGIN{d=b-a; if(d<0)d=0; printf "%d", d}')"
MINFLT_DELTA="$(awk -v a="$MINFLT_START" -v b="$MINFLT_END" 'BEGIN{d=b-a; if(d<0)d=0; printf "%d", d}')"
READ_BYTES_DELTA="$(awk -v a="$READ_BYTES_START" -v b="$READ_BYTES_END" 'BEGIN{d=b-a; if(d<0)d=0; printf "%d", d}')"

# VmRSS peak in MB (intero)
VMRSS_PEAK_MB="$(awk -v k="$VMRSS_PEAK_KB" 'BEGIN{printf "%d", (k+0)/1024}')"
# MemFree min in MB
MEMFREE_MIN_MB="$(awk -v k="$MEMFREE_MIN_KB" 'BEGIN{printf "%d", (k+0)/1024}')"

# ---------------------------------------------------------------------------
# Parsing timings da log (parse_timings: bmoe-cli summary lines O llama_perf)
# ---------------------------------------------------------------------------
parse_timings "$LOG_PATH" "$RUNTIME" "$BINARY"

# load_s: wall-clock from process spawn to end (or first-token proxy via prompt eval).
# Prefer classic perf "load time = NNN ms" if present; else wall_s from harness clock.
LOAD_S=""
_load_line="$(grep -E 'load time[[:space:]]*=' "$LOG_PATH" 2>/dev/null | tail -n1 || true)"
if [ -n "$_load_line" ]; then
    _load_ms="$(printf '%s\n' "$_load_line" | sed -n -E 's/.*load time[[:space:]]*=[[:space:]]*([0-9.]+).*/\1/p')"
    if [ -n "$_load_ms" ]; then
        LOAD_S="$(awk -v ms="$_load_ms" 'BEGIN{printf "%d", (ms+0)/1000 + 0.5}')"
    fi
fi
if [ -z "$LOAD_S" ] && [ -n "${WALL_S:-}" ]; then
    # Fallback: whole-process wall (includes gen). Still useful for 35B thrash runs.
    LOAD_S="$WALL_S"
fi

# ---------------------------------------------------------------------------
# Notes (single-line, no commas/newlines)
# ---------------------------------------------------------------------------
NOTES_FINAL=""
if [ -n "$NOTES_USER" ]; then
    NOTES_FINAL="$NOTES_USER"
fi
if [ "$HARNESS_TIMEOUT" -eq 1 ]; then
    # Distinct from FAIL rc= (lmkd/OOM): harness kill is NOT scientific data.
    _to_note="BLOCKED/timeout run_timeout_s=${RUN_TIMEOUT_S}"
    if [ -n "$NOTES_FINAL" ]; then
        NOTES_FINAL="${NOTES_FINAL}; ${_to_note}"
    else
        NOTES_FINAL="$_to_note"
    fi
elif [ "$LLAMA_RC" -ne 0 ]; then
    if [ -n "$NOTES_FINAL" ]; then
        NOTES_FINAL="${NOTES_FINAL}; FAIL rc=${LLAMA_RC}"
    else
        NOTES_FINAL="FAIL rc=${LLAMA_RC}"
    fi
fi
if [ -n "$TIMING_NOTE" ]; then
    if [ -n "$NOTES_FINAL" ]; then
        NOTES_FINAL="${NOTES_FINAL}; ${TIMING_NOTE}"
    else
        NOTES_FINAL="$TIMING_NOTE"
    fi
fi
if [ -n "$LOAD_S" ]; then
    if [ -n "$NOTES_FINAL" ]; then
        NOTES_FINAL="${NOTES_FINAL}; load_s=${LOAD_S}"
    else
        NOTES_FINAL="load_s=${LOAD_S}"
    fi
fi
if [ "$CLASSIC_PERF" -eq 1 ]; then
    if [ -n "$NOTES_FINAL" ]; then
        NOTES_FINAL="${NOTES_FINAL}; classic_perf=1"
    else
        NOTES_FINAL="classic_perf=1"
    fi
fi
# MemAvailable at run start (kB → MB) — required covariate for cold=fadv (§8.2 2026-08-05).
# fadvise DONTNEED evicts file pages but does not reset fragmentation/lmkd state.
MEMAVAIL_START_MB=""
if [ -n "${MEMAVAIL_START_KB:-}" ] && [ "${MEMAVAIL_START_KB}" -gt 0 ] 2>/dev/null; then
    MEMAVAIL_START_MB="$(awk -v k="$MEMAVAIL_START_KB" 'BEGIN{printf "%d", (k+0)/1024}')"
fi
if [ -n "$MEMAVAIL_START_MB" ]; then
    if [ -n "$NOTES_FINAL" ]; then
        NOTES_FINAL="${NOTES_FINAL}; memavail_start_mb=${MEMAVAIL_START_MB}"
    else
        NOTES_FINAL="memavail_start_mb=${MEMAVAIL_START_MB}"
    fi
fi
# strip virgole e newline
NOTES_FINAL="$(sanitize_notes "$NOTES_FINAL")"

# Flags stringa per CSV (niente virgole)
FLAGS_CSV="$(printf '%s' "$EXTRA_FLAGS" | tr ',' ';' | tr '\n' ' ')"

# Model name per CSV = basename
MODEL_CSV="$(basename "$MODEL")"

# ---------------------------------------------------------------------------
# Append riga CSV (atomico: un solo >>)
# Ordine §8.3:
# run_id,date,phase,model,quant,file_gb,runtime,runtime_commit,flags,threads,
# n_ctx,kv_type,n_gen,run_type,prompt_id,prompt_tok_s,eval_tok_s,ttft_ms,
# majflt_delta,minflt_delta,read_bytes_delta,vmrss_peak_mb,memfree_min_mb,
# batt_temp_start,batt_temp_end,expert_hit_rate,notes
# ---------------------------------------------------------------------------
CSV_LINE="$(printf '%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s' \
    "$RUN_ID" \
    "$DATE_ISO" \
    "$PHASE" \
    "$MODEL_CSV" \
    "$QUANT" \
    "$FILE_GB" \
    "$RUNTIME" \
    "$RUNTIME_COMMIT" \
    "$FLAGS_CSV" \
    "$THREADS" \
    "$N_CTX" \
    "$KV_TYPE" \
    "$N_GEN" \
    "$RUN_TYPE" \
    "$PROMPT_ID" \
    "$PROMPT_TOK_S" \
    "$EVAL_TOK_S" \
    "$TTFT_MS" \
    "$MAJFLT_DELTA" \
    "$MINFLT_DELTA" \
    "$READ_BYTES_DELTA" \
    "$VMRSS_PEAK_MB" \
    "$MEMFREE_MIN_MB" \
    "$BATT_TEMP_START" \
    "$BATT_TEMP_END" \
    "$EXPERT_HIT_RATE" \
    "$NOTES_FINAL"
)"

printf '%s\n' "$CSV_LINE" >> "$CSV_PATH"

echo "=== CSV row written → $CSV_PATH ===" >&2
echo "$CSV_LINE" >&2
echo "prompt_tok_s=$PROMPT_TOK_S eval_tok_s=$EVAL_TOK_S ttft_ms=$TTFT_MS load_s=${LOAD_S:-}" >&2
echo "majflt_delta=$MAJFLT_DELTA minflt_delta=$MINFLT_DELTA read_bytes_delta=$READ_BYTES_DELTA" >&2
echo "vmrss_peak_mb=$VMRSS_PEAK_MB memfree_min_mb=$MEMFREE_MIN_MB memavail_start_mb=${MEMAVAIL_START_MB:-}" >&2
echo "batt_temp_start=$BATT_TEMP_START batt_temp_end=$BATT_TEMP_END" >&2
echo "harness_timeout=$HARNESS_TIMEOUT run_timeout_s=$RUN_TIMEOUT_S classic_perf=$CLASSIC_PERF" >&2

# Exit codes:
#   0 = llama ok
#   1 = llama fail (lmkd/OOM/crash) — VALID F3 data if row present
#   8 = harness run-timeout — NOT valid data (notes BLOCKED/timeout)
if [ "$HARNESS_TIMEOUT" -eq 1 ]; then
    exit 8
fi
if [ "$LLAMA_RC" -ne 0 ]; then
    exit 1
fi
exit 0
