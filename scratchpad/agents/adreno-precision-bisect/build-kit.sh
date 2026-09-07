#!/usr/bin/env bash
set -u

readonly CELL_DIR="/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/adreno-precision-bisect"
readonly SOURCE_TREE="/Users/marco/Projects/kalsallama-wt-oclpicks-25910"
readonly SOURCE_BRANCH="kalsa/opencl-picks-2026-09+25910"
readonly EXPECTED_HEAD="2f3b24dee"
readonly PRESET_SOURCE="/Users/marco/Projects/kalsallama-wt-upstream/CMakeUserPresets.json"
readonly PRESET_TARGET="$SOURCE_TREE/CMakeUserPresets.json"
readonly IMAGE="ghcr.io/snapdragon-toolchain/arm64-android:v0.7"
readonly KIT_ROOT="$HOME/kalsa-qdc/adreno-precision-bisect"
readonly TGZ="$KIT_ROOT/kit-$EXPECTED_HEAD.tgz"
readonly LOG_DIR="$CELL_DIR/logs/$EXPECTED_HEAD"
readonly BUILDS_FILE="$CELL_DIR/BUILDS.txt"
readonly -a REQUESTED_TARGETS=(
    ggml-base ggml-cpu ggml-opencl ggml llama llama-common
    llama-bench-impl llama-bench test-backend-ops llama-perplexity llama-eval-callback
)
readonly -a KIT_BINARIES=(llama-bench test-backend-ops llama-perplexity llama-eval-callback)
# Every .so the build produces is shipped: a hand-kept list already cost one
# device session (libllama-perplexity-impl.so was missing and llama-perplexity
# could not link on the phone).
readonly -a KIT_LIBS=(ALL)

START_EPOCH=$(date +%s)
CONTAINER="kalsa-adreno-precision-$EXPECTED_HEAD"
HOST_TARGETS=()
RECORD=0
PRESET_CLEANUP=0
BUILD_PASS=not_run

sha256_file() {
    local text rc
    if command -v shasum >/dev/null 2>&1; then
        text=$(shasum -a 256 "$1")
        rc=$?
    elif command -v sha256sum >/dev/null 2>&1; then
        text=$(sha256sum "$1")
        rc=$?
    else
        echo "build-kit.sh: no sha256 tool found" >&2
        return 127
    fi
    [ "$rc" -eq 0 ] || return "$rc"
    set -- $text
    printf '%s\n' "$1"
}

die() { echo "build-kit.sh: $*" >&2; exit 1; }

record_build() {
    local rc="$1" duration=$(( $(date +%s) - START_EPOCH )) tgz_sha="-"
    if [ -f "$TGZ" ]; then tgz_sha=$(sha256_file "$TGZ") || tgz_sha="-"; fi
    printf '%s %s %s %s %s\n' "$EXPECTED_HEAD" "$rc" "$tgz_sha" "$duration" "$BUILD_PASS" >> "$BUILDS_FILE"
}

cleanup_preset() {
    local rc=0
    if [ "$PRESET_CLEANUP" -eq 1 ] && [ -e "$PRESET_TARGET" ]; then
        rm -f "$PRESET_TARGET"
        rc=$?
        printf 'preset_cleanup_rc=%s\n' "$rc"
    fi
    return "$rc"
}

on_exit() {
    local rc=$? cleanup_rc
    cleanup_preset; cleanup_rc=$?
    [ "$rc" -eq 0 ] && [ "$cleanup_rc" -ne 0 ] && rc="$cleanup_rc"
    [ "$RECORD" -eq 1 ] && record_build "$rc"
    exit "$rc"
}

busy_container_check() {
    local names name
    local -a busy_names=()
    names=$(docker ps --format '{{.Names}}') || die "docker ps failed"
    while IFS= read -r name; do
        case "$name" in
            kalsa-*kit-*|kalsa-adreno-precision-*) busy_names+=("$name") ;;
        esac
    done <<< "$names"
    if [ "${#busy_names[@]}" -gt 0 ]; then
        echo "build-kit.sh: another kalsa build container is running:" >&2
        printf '  %s\n' "${busy_names[@]}" >&2
        exit 75
    fi
}

docker_cmake() {
    docker run --rm --name "$CONTAINER" -u "$(id -u):$(id -g)" \
        --volume "$SOURCE_TREE:/workspace" \
        --platform linux/amd64 -w /workspace "$IMAGE" cmake "$@"
}

run_step() {
    local name="$1"; shift
    local log="$LOG_DIR/${name}.log" exit_file="$LOG_DIR/${name}.exit" rc
    rm -f "$exit_file"
    {
        printf '=== START %s %s ===\n' "$name" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
        printf 'command:'; printf ' %q' "$@"; printf '\n'
    } > "$log"
    "$@" >> "$log" 2>&1; rc=$?
    printf '%s\n' "$rc" > "$exit_file"
    printf '=== END %s exit=%s %s ===\n' "$name" "$rc" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$log"
    return "$rc"
}

check_source() {
    local head branch dirty line unexpected=0 fault_count
    git -C "$SOURCE_TREE" rev-parse --git-dir >/dev/null 2>&1 || die "source tree is not a git worktree: $SOURCE_TREE"
    branch=$(git -C "$SOURCE_TREE" symbolic-ref --short -q HEAD 2>/dev/null || printf 'detached')
    dirty=$(git -C "$SOURCE_TREE" status --porcelain=v1) || die "could not inspect source status"
    head=$(git -C "$SOURCE_TREE" rev-parse HEAD 2>/dev/null) || die "could not inspect source HEAD"
    [ -f "$SOURCE_TREE/ggml/src/ggml-opencl/ggml-opencl.cpp" ] || die "OpenCL source file is missing"
    fault_count=$(grep -c 'KALSA_BENCH_FAULT_INJECT' "$SOURCE_TREE/ggml/src/ggml-opencl/ggml-opencl.cpp" || true)
    while IFS= read -r line; do
        case "$line" in
            ""|"?? CMakeUserPresets.json") ;;
            *) unexpected=1; printf 'unexpected_source_status=%s\n' "$line" ;;
        esac
    done <<< "$dirty"
    printf 'source_tree=%s\nsource_branch=%s\nsource_head=%s\nsource_dirty=%s\nfault_define_occurrences=%s\n' \
        "$SOURCE_TREE" "$branch" "$head" "$([ -n "$dirty" ] && echo 1 || echo 0)" "$fault_count"
    [ "$unexpected" -eq 0 ] || die "source tree is dirty outside CMakeUserPresets.json"
    [ "$head" = "2f3b24dee5833faeeb0ef6f097c4db3d11a96fb0" ] || die "source HEAD is not 2f3b24dee"
    [ "$fault_count" -eq 0 ] || die "KALSA_BENCH_FAULT_INJECT occurs in ggml-opencl.cpp"
    [ -f "$PRESET_SOURCE" ] || die "preset source is missing: $PRESET_SOURCE"
}

prepare_preset() {
    if [ -e "$PRESET_TARGET" ]; then
        cmp -s "$PRESET_SOURCE" "$PRESET_TARGET" || die "existing CMakeUserPresets.json differs from the known preset"
        PRESET_CLEANUP=1
        echo "preset=existing_matching_copy"
    else
        PRESET_CLEANUP=1
        cp "$PRESET_SOURCE" "$PRESET_TARGET" || die "could not copy CMakeUserPresets.json"
        echo "preset=created_copy"
    fi
}

resolve_host_targets() {
    local help_log="$LOG_DIR/02-host-build-target-help.log" target rc dropped=0
    docker_cmake --build build-snapdragon --target help > "$help_log" 2>&1; rc=$?
    printf 'target_help_rc=%s\n' "$rc" >> "$help_log"
    [ "$rc" -eq 0 ] || return "$rc"
    HOST_TARGETS=()
    for target in "${REQUESTED_TARGETS[@]}"; do
        if awk -v wanted="$target" '{ split($0, a, ":"); n = a[1]; sub(/.*\//, "", n); if (n == wanted) { found = 1; exit } } END { exit !found }' "$help_log"; then
            HOST_TARGETS+=("$target")
        else
            dropped=1
            printf 'dropped_target=%s reason=target_missing\n' "$target" >> "$help_log"
        fi
    done
    [ "$dropped" -eq 1 ] || printf 'dropped_target=none\n' >> "$help_log"
    [ "${#HOST_TARGETS[@]}" -gt 0 ]
}

assemble_kit() {
    local source_bin="$SOURCE_TREE/build-snapdragon/bin"
    local staged="$KIT_ROOT/.kit-$EXPECTED_HEAD.tmp.$$" tgz_tmp="$TGZ.tmp.$$"
    local binary lib from digest
    [ -d "$source_bin" ] || return 1
    printf 'kit_build_pass=%s\n' "$BUILD_PASS"
    rm -rf "$staged" "$tgz_tmp"
    mkdir -p "$staged/bin" "$staged/lib" || return 1
    for binary in "${KIT_BINARIES[@]}"; do
        [ -f "$source_bin/$binary" ] || { echo "required binary missing: $binary"; return 1; }
        cp "$source_bin/$binary" "$staged/bin/$binary" || return 1
        digest=$(sha256_file "$source_bin/$binary") || return 1
        printf 'binary_sha256 %s %s\n' "$binary" "$digest"
    done
    local lib_count=0
    while IFS= read -r from; do
        [ -n "$from" ] || continue
        cp "$from" "$staged/lib/$(basename "$from")" || return 1
        printf 'shipped_lib=%s\n' "$(basename "$from")"
        lib_count=$((lib_count + 1))
    done <<EOF
$(find "$SOURCE_TREE/build-snapdragon" -type f -name '*.so' | sort)
EOF
    [ "$lib_count" -gt 0 ] || { echo "no shared libraries found in the build tree"; return 1; }
    for binary in "${KIT_BINARIES[@]}"; do
        while IFS= read -r needed; do
            [ -f "$staged/lib/$needed" ] || { echo "missing dependency $needed for $binary"; return 1; }
        done <<EOF
$(strings -a "$source_bin/$binary" | grep -E '^lib(ggml|llama)[a-z0-9._-]*\.so$' | sort -u)
EOF
    done
    printf '%s\n' "2f3b24dee5833faeeb0ef6f097c4db3d11a96fb0" > "$staged/GIT_SHA" || return 1
    (
        cd "$staged" || exit 1
        : > SHA256SUMS
        for file in GIT_SHA bin/* lib/*; do
            [ -f "$file" ] || continue
            digest=$(sha256_file "$file") || exit 1
            printf '%s  %s\n' "$digest" "$file" >> SHA256SUMS || exit 1
        done
        tar -czf "$tgz_tmp" bin lib GIT_SHA SHA256SUMS || exit 1
    ) || { rm -rf "$staged" "$tgz_tmp"; return 1; }
    rm -rf "$KIT_ROOT/kit-$EXPECTED_HEAD"
    mv "$staged" "$KIT_ROOT/kit-$EXPECTED_HEAD" || return 1
    mv "$tgz_tmp" "$TGZ" || return 1
    printf 'tar_sha256 %s\n' "$(sha256_file "$TGZ")"
}

check_source
mkdir -p "$CELL_DIR/logs" "$LOG_DIR" "$KIT_ROOT" || die "could not create output directories"
RECORD=1
trap on_exit EXIT
prepare_preset
[ ! -e "$TGZ" ] || { echo "build-kit.sh: output already exists: $TGZ"; exit 0; }
busy_container_check
run_step 01-cmake-configure docker_cmake --preset arm64-android-snapdragon-release -B build-snapdragon -DGGML_HEXAGON=OFF || exit $?
busy_container_check
resolve_host_targets || exit $?
busy_container_check
BUILD_PASS=first_pass
run_step 02-host-build docker_cmake --build build-snapdragon --target "${HOST_TARGETS[@]}" -j8; build_rc=$?
if [ "$build_rc" -ne 0 ]; then
    BUILD_PASS=retry
    busy_container_check
    run_step 02-host-build-retry docker_cmake --build build-snapdragon --target "${HOST_TARGETS[@]}" -j8; build_rc=$?
fi
[ "$build_rc" -eq 0 ] || exit "$build_rc"
busy_container_check
run_step 03-assemble-kit assemble_kit || exit $?
exit 0
