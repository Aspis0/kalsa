#!/usr/bin/env python3
"""Check each artifact's script_sha256 against the BLOB OF GIT, not the file
on disk.

The property, stated exactly: an artifact names its script and that script's
sha, and the sha equals the blob of that script in the LAST COMMIT THAT
WROTE THE ARTIFACT - the artifact and the script were produced together. A
later edit to the script does not falsify the older artifact (it describes
the script of its day); it means the check has to ask git, not `shasum` the
working tree. That is the difference this control exists for: comparing an
old artifact with today's file would fail for a true artifact and pass for a
regenerated one whose numbers came from somewhere else.

Three cases, and each says which one it used:
  clean tracked artifact  -> `git show <last commit that touched it>:<script>`
  modified tracked artifact (a run written, not yet committed) -> the
     working-tree script, which IS what the next commit will record
  untracked artifact      -> the working-tree script, same reason

Exit 0 when every checked artifact matches its source, 2 otherwise.
Artifacts with no `provenance.script`/`script_sha256` are SKIPPED loudly -
silently skipping a field is how a check stops being one.

Run: python3 dev/test-artifact-script-sha.py
"""

import hashlib
import json
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent


def git(*args):
    p = subprocess.run(["git", "-C", str(REPO), *args],
                       capture_output=True)
    return p.returncode, p.stdout


def repo_rel(path):
    try:
        return str(Path(path).resolve().relative_to(REPO))
    except ValueError:
        return None


def sha256_bytes(data):
    return hashlib.sha256(data).hexdigest()


def check(art_path):
    rel_art = repo_rel(art_path)
    try:
        record = json.loads(art_path.read_text())
    except Exception as e:
        return "FAIL", f"unreadable artifact: {e}"
    prov = record.get("provenance") or {}
    script, recorded = prov.get("script"), prov.get("script_sha256")
    if not (script and recorded):
        return "SKIP", "no provenance.script / script_sha256 in this artifact"
    rel_script = repo_rel(script)
    if rel_script is None:
        return "FAIL", f"script {script} is outside the repository"
    if not (REPO / rel_script).exists() and not Path(script).exists():
        return "FAIL", f"script {script} does not exist anywhere"

    rc = subprocess.run(
        ["git", "-C", str(REPO), "ls-files", "--error-unmatch", "--", rel_art],
        capture_output=True).returncode
    artifact_tracked = (rc == 0)

    if artifact_tracked:
        dirty = subprocess.run(
            ["git", "-C", str(REPO), "diff", "--quiet", "HEAD", "--", rel_art]
        ).returncode != 0
        if not dirty:
            log = subprocess.run(
                ["git", "-C", str(REPO), "log", "-1", "--format=%H", "--", rel_art],
                capture_output=True, text=True).stdout
            commit = log.strip()
            if not commit:
                return "FAIL", "tracked artifact with no commit that wrote it"
            blob_run = subprocess.run(
                ["git", "-C", str(REPO), "show", f"{commit}:{rel_script}"],
                capture_output=True)
            rc, blob = blob_run.returncode, blob_run.stdout
            if rc != 0:
                return "FAIL", (f"script {rel_script} is not in commit "
                                f"{commit[:10]} (the artifact's own commit)")
            actual = sha256_bytes(blob)
            source = f"blob at {commit[:10]} (the commit that wrote this artifact)"
        else:
            actual = sha256_bytes(Path(script).read_bytes())
            source = "working tree (the artifact itself is modified, not yet committed)"
    else:
        actual = sha256_bytes(Path(script).read_bytes())
        source = "working tree (the artifact is untracked, not yet committed)"

    if actual == recorded:
        return "ok", f"{recorded[:16]}… == {source}"
    return "FAIL", (f"recorded {recorded[:16]}… != {actual[:16]}… ({source})")


def main():
    artifacts = sorted(REPO.glob("dev/results/**/results.json"))
    failures = skipped = 0
    for art in artifacts:
        status, detail = check(art)
        print(f"[{status}] {art.relative_to(REPO)}: {detail}")
        if status == "FAIL":
            failures += 1
        elif status == "SKIP":
            skipped += 1
    print(f"artifact/script-sha: {len(artifacts)} found, {failures} failing, "
          f"{skipped} skipped (no script field)")
    sys.exit(0 if failures == 0 else 2)


if __name__ == "__main__":
    main()
