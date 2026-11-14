"""ATLAS-Pi: mission-conditioned planetary analog transferability.

The package is additive to the existing EGIZ engine. It reads the measured pilot
bundle (data/pilot), computes an Operational Transferability Tensor, analog
constellations, counterfactual scenarios, a value-of-information field plan and
a deterministic scientific red team, and writes data/pilot/atlas_pi.json.

Written with AI assistance (Claude); human scientific review pending.
"""

ENGINE_VERSION = "atlas-pi-1.0.0"
SCHEMA = "egiz.atlas_pi"
SCHEMA_VERSION = "1.0.0"
