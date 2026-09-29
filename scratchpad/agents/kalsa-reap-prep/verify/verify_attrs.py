#!/usr/bin/env python3
"""Assert that the pinned REAP/moep code matches the real Qwen3.6 artifacts.

Checks (each printed as PASS/FAIL, nonzero exit on any FAIL):
  1. config.json: architectures + text_config geometry the adapters assume.
  2. tensor names in tensor-shapes.json match both implementations' regexes;
     expert/router tensors exist for all 40 layers; mtp.*/visual classify.
  3. hqta1110 model_util.py carries the Qwen3_5Moe grouped entries verbatim.
  4. moep adapters.py Qwen3_5MoeAdapter keys the right model_types.
  5. transformers v5.16 modeling file defines the three class names the
     observer/prune code hooks or resolves by name.
"""

import json
import pathlib
import re
import sys

HOME = pathlib.Path.home()
META = HOME / "kalsa-models/reap-calib/qwen36-meta"
REAP = HOME / "kalsa-models/reap-src/hqta1110"
MOEP = HOME / "kalsa-models/reap-src/moep"

fails = []


def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + (f" — {detail}" if detail else ""))
    if not ok:
        fails.append(name)


def main() -> int:
    cfg = json.loads((META / "config.json").read_text())
    check("arch is Qwen3_5MoeForConditionalGeneration",
          cfg["architectures"] == ["Qwen3_5MoeForConditionalGeneration"])
    tc = cfg["text_config"]
    check("text geometry", tc["num_experts"] == 256 and tc["num_experts_per_tok"] == 8
          and tc["moe_intermediate_size"] == 512 and tc["hidden_size"] == 2048
          and tc["num_hidden_layers"] == 40 and tc["shared_expert_intermediate_size"] == 512)

    shapes = json.loads((META / "tensor-shapes.json").read_text())
    layer_re = re.compile(r"^model\.language_model\.layers\.(\d+)\.")
    layers = {int(m.group(1)) for n in shapes if (m := layer_re.match(n))}
    check("40 text layers present", layers == set(range(40)))
    for probe, want in [
        ("mlp.experts.gate_up_proj", [256, 1024, 2048]),
        ("mlp.experts.down_proj", [256, 2048, 512]),
        ("mlp.gate.weight", [256, 2048]),
    ]:
        got = shapes.get(f"model.language_model.layers.0.{probe}")
        check(f"layer0 {probe} shape {want}", got is not None and got[:-1] == want, str(got))
    check("mtp tensors present and droppable",
          any(n.startswith("mtp.") for n in shapes))
    check("vision tensors present (dropped at GGUF stage)",
          any(n.startswith("model.visual.") for n in shapes))

    mu = (REAP / "src/reap/model_util.py").read_text()
    entry = re.search(r'"Qwen3_5MoeForCausalLM": \{(.*?)\},\n', mu, re.S)
    check("hqta1110 model_util has Qwen3_5MoeForCausalLM grouped entry",
          entry is not None and '"grouped": True' in entry.group(1)
          and '"gate_proj": "gate_up_proj"' in entry.group(1))
    cond = re.search(r'"Qwen3_5MoeForConditionalGeneration": \{(.*?)\},\n', mu, re.S)
    check("hqta1110 model_util has ConditionalGeneration layers_path",
          cond is not None and '"layers_path": "model.language_model.layers"' in cond.group(1))

    ad = (MOEP / "src/moep/adapters.py").read_text()
    fused_re = re.search(r'_expert_fused_re = re\.compile\(r"([^"]+)"\)', ad)
    router_re = re.search(r'_router_re = re\.compile\(r"([^"]+)"\)', ad)
    check("moep adapter fused regex matches real expert tensors",
          fused_re is not None and all(
              re.match(fused_re.group(1).replace("(?:", "(?:"), n)
              for n in ["model.language_model.layers.0.mlp.experts.gate_up_proj"]))
    check("moep adapter router regex matches real router tensor",
          router_re is not None and re.match(
              router_re.group(1), "model.language_model.layers.0.mlp.gate.weight"))
    check("moep adapter drops mtp", '_drop_res = (re.compile(r"^mtp\\."),)' in ad)

    tf = (META / "modeling_qwen3_5_moe.py").read_text()
    for cls in ("Qwen3_5MoeExperts", "Qwen3_5MoeTopKRouter", "Qwen3_5MoeSparseMoeBlock",
                "Qwen3_5MoeForConditionalGeneration"):
        check(f"transformers v5.16 defines {cls}", f"class {cls}" in tf)
    check("transformers ignores mtp at load",
          "_keys_to_ignore_on_load_unexpected = [r\"^mtp.*\"]" in tf)

    idx = json.loads((META / "model.safetensors.index.json").read_text())
    total = sum(1 for _ in shapes.values())
    params = 0
    for s in shapes.values():
        n = 1
        for d in s[:-1]:
            n *= d
        params += n
    check("param sum equals index total_size/2",
          params == idx["metadata"]["total_size"] // 2, f"{params:,} tensors={total}")

    print(f"\n{'ALL PASS' if not fails else 'FAILURES: ' + ', '.join(fails)}")
    return 0 if not fails else 1


if __name__ == "__main__":
    sys.exit(main())
