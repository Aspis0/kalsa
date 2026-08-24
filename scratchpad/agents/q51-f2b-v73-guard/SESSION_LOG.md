# q51 F2b SESSION_LOG

No git commits. Pinned kalsahtp not touched. Worktree only: `scratchpad/agents/q51-f2b-v73-guard/llama.cpp` @ 3f545becc.

## Build (gentle)

- Located original: `build-android-hexagon` from `upstream-hexagon/llama.cpp` (that checkout is on `judge-exp1-plain-host` / dbf3f009 — left alone). Pin 3f545be exists in that repo.
- Worktree detached 3f545be. Patch `GGML_HEXAGON_NO_BINARY` in `ggml_backend_hexagon_device_supports_op` for ADD/SUB/MUL/DIV only.
- cmake (LOW / IDLE) → `build-android-f2b`. ninja `-j 4` `ggml-hexagon` `llama-bench` (~9 min). No HTP skel rebuild.
- PC shas: `pc_shas.txt`. hexagon `57c7ca6f…`. Skel copied from original build, sha `c8f9d14a…` MATCH pin.

## Device

- 2026-08-24T14:33Z S23 75 % unplugged 25.8 °C. No llama.
- Push `/data/local/tmp/kalsahtp_f2b/` (11 files). On-device hexagon/skel/stub shas MATCH PC. Pinned `kalsahtp/llama-bench` still `5db18906…`.
- Driver pid 29351. Model sha MATCH `43379486…`.

## (a)

14:33:59Z launch pp16/tg8 -v NO_BINARY=1 HOSTBUF=1 --no-host 1.
14:34:07Z **rc=134**. proof: n_htp=294 n_exps_htp0=**42** n_binary_htp0=**0**. dspqueue_read 0x2e. NO_BINARY log line present.

STATUS `DONE a_died`. No leftover llama.

Pull 32 files → `results/htp_probe/s23_v73_olmoe_q40/f2b/`.
