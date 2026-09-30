#!/usr/bin/env python3
"""Quick self-test for eval/toolcalls.py — the two dialects score the same.

Run: python3 eval/test_toolcalls.py  (exit 0 = all cases pass)
"""

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from toolcalls import args_match, parse_tool_calls  # noqa: E402

QWEN = 'Sure. <tool_call>{"name": "get_weather", "arguments": {"city": "Rome", "unit": "c"}}</tool_call>'
LFM = "Calling now.\n<|tool_call_start|>[get_weather(city='Rome', unit='c')]<|tool_call_end|>"
LFM_BARE = "[get_weather(city='Rome', unit='c')]"
LFM_JSON_CONST = '<|tool_call_start|>[send_email(to=\'a@b.c\', urgent=true, tries=2)]<|tool_call_end|>'
QWEN_STR_ARGS = '<tool_call>{"name": "f", "arguments": "{\\"x\\": 1}"}</tool_call>'
MULTI = ("<|tool_call_start|>[f(a=1), g(b='two, three')]<|tool_call_end|>")
BRACES_IN_STR = '<tool_call>{"name": "j", "arguments": {"code": "print({1: 2})"}}</tool_call>'


def main() -> int:
    cases = [
        ("qwen basic", QWEN, [("get_weather", {"city": "Rome", "unit": "c"})]),
        ("lfm basic", LFM, [("get_weather", {"city": "Rome", "unit": "c"})]),
        ("lfm bare (markers stripped)", LFM_BARE,
         [("get_weather", {"city": "Rome", "unit": "c"})]),
        ("lfm json constants", LFM_JSON_CONST,
         [("send_email", {"to": "a@b.c", "urgent": True, "tries": 2})]),
        ("qwen string-encoded args", QWEN_STR_ARGS, [("f", {"x": 1})]),
        ("lfm two calls, comma in string", MULTI,
         [("f", {"a": 1}), ("g", {"b": "two, three"})]),
        ("qwen braces inside string value", BRACES_IN_STR,
         [("j", {"code": "print({1: 2})"})]),
        ("no call", "The answer is 42.", []),
        ("garbage json", '<tool_call>{not json}</tool_call>', []),
    ]
    match_cases = [
        ("order-insensitive list",
         {"tags": ["b", "a"]}, {"tags": ["a", "b"]}, True),
        ("numeric string vs int", {"limit": "10"}, {"limit": 10}, True),
        ("float vs int", {"t": 1.0}, {"t": 1}, True),
        ("nested dict equal", {"o": {"x": 1, "y": "z"}},
         {"o": {"y": "z", "x": 1}}, True),
        ("missing key", {"a": 1}, {"a": 1, "b": 2}, False),
        ("wrong value", {"a": 1}, {"a": 2}, False),
        ("list length differs", {"t": [1, 2]}, {"t": [1, 2, 3]}, False),
        ("bool vs string not equal", {"u": "true"}, {"u": True}, False),
    ]
    failed = 0
    for name, reply, want in cases:
        got = parse_tool_calls(reply)
        if got != want:
            print(f"FAIL {name}:\n  got  {got}\n  want {want}")
            failed += 1
        else:
            print(f"ok   {name}")
    for name, args, want, expect in match_cases:
        got = args_match(args, want)
        if got != expect:
            print(f"FAIL {name}: args_match -> {got}, want {expect}")
            failed += 1
        else:
            print(f"ok   {name}")
    print("ALL OK" if not failed else f"{failed} FAILURES")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
