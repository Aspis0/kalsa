#!/usr/bin/env bash
# =============================================================================
# lib_isa_safe.sh — helper condivisi per build/preflight ISA sicura (S23)
#
# Source-only (non eseguire):
#   # shellcheck disable=SC1091
#   source "$(dirname "$0")/lib_isa_safe.sh"
#
# Funzioni:
#   isa_validate_arm_arch ARCH
#   isa_resolve_root ROOT_CANDIDATE            → ISA_ROOT
#   isa_resolve_build_dir ROOT BUILD_DIR_IN    → ISA_BUILD_DIR (assoluto sotto ROOT)
#   isa_assert_safe_rm_target ROOT TARGET      → exit 1 se TARGET non wipe-abile
#   isa_is_scientific_phase PHASE              → 0 se F1–F4 / scientifico
#   isa_check_reserved_extra_flags "FLAGS"     → exit 1 se flag riservati
#   isa_realpath PATH                          → path canonico best-effort
# =============================================================================

# Evita doppio source
if [ "${_LIB_ISA_SAFE_LOADED:-0}" = "1" ]; then
    return 0 2>/dev/null || exit 0
fi
_LIB_ISA_SAFE_LOADED=1

# Realpath portabile (Termux/Git Bash/Linux). Fallisce soft → stringa vuota.
isa_realpath() {
    _p="${1:-}"
    if [ -z "$_p" ]; then
        echo ""
        return 1
    fi
    if command -v realpath >/dev/null 2>&1; then
        realpath -m "$_p" 2>/dev/null || realpath "$_p" 2>/dev/null || true
        return 0
    fi
    if command -v readlink >/dev/null 2>&1; then
        # GNU readlink -f; su BSD non c'è: fallback sotto
        _rp="$(readlink -f "$_p" 2>/dev/null || true)"
        if [ -n "$_rp" ]; then
            printf '%s\n' "$_rp"
            return 0
        fi
    fi
    # Fallback: se esiste, cd+pwd; altrimenti normalizza a mano i pezzi .
    if [ -d "$_p" ]; then
        (cd "$_p" && pwd -P) 2>/dev/null && return 0
    fi
    if [ -e "$_p" ]; then
        _d="$(cd "$(dirname "$_p")" && pwd -P 2>/dev/null)" || return 1
        printf '%s/%s\n' "$_d" "$(basename "$_p")"
        return 0
    fi
    # Path non esistente: unisci parent se esiste
    _parent="$(dirname "$_p")"
    _base="$(basename "$_p")"
    if [ -d "$_parent" ]; then
        _d="$(cd "$_parent" && pwd -P 2>/dev/null)" || return 1
        printf '%s/%s\n' "$_d" "$_base"
        return 0
    fi
    printf '%s\n' "$_p"
    return 0
}

# Grammar sicura: armv8.2-a con optional +dotprod +i8mm +fp16 (qualsiasi ordine, no dup).
# Vietati: native, sve, sme, token arbitrari, armv8.4, ecc.
isa_validate_arm_arch() {
    _arch="${1:-}"
    if [ -z "$_arch" ]; then
        echo "ERRORE: ARM_ARCH vuoto" >&2
        return 1
    fi
    # Base obbligatoria
    case "$_arch" in
        armv8.2-a|armv8.2-a+*)
            ;;
        *)
            echo "ERRORE: ARM_ARCH non ammesso: '$_arch'" >&2
            echo "        grammar: armv8.2-a[+dotprod][+i8mm][+fp16]" >&2
            return 1
            ;;
    esac
    # Rimuovi base e spezza +feature
    _rest="${_arch#armv8.2-a}"
    if [ -z "$_rest" ]; then
        return 0
    fi
    # Deve iniziare con +
    case "$_rest" in
        +*) ;;
        *)
            echo "ERRORE: ARM_ARCH malformato dopo base: '$_arch'" >&2
            return 1
            ;;
    esac
    _seen_dotprod=0
    _seen_i8mm=0
    _seen_fp16=0
    # Split su +
    _ifs_save="$IFS"
    IFS='+'
    # shellcheck disable=SC2086
    set -- $_rest
    IFS="$_ifs_save"
    # $1 è vuoto (leading +)
    shift || true
    for _feat in "$@"; do
        case "$_feat" in
            "")
                echo "ERRORE: ARM_ARCH ha '++' o trailing +: '$_arch'" >&2
                return 1
                ;;
            dotprod)
                if [ "$_seen_dotprod" -eq 1 ]; then
                    echo "ERRORE: ARM_ARCH feature duplicata: dotprod" >&2
                    return 1
                fi
                _seen_dotprod=1
                ;;
            i8mm)
                if [ "$_seen_i8mm" -eq 1 ]; then
                    echo "ERRORE: ARM_ARCH feature duplicata: i8mm" >&2
                    return 1
                fi
                _seen_i8mm=1
                ;;
            fp16)
                if [ "$_seen_fp16" -eq 1 ]; then
                    echo "ERRORE: ARM_ARCH feature duplicata: fp16" >&2
                    return 1
                fi
                _seen_fp16=1
                ;;
            *)
                echo "ERRORE: ARM_ARCH feature non ammessa: '$_feat' in '$_arch'" >&2
                echo "        ammesse: +dotprod +i8mm +fp16 (no native/sve/sme)" >&2
                return 1
                ;;
        esac
    done
    return 0
}

# Risolve root progetto (deve esistere come directory).
# Output: ISA_ROOT (assoluto, no symlink escape se pwd -P)
isa_resolve_root() {
    _cand="${1:-}"
    ISA_ROOT=""
    if [ -z "$_cand" ]; then
        echo "ERRORE: root vuoto" >&2
        return 1
    fi
    if [ ! -d "$_cand" ]; then
        echo "ERRORE: root non è una directory: $_cand" >&2
        return 1
    fi
    ISA_ROOT="$(cd "$_cand" && pwd -P)" || {
        echo "ERRORE: impossibile risolvere root: $_cand" >&2
        return 1
    }
    if [ -z "$ISA_ROOT" ] || [ "$ISA_ROOT" = "/" ]; then
        echo "ERRORE: root risolto non sicuro: '$ISA_ROOT'" >&2
        return 1
    fi
    return 0
}

# Risolve BUILD_DIR sotto ROOT.
# Accetta solo nome relativo semplice (no absolute, no ., .., no / o \ traversal).
# Output: ISA_BUILD_DIR = path assoluto canonico sotto ISA_ROOT (può non esistere ancora).
isa_resolve_build_dir() {
    _root="${1:-}"
    _bd="${2:-}"
    ISA_BUILD_DIR=""
    if [ -z "$_root" ] || [ -z "$_bd" ]; then
        echo "ERRORE: root/build_dir vuoti" >&2
        return 1
    fi
    # Rifiuta absolute (Unix e Windows-ish)
    case "$_bd" in
        /*|[A-Za-z]:*|\\\\*|~*)
            echo "ERRORE: BUILD_DIR deve essere relativo al root (got: $_bd)" >&2
            return 1
            ;;
        ""|"."|"..")
            echo "ERRORE: BUILD_DIR non sicuro: '$_bd'" >&2
            return 1
            ;;
    esac
    # Rifiuta path traversal / separatori
    case "$_bd" in
        */*|*\*|*:*)
            echo "ERRORE: BUILD_DIR non può contenere separatori o traversal: '$_bd'" >&2
            return 1
            ;;
    esac
    # Solo [A-Za-z0-9._-]
    if ! printf '%s' "$_bd" | grep -Eq '^[A-Za-z0-9._-]+$'; then
        echo "ERRORE: BUILD_DIR caratteri non ammessi: '$_bd'" >&2
        return 1
    fi
    # Non deve collidere semanticamente con root
    if [ "$_bd" = "src" ] || [ "$_bd" = "include" ]; then
        echo "AVVISO: BUILD_DIR='$_bd' è un nome sensibile; ammesso ma attenzione" >&2
    fi
    ISA_BUILD_DIR="${_root}/${_bd}"
    # Se esiste, risolvi e verifica che resti sotto root
    if [ -e "$ISA_BUILD_DIR" ]; then
        _resolved="$(cd "$ISA_BUILD_DIR" && pwd -P)" || {
            echo "ERRORE: impossibile risolvere BUILD_DIR: $ISA_BUILD_DIR" >&2
            return 1
        }
        case "$_resolved" in
            "$_root"|"$_root"/*)
                ISA_BUILD_DIR="$_resolved"
                ;;
            *)
                echo "ERRORE: BUILD_DIR esce dal root (symlink escape?): $_resolved" >&2
                echo "        root=$_root" >&2
                return 1
                ;;
        esac
        # Non permettere che BUILD_DIR == ROOT
        if [ "$ISA_BUILD_DIR" = "$_root" ]; then
            echo "ERRORE: BUILD_DIR risolve al root stesso — wipe vietato" >&2
            return 1
        fi
    fi
    return 0
}

# Verifica che TARGET sia wipe-abile con rm -rf (sotto ROOT, non root, non parent).
isa_assert_safe_rm_target() {
    _root="${1:-}"
    _target="${2:-}"
    if [ -z "$_root" ] || [ -z "$_target" ]; then
        echo "ERRORE: assert_safe_rm: argomenti vuoti" >&2
        return 1
    fi
    if [ ! -e "$_target" ]; then
        return 0
    fi
    _t_abs="$(cd "$_target" 2>/dev/null && pwd -P)" || {
        # file non-dir
        _t_abs="$(isa_realpath "$_target")"
    }
    _r_abs="$(cd "$_root" && pwd -P)"
    if [ -z "$_t_abs" ] || [ -z "$_r_abs" ]; then
        echo "ERRORE: assert_safe_rm: path non risolvibile" >&2
        return 1
    fi
    if [ "$_t_abs" = "$_r_abs" ]; then
        echo "ERRORE: rifiuto rm -rf del root sorgente: $_t_abs" >&2
        return 1
    fi
    case "$_t_abs" in
        "$_r_abs"/*)
            ;;
        *)
            echo "ERRORE: rifiuto rm -rf fuori dal root: $_t_abs (root=$_r_abs)" >&2
            return 1
            ;;
    esac
    # Non wipe parent del root
    _parent="$(cd "$_r_abs/.." && pwd -P)"
    if [ "$_t_abs" = "$_parent" ]; then
        echo "ERRORE: rifiuto rm -rf del parent del root: $_t_abs" >&2
        return 1
    fi
    # Non wipe home o /
    if [ "$_t_abs" = "/" ] || [ "$_t_abs" = "${HOME:-/__none__}" ]; then
        echo "ERRORE: rifiuto rm -rf di path critico: $_t_abs" >&2
        return 1
    fi
    return 0
}

# Fase scientifica campagna F1–F4 (incl. sottofasi F2.2, F4.2, …).
# Ritorna 0 se scientifica, 1 altrimenti.
isa_is_scientific_phase() {
    _phase="${1:-}"
    case "$_phase" in
        F1|F1.*|F2|F2.*|F3|F3.*|F4|F4.*)
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

# Flag riservati al harness: non devono comparire in EXTRA_FLAGS.
# Ritorna 0 se ok, 1 se violazione (stampa errore).
isa_check_reserved_extra_flags() {
    _flags="${1:-}"
    if [ -z "$_flags" ]; then
        return 0
    fi
    # Tokenizza su whitespace
    # shellcheck disable=SC2086
    set -- $_flags
    _bad=""
    while [ $# -gt 0 ]; do
        _tok="$1"
        shift
        case "$_tok" in
            -m|--model|-p|--prompt|--prompt-file|-n|--n-predict|--predict|\
            --temp|--temperature|-t|--threads|-c|--ctx|--ctx-size|--ctx_size|\
            -ctk|-ctv|--no-display-prompt|--display-prompt|\
            -cnv|--conversation|-no-cnv|--no-conversation|--single-turn|-st|--simple-io)
                _bad="${_bad} ${_tok}"
                # flag booleani: non consumare il token successivo
                case "$_tok" in
                    --no-display-prompt|--display-prompt|-no-cnv|--no-conversation|-cnv|--conversation|--single-turn|-st|--simple-io) ;;
                    *)
                        if [ $# -gt 0 ]; then
                            case "$1" in
                                -*) ;;
                                *) shift ;;
                            esac
                        fi
                        ;;
                esac
                ;;
            -m*|--model=*|-p*|--prompt=*|-n*|--temp=*|--temperature=*|-t*|--threads=*|\
            -c*|--ctx=*|--ctx-size=*|-ctk*|-ctv*)
                # forme attaccate / =
                case "$_tok" in
                    -m|--model|-p|--prompt|-n|--temp|-t|--threads|-c|--ctx|-ctk|-ctv) ;;
                    -m*|-p*|-n*|-t*|-c*|-ctk*|-ctv*|--model=*|--prompt=*|--temp=*|\
                    --temperature=*|--threads=*|--ctx=*|--ctx-size=*|--n-predict=*|--predict=*)
                        _bad="${_bad} ${_tok}"
                        ;;
                esac
                ;;
        esac
    done
    if [ -n "$_bad" ]; then
        echo "ERRORE: EXTRA_FLAGS/--flags contiene opzioni riservate al harness:${_bad}" >&2
        echo "        riservate: -m/-p/-n/--temp/-t/-c/-ctk/-ctv/--no-display-prompt/--no-conversation" >&2
        echo "        usa i flag del harness (--model, --n-gen, --threads, …)" >&2
        return 1
    fi
    return 0
}
