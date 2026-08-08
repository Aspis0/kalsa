#!/usr/bin/env bash
# lib_campaign_pin.sh — pin del binario di campagna (mandato fix-bloccanti-audit §C)
#
# Invariante: le misure di campagna invocano SOLO bmoe-cli.CAMPAIGN, mai bmoe-cli nudo.
# Override esplicito: ALLOW_UNPINNED=1 (smoke/debug only).
#
# Uso:
#   source "$SCRIPT_DIR/lib_campaign_pin.sh"
#   resolve_campaign_binary   # imposta CAMPAIGN_BIN, CAMPAIGN_SHA, BIN_SHA256
#   assert_campaign_pin "$BIN"  # abort se sha non coincide (salvo ALLOW_UNPINNED=1)
#
# shellcheck shell=bash

# Path canonici (override via env per test)
CAMPAIGN_BIN_DEFAULT="${CAMPAIGN_BIN_DEFAULT:-$HOME/src/BigMoeOnEdge/build-bmoe/cli/bmoe-cli.CAMPAIGN}"
CAMPAIGN_SHA_FILE_DEFAULT="${CAMPAIGN_SHA_FILE_DEFAULT:-$HOME/src/BigMoeOnEdge/build-bmoe/cli/CAMPAIGN.sha256}"

campaign_pin_basename() {
    # true se il path punta a un binario bmoe-cli di campagna (non PREFAULT/G3*/DIAG/build)
    case "$(basename -- "$1" 2>/dev/null || echo "$1")" in
        bmoe-cli|bmoe-cli.CAMPAIGN|bmoe-cli.NEW|bmoe-cli.ABI_FIX) return 0 ;;
        *) return 1 ;;
    esac
}

resolve_campaign_binary() {
    # Prefer absolute campaign pin; fall back to PATH only under ALLOW_UNPINNED.
    if [ -n "${CAMPAIGN_BIN:-}" ] && [ -x "$CAMPAIGN_BIN" ]; then
        :
    elif [ -x "$CAMPAIGN_BIN_DEFAULT" ]; then
        CAMPAIGN_BIN="$CAMPAIGN_BIN_DEFAULT"
    else
        CAMPAIGN_BIN="$CAMPAIGN_BIN_DEFAULT"
    fi

    if [ -n "${CAMPAIGN_SHA_FILE:-}" ] && [ -f "$CAMPAIGN_SHA_FILE" ]; then
        :
    elif [ -f "$CAMPAIGN_SHA_FILE_DEFAULT" ]; then
        CAMPAIGN_SHA_FILE="$CAMPAIGN_SHA_FILE_DEFAULT"
    else
        CAMPAIGN_SHA_FILE="$CAMPAIGN_SHA_FILE_DEFAULT"
    fi

    CAMPAIGN_SHA=""
    if [ -f "$CAMPAIGN_SHA_FILE" ]; then
        CAMPAIGN_SHA="$(awk 'NF{print $1; exit}' "$CAMPAIGN_SHA_FILE" 2>/dev/null || true)"
    fi
    export CAMPAIGN_BIN CAMPAIGN_SHA_FILE CAMPAIGN_SHA
}

compute_bin_sha256() {
    # stdout: sha256 hex or empty
    local _b="$1"
    if [ ! -e "$_b" ]; then
        echo ""
        return 1
    fi
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$_b" 2>/dev/null | awk '{print $1; exit}'
        return 0
    fi
    if command -v shasum >/dev/null 2>&1; then
        shasum -a 256 "$_b" 2>/dev/null | awk '{print $1; exit}'
        return 0
    fi
    echo ""
    return 1
}

assert_campaign_pin() {
    # assert_campaign_pin <binary-path>
    # Sets BIN_SHA256. Aborts (exit 6) on pin mismatch unless ALLOW_UNPINNED=1.
    local _bin="$1"
    local _got _exp

    resolve_campaign_binary
    BIN_SHA256="$(compute_bin_sha256 "$_bin" || true)"
    export BIN_SHA256

    if [ "${ALLOW_UNPINNED:-0}" = "1" ]; then
        echo "WARN: ALLOW_UNPINNED=1 — pin check skipped (bin=$_bin sha=${BIN_SHA256:-?})" >&2
        return 0
    fi

    if [ ! -x "$_bin" ]; then
        echo "ERRORE pin campagna: binario non eseguibile: $_bin" >&2
        echo "  atteso: $CAMPAIGN_BIN (sha file: $CAMPAIGN_SHA_FILE)" >&2
        exit 6
    fi

    # Must be the CAMPAIGN path (not bare bmoe-cli), unless ALLOW_UNPINNED.
    case "$_bin" in
        *.CAMPAIGN) ;;
        *)
            # allow only if it's the resolved campaign path by realpath equality
            if [ -x "$CAMPAIGN_BIN" ] && [ "$_bin" -ef "$CAMPAIGN_BIN" ] 2>/dev/null; then
                :
            else
                echo "ERRORE pin campagna: invocazione di '$_bin' vietata." >&2
                echo "  Le misure di campagna devono usare SOLO: $CAMPAIGN_BIN" >&2
                echo "  Override esplicito: ALLOW_UNPINNED=1 (non scientifico)." >&2
                exit 6
            fi
            ;;
    esac

    _got="${BIN_SHA256:-}"
    _exp="${CAMPAIGN_SHA:-}"
    if [ -z "$_exp" ]; then
        echo "ERRORE pin campagna: CAMPAIGN.sha256 assente o vuoto: $CAMPAIGN_SHA_FILE" >&2
        exit 6
    fi
    if [ -z "$_got" ]; then
        echo "ERRORE pin campagna: impossibile calcolare sha256 di $_bin" >&2
        exit 6
    fi
    if [ "$_got" != "$_exp" ]; then
        echo "ERRORE pin campagna: sha256 mismatch" >&2
        echo "  binario: $_bin" >&2
        echo "  got:     $_got" >&2
        echo "  expected: $_exp  (da $CAMPAIGN_SHA_FILE)" >&2
        echo "  Un make distratto ha probabilmente sovrascritto il binario." >&2
        echo "  Override esplicito: ALLOW_UNPINNED=1 (non scientifico)." >&2
        exit 6
    fi
    return 0
}

default_campaign_binary_path() {
    resolve_campaign_binary
    printf '%s\n' "$CAMPAIGN_BIN"
}
