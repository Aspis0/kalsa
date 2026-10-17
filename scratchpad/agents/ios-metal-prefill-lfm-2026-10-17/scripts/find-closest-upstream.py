#!/usr/bin/env python3
"""Score an upstream llama.cpp commit by how many ggml files it shares
byte-for-byte (git blob sha) with the vendored fork the Kalsa app ships."""
import os, subprocess, sys

UP = "/tmp/llama-upstream"
FORK = os.path.expanduser("~/Projects/llama.rn-kalsa-onecopy/vendor/llama.cpp")


def sh(cmd, cwd=None, text=True):
    return subprocess.run(cmd, cwd=cwd, shell=isinstance(cmd, str),
                          capture_output=True, text=text).stdout


# fork-side file list: ggml-metal (all depths) + ggml/src top level + include/ggml*.h
files = []
for base, _, names in os.walk(os.path.join(FORK, "ggml/src/ggml-metal")):
    for n in names:
        files.append(os.path.relpath(os.path.join(base, n), FORK))
for n in os.listdir(os.path.join(FORK, "ggml/src")):
    p = os.path.join(FORK, "ggml/src", n)
    if os.path.isfile(p):
        files.append(os.path.relpath(p, FORK))
files = sorted(set(files))

# fork blob shas, one batch call (absolute paths: the fork dir is not a repo root)
proc = subprocess.run(["git", "hash-object", "--stdin-paths"],
                      input="\n".join(os.path.join(FORK, f) for f in files),
                      capture_output=True, text=True)
assert proc.returncode == 0, proc.stderr
fblob = proc.stdout.split()

def score(commit):
    inp = "\n".join(f"{commit}:{f}" for f in files)
    out = sh(["git", "cat-file", "--batch-check=%(objectname) %(rest)"], UP, )
    # need to feed stdin -> use subprocess
    p = subprocess.run(["git", "cat-file", "--batch-check=%(objectname) %(rest)"],
                       cwd=UP, input=inp, capture_output=True, text=True)
    lines = p.stdout.splitlines()
    match = miss = absent = 0
    missed = []
    for f, fb, line in zip(files, fblob, lines):
        parts = line.split(" ", 1)
        ub = parts[0] if parts else ""
        if not ub or ub == "missing" or "missing" in line:
            absent += 1
        elif ub == fb:
            match += 1
        else:
            miss += 1
            missed.append(f)
    return match, miss, absent, missed


def commit_files(commit, pathlist):
    inp = "\n".join(f"{commit}:{f}" for f in pathlist)
    p = subprocess.run(["git", "cat-file", "--batch-check=%(objectname) %(rest)"],
                       cwd=UP, input=inp, capture_output=True, text=True)
    return p.stdout.splitlines()


if __name__ == "__main__":
    for c in sys.argv[1:]:
        m, mi, ab, missed = score(c)
        date = sh(["git", "show", "-s", "--format=%ci", c], UP).strip()
        total = m + mi + ab
        print(f"{c} {date} match={m}/{total} ({100.0*m/total:.1f}%) miss={mi} absent={ab}")
        if os.environ.get("SHOW_MISSED"):
            for f in missed:
                print("    miss:", f)