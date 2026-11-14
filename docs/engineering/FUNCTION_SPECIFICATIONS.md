# Спецификации функций

Сигнатуры критичных функций. Будущий агент реализует их без перепроектирования. Псевдокод — [ALGORITHMS_AND_PSEUDOCODE](../science/ALGORITHMS_AND_PSEUDOCODE.md) (ссылки вида «A2»); формулы — [MATHEMATICAL_SPECIFICATION](../science/MATHEMATICAL_SPECIFICATION.md). Реализация — с 14.11 09:00. Тип `NDArray` — `numpy.ndarray` float32 или float64, NaN — пропуск.

## 1. `pipeline/common/terrain.py` — MEMBER_D, TERR-01

### `slope_at_offset(z: NDArray, p: float, o: int) -> NDArray`

| | |
| --- | --- |
| Назначение | Уклон в градусах на базе L = 2·o·p (A2) |
| Предусловия | `z.ndim == 2`, `p > 0`, `o ≥ 1`, `min(z.shape) > 2·o` |
| Постусловия | Форма `(H − 2o, W − 2o)`, значения в [0, 90] или NaN; NaN, если в шаблоне есть NaN |
| Отказы | `ValueError` при нарушении предусловий |
| Краевые случаи | Всё NaN → всё NaN; плоскость → 0 |
| Тесты | Наклонная плоскость 10° (p = 50, o = 1 и o = 20) → медиана 10 ± 0,05°; плоскость → 0; NaN-пятно не распространяется дальше шаблона |
| Скорость | 1 000 × 1 000 → < 50 мс |

### `terrain_attributes(z: NDArray, p: float, fine_offset: int = 1, regional_baseline_m: float = 2000) -> dict[str, float | None]`

| | |
| --- | --- |
| Назначение | Атрибуты §3.3; окна core10 и core (A2) |
| Предусловия | `z` покрывает окно 20 км плюс запас ≥ 1 км; шаг p — 50 м (Луна, Земля для `_f100`) или 200 м |
| Постусловия | Ключи без суффикса тела: `slope_f_p50_deg`, `slope_f_p90_deg`, `frac_lt10_f`, `frac_lt20_f`, `tri_f_m`, `slope_r_p50_deg`, `slope_r_p90_deg`, `frac_lt20_r`, `relief_m`, `elev_min_m`. Суффикс `f100` или `f400` добавляет вызывающий |
| Отказы | Валидных пикселей < 50 % → все значения `None` (не исключение) |
| Тесты | Синтетическая поверхность с известной долей уклонов < 10° (наклонная плоскость 5° + ступенька) → `frac_lt10_f` в пределах 0,01; TRI шума с σ = 1 м и σ = 2 м — монотонно; relief линейного склона = ожидаемому |
| Скорость | 400 × 400 → < 100 мс |

## 2. `pipeline/common/sun.py` — MEMBER_C, LIGHT-01

### `sun_position(lat_deg: float, lon_deg: float, t_utc: NDArray[datetime64]) -> tuple[NDArray, NDArray]`

| | |
| --- | --- |
| Назначение | Видимая высота (с рефракцией) и азимут от севера по часовой (A5) |
| Предусловия | \|lat\| ≤ 90, \|lon\| ≤ 180, времена в UTC |
| Постусловия | h ∈ [−90, 90], az ∈ [0, 360) |
| Тесты (E1) | Против astropy на сетке широт и дат: max\|Δh\| ≤ 0,1° при h > 1° |
| Скорость | 10⁶ моментов → < 1 с |

### `lowsun_windows(lat_deg: float, h_max_deg: float, year: int = 2025, step_min: int = 10) -> tuple[list[float], list[float]]`

| | |
| --- | --- |
| Назначение | 12 значений H_low (ч/сут) и A_low (размах азимута, °) (A6) |
| Постусловия | 0 ≤ H_low ≤ 24; 0 ≤ A_low ≤ 360 |
| Краевые случаи | Полярная ночь → H_low = 0, A_low = 0; h_max ≤ 0 → `ValueError` |
| Тесты | Экватор, h_max = 7° → H_low ≈ 2 × (7°/15° в час) ≈ 0,9 ч ± 0,1; широта 77,5° в марте больше, чем 45°; симметрия: φ и −φ со сдвигом на 6 месяцев |
| Скорость | Вызывается для 1 800 центров широтных полос 0,1° (`sun_windows.json`) → < 30 с на цель |

### `h_max_moon(lat_deg: float) -> float`

Возвращает `(90 − |lat|) + 1.54`. Тест: −85° → 6,54.

## 3. `pipeline/common/shadows.py` — MEMBER_C, LIGHT-03 (P1)

### `cast_shadow(z: NDArray, p: float, h_deg: float, az_deg: float) -> NDArray[bool]`

| | |
| --- | --- |
| Назначение | Маска тени (отбрасываемой и собственной) (A7) |
| Предусловия | 0 < h ≤ 30, 0 ≤ az < 360 |
| Тесты (E8a) | Ступенька высотой 100 м, h = 5° → длина тени 100 / tan 5° ≈ 1 143 м ± 1 пиксель; плоскость → нет тени; азимут 90° и 270° — зеркальны |
| Скорость | 1 000 × 1 000 → < 0,5 с на положение Солнца |

### `shadow_fraction_curve(z, p, analysis_mask, h_list, az_list) -> NDArray` (shape `[len(h), len(az)]`)

Доля тени в маске. Тест: монотонно не растёт с ростом h на типичном рельефе (проверка на синтетических холмах).

## 4. `pipeline/earth/` — MEMBER_B

| Функция | Назначение | Отказы и запасной путь | Тест |
| --- | --- | --- | --- |
| `pool.build_pool(seed=2026, n_per_stratum: dict) -> ee.FeatureCollection` | Страты, точки, квадраты 20 км в UTM, места практики (A3, ступень 0) | Мало точек в страте → увеличить выборку в 2 раза, предупредить | Офлайн-тест генерации ID и размера квадрата на фикстуре |
| `gee_terrain.stage_a(fc, zone) -> list[dict]` | `_f400`, `_r`, relief, TRI, min по зоне UTM | Таймаут → разбить на части по 200, повторить 3 раза | Сверка 3 квадратов с `terrain_attributes` (E2b) |
| `gee_terrain.stage_b(fc, zone) -> list[dict]` | `_f100` по core10 на 50 м | Квоты → пометить `proxy baseline` (R04) | То же |
| `gee_env.environment(fc) -> list[dict]` | LST, IMERG, WorldCover, MCD12Q1 | Пропуски → `None` | Пересчёт единиц на известных числах |
| `export.export_candidates(parts, out_path) -> Path` | Сборка `earth_candidates.json` с `tiles_hash` | Нарушение схемы → исключение, файл не пишется | Валидатор контракта |
| `sanity.run(path) -> dict` | Проверки EARTH-05 | — | Badwater ≈ −86 ± 15 м и др. |

## 5. `pipeline/planets/` — MEMBER_C

| Функция | Назначение | Отказы и запасной путь | Тест |
| --- | --- | --- | --- |
| `access.read_window(product: str, lon: float, lat: float, half_m: float, body: str) -> tuple[NDArray, Affine, CRS]` | Окно из GeoTIFF/COG (локальный путь или URL) в исходной проекции | Медленно (> 2 мин) или 404 → `AccessError`, лестница §3.5 | Синтетический GeoTIFF в известной проекции → центр окна совпадает |
| `access.to_local_grid(z, transform, crs, center, body, p, half_m) -> NDArray` | Перепроекция в AEQD с радиусом тела, average | — | Квадратный пиксель p ± 0,1 % |
| `targets.build_targets(curated_csv, out_path) -> Path` | Атрибуты целей + курируемые значения → `targets.json` | Нет источника у значения → исключение | Валидатор контракта |

## 6. `pipeline/engine/` — MEMBER_D

### `templates.load_templates(csv_path, gaps_csv) -> dict`

Собирает `mission_templates.json`. Проверяет: функции из списка; веса > 0; атрибуты существуют в контракте; у каждой задачи ≥ 1 атрибута. Ошибка → понятное сообщение с номером строки CSV.

### `fidelity.attribute_fidelity(spec: dict, x_e: float | None, x_t: float | None) -> float | None`

| | |
| --- | --- |
| Назначение | Функции §6 |
| Постусловия | `None` или [0, 1] |
| Тесты | match: x = t → 1; x = t ± σ → e^(−½) ≈ 0,6065; at_most: x ≤ a → 1; logmatch: симметрия в отношении x/t; colder: x < t → 1; None → None |

### `fidelity.objective_fidelity(objective: dict, attrs_e: dict, attrs_t: dict, extra: dict) -> FidelityCell`

`extra` содержит `light` (из sun_windows) и `shadow` (P1). Тесты: все f = 1 → F = 1; одно f = 0 → F ≈ 0; пропуск > 30 % веса → `{F: None, reason: "missing"}`; нарушение ограничения → `"constraint"`; пропуск ≤ 30 % → `partial: True`.

### `campaign.shortlist(F: NDArray[n, m], W: NDArray[m], per_objective: int = 20) -> NDArray[int]`

Объединение топ-20 по задачам и топ-20 одиночных; не более 120. Тест: размер ≤ 120; содержит argmax каждой задачи.

### `campaign.exact_best(F, W, U: NDArray[int], k: int) -> tuple[tuple[int, ...], float]`

| | |
| --- | --- |
| Назначение | Полный перебор сочетаний из U (A9); векторно, блоками по 50 000 |
| Предусловия | 1 ≤ k ≤ 3, \|U\| ≥ k, W ≥ 0, ΣW > 0 |
| Постусловия | Покрытие ∈ [0, 1]; правило совпадений §8.2 |
| Тесты (E4) | 100 случайных задач n ≤ 25 → совпадение с перебором `itertools.combinations` по всем n — 100 %; детерминированность |
| Скорость | \|U\| = 120, k = 3, m = 5 → < 2 с в Python |

### `campaign.greedy(F, W, k) -> tuple[list[int], float]`

Жадный поиск на всём пуле (A9). Тест: C(greedy) ≥ (1 − 1/e)·C(opt) на 100 случайных задачах.

### `campaign.design(F, W, k_max=3) -> list[Campaign]`

Склеивает shortlist, exact, greedy, объединение при превосходстве жадного, роли, per_objective, method. Тест: `merged_greedy` выставляется, когда жадный лучше.

### `campaign.gap_ledger(parts_by_objective, F, physical) -> dict`

Потолки и разрывы (A10). Тест: атрибут с max f = 0,05 → в списке; физические разрывы всегда присутствуют.

### `run.main(paths) -> Path`

Читает входы, проверяет контракты, считает fidelity для всех целей и шаблонов, кампании, разрывы, пишет `results.json` с хэшами. Тест E10: два запуска → одинаковые байты.

### `validate_practice.run(results, candidates, practice_csv) -> dict`

E3 (A11) — VAL-01: основной анализ и пререгистрированный дополнительный (без атрибутов, требующих цель). Тест на синтетике: место практики с заведомо лучшим F → pct = 100/n.

### `controls.run(results, candidates, seed=2026) -> dict`

E7 — VAL-02: ранги квадратов `pool = "control"` по каждой задаче среди допущенных кандидатов (сами контроли в кампании не входят); проверка ограничений; проверка здравого смысла «точная ≥ жадная ≥ медиана 1 000 случайных кампаний» пишется в `notes`. Тест: контроль с заведомо низким F не попадает в топ-5 %; фиксированный seed даёт те же числа.

## 7. TypeScript — `web/src/` (P1, MEMBER_D)

| Функция | Назначение | Тест |
| --- | --- | --- |
| `lib/fidelity.ts: objectiveFidelity(objective, attrsE, attrsT, extra): FidelityCell` | Копия Python | Golden: 200 случаев из `data/fixtures/golden_fidelity.json`, \|Δ\| < 1e-6 |
| `lib/campaign.ts: exactBest(F: Float32Array, nObj, W, U, k)` | Копия перебора | Golden + время < 300 мс при \|U\| = 120, k = 3 |
| `workers/campaign.worker.ts` | Протокол API_AND_SCHEMA_CONTRACTS §3; таймаут 2 с | Ответ «error/timeout» при искусственной задержке |

## 8. `pipeline/contracts/` — MEMBER_A, INFRA-02 и INFRA-03

| Функция | Назначение | Тест |
| --- | --- | --- |
| `validate.validate_file(path) -> list[str]` | Схема по полю `schema`, проверка major-версии; пустой список — OK | Пример каждой схемы проходит; файл с `version: "2.0.0"` отклоняется; лишнее поле на верхнем уровне отклоняется |
| `validate.check_no_synthetic(dir) -> list[str]` | В `data/processed/` нет `synthetic: true` и ID `FAKE_` | Фикстура в processed → ошибка |
| `fixtures.generate(seed=42, out_dir) -> list[Path]` | Синтетика по всем схемам (`FAKE_`, `synthetic: true`) | Все проходят валидацию; детерминированно |
