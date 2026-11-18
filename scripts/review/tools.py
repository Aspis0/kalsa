"""Pinned external tool details and a verified OSV-Scanner download."""

from __future__ import annotations

import hashlib
import os
import urllib.request
from pathlib import Path

OSV_VERSION = "v2.7.1"
OSV_SHA256 = "b22c02877a811c8f78956e8643efa554932b7378f590d13f8e97d4e9448a29f3"
OSV_URL = (
    "https://github.com/google/osv-scanner/releases/download/v2.7.1/osv-scanner_darwin_arm64"
)
SEMGREP_VERSION = "1.186.0"
TOOL_CACHE = Path(os.environ.get("KALSA_REVIEW_TOOLS", Path.home() / ".cache/kalsa-review"))


def osv_binary() -> Path:
    path = TOOL_CACHE / f"osv-scanner-{OSV_VERSION}"
    if path.is_file() and hashlib.sha256(path.read_bytes()).hexdigest() == OSV_SHA256:
        return path
    TOOL_CACHE.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(OSV_URL, headers={"User-Agent": "kalsa-review"})
    with urllib.request.urlopen(request, timeout=300) as response:
        payload = response.read()
    if hashlib.sha256(payload).hexdigest() != OSV_SHA256:
        raise RuntimeError("the downloaded OSV-Scanner digest does not match the pin")
    path.write_bytes(payload)
    path.chmod(0o755)
    return path
