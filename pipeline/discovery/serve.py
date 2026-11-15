"""Local HTTP API for on-demand point analysis.

python -m pipeline.discovery serve          # 127.0.0.1:8767; Vite proxies /api/point here

GET /api/point?body=mars&lon=77.45&lat=18.44   -> egiz.point_analysis JSON (pipeline.discovery.point)
GET /api/point/health                          -> {"ok": true, "earth_windows": N, "alphaearth": bool}
GET /api/point/alphaearth/stability?lon=&lat=  -> year-to-year embedding stability of one Earth window
GET /api/point/alphaearth/zones?lon=&lat=&k=6  -> unsupervised zoning tiles of one Earth window

Results are cached in memory per (body, lon, lat) rounded to 0.001 deg; the DEM window
itself is cached on disk under data/raw, so a repeat request never refetches.
"""
from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from pipeline.discovery import point as P

_cache: dict[tuple, bytes] = {}
_inflight: dict[tuple, threading.Event] = {}
_guard = threading.Lock()


def _analyse_cached(body: str, lon: float, lat: float) -> bytes:
    key = (body, round(lon, 3), round(lat, 3))
    while True:
        with _guard:
            if key in _cache:
                return _cache[key]
            ev = _inflight.get(key)
            if ev is None:
                ev = _inflight[key] = threading.Event()
                owner = True
            else:
                owner = False
        if not owner:
            ev.wait()
            continue
        try:
            data = json.dumps(P.analyze(body, lon, lat), ensure_ascii=False, allow_nan=False).encode()
            with _guard:
                _cache[key] = data
            return data
        finally:
            with _guard:
                _inflight.pop(key, None)
            ev.set()


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, payload: bytes, ctype="application/json"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    def _error(self, code: int, msg: str):
        self._send(code, json.dumps({"error": msg}).encode())

    def do_GET(self):  # noqa: N802
        url = urlparse(self.path)
        if url.path == "/api/point/health":
            from pipeline.discovery.alphaearth import load_index
            ctx = P.context()
            return self._send(200, json.dumps({"ok": True, "earth_windows": len(ctx.E),
                                               "alphaearth": load_index() is not None}).encode())
        if url.path.startswith("/api/point/alphaearth/"):
            return self._alphaearth(url)
        if url.path != "/api/point":
            return self._error(404, "unknown endpoint")
        q = {k: v[0] for k, v in parse_qs(url.query).items()}
        try:
            body, lon, lat = q.get("body", ""), float(q.get("lon", "nan")), float(q.get("lat", "nan"))
        except ValueError:
            return self._error(400, "lon and lat must be numbers")
        try:
            self._send(200, _analyse_cached(body, lon, lat))
        except P.PointError as exc:
            self._error(422, str(exc))
        except Exception as exc:  # reported to the client, never hidden
            self._error(500, f"{type(exc).__name__}: {exc}")

    def _alphaearth(self, url):
        from pipeline.discovery import alphaearth as AE
        q = {k: v[0] for k, v in parse_qs(url.query).items()}
        try:
            lon, lat = float(q["lon"]), float(q["lat"])
            if not (-180 <= lon <= 180 and -90 <= lat <= 90):
                raise ValueError
        except (KeyError, ValueError):
            return self._error(400, "lon and lat (Earth, degrees) are required")
        kind = url.path.rsplit("/", 1)[-1]
        key = (kind, round(lon, 4), round(lat, 4), q.get("k"))
        if key in _cache:
            return self._send(200, _cache[key])
        try:
            if kind == "stability":
                out = AE.stability(lon, lat)
            elif kind == "zones":
                out = AE.zones(lon, lat, k=int(q.get("k", 6)))
            else:
                return self._error(404, "unknown AlphaEarth endpoint")
        except RuntimeError as exc:  # credentials / project missing
            return self._error(503, str(exc))
        except Exception as exc:
            return self._error(500, f"{type(exc).__name__}: {exc}")
        data = json.dumps(out, allow_nan=False).encode()
        if kind == "stability":  # zone tiles carry a temporary map id: never cache
            _cache[key] = data
        self._send(200, data)

    def log_message(self, fmt, *args):
        print(f"[point-api] {self.address_string()} {fmt % args}", flush=True)


def serve(port: int = 8767) -> None:
    ctx = P.context()  # build the Earth arrays before accepting requests
    print(f"[point-api] {len(ctx.E)} Earth windows loaded; listening on http://127.0.0.1:{port}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
