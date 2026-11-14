"""NASA CSPICE geometry via SpiceyPy; no analytic fallback or fabricated ephemerides.

python -m pipeline.science.spice build
python -m pipeline.science.spice serve   # Vite proxies /api/science to localhost:8766
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import threading
import urllib.request
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

SPICE_LOCK = threading.Lock()
ROOT = Path(__file__).resolve().parents[2]
KERNELS = ROOT / "data/kernels"
FILES = {
    "naif0012.tls": "lsk/naif0012.tls",
    "pck00011.tpc": "pck/pck00011.tpc",
    "de440s.bsp": "spk/planets/de440s.bsp",
    "moon_080317.tf": "fk/satellites/moon_080317.tf",
    "moon_pa_de421_1900-2050.bpc": "pck/moon_pa_de421_1900-2050.bpc",
}
BODIES = {
    "earth": ("EARTH", "IAU_EARTH", 6378.137),
    "moon": ("MOON", "MOON_ME_DE421", 1737.4),
    # DE440s contains the Mars system barycenter, not Mars center (499).
    "mars": ("MARS BARYCENTER", "IAU_MARS", 3396.190),
}
DEFAULT_EPOCH = "2026-11-14T00:00:00Z"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def kernel_manifest() -> list[dict]:
    expected = json.loads((KERNELS / "manifest.json").read_text())
    for entry in expected:
        path = KERNELS / entry["name"]
        if sha256(path) != entry["sha256"]:
            raise ValueError(f"Kernel fingerprint mismatch: {path.name}")
    if {e["name"] for e in expected} != set(FILES):
        raise ValueError("Incomplete kernel manifest")
    return expected


def geometry(site: dict, epoch: str, duration: float = 86400, step: float = 600) -> dict:
    """Geometric, body-fixed solar/Earth ENU at a zero-height site.

    Kernels, offsets and vectors are in km; exported irradiance is W/m².
    No light-time correction (NONE), terrain occultation, refraction or weather.
    """
    import numpy as np
    import spiceypy as spice

    if site.get("body") not in BODIES:
        raise ValueError("Unsupported body")
    lat, lon = float(site["lat"]), float(site["lon"])
    if not all(map(math.isfinite, [lat, lon, duration, step])):
        raise ValueError("Nonfinite geometry input")
    if not -90 <= lat <= 90 or not -180 <= lon <= 360:
        raise ValueError("Invalid planetocentric coordinates")
    if not 1 <= duration <= 86400 or not 60 <= step <= 3600:
        raise ValueError("Duration 1–86400 s; sample step 60–3600 s")
    utc = datetime.fromisoformat(epoch.replace("Z", "+00:00"))
    if utc.tzinfo is None or not 2000 <= utc.year <= 2040:
        raise ValueError("Use timezone-qualified UTC in 2000–2040")
    epoch = utc.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    manifest = kernel_manifest()
    if site["body"] != "moon":
        manifest = [entry for entry in manifest if entry["name"] in {"naif0012.tls", "pck00011.tpc", "de440s.bsp"}]
    observer, frame, radius = BODIES[site["body"]]
    phi, lam = np.deg2rad([lat, lon])
    up = np.array([np.cos(phi) * np.cos(lam), np.cos(phi) * np.sin(lam), np.sin(phi)])
    east = np.array([-np.sin(lam), np.cos(lam), 0])
    north = np.cross(up, east)
    basis = np.array([east, north, up])
    spice.kclear()
    try:
        for entry in manifest:
            spice.furnsh(str(KERNELS / entry["name"]))
        et = spice.str2et(epoch)
        # Earth source coordinates are geodetic WGS84; use its ellipsoid for the observer.
        offset = spice.georec(lam, phi, 0, 6378.137, 1 / 298.257223563) if site["body"] == "earth" else up * radius
        times = np.unique(np.append(np.arange(0, duration, step), duration))
        samples = []
        for t in times:
            sun, _ = spice.spkpos("SUN", et + t, frame, "NONE", observer)
            vector = np.array(sun) - offset
            distance = np.linalg.norm(vector)
            enu = basis @ (vector / distance)
            if site["body"] == "earth":
                earth_altitude, earth_range = None, None
            else:
                earth, _ = spice.spkpos("EARTH", et + t, frame, "NONE", observer)
                earth = np.array(earth) - offset
                earth_range = float(np.linalg.norm(earth))
                earth_altitude = math.degrees(math.asin(float(up @ earth / earth_range)))
            samples.append({
                "t": float(t), "sunEnu": enu.tolist(),
                "elevationDeg": math.degrees(math.asin(float(enu[2]))),
                "azimuthDeg": math.degrees(math.atan2(float(enu[0]), float(enu[1]))) % 360,
                "solarFluxWm2": float(1361 / (distance / spice.convrt(1, "AU", "KM")) ** 2),
                "earthElevationDeg": earth_altitude, "earthRangeKm": earth_range,
            })
        return {
            "schema": "egiz.spice_geometry", "version": "1.0.0",
            "engine": f"SpiceyPy {spice.__version__} / {spice.tkvrsn('TOOLKIT')}",
            "siteId": site["id"], "body": site["body"], "lat": lat, "lon": lon,
            "epochUtc": epoch, "frame": frame, "observer": observer,
            "aberration": "NONE", "duration": duration, "step": step,
            "kernels": manifest, "samples": samples,
            "limitations": [
                "Geometric vectors at a spherical zero-height site; no terrain shadow, refraction, weather or panel thermal model.",
                "IAU body orientation from text PCK; Earth is not a precision ITRF Earth-orientation solution.",
                "Earth observer uses zero-height WGS84 geodetic coordinates; Mars uses the documented spherical regional frame. Moon geometry uses the source DEM's MOON_ME_DE421 frame through official FK and binary PCK orientation kernels; source terrain and zero-height horizon limitations remain.",
                "Mars system barycenter approximates Mars center in DE440s; no spacecraft ephemeris is used.",
                "1361 W/m² at 1 AU is a declared solar constant; surface transmission and panel efficiency are separate assumptions.",
                "Earth elevation is geometric horizon visibility only, not a link budget or relay availability prediction.",
            ],
        }
    finally:
        spice.kclear()


def sites() -> list[dict]:
    return json.loads((ROOT / "data/pilot/mission_terrain.json").read_text())["entries"]


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        # Production app and native tools share a loopback origin; never serve the repository.
        super().__init__(*args, directory=str(ROOT / "web/dist"), **kwargs)

    def do_GET(self):
        if self.path.startswith("/api/science/dynamics/"):
            self.native_status()
        elif self.path.startswith("/api/"):
            self.send_error(404)
        else:
            super().do_GET()

    def do_DELETE(self):
        self.native_status(cancel=True)

    def native_status(self, cancel=False):
        from pipeline.dynamics.service import status
        if not self.path.startswith("/api/science/dynamics/"):
            self.send_error(404)
            return
        try:
            self.respond(status(self.path.rsplit("/", 1)[-1], cancel))
        except ValueError as error:
            self.respond({"error": str(error)}, 404)

    def respond(self, result, status=200):
        payload = json.dumps(result, allow_nan=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        try:
            self.wfile.write(payload)
        except BrokenPipeError:
            pass

    def do_POST(self):  # noqa: N802
        try:
            # Local UI or same-machine CLI only. Do not accept drive-by cross-origin jobs.
            from urllib.parse import urlparse
            origin = self.headers.get("Origin")
            if origin and urlparse(origin).hostname not in {"127.0.0.1", "localhost", "::1"}:
                self.respond({"error": "Native tools accept loopback UI origins only"}, 403)
                return
            if self.path == "/api/science/dynamics":
                from pipeline.dynamics.service import start
                size = int(self.headers.get("Content-Length", "0"))
                if not 0 < size <= 4096:
                    raise ValueError("Request must be 1–4096 bytes")
                self.respond(start(json.loads(self.rfile.read(size))), 202)
                return
            if self.path != "/api/science/geometry":
                self.send_error(404)
                return
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= 4096:
                raise ValueError("Request must be 1–4096 bytes")
            request = json.loads(self.rfile.read(size))
            site = next((s for s in sites() if s["id"] == request["siteId"]), None)
            if site is None:
                raise ValueError("Unknown measured site")
            with SPICE_LOCK:
                result = geometry(site, request["epochUtc"], request.get("duration", 86400))
            status = 200
        except (ValueError, KeyError, TypeError, OverflowError) as error:
            result, status = {"error": str(error)}, 400
        except Exception as error:
            result, status = {"error": f"SPICE unavailable: {type(error).__name__}: {error}"}, 503
        payload = json.dumps(result, allow_nan=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["build", "serve", "manifest", "fetch", "verify"])
    parser.add_argument("--epoch", default=DEFAULT_EPOCH)
    parser.add_argument("--archive", type=Path)
    args = parser.parse_args()
    if args.command == "verify":
        if args.archive is None:
            parser.error("verify requires --archive experiment.json")
        record = json.loads(args.archive.read_text())["scenario"]["solar"]
        place = next(s for s in sites() if s["id"] == record["siteId"])
        canonical = geometry(place, record["epochUtc"], record["duration"], record["step"])
        # Explanatory limitation prose is not a numerical input or ephemeris result.
        if {k: v for k, v in canonical.items() if k != "limitations"} != {k: v for k, v in record.items() if k != "limitations"}:
            raise ValueError("Archived geometry differs from actual CSPICE execution")
        print(f"Verified genuine CSPICE geometry: {record['siteId']} {record['epochUtc']}")
    elif args.command == "fetch":
        for entry in json.loads((KERNELS / "manifest.json").read_text()):
            path = KERNELS / entry["name"]
            if not path.exists() or sha256(path) != entry["sha256"]:
                temporary = path.with_suffix(".download")
                with urllib.request.urlopen(entry["url"], timeout=120) as response:
                    temporary.write_bytes(response.read())
                if sha256(temporary) != entry["sha256"]:
                    temporary.unlink()
                    raise ValueError(f"Downloaded kernel fingerprint mismatch: {path.name}")
                temporary.replace(path)
        kernel_manifest()
        print("Verified official NAIF kernels against the recorded SHA-256 manifest")
    elif args.command == "manifest":
        manifest = [{"name": name, "url": f"https://naif.jpl.nasa.gov/pub/naif/generic_kernels/{url}",
                     "sha256": sha256(KERNELS / name)} for name, url in FILES.items()]
        (KERNELS / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    elif args.command == "build":
        result = {"schema": "egiz.spice_catalog", "version": "1.0.0",
                  "entries": [geometry(site, args.epoch) for site in sites()]}
        output = ROOT / "data/pilot/spice_geometry.json"
        output.write_text(json.dumps(result, separators=(",", ":"), allow_nan=False) + "\n")
        print(f"Executed CSPICE: {len(result['entries'])} measured sites → {output}")
    else:
        server = ThreadingHTTPServer(("127.0.0.1", 8766), Handler)
        server.timeout = 30
        print("EGIZ native science service: http://127.0.0.1:8766 (loopback only)", flush=True)
        server.serve_forever()


if __name__ == "__main__":
    main()
