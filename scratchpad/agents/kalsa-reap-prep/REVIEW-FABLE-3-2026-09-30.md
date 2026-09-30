# Third independent review (Fable 5.1, 2026-09-30): GLM's Part A + Part B + the k2 spike

Reviewer: Paseo agent (claude-fable-5-1, high, read-only, web). Subject: lab `2a2e9807` (Part A: gate fixes),
`5ea71148` (Part B: podprobe/), engine `~/Projects/kalsallama-spike-k2` `a2f252fbd` (base `e8065c7cf`).
Everything below was read on disk or fetched by me; the cheap checks in §8 were re-run by me. No pod, no upload,
no push, no money.

## 1. General verdict: NO-GO as committed. GO WITH CHANGES after the fixes in §7/§9 (about a morning of work).

The pod as committed cannot produce a single number the owner asked for. Five independent defects, any one of which
is fatal on its own:

1. `podprobe/00_env.sh:15-16` pins `transformers==5.16.0` next to `huggingface_hub[cli]==0.34.4`; PyPI metadata for
   transformers 5.16.0 says `huggingface-hub<2.0,>=1.5.0`. pip refuses the pair, `set -e` (`00_env.sh:4`) kills the
   stage. `run_probe.sh:8` is `set -uo pipefail` (no `-e`), so the job carries on without `hf`, `torch`, or a build.
2. Even with the pin fixed, `00_env.sh:13` creates an isolated venv and `:17` runs `"$PY" -c "import torch; assert
   torch.cuda.is_available()"` — torch is never installed into it (transformers has no torch dependency; PyPI lists
   torch only under `extra == "torch"`). Exit 1 at `:18`; `20_convert.sh:22` needs torch too.
3. `eval/run_gen_eval.py:141` `hit = score_tools(raw, item, args_match)` calls a two-argument function
   (`:97` `def score_tools(reply: str, item: dict) -> bool`). Reproduced: `TypeError: score_tools() takes 2
   positional arguments but 3 were given`. Every arm's tools run dies on item 1; `30_gate.sh:6` is `set -e`, so bpb
   and bench never run either.
4. `eval/run_bpb_eval.py:33-35` runs `llama-perplexity ... -c 8192` on ONE document at a time; the fork's
   `tools/perplexity/perplexity.cpp:480-481` `if (int(tokens.size()) < 2*n_ctx) { LOG_ERR("%s: you need at least %d
   tokens ...` returns without printing `Final estimate`, and `run_bpb_eval.py:41-42` then `sys.exit("bpb: no PPL in
   output ...")`. Documents are 2,524–27,227 bytes (MANIFEST, verified) ≈ 0.6–7k tokens; the floor is 16,384 tokens.
   bpb is dead for all 275 documents of all 9 arms.
5. The launch command cannot be typed: `README.md:107` `--image runpod/pytorch:2.7.1-cuda12.8.0-cudnn9-devel-ubuntu22.04`
   does not exist on Docker Hub (tag query returns 404; the `2.7.1` name filter returns 0 tags; runpod's current
   naming is `1.4.0-rc.170-cu1290-torch271-ubuntu2204`, old naming `2.8.0-py3.11-cuda12.8.1-cudnn-devel-ubuntu22.04`).
   `README.md:109` `--container-disk 40 --volume 200` and `:111` `--terminate-after` are not flags of `runpodctl pod
   create`: the source on `runpod/runpodctl` main (`cmd/pod/create.go`) registers `--container-disk-in-gb`,
   `--volume-in-gb`, `--image`, `--gpu-id`, `--ssh`, `--ports`, `--env`, `--cloud-type`, `--wait` … and **no
   `--terminate-after` / `--stop-after`**; `createPod.go` sends no termination field; docs.runpod.io/pods/manage-pods
   offers only `"sleep 2h; runpodctl pod stop $RUNPOD_POD_ID &"` as the scheduling idiom. The plugin skill's
   golden path (`06-dev-pod.md:63`) claims a live run with `--terminate-after`; the source contradicts it. Treat the
   "hard stop" as non-existent until `runpodctl pod create --help` prints it.

Consequence for money: with 1 (or 2) in place the stages fail, each arm waits 5 min for a server that was never
built (`30_gate.sh:20-23`), `40_upload.sh:34` fails for lack of `hf`, and `run_probe.sh:72-74` deliberately keeps the
pod alive "for manual salvage". With no real terminate-after, nothing stops billing except a human.

### Does the result decide something? Only the quality half — and only after the fixes.

| arm | what it decides for the owner's goal (MoE 2–3B active, > LFM quality, > dense-4B speed, fits 16 GB) |
|---|---|
| lfm | baseline — required |
| razor19-k8 Q4_K_M | does the free 50 % prune (Apache-2.0, ~11.5 GB Q4) hold quality vs LFM and vs 4B? If it loses to LFM on IT/tools, the whole REAP/RAZOR line is dead and no $15 pod follows |
| razor19-k4 Q4_K_M | quality cost of the ONLY speed lever this base has (k 8→4, standard renorm) |
| qwen36-k4 | separates "pruning hurt" from "k=4 hurt" — the one arm that makes the two above interpretable |
| razor19-k4-k2 | whether k2 renormalisation recovers k4 (the actual product config, if any) — needs the spike branch pushed |
| qwen35-4b | the control the owner's bar is written against — **ordered 7th**, first to be skipped by the guard |
| qwen35-2b ×2 | owner addendum (8 GB class) — not the stated goal; ordered BEFORE the 4B control |
| razor19-k8 Q4_0 | phone-quant cost; cheap, fine as an extra |

What no arm decides: **speed**. `30_gate.sh:55` benches with `-ngl 99` on an L40 — a CUDA number says nothing about
a 16 GB phone or a PC CPU (Fable-2 asked for `-ngl 0` as the PC proxy). So even a perfect run answers "is the
quality there?" and leaves "is it faster than dense 4B?" to a later device session. That is still worth ≤ $10 IF the
gate actually runs; it is worth nothing as committed.

## 2. Review-2 items → status

| item (review 2) | status | evidence |
|---|---|---|
| thinking ON, n_predict ≥ 4096 | fixed | `run_gen_eval.py:54` `"chat_template_kwargs": {"enable_thinking": True},` · `:115` `default=4096` |
| single BOS | fixed by path, check decorative | `:57` `f"{server}/v1/chat/completions"`; but `30_gate.sh:30` `if grep -q "2 BOS" "$OUT/server.log"` runs BEFORE the first request (`:37`), so `notes.txt` says `count=0` for every arm regardless |
| raw outputs stored | fixed | `run_gen_eval.py:142` `results.append({"id": item["id"], "pass": int(hit), "raw": raw})` |
| post-cutoff per-document corpus, ≥ 50 docs/lang | built, unusable as instrument | 275 docs, sha256 275/275 OK (re-run), but the runner dies on every doc (§1.4) and "post-cutoff" is page-creation, not content (§3) |
| paired bootstrap CIs | fixed | `bootstrap_ci.py:26-42` paired resampling; `:60` `da[lang]["docs"]` — note the CI is over the UNWEIGHTED per-doc mean while `run_bpb_eval.py:80` reports the byte-weighted mean: two different estimands |
| tools nested-list / order-insensitive compare | fixed in the library, broken at the call | `toolcalls.py:121-152` canonical + args_match, 17 cases pass (re-run); `run_gen_eval.py:141` never reaches it (§1.3) |
| stage 10 `next(list)` | fixed | `pod/10_fetch_model.sh:43` `shards = sorted(pathlib.Path(sys.argv[1]).glob("model-00001-of-*.safetensors"))` |
| stage 05 hard 1280 | fixed | `pod/05_fetch_calib.sh:24` `s.get("n_rows", s.get("rows", 0)))` |
| stage 40 path-in-repo | fixed | `pod/40_upload.sh:56` `"$HF" upload "$HF_REPO" "$STAGE" "upload-staging" --repo-type model` · `:63` `.../tree/main/upload-staging` |
| `timeout --foreground`, watchdog group kill | fixed | `pod/run_all.sh:119` `timeout -k 120 "$timeout_s" bash "$LAB/${stage}.sh"` · `:32-34` setsid re-exec |
| stage-20 failure keeps pod alive | fixed (read, not run) | `pod/run_all.sh:94-96` terminate paths |
| `mac/30_convert.sh` `${q,,}` | fixed | `:27` `declare -a QUANTS_LC=(q4_0 q4_k_m)` |
| `calib/sources.py` `hash()` seed | fixed | `:62` `seed = int(hashlib.sha256(` |
| CPU `-ngl 0` numbers as PC proxy | NOT done | `30_gate.sh:55` `llama-bench -m "$GGUF" -ngl 99 -p 512 -n 128 -r 2` |
| dense 4B control in every table | partly | present (`run_probe.sh:50`) but after two 2B extras and skipped first under time pressure |
| absolute bars per class instead of 0.5×LFM | NOT done | `docs/EVAL-GATE.md:61` `decode ≥ 0.5 × LFM decode on the same device` |
| RAZOR k8/k4 + Qwen3.6 k4/k2 arms | done | `run_probe.sh:45-47,55` |
| resident decode on a real 16 GB device | not possible in a pod | — |

## 3. Gate validity

**Thinking.** Comparable in mechanism: the server (jinja default on, `common/common.h:639` `bool use_jinja = true;`,
reasoning format default `common/common.h:650` `COMMON_REASONING_FORMAT_DEEPSEEK`) strips reasoning for both. Qwen
via the hermes parser; LFM via the LFM2 PEG parser with `common/parsers/lfm2.cpp:46-47` `data.thinking_start_tag =
THINK_START; data.thinking_end_tags = {THINK_END};`, and the ship GGUF's own template ends with
`{{- "<|im_start|>assistant\n<think>" -}}` (read with GGUFReader from `LFM2.5-2.6B-QAD-Q4_0.gguf`, `general.name`
`LFM2.5-2.6B-QAD-Q4_0`). So `message.content` is the answer side for both. Two caveats:
- GLM's `[Start thinking] … [End thinking]` dialect (`run_gen_eval.py:45`, `docs/EVAL-GATE.md:44`, REPORT) exists
  nowhere I can find: not in the GGUF template (5,443 chars, `"Start thinking" in t → False`), not in any recorded
  output (`grep -rl "Start thinking"` over the cell and `~/kalsa-models/probe/results` hits only GLM's three files).
  Harmless code, unverified claim. REFUTED as a fact about LFM.
- 4,096 max_tokens with "unclosed reasoning = miss" penalises the more verbose thinker (Qwen3.6 on GSM8K commonly
  reasons 1–3k tokens, sometimes more). Raw outputs are stored, so report the truncation rate per arm next to the
  pass rate; without it a 5-point gap is uninterpretable.

**Tools.** Not fair yet. The holdout carries the Hermes system prompt: `tools-100.jsonl` item 0 system message ends
`For each function call return a json object with function name and arguments within <tool_call> </tool_call>
tags` — and `run_gen_eval.py:50-55` never sends a `tools` field, so the server never renders LFM's native
`List of tools:` block (`common/chat.cpp:1150-1154`). LFM is asked to imitate Qwen's dialect from a foreign prompt;
Qwen is at home. `toolcalls.py` fixes the OUTPUT side only. Fix: pass `tools` in the request (each model gets its
own rendering; `tools/server/server-common.cpp:1324-1326` then sets `parse_tool_calls` and the answer arrives in
`message.tool_calls`, which the scorer must read instead of `content`).

**bpb.** Formula `run_bpb_eval.py:74` `bpb = math.log2(ppl) * n_tok / n_bytes` is the right normalisation across
tokenizers (n_bytes is UTF-8 of the same text for every model), with two blemishes: n_tok is the HF count with
`add_special_tokens=False` while perplexity adds BOS (`perplexity.cpp:305,310`) — one token, negligible; and
llama-perplexity scores only the second half of each window, so log2(ppl) is the NLL of the better-conditioned half
applied to all bytes — a constant, model-dependent bias. Moot while §1.4 stands.

**Contamination.** "Post-cutoff by construction" is wrong. The builder filters on page CREATION
(`build_postcutoff_corpus.py:62` `rctype="new"`, `:74` `rc["timestamp"] >= AFTER`); the manifest shows every one of
the 275 pages created between `2026-09-28T15:52:40Z` and `2026-09-30T15:40:04Z` — three-day-old pages. A random
sample of titles: zh `吉普Patriot`, `福特Puma (跨界车)`, `福特Maverick (2022)`, `福特领界`; it `Smíchov`, `Lago
Kathleen`; fr `Frontière entre l'Arabie saoudite et le Soudan`; en `2025 NAIA Football National Championship`. These are
decades-old subjects whose English (or Czech, or German) articles have existed for years; a new-language page is
usually a translation. A multilingual model trained through 2026 (Qwen 3.5+ claim 2026 knowledge in their system
prompts) has seen the source text; LFM2.5 (1.2B card: mid-2024 cutoff) mostly has not. The corpus therefore measures
cross-lingual recall of Wikipedia plus recent-event knowledge, with a cutoff asymmetry that favours Qwen. It is a
better instrument than Pride and Prejudice, not a clean one. Mitigation: keep only pages whose subject has NO
sibling article in any other language at creation (`langlinks` empty), or use non-Wikipedia post-cutoff text.
Also: `run_bpb_eval.py:56-57` claims docs are "capped at ~12 KB" — the cap is 12,000 CHARS (`build_postcutoff_corpus.py:35`),
zh docs reach 27 KB.

## 4. Cost and time

Inputs: L40 48 GB community at $0.69/h (README; plausible, not re-quoted). Downloads: RAZOR-19B BF16 safetensors
≈ 38 GB, Qwen3.6 UD-Q4_K_M ≈ 21–22 GB, 4B ≈ 2.6, 2B ×2 ≈ 2.8, LFM 1.6 → ≈ 66 GB, 10–30 min. CUDA build 15–30 min.
Convert 19B → BF16 GGUF (38 GB write) + two quantisations + two load checks ≈ 40–60 min. Setup 1.3–2.0 h (GLM 1.3).
Disk peak on the volume ≈ 38 + 38 + 11.5 + 10.8 + 22 + 7 ≈ 127 GB < 200 GB — fine.

Per MoE arm, sequential requests, thinking on: gsm8k 200 items × 800–2,500 thinking tokens at ~100–130 tok/s
(single stream, MoE Q4_K_M on L40) = 25–80 min; tools 100 × ~1k = 10–15 min; bpb as designed = 275 model loads
× 15–25 s = 1.2–1.9 h (GLM's own README:88-90 admits this); bench 3 min. So 2.0–3.5 h per MoE arm (GLM 2.0–2.2),
0.5–1 h per small arm. Four MoE arms = 8–14 h. Core 12.2 h holds only at the short end of thinking; at the realistic
end the guard (`run_probe.sh:22` skip if `left < est`) skips the 4B control, then the k2 arm.

The guard does not stop spending; it only refuses to START an arm. There is no per-arm timeout in `30_gate.sh`, and
`40_upload.sh` runs once, at the end (`run_probe.sh:65`) — a hard stop at 14 h (if it existed) destroys everything
not yet uploaded. With `--terminate-after` absent (§1.5) and the in-pod terminate unverified for the pod-scoped key
(`pod/terminate_pod.sh:10-13`, GLM's own note), the honest cap is "until Marco notices".

Numbers if everything works: 12.2–14 h × $0.69 = $8.4–$9.7. As committed: $0.7–$1.5 for an hour of failures, then
open-ended.

## 5. Security / privacy

Token: file `600` in a `700` dir (`README.md:127-129`), read per stage (`run_probe.sh:12` `token_cat() { cat
"$SECRETS/hf_token" 2>/dev/null; }`, `:36-37,65` env-prefix only), asserted non-empty (`10_fetch.sh:52`,
`40_upload.sh:12`), exported not echoed (`40_upload.sh:13`). No `set -x`, no argv, no log line prints it. Privacy
gate before upload (`40_upload.sh:29-30` `if not info.get("private", False): sys.exit(f"40: REFUSING — {repo} is not
private")`), explicit path-in-repo (`:34`), tree verification (`:41-47`). Upload contents: gsm8k/tools JSON with raw
model outputs on public benchmark prompts, bpb JSON, logs; `server.log` at default verbosity carries no prompt text.
Nothing model-sized leaves; nothing goes public. Nits: `run_probe.sh:36` hands the token to `00_env.sh`, which never
needs it; the 275 Wikipedia texts are CC-BY-SA-4.0 and stay in the lab repo with attribution — fine. No leak found.

## 6. The k2 patch `a2f252fbd`

Paper (arXiv 2609.04575, "Training-Free Halving of Activated Experts in Fine-Grained MoE Models"): "activating the
top k₁ experts while normalizing by the probability mass of the top k₂ experts"; Qwen3.6-35B-A3B 8→4: −4.65 MMLU
with standard renorm, −0.35 with k₂=16. Patch, `src/llama-graph.cpp` (diff lines 51-55):
```
ggml_tensor * k2_experts = ggml_argsort_top_k(ctx0, selection_probs, (int) hparams.n_expert_used_k2); // [k2, n_tokens]
ggml_tensor * k2_weights = ggml_get_rows(ctx0, probs, k2_experts); // [1, k2, n_tokens]
k2_weights = ggml_reshape_2d(ctx0, k2_weights, hparams.n_expert_used_k2, n_tokens);
weights_sum = ggml_sum_rows(ctx0, k2_weights); // [1, n_tokens]
```
then the existing `weights / weights_sum`. `probs` is the full softmax over all experts (qwen35moe passes
`LLAMA_EXPERT_GATING_FUNC_TYPE_SOFTMAX`, `src/models/qwen35moe.cpp:508`) and `norm_w` is `true` (`:506`), so the
activated top-k₁ weights are divided by the top-k₂ mass: matches the paper's description. CONFIRMED as far as the
abstract allows (the HTML body was not readable to me; if the paper also rescales by k₁/k₂ or similar, that is not
in the patch).

Shape: `probs` is reshaped to `[1, n_expert, n_tokens]` at `llama-graph.cpp:2121` before the gather at `:2150`, the
same form the upstream `weights` gather uses at `:2123` — `ggml_get_rows`'s `a->ne[2] == b->ne[1]` assertion
(`ggml/src/ggml.c:3958`) holds. Override path: `src/llama-model.cpp` diff `:88-91` reads the key optionally and
asserts `k2 ≤ n_expert` and `k2 > n_expert_used_max()`; `--override-kv` adding a key absent from the GGUF is the
standard upstream behaviour (override consulted before the file). `hparams` is in scope in `build_moe_ffn`
(`:2089` uses `hparams.n_group_used`). Compile-plausible, uncompiled — as the commit says.

**Is the k2 arm a no-op?** No. The commit message's "NOT combined with SOFTMAX_WEIGHT gating (qwen35moe uses
SOFTMAX)" means *incompatible with* SOFTMAX_WEIGHT, which qwen35moe does not use; on qwen35moe the `norm_w` branch is
live and the divisor changes. The GGUF arch string is `qwen35moe` for the unsloth Qwen3.6 file (header bytes read:
`general.architecture … qwen35moe`, `qwen35moe.expert_used_count` = 8, `expert_count` = 256) and RAZOR converts to
the same arch (`config.json`: `Qwen3_5MoeForConditionalGeneration`, `num_experts` 128, `num_experts_per_tok` 8;
converter registers it at `conversion/qwen3vl.py:16`). So `--override-kv qwen35moe.expert_used_count=int:4` and
`qwen35moe.expert_used_k2=int:16` (`run_probe.sh:40-41`) address the right keys. PLAUSIBLE-to-CONFIRMED pending the
first compile.

## 7. Bugs that burn money and produce nothing (quoted)

1. `podprobe/00_env.sh:15-16` `"transformers==5.16.0" "huggingface_hub[cli]==0.34.4"` — unsatisfiable (PyPI: transformers
   5.16.0 requires `huggingface-hub<2.0,>=1.5.0`). CONFIRMED.
2. `podprobe/00_env.sh:13` `python3 -m venv "$ROOT/.venv-probe"` + `:17` `"$PY" -c "import torch; …"` — torch never
   installed in the venv. CONFIRMED by reading; the image's system torch is invisible to an isolated venv.
3. `eval/run_gen_eval.py:141` `hit = score_tools(raw, item, args_match)` vs `:97` `def score_tools(reply: str, item:
   dict)`. CONFIRMED (TypeError reproduced).
4. `eval/run_bpb_eval.py:35` `"-c", str(ctx)` (8192) per document vs `perplexity.cpp:480` `if (int(tokens.size()) <
   2*n_ctx)`. CONFIRMED.
5. `README.md:107,109,111` image tag / flags / terminate-after do not exist. CONFIRMED (Docker Hub 404, create.go).
6. `run_probe.sh:8` `set -uo pipefail` + `:72-74` keep-alive on upload failure + no real terminate → open-ended
   billing on any early failure. CONFIRMED by reading.
7. `30_gate.sh:13` `[ -f "$OUT/gsm8k.json" ] && { echo "30: [$TAG] already done"; exit 0; }` and `run_probe.sh:17` same
   marker: an arm whose tools/bpb/bench failed is "done" forever; a rerun after a fix skips it. CONFIRMED.
8. `30_gate.sh:30-35` double-BOS grep before any request — always `count=0`. CONFIRMED (ordering).
9. `run_probe.sh:65` single upload at the end, no per-arm timeout anywhere — a hard stop mid-arm loses all arms.
   CONFIRMED structural.

## 8. Re-run of the cheap checks

| claim | result |
|---|---|
| `eval/test_toolcalls.py` EXIT=0, 9 parse + 8 match | EXIT=0, `ALL OK`, 17 cases counted — CONFIRMED |
| containment vs calibration 0.0000 | `rows checked: 10620; max row containment: 0.0000 (none)` in 25.6 s — CONFIRMED |
| all sha256 verified | 275/275 match MANIFEST; 275 files on disk; total 1,920,977 B — CONFIRMED |
| "oldest 2026-09-28" | created min `2026-09-28T15:52:40Z`, max `2026-09-30T15:40:04Z` — CONFIRMED (and the whole corpus is 3 days old) |
| py_compile / bash -n / shellcheck EXIT=0 | not re-run; none of them would catch §1.3 (a runtime arity error) |
| RAZOR paper arXiv 2609.30465 | exists: "RAZOR: Pruning Replaceable Experts in LLMs", Song & Zheng, tests Qwen3.6-35B-A3B at 25 %/50 %, +2.12–5.59 over REAP — CONFIRMED; the paper does not mention the Nickyang checkpoints, so the checkpoint's provenance rests on the HF card alone |
| `--no-mtp` in the fork converter | `convert_hf_to_gguf.py:125` `"--no-nextn", "--no-mtp", dest="no_mtp"` — CONFIRMED |

## 9. Minimum change list before any pod

1. `00_env.sh`: `huggingface_hub[cli]>=1.5,<2` (or drop the pin), `pip install torch` matching the image's CUDA — or
   create the venv with `--system-site-packages`; keep the CUDA assert.
2. `run_gen_eval.py:141` → `score_tools(raw, item)`; run BOTH datasets with `--limit 2` against any local server
   before committing (the Mac freeze is over).
3. bpb: concatenate per language, `-c 1024` or `2048`, parse the per-chunk `[n]ppl` lines as bootstrap units (or run
   a torch teacher-forced NLL on the same GGUF via the server's `/completion` with `n_probs` if the fork exposes prompt
   logprobs — it does not, per GLM). Test on the Mac with LFM: $0.
4. README create command: real image tag, `--container-disk-in-gb 40 --volume-in-gb 200`, and replace the phantom
   `--terminate-after` with an in-pod guard started first thing: `nohup sh -c 'sleep 14h; runpodctl pod remove
   $RUNPOD_POD_ID' &` — after verifying once, cheaply, that the injected key may remove its own pod (a 1-minute CPU pod).
5. `run_probe.sh`: `timeout` per arm (`30_gate.sh` call), upload after EVERY arm, resume marker = `bench.txt`, order
   lfm → razor19-k8 → qwen35-4b → razor19-k4 → qwen36-k4 → k2 → extras.
6. Add `llama-bench -ngl 0 -t $(nproc)` per arm as the PC proxy (label it as such; community vCPUs vary).
7. Tools: send `tools` in the request and score `message.tool_calls` (fall back to content parsing).
8. Report thinking-truncation rate per arm alongside pass rate.

## Sources
PyPI `https://pypi.org/pypi/transformers/5.16.0/json` (requires_dist) · Docker Hub
`https://hub.docker.com/v2/repositories/runpod/pytorch/tags` · `https://raw.githubusercontent.com/runpod/runpodctl/main/cmd/pod/create.go`,
`createPod.go`, `pod.go` · https://docs.runpod.io/pods/manage-pods · https://arxiv.org/abs/2609.04575 ·
https://arxiv.org/abs/2609.30465 · HF `config.json` of `Nickyang/Qwen3.6-35B-A3B-RAZOR-19B-A3B-E128of256@d897617a` ·
HF byte-range header of `unsloth/Qwen3.6-35B-A3B-GGUF@a483e9e6/Qwen3.6-35B-A3B-UD-Q4_K_M.gguf` ·
https://huggingface.co/LiquidAI/LFM2.5-2.6B · https://huggingface.co/LiquidAI/LFM2.5-1.2B-Instruct (cutoff mid-2024)
