#!/usr/bin/env python3
"""Print the chat template embedded in a GGUF (metadata tokenizer.chat_template).

The gate reads the tool-call dialect from the model's own template rather
than from documentation: this is how the LFM2.5
<|tool_call_start|>[name(args)]<|tool_call_end|> rendering was confirmed.

Usage: show_chat_template.py <model.gguf> [substring-filter]
"""

import pathlib
import sys

import gguf


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__, file=sys.stderr)
        return 2
    reader = gguf.GGUFReader(sys.argv[1])
    field = reader.fields.get("tokenizer.chat_template")
    if field is None:
        print("no tokenizer.chat_template in this GGUF", file=sys.stderr)
        return 1
    template = bytes(field.parts[field.data[0]]).decode("utf-8", "replace")
    if len(sys.argv) > 2:
        needle = sys.argv[2]
        i = template.find(needle)
        if i < 0:
            print(f"substring {needle!r} not in template", file=sys.stderr)
            return 1
        print(template[max(0, i - 300):i + 300])
    else:
        print(template)
    return 0


if __name__ == "__main__":
    sys.exit(main())
