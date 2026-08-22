#!/usr/bin/env python3
"""Materialize Mellum2 F0 language prompts + 20-task isolated-coding suite."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
LANG = ROOT / "language"
SUITE = ROOT / "suite"
TASKS = SUITE / "tasks"


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text.replace("\r\n", "\n"), encoding="utf-8")


DIFF_PREAMBLE = """You are a software-engineering assistant in a pull-request workflow.
Reply with a unified diff ONLY (--- / +++ / @@ hunks) that implements the requested change.
Do not wrap the diff in markdown fences. Do not explain. Do not add extra files.
Keep the public function name and signature unless the task asks you to rename.
"""

REVIEW_PREAMBLE = """You are a software-engineering assistant reviewing a short snippet.
Name the SINGLE most serious planted bug: exact location (function + line idea) and its nature.
Be specific (e.g. "SQL injection via f-string in get_user", not "security issue").
Reply in 1-3 sentences. No patch. No extra findings unless they are that bug.
"""

FROMDOC_PREAMBLE = """You are a software-engineering assistant in a pull-request workflow.
Implement the function described by the docstring. Reply with a unified diff ONLY
(--- / +++ / @@ hunks) against the given file. Do not wrap the diff in markdown fences.
Do not explain. Keep the function name and signature.
"""

REFACTOR_PREAMBLE = """You are a software-engineering assistant in a pull-request workflow.
Apply the requested LOCAL refactor. Reply with a unified diff ONLY (--- / +++ / @@ hunks).
Do not wrap the diff in markdown fences. Do not change behavior. Do not explain.
"""


LANGUAGE_PROMPTS = [
    # --- 15 EN ---
    {
        "id": "en_01",
        "lang": "en",
        "kind": "chat",
        "prompt": "In four short sentences, explain how a hash map works and when it is a bad choice.",
    },
    {
        "id": "en_02",
        "lang": "en",
        "kind": "chat",
        "prompt": "Plan a 48-hour weekend in Lisbon for a couple who like walking and cheap food. Bullet list only.",
    },
    {
        "id": "en_03",
        "lang": "en",
        "kind": "chat",
        "prompt": "What is the practical difference between TCP and UDP? Give one example workload for each.",
    },
    {
        "id": "en_04",
        "lang": "en",
        "kind": "chat",
        "prompt": "Write a short, polite email declining a Friday 4pm meeting because of a hard deadline. No subject line fluff.",
    },
    {
        "id": "en_05",
        "lang": "en",
        "kind": "chat",
        "prompt": "Why do lithium-ion phone batteries lose capacity over years? Explain for a non-engineer in 5 sentences.",
    },
    {
        "id": "en_06",
        "lang": "en",
        "kind": "chat",
        "prompt": "Give three concrete sleep-hygiene tips that are not 'avoid caffeine'. One sentence each.",
    },
    {
        "id": "en_07",
        "lang": "en",
        "kind": "chat",
        "prompt": "What is a mutex, and when do you actually need one in a multi-threaded program?",
    },
    {
        "id": "en_08",
        "lang": "en",
        "kind": "chat",
        "prompt": "Compare BFS and DFS at a high level. When would you pick BFS?",
    },
    {
        "id": "en_09",
        "lang": "en",
        "kind": "code-explain",
        "prompt": "What does this Python snippet do, and what is the sort order?\n\n```python\nsorted(rows, key=lambda x: (-x[1], x[0]))\n```",
    },
    {
        "id": "en_10",
        "lang": "en",
        "kind": "code-explain",
        "prompt": "Why is this Python condition wrong if the intent is 'return 0 when either n or m is zero'?\n\n```python\nif n or m == 0:\n    return 0\n```",
    },
    {
        "id": "en_11",
        "lang": "en",
        "kind": "code-explain",
        "prompt": "What does this JavaScript expression do?\n\n```javascript\n[...new Set(arr)]\n```",
    },
    {
        "id": "en_12",
        "lang": "en",
        "kind": "code-explain",
        "prompt": "Why is this loop wrong? What goes wrong at runtime or in the result?\n\n```python\nfor i in range(len(xs)):\n    xs.pop(i)\n```",
    },
    {
        "id": "en_13",
        "lang": "en",
        "kind": "code-explain",
        "prompt": "What does this pandas line do to a DataFrame `df` with columns user and amt?\n\n```python\ndf['user_total'] = df.groupby('user')['amt'].transform('sum')\n```",
    },
    {
        "id": "en_14",
        "lang": "en",
        "kind": "code-explain",
        "prompt": "Why is this error handling wrong if the caller assumes the file was written?\n\n```python\ntry:\n    Path(path).write_text(data)\nexcept Exception:\n    pass\nreturn True\n```",
    },
    {
        "id": "en_15",
        "lang": "en",
        "kind": "code-explain",
        "prompt": "What does this regex extract from a string like 'ada@example.com'?\n\n```python\nimport re\nre.search(r'(?<=@)[^.]+(?=\\.)', text)\n```",
    },
    # --- 10 IT ---
    {
        "id": "it_01",
        "lang": "it",
        "kind": "chat",
        "prompt": "Spiega in italiano, in due paragrafi brevi, a cosa serve un indice B-tree in un database.",
    },
    {
        "id": "it_02",
        "lang": "it",
        "kind": "chat",
        "prompt": "Consigliami in italiano una cena vegetariana per 4 persone, con lista della spesa. Niente carne o pesce.",
    },
    {
        "id": "it_03",
        "lang": "it",
        "kind": "code-explain",
        "prompt": "Cosa fa questo snippet Python? Rispondi in italiano.\n\n```python\nlista[::-1]\n```",
    },
    {
        "id": "it_04",
        "lang": "it",
        "kind": "code-explain",
        "prompt": "Perché questo if Python è sbagliato? Rispondi in italiano.\n\n```python\nif user = None:\n    return\n```",
    },
    {
        "id": "it_05",
        "lang": "it",
        "kind": "chat",
        "prompt": "In italiano, riassumi la differenza pratica tra processo e thread. Massimo 6 frasi.",
    },
    {
        "id": "it_06",
        "lang": "it",
        "kind": "code-explain",
        "prompt": "Cosa fa questa riga e qual è il bug tipico? Rispondi in italiano.\n\n```python\nd = dict.fromkeys(['a', 'b'], [])\nd['a'].append(1)\n```",
    },
    {
        "id": "it_07",
        "lang": "it",
        "kind": "code-explain",
        "prompt": "Perché questa query è pericolosa? Rispondi in italiano.\n\n```python\ncur.execute(\"SELECT * FROM users WHERE id = '\" + user_id + \"'\")\n```",
    },
    {
        "id": "it_08",
        "lang": "it",
        "kind": "chat",
        "prompt": "Scrivi in italiano un messaggio Slack breve per slittare una deadline di due giorni, tono professionale.",
    },
    {
        "id": "it_09",
        "lang": "it",
        "kind": "code-explain",
        "prompt": "Cosa fa il decorator `@functools.lru_cache` in Python? Rispondi in italiano, 4 frasi.",
    },
    {
        "id": "it_10",
        "lang": "it",
        "kind": "code-explain",
        "prompt": "Perché questo loop è sbagliato? Rispondi in italiano.\n\n```python\nfor k in d:\n    del d[k]\n```",
    },
    # --- 5 ES/FR mixed ---
    {
        "id": "es_01",
        "lang": "es",
        "kind": "code-explain",
        "prompt": "¿Qué hace este snippet JavaScript? Responde en español.\n\n```javascript\narr.filter(x => x)\n```",
    },
    {
        "id": "fr_01",
        "lang": "fr",
        "kind": "code-explain",
        "prompt": "Pourquoi ce code C / JavaScript est faux si l'intention est une comparaison ? Réponds en français.\n\n```c\nif (a = b) {\n    return 1;\n}\n```",
    },
    {
        "id": "es_02",
        "lang": "es",
        "kind": "chat",
        "prompt": "Explícame en español, en cinco frases, qué es una API REST y en qué se diferencia de SOAP.",
    },
    {
        "id": "fr_02",
        "lang": "fr",
        "kind": "code-explain",
        "prompt": "Que fait `list(zip(*matrix))` en Python si `matrix` est une liste de listes ? Réponds en français.",
    },
    {
        "id": "es_03",
        "lang": "es",
        "kind": "code-explain",
        "prompt": "¿Por qué está mal esto en Python async? Responde en español.\n\n```python\nawait time.sleep(1)\n```",
    },
]


# ---------------------------------------------------------------------------
# 20 isolated-coding tasks
# ---------------------------------------------------------------------------

def task_01():
    src = '''def last_n(xs, n):
    """Return the last n items of xs. If n == 0, return an empty list."""
    return xs[-n:]
'''
    test = '''from last_n import last_n

def test_basic():
    assert last_n([1, 2, 3, 4], 2) == [3, 4]

def test_all():
    assert last_n([1, 2, 3], 3) == [1, 2, 3]

def test_zero():
    assert last_n([1, 2, 3], 0) == []

def test_empty_src():
    assert last_n([], 0) == []
'''
    prompt = (
        DIFF_PREAMBLE
        + "\n## Task\nFix last_n so n==0 returns [] (xs[-0:] currently returns the whole list).\n"
        + "\n## File: last_n.py\n```python\n"
        + src
        + "```\n\n## Tests that must pass\n```python\n"
        + test
        + "```\n"
    )
    return {
        "id": "01_last_n",
        "family": "bugfix",
        "lang": "python",
        "files": {"last_n.py": src, "test_last_n.py": test, "prompt.txt": prompt},
        "entry": "last_n.py",
        "pytest": "test_last_n.py",
    }


def task_02():
    src = '''def collect(item, bucket=[]):
    """Append item to bucket and return bucket. A missing bucket starts empty and is not shared."""
    bucket.append(item)
    return bucket
'''
    test = '''from collect import collect

def test_fresh_calls_are_independent():
    a = collect(1)
    b = collect(2)
    assert a == [1]
    assert b == [2]

def test_explicit_bucket():
    acc = [0]
    assert collect(1, acc) is acc
    assert acc == [0, 1]
'''
    prompt = (
        DIFF_PREAMBLE
        + "\n## Task\nFix the mutable-default bug in collect. Separate calls without a bucket must not share state.\n"
        + "\n## File: collect.py\n```python\n"
        + src
        + "```\n\n## Tests that must pass\n```python\n"
        + test
        + "```\n"
    )
    return {
        "id": "02_collect",
        "family": "bugfix",
        "lang": "python",
        "files": {"collect.py": src, "test_collect.py": test, "prompt.txt": prompt},
        "entry": "collect.py",
        "pytest": "test_collect.py",
    }


def task_03():
    src = '''def inclusive_sum(a, b):
    """Return the sum of every integer from a to b inclusive. Require a <= b."""
    return sum(range(a, b))
'''
    test = '''from inclusive_sum import inclusive_sum

def test_span():
    assert inclusive_sum(1, 4) == 10

def test_single():
    assert inclusive_sum(5, 5) == 5

def test_zero():
    assert inclusive_sum(0, 0) == 0
'''
    prompt = (
        DIFF_PREAMBLE
        + "\n## Task\ninclusive_sum must include b. range(a, b) currently drops b.\n"
        + "\n## File: inclusive_sum.py\n```python\n"
        + src
        + "```\n\n## Tests that must pass\n```python\n"
        + test
        + "```\n"
    )
    return {
        "id": "03_inclusive_sum",
        "family": "bugfix",
        "lang": "python",
        "files": {"inclusive_sum.py": src, "test_inclusive_sum.py": test, "prompt.txt": prompt},
        "entry": "inclusive_sum.py",
        "pytest": "test_inclusive_sum.py",
    }


def task_04():
    src = '''def clamp(x, lo, hi):
    """Return x limited to the closed interval [lo, hi]. Assume lo <= hi."""
    return min(lo, max(x, hi))
'''
    test = '''from clamp import clamp

def test_inside():
    assert clamp(5, 0, 10) == 5

def test_below():
    assert clamp(-3, 0, 10) == 0

def test_above():
    assert clamp(99, 0, 10) == 10

def test_edges():
    assert clamp(0, 0, 10) == 0
    assert clamp(10, 0, 10) == 10
'''
    prompt = (
        DIFF_PREAMBLE
        + "\n## Task\nclamp mixes min/max arguments. Values below lo or above hi are wrong.\n"
        + "\n## File: clamp.py\n```python\n"
        + src
        + "```\n\n## Tests that must pass\n```python\n"
        + test
        + "```\n"
    )
    return {
        "id": "04_clamp",
        "family": "bugfix",
        "lang": "python",
        "files": {"clamp.py": src, "test_clamp.py": test, "prompt.txt": prompt},
        "entry": "clamp.py",
        "pytest": "test_clamp.py",
    }


def task_05():
    src = '''def get_last(xs):
    """Return the last element of a non-empty sequence xs."""
    return xs[len(xs)]
'''
    test = '''import pytest
from get_last import get_last

def test_list():
    assert get_last([10, 20, 30]) == 30

def test_str():
    assert get_last("abc") == "c"

def test_one():
    assert get_last([7]) == 7
'''
    prompt = (
        DIFF_PREAMBLE
        + "\n## Task\nget_last indexes one past the end. Return the actual last element.\n"
        + "\n## File: get_last.py\n```python\n"
        + src
        + "```\n\n## Tests that must pass\n```python\n"
        + test
        + "```\n"
    )
    return {
        "id": "05_get_last",
        "family": "bugfix",
        "lang": "python",
        "files": {"get_last.py": src, "test_get_last.py": test, "prompt.txt": prompt},
        "entry": "get_last.py",
        "pytest": "test_get_last.py",
    }


def task_06():
    src = '''def percent(part, whole):
    """Return part as a percentage of whole (float). whole is never 0."""
    return part // whole * 100
'''
    test = '''from percent import percent

def test_half():
    assert percent(1, 2) == 50

def test_third():
    assert abs(percent(1, 3) - (100 / 3)) < 1e-9

def test_over():
    assert percent(3, 2) == 150
'''
    prompt = (
        DIFF_PREAMBLE
        + "\n## Task\npercent uses integer division, so 1/2 becomes 0 then 0. Use true division.\n"
        + "\n## File: percent.py\n```python\n"
        + src
        + "```\n\n## Tests that must pass\n```python\n"
        + test
        + "```\n"
    )
    return {
        "id": "06_percent",
        "family": "bugfix",
        "lang": "python",
        "files": {"percent.py": src, "test_percent.py": test, "prompt.txt": prompt},
        "entry": "percent.py",
        "pytest": "test_percent.py",
    }


def task_07():
    src = '''def unique_preserve_order(items):
    """Return unique items, keeping the first occurrence of each value."""
    return list(set(items))
'''
    test = '''from unique_preserve_order import unique_preserve_order

def test_order():
    assert unique_preserve_order(["b", "a", "b", "c", "a"]) == ["b", "a", "c"]

def test_numbers():
    assert unique_preserve_order([3, 1, 3, 2, 1]) == [3, 1, 2]

def test_empty():
    assert unique_preserve_order([]) == []
'''
    prompt = (
        DIFF_PREAMBLE
        + "\n## Task\nunique_preserve_order must keep first-seen order. list(set(...)) does not.\n"
        + "\n## File: unique_preserve_order.py\n```python\n"
        + src
        + "```\n\n## Tests that must pass\n```python\n"
        + test
        + "```\n"
    )
    return {
        "id": "07_unique_order",
        "family": "bugfix",
        "lang": "python",
        "files": {
            "unique_preserve_order.py": src,
            "test_unique_preserve_order.py": test,
            "prompt.txt": prompt,
        },
        "entry": "unique_preserve_order.py",
        "pytest": "test_unique_preserve_order.py",
    }


def task_08():
    src = '''def factorial(n):
    """Return n! for integer n >= 0. 0! is 1."""
    return n * factorial(n - 1)
'''
    test = '''from factorial import factorial

def test_zero():
    assert factorial(0) == 1

def test_small():
    assert factorial(1) == 1
    assert factorial(5) == 120

def test_six():
    assert factorial(6) == 720
'''
    prompt = (
        DIFF_PREAMBLE
        + "\n## Task\nfactorial has no base case and recurses forever. 0! must be 1.\n"
        + "\n## File: factorial.py\n```python\n"
        + src
        + "```\n\n## Tests that must pass\n```python\n"
        + test
        + "```\n"
    )
    return {
        "id": "08_factorial",
        "family": "bugfix",
        "lang": "python",
        "files": {"factorial.py": src, "test_factorial.py": test, "prompt.txt": prompt},
        "entry": "factorial.py",
        "pytest": "test_factorial.py",
    }


def task_09():
    src = '''def fizzbuzz(n):
    """Return a list of length n for i = 1..n:
    'FizzBuzz' if i is divisible by 15,
    'Fizz' if divisible by 3,
    'Buzz' if divisible by 5,
    otherwise the integer i itself.
    n == 0 returns [].
    """
    raise NotImplementedError
'''
    test = '''from fizzbuzz import fizzbuzz

def test_empty():
    assert fizzbuzz(0) == []

def test_fifteen():
    got = fizzbuzz(15)
    assert got[0] == 1
    assert got[2] == "Fizz"
    assert got[4] == "Buzz"
    assert got[14] == "FizzBuzz"
    assert len(got) == 15
'''
    prompt = (
        FROMDOC_PREAMBLE
        + "\n## File: fizzbuzz.py\n```python\n"
        + src
        + "```\n\n## Tests that must pass\n```python\n"
        + test
        + "```\n"
    )
    return {
        "id": "09_fizzbuzz",
        "family": "fromdoc",
        "lang": "python",
        "files": {"fizzbuzz.py": src, "test_fizzbuzz.py": test, "prompt.txt": prompt},
        "entry": "fizzbuzz.py",
        "pytest": "test_fizzbuzz.py",
    }


def task_10():
    src = '''def longest_common_prefix(strs):
    """Return the longest common prefix of the given strings.
    Empty input -> ''. A single string -> that string.
    """
    raise NotImplementedError
'''
    test = '''from longest_common_prefix import longest_common_prefix as lcp

def test_basic():
    assert lcp(["flower", "flow", "flight"]) == "fl"

def test_none():
    assert lcp(["dog", "racecar", "car"]) == ""

def test_empty():
    assert lcp([]) == ""

def test_one():
    assert lcp(["alone"]) == "alone"
'''
    prompt = (
        FROMDOC_PREAMBLE
        + "\n## File: longest_common_prefix.py\n```python\n"
        + src
        + "```\n\n## Tests that must pass\n```python\n"
        + test
        + "```\n"
    )
    return {
        "id": "10_lcp",
        "family": "fromdoc",
        "lang": "python",
        "files": {
            "longest_common_prefix.py": src,
            "test_longest_common_prefix.py": test,
            "prompt.txt": prompt,
        },
        "entry": "longest_common_prefix.py",
        "pytest": "test_longest_common_prefix.py",
    }


def task_11():
    src = '''def is_valid_parens(s):
    """Return True iff (), [], {} are balanced and correctly nested. Empty string is valid."""
    raise NotImplementedError
'''
    test = '''from is_valid_parens import is_valid_parens

def test_ok():
    assert is_valid_parens("()[]{}") is True
    assert is_valid_parens("{[]}") is True
    assert is_valid_parens("") is True

def test_bad():
    assert is_valid_parens("(]") is False
    assert is_valid_parens("([)]") is False
    assert is_valid_parens("(") is False
'''
    prompt = (
        FROMDOC_PREAMBLE
        + "\n## File: is_valid_parens.py\n```python\n"
        + src
        + "```\n\n## Tests that must pass\n```python\n"
        + test
        + "```\n"
    )
    return {
        "id": "11_parens",
        "family": "fromdoc",
        "lang": "python",
        "files": {"is_valid_parens.py": src, "test_is_valid_parens.py": test, "prompt.txt": prompt},
        "entry": "is_valid_parens.py",
        "pytest": "test_is_valid_parens.py",
    }


def task_12():
    src = '''function chunk(arr, size) {
  // Split arr into arrays of length `size`. The last chunk may be shorter.
  // If size < 1, throw RangeError.
  throw new Error("not implemented");
}

module.exports = { chunk };
'''
    test = '''const assert = require("assert");
const { chunk } = require("./chunk");

assert.deepStrictEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
assert.deepStrictEqual(chunk([], 3), []);
assert.deepStrictEqual(chunk([1], 1), [[1]]);
let threw = false;
try { chunk([1], 0); } catch (e) { threw = e instanceof RangeError; }
assert.strictEqual(threw, true);
console.log("ok");
'''
    prompt = (
        FROMDOC_PREAMBLE
        + "\n## File: chunk.js\n```javascript\n"
        + src
        + "```\n\n## Tests (node chunk.test.js must print ok)\n```javascript\n"
        + test
        + "```\n"
    )
    return {
        "id": "12_chunk_js",
        "family": "fromdoc",
        "lang": "javascript",
        "files": {"chunk.js": src, "chunk.test.js": test, "prompt.txt": prompt},
        "entry": "chunk.js",
        "node_test": "chunk.test.js",
    }


def task_13():
    src = '''function deepGet(obj, path) {
  // path is a dot-separated string (e.g. "a.b.0").
  // Return the nested value, or undefined if any segment is missing.
  // Empty path returns obj.
  throw new Error("not implemented");
}

module.exports = { deepGet };
'''
    test = '''const assert = require("assert");
const { deepGet } = require("./deepGet");

const obj = { a: { b: [{ c: 3 }, { c: 4 }] } };
assert.strictEqual(deepGet(obj, "a.b.0.c"), 3);
assert.strictEqual(deepGet(obj, "a.b.1.c"), 4);
assert.strictEqual(deepGet(obj, "a.x"), undefined);
assert.strictEqual(deepGet(obj, ""), obj);
assert.strictEqual(deepGet(null, "a"), undefined);
console.log("ok");
'''
    prompt = (
        FROMDOC_PREAMBLE
        + "\n## File: deepGet.js\n```javascript\n"
        + src
        + "```\n\n## Tests (node deepGet.test.js must print ok)\n```javascript\n"
        + test
        + "```\n"
    )
    return {
        "id": "13_deepget_js",
        "family": "fromdoc",
        "lang": "javascript",
        "files": {"deepGet.js": src, "deepGet.test.js": test, "prompt.txt": prompt},
        "entry": "deepGet.js",
        "node_test": "deepGet.test.js",
    }


def task_14():
    src = '''def do_the_thing(addr):
    """Normalize an email: strip, lower-case, reject if it has no '@'."""
    if addr is None:
        raise ValueError("missing")
    s = str(addr).strip().lower()
    if "@" not in s:
        raise ValueError("not an email")
    return s
'''
    test = '''import pytest
from email_norm import normalize_email

def test_ok():
    assert normalize_email("  Ada@Example.COM ") == "ada@example.com"

def test_bad():
    with pytest.raises(ValueError):
        normalize_email("nope")

def test_none():
    with pytest.raises(ValueError):
        normalize_email(None)
'''
    prompt = (
        REFACTOR_PREAMBLE
        + "\n## Task\nRename do_the_thing to normalize_email. Do not change behavior.\n"
        "The test file already imports normalize_email; you only edit email_norm.py.\n"
        + "\n## File: email_norm.py\n```python\n"
        + src
        + "```\n"
    )
    return {
        "id": "14_rename",
        "family": "refactor",
        "lang": "python",
        "files": {"email_norm.py": src, "test_email_norm.py": test, "prompt.txt": prompt},
        "entry": "email_norm.py",
        "pytest": "test_email_norm.py",
        "structural": {
            "must_contain": ["def normalize_email("],
            "must_not_contain": ["def do_the_thing("],
        },
    }


def task_15():
    src = '''def partition_numbers(nums):
    """Split nums into (evens, odds) preserving order."""
    evens = []
    odds = []
    for n in nums:
        if n % 2 == 0:
            evens.append(n)
        else:
            odds.append(n)
    leftover = []
    for n in nums:
        if not (n % 2 == 0):
            leftover.append(n)
    # leftover is unused; keep the parity test inlined twice on purpose
    return evens, odds
'''
    test = '''from partition import partition_numbers, is_even

def test_split():
    assert partition_numbers([1, 2, 3, 4, 5]) == ([2, 4], [1, 3, 5])

def test_empty():
    assert partition_numbers([]) == ([], [])

def test_helper():
    assert is_even(2) is True
    assert is_even(3) is False
'''
    prompt = (
        REFACTOR_PREAMBLE
        + "\n## Task\nExtract a public helper `is_even(n)` that returns True iff n is even.\n"
        "Use it inside partition_numbers instead of inlining `n % 2 == 0`. Keep behavior.\n"
        + "\n## File: partition.py\n```python\n"
        + src
        + "```\n\n## Tests that must pass\n```python\n"
        + test
        + "```\n"
    )
    return {
        "id": "15_extract",
        "family": "refactor",
        "lang": "python",
        "files": {"partition.py": src, "test_partition.py": test, "prompt.txt": prompt},
        "entry": "partition.py",
        "pytest": "test_partition.py",
        "structural": {"must_contain": ["def is_even("]},
    }


def task_16():
    src = '''def access_level(user):
    """Return 'admin', 'user', or 'guest'."""
    if user is not None:
        if "role" in user:
            if user["role"] == "admin":
                if user.get("active", True):
                    return "admin"
                else:
                    return "guest"
            else:
                if user.get("active", True):
                    return "user"
                else:
                    return "guest"
        else:
            return "guest"
    else:
        return "guest"
'''
    test = '''from access import access_level

def test_admin():
    assert access_level({"role": "admin", "active": True}) == "admin"

def test_inactive_admin():
    assert access_level({"role": "admin", "active": False}) == "guest"

def test_user():
    assert access_level({"role": "member"}) == "user"

def test_guest():
    assert access_level(None) == "guest"
    assert access_level({}) == "guest"
'''
    prompt = (
        REFACTOR_PREAMBLE
        + "\n## Task\nSimplify access_level with early returns. No nested if/else pyramid.\n"
        "Keep the exact behavior. File: access.py\n"
        + "\n## File: access.py\n```python\n"
        + src
        + "```\n\n## Tests that must pass\n```python\n"
        + test
        + "```\n"
    )
    return {
        "id": "16_simplify",
        "family": "refactor",
        "lang": "python",
        "files": {"access.py": src, "test_access.py": test, "prompt.txt": prompt},
        "entry": "access.py",
        "pytest": "test_access.py",
        "structural": {"max_indent_spaces": 8},
    }


def task_17():
    src = '''def positives(nums):
    """Return the positive numbers from nums, same order."""
    out = []
    for n in nums:
        if n > 0:
            out.append(n)
    return out
'''
    test = '''from positives import positives

def test_mix():
    assert positives([-2, 0, 3, 4, -1]) == [3, 4]

def test_empty():
    assert positives([]) == []
'''
    prompt = (
        REFACTOR_PREAMBLE
        + "\n## Task\nRewrite positives as a single list comprehension (no .append loop).\n"
        "Keep behavior. File: positives.py\n"
        + "\n## File: positives.py\n```python\n"
        + src
        + "```\n\n## Tests that must pass\n```python\n"
        + test
        + "```\n"
    )
    return {
        "id": "17_comprehension",
        "family": "refactor",
        "lang": "python",
        "files": {"positives.py": src, "test_positives.py": test, "prompt.txt": prompt},
        "entry": "positives.py",
        "pytest": "test_positives.py",
        "structural": {"must_contain": ["["], "must_not_contain": [".append("]},
    }


def task_18():
    src = '''import sqlite3

def get_user(conn: sqlite3.Connection, user_id: str):
    # Look up a user by id and return the first matching row, or None.
    cur = conn.cursor()
    cur.execute(f"SELECT id, name FROM users WHERE id = '{user_id}'")
    return cur.fetchone()
'''
    prompt = (
        REVIEW_PREAMBLE
        + "\n## File: users.py\n```python\n"
        + src
        + "```\n"
    )
    return {
        "id": "18_review_sql",
        "family": "review",
        "lang": "python",
        "files": {"users.py": src, "prompt.txt": prompt},
        "entry": "users.py",
        "review_needles": [
            "sql injection",
            "injection",
            "f-string",
            "formatted",
            "concatenat",
            "parameter",
            "placeholder",
            "unsanitiz",
        ],
        "review_strict_any": ["inject", "f-string", "format string", "interpolat"],
    }


def task_19():
    src = '''def binary_search(xs, target):
    """xs is sorted ascending. Return the index of target, or -1."""
    lo = 0
    hi = len(xs)  # planted: should be len(xs) - 1
    while lo <= hi:
        mid = (lo + hi) // 2
        if xs[mid] == target:
            return mid
        if xs[mid] < target:
            lo = mid + 1
        else:
            hi = mid - 1
    return -1
'''
    prompt = (
        REVIEW_PREAMBLE
        + "\n## File: bsearch.py\n```python\n"
        + src
        + "```\n"
    )
    return {
        "id": "19_review_bsearch",
        "family": "review",
        "lang": "python",
        "files": {"bsearch.py": src, "prompt.txt": prompt},
        "entry": "bsearch.py",
        "review_needles": [
            "off-by-one",
            "off by one",
            "len(xs)",
            "len(xs) - 1",
            "hi =",
            "upper bound",
            "indexerror",
            "out of range",
            "out-of-range",
            "last index",
        ],
        "review_strict_any": [
            "off-by-one",
            "off by one",
            "len(xs)",
            "hi = len",
            "indexerror",
            "out of range",
            "out-of-range",
            "high bound",
            "upper bound",
        ],
    }


def task_20():
    src = '''def is_ready(status):
    """Return True if the worker status string is the literal 'ready'."""
    if status is "ready":
        return True
    return False
'''
    prompt = (
        REVIEW_PREAMBLE
        + "\n## File: ready.py\n```python\n"
        + src
        + "```\n"
    )
    return {
        "id": "20_review_is",
        "family": "review",
        "lang": "python",
        "files": {"ready.py": src, "prompt.txt": prompt},
        "entry": "ready.py",
        "review_needles": [
            "identity",
            "intern",
            '`is`',
            " is ",
            "use ==",
            "== instead",
            "should use ==",
            "compares identity",
        ],
        "review_strict_any": [
            "identity",
            "intern",
            "use ==",
            "== instead",
            "should be ==",
            "compares identity",
            "`is`",
            'is "ready"',
            "is 'ready'",
            "operator is",
            "identity comparison",
        ],
    }


BUILDERS = [
    task_01, task_02, task_03, task_04, task_05, task_06, task_07, task_08,
    task_09, task_10, task_11, task_12, task_13, task_14, task_15, task_16,
    task_17, task_18, task_19, task_20,
]


def main() -> None:
    write(LANG / "prompts.json", json.dumps(LANGUAGE_PROMPTS, indent=2) + "\n")
    manifest = []
    for builder in BUILDERS:
        spec = builder()
        tdir = TASKS / spec["id"]
        files = spec.pop("files")
        for name, body in files.items():
            write(tdir / name, body)
        meta = {k: v for k, v in spec.items() if k != "files"}
        meta["dir"] = str(tdir.relative_to(ROOT)).replace("\\", "/")
        write(tdir / "task.json", json.dumps(meta, indent=2) + "\n")
        manifest.append(meta)
    write(SUITE / "tasks.json", json.dumps(manifest, indent=2) + "\n")
    print(f"wrote {len(LANGUAGE_PROMPTS)} language prompts")
    print(f"wrote {len(manifest)} suite tasks under {TASKS}")


if __name__ == "__main__":
    main()
