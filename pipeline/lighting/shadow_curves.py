# Written with AI assistance (Codex); human review pending.
"""Build optional curves only for supplied genuine DEMs; no default fallback."""
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from pipeline.common.shadows import shadow_fraction_curve
from pipeline.contracts.validate import validate_data

HEIGHTS = [1, 2, 3, 5, 7]
AZIMUTHS = list(range(0, 360, 45))


def build_shadow_curves(windows, out, *, provenance, synthetic=False):
    """windows: iterable of {id,kind,z,p}; central 10 km analysis mask."""
    items = []
    for item in windows:
        z, p = item["z"], item["p"]
        rows, cols = np.indices(z.shape)
        mask = (np.abs(rows - (z.shape[0]-1)/2)*p < 5000) & (np.abs(cols - (z.shape[1]-1)/2)*p < 5000)
        sf = shadow_fraction_curve(z, p, mask, HEIGHTS, AZIMUTHS)
        items.append({"id": item["id"], "kind": item["kind"], "sf": np.round(sf, 4).tolist()})
    data = {"schema": "egiz.shadows", "version": "1.0.0", "synthetic": synthetic,
            "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "provenance": provenance, "grid": {"h_deg": HEIGHTS, "az_deg": AZIMUTHS}, "items": items}
    validate_data(data)
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, separators=(",", ":")) + "\n")
    return out
