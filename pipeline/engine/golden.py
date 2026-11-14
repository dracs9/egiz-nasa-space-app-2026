"""Generate deterministic Python/TypeScript parity fixtures, not observations.

Written with AI assistance (Codex); human review pending.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

from .campaign import exact_best
from .fidelity import attribute_fidelity


def generate(out_dir="data/fixtures/golden", seed=2026):
    rng = np.random.default_rng(seed)
    attributes = []
    for i in range(200):
        fn = ("match", "logmatch", "at_most", "at_least", "colder")[i % 5]
        x, target = map(float, rng.uniform(0.1, 200, size=2))
        params = ({"sigma": float(rng.uniform(0.05, 2))} if fn == "logmatch" else
                  {"sigma": float(rng.uniform(1, 100))} if fn == "match" else
                  {"a": float(rng.uniform(1, 200)), "tau": float(rng.uniform(1, 100))})
        spec = {"fn": fn, "params": params, "needs_target": fn in {"match", "logmatch", "colder"}}
        if i % 19 == 0:
            x = None
        attributes.append({"spec": spec, "x_e": x, "x_t": target,
                           "expected": attribute_fidelity(spec, x, target)})
    campaigns = []
    for _ in range(20):
        n, m, k = int(rng.integers(4, 15)), int(rng.integers(2, 6)), int(rng.integers(1, 4))
        F, W = rng.random((n, m)), rng.random(m)
        sites, score = exact_best(F, W, np.arange(n), k)
        campaigns.append({"F": F.tolist(), "W": W.tolist(), "k": k,
                          "expected_sites": list(sites), "expected_coverage": score})
    directory = Path(out_dir)
    if "processed" in directory.resolve().parts:
        raise ValueError("Golden fixtures cannot be stored in processed")
    directory.mkdir(parents=True, exist_ok=True)
    for name, cases in (("golden_fidelity", attributes), ("golden_campaign", campaigns)):
        (directory / f"{name}.json").write_text(json.dumps({"synthetic": True, "seed": seed, "cases": cases},
                                                        sort_keys=True, indent=2, allow_nan=False) + "\n")
    return [directory / "golden_fidelity.json", directory / "golden_campaign.json"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out-dir", default="data/fixtures/golden")
    args = parser.parse_args()
    for path in generate(args.out_dir):
        print(path)


if __name__ == "__main__":
    main()
