"""Multi-scale terrain descriptors with spatial block-bootstrap uncertainty.

Inputs are the measured 200 m regional grids in ``mission_terrain.json`` (all
bodies on the same 200 m cell, 20 km windows). Coarser scales are produced only
by block-averaging elevation (never by interpolation to finer cells).

Uncertainty: a non-overlapping spatial block bootstrap (4 km blocks, Kunsch 1989)
quantifies how much a regional statistic depends on which parts of the window
were sampled. It is NOT a DEM error model and does not include vertical error.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from typing import Any

import numpy as np

CELL_M = 200
BLOCK_M = 4000
QUANTILES = 512
U = (np.arange(QUANTILES) + 0.5) / QUANTILES
SCALES = (200, 400, 800)


def grid_array(entry: dict) -> np.ndarray:
    grid = entry["grid"]
    if grid["cell_m"] != CELL_M:
        raise ValueError(f"{entry['id']}: expected {CELL_M} m cells, got {grid['cell_m']}")
    side = grid["side"]
    values = np.array([np.nan if v is None else v for v in grid["elevation_m"]], dtype=float)
    if values.size != side * side:
        raise ValueError(f"{entry['id']}: elevation grid size mismatch")
    if np.isfinite(values).mean() < 0.5:
        raise ValueError(f"{entry['id']}: fewer than half of grid cells are valid")
    return values.reshape(side, side)


def coarsen(z: np.ndarray, factor: int) -> np.ndarray:
    """Block-mean elevation; a coarse cell is valid only if all inputs are valid."""
    if factor == 1:
        return z
    n = (z.shape[0] // factor) * factor
    blocks = z[:n, :n].reshape(n // factor, factor, n // factor, factor)
    out = blocks.mean(axis=(1, 3))
    out[~np.isfinite(blocks).all(axis=(1, 3))] = np.nan
    return out


def slope_deg(z: np.ndarray, cell_m: float) -> np.ndarray:
    """Central-difference slope (baseline 2 x cell); NaN where any neighbour is missing."""
    gy, gx = np.gradient(z, cell_m)
    return np.degrees(np.arctan(np.hypot(gx, gy)))


def roughness_log10(z: np.ndarray) -> np.ndarray:
    """log10 standard deviation of residuals after least-squares plane removal in 3x3 windows."""
    n = z.shape[0]
    out = np.full_like(z, np.nan)
    windows = np.stack([z[1 + dy:n - 1 + dy, 1 + dx:n - 1 + dx]
                        for dy in (-1, 0, 1) for dx in (-1, 0, 1)])
    xs = np.array([dx for dy in (-1, 0, 1) for dx in (-1, 0, 1)], dtype=float)
    ys = np.array([dy for dy in (-1, 0, 1) for dx in (-1, 0, 1)], dtype=float)
    mean = windows.mean(axis=0)
    bx = np.tensordot(xs, windows, axes=1) / 6.0
    by = np.tensordot(ys, windows, axes=1) / 6.0
    residual = windows - mean - xs[:, None, None] * bx - ys[:, None, None] * by
    std = np.sqrt((residual ** 2).sum(axis=0) / 6.0)  # 9 samples - 3 plane parameters
    out[1:-1, 1:-1] = np.log10(np.maximum(std, 1e-3))
    return out


def _block_ids(shape: tuple[int, int], cell_m: float) -> np.ndarray:
    per = max(1, int(round(BLOCK_M / cell_m)))
    rows = np.arange(shape[0]) // per
    cols = np.arange(shape[1]) // per
    nb = int(np.ceil(shape[1] / per))
    return rows[:, None] * nb + cols[None, :]


@dataclass
class Field:
    """Per-cell values with block membership for one descriptor at one scale."""
    values: np.ndarray
    blocks: np.ndarray
    by_block: dict = field(default_factory=dict)

    def __post_init__(self):
        mask = np.isfinite(self.values)
        self.values, self.blocks = self.values[mask], self.blocks[mask]
        for b in np.unique(self.blocks):
            self.by_block[int(b)] = self.values[self.blocks == b]

    def resample(self, picks: np.ndarray) -> np.ndarray:
        parts = [self.by_block[b] for b in picks if b in self.by_block]
        return np.concatenate(parts) if parts else np.array([])


def quantile_function(values: np.ndarray) -> np.ndarray:
    if values.size == 0:
        return np.full(QUANTILES, np.nan)
    return np.quantile(values, U)


def wasserstein1(qa: np.ndarray, qb: np.ndarray) -> float:
    """W1 = integral over u in (0,1) of |F^-1(u) - G^-1(u)|, on a midpoint quantile grid."""
    return float(np.mean(np.abs(qa - qb)))


@dataclass
class Descriptors:
    entry_id: str
    body: str
    source_pixel_m: float
    fields: dict
    point: dict
    boot: list[dict]
    valid_fraction: float


def _seed(entry_id: str, seed: int) -> int:
    return int.from_bytes(hashlib.sha256(f"{seed}:{entry_id}".encode()).digest()[:8], "little")


def describe(entry: dict, n_boot: int = 200, seed: int = 20261113) -> Descriptors:
    """Compute point statistics and bootstrap replicates for one terrain window."""
    z = grid_array(entry)
    fields = {}
    for scale in SCALES:
        zc = coarsen(z, scale // CELL_M)
        fields[f"slope_{scale}"] = Field(slope_deg(zc, scale).ravel(), _block_ids(zc.shape, scale).ravel())
    fields["roughness"] = Field(roughness_log10(z).ravel(), _block_ids(z.shape, CELL_M).ravel())
    fields["elevation"] = Field(z.ravel(), _block_ids(z.shape, CELL_M).ravel())
    fields["slope_trav"] = fields["slope_200"]

    def stats(sample: dict) -> dict:
        out: dict[str, Any] = {f"q_slope_{s}": quantile_function(sample[f"slope_{s}"]) for s in SCALES}
        out["q_roughness"] = quantile_function(sample["roughness"])
        elev = sample["elevation"]
        out["relief_m"] = float(np.quantile(elev, 0.95) - np.quantile(elev, 0.05)) if elev.size else np.nan
        s200 = sample["slope_200"]
        out["traversable"] = float(np.mean(s200 < 15.0)) if s200.size else np.nan
        return out

    point = stats({k: f.values for k, f in fields.items()})
    blocks = sorted(fields["elevation"].by_block)
    rng = np.random.default_rng(_seed(entry["id"], seed))
    boot = []
    for _ in range(n_boot):
        picks = rng.choice(blocks, size=len(blocks), replace=True)
        boot.append(stats({k: f.resample(picks) for k, f in fields.items()}))
    return Descriptors(entry["id"], entry["body"], float(entry.get("source_pixel_m") or CELL_M),
                       fields, point, boot, float(np.isfinite(z).mean()))


def summary(d: Descriptors) -> dict:
    """Compact, serialisable description used by the UI and evidence records."""
    def pct(q, p):
        return float(q[int(p * (QUANTILES - 1))])
    out = {"id": d.entry_id, "body": d.body, "source_pixel_m": d.source_pixel_m,
           "analysis_cell_m": CELL_M, "valid_fraction": round(d.valid_fraction, 5),
           "relief_m": round(d.point["relief_m"], 2), "traversable_lt15": round(d.point["traversable"], 4),
           "roughness_log10_median": round(pct(d.point["q_roughness"], 0.5), 4), "slope": {}}
    for s in SCALES:
        q = d.point[f"q_slope_{s}"]
        out["slope"][str(s)] = {"p10": round(pct(q, 0.1), 3), "p50": round(pct(q, 0.5), 3),
                                "p90": round(pct(q, 0.9), 3),
                                "hist": histogram(d.fields[f"slope_{s}"].values)}
    return out


HIST_EDGES = [0, 1, 2, 5, 10, 15, 20, 30, 45, 90]


def histogram(values: np.ndarray) -> list[float]:
    counts, _ = np.histogram(values, bins=HIST_EDGES)
    total = counts.sum()
    return [round(float(c / total), 5) if total else 0.0 for c in counts]
