#!/usr/bin/env python3
"""Parse tool calls in any format our gate models emit into (name, args).

Two dialects exist (verified from the models' own chat templates, not docs):
  Qwen   <tool_call>{"name": "f", "arguments": {...}}</tool_call>
  LFM2.5 <|tool_call_start|>[f(key='v', n=3)]<|tool_call_end|>   — a Python
         literal where strings are single-quoted (jinja %-formatted) but
         non-strings arrive via `tojson` (true/false/null), so the constants
         must be swapped outside string literals before ast can read it.
Scoring must not depend on which dialect a model speaks, so both reduce to
the same (name, args) pairs. A bare `[f(k=v)]` line is also accepted: some
runtimes strip the special markers.
"""

import ast
import json
import re

QWEN_RE = re.compile(r"<tool_call>(.*?)</tool_call>", re.S)
LFM_RE = re.compile(
    r"<\|tool_call_start\|>\s*\[(.*?)\]\s*<\|tool_call_end\|>", re.S)
BARE_RE = re.compile(r"\[\s*([A-Za-z_]\w*)\(.*?\)\s*\]", re.S)
JSON_CONSTS = {"true": "True", "false": "False", "null": "None"}


def _swap_json_consts(text: str) -> str:
    """true/false/null -> True/False/None, but never inside quotes."""
    out, quote = [], ""
    i = 0
    while i < len(text):
        ch = text[i]
        if quote:
            out.append(ch)
            if ch == quote and text[i - 1] != "\\":
                quote = ""
        elif ch in "'\"":
            quote = ch
            out.append(ch)
        else:
            for word, py in JSON_CONSTS.items():
                if text.startswith(word, i) and not text[i - 1:i].isalnum():
                    out.append(py)
                    i += len(word)
                    break
            else:
                out.append(ch)
                i += 1
            continue
        i += 1
    return "".join(out)


def _literal(node):
    return ast.literal_eval(node)


def parse_lfm_calls(body: str) -> list[tuple[str, dict]]:
    """'f(a=1), g(b='two, three')' -> [(name, {kwargs})]."""
    out = []
    for part in _split_top(body):
        try:
            tree = ast.parse(_swap_json_consts(part.strip()), mode="eval")
        except SyntaxError:
            continue
        if not isinstance(tree.body, ast.Call):
            continue
        call = tree.body
        name = call.func.id if isinstance(call.func, ast.Name) else ""
        if not name:
            continue
        args = {}
        try:
            for kw in call.keywords:
                args[kw.arg] = _literal(kw.value)
        except (ValueError, SyntaxError):
            continue
        out.append((name, args))
    return out


def parse_tool_calls(reply: str) -> list[tuple[str, dict]]:
    out = []
    # Qwen: the JSON may contain braces inside string values, so within each
    # marker-delimited block take first "{" to LAST "}", not a lazy match
    for m in QWEN_RE.finditer(reply):
        block = m.group(1)
        l, r = block.find("{"), block.rfind("}")
        if l < 0 or r <= l:
            continue
        try:
            call = json.loads(block[l:r + 1])
        except json.JSONDecodeError:
            continue
        if not isinstance(call, dict) or not isinstance(call.get("name"), str):
            continue
        args = call.get("arguments")
        if isinstance(args, str):
            try:
                args = json.loads(args)
            except json.JSONDecodeError:
                args = None
        out.append((call["name"], args if isinstance(args, dict) else {}))

    for m in LFM_RE.finditer(reply):
        out.extend(parse_lfm_calls(m.group(1)))
    if not out:  # markers stripped somewhere upstream
        for m in BARE_RE.finditer(reply):
            out.extend(parse_lfm_calls(m.group(0)[1:-1]))
    return out


def _scalar_eq(a, b) -> bool:
    """Type-lenient scalar equality: models emit 2 vs "2" vs 2.0 for the same
    value; anything else (str, bool, None) compares as its trimmed string."""
    try:
        return float(a) == float(b)
    except (TypeError, ValueError):
        return str(a).strip() == str(b).strip()


def canonical(v):
    """Order-insensitive canonical form: dict keys sorted, lists sorted by
    their canonical serialisation (schemas here never order-signify)."""
    if isinstance(v, dict):
        return {k: canonical(v[k]) for k in sorted(v)}
    if isinstance(v, (list, tuple)):
        return sorted((canonical(x) for x in v), key=repr)
    return v


def args_match(args: dict, want: dict) -> bool:
    """want ⊆ args under the canonical form (order-insensitive)."""
    if not isinstance(args, dict):
        return False
    cargs = canonical(args)
    for k, v in want.items():
        if k not in cargs:
            return False
        a, b = cargs[k], canonical(v)
        if isinstance(a, (dict, list)) != isinstance(b, (dict, list)):
            return False
        if isinstance(b, dict):
            if not args_match(a, b):
                return False
        elif isinstance(b, list):
            if len(a) != len(b) or any(not _scalar_eq(x, y)
                                       for x, y in zip(sorted(a, key=repr),
                                                       sorted(b, key=repr))):
                return False
        elif not _scalar_eq(a, b):
            return False
    return True


def _split_top(body: str) -> list[str]:
    """Split 'f(a=1), g(b=2)' on top-level commas (quote/paren aware)."""
    parts, depth, quote, cur = [], 0, "", []
    for ch in body:
        if quote:
            cur.append(ch)
            if ch == quote:
                quote = ""
        elif ch in "'\"":
            quote = ch
            cur.append(ch)
        elif ch == "(":
            depth += 1
            cur.append(ch)
        elif ch == ")":
            depth -= 1
            cur.append(ch)
        elif ch == "," and depth == 0:
            parts.append("".join(cur))
            cur = []
        else:
            cur.append(ch)
    if cur:
        parts.append("".join(cur))
    return [p for p in parts if p.strip()]
