"""Append-only per-item journal shared by the generation eval runners.

Responsibility: crash-safe incremental results so a killed arm resumes
instead of restarting (audit H4/B3). One JSON line per item after a header
line that pins the exact item list (ids hash) — a journal from a different
holdout or limit is discarded, never mixed in.
"""

import hashlib
import json
import pathlib
import threading


def ids_hash(ids: list) -> str:
    return hashlib.sha256(",".join(ids).encode()).hexdigest()


class Journal:
    def __init__(self, path: pathlib.Path, item_ids: list):
        self._path = path
        self._lock = threading.Lock()
        self._ids_h = ids_hash(item_ids)
        self._records: dict[str, dict] = {}
        self._fh = None
        self._open()

    def _open(self) -> None:
        resumed = False
        if self._path.exists():
            try:
                resumed = self._load_existing()
            except (json.JSONDecodeError, KeyError, IndexError):
                print(f"journal: {self._path.name} is corrupt — starting over")
        # "w" truncates a discarded/foreign/corrupt file; a valid journal appends
        self._fh = open(self._path, "a" if resumed else "w", encoding="utf-8")
        if not resumed:
            self._fh.write(json.dumps({"journal_ids_hash": self._ids_h}) + "\n")
            self._fh.flush()

    def _load_existing(self) -> bool:
        lines = self._path.read_text(encoding="utf-8").splitlines()
        header = json.loads(lines[0])
        if header.get("journal_ids_hash") != self._ids_h:
            print(f"journal: {self._path.name} is from a different item list — discarding")
            return False
        for line in lines[1:]:
            if not line.strip():
                continue
            rec = json.loads(line)
            self._records[rec["id"]] = rec
        print(f"journal: resuming with {len(self._records)} done item(s) "
              f"from {self._path.name}")
        return True

    @property
    def done_ids(self) -> set:
        return set(self._records)

    def append(self, rec: dict) -> None:
        # flush per item: survives a SIGKILL'd arm (pod timeout); only a
        # machine crash could lose the OS-buffered tail, which is fine here
        with self._lock:
            self._fh.write(json.dumps(rec) + "\n")
            self._fh.flush()
        self._records[rec["id"]] = rec

    def records(self) -> list:
        return list(self._records.values())

    def close(self) -> None:
        if self._fh:
            self._fh.close()
            self._fh = None
