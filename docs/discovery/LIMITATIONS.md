# EGIZ Discovery Engine — limitations

Written with AI assistance (Claude); human scientific review pending.

* **Similarity is not validation.** A high score says the measured dimensions resemble the target; it
  does not establish that a site is suitable or safe for a test, and no candidate has been visited.
  Newly ranked windows are computational candidates that need field verification.
* **Four dimensions are not assessed** (mineralogy, wind/dust, ice/permafrost, caves/lava tubes): no
  dataset was acquired. They lower coverage for every window equally; they are never imputed.
* **Proxies.** Lithology is a Macrostrat map category at the window centre (map scale recorded);
  target geology is a literature classification; neither is a mineral identification. Exposure is
  derived from land-cover classes. Earth temperature is modelled 2 m air temperature (0.5° climatology),
  not land-surface temperature; Mars uses a body-level air-temperature reference (Viking Lander 1
  site), the Moon has no comparable quantity and is handled in the gap ledger only.
* **Resolution.** Earth terrain from GLO-30 (30 m) on 50/200 m grids; lunar targets from 5 m LOLA;
  Mars targets from the 200 m HRSC/MOLA blend, which is smoother than its posting — a 25 % relative
  uncertainty is applied to its fine-baseline slopes, and fine-baseline roughness for Mars uses TRI
  only. Rover-scale (< 10 m) obstacles are not resolved anywhere.
* **Population.** Percentiles and rarity refer to the global lattice (220 km near-equal-area sample of
  land, 80 S–84 N). Windows on the same 22 km footprint can still overlap between the regional lattice,
  benchmark sites and geo-0.1.0; diversity filtering prevents near-duplicates in shortlists.
* **Windows partly over sea or ice** fail QA stages (recorded in the index manifest); WorldCover has no
  tiles over Antarctica, so Antarctic windows lack exposure and land cover.
* **Tolerances** (3° slope W1, factor-2 roughness, 150 mm precipitation, 25 K thermal gap, shrinkage
  0.3) were fixed a priori and are documented; other choices would change rankings. Weight sensitivity
  is reported in the validation record.
* **Benchmark labels are imperfect** and few (5 lunar, 10 Martian positives): analog campaigns were
  sited for logistics, training and geology as much as for similarity to one target region. AUC values
  are descriptive, not proof.
* **Rover experiment** is a static Bekker model with an assumed lunar soil, equal wheel loads and no
  gravity-dependent soil strength; the direction of the gravity effect is contested in the literature.
* **Optional language model** integration (`api/copilot.ts`) was not exercised here (no key, no
  Vercel runtime). The offline tool planner is keyword-based.
* **Impact structures** come from Wikidata (community-curated; may include unconfirmed structures).
