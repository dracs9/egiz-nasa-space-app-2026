# Written with AI assistance (Codex); human review pending.
"""Estimate target attribute spread from genuine PGDA clone rasters."""
import numpy as np

from pipeline.common.terrain import terrain_attributes


def attribute_spread(grids, p):
    rows = [terrain_attributes(z, p) for z in grids]
    if not rows:
        raise ValueError("at least one measured clone grid is required")
    result = {}
    for key in rows[0]:
        finite = [row[key] for row in rows if row[key] is not None]
        result[key] = {"n": len(finite), "p05": float(np.percentile(finite, 5)) if finite else None,
                       "p95": float(np.percentile(finite, 95)) if finite else None}
    return result
