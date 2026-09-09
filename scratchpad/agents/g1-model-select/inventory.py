#!/usr/bin/env python3
"""Print compact, reproducible GGUF metadata for the G1 comparison."""

from collections import Counter
from pathlib import Path
import sys

from gguf import GGUFReader


MODEL_DIR = Path("/Users/marco/kalsa-qdc/models")
THINKING_MARKERS = (
    "<think>",
    "</think>",
    "<|thought_begin|>",
    "<|thought_end|>",
    "/think",
    "/no_think",
    "reasoning_content",
    "enable_thinking",
)
TOOL_MARKERS = (
    "<tools>",
    "</tools>",
    "<function",
    "</function>",
    "<param",
    "</param>",
    "<tool_response>",
    "</tool_response>",
    "<tool_sep>",
    "<tool_call>",
    "</tool_call>",
    "<|tool_list_start|>",
    "<|tool_list_end|>",
    "<|tool_call_start|>",
    "<|tool_call_end|>",
)
EOT_CANDIDATES = ("<|im_end|>", "</s>", "<|endoftext|>", "</|>")


def read(path):
    reader = GGUFReader(str(path), "r")
    fields = reader.fields
    metadata = {key: field.contents() for key, field in fields.items()}
    tokens = metadata.get("tokenizer.ggml.tokens", [])
    template = metadata.get("tokenizer.chat_template", "")
    return reader, metadata, tokens, template


def token_line(tokens, token_id):
    if token_id is None:
        return "missing"
    if 0 <= token_id < len(tokens):
        return f"{token_id} | {tokens[token_id]!r}"
    return f"{token_id} | <out of range>"


def literal_tokens(tokens, values):
    return [(index, token) for index, token in enumerate(tokens) if token in values]


def cell(value):
    return str(value).replace("|", "\\|").replace("\n", "<br>")


def render(path):
    reader, metadata, tokens, template = read(path)
    counts = Counter(tensor.tensor_type.name for tensor in reader.tensors)
    eos_id = metadata.get("tokenizer.ggml.eos_token_id")
    eot_id = metadata.get("tokenizer.ggml.eot_token_id")
    if eot_id is None:
        for candidate in EOT_CANDIDATES:
            if candidate in template:
                matches = literal_tokens(tokens, (candidate,))
                if matches:
                    eot_id = matches[0][0]
                    break
    stop_ids = []
    for token_id in (eos_id, eot_id):
        if token_id is not None and token_id not in stop_ids:
            stop_ids.append(token_id)
    markers = {
        "thinking/reasoning": [marker for marker in THINKING_MARKERS if marker in template],
        "tool-call": [marker for marker in TOOL_MARKERS if marker in template],
    }
    tokenizer_keys = (
        "tokenizer.ggml.model",
        "tokenizer.ggml.pre",
        "tokenizer.ggml.bos_token_id",
        "tokenizer.ggml.eos_token_id",
        "tokenizer.ggml.eot_token_id",
        "tokenizer.ggml.padding_token_id",
    )

    out = [f"## {path.name}", "", f"- File: {path}", f"- Tensor count: {len(reader.tensors)}", ""]
    out += ["### Tensor counts by ggml type", "", "| ggml type | tensors |", "|---|---:|"]
    out += [f"| {kind} | {counts[kind]} |" for kind in sorted(counts)]
    out += ["", "### Tokenizer and control tokens", "", "| field | value |", "|---|---|"]
    for key in tokenizer_keys:
        value = metadata.get(key, "missing")
        if key.endswith("token_id") and isinstance(value, int):
            value = token_line(tokens, value)
        out.append(f"| {key} | {cell(value)} |")
    out += ["", "#### Quoted GGUF metadata lines used for token claims", ""]
    for key in ("tokenizer.ggml.eos_token_id", "tokenizer.ggml.eot_token_id"):
        if key in metadata:
            token_id = metadata[key]
            out.append(f"> {key} = {token_id}; token[{token_id}] = {tokens[token_id]!r}")
        else:
            out.append(f"> {key} = missing")
    if eot_id is not None and "tokenizer.ggml.eot_token_id" not in metadata:
        out.append(f"> tokenizer.chat_template contains {tokens[eot_id]!r}; token[{eot_id}] = {tokens[eot_id]!r}")
    out.append("> Stop set used for inspection: " + ", ".join(f"token[{i}] {tokens[i]!r}" for i in stop_ids))
    out += ["", "### Thinking/reasoning and tool-call markers in the template", "", "| class | markers found |", "|---|---|"]
    for kind, found in markers.items():
        out.append(f"| {kind} | {cell(', '.join(repr(marker) for marker in found) or 'none')} |")
    fence = chr(96) * 3
    out += ["", "### Chat template", "", fence + "jinja", template, fence, ""]
    return "\n".join(out)


def main():
    paths = [Path(arg) for arg in sys.argv[1:]]
    if not paths:
        paths = sorted(MODEL_DIR.glob("*.gguf"))
    if not paths:
        raise SystemExit("no GGUF files")
    print("# GGUF inventory")
    print("\n".join(render(path) for path in paths))


if __name__ == "__main__":
    main()
