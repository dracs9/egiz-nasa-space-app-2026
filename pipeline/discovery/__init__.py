"""EGIZ Discovery Engine: Earth-wide analog search for lunar and Martian targets.

Layers (each a separate module with a typed, documented contract):

- ``sites``        candidate windows: global lattice, regional lattice, benchmark sites, targets
- ``acquire``      runs the geodata per-AOI processor on those windows (real public data)
- ``context``      point inventories (volcanoes, impact structures, countries) -> window context
- ``fingerprint``  multidimensional fingerprints with per-feature uncertainty and evidence class
- ``similarity``   dimension-specific comparisons (distributional, decorrelated, categorical, interval)
- ``rank``         uncertainty propagation, Earth-wide percentiles, rarity, novelty, diversity
- ``gaps``         computed gap ledger (target vs. candidate, with units and citations)
- ``validation``   known-analog benchmark, controls, ablation and sensitivity
- ``bundle``       versioned JSON bundle consumed by the web Discover workspace

Nothing here fabricates measurements: unavailable dimensions are reported as
``not_assessed`` with a reason, never imputed. Written with AI assistance (Claude); human review pending.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
INDEX_VERSION = "egiz-index-1.0.0"
BUNDLE_VERSION = "egiz-discovery-1.0.0"
GEO_RELEASE = ROOT / "data" / "geo" / "geo-0.1.0"
INDEX_DERIVED = ROOT / "data" / "derived" / INDEX_VERSION
OUT = ROOT / "data" / "discovery"
RAW = ROOT / "data" / "raw" / "geo"
