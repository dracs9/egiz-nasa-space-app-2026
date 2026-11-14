# План файлов

Каждый файл решения: назначение, владелец, зависимости, публичный интерфейс, задача-создатель и тесты. Пустые файлы «для красоты» не создаём: файл появляется в задаче, которая его наполняет. До 14.11 09:00 существуют только `docs/`, `project/`, `tools/`, `.claude/`, корневые документы.

## 1. Корень

| Файл | Назначение | Владелец | Задача | Тесты |
| --- | --- | --- | --- | --- |
| `Makefile` | Цели: `check`, `test`, `fixtures`, `earth`, `data`, `web`, `offline` | A | INFRA-01 | `make check` в CI |
| `pyproject.toml` | ruff, pytest (testpaths = pipeline) | A | INFRA-01 | — |
| `requirements.txt` | earthengine-api, rasterio, pyproj, numpy, pandas, scipy, matplotlib, pillow, jsonschema, pytest, ruff, astropy (тесты) | A | INFRA-01 | `pip install` в CI |
| `LICENSE` | MIT, «<team name> contributors» | A | INFRA-01 | — |
| `vercel.json` | Сборка и каталог `web/dist` | A | INFRA-05 | Превью PR |
| `.github/workflows/ci.yml` | tasks validate, ruff, pytest, typecheck, vitest, build, поиск секретов | A | INFRA-04 | Зелёный прогон |
| `README.md` | Сейчас — для команды; к подаче — для жюри (EN) | A, C | SUB-01 | Ссылки в инкогнито |
| `.gitignore` | Добавить `web/public/data/`, `data/raw/`, `*.mp4` | A | INFRA-01 | — |

## 2. Контракты — MEMBER_A

| Файл | Интерфейс | Задача | Тесты |
| --- | --- | --- | --- |
| `contracts/earth_candidates.schema.json`, `targets…`, `mission_templates…`, `sun_windows…`, `results…`, `validation…` (+ P1: `shadows…`, `robustness…`) | JSON Schema Draft 2020-12 по API_AND_SCHEMA_CONTRACTS §2 | INFRA-02 | Примеры проходят |
| `contracts/examples/*.json` | Пример для каждой схемы (`FAKE_`) | INFRA-02 | Валидатор |
| `pipeline/__init__.py`, `pipeline/common/__init__.py` | Пакеты | INFRA-01 | — |
| `pipeline/contracts/validate.py` | `validate_file`, `check_no_synthetic`, CLI `python -m pipeline.contracts.validate` | INFRA-02 | `pipeline/contracts/tests/test_validate.py` |
| `pipeline/contracts/models.py` | TypedDict-модели | INFRA-02 | mypy не нужен; ruff |
| `pipeline/contracts/fixtures.py` | `generate(seed=42)` | INFRA-03 | Все фикстуры валидны |
| `data/fixtures/*.json` | Синтетика по всем схемам (`FAKE_GL_`, `FAKE_PR_`, `FAKE_CT_`) | INFRA-03 | Валидатор |
| `web/src/types/contracts.ts` | TS-интерфейсы §2–§3 | INFRA-02 | `tsc --noEmit` |

## 3. Общие функции

| Файл | Владелец | Интерфейс | Задача | Тесты |
| --- | --- | --- | --- | --- |
| `pipeline/common/terrain.py` | D | `slope_at_offset`, `terrain_attributes`, `tri` | TERR-01 | `pipeline/common/tests/test_terrain.py` |
| `pipeline/common/sun.py` | C | `sun_position`, `lowsun_windows`, `h_max_moon` | LIGHT-01 | `pipeline/common/tests/test_sun.py` (E1, astropy) |
| `pipeline/common/shadows.py` | C | `cast_shadow`, `shadow_fraction_curve` | LIGHT-03 (P1) | `test_shadows.py` (E8a) |
| `pipeline/common/render.py` | C | `render_same_sun(z, p, h, az, out)` | LIGHT-04 (P1) | `test_render.py` |

## 4. Земля — MEMBER_B

| Файл | Интерфейс | Задача | Тесты |
| --- | --- | --- | --- |
| `pipeline/earth/__init__.py` | — | EARTH-01 | — |
| `pipeline/earth/pool.py` | `build_pool` + CLI `python -m pipeline.earth.pool` | EARTH-01 | `tests/test_pool.py` (ID, размер, seed) |
| `pipeline/earth/gee_terrain.py` | `stage_a`, `stage_b` + CLI | EARTH-02 | `tests/test_gee_terrain.py` (зоны UTM, геометрия квадрата) |
| `pipeline/earth/crosscheck.py` | Сверка GEE и Python (E2b), NASADEM (P2) | EARTH-05, EARTH-09 | `tests/test_crosscheck.py` |
| `pipeline/earth/gee_env.py` | `environment` | EARTH-03 | `tests/test_units.py` |
| `pipeline/earth/export.py` | `export_candidates` → `data/processed/earth_candidates.json` | EARTH-04 | Валидатор |
| `pipeline/earth/sanity.py` | Проверки здравого смысла | EARTH-05 | Отчёт в PROGRESS |
| `pipeline/earth/gee_snow.py` | `snow_free_frac` по месяцам | EARTH-06 (P1) | Единицы, диапазоны |
| `pipeline/earth/kz.py` | Квадраты Казахстана (`KZ_`) | EARTH-07 (P1) | ID и граница LSIB |
| `pipeline/earth/dem_windows.py` | DEM 30 м для коротких списков → `data/raw/earth_dem30/` | EARTH-08 (P1) | Размер и проекция |

## 5. Цели и освещение — MEMBER_C

| Файл | Интерфейс | Задача | Тесты |
| --- | --- | --- | --- |
| `pipeline/planets/access.py` | `read_window`, `to_local_grid`, CLI `spike` | PLNT-01 | `tests/test_access.py` (синтетический GeoTIFF) |
| `pipeline/planets/targets.py` | `build_targets` → `data/processed/targets.json` | PLNT-02, PLNT-03, PLNT-04 | Валидатор; E9 — таблица баз |
| `pipeline/planets/clones.py` | Разброс атрибутов на клонах PGDA | PLNT-05 (P2) | Детерминированность |
| `pipeline/lighting/__init__.py` | — | LIGHT-02 | — |
| `pipeline/lighting/windows.py` | `sun_windows.json` для целей Луны × широтных полос 0,1° | LIGHT-02 | Валидатор; размер ≤ 1 МБ на цель; поиск полосы по широте |
| `pipeline/lighting/shadow_curves.py` | `shadows.json` для цели и коротких списков | LIGHT-03 (P1) | Валидатор |
| `pipeline/lighting/renders.py` | `web/public/img/twin/*.webp` + `manifest.json` | LIGHT-04 (P1) | Число файлов и размеры |
| `pipeline/lighting/illum_check.py` | Сверка с PGDA (E8b) | LIGHT-05 (P2) | Отчёт |

## 6. Движок и проверки — MEMBER_D

| Файл | Интерфейс | Задача | Тесты |
| --- | --- | --- | --- |
| `pipeline/engine/__init__.py` | — | ENG-01 | — |
| `pipeline/engine/templates.py` | `load_templates` → `data/processed/mission_templates.json` | ENG-01 | Ошибки CSV с номером строки |
| `pipeline/engine/fidelity.py` | `attribute_fidelity`, `objective_fidelity`, `fidelity_table` | ENG-01 | `tests/test_fidelity.py` |
| `pipeline/engine/campaign.py` | `shortlist`, `exact_best`, `greedy`, `design`, `gap_ledger` | ENG-02 | `tests/test_campaign.py` (E4) |
| `pipeline/engine/run.py` | `main` → `data/processed/results.json` | ENG-03 | E10 (повторный запуск) |
| `pipeline/engine/validate_practice.py` | E3 + сводка E1, E2, E4 → `validation.json`, `data/processed/figures/` | VAL-01 | `tests/test_validate_practice.py` (синтетика с известным рангом) |
| `pipeline/engine/controls.py` | E7: отрицательные контроли и случайные кампании → раздел `validation.json` | VAL-02 | `tests/test_controls.py` (seed) |
| `pipeline/engine/explain.py` | Детерминированные фразы | ENG-04 (P1) | `tests/test_explain.py` (числа во фразах = данным) |
| `pipeline/engine/golden.py` | `data/fixtures/golden_fidelity.json`, `data/fixtures/golden_campaign.json` | ENG-05 (P1) | Их читают тесты Vitest |
| `pipeline/engine/robustness.py` | E5 → `robustness.json` | VAL-03 (P1) | seed → тот же результат |
| `pipeline/engine/ablation.py` | E6 → раздел в `validation.json` | VAL-04 (P1) | — |

## 7. Курируемые данные — MEMBER_E

`data/curated/targets.csv` (SCI-01, SCI-04), `mission_templates.csv` и `gap_alternatives.csv` (SCI-02), `practice_sites.csv` (SCI-03), `sources.csv` (все), `limitations.md` (SCI-06), `geology_tags.csv` (SCI-07, P1), `data/curated/dossiers/` (SCI-08, P1). Колонки — DATASET_SPECIFICATION §5. Проверка: чтение скриптами владельцев без ошибок; у каждого значения ключ источника.

## 8. Сайт

| Файл или папка | Владелец | Назначение | Задача | Тесты |
| --- | --- | --- | --- | --- |
| `web/package.json`, `vite.config.ts`, `tsconfig.json`, `index.html` | A | Сборка | INFRA-01 | build |
| `web/scripts/copy-data.mjs` | A | prebuild: `data/processed` → `public/data`; при отсутствии — фикстуры | INFRA-05 | — |
| `web/src/main.tsx`, `App.tsx`, `routes.ts` | A | Маршруты `#/…` | WEB-01 | Vitest: маршрутизация |
| `web/src/state/store.ts` | A | Zustand-store (контракт §3) | WEB-01 | Vitest |
| `web/src/data/load.ts` | A | Загрузка и проверка версий, `DataLoadError` | WEB-01 | Vitest: версия, синтетика |
| `web/src/styles/tokens.css`, `global.css` | A | Токены DESIGN_SYSTEM | WEB-01 | Lighthouse |
| `web/src/components/layout/` | A | Шапка, подвал, плашки | WEB-01 | — |
| `web/src/components/brief/` | A | Экран S1 | WEB-02 | Vitest: кнопка неактивна без задач |
| `web/src/components/map/` | A | Карта S2 | WEB-03 | Профилирование |
| `web/src/components/campaign/` | C | ObjectivesPanel, Frontier, CampaignCard, GapLedger | WEB-04 | Vitest: числа из данных |
| `web/src/components/site/` | D | SitePanel, AttributeRow, LightingMonths | WEB-05 | Vitest |
| `web/src/pages/EvidencePage.tsx`, `web/src/components/evidence/` | B | Экран S6 | WEB-06 | Vitest: статус экспериментов |
| `web/src/components/twin/`, `web/src/pages/TwinPage.tsx` | A | S5 (P1) | WEB-07 | — |
| `web/src/components/matrix/` | D | S4 (P1) | WEB-08 | — |
| `web/src/lib/fidelity.ts`, `campaign.ts`, `web/src/workers/campaign.worker.ts` | D | Пересчёт в браузере (P1) | ENG-05 | Golden, время |
| `web/src/lib/useLiveCampaign.ts` | D | Хук: store → воркер → кампания (P1) | WEB-09 | Совпадение с предрасчётом при исходных весах |
| `web/src/components/kz/` | A | Режим «Казахстан» (P1) | WEB-10 | — |
| `web/src/components/twin3d/` | A | 3D-рельеф (P3, необязательно) | WEB-12 | Сборка не ломается |
| `web/src/content/copy.json` | F | Тексты | STORY-02 (P1); в P0 — тексты пишет A по SCREEN_BY_SCREEN_SPEC | — |
| `web/public/fonts/` | A | Inter, IBM Plex Mono (OFL) | WEB-01 | — |
| `web/public/img/twin/` | C | Картинки «То же Солнце» | LIGHT-04 | — |

## 9. Подача

`submission/brand.md` (F, STORY-01); `submission/slides_draft.md` (F, STORY-03); `slides.pdf`, `links.md` (F, STORY-06); `project_page.md` (F, SUB-02, SUB-07); `video_script.md`, `video.srt` (F, STORY-05); `references.md` (B, SUB-03); `ai_use.md` (C, SUB-04); `claims.md`, `qa.md` (E, SCI-09, SCI-10).

## 10. Порядок появления файлов (критический для параллельной работы)

1. Сб 09:30–11:30: каркас, контракты, фикстуры (A); `terrain.py` (D); `access.py` (C); `pool.py` (B); CSV целей и шаблонов (E).
2. Сб 11:30–14:30: `store.ts`, `load.ts`, `brief/`, `map/` (A); `fidelity.py`, `campaign.py` (D); `sun.py`, `targets.py` (C); `gee_terrain.py`, `gee_env.py` (B).
3. Сб 14:00–17:30: `windows.py` (C, 14:00); `export.py`, `crosscheck.py`, `sanity.py` (B); `run.py`, `validate_practice.py`, `controls.py` (D); `campaign/` (C); деплой (A).
4. Вс 09:00–11:00: `site/` (D), `evidence/` (B), P1-файлы при сценарии S2.
