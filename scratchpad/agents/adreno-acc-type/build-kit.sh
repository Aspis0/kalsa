#!/usr/bin/env bash
set -u

readonly CELL_DIR="/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/adreno-acc-type"
readonly SOURCE_TREE="/Users/marco/Projects/kalsallama-wt-accprobe"
readonly SOURCE_BRANCH="kalsa/gemm-acc-probe"
readonly BASELINE_HEAD="2f3b24dee5833faeeb0ef6f097c4db3d11a96fb0"
readonly PRESET_SOURCE="/Users/marco/Projects/kalsallama-wt-upstream/CMakeUserPresets.json"
readonly PRESET_TARGET="$SOURCE_TREE/CMakeUserPresets.json"
readonly IMAGE="ghcr.io/snapdragon-toolchain/arm64-android:v0.7"
readonly KIT_ROOT="$HOME/kalsa-qdc/adreno-acc-type"
readonly TGZ="$KIT_ROOT/kit-gemm-acc-probe.tgz"
readonly LOG_DIR="$CELL_DIR/logs/gemm-acc-probe"
readonly BUILDS_FILE="$CELL_DIR/BUILDS.txt"
readonly -a REQUESTED_TARGETS=(
    ggml-base ggml-cpu ggml-opencl ggml llama llama-common
    llama-bench-impl llama-bench test-backend-ops llama-perplexity llama-eval-callback
)
readonly -a KIT_BINARIES=(llama-bench test-backend-ops llama-perplexity llama-eval-callback)
readonly -a EXPECTED_PATCH_PATHS=(
    ggml/src/ggml-opencl/kernels/gemm_noshuffle_q4_0_f32.cl
    ggml/src/ggml-opencl/ggml-opencl.cpp
)

START_EPOCH=$(date +%s)
SOURCE_HEAD="-"
CONTAINER="kalsa-adreno-accprobe"
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
    if [ -f "$TGZ" ]; then
        tgz_sha=$(sha256_file "$TGZ") || tgz_sha="-"
    fi
    printf '%s %s %s %s %s\n' "$SOURCE_HEAD" "$rc" "$tgz_sha" "$duration" "$BUILD_PASS" >> "$BUILDS_FILE"
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
            kalsa-*kit-*|kalsa-adreno-*) busy_names+=("$name") ;;
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
    local name log exit_file rc
    name="$1"
    log="$LOG_DIR/${name}.log"
    exit_file="$LOG_DIR/${name}.exit"
    shift
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
    local head branch dirty line unexpected=0 fault_count fault_grep_rc diff_paths path expected found missing=0 diff_count=0 diff_rc
    git -C "$SOURCE_TREE" rev-parse --git-dir >/dev/null 2>&1 || die "source tree is not a git worktree: $SOURCE_TREE"
    branch=$(git -C "$SOURCE_TREE" symbolic-ref --short -q HEAD 2>/dev/null || printf 'detached')
    dirty=$(git -C "$SOURCE_TREE" status --porcelain=v1) || die "could not inspect source status"
    head=$(git -C "$SOURCE_TREE" rev-parse HEAD 2>/dev/null) || die "could not inspect source HEAD"
    SOURCE_HEAD="$head"
    [ -f "$SOURCE_TREE/ggml/src/ggml-opencl/ggml-opencl.cpp" ] || die "OpenCL source file is missing"
    fault_count=$(grep -c 'KALSA_BENCH_FAULT_INJECT' "$SOURCE_TREE/ggml/src/ggml-opencl/ggml-opencl.cpp")
    fault_grep_rc=$?
    [ "$fault_grep_rc" -le 1 ] || die "could not inspect KALSA_BENCH_FAULT_INJECT occurrences"
    while IFS= read -r line; do
        case "$line" in
            ""|"?? CMakeUserPresets.json") ;;
            *) unexpected=1; printf 'unexpected_source_status=%s\n' "$line" ;;
        esac
    done <<< "$dirty"
    printf 'source_tree=%s\nsource_branch=%s\nsource_head=%s\nsource_dirty=%s\nfault_define_occurrences=%s\n' \
        "$SOURCE_TREE" "$branch" "$head" "$([ -n "$dirty" ] && echo 1 || echo 0)" "$fault_count"
    [ "$unexpected" -eq 0 ] || die "source tree is dirty outside CMakeUserPresets.json"
    [ "$branch" = "$SOURCE_BRANCH" ] || die "source branch is not $SOURCE_BRANCH"
    [ "$fault_count" -eq 0 ] || die "KALSA_BENCH_FAULT_INJECT occurs in ggml-opencl.cpp"
    git -C "$SOURCE_TREE" cat-file -e "$BASELINE_HEAD^{commit}" >/dev/null 2>&1 || die "baseline commit is missing: $BASELINE_HEAD"
    diff_paths=$(git -C "$SOURCE_TREE" diff --name-only "$BASELINE_HEAD" "$head"); diff_rc=$?
    [ "$diff_rc" -eq 0 ] || die "could not compare source tree with $BASELINE_HEAD"
    while IFS= read -r path; do
        [ -n "$path" ] || continue
        diff_count=$((diff_count + 1))
        found=0
        for expected in "${EXPECTED_PATCH_PATHS[@]}"; do
            [ "$path" = "$expected" ] && found=1
        done
        if [ "$found" -eq 0 ]; then
            printf 'extra_tree_diff_path=%s\n' "$path" >&2
            missing=1
        fi
    done <<< "$diff_paths"
    for expected in "${EXPECTED_PATCH_PATHS[@]}"; do
        found=0
        while IFS= read -r path; do
            [ "$path" = "$expected" ] && found=1
        done <<< "$diff_paths"
        if [ "$found" -eq 0 ]; then
            printf 'missing_tree_diff_path=%s\n' "$expected" >&2
            missing=1
        fi
    done
    [ "$diff_count" -eq "${#EXPECTED_PATCH_PATHS[@]}" ] || missing=1
    [ "$missing" -eq 0 ] || die "HEAD tree differs from baseline outside the two expected paths"
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
    local staged="$KIT_ROOT/.kit-gemm-acc-probe.tmp.$$" tgz_tmp="$TGZ.tmp.$$"
    local source_libs sorted_libs strings_file matches_file needed_file binary from digest rc lib_count=0 needed
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
    source_libs="$staged/.source-libs"
    sorted_libs="$staged/.sorted-libs"
    find "$SOURCE_TREE/build-snapdragon" -type f -name '*.so' > "$source_libs"; rc=$?
    [ "$rc" -eq 0 ] || return "$rc"
    sort "$source_libs" > "$sorted_libs"; rc=$?
    [ "$rc" -eq 0 ] || return "$rc"
    while IFS= read -r from; do
        [ -n "$from" ] || continue
        cp "$from" "$staged/lib/$(basename "$from")" || return 1
        printf 'shipped_lib=%s\n' "$(basename "$from")"
        lib_count=$((lib_count + 1))
    done < "$sorted_libs"
    [ "$lib_count" -gt 0 ] || { echo "no shared libraries found in the build tree"; return 1; }
    for binary in "${KIT_BINARIES[@]}"; do
        strings_file="$staged/.strings-$binary"
        matches_file="$staged/.matches-$binary"
        needed_file="$staged/.needed-$binary"
        strings -a "$source_bin/$binary" > "$strings_file"; rc=$?
        [ "$rc" -eq 0 ] || return "$rc"
        grep -E '^lib(ggml|llama)[a-z0-9._-]*\.so$' "$strings_file" > "$matches_file"; rc=$?
        [ "$rc" -le 1 ] || return "$rc"
        if [ "$rc" -eq 1 ]; then
            : > "$matches_file"
        fi
        sort -u "$matches_file" > "$needed_file"; rc=$?
        [ "$rc" -eq 0 ] || return "$rc"
        while IFS= read -r needed; do
            [ -n "$needed" ] || continue
            [ -f "$staged/lib/$needed" ] || { echo "missing dependency $needed for $binary"; return 1; }
        done < "$needed_file"
    done
    printf '%s\n' "$SOURCE_HEAD" > "$staged/GIT_SHA" || return 1
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
    rm -rf "$KIT_ROOT/kit-gemm-acc-probe"
    mv "$staged" "$KIT_ROOT/kit-gemm-acc-probe" || return 1
    mv "$tgz_tmp" "$TGZ" || return 1
    printf 'tar_sha256 %s\n' "$(sha256_file "$TGZ")"
}

check_source
mkdir -p "$CELL_DIR/logs" "$LOG_DIR" "$KIT_ROOT" || die "could not create output directories"
RECORD=1
trap on_exit EXIT

cd "$CELL_DIR" || die "could not enter cell directory"
run_step 00-syntax-gate ./syntax-gate.sh || exit $?
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
