"""Scan source files without printing secret values. AI assistance: Codex; review pending."""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    patterns = [re.compile(pattern) for pattern in [
        r"AIza[0-9A-Za-z_-]{30,}", r"gh[pousr]_[A-Za-z0-9]{30,}",
        r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----",
        r'"private_key"\s*:\s*"[^"\s]{20,}',
    ]]
    output = subprocess.run(["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
                            cwd=ROOT, capture_output=True, check=True).stdout
    failures = []
    for raw in set(output.split(b"\0")):
        if not raw:
            continue
        path = ROOT / raw.decode()
        if not path.is_file() or path.stat().st_size > 5_000_000:
            continue
        try:
            content = path.read_text()
        except (UnicodeDecodeError, OSError):
            continue
        if any(pattern.search(content) for pattern in patterns):
            failures.append(str(path.relative_to(ROOT)))
    if failures:
        print("Possible secrets in files (values suppressed):\n" + "\n".join(sorted(failures)))
        return 1
    print("OK secret-pattern scan (values suppressed)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
