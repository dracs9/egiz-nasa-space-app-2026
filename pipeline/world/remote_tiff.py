"""Column-windowed reads of large uncompressed striped (Big)TIFF rasters over HTTP.

GDAL must fetch whole strips; the USGS Mars 2020 mosaics store one full-width row per
strip (85 600 px), so a 2 km window would transfer ~700 MB. This reader parses the
TIFF directory itself and requests only the needed byte range of each row.
It refuses compressed, tiled or multi-sample files rather than guessing.
"""
from __future__ import annotations

import struct
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import numpy as np

TYPES = {1: "B", 2: "c", 3: "H", 4: "I", 5: "II", 11: "f", 12: "d", 16: "Q", 17: "q"}
SAMPLE = {(1, 8): "u1", (1, 16): "u2", (2, 16): "i2", (3, 32): "f4", (3, 64): "f8"}


class RemoteTiffError(RuntimeError):
    """The source could not be read exactly; nothing is substituted."""


def fetch(url: str, start: int, length: int, retries: int = 4) -> bytes:
    request = urllib.request.Request(url, headers={"Range": f"bytes={start}-{start + length - 1}",
                                                   "User-Agent": "egiz-world-builder"})
    error: Exception | None = None
    for _ in range(retries):
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                data = response.read()
            if len(data) == length:
                return data
            error = RemoteTiffError(f"short read {len(data)}/{length}")
        except OSError as exc:  # network errors are retried, then reported
            error = exc
    raise RemoteTiffError(f"range read failed for {url}: {error}")


def parse_directory(read) -> dict:
    """Parse the first IFD. `read(offset, length) -> bytes`."""
    head = read(0, 16)
    order = {b"II": "<", b"MM": ">"}.get(head[:2])
    if order is None:
        raise RemoteTiffError("not a TIFF file")
    magic = struct.unpack(order + "H", head[2:4])[0]
    big = magic == 43
    if magic not in (42, 43):
        raise RemoteTiffError("unsupported TIFF magic")
    ifd = struct.unpack(order + ("Q" if big else "I"), head[8:16] if big else head[4:8])[0]
    count_size, entry_size, inline = (8, 20, 8) if big else (2, 12, 4)
    count = struct.unpack(order + ("Q" if big else "H"), read(ifd, count_size))[0]
    raw = read(ifd + count_size, count * entry_size)
    tags = {}
    for i in range(count):
        entry = raw[i * entry_size:(i + 1) * entry_size]
        tag, kind = struct.unpack(order + "HH", entry[:4])
        n = struct.unpack(order + ("Q" if big else "I"), entry[4:4 + inline])[0]
        if kind not in TYPES:
            continue
        fmt = TYPES[kind]
        size = struct.calcsize("=" + fmt) * n
        value = entry[4 + inline:]
        if size > inline:
            value = read(struct.unpack(order + ("Q" if big else "I"), value[:inline])[0], size)
        tags[tag] = struct.unpack(order + fmt * n, value[:size]) if kind != 2 else value[:size]
    one = lambda tag, default=None: tags.get(tag, (default,))[0]  # noqa: E731
    if one(259, 1) != 1 or 322 in tags or one(277, 1) != 1:  # planar config is irrelevant for one band
        raise RemoteTiffError("only uncompressed, striped, single-band TIFF is supported")
    dtype = SAMPLE.get((one(339, 1), one(258)))
    if dtype is None:
        raise RemoteTiffError("unsupported sample format")
    return {"width": one(256), "height": one(257), "rows_per_strip": one(278), "offsets": tags[273],
            "dtype": np.dtype(order + dtype), "scale": tags.get(33550), "tiepoint": tags.get(33922)}


def read_window(url: str, col: int, row: int, width: int, height: int, workers: int = 24) -> np.ndarray:
    info = parse_directory(lambda start, length: fetch(url, start, length))
    if info["rows_per_strip"] != 1:
        raise RemoteTiffError("expected one row per strip")
    if col < 0 or row < 0 or col + width > info["width"] or row + height > info["height"]:
        raise RemoteTiffError("window outside raster")
    item = info["dtype"].itemsize

    def one_row(r: int) -> np.ndarray:
        data = fetch(url, info["offsets"][r] + col * item, width * item)
        return np.frombuffer(data, info["dtype"])

    with ThreadPoolExecutor(workers) as pool:
        rows = list(pool.map(one_row, range(row, row + height)))
    return np.stack(rows)
