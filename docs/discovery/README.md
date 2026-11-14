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
