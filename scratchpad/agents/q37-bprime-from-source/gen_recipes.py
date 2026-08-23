#!/usr/bin/env python3
"""Generate llama-quantize --tensor-type-file recipes for q37 B′.

Control = KEXP-style (experts Q2_K+Q3_K, trunk Q5_K/Q6_K as in the
model's existing recipe). Variants = same experts + F32, trunk retargeted
to q8_0 / iq4_nl / q4_0.

Trunk = every non-expert, non-F32 weight: attn, token_embd, output,
and (LFM) shortconv in/out + leading dense FFN.
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(r"C:\Users\gualt\Desktop\Kalsa\moe-experiments")
HERE = ROOT / "scratchpad" / "agents" / "q37-bprime-from-source"
RECIPES = HERE / "recipes"
TRUNK_TAGS = ("control", "q8_0", "iq4_nl", "q4_0")
TRUNK_TYPE = {
    "control": None,  # keep recipe defaults
    "q8_0": "q8_0",
    "iq4_nl": "iq4_nl",
    "q4_0": "q4_0",
}
EXPERT_GATE_UP = "q2_k"
EXPERT_DOWN = "q3_k"


def is_expert(name: str) -> bool:
    n = name.lower()
    return any(s in n for s in ("ffn_gate_exps", "ffn_up_exps", "ffn_down_exps"))


def is_f32_line(typ: str) -> bool:
    return typ.strip().lower() == "f32"


def expert_type(name: str) -> str:
    n = name.lower()
    if "ffn_down_exps" in n:
        return EXPERT_DOWN
    return EXPERT_GATE_UP


def parse_recipe(text: str) -> list[tuple[str, str]]:
    rows = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            raise ValueError(f"bad recipe line: {raw!r}")
        name, typ = line.split("=", 1)
        rows.append((name.strip(), typ.strip().lower()))
    return rows


def render(rows: list[tuple[str, str]]) -> str:
    return "\n".join(f"{n}={t}" for n, t in rows) + "\n"


def retarget(rows: list[tuple[str, str]], trunk_type: str | None) -> list[tuple[str, str]]:
    out = []
    for name, typ in rows:
        if is_expert(name):
            out.append((name, expert_type(name)))
        elif is_f32_line(typ):
            out.append((name, "f32"))
        elif trunk_type is None:
            out.append((name, typ))
        else:
            out.append((name, trunk_type))
    return out


def from_existing(src: Path, dest_dir: Path) -> None:
    dest_dir.mkdir(parents=True, exist_ok=True)
    rows = parse_recipe(src.read_text(encoding="utf-8"))
    for tag in TRUNK_TAGS:
        body = render(retarget(rows, TRUNK_TYPE[tag]))
        (dest_dir / f"{tag}.txt").write_text(body, encoding="utf-8")


def from_olmoe_dump(dump_txt: Path, dest_dir: Path) -> None:
    """Build a KEXP-style recipe from the on-disk Q4_K_M tensor names.

    Tensor names are architecture-stable across quants of the same model.
    """
    dest_dir.mkdir(parents=True, exist_ok=True)
    names = []
    for line in dump_txt.read_text(encoding="utf-8").splitlines():
        if "\t" not in line or line.startswith("name") or line.startswith("file="):
            continue
        parts = line.split("\t")
        if len(parts) < 2:
            continue
        names.append(parts[0])
    # also keep the regex for missing output.weight on some exports
    rows: list[tuple[str, str]] = [("^output\\.weight$", "q5_k")]
    seen = set()
    for name in names:
        if name in seen:
            continue
        seen.add(name)
        if name.endswith("_norm.weight") or name.endswith("_norm.bias"):
            rows.append((name, "f32"))
        elif "ffn_gate_inp" in name or name.endswith(".bias"):
            rows.append((name, "f32"))
        elif "ffn_down_exps" in name:
            rows.append((name, EXPERT_DOWN))
        elif "ffn_gate_exps" in name or "ffn_up_exps" in name:
            rows.append((name, EXPERT_GATE_UP))
        else:
            rows.append((name, "q5_k"))
    for tag in TRUNK_TAGS:
        body = render(retarget(rows, TRUNK_TYPE[tag]))
        (dest_dir / f"{tag}.txt").write_text(body, encoding="utf-8")


def main() -> int:
    marco_src = ROOT / "results" / "marcokexp" / "tensor_types_1c.txt"
    lfm_src = ROOT / "results" / "lfm25_kexp" / "tensor_types_lfm25.txt"
    olmoe_dump = HERE / "inventory" / "olmoe_q4km.txt"
    from_existing(marco_src, RECIPES / "marco")
    from_existing(lfm_src, RECIPES / "lfm")
    if olmoe_dump.exists():
        from_olmoe_dump(olmoe_dump, RECIPES / "olmoe")
    print("wrote", RECIPES)
    for p in sorted(RECIPES.rglob("*.txt")):
        n = sum(1 for _ in p.read_text(encoding="utf-8").splitlines() if _.strip())
        print(f"  {p.relative_to(RECIPES)} lines={n}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
