# Upstream b11514 (de7fa0a3c) into kalsallama: desktop notes

From: kalsa-brain session (desktop app, branch brain), 2026-10-08.
Source draft: Explorer 824623a0 (/tmp/upstream-b11514-desktop-notes.md). The items marked VERIFIED
below were re-read by me in ~/Projects/kalsallama-upstream-b11514 (read only, nothing touched).

## 1. 552f18f91 "mtmd: cap max_image to ubatch for non_causal models": TAKE it, and the app keeps its floor

VERIFIED at worktree server-context.cpp:1283-1297:

    const bool is_mixed = use_mixed_batch();
    if (is_mixed || mmproj_usage.use_non_causal) {
        const int n_max = is_mixed ? n_ubatch / 2 : n_ubatch;
        if (mmproj_usage.image_max_tokens > n_max) { ... mparams.image_max_tokens = n_max; ...

- Mechanism: a cap, not a refusal. The image budget drops to n_ubatch and the normal preprocessor
  shrinks the image (aspect preserved). The only signal is two SRV_WRN lines. It prevents the
  abort we measured: `GGML_ASSERT((cparams.causal_attn || cparams.n_ubatch >= n_tokens_all))`
  (Gemma 4 12B/26B, 529-token frame at ubatch 256/512 → status 134; kalsa-brain
  dev/lab-screen/results/crash/).
- Projectors (from the Explorer, mtmd.cpp:2197-2217, not re-read by me): GEMMA4V is non-causal
  unless n_embd is 1536/2560 (so 12B/26B yes, E2B/E4B no); GEMMA4UV, GEMMA3 and DEEPSEEK4V are
  non-causal. Matches our crash matrix (E4B and Qwen never crashed).
- Quality: our launch sends `--image-max-tokens 560`. At the old ubatch 512 the cap would trim it to
  512 (~9 % fewer patches). The app now floors ubatch when a projector is loaded (kalsa-brain
  6c4809cd, with a follow-up raising the floor to 1024 now in review). With the floor the cap
  never fires for our launch, so the image keeps its full detail.
- Mixed mode: VERIFIED at :4466-4468, `use_mixed_batch()` is
  `!llama_get_memory(ctx_tgt) || !llama_get_causal_attn(ctx_tgt)`. Our chat contexts have memory
  and a causal context (Gemma's image non-causality is per-batch through mtmd, not the context
  flag), so is_mixed should be false. If it were ever true, the cap would be n_ubatch/2 = 512 with a
  1024 floor, and 560 would be trimmed again. Please confirm after the merge: run a 12B load with
  the mmproj and check that no "cap image_max_tokens" warning appears in the server log.
- Recommendation for the binding/app: **rely on the floor for detail, and keep the cap as the
  backstop.** Do not drop the app floor because of this commit, since the cap trades detail
  silently.
- API break, VERIFIED: 552f18f91 changes `mtmd_get_memory_usage` to return
  `struct mtmd_memory_usage` (worktree mtmd.h:458). At fork HEAD the only consumer of the old
  `std::map` return is server-context.cpp:1052 (`git grep` over tools/ and common/), and that is the
  conflicted file, so the theirs side brings the new call. Check that nothing else in the binding
  or the phone side calls it.
- Our comments cite `llama-context.cpp:1804`. Upstream has it at 1803. I will fix the line
  reference on the app side; there is no need to touch the fork.

## 2. tools/server/server-context.cpp: the 5 conflict hunks (2606-3059)

The markers are VERIFIED at 2606/2639/2676/2750/2810. Both sides bring the same feature (slot
save/restore with checkpoints, upstream #26004): ours via 51b9e6a7f, upstream as 033df86b6.

- H1 constants (2606-2630): same magic and version. Ours adds the MAX_RECORDS/MAX_BUFFER/MAX_TOTAL
  limits. **Keep ours.**
- H2 ckpt_read_buf (2639-2658): ours has the budget-checked signature, and our callers use it.
  **Keep ours.**
- H3 temp file and save (2676-2734): keep ours (exclusive temp file, size-checked, throws), but
  **open the stream with `std::filesystem::u8path(filepath)`** as theirs does (VERIFIED theirs :2729).
  This matters on Windows with non-ASCII user folders, such as the Surface profile path.
- H4 close and load start (2750-2805): keep our size check, and **use u8path for the load
  ifstream** too (theirs :2799).
- H5 loader body (2810-3059): keep our strict loader and the identity trailer. **Port two upstream
  checks that ours lacks** (VERIFIED: neither appears in our side 2810-3011):
  1. `if (cur.data_tgt.empty())` (theirs :3034): refuse the file. In our style that means throwing
     "malformed".
  2. Draft test-load (theirs :3045, `checkpoints.back().load_dft(ctx_dft, slot.id,
     LLAMA_STATE_SEQ_FLAGS_PARTIAL_ONLY)`): if it fails, drop `data_dft` with a warning. Without
     it, a later restore reaches `GGML_ASSERT(ckpt.load_dft(...))` (worktree :3805/:4847) and
     aborts the server. This matters for the desktop, because Gemma MTP is on in the alpha.

## 3. Other upstream commits that matter to the desktop (from the Explorer's list; titles not re-read)

- TAKE, vision/server: 1537a0a8b "fix laya abort by limiting n_batch to n_ubatch". Check that it
  does not change how our batch/ubatch pair is clamped; the app sends batch >= ubatch.
  8e1642198 "reject partial media truncation" changes behaviour: a prompt that would cut an image
  now errors instead of truncating. The app needs to show that error plainly. Note for us, not a
  blocker.
- TAKE, MTP/spec: 1fb7ef3e3 (probabilistic sampling for draft and MTP) and 8330e9696 (n-gram drafts
  at temp > 0). These touch the MTP path the alpha ships with Gemma, so re-measure decode with MTP
  on vs off after the merge (the app's first Turn on tunes this).
- TAKE, Gemma correctness: 43fe9c642 (k-pool scatter race on shared sequences), 1a3011cc0 and
  448147d42 (nextn flags), 5de733437 and bd4eeaa04 (tool parser rules, TranslateGemma jinja).
- TAKE, backends we ship: Metal 988190680 / 7e8324f5f / a3a1c4747, and Vulkan 4d756bc72 (AMD iGPU
  slow checkpoint read), 806eee984, 6c59c4007 (FA shmem OOB), 3c9e747f7.
- WATCH: 210791069 (KV rotation metadata in save/restore) touches the same area as our slot
  hardening, so check the file format against our identity trailer.
- Not relevant to the desktop: sycl, cuda, webgpu, openvino, musa, hip, cann, riscv, RPC, Ling
  json_schema.

## 4. Flags

All 42 long flags that kalsa-launch argv.rs renders exist as literal strings at both the base and
b11514 (the Explorer used grep, so this checks spelling, not meaning). Watch `--image-max-tokens`
and `-ub` together because of section 1.

## 5. Not covered here (left to the governor's merge)

tests/unit/test_slot_save.py (9 hunks) and the other 9 conflicted files (ggml-backend-impl.h,
repack.cpp, hexagon x2, llama-context.h, llama-ext.h, tests x3). None of them are desktop-specific,
except that repack.cpp is CPU (x86 AVX2 repack is used on the Surface/Lenovo CPU path), so give it a
build and smoke test on Windows.

## 6. Desktop checks after the merge (requested)

1. Mac: load Gemma 4 12B and the mmproj at the app's argv. There should be no "cap image_max_tokens"
   warning, and a 1920×1080 frame should not abort.
2. Mac: E4B with MTP on: decode tokens/s vs the current fork pin (±5 %).
3. Windows (Surface): a CPU-path smoke test, because of the repack.cpp conflict.
4. Slot save/restore round trip with MTP on (draft data present), plus a truncated file → refused,
   not aborted.
