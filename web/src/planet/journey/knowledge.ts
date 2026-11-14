// EGIZ Expedition · plain-language vocabulary for the measured target fingerprints, the worlds, and a small
// orientation gazetteer. Gazetteer places are context only: EGIZ holds no measurements for them, and the UI says so.
import type { DiscoveryBundle, FingerprintFeature, TargetEntry } from '../../discover/types';
export type World = 'moon' | 'mars';

export interface FeatureInfo { label: string; explain: string; unit?: string; digits?: number; log?: boolean }
/** Every fingerprint key that occurs in discovery.json, with what it means for a non-specialist. */
export const FEATURE_INFO: Record<string, FeatureInfo> = {
  slope_f100_p50_deg: { label: 'Typical slope (100 m)', explain: 'Half of the ground is gentler than this, measured between points 100 m apart.', digits: 1 },
  slope_f100_p90_deg: { label: 'Steep slopes (100 m, 90th pct.)', explain: 'Only one tenth of the ground is steeper than this.', digits: 1 },
  tri_f100_m: { label: 'Ruggedness (100 m)', explain: 'Mean height step to neighbouring points 100 m away (terrain ruggedness index).', digits: 2 },
  slope_f400_p50_deg: { label: 'Typical slope (400 m)', explain: 'Half of the ground is gentler than this, measured between points 400 m apart.', digits: 1 },
  slope_f400_p90_deg: { label: 'Steep slopes (400 m, 90th pct.)', explain: 'Only one tenth of the ground is steeper than this at a 400 m baseline.', digits: 1 },
  tri_f400_m: { label: 'Ruggedness (400 m)', explain: 'Mean height step to neighbouring points 400 m away.', digits: 2 },
  slope_r_p50_deg: { label: 'Regional slope', explain: 'Typical slope of the regional landscape at a 2 km baseline.', digits: 1 },
  relief_m: { label: 'Relief', explain: 'Height difference between the highest and the lowest point of the measured window.', digits: 0, log: true },
  vegetation_frac: { label: 'Vegetation', explain: 'A physical constraint, not a measurement: no vegetation exists on the Moon or Mars.', digits: 0 },
  liquid_precip_mm: { label: 'Liquid precipitation', explain: 'A physical constraint: no liquid precipitation under present surface conditions.', digits: 0 },
  noon_elevation_min_deg: { label: 'Lowest noon Sun', explain: 'Sun elevation at local noon on the least favourable day of the year (from latitude and obliquity).', digits: 1 },
  noon_elevation_max_deg: { label: 'Highest noon Sun', explain: 'Sun elevation at local noon on the most favourable day of the year.', digits: 1 },
  classes: { label: 'Geology', explain: 'Rock classes from the cited literature, not from a mapped unit at this exact point.' },
  air_or_surface_range_k: { label: 'Temperature range', explain: 'Literature surface/air temperature range for the body and latitude band, not a local measurement.' },
};
export const GROUP_LABEL: Record<string, string> = { terrain: 'Terrain', surface: 'Surface', water: 'Water', illumination: 'Sunlight', geology: 'Geology', thermal: 'Temperature' };
export const EVIDENCE_LABEL: Record<string, string> = { derived: 'derived', measured: 'measured', literature: 'literature', physical_constraint: 'constraint', curated: 'curated', missing: 'missing' };

export function formatFeature(key: string, f: FingerprintFeature): string {
  const info = FEATURE_INFO[key], v = f.value;
  if (Array.isArray(v)) return v.every(x => typeof x === 'number') ? `${v.join('–')} ${f.unit}` : v.map(x => String(x).replace(/_/g, ' ')).join(', ');
  if (typeof v !== 'number') return String(v);
  const unit = f.unit === 'deg' ? '°' : f.unit === 'fraction' ? '' : ` ${f.unit}`, d = info?.digits ?? 2;
  const sigma = typeof f.sigma === 'number' && f.sigma > 0 ? ` ± ${f.sigma.toFixed(Math.max(d, f.sigma < 1 ? 1 : 0))}` : '';
  return `${v.toFixed(d)}${sigma}${unit}`;
}
/** Flattened, ordered fingerprint for display. */
export function fingerprintRows(t: TargetEntry) {
  return Object.entries(t.fingerprint).flatMap(([group, feats]) => Object.entries(feats).map(([key, f]) => ({ group, key, f, info: FEATURE_INFO[key] ?? { label: key.replace(/_/g, ' '), explain: '' } })));
}
export const featureValue = (t: TargetEntry, key: string): number | null => { for (const g of Object.values(t.fingerprint)) { const f = g[key]; if (f && typeof f.value === 'number') return f.value; } return null; };

export const STATUS_LABEL: Record<string, string> = { measured: 'measured', missing: 'missing', not_assessed: 'not assessed', not_applicable: 'not applicable' };
export function knownUnknown(b: DiscoveryBundle, t: TargetEntry) {
  return b.dimensions.map(d => ({ id: d.id, label: d.label, status: t.dimension_status[d.id] ?? 'not_assessed', why: t.dimension_status[d.id] === 'measured' ? d.method : d.bodies_not_applicable?.[t.body] ?? d.reason, next: d.integration_path }));
}

export const WORLD: Record<World, { name: string; radiusKm: number; gravity: string; day: string; sunlight: string; line: string; why: string; investigations: string[] }> = {
  moon: {
    name: 'The Moon', radiusKm: 1737.4, gravity: '1.62 m/s² · one sixth of Earth', day: '29.5 Earth days from noon to noon', sunlight: 'Airless; at the south pole the Sun skims the horizon',
    line: 'Our nearest world, and the next place people will walk.',
    why: 'The lunar south pole is where Artemis crews are expected to land: peaks that see the Sun almost continuously stand beside craters that never do. Long shadows, steep massifs and cold traps make it a demanding place to drive, walk and power a base.',
    investigations: ['Rover routes on steep polar massifs', 'Low-Sun power and long shadows', 'Earth test sites for crews and rovers'],
  },
  mars: {
    name: 'Mars', radiusKm: 3389.5, gravity: '3.72 m/s² · about two fifths of Earth', day: '24 h 40 min', sunlight: 'Thin CO₂ atmosphere; dust dims the Sun',
    line: 'A cold desert that once had rivers and lakes.',
    why: 'Rovers search Martian crater lakes and deltas for signs that life may once have existed. Every landing site is a trade-off between scientific promise and safe, drivable ground — and every rover is first rehearsed on Earth.',
    investigations: ['Drivability of landing sites', 'Ancient-lake geology and sampling', 'Earth deserts that rehearse a mission'],
  },
};

/** Orientation landmarks. Centres are rounded IAU Gazetteer of Planetary Nomenclature values (planetarynames.wr.usgs.gov). */
export interface Place { name: string; lat: number; lon: number; kind: string; note: string }
export const PLACES: Record<World, Place[]> = {
  mars: [
    { name: 'Olympus Mons', lat: 18.65, lon: -133.8, kind: 'shield volcano', note: 'The largest volcano in the Solar System, about 22 km above its surroundings.' },
    { name: 'Valles Marineris', lat: -13.9, lon: -59.2, kind: 'canyon system', note: 'A rift canyon system some 4000 km long and up to 7 km deep.' },
    { name: 'Hellas Planitia', lat: -42.4, lon: 70.5, kind: 'impact basin', note: 'One of the largest impact basins, over 7 km deep.' },
    { name: 'Arsia Mons', lat: -8.3, lon: -120.1, kind: 'shield volcano', note: 'Southernmost of the three Tharsis volcanoes.' },
    { name: 'Elysium Mons', lat: 25.0, lon: 147.2, kind: 'volcano', note: 'The main volcano of the Elysium rise.' },
    { name: 'Argyre Planitia', lat: -49.7, lon: -43.4, kind: 'impact basin', note: 'A large southern impact basin.' },
    { name: 'Utopia Planitia', lat: 49.7, lon: 118.0, kind: 'plain', note: 'The largest recognised impact basin on Mars, a vast northern plain.' },
    { name: 'Isidis Planitia', lat: 12.9, lon: 87.0, kind: 'impact basin', note: 'Jezero crater lies on its western rim.' },
    { name: 'Arabia Terra', lat: 21.0, lon: 6.0, kind: 'highland', note: 'Heavily cratered, ancient highland terrain.' },
  ],
  moon: [
    { name: 'Mare Tranquillitatis', lat: 8.5, lon: 31.4, kind: 'mare', note: 'A basalt plain; Apollo 11 landed at its south-western edge.' },
    { name: 'Mare Imbrium', lat: 32.8, lon: -15.6, kind: 'mare', note: 'A vast basalt-filled impact basin.' },
    { name: 'Oceanus Procellarum', lat: 18.4, lon: -57.4, kind: 'mare', note: 'The largest of the lunar maria.' },
    { name: 'Mare Serenitatis', lat: 28.0, lon: 17.5, kind: 'mare', note: 'Apollo 17 landed on its south-eastern margin.' },
    { name: 'Copernicus', lat: 9.6, lon: -20.1, kind: 'crater', note: 'A young, 93 km rayed crater.' },
    { name: 'Tycho', lat: -43.3, lon: -11.4, kind: 'crater', note: 'An 85 km crater with the brightest ray system on the near side.' },
    { name: 'South Pole–Aitken basin', lat: -53, lon: -169, kind: 'impact basin', note: 'The largest and oldest recognised lunar basin, about 2500 km across.' },
    { name: 'Von Kármán', lat: -44.5, lon: 175.9, kind: 'crater', note: "Chang'e 4 made the first far-side landing here (2019)." },
    { name: 'Apollo 11 landing site', lat: 0.674, lon: 23.473, kind: 'landing site', note: 'First crewed landing, 20 July 1969.' },
  ],
};
