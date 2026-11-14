# EGIZ ASTRAL — current-state audit

Audit of `main` at `a9daf68` (clean tree) on 2026-11-13, before any ASTRAL change. AI-assisted; human review pending.

## What the repository contained

| Area | Found | Where |
|---|---|---|
| Web app | React 19, TypeScript 7, Vite 8, Three.js 0.186, MapLibre, Zustand, Open MCT | `web/package.json` |
| Mission Lab | Launch / descent / rover / EVA scenarios, A* routing, drivetrain screen, replay | `web/src/mission/*` |
| 3D scene | One Three.js runtime: regional mesh, 180 m local patch, NASA GLB reference assets | `web/src/mission/scene/*` |
| Terrain data | 200 m grids over 20 km windows for 11 sites; a 40/20/10 m LOLA pyramid for Mons Mouton | `data/pilot/mission_terrain.json`, `data/terrain/moon-mouton` |
| Illumination | CSPICE geometry via SpiceyPy, 24 h at 600 s per site | `pipeline/science/spice.py` |
| Analog engine | Fidelity matrix, campaign optimiser, robustness studies | `pipeline/engine/*`, `web/src/lib/*` |
| Native dynamics | Optional MuJoCo / Basilisk reference runs | `pipeline/dynamics/*` |

## Differences from the takeover brief

- **ATLAS-Π is not in this branch.** No module, route or test carries that name; it appears only in planning documents. Nothing was rebuilt or duplicated; the existing analog-fidelity engine remains the deterministic authority.
- **No machine-learning model and no AI assistant existed.**
- The brief's test counts (191 Python / 187 web) describe another checkout. This one started with 180 web tests and a Python suite of 135 passing with 17 skipped (optional MuJoCo/Basilisk) and the SPICE tests skipped for lack of kernels.
- Raw source rasters (`data/raw`) and SPICE kernels are git-ignored and were absent.

## Why the existing 3D looked inadequate (root causes read from the code)

1. **Resolution.** `makeTerrain` draws 100 × 100 cells of 200 m. The Jezero source was the 200 m MOLA–HRSC blend; nothing under a few hundred metres existed in the scene.
2. **No imagery.** Surface colour is a 256 px value-noise texture repeated every 8 m (`surfaceTexture`), declared illustrative.
3. **The close-range patch is interpolation.** `makeLocalSurface` resamples the same 200 m grid onto a 3 m mesh: more vertices, no more information.
4. **Rocks are decoration.** 160 hashed icosahedra, explicitly excluded from collision and routing.
5. **Lighting is partly art-directed.** Without a SPICE record the Sun is a slider; the shadow frustum is 36 m wide around the vehicle, so terrain never shadows terrain.
6. **No level of detail or streaming.** One mesh, fully loaded.
7. **Simulation used the same 200 m grid**, so a rover planned over cells larger than most hazards.

## Shared files touched

`web/src/App.tsx`, `web/src/state/store.ts`, `web/src/components/SiteHeader.tsx`, `web/src/guide/topics.ts`, `web/src/content/copy.json`, `web/src/i18n/ru.json`, `web/package.json`, `.gitignore`, `Makefile`. Each change is additive: one route, one nav entry, two translations, one build step, one make target. Everything else is new under `web/src/astral`, `web/tests`, `web/scripts/copy-world.mjs`, `pipeline/world`, `tests/test_world.py`, `data/world`, `docs/astral`.
