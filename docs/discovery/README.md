# EGIZ Discover — Earth-wide analog intelligence

Written with AI assistance (Claude); human scientific review pending.

Discover answers: *which places on Earth reproduce a given lunar or Martian site, along which
independent dimensions, how sure are we, how rare is it on Earth, and where does the analogy break?*
It searches a measured Earth-wide index, not a hand-picked list.

* Methodology: [METHODOLOGY.md](METHODOLOGY.md) · datasets and gaps: [DATASETS.md](DATASETS.md)
* Actual results and validation numbers: [RESULTS.md](RESULTS.md) (generated from the bundle)
* Limits: [LIMITATIONS.md](LIMITATIONS.md)

## Use it

`make dev`, then open `/#/discover` (first item in the navigation).

1. **Target** — pick one of ten measured planetary targets (six lunar south-pole sites on PGDA LOLA
   5 m DEMs; Jezero, Gale, Oxia Planum, southern Utopia Planitia on the USGS HRSC/MOLA blend). The
   fingerprint card shows its measured terrain statistics with uncertainty, literature geology, solar
   geometry and the temperature reference.
2. **Objective** — a mission profile (general, rover mobility, EVA geology, power/illumination,
   astrobiology) sets dimension weights; *Dimension weights* lets you change them. Not-assessed
   dimensions keep their weight in coverage, so weighting them lowers every score instead of
   rewarding missing data.
3. **Search** — region (whole Earth, Kazakhstan, Central Asia, …), ranking (score, fidelity only,
   or conservative lower bound), evidence filter, geographic diversity.
4. **Candidates** — the map colours every window by score; the list is a diverse shortlist with the
   fidelity interval, coverage and evidence category. Established analog sites are outlined.
5. **Inspect** — per-dimension similarity with 90 % intervals and Earth-wide percentiles, radar
   profile, slope CDFs at the matched baseline, rarity, novelty, lithology, operational axis (kept
   separate from science), the computed gap ledger and a rover experiment.
6. **Compare** — add up to three candidates (`Compare`): matched dimensions side by side.
7. **Simulate** — the rover experiment runs the CF_TERRAMECHANICS model on the candidate's measured
   slope distribution; *Open Mission Lab* and the ASTRAL worlds continue in 3D.
8. **Dossier** — `.md` / `.json` export with bundle hash, weights, all dimension values, gaps, rover
   result, validation summary and reproduction commands; the JSON carries its own SHA-256.

The **research assistant** answers questions (English or Russian) only through allowlisted tools over
the bundle — ranking, explanation, why-rank, comparison, gap ledger, uncertainty, rover experiment,
target fingerprint, validation, Earth→planet, search. Every number it shows is a tool output.

### Optional language model (server-side)

`api/copilot.ts` is a Vercel function that holds `ANTHROPIC_API_KEY` on the server (never in the
browser), fixes the model (`claude-opus-5-5`), system prompt and tool list, and returns one model
turn; the browser executes the tools locally and sends back only their results. Set
`ANTHROPIC_API_KEY` in the deployment environment to enable it; the UI shows whether it is
configured and falls back to the offline tool planner otherwise. Not exercised in this environment
(no key, no Vercel runtime): treat it as an unverified integration path.

### ASTRAL: Earth analog worlds

`make world-earth WINDOW=<window id>` builds a 16 km measured world from Copernicus GLO-30 for any
Earth window of the index (`python -m pipeline.world.scene earth:<id>`: same tile format as the Jezero
world, 32 m finest posting, no orthoimage), a 2-day CSPICE illumination record
(`python -m pipeline.world.illumination earth:<id>`) and packages it. Mission Studio (`#/astral`) then
shows a world picker, and the Discover candidate card links to the window's 3D world, so an Earth
analog and its planetary reference are explored in the same instrument (terrain analysis, slope,
traversability, shadows, rover missions under Earth gravity). Built here: `earth-pilot_boszhira`.

## Reproduce

```bash
make discover-acquire   # ~45 min with 16 workers; public COGs/APIs, no credentials; resumable
make discover           # index -> bundle (128 MC draws) -> validation -> RESULTS.md -> web copy
make discover-check     # tests, bundle reproducibility (rebuild + content hash), TS parity
```

Individual steps: `python -m pipeline.discovery {plan,acquire,context,index,build,validate,report,verify}`.
`acquire` is resumable and records every stage failure with its reason; `verify` rebuilds the bundle in
memory and compares its content hash with the committed one.

## Files

| Path | Content | Committed |
|---|---|---|
| `data/discovery/index/windows.csv` | every acquired window: features (geo-0.1.0 columns) + context | yes |
| `data/discovery/index/manifest.json` | counts, stage outcomes, failures, sources, digests | yes |
| `data/discovery/discovery.json` | compact index, targets, shortlists with explanations, gaps, rover runs | yes |
| `data/discovery/scores/<target>.json` | per-window, per-dimension similarity median / 5 % / 95 % / status | yes |
| `data/discovery/validation.json` | benchmark, ablation, sensitivity, reproducibility | yes |
| `data/derived/egiz-index-1.0.0/` | per-window acquisition records and 50/200 m analysis grids | no (rebuild) |

## Any point on the Moon or Mars (on demand)

`#/discover` → **Any point on the Moon or Mars**: click the planet map or type coordinates. The local
point API (`make discover-serve`, port 8767, proxied by Vite at `/api/point`) runs
`pipeline/discovery/point.py`:

1. reads a 22 km window by HTTP range requests from a global DEM — Mars: USGS HRSC/MOLA blend 200 m;
   Moon: USGS LOLA LDEM 118 m (|lat| ≤ 88°);
2. measures terrain with the unchanged geodata stage (400 m fine baseline, 200 m regional grid);
3. scores every Earth window with the same Monte Carlo dimensions, aggregation and diversification as
   the curated targets. Geology, mineralogy, dust, ice and subsurface stay `not_assessed` at points.

New point: ~30 s (Mars) / ~60 s (Moon); repeated point: < 1 s. CLI:
`python -m pipeline.discovery point --body mars --lon -72.5 --lat -7`.

## AlphaEarth (Earth side only)

`pipeline/discovery/alphaearth.py` uses Google DeepMind AlphaEarth satellite embeddings
(`GOOGLE/SATELLITE_EMBEDDING/V1/ANNUAL`, 64-d, 10 m, yearly from 2017). They exist only for Earth,
so they are never compared with a planetary point. They are used to:

* **expand** — rank Earth windows by cosine similarity to the best *physical* matches (finds places
  that look the same from orbit but the terrain ranking missed); needs
  `python -m pipeline.discovery alphaearth-index` once (cached in `data/discovery/alphaearth/`);
* **stability** — year-to-year embedding cosine of a window (flooding, vegetation, construction);
* **zones** — unsupervised k-means of one window into surface zones (map tiles).

Credentials: `EE_PROJECT` (default `deft-cove-409713` in the Makefile) and either
`EE_SERVICE_ACCOUNT_KEY=/path/to/key.json` (kept outside the repo; default `~/.config/egiz/ee-key.json`)
or `earthengine authenticate`.

## Physical properties at the point (orbital maps)

`pipeline/discovery/planetary_props.py` reads, in the same 22 km window, real USGS Astrogeology
rasters (no values are filled in where a product has no coverage):

| Body | Property | Product |
|---|---|---|
| Moon | FeO, plagioclase, olivine, clino-/orthopyroxene, OMAT | SELENE/Kaguya MI mineral maps, 4 ppd, 50° S–50° N (Lemelin et al. 2019) |
| Moon | FeO fallback | Clementine UVVIS FeO, 1 km, 70° S–70° N (Lucey et al. 2000) |
| Moon | ice favorability index | USGS Lunar Research polar maps, \|lat\| ≥ 80° |
| Mars | bolometric Lambert albedo | MGS TES albedo, 7.4 km (Christensen et al. 2001) |

Geology classes are then **inferred** with a-priori thresholds (mare basalt FeO ≥ 13 wt %, highlands
FeO ≤ 8 wt % or plagioclase ≥ 70 %, olivine-rich ≥ 20 %; Mars dust-mantled TES albedo ≥ 0.22), so the
geology dimension is scored at points. A point-only **surface albedo** dimension compares Mars TES
albedo with Earth broadband surface albedo from NASA POWER (CERES SYN1deg 2001–2025, 1°),
acquired once for all windows with `python -m pipeline.discovery earth-albedo`
(`data/discovery/index/earth_albedo.csv`). Point-only dimensions are kept out of the published bundle,
whose content hash is unchanged. Rejected: the LOLA 10 ppd "albedo" mosaic (an 8-bit rendering).

## Physics → AlphaEarth bridge

`pipeline/discovery/bridge.py` trains, on Earth windows, a ridge regression from features measurable on
both worlds (terrain statistics, albedo, exposed ground, precipitation, noon Sun elevation) to the
AlphaEarth embedding, validated by 5-fold CV over 10° spatial blocks. A planetary point is projected and
searched by cosine similarity; its Mahalanobis distance to the training data is reported and a point
beyond the 99th percentile is labelled an extrapolation, not a match. Train with
`python -m pipeline.discovery alphaearth-bridge` after `alphaearth-index`.
