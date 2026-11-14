"""Bounded native tool runner. JSON stdin/stdout; catalog and reproduction CLI."""
import argparse
import contextlib
import json
import os
import sys
import tempfile
from pathlib import Path

os.environ.setdefault('MPLCONFIGDIR', str(Path(tempfile.gettempdir())/'egiz-mpl'))
os.environ.setdefault('XDG_CACHE_HOME', str(Path(tempfile.gettempdir())/'egiz-cache'))

from pipeline.dynamics.engines import execute


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['run', 'build', 'verify'])
    parser.add_argument('--archive', type=Path)
    args = parser.parse_args()
    if args.command == 'run':
        request = json.load(sys.stdin)
        with contextlib.redirect_stdout(sys.stderr):
            record = execute(request)
        print(json.dumps(record, allow_nan=False, separators=(',', ':')))
    elif args.command == 'build':
        records = [execute(p) for p in [
            {'kind': 'rover', 'duration': 30},
            {'kind': 'rover', 'duration': 30, 'stiffness': 1200, 'damping': 90},
            {'kind': 'orbit', 'duration': 7200},
            {'kind': 'orbit', 'duration': 7200, 'deltaV': 120}]]
        output = Path('data/dynamics/references.json')
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps({'schema': 'egiz.dynamics_catalog', 'version': '1.0.0', 'runs': records}, allow_nan=False, separators=(',', ':'))+'\n')
        print(f'Executed {len(records)} native reference experiments → {output}')
    else:
        if not args.archive:
            parser.error('--archive is required')
        record = json.loads(args.archive.read_text())
        new = execute(record['request'])
        if new['adapter'] != record.get('adapter') or new['engine'] != record['engine'] or new.get('modelSha256') != record.get('modelSha256') or new['inputSha256'] != record['inputSha256']:
            raise ValueError('Engine version or model/input fingerprint changed')
        import numpy as np
        def flatten(value):
            if isinstance(value, (int, float)):
                return [value]
            if isinstance(value, list):
                return [n for item in value for n in flatten(item)]
            if isinstance(value, dict):
                return [n for key in sorted(value) for n in flatten(value[key])]
            return []
        # Every numerical state, joint, force, metric and geometry value consumed by the UI.
        a = np.array(flatten({k: record[k] for k in ['states', 'metrics', 'geometry', 'events']}))
        b = np.array(flatten({k: new[k] for k in ['states', 'metrics', 'geometry', 'events']}))
        if a.shape != b.shape or not np.allclose(a, b, atol=1e-8, rtol=1e-11):
            raise ValueError('Numerical reproduction failed')
        print(f'Reproduced {new["engine"]}, {len(new["states"])} states; maximum numeric difference {np.max(np.abs(a-b)):.3g} (SI exported fields)')


if __name__ == '__main__':
    main()
