# Written with AI assistance (Codex); human review pending.
"""Deterministic same-Sun image batch and manifest; no appearance-based score."""
import json
from pathlib import Path

from pipeline.common.render import render_same_sun


def render_windows(windows, out_dir, heights=(1, 3, 5, 7), azimuths=(0, 90, 180, 270)):
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest = {"items": []}
    for item in windows:
        for h in heights:
            for az in azimuths:
                name = f"{item['id']}_h{h}_az{az}.webp"
                render_same_sun(item["z"], item["p"], h, az, out_dir/name)
                manifest["items"].append({"id": item["id"], "h_deg": h, "az_deg": az, "file": name, "px_m": item["p"]})
    (out_dir/"manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest
