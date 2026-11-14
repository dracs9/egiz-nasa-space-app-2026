"""Multi-day NASA CSPICE illumination record for a world site.

Uses the same fingerprinted kernels, frames and ENU basis as
pipeline.science.spice.geometry (parity is tested), extended to a full
synodic month and to the Earth direction vector needed for line-of-sight
communication checks.
"""
from __future__ import annotations

from datetime import datetime, timezone

import numpy as np

from pipeline.science.spice import BODIES, KERNELS, kernel_manifest


def series(site: dict, epoch: str, days: float = 30.0, step: float = 3600.0) -> dict:
    import spiceypy as spice  # pyright: ignore[reportMissingImports]  # optional dependency

    if site["body"] != "moon":
        raise ValueError("world illumination series currently supports the Moon site only")
    lat, lon = float(site["lat"]), float(site["lon"])
    utc = datetime.fromisoformat(epoch.replace("Z", "+00:00")).astimezone(timezone.utc)
    epoch = utc.isoformat().replace("+00:00", "Z")
    manifest = kernel_manifest()
    observer, frame, radius = BODIES["moon"]
    phi, lam = np.deg2rad([lat, lon])
    up = np.array([np.cos(phi) * np.cos(lam), np.cos(phi) * np.sin(lam), np.sin(phi)])
    east = np.array([-np.sin(lam), np.cos(lam), 0])
    north = np.cross(up, east)
    basis = np.array([east, north, up])
    offset = up * radius
    spice.kclear()
    try:
        for entry in manifest:
            spice.furnsh(str(KERNELS / entry["name"]))
        et0 = spice.str2et(epoch)
        au = spice.convrt(1, "AU", "KM")
        t = np.arange(0, days * 86400 + 1e-6, step)
        samples = []
        for ti in t:
            sun, _ = spice.spkpos("SUN", et0 + ti, frame, "NONE", observer)
            v = np.array(sun) - offset
            d = float(np.linalg.norm(v))
            s = basis @ (v / d)
            earth, _ = spice.spkpos("EARTH", et0 + ti, frame, "NONE", observer)
            ev = np.array(earth) - offset
            e = basis @ (ev / np.linalg.norm(ev))
            samples.append([round(float(ti), 1), *(round(float(c), 9) for c in s),
                            round(1361.0 / (d / au) ** 2, 3), *(round(float(c), 9) for c in e)])
        return {
            "schema": "egiz.world_illumination", "version": "1.0.0",
            "engine": f"SpiceyPy {spice.__version__} / {spice.tkvrsn('TOOLKIT')}",
            "frame": frame, "observer": observer, "aberration": "NONE", "epochUtc": epoch,
            "step": step, "duration": float(t[-1]),
            "columns": ["t", "sunE", "sunN", "sunU", "fluxWm2", "earthE", "earthN", "earthU"],
            "samples": samples, "kernels": manifest,
            "limitations": [
                "Geometric directions at the zero-height site centre; Sun and Earth parallax across "
                "the 26 km world is below 0.01 degrees and is ignored.",
                "Terrain occultation is computed separately by ray marching the measured horizon grid.",
                "1361 W/m2 at 1 AU is a declared constant; no panel thermal model.",
                "Earth visibility is geometric line of sight only, not a link budget.",
            ],
        }
    finally:
        spice.kclear()


def summarize(record: dict) -> dict:
    s = np.array(record["samples"])
    elev = np.degrees(np.arcsin(s[:, 3]))
    earth = np.degrees(np.arcsin(s[:, 7]))
    return {"sunElevationDeg": {"min": float(elev.min()), "max": float(elev.max())},
            "earthElevationDeg": {"min": float(earth.min()), "max": float(earth.max())},
            "samples": len(s), "sunAboveHorizonFraction": float((elev > 0).mean()),
            "maxElevationTime": float(s[int(np.argmax(elev)), 0])}

