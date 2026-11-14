# Written with AI assistance (Codex); human review pending.
"""Report physical ranges and missingness; no assumed observational pass."""
import json
from pathlib import Path

from pipeline.contracts.validate import validate_data


def run(path):
    data = json.loads(Path(path).read_text())
    validate_data(data)
    return {"tiles": len(data["tiles"]), "synthetic": data["synthetic"],
            "missing_counts": {key: sum(tile["attrs"].get(key) is None for tile in data["tiles"])
                               for key in sorted({k for tile in data["tiles"] for k in tile["attrs"]})},
            "named_elevation_checks": "not_run: named real reference windows not supplied"}
