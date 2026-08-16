import hashlib
import json
import sys
from pathlib import Path

root = Path(r"C:\Users\gualt\Desktop\Kalsa\moe-experiments")
sys.path.insert(0, str(root / "scripts"))
from selfspec_f0_lib import PROMPT_IDS, PROMPT_SHA256

paths = {
    "fact": root / "results" / "marco_phase1" / "speed_s23" / "prompts" / "p_fact.txt",
    "creative": root / "results" / "selfspec_f0" / "prompts" / "p_creative.txt",
    "longfact": root / "results" / "selfspec_f0" / "prompts" / "p_longfact.txt",
    "code": root / "results" / "selfspec_f0" / "prompts" / "p_code.txt",
}
for pid in PROMPT_IDS:
    p = paths[pid]
    h = hashlib.sha256(p.read_bytes()).hexdigest()
    gold = json.loads(
        (root / "results" / "selfspec_f0" / "streams" / f"{pid}_target.pieces.json").read_text(
            encoding="utf-8"
        )
    )
    print(pid, "exists", p.is_file(), "sha_ok", h == PROMPT_SHA256[pid], "gold_n", len(gold["pieces"]))
print("bin", (root / "build-pc" / "cli" / "bmoe-cli.exe").is_file())
print("model", (root / "models" / "Qwen3.6-35B-A3B-KEXP.gguf").stat().st_size)
