#!/usr/bin/env bash
# Build one pure-upstream Hexagon v73 kit for the QDC bisect.
set -u

readonly NOTES_DIR="/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-npu-bisect-64"
readonly LLAMA_REPO="/Users/marco/Projects/kalsallama"
readonly PRESET_SOURCE="/Users/marco/Projects/kalsallama-wt-upstream/CMakeUserPresets.json"
readonly IMAGE="ghcr.io/snapdragon-toolchain/arm64-android:v0.7"
readonly KIT_ROOT="$HOME/kalsa-qdc/npu-v79-cell"
readonly V6_ROOT="$KIT_ROOT/kit-v6"
readonly BUILDS_FILE="$NOTES_DIR/BUILDS.txt"
readonly -a HOST_TARGETS=(
    ggml-base ggml-cpu ggml-hexagon ggml-opencl ggml
    llama llama-common llama-batched-bench-impl llama-bench-impl
    llama-cli-impl llama-completion-impl llama-fit-params-impl
    llama-perplexity-impl llama-quantize-impl llama-server-impl mtmd
    llama-bench llama-cli llama-perplexity test-backend-ops
)

readonly FULL_SHA="${1-}"
START_EPOCH=$(date +%s)
FULL_COMMIT=""
SHA7=""
TGZ=""
LOG_DIR=""
RECORD=0

sha256_file() {
    local file="$1"
    local line

    if command -v shasum >/dev/null 2>&1; then
        line=$(shasum -a 256 "$file") || return
    elif command -v sha256sum >/dev/null 2>&1; then
        line=$(sha256sum "$file") || return
    else
        echo "sha256 tool not found" >&2
        return 127
    fi
    printf '%s\n' "${line%% *}"
}

record_build() {
    local rc="$1"
    local duration=$(( $(date +%s) - START_EPOCH ))
    local tgz_sha="-"
    local line

    if [ -n "$TGZ" ] && [ -f "$TGZ" ]; then
        tgz_sha=$(sha256_file "$TGZ") || tgz_sha="-"
    fi
    line="$SHA7 $rc $tgz_sha $duration"
    if [ ! -f "$BUILDS_FILE" ] || ! awk -v sha7="$SHA7" -v exit_code="$rc" -v digest="$tgz_sha" \
        '$1 == sha7 && $2 == exit_code && $3 == digest { found = 1 } END { exit !found }' "$BUILDS_FILE"; then
        printf '%s\n' "$line" >> "$BUILDS_FILE"
    fi
}

on_exit() {
    local rc=$?
    if [ "$RECORD" -eq 1 ]; then
        record_build "$rc"
    fi
    exit "$rc"
}

die() {
    echo "build-kit.sh: $*" >&2
    exit 1
}

require_full_sha() {
    [ "${#FULL_SHA}" -eq 40 ] || die "expected a full 40-character commit SHA"
    [[ "$FULL_SHA" =~ ^[0-9a-fA-F]{40}$ ]] || die "commit SHA is not hexadecimal"
}

busy_container_check() {
    local names
    local name
    local -a busy_names=()

    names=$(docker ps --format '{{.Names}}') || die "docker ps failed"
    while IFS= read -r name; do
        case "$name" in
            kalsa-bisect-*) busy_names+=("$name") ;;
        esac
    done <<< "$names"
    if [ "${#busy_names[@]}" -gt 0 ]; then
        echo "build-kit.sh: another kalsa-bisect-* container is running:" >&2
        printf '  %s\n' "${busy_names[@]}" >&2
        exit 75
    fi
}

run_step() {
    local name="$1"
    shift
    local log="$LOG_DIR/${name}.log"
    local exit_file="$LOG_DIR/${name}.exit"
    local rc

    rm -f "$exit_file"
    {
        printf '=== START %s %s ===\n' "$name" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
        printf 'command:'
        printf ' %q' "$@"
        printf '\n'
    } > "$log"
    "$@" >> "$log" 2>&1
    rc=$?
    printf '%s\n' "$rc" > "$exit_file"
    printf '=== END %s exit=%s %s ===\n' "$name" "$rc" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$log"
    return "$rc"
}

assemble_kit() {
    # Sourced from the build tree: cmake --install demands every HTP skel and
    # every test binary, none of which this v73-only build produces.
    local src="$WORKTREE/build-snapdragon/bin"
    local skel="$WORKTREE/build-snapdragon/ggml/src/ggml-hexagon/libggml-htp-v73.so"
    local kit="$KIT_ROOT/kit-bisect-$SHA7"
    local staged="$KIT_ROOT/.kit-bisect-$SHA7.tmp.$$"
    local tgz="$KIT_ROOT/npu-kit-bisect-$SHA7.tgz"
    local binary
    local lib
    local -a binaries=(
        llama-bench
        llama-cli
        llama-perplexity
        test-backend-ops
        test-backend-ops-153f
    )
    local -a libs=(
        libggml-base.so
        libggml-cpu.so
        libggml-hexagon.so
        libggml-htp-v73.so
        libggml-opencl.so
        libggml.so
        libllama-batched-bench-impl.so
        libllama-bench-impl.so
        libllama-cli-impl.so
        libllama-common.so
        libllama-completion-impl.so
        libllama-fit-params-impl.so
        libllama-perplexity-impl.so
        libllama-quantize-impl.so
        libllama-server-impl.so
        libllama.so
        libmtmd.so
    )

    [ -d "$src" ] || return 1
    [ -s "$skel" ] || { echo "libggml-htp-v73.so missing or empty"; return 1; }
    [ -f "$V6_ROOT/bin/test-backend-ops-153f" ] || return 1
    printf 'lib/ and lib-fix/ contain only libggml-htp-v73.so; v75/v79/v81 skels skipped\n'
    rm -rf "$staged"
    mkdir -p "$staged/bin" "$staged/lib" "$staged/lib-fix" || return 1

    for binary in "${binaries[@]:0:4}"; do
        cp "$src/$binary" "$staged/bin/$binary" || return 1
    done
    cp "$V6_ROOT/bin/test-backend-ops-153f" "$staged/bin/test-backend-ops-153f" || return 1

    for lib in "${libs[@]}"; do
        local from="$src/$lib"
        [ "$lib" = libggml-htp-v73.so ] && from="$skel"
        cp "$from" "$staged/lib/$lib" || return 1
        cp "$from" "$staged/lib-fix/$lib" || return 1
    done

    (
        cd "$staged" || exit 1
        : > SHA256SUMS
        for binary in "${binaries[@]}"; do
            shasum -a 256 "bin/$binary" >> SHA256SUMS || exit 1
        done
        for lib in "${libs[@]}"; do
            shasum -a 256 "lib-fix/$lib" >> SHA256SUMS || exit 1
        done
        for lib in "${libs[@]}"; do
            shasum -a 256 "lib/$lib" >> SHA256SUMS || exit 1
        done
        [ "$(wc -l < SHA256SUMS | tr -d ' ')" -eq 39 ] || exit 1
        tar -czf "$tgz.tmp.$$" bin lib lib-fix SHA256SUMS || exit 1
    ) || {
        rm -rf "$staged" "$tgz.tmp.$$"
        return 1
    }

    rm -rf "$kit" || return 1
    mv "$staged" "$kit" || return 1
    mv "$tgz.tmp.$$" "$tgz" || return 1
    printf 'assembled %s\n' "$kit"
    printf 'tar sha256 %s\n' "$(sha256_file "$tgz")"
    printf 'manifest entries %s\n' "$(wc -l < "$kit/SHA256SUMS" | tr -d ' ')"
}

require_full_sha
mkdir -p "$NOTES_DIR/logs" "$KIT_ROOT"
FULL_COMMIT=$(git -C "$LLAMA_REPO" rev-parse --verify "$FULL_SHA^{commit}" 2>/dev/null) || {
    git -C "$LLAMA_REPO" fetch upstream || die "commit is unavailable and git fetch upstream failed"
    FULL_COMMIT=$(git -C "$LLAMA_REPO" rev-parse --verify "$FULL_SHA^{commit}" 2>/dev/null) || die "commit not found: $FULL_SHA"
}
SHA7="${FULL_COMMIT:0:7}"
TGZ="$KIT_ROOT/npu-kit-bisect-$SHA7.tgz"
LOG_DIR="$NOTES_DIR/logs/$SHA7"
WORKTREE="/Users/marco/Projects/kalsallama-wt-bisect-$SHA7"
CONTAINER="kalsa-bisect-$SHA7"
RECORD=1
trap on_exit EXIT
mkdir -p "$LOG_DIR"

if [ -f "$TGZ" ]; then
    existing_sha=$(sha256_file "$TGZ") || existing_sha=""
    if [ -n "$existing_sha" ]; then
        echo "build-kit.sh: existing tarball has sha256 $existing_sha; skipping $SHA7"
        exit 0
    fi
fi

if [ -e "$WORKTREE" ]; then
    actual_head=$(git -C "$WORKTREE" rev-parse HEAD 2>/dev/null) || die "existing path is not a git worktree: $WORKTREE"
    [ "$actual_head" = "$FULL_COMMIT" ] || die "worktree HEAD $actual_head does not match $FULL_COMMIT"
    if git -C "$WORKTREE" symbolic-ref --quiet HEAD >/dev/null 2>&1; then
        git -C "$WORKTREE" switch --detach "$FULL_COMMIT" || die "could not detach existing worktree"
    fi
else
    git -C "$LLAMA_REPO" worktree add --detach "$WORKTREE" "$FULL_COMMIT" || die "could not create worktree"
fi

cp "$PRESET_SOURCE" "$WORKTREE/CMakeUserPresets.json" || die "could not copy CMakeUserPresets.json"
busy_container_check

run_step 01-cmake-configure \
    docker run --rm --name "$CONTAINER" -u "$(id -u):$(id -g)" \
    --volume "$WORKTREE:/workspace" --platform linux/amd64 -w /workspace "$IMAGE" \
    cmake --preset arm64-android-snapdragon-release -B build-snapdragon || exit $?

busy_container_check
run_step 02-htp-v73 \
    docker run --rm --name "$CONTAINER" -u "$(id -u):$(id -g)" \
    --volume "$WORKTREE:/workspace" --platform linux/amd64 -w /workspace "$IMAGE" \
    cmake --build build-snapdragon --target htp-v73 || exit $?

busy_container_check
# The default all target includes every ExternalProject htp-* target; keep the
# host build explicit so only the separately-built v73 skel is produced.
run_step 03-host-build \
    docker run --rm --name "$CONTAINER" -u "$(id -u):$(id -g)" \
    --volume "$WORKTREE:/workspace" --platform linux/amd64 -w /workspace "$IMAGE" \
    cmake --build build-snapdragon --target "${HOST_TARGETS[@]}" || exit $?

run_step 05-assemble-kit assemble_kit || exit $?
exit 0
