# Written with AI assistance (Claude Code); reviewed by: pending (Geo lead).
"""Resumable, checksum-recorded cache for downloaded source files and API responses.

Every cached object gets a sidecar ``<file>.meta.json`` with URL, sha256, bytes
and UTC access time. Reruns read the cache and never re-download.
"""
from __future__ import annotations

import hashlib
import json
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

USER_AGENT = "egiz-geodata/0.1 (research pipeline)"


def sha256_file(path: str | Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as file:
        for chunk in iter(lambda: file.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def meta_path(path: Path) -> Path:
    return path.with_name(path.name + ".meta.json")


def write_meta(path: Path, url: str, **extra) -> dict:
    meta = {"url": url, "sha256": sha256_file(path), "bytes": path.stat().st_size, "accessed": utc_now(), **extra}
    meta_path(path).write_text(json.dumps(meta, indent=1) + "\n", encoding="utf-8")
    return meta


def read_meta(path: Path) -> dict | None:
    sidecar = meta_path(path)
    if not path.exists() or not sidecar.exists():
        return None
    meta = json.loads(sidecar.read_text(encoding="utf-8"))
    return meta if meta.get("bytes") == path.stat().st_size else None


def fetch(url: str, dest: str | Path, *, timeout: int = 60, retries: int = 8) -> dict:
    """Download ``url`` to ``dest`` atomically (``.part`` then rename); cached if a valid sidecar exists.

    A stalled transfer (no bytes for ``timeout`` s) is retried and resumed from the
    partial file with an HTTP Range request when the server supports it.
    """
    dest = Path(dest)
    cached = read_meta(dest)
    if cached:
        return {**cached, "cache_hit": True}
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_name(dest.name + ".part")
    last = None
    for attempt in range(retries):
        try:
            offset = part.stat().st_size if part.exists() else 0
            headers = {"User-Agent": USER_AGENT}
            if offset:
                headers["Range"] = f"bytes={offset}-"
            request = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(request, timeout=timeout) as response:
                resumed = offset and response.status == 206
                with part.open("ab" if resumed else "wb") as out:
                    while chunk := response.read(1 << 20):
                        out.write(chunk)
            part.replace(dest)
            return {**write_meta(dest, url), "cache_hit": False}
        except urllib.error.HTTPError as exc:
            if exc.code == 416:  # range past end: partial file already complete
                part.replace(dest)
                return {**write_meta(dest, url), "cache_hit": False}
            last = exc
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            last = exc
        time.sleep(min(30, 2 * (attempt + 1)))
    raise OSError(f"download failed after {retries} attempts (partial kept for resume): {url}: {last}")


def fetch_json(url: str, dest: str | Path, **kwargs) -> tuple[dict, dict]:
    """Cached JSON API call; returns (payload, meta). Malformed cache entries are refetched."""
    dest = Path(dest)
    meta = fetch(url, dest, **kwargs)
    try:
        return json.loads(dest.read_text(encoding="utf-8")), meta
    except json.JSONDecodeError:
        dest.unlink(missing_ok=True)
        meta_path(dest).unlink(missing_ok=True)
        meta = fetch(url, dest, **kwargs)
        return json.loads(dest.read_text(encoding="utf-8")), meta
