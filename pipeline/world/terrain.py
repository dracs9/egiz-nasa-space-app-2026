"""Measured multi-resolution terrain pyramid and horizon grid.

Every elevation comes from the fingerprinted native 5 m PGDA LOLA raster.
Level 5 posts are native pixel values on the local AEQD grid; coarser levels
are Gaussian-prefiltered (sigma = posting / 2) decimations of the same grid.
No noise, displacement or gap filling is introduced anywhere.
"""
from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass

import numpy as np
from scipy.ndimage import gaussian_filter, map_coordinates

from pipeline.planets.access import read_window, to_local_grid
from pipeline.world.codec import encode_elevation


@dataclass(frozen=True)
class PyramidSpec:
    footprint_m: float = 15360.0      # full-pyramid square side (levels 0-3)
    cells: int = 96                   # cells per tile side (posts = cells + 1, + 1-post apron)
    levels: int = 6                   # 0..5; level 5 posting = native 5 m
    native_m: float = 5.0
    margin_px: int = 100              # native pixels beyond the footprint (apron + filter support)
    # Operational box (levels 4-5) as [west, south, east, north] in local metres.
    operational: tuple[float, float, float, float] = (-3840.0, -1920.0, 1920.0, 3840.0)
    full_levels: int = 4              # levels 0..3 cover the full footprint

    @property
    def half(self) -> float:
        return self.footprint_m / 2

    def tile_size(self, level: int) -> float:
        return self.footprint_m / 2 ** level

    def posting(self, level: int) -> float:
        return self.tile_size(level) / self.cells


def native_grid(path, lon, lat, spec: PyramidSpec):
    """Native 5 m local grid with pixel centres at -half + 5k (k integer)."""
    half_px = spec.half + spec.margin_px * spec.native_m + spec.native_m / 2
    z, transform, crs = read_window(path, lon, lat, half_px + 50, "moon")
    grid = to_local_grid(z, transform, crs, (lon, lat), "moon", spec.native_m, half_px)
    origin = -half_px + spec.native_m / 2           # x of pixel column 0, = -y of row 0
    return grid, origin


def _sample(grid, origin, native, xs, ys):
    cols = (xs - origin) / native
    rows = (-origin - ys) / native
    return map_coordinates(grid, [rows, cols], order=1, mode="nearest", prefilter=False)


def tile_keys(spec: PyramidSpec):
    for level in range(spec.levels):
        n = 2 ** level
        size = spec.tile_size(level)
        for row in range(n):
            for col in range(n):
                west = -spec.half + col * size
                north = spec.half - row * size
                if level >= spec.full_levels:
                    w, s, e, nn = spec.operational
                    if west < w - 1e-6 or west + size > e + 1e-6 or north > nn + 1e-6 \
                            or north - size < s - 1e-6:
                        continue
                yield level, col, row, west, north, size


def build_pyramid(grid, origin, spec: PyramidSpec):
    """Yield (descriptor, encoded bytes) for every tile."""
    native = spec.native_m
    filtered = {}
    for level in range(spec.levels):
        factor = 2 ** (spec.levels - 1 - level)
        filtered[level] = grid if factor == 1 else gaussian_filter(grid, sigma=factor / 2,
                                                                   mode="nearest")
    for level, col, row, west, north, size in tile_keys(spec):
        p = spec.posting(level)
        idx = np.arange(-1, spec.cells + 2)
        xs, ys = np.meshgrid(west + idx * p, north - idx * p)
        posts = _sample(filtered[level], origin, native, xs.ravel(), ys.ravel()).reshape(xs.shape)
        if not np.isfinite(posts).all():
            raise ValueError(f"tile {level}/{col}/{row} has missing measured posts")
        # Geometric error: bilinear surface of this tile's posts vs native pixels inside it.
        inner = posts[1:-1, 1:-1]
        c0 = int(round((west - origin) / native))
        r0 = int(round((-origin - north) / native))
        npx = int(round(size / native)) + 1
        patch = grid[r0:r0 + npx, c0:c0 + npx]
        f = np.arange(npx) * native / p
        rr, cc = np.meshgrid(f, f, indexing="ij")
        approx = map_coordinates(inner, [rr, cc], order=1, mode="nearest", prefilter=False)
        diff = approx - patch
        blob, offset, scale = encode_elevation(posts, finest=0.01)
        yield {
            "key": f"{level}/{col}_{row}", "level": level, "col": col, "row": row,
            "west": west, "north": north, "size": size, "posting": p,
            "minH": round(float(inner.min()), 3), "maxH": round(float(inner.max()), 3),
            "geometricErrorMax": round(float(np.abs(diff).max()), 3),
            "geometricErrorRms": round(float(np.sqrt(np.mean(diff ** 2))), 3),
            "quantization": {"offset": offset, "scale": scale},
            "sha256": hashlib.sha256(blob).hexdigest(), "bytes": len(blob),
        }, blob


def horizon_grid(path, lon, lat, posting=20.0, half=13000.0):
    """Wide 20 m grid from the whole raster for horizon/shadow ray marching.

    Area-averaged (all-valid) reprojection; cells outside the raster stay NaN
    and are treated as 'no occluder known', which is reported as a limitation.
    """
    z, transform, crs = read_window(path, lon, lat, half + 100, "moon")
    grid = to_local_grid(z, transform, crs, (lon, lat), "moon", posting, half)
    return grid, -half + posting / 2


def slope_deg(z, posting):
    """Central-difference slope; identical formula to web/src/world/analysis/terrain.ts."""
    gy, gx = np.gradient(z, posting)
    return np.degrees(np.arctan(np.hypot(gx, gy)))


def summarize(z):
    finite = z[np.isfinite(z)]
    return {"min": float(finite.min()), "max": float(finite.max()),
            "validFraction": float(np.isfinite(z).mean())} if finite.size else {"validFraction": 0.0}


def check_spec(spec: PyramidSpec):
    if spec.posting(spec.levels - 1) != spec.native_m:
        raise ValueError("finest level must equal the native posting")
    for v in spec.operational:
        if not math.isclose(v / spec.tile_size(spec.full_levels - 1) % 1, 0, abs_tol=1e-9) and \
                not math.isclose(v / spec.tile_size(spec.full_levels - 1) % 1, 1, abs_tol=1e-9):
            raise ValueError("operational box must align with the level-3 tile grid")
