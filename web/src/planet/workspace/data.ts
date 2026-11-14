// EGIZ · shared loading of the measured planetary data every mission surface needs: packaged 3D sites, the
// Earth-wide discovery index, its validation, ATLAS-Π for the active data mode, and the score shard of the active
// target. Used by the Planetary Studio, the guided expedition and Mission Home, so whichever opens first loads it
// once and the others reuse it. Nothing here is re-scored; files are read as published.
import { useEffect } from 'react';
import { dataModeInfo, type DataMode } from '../../data/modes';
import { listSites } from '../terrain/site';
import { usePlanet } from './store';

const BASE = import.meta.env.BASE_URL;
let loadedMode: DataMode | null = null;
const getJson = (p: string, signal: AbortSignal) => fetch(`${BASE}${p}`, { signal, cache: 'no-cache' }).then(r => (r.ok ? r.json() : Promise.reject(new Error(`${p}: HTTP ${r.status}`))));

/** Load the discovery bundle, validation, sites and ATLAS-Π (once per data mode), and the active target's shard. */
export function usePlanetData(dataMode: DataMode) {
  useEffect(() => {
    const st = usePlanet.getState();
    if (loadedMode === dataMode && st.bundle && st.refs.length) return;
    const c = new AbortController();
    listSites(BASE, c.signal).then(refs => usePlanet.getState().set({ refs })).catch(() => undefined);
    getJson('discovery/discovery.json', c.signal).then(bundle => { if (bundle.schema !== 'egiz.discovery' || bundle.synthetic !== false) throw new Error('not a measured discovery bundle'); usePlanet.getState().set({ bundle, discoveryError: null }); loadedMode = dataMode;
      // Records saved before the site name was stored get it once the index is available.
      const inv = usePlanet.getState().inv, named = inv.target && !inv.siteName ? (bundle as { targets: { id: string; name: string }[] }).targets.find(x => x.id === inv.target) : null;
      if (named) usePlanet.getState().patchInv({ siteName: named.name.split(' (')[0] }); })
      .catch(e => { if (!c.signal.aborted) usePlanet.getState().set({ discoveryError: `The discovery index is not packaged in this build (${e.message}). Build it with python -m pipeline.discovery bundle.` }); });
    getJson('discovery/validation.json', c.signal).then(validation => usePlanet.getState().set({ validation })).catch(() => undefined);
    getJson(`${dataModeInfo[dataMode].path}/atlas_pi.json`, c.signal).then(atlas => { if (atlas.schema === 'egiz.atlas_pi') usePlanet.getState().set({ atlas }); }).catch(() => { if (!c.signal.aborted) usePlanet.getState().set({ atlas: null }); });
    return () => c.abort();
  }, [dataMode]);
  const bundle = usePlanet(s => s.bundle), inv = usePlanet(s => s.inv), target = bundle ? usePlanet.getState().target() : null;
  useEffect(() => {
    if (!bundle || !target) return;
    if (usePlanet.getState().shard?.target === target.id) return;
    const c = new AbortController(); usePlanet.getState().set({ shard: null });
    fetch(`${BASE}discovery/${target.shard}`, { signal: c.signal, cache: 'no-cache' }).then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))).then(shard => usePlanet.getState().set({ shard }))
      .catch(e => { if (!c.signal.aborted) usePlanet.getState().set({ discoveryError: `Scores for ${target.id} failed to load (${e.message}).` }); });
    return () => c.abort();
  }, [bundle, target?.id, inv.world]); // eslint-disable-line react-hooks/exhaustive-deps
}
