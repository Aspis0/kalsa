
## Binding bump to engine 23b2a44d7 (kalsa.rn 1632a4a2) - audit leftovers (deepseek e75f5d18, 2026-10-09)

- B1 (P2) One-copy Hexagon caps leak: `restore_hexagon_shared_weights` passes `{false, 0}` because the engine
  setter writes ONE cap to both `opt_mbuf_dyn` (512 MiB) and `opt_mbuf_static` (1 GiB); after a one-copy load every
  later two-copy load in the process runs with both at 832 MiB (+320 MiB dyn ceiling, more static splits; a user's
  `GGML_HEXAGON_MBUF=dyn,static,total` overridden). Fix engine-side: snapshot both caps at init/first enable and
  restore them on `{false, 0}`; then re-vendor.
- B2 (P2) `scripts/assert-kalsa-vendor.sh` never compares the vendored tree / `src/version.ts` stamp to
  `vendor/VERSIONS` (a stale 7-char stamp passes); the audit proved equality by reconstruction in /tmp only.
- B3 (P3) `scripts/kalsa-patches/` is a stale duplicate with flattened paths and no consumer.
- B4 (P3) `vendor/README.md:81` names a non-existent `scripts/build-hexagon-htp.sh` and says the QAIC files are
  gitignored (they are tracked); `vendor/README.md:41-42` + `scripts/update-llama-cpp.sh` cite a deleted
  `sync-llama-cpp.yml` that would re-vendor plain upstream over the fork pin.
- B5 (P3) `common_chat_input(std::string)` allocates a token vector per streamed parse (twice), unused by the parser.
- B6 (note for the app pin) `LLAMA_STATE_SEQ_VERSION` 3 -> 4: state files saved by the old engine are refused and
  `rn-slot-manager.cpp:613` reports a load failure, not a cold start.
