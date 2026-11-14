# MEMBER_D — движок: рельеф, соответствие, оптимизатор кампании, проверки; панель площадки

> **Как начать:** «Выполни задачи MEMBER_D» в Claude Code (или `/execute-member MEMBER_D`). До 14.11 09:00 по Астане — только учёба на игрушечных задачах в отдельном репозитории.

## 1. Что и зачем

**Что.** Вы пишете научное ядро: одну функцию рельефа для трёх тел (TERR-01), функции соответствия атрибутов и задач (ENG-01), оптимизатор кампании с точным перебором на коротком списке и жадной проверкой на всём пуле (ENG-02), запуск всего расчёта (ENG-03; квадраты `CT_` в кампании не входят), проверки E3 и E7 (VAL-01, VAL-02) и панель площадки, которая объясняет каждое число (WEB-05). В S2 — копия движка на TypeScript для живого пересчёта и проверки устойчивости.

**Зачем.** Это главная инновация (кампания вместо рейтинга) и главное доказательство (проверка по практике NASA с пререгистрацией). Ваша цепочка TERR-01 → ENG-01 → ENG-02 → ENG-03 → VAL-01 → VAL-02 занимает 6,25 ч из 8,75 ч модельного плана ([CRITICAL_PATH_AND_DEPENDENCIES](../planning/CRITICAL_PATH_AND_DEPENDENCIES.md)), поэтому вы начинаете в 09:30, параллельно с каркасом A, и не ждёте реальных данных: работаете на фикстурах.

**Отвечаю за:** корректность формул (по MATHEMATICAL_SPECIFICATION, без «улучшений» после пререгистрации), ворота G-E и G-G, ревью PR MEMBER_A (вы его заместитель).

## 2. Первые действия

**Сегодня (до 14.11):**

- [ ] PREP-07: игрушечная задача максимального покрытия — точный перебор против жадного; параметризованные тесты pytest и Vitest; повторить биномиальный тест и ранговые метрики (в учебной папке).
- [ ] Прочитать: [MATHEMATICAL_SPECIFICATION §3, §6–§12](../science/MATHEMATICAL_SPECIFICATION.md), [ALGORITHMS_AND_PSEUDOCODE A2, A8–A12](../science/ALGORITHMS_AND_PSEUDOCODE.md), [FUNCTION_SPECIFICATIONS §1, §6, §7](../engineering/FUNCTION_SPECIFICATIONS.md), [VALIDATION_PROTOCOL](../science/VALIDATION_PROTOCOL.md), [SCREEN_BY_SCREEN_SPEC S3](../product/SCREEN_BY_SCREEN_SPEC.md).
- [ ] Проверить три ссылки из заметок MEMBER_E (PREP-15) — для честности E3.

**Суббота 09:00:**

- [ ] `git pull && python3 tools/tasks.py next MEMBER_D`.
- [ ] Участвовать в пререгистрации на KICK-01: параметры §12 и правила E3 заморожены до первого запуска.
- [ ] 09:30 — TERR-01; к 10:30 опубликовать сигнатуру `terrain_attributes` в #engine (её ждут C и B).

## 3. Мой день (S1)

| Время | Задача |
| --- | --- |
| Сб 09:30–10:30 | TERR-01 `terrain.py` и тесты на аналитических поверхностях |
| 10:30–12:00 | ENG-01 `fidelity.py`, `templates.py` (стартовые веса §7.3, пока нет CSV от E) |
| 13:00–14:30 | ENG-02 `campaign.py`: короткий список, точный перебор, жадный поиск, разрывы; тест E4 |
| 14:30–15:15 | `run.py` на фикстурах; ревью формата `earth_candidates` от B |
| 15:15–16:00 | ENG-03 `results.json` на реальных данных; E10 (повтор — те же байты) |
| 16:00–17:00 | VAL-01 E3 с базовыми линиями; сводка E1, E2, E4 |
| 17:00–17:30 | VAL-02 контроли E7 |
| 17:30 | IC-1 |
| Вс 09:00–10:00 | WEB-05 панель площадки |
| 10:00–11:00 | ENG-04 объяснения (P1), VAL-03 (P1, если есть запас); после 11:00 — только исправления |
| S2: Сб 19:30–22:30 | ENG-05 TS-движок и golden-тесты → VAL-03 → VAL-04; Вс 08:00 WEB-09, 10:00 WEB-08 |

## 4. Мои файлы

`pipeline/common/terrain.py` и `pipeline/common/tests/test_terrain.py`, `pipeline/engine/`, `data/processed/results.json`, `validation.json`, `mission_templates.json`, `robustness.json`, `data/processed/figures/`, `data/fixtures/golden_*.json`, `web/src/components/site/`, `web/src/components/matrix/`, `web/src/lib/`, `web/src/workers/`. Проверка: `python3 tools/tasks.py owner PATH`.

## 5. Интерфейсы, которые я реализую

**Python** ([FUNCTION_SPECIFICATIONS §1, §6](../engineering/FUNCTION_SPECIFICATIONS.md)):

```python
terrain.terrain_attributes(z, p, fine_offset=1, regional_baseline_m=2000) -> dict[str, float | None]
fidelity.attribute_fidelity(spec, x_e, x_t) -> float | None          # match | logmatch | at_most | at_least | colder | category | light
fidelity.objective_fidelity(objective, attrs_e, attrs_t, extra) -> FidelityCell   # геометрическое среднее; > 30 % веса пропущено → None
campaign.shortlist(F, W, per_objective=20) -> idx                    # топ-20 по каждой задаче + топ-20 по одиночному покрытию, ≤ 120
campaign.exact_best(F, W, U, k) -> (sites, coverage)                 # перебор C(|U|, k) блоками numpy
campaign.greedy(F, W, k) -> (sites, coverage)                        # по всему пулу; ≥ (1 − 1/e) оптимума
campaign.design(F, W, k_max=3) -> list[Campaign]                     # k = 1…3, поле method
campaign.gap_ledger(parts_by_objective, F, physical) -> dict         # потолок атрибута < 0,1 + физические разрывы
```

Пример ожидаемого поведения из тестов: все f = 1 → F = 1; одно f = 0 → F ≈ 0; для 100 случайных задач `exact_best` совпадает с `itertools.combinations` (E4); жадный результат не меньше 63 % оптимума.

**`results.json` и `validation.json`** — формы в [API_AND_SCHEMA_CONTRACTS §2.5–2.6](../engineering/API_AND_SCHEMA_CONTRACTS.md): `fidelity` для всех допущенных кандидатов, `parts` — только для коротких списков; `campaigns` с полем `method` (размер короткого списка, покрытие точное и жадное, флаг объединения); `validation.preregistration_commit` = хэш из DEC-010.

**TypeScript (P1)** — протокол воркера `{type: "optimize", F, nSites, nObj, W, k, shortlist}` → `{type: "result", sites, coverage, ms}` или `{type: "error", kind: "timeout" | "exception"}`; golden-файлы из Python, |Δ| < 1e-6, бюджет 300 мс.

**Панель площадки (S3)** — роль в кампании, атрибуты по задачам (значение кандидата и цели с единицами, функция и допуск, f, источник), 12 столбиков H_low для целей Луны (полоса широты кандидата из `sun_windows`), «Suitability not assessed».

## 6. Что мне нужно от других и кто ждёт меня

| Направление | Что | Когда (план / последний срок) | Если нет |
| --- | --- | --- | --- |
| От A | Фикстуры; контракты v1 | Сб 11:30; 11:00 | Работаю на `contracts/examples/` |
| От E | `mission_templates.csv`, `gap_alternatives.csv` | Сб 13:30 / 15:00 | Стартовые значения MATHEMATICAL_SPECIFICATION §7.3 |
| От E | `practice_sites.csv` (до первого запуска VAL-01) | Сб 11:00 | Пары, добавленные после запуска, в E3 не входят |
| От B | `earth_candidates.json`; таблица сверки E2b | Сб 15:15 / 16:00 | Срез на ступени A |
| От C | `targets.json`, `sun_windows.json`; результат E1 | Сб 15:00, 14:30 / 16:00 | Одна цель; O4 без атрибута light |
| Ждут A, C, B, E | `results.json` | Сб 16:00 / 17:30 | IC-1 на одной цели (ворота G-E) |
| Ждут F, E, B | `validation.json` (E3, затем E7) | Сб 17:00 и 17:30 / Вс 10:00 | Тексты без чисел проверки (ворота G-G) |
| Ждёт A | Панель площадки (WEB-05) | Вс 10:00 | В S3 — подсказки в карточке кампании |

## 7. Как делать: подсказки

**TERR-01.** Уклон — центральные разности на смещении `o` пикселей (база L = 2·o·p); перцентили p50/p90, доли < 10° и < 20°, TRI; краевая рамка исключается. Тесты: плоскость 10° → p50 = 10 ± 0,1° на любой базе; горизонталь → 0; NaN не ломает перцентили.

**ENG-01.** Функции соответствия — ровно §6 спецификации (параметры — из CSV MEMBER_E, без своих догадок). Правила: пропущено > 30 % веса задачи → `{F: null, reason: "missing"}`; нарушено ограничение (вода > 0,5, застройка > 0,2) → `"constraint"`; иначе `partial: true`, если что-то пропущено.

**ENG-02.** Перебор блоками: для |U| = 120 и k = 3 — 280 840 троек, векторно < 2 с. Если жадный поиск по всему пулу нашёл покрытие больше точного на коротком списке — объединить и выставить `merged_greedy: true` (так утверждение C4 остаётся честным).

**ENG-03.** Входы проверяются валидатором до расчёта; в `inputs` — sha256 каждого файла; два запуска подряд → идентичные байты (E10). Время ≤ 2 минуты.

**VAL-01.** Только пары из закоммиченного `practice_sites.csv`; исключения по правилам, которые записаны до запуска; для каждой пары — ранг, n и pct; базовые линии: только сухость, случайная, v1-сходство. Результат публикуется как есть, даже отрицательный ([VALIDATION_PROTOCOL E3](../science/VALIDATION_PROTOCOL.md)).

**VAL-02.** Квадраты `CT_` (лес, пашня, ледник; их добавляет B в EARTH-01) ранжируются среди допущенных кандидатов по каждой задаче; гипотеза — ни один не входит в топ-5 %. Ограничения (вода, застройка) проверяются тестом. Сравнение «точная ≥ жадная ≥ случайные» — только проверка здравого смысла в `notes`: оно выполняется по построению и утверждением не является (VALIDATION_PROTOCOL E7).

## 8. Готово, если

- `pytest pipeline/common/tests/test_terrain.py pipeline/engine -q` зелёный; E4 — 100 % совпадений; E10 — одинаковые хэши.
- `results.json` и `validation.json` проходят валидатор; в `validation.json` хэш пререгистрации совпадает с DEC-010; исключённые пары перечислены с причинами.
- Панель площадки показывает только числа из данных; пропуски помечены.

## 9. Задачи

<!-- BEGIN GENERATED:member-tasks:MEMBER_D -->
Задач: 14. До хакатона (PREP): 3 ч. На хакатоне P0+P1: 12,25 ч (P0 7,25 ч, P1 5 ч). Статусы смотрите командой `python3 tools/tasks.py next MEMBER_D`.

Порядок — по времени (сначала подготовка, затем хакатон; P2–P3 в конце).

| ID | Задача | P | Разрешение | Веха | Окно (Астана) | Ч | Зависит от | Флаги |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PREP-07 | Тренировка: numpy, pytest, Vitest, задача максимального покрытия | P1 | PERMITTED | M0 | до 08.11 | 3 | — | — |
| TERR-01 | terrain.py: атрибуты рельефа на базах | P0 | DEFER_UNTIL_EVENT | M3 | Сб 09:30–10:30 | 1 | KICK-01 | CRITICAL_PATH |
| ENG-01 | fidelity.py и templates.py | P0 | DEFER_UNTIL_EVENT | M3 | Сб 10:30–12:00 | 1,5 | KICK-01 | — |
| ENG-02 | campaign.py: короткий список, точный перебор, жадный поиск, разрывы | P0 | DEFER_UNTIL_EVENT | M3 | Сб 13:00–14:30 | 1,5 | ENG-01 | — |
| ENG-03 | run.py: results.json | P0 | DEFER_UNTIL_EVENT | M4 | Сб 15:15–16:00 | 0,75 | ENG-02, EARTH-04, PLNT-03, LIGHT-02, SCI-02, INFRA-02 | CRITICAL_PATH |
| VAL-01 | Проверки: E3 с базовыми линиями и сводка E1, E2, E4 → validation.json | P0 | DEFER_UNTIL_EVENT | M5 | Сб 16:00–17:00 | 1 | ENG-03, SCI-03, LIGHT-01, EARTH-05 | CRITICAL_PATH |
| VAL-02 | Отрицательные контроли E7 | P0 | DEFER_UNTIL_EVENT | M5 | Сб 17:00–17:30 | 0,5 | VAL-01 | — |
| ENG-05 | TypeScript-копия движка, golden-тесты, Web Worker | P1 | DEFER_UNTIL_EVENT | M6 | S2: Сб 19:30–21:00 | 1,5 | ENG-02, WEB-01 | — |
| VAL-03 | Устойчивость кампании (E5) | P1 | DEFER_UNTIL_EVENT | M8 | S2: Сб 21:00–22:00 (в S1 — Вс 10:30–11:00, если есть запас) | 1 | ENG-03 | — |
| VAL-04 | Абляция и альтернативное «И» (E6) | P1 | DEFER_UNTIL_EVENT | M8 | S2: Сб 22:00–22:30 | 0,5 | VAL-01 | — |
| WEB-09 | Живой пересчёт в интерфейсе | P1 | DEFER_UNTIL_EVENT | M6 | S2: Вс 08:00–08:30 | 0,5 | ENG-05, WEB-04 | — |
| WEB-05 | Панель площадки | P0 | DEFER_UNTIL_EVENT | M7 | Вс 09:00–10:00 | 1 | WEB-01, ENG-03 | — |
| ENG-04 | Детерминированные объяснения | P1 | DEFER_UNTIL_EVENT | M6 | Вс 10:00–10:30 | 0,5 | ENG-03 | — |
| WEB-08 | Матрица соответствия | P1 | DEFER_UNTIL_EVENT | M7 | S2: Вс 10:00–11:00 | 1 | WEB-05 | — |

**Помогаю другим (соисполнитель):** PREP-02 (MEMBER_F, Регистрация команды и сопровождение несовершеннолетних), PREP-04 (MEMBER_A, Аккаунты: Earthdata, Earth Engine, Vercel), PREP-11 (MEMBER_A, Тренировка команды: Git и Claude Code), PREP-12 (MEMBER_A, Окружение на шести ноутбуках), RULE-04 (MEMBER_A, 13.11 вечер: готовность к старту (IC-0)), KICK-01 (MEMBER_A, Старт 09:00: решения и пререгистрация), INFRA-02 (MEMBER_A, Контракты v1: схемы, валидатор, типы), INFRA-06 (MEMBER_A, Точки интеграции IC-1, IC-2, IC-3, снимок данных и релиз), SUB-04 (MEMBER_C, Раскрытие использования ИИ), SCI-02 (MEMBER_E, mission_templates.csv и gap_alternatives.csv), SCI-05 (MEMBER_E, Научная проверка кампаний и кандидатов), STORY-04 (MEMBER_F, Репетиция питча)

**Входящие зависимости — что я жду от других:**

- TERR-01 ждёт **KICK-01** от MEMBER_A — Старт 09:00: решения и пререгистрация
- ENG-01 ждёт **KICK-01** от MEMBER_A — Старт 09:00: решения и пререгистрация
- ENG-03 ждёт **EARTH-04** от MEMBER_B — Экспорт earth_candidates.json
- ENG-03 ждёт **PLNT-03** от MEMBER_C — targets.json
- ENG-03 ждёт **LIGHT-02** от MEMBER_C — sun_windows.json по широтным полосам
- ENG-03 ждёт **SCI-02** от MEMBER_E — mission_templates.csv и gap_alternatives.csv
- ENG-03 ждёт **INFRA-02** от MEMBER_A — Контракты v1: схемы, валидатор, типы
- VAL-01 ждёт **SCI-03** от MEMBER_E — practice_sites.csv из заметок PREP-15, пререгистрированно
- VAL-01 ждёт **LIGHT-01** от MEMBER_C — sun.py: положение Солнца, окна низкого Солнца, проверка E1
- VAL-01 ждёт **EARTH-05** от MEMBER_B — Сверка GEE с terrain.py (E2b) и проверки здравого смысла
- ENG-05 ждёт **WEB-01** от MEMBER_A — Каркас приложения: маршруты, загрузка, store, токены
- WEB-09 ждёт **WEB-04** от MEMBER_C — Панели кампании: задачи, фронт, карточка, разрывы
- WEB-05 ждёт **WEB-01** от MEMBER_A — Каркас приложения: маршруты, загрузка, store, токены

**Исходящие — кто ждёт мои результаты:**

- **ENG-03** → INFRA-06 (MEMBER_A), EARTH-08 (MEMBER_B), SUB-01 (MEMBER_C), SUB-04 (MEMBER_C), SCI-05 (MEMBER_E), SCI-07 (MEMBER_E)
- **TERR-01** → EARTH-05 (MEMBER_B), PLNT-02 (MEMBER_C)
- **VAL-01** → SCI-09 (MEMBER_E), SCI-10 (MEMBER_E), STORY-06 (MEMBER_F), SUB-07 (MEMBER_F)
- **VAL-02** → WEB-06 (MEMBER_B), SCI-09 (MEMBER_E)

#### Карточки задач

##### PREP-07 · Тренировка: numpy, pytest, Vitest, задача максимального покрытия

P1 · PREP · M0 · разрешение: PERMITTED (можно сейчас) · окно: до 08.11 · оценка 3 ч

**Цель.** Отработать векторные вычисления, параметризованные тесты и перебор сочетаний на игрушечной задаче покрытия.

**Зачем.** Движок и оптимизатор — критический путь MEMBER_D.

**Шаги:**

1. Решить игрушечную задачу покрытия: точный перебор против жадного
2. Написать тесты pytest и Vitest на игрушечных функциях
3. Повторить биномиальный тест и ранговые метрики
4. Заметка в PROGRESS.md (раздел MEMBER_D)

**Создать:** — · **Изменить:** `docs/planning/PROGRESS.md`

**Ожидаемый результат:** Заметка

**Критерии приёмки:**

- [ ] Есть заметка с выводами
- [ ] Учебный код не в репозитории

**Ручная проверка:** Заметка

**Команды проверки:**

- manual: заметка

**Доказательство готовности:** Заметка с датой

**Типовые сбои:** — · **Запасной путь:** —

##### TERR-01 · terrain.py: атрибуты рельефа на базах

P0 · HACK · M3 · разрешение: DEFER_UNTIL_EVENT (только с начала хакатона) · окно: Сб 09:30–10:30 · оценка 1 ч · не раньше 14.11.2026 09:00 (Астана) · флаги: CRITICAL_PATH

**Цель.** slope_at_offset, terrain_attributes, tri по FUNCTION_SPECIFICATIONS §1.

**Зачем.** Одна функция для трёх тел и сверки с GEE.

**Зависит от:** KICK-01 (MEMBER_A)

**Шаги:**

1. Реализовать по ALGORITHMS_AND_PSEUDOCODE A2 параллельно с INFRA-01 (PR — после слияния каркаса)
2. Тесты на аналитических поверхностях (плоскость 10°, горизонталь, NaN, доли, TRI)
3. Объявить сигнатуру terrain_attributes в #engine к 10:30 — её ждут C и B

**Создать:** `pipeline/common/terrain.py`, `pipeline/common/tests/test_terrain.py` · **Изменить:** —

**Интерфейсы:** terrain_attributes(z, p, fine_offset, regional_baseline_m) · **Данные:** —

**Ожидаемый результат:** terrain.py

**Критерии приёмки:**

- [ ] Тесты E2a зелёные
- [ ] Скорость: 1 000×1 000 < 50 мс

**Автотесты:** `pytest pipeline/common/tests/test_terrain.py -q`

**Команды проверки:**

- `pytest pipeline/common/tests/test_terrain.py -q`

**Доказательство готовности:** Вывод pytest

**Типовые сбои:** Краевые эффекты · **Запасной путь:** Шире рамка исключения

##### ENG-01 · fidelity.py и templates.py

P0 · HACK · M3 · разрешение: DEFER_UNTIL_EVENT (только с начала хакатона) · окно: Сб 10:30–12:00 · оценка 1,5 ч · не раньше 14.11.2026 09:00 (Астана)

**Цель.** Функции соответствия §6, соответствие задачи §7, правила пропусков и ограничений, загрузка шаблонов из CSV.

**Зачем.** Ядро оценки по задачам.

**Зависит от:** KICK-01 (MEMBER_A)

**Шаги:**

1. fidelity.py: attribute_fidelity, objective_fidelity, fidelity_table (MATHEMATICAL_SPECIFICATION §6–§7)
2. templates.py: CSV MEMBER_E → mission_templates.json; до готовности CSV — стартовые веса §7.3
3. Тесты всех функций и правил пропусков и ограничений
4. Прогон на фикстурах после INFRA-03

**Создать:** `pipeline/engine/__init__.py`, `pipeline/engine/templates.py`, `pipeline/engine/fidelity.py`, `pipeline/engine/tests/test_fidelity.py`, `data/processed/mission_templates.json` · **Изменить:** —

**Интерфейсы:** MissionTemplates; FidelityCell · **Данные:** —

**Ожидаемый результат:** fidelity.py, templates.py

**Критерии приёмки:**

- [ ] Тесты зелёные
- [ ] Ошибки CSV с номером строки

**Автотесты:** `pytest pipeline/engine/tests/test_fidelity.py -q`

**Команды проверки:**

- `pytest pipeline/engine -q`

**Доказательство готовности:** Вывод pytest

**Типовые сбои:** CSV шаблонов запаздывает · **Запасной путь:** Стартовые веса из MATHEMATICAL_SPECIFICATION §7.3

##### ENG-02 · campaign.py: короткий список, точный перебор, жадный поиск, разрывы

P0 · HACK · M3 · разрешение: DEFER_UNTIL_EVENT (только с начала хакатона) · окно: Сб 13:00–14:30 · оценка 1,5 ч · не раньше 14.11.2026 09:00 (Астана)

**Цель.** shortlist, exact_best, greedy, design, gap_ledger по §8–§9 и A9–A10.

**Зачем.** Главная инновация — кампания.

**Зависит от:** ENG-01 (MEMBER_D)

**Шаги:**

1. Векторный перебор блоками
2. Жадный поиск и объединение при превосходстве
3. Роли, per_objective, method
4. Реестр разрывов
5. Тесты E4 против itertools

**Создать:** `pipeline/engine/campaign.py`, `pipeline/engine/tests/test_campaign.py` · **Изменить:** —

**Интерфейсы:** Campaign; gaps · **Данные:** —

**Ожидаемый результат:** campaign.py

**Критерии приёмки:**

- [ ] E4: 100 % совпадений
- [ ] |U|=120, k=3 < 2 с
- [ ] Детерминированно

**Автотесты:** `pytest pipeline/engine/tests/test_campaign.py -q`

**Команды проверки:**

- `pytest pipeline/engine -q -k exact`

**Доказательство готовности:** Вывод pytest с E4

**Типовые сбои:** Медленно · **Запасной путь:** |U| ≤ 80

##### ENG-03 · run.py: results.json

P0 · HACK · M4 · разрешение: DEFER_UNTIL_EVENT (только с начала хакатона) · окно: Сб 15:15–16:00 · оценка 0,75 ч · не раньше 14.11.2026 09:00 (Астана) · флаги: CRITICAL_PATH

**Цель.** Посчитать fidelity, кампании k=1–3 и разрывы для всех целей и шаблонов; хэши входов; E10.

**Зачем.** Вход сайта и проверок.

**Зависит от:** ENG-02 (MEMBER_D), EARTH-04 (MEMBER_B), PLNT-03 (MEMBER_C), LIGHT-02 (MEMBER_C), SCI-02 (MEMBER_E), INFRA-02 (MEMBER_A)

**Шаги:**

1. Загрузить и проверить входы валидатором
2. fidelity_table; light — по широте кандидата из sun_windows
3. design() и gap_ledger() для каждой пары цель × шаблон; квадраты pool = control не входят в короткий список и кампании
4. Записать results.json с хэшами входов
5. Повторить и сравнить байты (E10)

**Создать:** `pipeline/engine/run.py`, `data/processed/results.json` · **Изменить:** —

**Интерфейсы:** Results · **Данные:** earth_candidates.json; targets.json; sun_windows.json; mission_templates.json

**Ожидаемый результат:** data/processed/results.json

**Критерии приёмки:**

- [ ] results.json проходит схему
- [ ] E10: идентичные байты
- [ ] ≤ 2 мин

**Автотесты:** `pytest pipeline/engine -q`, `python -m pipeline.contracts.validate data/processed/results.json`

**Команды проверки:**

- `python -m pipeline.engine.run && python -m pipeline.contracts.validate data/processed/results.json`

**Доказательство готовности:** Вывод валидатора и sha256 двух запусков

**Типовые сбои:** Входы опаздывают · **Запасной путь:** Срез на одной цели для IC-1

##### VAL-01 · Проверки: E3 с базовыми линиями и сводка E1, E2, E4 → validation.json

P0 · HACK · M5 · разрешение: DEFER_UNTIL_EVENT (только с начала хакатона) · окно: Сб 16:00–17:00 · оценка 1 ч · не раньше 14.11.2026 09:00 (Астана) · флаги: CRITICAL_PATH · соисполнители: MEMBER_E

**Цель.** Восстановление практики NASA по задачам (E3) против трёх базовых линий, сводка проверок E1, E2, E4, графики; хэш пререгистрации.

**Зачем.** Доказательства для критерия Validity; от этих чисел зависят слайды, страница проекта и подпись утверждений.

**Зависит от:** ENG-03 (MEMBER_D), SCI-03 (MEMBER_E), LIGHT-01 (MEMBER_C), EARTH-05 (MEMBER_B)

**Шаги:**

1. validate_practice.py по ALGORITHMS A11 на парах из practice_sites.csv (исключения — по правилам, до расчёта)
2. Базовые линии: только сухость, случайная, v1-сходство
3. Внести результаты E1 (test_sun), E2 (test_terrain + EARTH-05), E4 (test_campaign)
4. validation.json + figures/; хэш пререгистрации; сообщить F и E в #pitch

**Создать:** `pipeline/engine/validate_practice.py`, `pipeline/engine/tests/test_validate_practice.py`, `data/processed/validation.json`, `data/processed/figures/` · **Изменить:** —

**Интерфейсы:** Validation · **Данные:** —

**Ожидаемый результат:** validation.json; графики

**Критерии приёмки:**

- [ ] validation.json проходит схему
- [ ] Каждая пара в отчёте, включая исключённые, с причиной
- [ ] Хэш пререгистрации совпадает с DEC-010

**Автотесты:** `pytest pipeline/engine -q -k practice`

**Команды проверки:**

- `python -m pipeline.engine.validate_practice && python -m pipeline.contracts.validate data/processed/validation.json`

**Доказательство готовности:** Сводка E3 (медиана pct, n, базовые линии) и хэш пререгистрации

**Типовые сбои:** Мало проверяемых пар · **Запасной путь:** Отчёт «недостаточно пар», утверждение C3 снимается

##### VAL-02 · Отрицательные контроли E7

P0 · HACK · M5 · разрешение: DEFER_UNTIL_EVENT (только с начала хакатона) · окно: Сб 17:00–17:30 · оценка 0,5 ч · не раньше 14.11.2026 09:00 (Астана)

**Цель.** Отрицательные контроли по VALIDATION_PROTOCOL E7: квадраты CT_ (лес, пашня, ледник) не входят в топ-5 % ни одной задачи; ограничения по воде и застройке срабатывают. Сравнение со случайными кампаниями — только проверка здравого смысла.

**Зачем.** Отвечает на возражение «модель выбирает что попало»; честно отделяет настоящую проверку от проверки, которая выполняется по построению.

**Зависит от:** VAL-01 (MEMBER_D)

**Шаги:**

1. controls.py: ранги квадратов CT_ среди допущенных кандидатов по каждой задаче (seed 2026)
2. Тест ограничений на синтетических значениях (вода > 0,5, застройка > 0,2 → constraint)
3. Проверка здравого смысла: точная ≥ жадной ≥ медианы 1 000 случайных кампаний — в notes, не в утверждения
4. Раздел controls и эксперимент E7 в validation.json

**Создать:** `pipeline/engine/controls.py`, `pipeline/engine/tests/test_controls.py` · **Изменить:** `data/processed/validation.json`

**Интерфейсы:** Validation.controls; coverage() из campaign.py · **Данные:** earth_candidates.json; results.json

**Ожидаемый результат:** E7 в validation.json

**Критерии приёмки:**

- [ ] E7 в validation.json со статусом по пререгистрированному критерию (a)
- [ ] seed воспроизводит числа
- [ ] Схема проходит

**Автотесты:** `pytest pipeline/engine -q -k controls`

**Команды проверки:**

- `python -m pipeline.engine.controls --seed 2026 && python -m pipeline.contracts.validate data/processed/validation.json`

**Доказательство готовности:** Доля контролей в топ-5 % по задачам и число нарушений ограничений

**Типовые сбои:** Мало контролей какого-то класса в данных; Контроль попал в топ из-за ошибки данных · **Запасной путь:** Контроли по двум классам с пометкой; каждый случай попадания в топ разбирает MEMBER_E

##### ENG-05 · TypeScript-копия движка, golden-тесты, Web Worker

P1 · HACK · M6 · разрешение: DEFER_UNTIL_EVENT (только с начала хакатона) · окно: S2: Сб 19:30–21:00 · оценка 1,5 ч · не раньше 14.11.2026 09:00 (Астана)

**Цель.** fidelity.ts, campaign.ts, campaign.worker.ts; golden-файлы из Python; бюджет 300 мс.

**Зачем.** Живой пересчёт без сервера.

**Зависит от:** ENG-02 (MEMBER_D), WEB-01 (MEMBER_A)

**Шаги:**

1. golden.py → data/fixtures/golden_fidelity.json и golden_campaign.json
2. TS-реализации
3. Worker с таймаутом 2 с
4. Vitest и бенчмарк

**Создать:** `pipeline/engine/golden.py`, `data/fixtures/golden_fidelity.json`, `data/fixtures/golden_campaign.json`, `web/src/lib/`, `web/src/workers/` · **Изменить:** —

**Интерфейсы:** WorkerRequest/WorkerResponse · **Данные:** —

**Ожидаемый результат:** TS-движок

**Критерии приёмки:**

- [ ] |Δ| < 1e-6
- [ ] ≤ 300 мс

**Автотесты:** `npm --prefix web test -- --run`

**Команды проверки:**

- `python -m pipeline.engine.golden && npm --prefix web test -- --run`

**Доказательство готовности:** Вывод Vitest и время

**Типовые сбои:** Расхождения float · **Запасной путь:** Только предрасчитанные кампании

##### VAL-03 · Устойчивость кампании (E5)

P1 · HACK · M8 · разрешение: DEFER_UNTIL_EVENT (только с начала хакатона) · окно: S2: Сб 21:00–22:00 (в S1 — Вс 10:30–11:00, если есть запас) · оценка 1 ч · не раньше 14.11.2026 09:00 (Астана)

**Цель.** 200 запусков с возмущением весов, допусков и пула; частоты выбора; robustness.json.

**Зачем.** Проверка утверждения C10.

**Зависит от:** ENG-03 (MEMBER_D)

**Шаги:**

1. robustness.py по A12
2. Записать robustness.json
3. Фраза-вывод для Evidence

**Создать:** `pipeline/engine/robustness.py`, `data/processed/robustness.json` · **Изменить:** —

**Ожидаемый результат:** robustness.json

**Критерии приёмки:**

- [ ] seed воспроизводит
- [ ] Схема проходит

**Автотесты:** `pytest pipeline/engine -q -k robust`

**Команды проверки:**

- `python -m pipeline.engine.robustness --runs 200 --seed 2026`

**Доказательство готовности:** Медиана Жаккара и частоты лидеров

**Типовые сбои:** Долго · **Запасной путь:** 100 запусков

##### VAL-04 · Абляция и альтернативное «И» (E6)

P1 · HACK · M8 · разрешение: DEFER_UNTIL_EVENT (только с начала хакатона) · окно: S2: Сб 22:00–22:30 · оценка 0,5 ч · не раньше 14.11.2026 09:00 (Астана)

**Цель.** Убрать группы атрибутов и заменить среднее на минимум; записать изменения кампаний.

**Зачем.** Показывает, что решает каждый вид данных.

**Зависит от:** VAL-01 (MEMBER_D)

**Шаги:**

1. ablation.py
2. Раздел в validation.json

**Создать:** `pipeline/engine/ablation.py` · **Изменить:** `data/processed/validation.json`

**Ожидаемый результат:** E6

**Критерии приёмки:**

- [ ] Результаты записаны

**Автотесты:** `pytest pipeline/engine -q -k ablation`

**Команды проверки:**

- `python -m pipeline.engine.ablation`

**Доказательство готовности:** Таблица ΔC

**Типовые сбои:** Слишком много пересчётов — долго · **Запасной путь:** Только альтернативное «И» (минимум) без абляции групп

##### WEB-09 · Живой пересчёт в интерфейсе

P1 · HACK · M6 · разрешение: DEFER_UNTIL_EVENT (только с начала хакатона) · окно: S2: Вс 08:00–08:30 · оценка 0,5 ч · не раньше 14.11.2026 09:00 (Астана) · соисполнители: MEMBER_A, MEMBER_C

**Цель.** Флажки задач и веса на Brief и Campaign → Worker → обновление кампании.

**Зачем.** Пользователь проверяет устойчивость сам.

**Зависит от:** ENG-05 (MEMBER_D), WEB-04 (MEMBER_C)

**Шаги:**

1. web/src/lib/useLiveCampaign.ts: хук подписки на store и вызова воркера
2. Индикатор пересчёта и таймаут
3. A подключает хук в store, C — в панели кампании (по 10 минут, в своих файлах)
4. Совпадение с предрасчётом при исходных весах

**Создать:** `web/src/lib/useLiveCampaign.ts` · **Изменить:** —

**Интерфейсы:** WorkerRequest/WorkerResponse; AppState · **Данные:** —

**Ожидаемый результат:** Живой пересчёт

**Критерии приёмки:**

- [ ] ≤ 300 мс
- [ ] Таймаут обработан

**Автотесты:** `npm --prefix web test -- --run`

**Команды проверки:**

- `npm --prefix web run build`

**Доказательство готовности:** Видео экрана или скриншоты

**Типовые сбои:** Медленно на телефоне · **Запасной путь:** Отключить на ширине < 768

##### WEB-05 · Панель площадки

P0 · HACK · M7 · разрешение: DEFER_UNTIL_EVENT (только с начала хакатона) · окно: Вс 09:00–10:00 · оценка 1 ч · не раньше 14.11.2026 09:00 (Астана)

**Цель.** Экран S3: роль, атрибуты с значениями цели и кандидата, функция и допуск, источник; столбики окон освещения.

**Зачем.** Объяснимость каждого числа.

**Зависит от:** WEB-01 (MEMBER_A), ENG-03 (MEMBER_D)

**Шаги:**

1. web/src/components/site/: SitePanel, AttributeRow, LightingMonths
2. Данные из results (parts) и sun_windows
3. Состояние «не найдено»
4. Vitest

**Создать:** `web/src/components/site/` · **Изменить:** —

**Интерфейсы:** Results.fidelity; SunWindows · **Данные:** —

**Ожидаемый результат:** Панель площадки

**Критерии приёмки:**

- [ ] Числа из данных
- [ ] Пропуски помечены
- [ ] Доступно с клавиатуры

**Автотесты:** `npm --prefix web test -- --run`

**Команды проверки:**

- `npm --prefix web run build`

**Доказательство готовности:** Скриншот и тесты

**Типовые сбои:** parts нет для кандидата вне короткого списка · **Запасной путь:** Показать F без разложения

##### ENG-04 · Детерминированные объяснения

P1 · HACK · M6 · разрешение: DEFER_UNTIL_EVENT (только с начала хакатона) · окно: Вс 10:00–10:30 · оценка 0,5 ч · не раньше 14.11.2026 09:00 (Астана)

**Цель.** Фразы «matches / differs» по шаблонам с числами для площадок кампании.

**Зачем.** Понятность для судей.

**Зависит от:** ENG-03 (MEMBER_D)

**Шаги:**

1. explain.py
2. Поле explain в Campaign
3. Тест: числа во фразах = данным

**Создать:** `pipeline/engine/explain.py`, `pipeline/engine/tests/test_explain.py` · **Изменить:** `pipeline/engine/run.py`

**Ожидаемый результат:** explain

**Критерии приёмки:**

- [ ] Фразы есть
- [ ] Нет LLM

**Автотесты:** `pytest pipeline/engine -q -k explain`

**Команды проверки:**

- `pytest pipeline/engine -q -k explain`

**Доказательство готовности:** Вывод pytest

**Типовые сбои:** Фразы расходятся с числами после пересчёта · **Запасной путь:** Без фраз: только числа и функции соответствия

##### WEB-08 · Матрица соответствия

P1 · HACK · M7 · разрешение: DEFER_UNTIL_EVENT (только с начала хакатона) · окно: S2: Вс 10:00–11:00 · оценка 1 ч · не раньше 14.11.2026 09:00 (Астана)

**Цель.** Экран S4.

**Зачем.** Глубина анализа для учёных.

**Зависит от:** WEB-05 (MEMBER_D)

**Шаги:**

1. web/src/components/matrix/
2. Сортировка и всплывающее доказательство

**Создать:** `web/src/components/matrix/` · **Изменить:** —

**Ожидаемый результат:** Матрица

**Критерии приёмки:**

- [ ] Числа из данных

**Автотесты:** `npm --prefix web test -- --run`

**Команды проверки:**

- `npm --prefix web run build`

**Доказательство готовности:** Скриншот

**Типовые сбои:** Таблица 120 × 9 тормозит на телефоне · **Запасной путь:** Матрица только для площадок кампании и топ-10
<!-- END GENERATED:member-tasks:MEMBER_D -->

## 10. Замена

Заместитель — MEMBER_A; в этом случае WEB-05 снимается (CONTINGENCY_PLAN §7). Протокол продолжения — [CLAUDE.md §8](../../CLAUDE.md).
