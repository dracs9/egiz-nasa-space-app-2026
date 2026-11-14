"""Render analytically invented DEMs for testing the Same-Sun interface.

Written with AI assistance (Codex); human review pending.
These landscapes are software fixtures, not measured terrain or visual analog evidence.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from pipeline.common.render import render_same_sun
from pipeline.common.shadows import cast_shadow
from pipeline.contracts.fixtures import PROVENANCE, ROOT, STAMP


def generate(output: str | Path | None = None) -> dict:
    directory = Path(output) if output else ROOT / "web/public/img/twin"
    directory.mkdir(parents=True, exist_ok=True)
    results = json.loads((ROOT / "data/fixtures/results.json").read_text())
    moon = next(run for run in results["runs"] if run["target"] == "FAKE_MOON_MONS_MOUTON")
    light_site = max((id_ for id_ in moon["fidelity"]["O4"] if "_CT_" not in id_),
                     key=lambda id_: moon["fidelity"]["O4"][id_]["F"] or 0)
    y, x = np.mgrid[-6000:6000:30., -6000:6000:30.]
    radius = np.hypot(x + 700, y - 300)
    crater = 250 * np.exp(-((radius - 2000) / 450) ** 2) - 140 * np.exp(-(radius / 1500) ** 2)
    base = 40 * np.sin(x / 900) + 55 * np.sin(y / 1300) + 30 * np.cos((x + y) / 600)
    scenes = {"FAKE_MOON_MONS_MOUTON": crater + base,
              light_site: 0.8 * crater + 65 * np.sin(x / 1100) + 30 * np.cos(y / 900)}
    manifest = {"synthetic": True, "generated_at": STAMP, "provenance": PROVENANCE,
                "description": "Invented analytic DEMs. Not observed NASA/ESA terrain.",
                "heights": [1, 2, 3, 5, 7], "azimuths": list(range(0, 360, 45)),
                "items": [], "curves": {}}
    mask = (np.abs(x) <= 5000) & (np.abs(y) <= 5000)
    for id_, z in scenes.items():
        curve = []
        for height in manifest["heights"]:
            fractions = []
            for azimuth in manifest["azimuths"]:
                name = f"{id_}_h{height}_az{azimuth}.webp"
                render_same_sun(z, 30, height, azimuth, directory / name)
                fractions.append(float(cast_shadow(z, 30, height, azimuth)[mask].mean()))
                manifest["items"].append({"id": id_, "h_deg": height, "az_deg": azimuth,
                                          "file": name, "px_m": 30})
            curve.append(round(float(np.mean(fractions)), 4))
        manifest["curves"][id_] = curve
    (directory / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest


if __name__ == "__main__":
    result = generate()
    print(f"Rendered {len(result['items'])} Same-Sun frames from SYNTHETIC analytic DEMs")
