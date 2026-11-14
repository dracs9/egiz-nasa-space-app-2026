# Контракты данных и интерфейсов (v1)

Владелец: MEMBER_A. Эти описания — источник для JSON Schema (`contracts/*.schema.json`) и типов TypeScript (`web/src/types/contracts.ts`) в задаче INFRA-02. Все числа в примерах **выдуманы для формата** и не являются данными NASA.

## 1. Общие правила

| Правило | Значение |
| --- | --- |
| Формат | JSON UTF-8; числа — float, округлённые до 4 значащих знаков; ID — `[A-Z0-9_]+` |
| Обязательные поля каждого файла | `schema` (имя), `version` (semver, старт `1.0.0`), `generated_at` (ISO UTC), `synthetic` (bool), `provenance` (массив) |
| `provenance[]` | `{dataset, provider, version, url, role, period?}` |
| Пропуски | `null` + перечисление в `missing[]`; ноль пропуском не считается |
| Версии | major — несовместимо (сайт отказывает с понятной ошибкой); minor — новые необязательные поля (старые клиенты игнорируют); patch — описание |
| Изменение после заморозки v1 (Сб 11:00) | Протокол DEVELOPMENT_WORKFLOW §7 |
| Проверка | Python: `python -m pipeline.contracts.validate FILE…` (jsonschema Draft 2020-12). TypeScript: guard-функции в `web/src/data/load.ts` |

Ключи атрибутов (одинаковые для Земли и целей, где применимо):

```text
slope_f100_p50_deg  slope_f100_p90_deg  frac_lt10_f100  frac_lt20_f100  tri_f100_m
slope_f400_p50_deg  slope_f400_p90_deg  frac_lt10_f400  frac_lt20_f400  tri_f400_m
slope_r_p50_deg     slope_r_p90_deg     frac_lt20_r     relief_m        elev_min_m
precip_mm  bare_frac  t_min_c  t_max_c
```

## 2. Файлы

### 2.1 `earth_candidates.json` — схема `egiz.earth_candidates` (производитель B; потребители D, A, C)

```ts
interface EarthCandidates extends Envelope {
  tiles_hash: string;              // sha256 от отсортированного списка id
  tiles: EarthTile[];
}
interface EarthTile {
  id: string;                      // GL_E161.50_S77.50 | PR_JETT_SP_CRATER | KZ_E051.20_N43.40 | CT_FOREST_E010.20_N61.40
  pool: "global" | "practice" | "kazakhstan" | "control";   // control — только для E7, в кампаниях не участвует
  stratum: "hot_desert" | "cold_polar" | "volcanic" | "other_open" | null;
  name: string | null;             // только у мест практики
  country: string | null;          // LSIB
  lon: number; lat: number;        // центр, WGS84
  attrs: Partial<Record<AttrKey, number | null>>;
  context: { tree_frac: number|null; crop_frac: number|null; built_frac: number|null;
             water_frac: number|null; snow_frac: number|null; pop_density?: number|null };
  snow_free_frac?: (number | null)[];   // 12 месяцев, P1 (minor 1.1)
  missing: AttrKey[];
}
```

Пример (форма):

```json
{"schema":"egiz.earth_candidates","version":"1.0.0","generated_at":"2026-11-14T10:00:00Z","synthetic":false,
 "provenance":[{"dataset":"COPERNICUS/DEM/GLO30","provider":"ESA","version":"GLO-30","url":"…","role":"terrain"}],
 "tiles_hash":"…","tiles":[{"id":"GL_E161.50_S77.50","pool":"global","stratum":"cold_polar","name":null,"country":"Antarctica",
 "lon":161.5,"lat":-77.5,"attrs":{"slope_f100_p50_deg":9.1,"frac_lt10_f100":0.55,"slope_r_p50_deg":4.2,"relief_m":1250,
 "precip_mm":40,"bare_frac":0.81,"t_min_c":-55.0,"t_max_c":5.0},"context":{"tree_frac":0,"crop_frac":0,"built_frac":0,
 "water_frac":0.02,"snow_frac":0.15},"missing":[]}]}
```

Правила: `-90 ≤ lat ≤ 90`; `-180 ≤ lon ≤ 180`; доли в `[0,1]`; уклоны в `[0,90]`; `id` уникальны; `pool = practice` ⇒ `name ≠ null`; `pool = control` ⇒ id начинается с `CT_`, движок считает F_o, но не включает квадрат в короткий список и кампании.

### 2.2 `targets.json` — схема `egiz.targets` (C; потребители D, A)

```ts
interface Targets extends Envelope { targets: Target[] }
interface Target {
  id: string;                      // MOON_MONS_MOUTON | MARS_JEZERO
  body: "moon" | "mars";
  name: string; kind: "base_region" | "landing_site" | "validation_only";
  lon: number; lat: number;        // планетоцентрические, восточная долгота
  dem_product: string;             // "PGDA LOLA 5mpp site 20" | "MOLA-HRSC blend 200m v2"
  fine_baseline_m: 100 | 400;
  attrs: Partial<Record<AttrKey, number | null>>;   // precip_mm=0, bare_frac=1 по определению
  attr_sources: Record<string, string>;            // ключ атрибута → "computed:<product>" | ключ из sources.csv
  h_max_deg: number | null;        // только Луна
  templates: string[];             // ["MOON_BASE_OPS"]
  image?: string | null;           // P1
}
```

### 2.3 `mission_templates.json` — схема `egiz.mission_templates` (D собирает из CSV MEMBER_E)

```ts
interface MissionTemplates extends Envelope {
  params: { shortlist_per_objective: 20; missing_weight_max: 0.3; gap_threshold: 0.1; k_max: 3 };
  templates: { id: string; body: "moon"|"mars"; name: string; objectives: Objective[] }[];
  gap_alternatives: { gap: string; body: "moon"|"mars"|"both"; alternative: string; source: string }[];
}
interface Objective {
  id: string;                      // O1…O5 | M1…M4
  name: string; description: string; weight_default: number;
  attributes: { attr: AttrKey | "light" | "shadow" | "geology"; fn: "match"|"logmatch"|"at_most"|"at_least"|"colder"|"category"|"light";
                params: Record<string, number>; weight: number; needs_target: boolean; priority: "P0"|"P1" }[];
  constraints: { attr: string; op: "<=" | ">="; value: number }[];
}
```

### 2.4 `sun_windows.json` — схема `egiz.sun_windows` (C; потребитель D, A, C)

```ts
interface SunWindows extends Envelope {
  model: { algorithm: "NOAA"; refraction: true; step_min: 10; year: 2025; lat_step_deg: 0.1 };
  lat_bins: number[];                 // центры полос: −89.95, −89.85, …, 89.95 (1 800 значений)
  targets: { target: string; h_max_deg: number;
             hours_low: number[][];   // [полоса][месяц 1–12], часов в сутки с 0° < h ≤ h_max
             sweep_deg: number[][] }[];  // [полоса][месяц], диапазон азимутов при низком Солнце
}
```

Окна зависят только от широты, поэтому файл строится по широтным полосам, а не по ID кандидатов: он не ждёт данных Земли (LIGHT-02 не зависит от EARTH-04) и подходит для любых новых квадратов (`PR_`, `KZ_`). Потребитель находит полосу так: `i = clamp(floor((lat + 90) / 0.1), 0, 1799)`. Ошибка от ширины полосы 0,1° (≈ 11 км) пренебрежимо мала по сравнению с квадратом 20 км (проверка — тест LIGHT-02).

### 2.5 `results.json` — схема `egiz.results` (D; потребители A, B, C, F)

```ts
interface Results extends Envelope {
  engine_version: string;
  inputs: { earth_candidates_sha256: string; targets_sha256: string; templates_sha256: string; sun_windows_sha256: string };
  runs: Run[];
}
interface Run {
  target: string; template: string;
  fidelity: Record<string /*objective*/, Record<string /*tile id*/, FidelityCell>>;
  campaigns: Campaign[];                     // k = 1, 2, 3
  gaps: { attribute: { objective: string; attr: string; ceiling: number }[];
          objective_ceiling: Record<string, number>;
          physical: { gap: string; alternative: string; source: string }[] };
}
type FidelityCell = { F: number; partial: boolean; parts: Record<string, number | null>; best_month?: number }
                  | { F: null; reason: "missing" | "constraint" };
interface Campaign {
  k: 1 | 2 | 3; coverage: number;
  sites: { id: string; roles: string[]; best_month: number | null }[];
  per_objective: { objective: string; site: string | null; F: number | null }[];
  method: { shortlist_size: number; pool_size: number; exact_coverage: number; greedy_coverage: number; merged_greedy: boolean };
  explain?: Record<string, string[]>;        // P1, детерминированные фразы
}
```

Чтобы файл оставался небольшим, в `fidelity` хранятся все допущенные кандидаты, а `parts` — только для коротких списков (≤ 120). Для остальных `parts` опускается (minor-совместимо).

### 2.6 `validation.json` — схема `egiz.validation` (D; потребители B, C, F, E)

```ts
interface Validation extends Envelope {
  preregistration_commit: string;
  experiments: { id: "E1"|"E2"|"E3"|"E4"|"E5"|"E6"|"E7"|"E8"|"E9"|"E10"; hypothesis: string;
                 metric: string; value: number | Record<string, number> | null;
                 status: "confirmed" | "not_confirmed" | "inconclusive" | "not_run"; notes: string }[];
  practice_pairs: { site: string; tile: string; objective: string; target: string; source: string;
                    testable: boolean; exclusion_reason: string | null; rank: number | null; n: number | null; pct: number | null }[];
  baselines: { name: "aridity_only" | "random" | "v1_similarity"; median_pct: number | null }[];
  controls: { name: string; value: number | null }[];
  figures: string[];
}
```

### 2.7 P1-файлы

- `shadows.json` (`egiz.shadows`, C): `{grid: {h_deg: number[]; az_deg: number[]}, items: {id: string; kind: "target"|"tile"; sf: number[][]}[]}`.
- `robustness.json` (`egiz.robustness`, D): `{runs: 200, seed: 2026, selection_freq: Record<target, Record<tile, number>>, jaccard_median: Record<target, number>}`.
- `img/twin/manifest.json` (C): `{items: {id: string; h_deg: number; az_deg: number; file: string; px_m: 30}[]}`.

## 3. Интерфейсы приложения

```ts
// web/src/state/store.ts (A)
interface AppState {
  data: { candidates: EarthCandidates; targets: Targets; templates: MissionTemplates;
          sun: SunWindows | null; results: Results; validation: Validation | null; shadows?: Shadows };
  targetId: string; templateId: string; enabledObjectives: string[]; weights: Record<string, number> | null;
  k: 1 | 2 | 3; focusObjective: string | null; selectedSite: string | null; lens: "global" | "kazakhstan";
  setTarget(id: string): void; toggleObjective(id: string): void; setWeights(w: Record<string, number> | null): void;
  setK(k: 1|2|3): void; focus(o: string | null): void; selectSite(id: string | null): void; setLens(l: "global"|"kazakhstan"): void;
}

// web/src/workers/campaign.worker.ts (D, P1) — протокол сообщений
type WorkerRequest  = { type: "optimize"; F: Float32Array; nSites: number; nObj: number; W: number[]; k: 1|2|3; shortlist: number[] };
type WorkerResponse = { type: "result"; sites: number[]; coverage: number; ms: number }
                    | { type: "error"; kind: "timeout" | "exception"; message: string };
```

## 4. Контракт ошибок

| Ошибка | Где | Форма | Что видит пользователь |
| --- | --- | --- | --- |
| Сеть | `load.ts` | `DataLoadError{kind:"network", file}` | «Data failed to load: <file>» + Retry |
| Схема | `load.ts` | `DataLoadError{kind:"schema", file, path}` | «Data format error in <file>» |
| Версия | `load.ts` | `DataLoadError{kind:"version", file, expected:"1.x", got}` | «Data version … not supported» |
| Нет кандидатов для задачи | панели | `FidelityCell.F = null` у всех | «No eligible Earth site (reason)» |
| Таймаут Worker | кампания | `WorkerResponse.error` | «Re-optimization timed out; showing precomputed result» |
| Ошибка валидатора Python | конвейер | код выхода 1 и путь поля | Сборка останавливается |

## 5. Python-модели

В `pipeline/contracts/models.py` (A) — `TypedDict` с теми же полями, что TS-интерфейсы, для подсказок типов. Проверка содержимого — только jsonschema, чтобы был один источник истины.
