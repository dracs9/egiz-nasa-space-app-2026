"""Binary codecs shared with web/src/world/core/codec.ts.

EGT1 terrain tile / EGR1 raster layer layout (little endian), then gzip (mtime=0):
  magic   4 bytes  b"EGT1" (elevation, uint16 quantized) or b"EGR1" (uint8 classes)
  width   uint16
  height  uint16
  offset  float64  value = offset + q * scale
  scale   float64
  payload EGT1: delta-coded uint16, split into low-byte plane then high-byte plane
          EGR1: raw uint8
Quantized value 65535 (EGT1) / 255 (EGR1) is reserved for "no data".
"""
from __future__ import annotations

import gzip
import struct

import numpy as np

NODATA16 = 65535
NODATA8 = 255
HEADER = struct.Struct("<4sHHdd")


def _gzip(raw: bytes) -> bytes:
    return gzip.compress(raw, compresslevel=9, mtime=0)


def quantize_scale(values: np.ndarray, finest: float = 0.01) -> tuple[float, float]:
    finite = values[np.isfinite(values)]
    if not finite.size:
        raise ValueError("cannot quantize an all-NaN array")
    lo, hi = float(finite.min()), float(finite.max())
    # Round the step up to a multiple of `finest` so 65533 levels span the range, then snap the
    # offset to a multiple of the step: equal heights then decode identically in every tile that
    # shares the step, which makes shared seam posts bit-identical across neighbouring tiles.
    scale = max(finest, float(np.ceil((hi - lo) / 65533 / finest)) * finest)
    k = int(round(1 / scale)) if abs(1 / scale - round(1 / scale)) < 1e-9 else None
    offset = (np.floor(lo * k) / k) if k else float(np.floor(lo / scale) * scale)
    return float(offset), scale


def encode_elevation(z: np.ndarray, finest: float = 0.01) -> tuple[bytes, float, float]:
    z = np.asarray(z, dtype=np.float64)
    if z.ndim != 2:
        raise ValueError("elevation array must be 2-D")
    h, w = z.shape
    offset, scale = quantize_scale(z, finest)
    q = np.where(np.isfinite(z), np.round((np.nan_to_num(z, nan=offset) - offset) / scale),
                 NODATA16).astype(np.int64)
    q[q > NODATA16 - 1] = NODATA16 - 1
    q[~np.isfinite(z)] = NODATA16
    flat = q.astype(np.uint16).ravel().astype(np.int64)
    delta = np.empty_like(flat)
    delta[0] = flat[0]
    delta[1:] = flat[1:] - flat[:-1]
    # Row starts predict from the first sample of the previous row.
    rows = np.arange(1, h) * w
    delta[rows] = flat[rows] - flat[rows - w]
    d16 = (delta % 65536).astype(np.uint16)
    payload = (d16 & 0xFF).astype(np.uint8).tobytes() + (d16 >> 8).astype(np.uint8).tobytes()
    raw = HEADER.pack(b"EGT1", w, h, offset, scale) + payload
    return _gzip(raw), offset, scale


def decode_elevation(blob: bytes) -> np.ndarray:
    raw = gzip.decompress(blob)
    magic, w, h, offset, scale = HEADER.unpack_from(raw)
    if magic != b"EGT1":
        raise ValueError("not an EGT1 tile")
    n = w * h
    body = np.frombuffer(raw, dtype=np.uint8, offset=HEADER.size, count=2 * n).astype(np.uint16)
    d = (body[:n] | (body[n:] << 8)).astype(np.int64)
    q = np.empty(n, dtype=np.int64)
    for r in range(h):
        start = r * w
        q[start] = (d[start] + (q[start - w] if r else 0)) % 65536
        q[start + 1:start + w] = (q[start] + np.cumsum(d[start + 1:start + w])) % 65536
    q = q.reshape(h, w)
    out = offset + q.astype(np.float64) * scale
    out[q == NODATA16] = np.nan
    return out


def encode_classes(c: np.ndarray) -> bytes:
    c = np.asarray(c)
    if c.ndim != 2:
        raise ValueError("class raster must be 2-D")
    h, w = c.shape
    q = np.where(c < 0, NODATA8, c).astype(np.uint8)
    return _gzip(HEADER.pack(b"EGR1", w, h, 0.0, 1.0) + q.tobytes())


def decode_classes(blob: bytes) -> np.ndarray:
    raw = gzip.decompress(blob)
    magic, w, h, _, _ = HEADER.unpack_from(raw)
    if magic != b"EGR1":
        raise ValueError("not an EGR1 raster")
    return np.frombuffer(raw, dtype=np.uint8, offset=HEADER.size, count=w * h).reshape(h, w)
