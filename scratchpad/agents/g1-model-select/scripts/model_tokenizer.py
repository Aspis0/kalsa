import re
import subprocess
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TOKENIZER = Path("/Users/marco/kalsa-mac/build-kalsallama-67c73d26c/bin/llama-tokenize")
MODELS = {
    "LFM": Path("/Users/marco/kalsa-qdc/models/LFM2.5-2.6B-QAD-Q4_0.gguf"),
    "MiniCPM5": Path("/Users/marco/kalsa-qdc/models/MiniCPM5-2B-Q4_K_M.gguf"),
}
COUNTS = {}


def count_tokens(model, text):
    key = (model, text)
    if key in COUNTS:
        return COUNTS[key]
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", delete=False) as handle:
        handle.write(text)
        prompt = handle.name
    try:
        result = subprocess.run(
            [str(TOKENIZER), "-m", str(MODELS[model]), "-f", prompt, "--ids", "--show-count", "--log-disable", "--no-escape"],
            text=True, capture_output=True, check=True,
        )
        match = re.search(r"Total number of tokens:\s*(\d+)", result.stdout)
        if not match:
            raise RuntimeError("llama-tokenize returned no token count")
        value = int(match.group(1))
    finally:
        Path(prompt).unlink(missing_ok=True)
    COUNTS[key] = value
    return value
