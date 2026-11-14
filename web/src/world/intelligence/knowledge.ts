// Curated retrieval corpus for evidence-backed copilot answers. Each entry summarises (in EGIZ's own
// words) a real, citable publication or dataset document, or an internal EGIZ method record.
// The copilot only cites entries that exist here; it never generates references.
export interface KnowledgeEntry { id: string; title: string; citation: string; url?: string; kind: 'paper' | 'dataset' | 'book' | 'internal' | 'model-card'; text: string; tags: string[] }

export const KNOWLEDGE: KnowledgeEntry[] = [
  { id: 'barker2021', kind: 'paper', title: 'Improved LOLA elevation maps for south pole landing sites', citation: 'Barker, M. K. et al. (2021), Planetary and Space Science 203, doi:10.1016/j.pss.2020.105119', url: 'https://pgda.gsfc.nasa.gov/products/78',
    text: 'Describes 5 m per pixel LOLA-derived digital elevation models of candidate lunar south polar landing sites, produced by adjusting laser altimeter tracks and interpolating. Posting is not equivalent to independent laser spacing; small features below a few posts are smoothed.', tags: ['dem', 'lola', 'resolution', 'elevation', 'south pole', 'mons mouton', 'site20'] },
  { id: 'smith2010', kind: 'paper', title: 'Initial observations from the Lunar Orbiter Laser Altimeter (LOLA)', citation: 'Smith, D. E. et al. (2010), Geophysical Research Letters 37, L18204, doi:10.1029/2010GL043751',
    text: 'Introduces the LOLA instrument: a multi-beam laser altimeter on LRO measuring topography, slopes, roughness and reflectance of the Moon. Elevations are referenced to a 1737.4 km sphere.', tags: ['lola', 'altimeter', 'topography', 'roughness', 'datum', 'sphere'] },
  { id: 'mazarico2011', kind: 'paper', title: 'Illumination conditions of the lunar polar regions using LOLA topography', citation: 'Mazarico, E. et al. (2011), Icarus 211, 1066–1081, doi:10.1016/j.icarus.2010.10.030',
    text: 'Computes polar illumination by ray tracing horizons on LOLA topography with SPICE ephemerides. Near the poles the Sun stays within a few degrees of the horizon, so local and distant topography controls illumination and shadow duration.', tags: ['illumination', 'shadow', 'horizon', 'sun', 'polar', 'solar power', 'spice'] },
  { id: 'acton1996', kind: 'paper', title: 'Ancillary data services of NASA’s Navigation and Ancillary Information Facility', citation: 'Acton, C. H. (1996), Planetary and Space Science 44, 65–70, doi:10.1016/0032-0633(95)00107-7',
    text: 'Describes the SPICE system of kernels (ephemerides, orientation, frames, time) used to compute observation geometry such as the Sun and Earth directions from a surface site.', tags: ['spice', 'ephemeris', 'sun', 'earth', 'geometry', 'time'] },
  { id: 'mcewen1991', kind: 'paper', title: 'Photometric functions for photoclinometry and other applications', citation: 'McEwen, A. S. (1991), Icarus 92, 298–311, doi:10.1016/0019-1035(91)90053-V',
    text: 'Evaluates photometric functions for planetary surfaces, including the lunar-Lambert function that mixes Lommel–Seeliger and Lambert behaviour with a phase-dependent weight L. EGIZ uses it to shade terrain; albedo is assumed uniform because no orthoimage is packaged.', tags: ['photometry', 'rendering', 'albedo', 'lunar-lambert', 'shading'] },
  { id: 'bekker1969', kind: 'book', title: 'Introduction to Terrain-Vehicle Systems', citation: 'Bekker, M. G. (1969), University of Michigan Press',
    text: 'Pressure–sinkage relation p = (kc/b + kφ) zⁿ and compaction resistance for wheels on deformable soil. Basis of the EGIZ fast terramechanics model.', tags: ['terramechanics', 'sinkage', 'bekker', 'wheel', 'soil', 'resistance'] },
  { id: 'wongreece1967', kind: 'paper', title: 'Prediction of rigid wheel performance based on the analysis of soil-wheel stresses, Part I', citation: 'Wong, J. Y. and Reece, A. R. (1967), Journal of Terramechanics 4(1), 81–98, doi:10.1016/0022-4898(67)90105-X',
    text: 'Normal and shear stress distributions under a rigid wheel; maximum-stress angle depends on slip (coefficients c1≈0.43, c2≈0.32). Integration yields drawbar pull, torque and sinkage. Basis of the EGIZ detailed fidelity.', tags: ['terramechanics', 'wong-reece', 'slip', 'drawbar', 'torque', 'wheel', 'detailed'] },
  { id: 'janosi1961', kind: 'paper', title: 'The analytical determination of drawbar pull as a function of slip for tracked vehicles in deformable soils', citation: 'Janosi, Z. and Hanamoto, B. (1961), Proc. 1st Int. Conf. ISTVS, Turin',
    text: 'Exponential shear stress–displacement relation τ = τmax (1 − e^(−j/K)) used to relate thrust to slip.', tags: ['terramechanics', 'slip', 'shear', 'thrust'] },
  { id: 'wong2008', kind: 'book', title: 'Theory of Ground Vehicles (4th edition)', citation: 'Wong, J. Y. (2008), John Wiley & Sons',
    text: 'Reference text for vehicle–terrain mechanics including tabulated Bekker parameters for soils such as lunar soil (n≈1, kc≈1.4 kN/m^(n+1), kφ≈820 kN/m^(n+2), c≈0.17 kPa, φ≈35°).', tags: ['terramechanics', 'lunar soil', 'parameters', 'regolith', 'cohesion', 'friction'] },
  { id: 'sourcebook1991', kind: 'book', title: 'Lunar Sourcebook: A User’s Guide to the Moon', citation: 'Heiken, G. H., Vaniman, D. T. and French, B. M. (eds.) (1991), Cambridge University Press (ch. 9, Carrier, Olhoeft and Mendell)',
    text: 'Compiles physical properties of lunar regolith: density, cohesion, friction angle, bearing capacity and their variability with depth and location. Site-specific mechanical properties at Mons Mouton are not measured.', tags: ['regolith', 'density', 'cohesion', 'friction', 'geotechnical', 'lunar soil'] },
  { id: 'bandfield2011', kind: 'paper', title: 'Lunar surface rock abundance and regolith fines temperatures derived from LRO Diviner Radiometer data', citation: 'Bandfield, J. L. et al. (2011), Journal of Geophysical Research 116, E00H02, doi:10.1029/2011JE003866',
    text: 'Thermal-infrared estimates of rock abundance (rocks ≳ 1 m) across the Moon; typical regolith surfaces have rock concentrations below about 1 %. Values are areal fractions at Diviner resolution, not individual rock positions.', tags: ['rocks', 'boulder', 'rock abundance', 'hazard', 'diviner'] },
  { id: 'golombek1997', kind: 'paper', title: 'Size-frequency distributions of rocks on Mars and Earth analog sites', citation: 'Golombek, M. and Rapp, D. (1997), Journal of Geophysical Research 102(E2), 4117–4129, doi:10.1029/96JE03319',
    text: 'Exponential model of cumulative fractional area covered by rocks larger than D: F(D) = k exp(−q(k) D). EGIZ uses this form as an assumed rock-hazard statistic.', tags: ['rocks', 'size-frequency', 'hazard', 'boulder', 'model'] },
  { id: 'pike1977', kind: 'paper', title: 'Size-dependence in the shape of fresh impact craters on the Moon', citation: 'Pike, R. J. (1977), in Impact and Explosion Cratering, Pergamon, 489–509',
    text: 'Fresh simple lunar craters have depth-to-diameter ratios near 0.2; degradation reduces d/D. EGIZ crater scores use d/D, recognising that a 5 m DEM further smooths small craters.', tags: ['crater', 'depth', 'diameter', 'morphology', 'degradation'] },
  { id: 'silburt2019', kind: 'paper', title: 'Lunar crater identification via deep learning', citation: 'Silburt, A. et al. (2019), Icarus 317, 27–38, doi:10.1016/j.icarus.2018.06.022',
    text: 'A U-Net trained on LOLA/Kaguya DEMs detects craters. Not integrated in EGIZ (weights and TensorFlow runtime not packaged); cited as the learned alternative to the classical DEM crater baseline.', tags: ['crater', 'deep learning', 'detection', 'cnn', 'prior art'] },
  { id: 'snyder1987', kind: 'book', title: 'Map Projections — A Working Manual', citation: 'Snyder, J. P. (1987), USGS Professional Paper 1395, doi:10.3133/pp1395',
    text: 'Equations for the azimuthal equidistant projection used as the EGIZ local map frame on the lunar reference sphere.', tags: ['projection', 'coordinates', 'aeqd', 'map'] },
  { id: 'prithvi2023', kind: 'model-card', title: 'Foundation models for generalist geospatial artificial intelligence (Prithvi)', citation: 'Jakubik, J. et al. (2023), arXiv:2310.18660',
    text: 'NASA/IBM geospatial foundation model pretrained on Harmonized Landsat-Sentinel Earth imagery. Registered in EGIZ as incompatible with lunar DEM tasks (Earth-only training domain).', tags: ['foundation model', 'earth observation', 'prithvi', 'ai'] },
  { id: 'terramind2025', kind: 'model-card', title: 'TerraMind: Large-scale generative multimodality for Earth observation', citation: 'Jakubik, J. et al. (2025), arXiv:2504.11171',
    text: 'IBM/ESA any-to-any Earth-observation foundation model over Sentinel-1/2, DEM and land cover. Registered in EGIZ as download-required and domain-incompatible for lunar use.', tags: ['foundation model', 'terramind', 'earth observation', 'ai', 'multimodal'] },
  { id: 'egiz-world', kind: 'internal', title: 'EGIZ ASTRAL world package (Mons Mouton)', citation: 'EGIZ docs/astral/ASTRAL_WORLD_ENGINE_DESIGN.md and data/world/moon-mons-mouton/manifest.json',
    text: 'Six-level measured pyramid (160 m to native 5 m posts) from PGDA Site20v2; 5 m only inside the 5.76 km operational box; 20 m horizon grid from the whole 26 km raster; SPICE Sun/Earth for 30 days hourly. No orthoimage, spectra or geologic map is packaged.', tags: ['world', 'lod', 'resolution', 'provenance', 'missing data', 'operational box'] },
  { id: 'egiz-atlas', kind: 'internal', title: 'ATLAS-Π mission-conditioned transferability', citation: 'EGIZ docs/research/ATLAS_PI_*.md and data/pilot/atlas_pi.json',
    text: 'Deterministic engine that assesses Earth analog windows against Mons Mouton and Jezero per mission task with separate similarity, evidence, resolution and physics axes; statuses SUPPORTED to NON_TRANSFERABLE. It is the authority for transferability statements.', tags: ['analog', 'earth', 'transferability', 'atlas', 'compare', 'boszhira', 'bozjyra'] },
];

const tokenize = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9\s-]/g, ' ').split(/[\s-]+/).filter(w => w.length > 2 && !STOP.has(w));
const STOP = new Set(['the', 'and', 'for', 'this', 'that', 'with', 'what', 'are', 'how', 'why', 'from', 'area', 'show', 'find', 'which', 'does', 'into', 'about', 'there', 'here']);

/** BM25 retrieval over title + text + tags. */
export function searchKnowledge(query: string, limit = 3, minScore = 1.2) {
  const q = tokenize(query);
  if (!q.length) return [];
  const docs = KNOWLEDGE.map(e => tokenize(`${e.title} ${e.text} ${e.tags.join(' ')} ${e.tags.join(' ')}`));
  const avg = docs.reduce((a, d) => a + d.length, 0) / docs.length, N = docs.length, k1 = 1.4, b = 0.75;
  const df = new Map<string, number>();
  for (const d of docs) for (const w of new Set(d)) df.set(w, (df.get(w) ?? 0) + 1);
  return docs.map((d, i) => {
    let score = 0;
    for (const w of q) {
      const tf = d.filter(x => x === w || (w.length > 4 && x.startsWith(w.slice(0, -1)))).length;
      if (!tf) continue;
      const idf = Math.log(1 + (N - (df.get(w) ?? 0) + 0.5) / ((df.get(w) ?? 0) + 0.5));
      score += idf * tf * (k1 + 1) / (tf + k1 * (1 - b + b * d.length / avg));
    }
    return { entry: KNOWLEDGE[i], score };
  }).filter(r => r.score >= minScore).sort((a, c) => c.score - a.score).slice(0, limit);
}
