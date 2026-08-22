from pathlib import Path
kdir = Path(r"C:\Users\gualt\Desktop\Kalsa\moe-experiments\worktree-mali-probe\ggml\src\ggml-opencl\kernels")
for p in sorted(kdir.glob("*.cl")):
    t = p.read_text(encoding="utf-8", errors="replace")
    if "INTEL_GPU" not in t:
        continue
    has_ns = any(s in t for s in ("N_SIMDWIDTH", "#define N_DST", "N_R0_", "N_SUBGROUP_SIZE"))
    if not has_ns:
        continue
    print(
        f"{p.name:45s} INTEL={t.count('#ifdef INTEL_GPU'):2d} "
        f"ADRENO={t.count('ADRENO_GPU'):2d} "
        f"N_SIMDWIDTH_def={t.count('#define N_SIMDWIDTH'):2d} "
        f"N_DST_def={t.count('#define N_DST'):2d} "
        f"half_ptr={t.count('global half') + t.count('__global half')}"
    )
