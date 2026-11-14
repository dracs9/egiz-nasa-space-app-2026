# Written with AI assistance (Codex); human review pending.
"""Compare corresponding illumination/shadow observations with explicit masks."""
import numpy as np


def compare_observations(predicted, reference, valid_mask=None):
    predicted, reference = np.asarray(predicted), np.asarray(reference)
    if predicted.shape != reference.shape:
        raise ValueError("comparison requires matching grids and geometry")
    valid = np.isfinite(predicted) & np.isfinite(reference)
    if valid_mask is not None:
        valid &= valid_mask
    if not valid.any():
        return {"n": 0, "mae": None, "status": "inconclusive"}
    return {"n": int(valid.sum()), "mae": float(np.mean(np.abs(predicted[valid]-reference[valid]))),
            "status": "measured", "note": "caller must establish matching time, height and projection"}
