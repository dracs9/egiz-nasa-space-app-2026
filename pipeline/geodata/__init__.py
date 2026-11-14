# Written with AI assistance (Claude Code); reviewed by: pending (Geo lead).
"""EGIZ geospatial data release builder.

Thin orchestration over the existing adapters (pipeline.planets.access,
pipeline.earth.public_*, pipeline.common.terrain). It acquires real source
windows into a resumable cache, derives features with explicit units and
evidence classes, and publishes a versioned release under data/geo/<version>/.
Interface: docs/GEOSPATIAL_DATA_INTERFACE.md.
"""
from pathlib import Path

SCHEMA_VERSION = "1.0.0"
DATASET_VERSION = "geo-0.1.0"

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "raw" / "geo"
DERIVED = ROOT / "data" / "derived" / DATASET_VERSION
RELEASE = ROOT / "data" / "geo" / DATASET_VERSION

EVIDENCE_CLASSES = ("observed", "derived", "proxy", "modelled", "simulated", "synthetic_fixture")
COVERAGE_LEVELS = ("L0_sampled", "L1_dem", "L2_environment", "L3_geology", "L4_validated")
