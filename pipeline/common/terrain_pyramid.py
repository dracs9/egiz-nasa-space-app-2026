"""Measured LOLA mesh pyramid. 40/20/10 m geometry, 4 km footprint, 21 tiles.

Derived only from the fingerprinted native 5 m LOLA raster. Reproject using the
same all-valid footprint policy as regional science, then interpolate onto shared
vertex posts. No synthetic displacement or gap filling. Seam vertices coincide.
"""
import hashlib
import json
from pathlib import Path

import numpy as np
from scipy.ndimage import map_coordinates

from pipeline.planets.access import read_window, to_local_grid


def build():
    entries = json.loads(Path('data/pilot/mission_terrain.json').read_text())['entries']
    site = next(s for s in entries if s['id'] == 'MOON_MONS_MOUTON')
    path = Path('data/raw/targets/Site20v2_final_adj_5mpp_surf.tif')
    fingerprint = hashlib.sha256(path.read_bytes()).hexdigest()
    if fingerprint != site['source']['sha256']:
        raise ValueError('LOLA source fingerprint differs from scientific pilot')
    z, transform, crs = read_window(path, site['lon'], site['lat'], 2050, 'moon')
    fine = to_local_grid(z, transform, crs, (site['lon'], site['lat']), 'moon', 5, 2050)
    folder = Path('data/terrain/moon-mouton')
    folder.mkdir(parents=True, exist_ok=True)
    tiles = []
    for level in range(3):
        size = 4000/(2**level)
        for row in range(2**level):
            for col in range(2**level):
                west, north = -2000+col*size, 2000-row*size
                x, y = np.meshgrid(np.linspace(west, west+size, 101), np.linspace(north, north-size, 101))
                # First source pixel center is -2047.5 / +2047.5 local metres.
                samples = map_coordinates(fine, [(2047.5-y)/5, (x+2047.5)/5], order=1, mode='constant', cval=np.nan, prefilter=False)
                elevations = [round(float(v), 3) if np.isfinite(v) else None for v in samples.ravel()]
                key = f'{level}-{col}-{row}'
                data = {'key': key, 'side': 101, 'west': west, 'north': north, 'size': size, 'elevations': elevations}
                payload = json.dumps(data, allow_nan=False, separators=(',', ':')).encode()
                (folder/f'{key}.json').write_bytes(payload)
                tiles.append({'key': key, 'level': level, 'col': col, 'row': row,
                              'west': west, 'north': north, 'size': size, 'posting': size/100,
                              'sha256': hashlib.sha256(payload).hexdigest(), 'bytes': len(payload)})
    manifest = {'schema': 'egiz.measured_mesh_pyramid', 'version': '1.0.0', 'synthetic': False,
                'site': site, 'sourceSha256': fingerprint, 'sourcePostingM': 5, 'tiles': tiles,
                'method': 'All-valid average reprojection to 5 m local AEQD; bilinear shared vertex posts at 40/20/10 m. Heights retain source datum; millimetre serialization is not accuracy.',
                'limits': 'Posting is not vertical accuracy or independent laser spacing. No sub-post rocks, texture observations, contact calibration or terrain occlusion.'}
    (folder/'manifest.json').write_text(json.dumps(manifest, separators=(',', ':'))+'\n')
    print(f'Measured lunar pyramid: {len(tiles)} tiles, {sum(t["bytes"] for t in tiles)} bytes; valid finest samples {np.isfinite(fine).mean():.2%}')


if __name__ == '__main__':
    build()
