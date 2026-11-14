# Competition and demo record · 18 October 2026

EGIZ is being developed now as an independent project at the user's explicit instruction. Implementation started 15 October; the present work occurred 17–18 October, before the event. This record is not organizer authorization. Existing materials must never be described as created during the hackathon. Eligibility and possible use of prior work require an organizer determination; no automatic eligibility or automatic disqualification is asserted.

## Current official sources checked

Direct research-tool fetches returned 502/403 for some Space Apps pages. The actual visible [2026 Participant FAQ](https://www.spaceappschallenge.org/resources/participant-faqs/) (dated 13 October) and [Team Formation Guide](https://www.spaceappschallenge.org/resources/team-formation-guide/) were therefore read in the browser on 18 October, Asia/Almaty time. This is a fresh check in addition to the historical 15 October audit.

- Event: 14–15 November 2026. The team guide sets project start at 09:00 local time on 14 November and submission at 23:59 local time on 15 November; Universal Event uses the team creator's local time.
- The FAQ and team guide prohibit early challenge work. The user's independent-development instruction does not change that published restriction.
- Full challenge statements/resources are scheduled for 28 October; submission and judging/awards guides for 13 November. Format limits, public-link rules and detailed award rubrics must be verified when released. The old seven-slide/30-second plan remains a provisional historical reference, not a newly confirmed 2026 requirement.
- The currently visible FAQ allows AI tools and requires describing their use in the project submission. The repository's AI log and disclosure remain necessary; future guides may add details.
- The [actual analog challenge page](https://www.spaceappschallenge.org/2026/challenges/identify-earth-locations-that-analog-the-permanent-moon-base-locations-and-mars/) currently supplies a summary: use open Earth/Moon/Mars data to identify and characterize terrestrial analogs. A new hypothesis from nine windows does not establish global discovery. The full resource list is not yet present.

No sign-in, registration, submission, external publication or organizer communication was performed. No team contributions or scientific approvals were invented. [Previous official audit](competition/CURRENT_RULES_AUDIT_2026_10_15.md) and [unsent clarification draft](competition/ORGANIZER_CLARIFICATION_DRAFT.md) remain intact.

## Demonstration using actual outputs

1. Run `make dev`; explicitly choose **Measured terrain pilot**. State nine Earth windows, two targets, partial evidence and unvalidated status.
2. Select the lunar target. Compare site budgets: coverage rises 0.185 → 0.243 → 0.268 through complementary windows.
3. In **When does the best site change?**, retain Landing hazard rehearsal vs EVA and field geology. At 10% priority on the second objective, Rio Tinto leads. At 50%, Death Valley leads. The exact model switch is 16.97%.
4. Apply a scenario. The one-site campaign uses those same objectives/weights. Open its dossier to inspect 100 m baseline measurements, actual terrain surfaces, transect, histogram, nodata and source fingerprints.
5. Export analysis JSON and a Markdown field verification checklist. Explain what measurements remain necessary.
6. Inspect the water-dominated Kazakhstan window: mapped 95.9% water makes it ineligible despite flat topography. Select Jezero. Iceland leads for the first two objectives throughout their preference interval. A complementary Wadi Rum window improves the campaign when the third terrain/cover objective is included. Show missing geological/environment evidence rather than implying a complete analog.

## Concise pitch draft

**Problem:** Testing on Earth requires choosing which planetary conditions a field site can reproduce. A landscape that looks similar may support the wrong test.

**Current limitation:** Curated analog galleries and GIS data help inspect places; a mission team still needs explicit trade-offs and evidence for its test objectives. This is a documented scope comparison, not a claim that all competitors lack optimization.

**Solution:** EGIZ builds a small complementary test campaign, shows each site's role and records what Earth cannot reproduce.

**Innovation demonstrated:** Exact priority switches reveal why the preferred site changes. Source-bound terrain views and exports make that reasoning inspectable.

**Science:** NASA PGDA lunar elevations, USGS MOLA–HRSC Mars elevations, Copernicus Earth surface elevations and ESA WorldCover land cover are processed on stated metric grids. Transparent model functions supply task scores. The nine-window pilot is exploratory.

**Demo:** Move the lunar objective balance through 16.97%; inspect the actual competing windows and export the evidence. Compare a Mars scenario where the same window stays preferred.

**Impact:** The workflow can help formulate candidate field investigations and identify missing measurements. It does not authorize missions or replace field expertise.

**Future:** Expand sampling, acquire environment/geology and propagate source uncertainty; validate against independent field practice with scientific review.

## Readiness checklist

| Item | Current state |
| --- | --- |
| Local functioning application / scientific computation | Verified within recorded scope |
| Traceable genuine pilot / clearly separate fixtures | Implemented and checked |
| Explainable counterfactual / evidence / research export | Implemented and checked |
| Reproducibility / limitations / AI disclosure | Recorded |
| Global dataset and independent validation | Incomplete; external inputs and review required |
| 2026 full statement / final submission guide | Await scheduled release and recheck |
| Prior-work eligibility | Unresolved with organizers |
| Public demo/repository, final submission, rehearsals | Not performed or claimed |

Existing presentation files and scripts in `submission/` are retained as historical drafts, not silently relabeled as a current measured-data presentation. This document supplies a truthful updated demo and outline; final media must be updated and verified against the released format.
