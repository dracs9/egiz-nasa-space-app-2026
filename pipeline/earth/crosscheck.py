# Written with AI assistance (Codex); human review pending.
"""Cross-check measured attributes without claiming an unrun validation."""
import argparse
import json
from pathlib import Path


def compare(reference, actual, tolerances=None):
    tolerances = tolerances or {}
    rows = []
    for key in sorted(reference.keys() & actual.keys()):
        left, right = reference[key], actual[key]
        delta = None if left is None or right is None else abs(left-right)
        tolerance = tolerances.get(key, .01 if "frac" in key else .5)
        rows.append({"attr": key, "absolute_error": delta, "tolerance": tolerance,
                     "passed": None if delta is None else delta <= tolerance})
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reference", help="JSON attributes computed independently")
    parser.add_argument("--actual", help="JSON attributes computed by the pipeline")
    parser.add_argument("--n", type=int, default=3, help="reserved source-window count")
    args = parser.parse_args()
    if not args.reference or not args.actual:
        parser.exit(2, "E2b not run: supply --reference and --actual from independent calculations of the same source windows; Earth Engine authentication is required for service measurements.\n")
    reference = json.loads(Path(args.reference).read_text())
    actual = json.loads(Path(args.actual).read_text())
    result = compare(reference, actual)
    print(json.dumps(result, indent=2))
    if not result or any(row["passed"] is not True for row in result):
        parser.exit(1)


if __name__ == "__main__":
    main()
