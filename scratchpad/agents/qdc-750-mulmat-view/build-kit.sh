#!/usr/bin/env bash
set -u

readonly NOTES_DIR="/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-750-mulmat-view"
readonly LLAMA_REPO="/Users/marco/Projects/kalsallama"
readonly PRESET_SOURCE="/Users/marco/Projects/kalsallama-wt-upstream/CMakeUserPresets.json"
readonly IMAGE="ghcr.io/snapdragon-toolchain/arm64-android:v0.7"
readonly KIT_ROOT="$HOME/kalsa-qdc/qdc-750-mulmat-view"
readonly BUILDS_FILE="$NOTES_DIR/BUILDS.txt"
readonly -a REQUESTED_TARGETS=(ggml-base ggml-cpu ggml-opencl ggml llama llama-common llama-bench-impl llama-bench test-backend-ops)
readonly -a KIT_BINARIES=(llama-bench test-backend-ops)
readonly -a KIT_LIBS=(libggml-base.so libggml-cpu.so libggml-opencl.so libggml.so libllama.so libllama-common.so libllama-bench-impl.so)

if [ "$#" -ne 1 ]; then
    echo "usage: $0 <full-or-short-sha>" >&2
    exit 2
fi
readonly REQUESTED_SHA="$1"
START_EPOCH=$(date +%s)
FULL_COMMIT=""; SHA7=""; TGZ=""; LOG_DIR=""; WORKTREE=""; CONTAINER=""; RECORD=0
HOST_TARGETS=()

sha256_file() {
    local file="$1" line
    if command -v shasum >/dev/null 2>&1; then line=$(shasum -a 256 "$file") || return
    elif command -v sha256sum >/dev/null 2>&1; then line=$(sha256sum "$file") || return
    else echo "sha256 tool not found" >&2; return 127; fi
    printf '%s\n' "${line%% *}"
}

record_build() {
    local rc="$1" duration=$(( $(date +%s) - START_EPOCH )) tgz_sha="-" line
    if [ -n "$TGZ" ] && [ -f "$TGZ" ]; then tgz_sha=$(sha256_file "$TGZ") || tgz_sha="-"; fi
    line="$SHA7 $rc $tgz_sha $duration"
    if [ ! -f "$BUILDS_FILE" ] || ! awk -v sha7="$SHA7" -v exit_code="$rc" -v digest="$tgz_sha" \
        '$1 == sha7 && $2 == exit_code && $3 == digest { found = 1 } END { exit !found }' "$BUILDS_FILE"; then
        printf '%s\n' "$line" >> "$BUILDS_FILE"
    fi
}

on_exit() {
    local rc=$?
    [ "$RECORD" -eq 1 ] && record_build "$rc"
    exit "$rc"
}

die() {
    echo "build-kit.sh: $*" >&2
    exit 1
}

resolve_commit() {
    FULL_COMMIT=$(git -C "$LLAMA_REPO" rev-parse --verify "$REQUESTED_SHA^{commit}" 2>/dev/null) || {
        git -C "$LLAMA_REPO" fetch origin || die "commit is unavailable and git fetch origin failed"
        FULL_COMMIT=$(git -C "$LLAMA_REPO" rev-parse --verify "$REQUESTED_SHA^{commit}" 2>/dev/null) || die "commit not found: $REQUESTED_SHA"
    }
}

busy_container_check() {
    local names name
    local -a busy_names=()
    names=$(docker ps --format '{{.Names}}') || die "docker ps failed"
    while IFS= read -r name; do
        case "$name" in kalsa-750kit-*|kalsa-bisect-*) busy_names+=("$name") ;; esac
    done <<< "$names"
    if [ "${#busy_names[@]}" -gt 0 ]; then
        echo "build-kit.sh: another kalsa build container is running:" >&2
        printf '  %s\n' "${busy_names[@]}" >&2
        exit 75
    fi
}

docker_cmake() {
    docker run --rm --name "$CONTAINER" -u "$(id -u):$(id -g)" \
        --volume "$WORKTREE:/workspace" --platform linux/amd64 -w /workspace "$IMAGE" cmake "$@"
}

run_step() {
    local name="$1"; shift
    local log="$LOG_DIR/${name}.log" exit_file="$LOG_DIR/${name}.exit" rc
    rm -f "$exit_file"
    { printf '=== START %s %s ===\n' "$name" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"; printf 'command:'; printf ' %q' "$@"; printf '\n'; } > "$log"
    "$@" >> "$log" 2>&1; rc=$?
    printf '%s\n' "$rc" > "$exit_file"
    printf '=== END %s exit=%s %s ===\n' "$name" "$rc" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$log"
    return "$rc"
}

resolve_host_targets() {
    local help_log="$LOG_DIR/02-host-build-target-help.log" target rc dropped=0
    docker_cmake --build build-snapdragon --target help > "$help_log" 2>&1; rc=$?
    printf 'target_help_rc=%s\n' "$rc" >> "$help_log"
    [ "$rc" -eq 0 ] || return "$rc"
    HOST_TARGETS=()
    for target in "${REQUESTED_TARGETS[@]}"; do
        if awk -v wanted="$target" '$NF == wanted { found = 1 } END { exit !found }' "$help_log"; then
            HOST_TARGETS+=("$target")
        else
            dropped=1; printf 'dropped_target=%s reason=target_missing\n' "$target" >> "$help_log"
        fi
    done
    [ "$dropped" -eq 1 ] || printf 'dropped_target=none\n' >> "$help_log"
    [ "${#HOST_TARGETS[@]}" -gt 0 ]
}

assemble_kit() {
    local src="$WORKTREE/build-snapdragon/bin" kit="$KIT_ROOT/gpu-kit-$SHA7"
    local staged="$KIT_ROOT/.gpu-kit-$SHA7.tmp.$$" tgz_tmp="$TGZ.tmp.$$"
    local binary lib from file digest
    [ -d "$src" ] || return 1
    rm -rf "$staged" "$tgz_tmp"
    mkdir -p "$staged/bin" "$staged/lib" || return 1
    for binary in "${KIT_BINARIES[@]}"; do
        [ -f "$src/$binary" ] || { echo "required binary missing: $binary"; return 1; }
        cp "$src/$binary" "$staged/bin/$binary" || return 1
    done
    for lib in "${KIT_LIBS[@]}"; do
        from=$(find "$WORKTREE/build-snapdragon" -type f -name "$lib" -print -quit)
        if [ -n "$from" ]; then cp "$from" "$staged/lib/$lib" || return 1
        else printf 'skipped_lib=%s reason=missing\n' "$lib"; fi
    done
    printf '%s\n' "$FULL_COMMIT" > "$staged/GIT_SHA" || return 1
    (
        cd "$staged" || exit 1; : > SHA256SUMS
        for file in GIT_SHA bin/* lib/*; do
            [ -f "$file" ] || continue
            digest=$(sha256_file "$file") || exit 1
            printf '%s  %s\n' "$digest" "$file" >> SHA256SUMS || exit 1
        done
        tar -czf "$tgz_tmp" bin lib GIT_SHA SHA256SUMS || exit 1
    ) || { rm -rf "$staged" "$tgz_tmp"; return 1; }
    rm -rf "$kit" || return 1
    mv "$staged" "$kit" || return 1
    mv "$tgz_tmp" "$TGZ" || return 1
    printf 'assembled %s\n' "$kit"
    printf 'tar sha256 %s\n' "$(sha256_file "$TGZ")"
}

resolve_commit
SHA7="${FULL_COMMIT:0:7}"; TGZ="$KIT_ROOT/gpu-kit-$SHA7.tgz"; LOG_DIR="$NOTES_DIR/logs/$SHA7"
WORKTREE="/Users/marco/Projects/kalsallama-wt-750kit-$SHA7"; CONTAINER="kalsa-750kit-$SHA7"; RECORD=1
trap on_exit EXIT
mkdir -p "$NOTES_DIR/logs" "$LOG_DIR" "$KIT_ROOT"

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
    git -C "$LLAMA_REPO" worktree add --detach "$WORKTREE" "$FULL_COMMIT" || die "could not create git worktree"
fi
[ -f "$PRESET_SOURCE" ] || die "preset source is missing: $PRESET_SOURCE"
cp "$PRESET_SOURCE" "$WORKTREE/CMakeUserPresets.json" || die "could not copy CMakeUserPresets.json"
busy_container_check

run_step 01-cmake-configure docker_cmake --preset arm64-android-snapdragon-release -B build-snapdragon -DGGML_HEXAGON=OFF || exit $?
busy_container_check; resolve_host_targets || exit $?
busy_container_check
run_step 02-host-build docker_cmake --build build-snapdragon --target "${HOST_TARGETS[@]}" -j8 || exit $?
busy_container_check
run_step 03-assemble-kit assemble_kit || exit $?
exit 0
