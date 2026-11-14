# MEMBER_B — Земля: пул кандидатов и атрибуты в Earth Engine; Evidence; источники

> **Как начать:** «Выполни задачи MEMBER_B» в Claude Code (или `/execute-member MEMBER_B`). До 14.11 09:00 по Астане — только подготовка на **посторонних** районах и данных в отдельном учебном репозитории.

## 1. Что и зачем

**Что.** Вы строите пул ~3 000 квадратов 20 × 20 км по всей суше (четыре страты + места практики NASA `PR_`) и считаете для каждого атрибуты рельефа на базах NASA и атрибуты среды в Google Earth Engine; экспортируете `earth_candidates.json`; сверяете GEE с общей функцией рельефа (E2b); делаете страницу Evidence и реестр источников.

**Зачем.** Ваш файл — главный вход движка: от его готовности к Сб 15:15 зависит, будет ли в 17:30 кампания на реальных данных. Цепочка EARTH-01 → EARTH-02 → EARTH-04 — первая половина критического пути по зависимостям ([CRITICAL_PATH_AND_DEPENDENCIES §2](../planning/CRITICAL_PATH_AND_DEPENDENCIES.md)). Страница Evidence — главное доказательство для критерия Validity.

**Отвечаю за:** честность данных Земли (единицы, проекции, пропуски = `null`), ворота G-D, реестр источников и лицензий.

## 2. Первые действия

**Сегодня (до 14.11):**

- [ ] PREP-04: Earthdata Login; некоммерческий облачный проект и регистрация в Earth Engine (Community tier); проверить `earthengine authenticate` на **постороннем** районе.
- [ ] PREP-05: замер на постороннем районе (Южная Америка, 200 квадратов): перцентили уклона на 200 м и на 50 м в центральных 10 км, время, лимиты — в PROGRESS.md.
- [ ] Прочитать: [MATHEMATICAL_SPECIFICATION §3–4](../science/MATHEMATICAL_SPECIFICATION.md), [ALGORITHMS_AND_PSEUDOCODE A1, A3](../science/ALGORITHMS_AND_PSEUDOCODE.md), [DATASET_SPECIFICATION §3](../science/DATASET_SPECIFICATION.md), [API_AND_SCHEMA_CONTRACTS §2.1](../engineering/API_AND_SCHEMA_CONTRACTS.md), [SCREEN_BY_SCREEN_SPEC S6](../product/SCREEN_BY_SCREEN_SPEC.md).

**Суббота 09:00:**

- [ ] `git pull && python3 tools/tasks.py next MEMBER_B`; `earthengine authenticate` работает.
- [ ] После KICK-01 — EARTH-01: пул с seed 2026; к 10:30 запустить ступень A (EARTH-02). Пока считает GEE — писать код следующего шага.
- [ ] В 11:00 получить `practice_sites.csv` от E и перезапустить пул с `PR_`.

## 3. Мой день (S1)

| Время | Задача |
| --- | --- |
| Сб 09:30–10:30 | EARTH-01 пул: страты, суша, квадраты UTM |
| 10:30–13:15 (обед 12–13) | EARTH-02 рельеф: ступень A (200 м), ступень B (50 м, центральные 10 км); в 11:15 — перезапуск пула с `PR_` |
| 13:15–14:30 | EARTH-03 среда (LST, IMERG, WorldCover) — запуски, пока GEE считает |
| 14:30–15:15 | EARTH-04 экспорт `earth_candidates.json` |
| 15:15–16:00 | EARTH-05 сверка GEE ↔ `terrain.py` (E2b) и проверки здравого смысла |
| 16:00–17:30 | SUB-03 источники → каркас Evidence на фикстурах (S2: вместо него EARTH-08) |
| 17:30 | IC-1 |
| Вс 09:00–09:45 | WEB-06 Evidence на реальных данных |
| 09:45–11:00 | Сверка SUB-03 с кодом; исправления; EARTH-09 (P2), если всё готово |

## 4. Мои файлы

`pipeline/earth/`, `data/processed/earth_candidates.json`, `web/src/pages/EvidencePage.tsx`, `web/src/components/evidence/`, `submission/references.md` (ведёте вы, остальные дописывают свои источники). Сырые результаты GEE — `data/raw/earth/` (вне git). Проверка: `python3 tools/tasks.py owner PATH`.

## 5. Интерфейсы, которые я реализую

**`earth_candidates.json`** (`egiz.earth_candidates` 1.0.0) — форма и правила в [API_AND_SCHEMA_CONTRACTS §2.1](../engineering/API_AND_SCHEMA_CONTRACTS.md). Ключи атрибутов одинаковые с целями: `slope_f100_p50_deg … elev_min_m`, `precip_mm`, `bare_frac`, `t_min_c`, `t_max_c`. Пропуск — `null` и ключ в `missing[]`; ноль пропуском не считается.

**Командная строка конвейера** (одна команда — один шаг, каждая печатает итоговые счётчики):

```text
python -m pipeline.earth.pool --dry-run            # счётчики по стратам, без записи
python -m pipeline.earth.gee_terrain --stage a     # затем --stage b
python -m pipeline.earth.gee_env --sample 20       # выборка для проверки единиц
python -m pipeline.earth.export                    # → data/processed/earth_candidates.json
python -m pipeline.earth.crosscheck --n 3          # E2b: GEE против terrain_attributes
python -m pipeline.earth.sanity                    # Badwater, Атакама, лес, Сухие долины
```

**ID квадратов:** `GL_E161.50_S77.50` (глобальная выборка), `PR_<ИМЯ>` (место практики, имя из `practice_sites.csv`), `CT_<КЛАСС>_E…_N…` (контроль для E7), `KZ_E051.20_N43.40` (P1). Центр — WGS84, квадрат строится в UTM-зоне центра.

**Evidence (S6)** — читает `validation.json` через store: таблица E1–E10 (гипотеза, метрика, значение, статус `confirmed` / `not_confirmed` / `not_run`), график E3 (pct по парам с линиями 10 % и 50 %), исключённые пары с причиной, ограничения (`limitations.md`), раскрытие подготовки ([PRE_EVENT_AUTHORIZATION §3](../competition/PRE_EVENT_AUTHORIZATION.md)), использование ИИ, источники. Отрицательные результаты показываются так же заметно, как положительные.

## 6. Что мне нужно от других и кто ждёт меня

| Направление | Что | Когда (план / последний срок) | Если нет |
| --- | --- | --- | --- |
| От A | Контракты v1 (схема `earth_candidates`) | Сб 11:00 / 11:30 | Экспорт по API_AND_SCHEMA_CONTRACTS §2.1, валидация после |
| От E | `practice_sites.csv` (координаты мест практики) | Сб 11:00 | Пул без `PR_`; E3 невозможна — сообщить D и E |
| От D | `terrain_attributes` (TERR-01) для сверки | Сб 10:30 / 15:00 | Сверка позже; без неё GEE-атрибуты помечаются «unverified» |
| От D | `validation.json` для Evidence | Сб 17:30 / Вс 10:00 | Evidence со статусом `not_run` |
| Ждёт D | `earth_candidates.json` | Сб 15:15 / 16:00 | D запускает срез на кандидатах со ступенью A |
| Ждёт D | Таблица сверки E2b | Сб 16:00 | В E2 только аналитические тесты |
| Ждёт A | Страница Evidence (WEB-06) | Вс 09:45 | В S3 — ссылка на `validation.json` из README |
| Ждут F и A | `submission/references.md` | Сб 16:45, сверка до Вс 11:00 | Подача без ссылок недопустима — приоритет над Evidence |

## 7. Как делать: подсказки

**EARTH-01.** Точки — `randomPoints` по маске каждой страты (seed 2026), фильтр голой поверхности ≥ 0,5 (в полярных районах — класс barren MCD12Q1). Квадрат строится в UTM-зоне центра, сторона 20 км ± 1 %. Плюс 60 контрольных квадратов `CT_` для E7 (по 20: лес, пашня, постоянный снег; доля класса > 0,7, `pool = "control"`) — с теми же атрибутами, но в кампаниях они не участвуют. Счётчики по стратам, контролям и континентам — в описание PR.

**EARTH-02.** Ступень A: `reduceResolution` до 200 м в проекции квадрата, уклон по центральным разностям на базе 400 м (`_f400`) и на 2 км (`_r`), `relief`, `tri_f400`, `elev_min`. Ступень B: 50 м, только центральные 10 × 10 км, база 100 м (`_f100`). Запросы группами по UTM-зоне, `getInfo` порциями ≤ 4 000, три повтора с паузой. Если к 15:00 ступень A не покрыла 95 % — ворота G-D.

**EARTH-03.** Единицы проверяйте тестом на известных числах: LST × 0,02 → K, − 273,15 → °C; IMERG — мм/ч × часы месяца → мм/месяц → сумма за год → среднее 2001–2024. Над льдом LST бывает пустым — тогда `null`, а не ноль.

**EARTH-05.** Скачать DEM 30 м трёх квадратов (`getDownloadURL` в UTM), посчитать `terrain_attributes` из `pipeline/common/terrain.py`, сравнить с GEE: |Δ `slope_f400_p50`| ≤ 0,5° или ≤ 10 %. Расхождение почти всегда — разная проекция или масштаб пикселя.

**SUB-03.** ID наборов собирайте из кода (`grep -rhoE "(COPERNICUS|NASA|MODIS|ESA|USDOS|CIESIN)/[A-Za-z0-9_/]+" pipeline | sort -u`), лицензии библиотек — из `requirements.txt` и `web/package.json`. Атрибуции: Copernicus DEM, ESA WorldCover, NASA GIBS, PGDA (Barker et al. 2021) — формулировки в [DATASET_SPECIFICATION §6](../science/DATASET_SPECIFICATION.md).

## 8. Готово, если

- `earth_candidates.json` проходит валидатор, `synthetic: false`, нет `FAKE_`, ≤ 3 МБ; в `provenance` — наборы, версии и периоды.
- Таблица сверки E2b и проверки здравого смысла записаны в PR и PROGRESS.md.
- Evidence показывает все эксперименты из `validation.json`, включая неподтверждённые и не запущенные.
- В `submission/references.md` есть каждый ID набора из кода и лицензия каждой библиотеки.

## 9. Задачи

<!-- BEGIN GENERATED:member-tasks:MEMBER_B -->
Задач: 12. До хакатона (PREP): 3 ч. На хакатоне P0+P1: 10 ч (P0 7 ч, P1 3 ч). Статусы смотрите командой `python3 tools/tasks.py next MEMBER_B`.

Порядок — по времени (сначала подготовка, затем хакатон; P2–P3 в конце).

| ID | Задача | P | Разрешение | Веха | Окно (Астана) | Ч | Зависит от | Флаги |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PREP-05 | Тренировка Earth Engine на постороннем районе с замером скорости | P1 | PERMITTED | M0 | до 08.11 | 3 | PREP-04 | — |
| EARTH-01 | Пул кандидатов: страты, места практики | P0 | DEFER_UNTIL_EVENT | M3 | Сб 09:30–10:30 (повтор с PR_ ~11:15) | 1 | KICK-01 | CRITICAL_PATH, HIGH_RISK |
| EARTH-02 | Атрибуты рельефа в GEE: ступени A и B | P0 | DEFER_UNTIL_EVENT | M3 | Сб 10:30–12:00 и 13:00–13:15 | 1,75 | EARTH-01 | CRITICAL_PATH, HIGH_RISK |
| EARTH-03 | Атрибуты среды в GEE | P0 | DEFER_UNTIL_EVENT | M3 | Сб 13:15–14:30 (запуски — пока считается EARTH-02) | 1,25 | EARTH-01 | PARALLELIZABLE |
| EARTH-04 | Экспорт earth_candidates.json | P0 | DEFER_UNTIL_EVENT | M3 | Сб 14:30–15:15 | 0,75 | EARTH-02, EARTH-03, INFRA-02 | CRITICAL_PATH |
| EARTH-05 | Сверка GEE с terrain.py (E2b) и проверки здравого смысла | P0 | DEFER_UNTIL_EVENT | M3 | Сб 15:15–16:00 | 0,75 | EARTH-04, TERR-01 | — |
| SUB-03 | Реестр источников и лицензий | P0 | DEFER_UNTIL_EVENT | M11 | Сб 16:00–16:45; сверка с кодом — Вс до 11:00 | 0,75 | EARTH-04, PLNT-03, WEB-01 | — |
| EARTH-08 | DEM 30 м для коротких списков | P1 | DEFER_UNTIL_EVENT | M6 | S2: Сб 16:45–17:45 | 1 | ENG-03 | — |
| EARTH-06 | Доля дней без снега по месяцам (MOD10A1) | P1 | DEFER_UNTIL_EVENT | M6 | S2: Сб 19:30–20:30 | 1 | EARTH-04 | — |
| EARTH-07 | Режим «Казахстан»: квадраты KZ_ | P1 | DEFER_UNTIL_EVENT | M6 | S2: Сб 20:30–21:30 | 1 | EARTH-04 | — |
| WEB-06 | Страница Evidence | P0 | DEFER_UNTIL_EVENT | M7 | Вс 09:00–09:45 (каркас на фикстурах — Сб 16:45–17:30) | 0,75 | WEB-01, VAL-02 | — |
| EARTH-09 | Перекрёстная проверка NASADEM | P2 | DEFER_UNTIL_EVENT | M8 | — | 0,5 | EARTH-05 | OPTIONAL |

**Помогаю другим (соисполнитель):** PREP-02 (MEMBER_F, Регистрация команды и сопровождение несовершеннолетних), PREP-04 (MEMBER_A, Аккаунты: Earthdata, Earth Engine, Vercel), PREP-11 (MEMBER_A, Тренировка команды: Git и Claude Code), PREP-12 (MEMBER_A, Окружение на шести ноутбуках), RULE-04 (MEMBER_A, 13.11 вечер: готовность к старту (IC-0)), KICK-01 (MEMBER_A, Старт 09:00: решения и пререгистрация), INFRA-02 (MEMBER_A, Контракты v1: схемы, валидатор, типы), INFRA-06 (MEMBER_A, Точки интеграции IC-1, IC-2, IC-3, снимок данных и релиз), SUB-04 (MEMBER_C, Раскрытие использования ИИ), SCI-05 (MEMBER_E, Научная проверка кампаний и кандидатов), STORY-04 (MEMBER_F, Репетиция питча)

**Входящие зависимости — что я жду от других:**

- PREP-05 ждёт **PREP-04** от MEMBER_A — Аккаунты: Earthdata, Earth Engine, Vercel
- EARTH-01 ждёт **KICK-01** от MEMBER_A — Старт 09:00: решения и пререгистрация
- EARTH-04 ждёт **INFRA-02** от MEMBER_A — Контракты v1: схемы, валидатор, типы
- EARTH-05 ждёт **TERR-01** от MEMBER_D — terrain.py: атрибуты рельефа на базах
- SUB-03 ждёт **PLNT-03** от MEMBER_C — targets.json
- SUB-03 ждёт **WEB-01** от MEMBER_A — Каркас приложения: маршруты, загрузка, store, токены
- EARTH-08 ждёт **ENG-03** от MEMBER_D — run.py: results.json
- WEB-06 ждёт **WEB-01** от MEMBER_A — Каркас приложения: маршруты, загрузка, store, токены
- WEB-06 ждёт **VAL-02** от MEMBER_D — Отрицательные контроли E7

**Исходящие — кто ждёт мои результаты:**

- **EARTH-04** → ENG-03 (MEMBER_D)
- **EARTH-05** → VAL-01 (MEMBER_D)
- **EARTH-07** → WEB-10 (MEMBER_A)
- **EARTH-08** → LIGHT-03 (MEMBER_C)
- **SUB-03** → SUB-06 (MEMBER_A)

#### Карточки задач

##### PREP-05 · Тренировка Earth Engine на постороннем районе с замером скорости

P1 · PREP · M0 · разрешение: PERMITTED (можно сейчас) · окно: до 08.11 · оценка 3 ч

**Цель.** Освоить reduceRegions по зонам UTM, reduceResolution, getInfo порциями; замерить время на 200 квадратов в постороннем районе.

**Зачем.** Расчёт в GEE — критический путь; замер даёт реальную оценку для EARTH-02.

**Зависит от:** PREP-04 (MEMBER_A)

**Шаги:**

1. Взять посторонний район (Южная Америка) и сетку 200 квадратов 20 км
2. Посчитать перцентили уклона на 200 м и время
3. Попробовать 50 м на центральных 10 км
4. Записать время и лимиты в PROGRESS.md (раздел MEMBER_B)

**Создать:** — · **Изменить:** `docs/planning/PROGRESS.md`

**Ожидаемый результат:** Замер скорости GEE

**Критерии приёмки:**

- [ ] Есть замер времени для 200 квадратов на 200 м и 50 м
- [ ] Учебный код не в этом репозитории

**Ручная проверка:** Запись в PROGRESS.md

**Команды проверки:**

- manual: замер записан

**Доказательство готовности:** Время в минутах и число квадратов

**Типовые сбои:** Квоты Community tier малы · **Запасной путь:** Сократить пул до 1 500 кандидатов в EARTH-01

##### EARTH-01 · Пул кандидатов: страты, места практики

P0 · HACK · M3 · разрешение: DEFER_UNTIL_EVENT (только с начала хакатона) · окно: Сб 09:30–10:30 (повтор с PR_ ~11:15) · оценка 1 ч · не раньше 14.11.2026 09:00 (Астана) · флаги: CRITICAL_PATH, HIGH_RISK · соисполнители: MEMBER_E

**Цель.** Построить ~3 000 квадратов 20 км: 4 страты (горячие пустыни, холодные и полярные, вулканические, прочая открытая суша) + места практики PR_.

**Зачем.** От состава пула зависят и находки, и честность проверки.

**Зависит от:** KICK-01 (MEMBER_A)

**Шаги:**

1. pipeline/earth/pool.py: суша LSIB, страты, randomPoints(seed=2026)
2. Фильтр голой поверхности ≥ 0,5 (полярные — MCD12Q1 barren)
3. Квадраты 20 км в UTM центра; ID GL_E…_N…
4. Контроли для E7: по 20 квадратов CT_ из леса, пашни и постоянного снега (доля класса > 0,7), pool = control
5. Добавить PR_ из data/curated/practice_sites.csv (повторный запуск после SCI-03)
6. Счётчики по стратам и контролям — в PR

**Создать:** `pipeline/earth/__init__.py`, `pipeline/earth/pool.py`, `pipeline/earth/tests/test_pool.py` · **Изменить:** —

**Интерфейсы:** EarthTile.id, pool, stratum · **Данные:** USDOS/LSIB_SIMPLE/2017; ESA/WorldCover/v200; MODIS/061/MCD12Q1

**Ожидаемый результат:** Пул в GEE и список ID

**Критерии приёмки:**

- [ ] ≥ 2 500 GL_, все PR_ и 60 CT_
- [ ] Стороны 20 км ± 1 %
- [ ] Seed воспроизводит пул
- [ ] ≥ 5 континентов и полярная страта

**Автотесты:** `pytest pipeline/earth/tests/test_pool.py -q`

**Команды проверки:**

- `python -m pipeline.earth.pool --dry-run`

**Доказательство готовности:** Счётчики по стратам

**Типовые сбои:** Мало полярных точек; GEE не отвечает · **Запасной путь:** Увеличить выборку страты; при отказе GEE — R04 (AWS для PR_ и 300 GL_)

##### EARTH-02 · Атрибуты рельефа в GEE: ступени A и B

P0 · HACK · M3 · разрешение: DEFER_UNTIL_EVENT (только с начала хакатона) · окно: Сб 10:30–12:00 и 13:00–13:15 · оценка 1,75 ч · не раньше 14.11.2026 09:00 (Астана) · флаги: CRITICAL_PATH, HIGH_RISK

**Цель.** Ступень A (200 м, весь квадрат 20 км): _f400, _r, relief, tri_f400, elev_min; ступень B (50 м, центральные 10 км): _f100, tri_f100 — по MATHEMATICAL_SPECIFICATION §3.

**Зачем.** Рельеф на базах NASA — основа задач посадки, EVA и мобильности.

**Зависит от:** EARTH-01 (MEMBER_B)

**Шаги:**

1. pipeline/earth/gee_terrain.py: stage_a и stage_b по зонам UTM (ALGORITHMS A3)
2. getInfo порциями ≤ 4 000 квадратов, повтор ×3 с паузой
3. Пока считается ступень B — запускать EARTH-03 (расчёт идёт на сервере GEE)
4. Сохранить сырые результаты в data/raw/earth/ (вне git)

**Создать:** `pipeline/earth/gee_terrain.py`, `pipeline/earth/tests/test_gee_terrain.py` · **Изменить:** —

**Интерфейсы:** Ключи атрибутов API_AND_SCHEMA_CONTRACTS §1 · **Данные:** COPERNICUS/DEM/GLO30

**Ожидаемый результат:** Атрибуты рельефа пула (data/raw/earth/)

**Критерии приёмки:**

- [ ] Атрибуты ступени A для ≥ 95 % пула
- [ ] Ступень B для ≥ 80 % пула или отметка proxy
- [ ] Пропуски = null, ноль не подставляется

**Автотесты:** `pytest pipeline/earth -q`

**Ручная проверка:** Доля покрытия ступеней A и B — в PR

**Команды проверки:**

- `python -m pipeline.earth.gee_terrain --stage a --dry-run`

**Доказательство готовности:** Доля покрытия ступеней A и B, время расчёта

**Типовые сбои:** Таймауты GEE; Ступень B не успевает; Квоты Community tier · **Запасной путь:** Ступень B только для 600 кандидатов холодной и вулканической страт; иначе proxy baseline 400 м с пометкой (R04)

##### EARTH-03 · Атрибуты среды в GEE

P0 · HACK · M3 · разрешение: DEFER_UNTIL_EVENT (только с начала хакатона) · окно: Сб 13:15–14:30 (запуски — пока считается EARTH-02) · оценка 1,25 ч · не раньше 14.11.2026 09:00 (Астана) · флаги: PARALLELIZABLE

**Цель.** precip_mm, bare_frac, t_min_c, t_max_c и контекст по MATHEMATICAL_SPECIFICATION §4.

**Зачем.** Холод, сухость и открытость поверхности — атрибуты задач O2, O5, M3, M4.

**Зависит от:** EARTH-01 (MEMBER_B)

**Шаги:**

1. pipeline/earth/gee_env.py: LST P5 ночь и P95 день за 2015–2024
2. IMERG: мм/ч × часы → год → среднее 2001–2024
3. WorldCover доли классов; вне покрытия MCD12Q1
4. Единицы — тестом на известных числах

**Создать:** `pipeline/earth/gee_env.py`, `pipeline/earth/tests/test_units.py` · **Изменить:** —

**Интерфейсы:** — · **Данные:** MODIS/061/MOD11A2; MODIS/061/MYD11A2; NASA/GPM_L3/IMERG_MONTHLY_V07; ESA/WorldCover/v200; MODIS/061/MCD12Q1

**Ожидаемый результат:** Атрибуты среды

**Критерии приёмки:**

- [ ] Масштабные коэффициенты верны (тест)
- [ ] Пропуски = null
- [ ] provenance с периодами

**Автотесты:** `pytest pipeline/earth/tests/test_units.py -q`

**Команды проверки:**

- `python -m pipeline.earth.gee_env --sample 20`

**Доказательство готовности:** Вывод тестов и выборка 20 квадратов

**Типовые сбои:** LST пусты над льдом · **Запасной путь:** null и исключение из задач с холодом

##### EARTH-04 · Экспорт earth_candidates.json

P0 · HACK · M3 · разрешение: DEFER_UNTIL_EVENT (только с начала хакатона) · окно: Сб 14:30–15:15 · оценка 0,75 ч · не раньше 14.11.2026 09:00 (Астана) · флаги: CRITICAL_PATH

**Цель.** Собрать атрибуты в файл по контракту с tiles_hash и provenance.

**Зачем.** Вход движка и сайта.

**Зависит от:** EARTH-02 (MEMBER_B), EARTH-03 (MEMBER_B), INFRA-02 (MEMBER_A)

**Шаги:**

1. pipeline/earth/export.py
2. Округление по контракту
3. missing по null
4. Валидация

**Создать:** `pipeline/earth/export.py`, `data/processed/earth_candidates.json` · **Изменить:** —

**Интерфейсы:** EarthCandidates · **Данные:** —

**Ожидаемый результат:** data/processed/earth_candidates.json

**Критерии приёмки:**

- [ ] Файл проходит схему
- [ ] synthetic=false, нет FAKE_
- [ ] ≤ 3 МБ

**Автотесты:** `python -m pipeline.contracts.validate data/processed/earth_candidates.json`

**Команды проверки:**

- `python -m pipeline.earth.export && python -m pipeline.contracts.validate data/processed/earth_candidates.json`

**Доказательство готовности:** Вывод валидатора, размер, число кандидатов

**Типовые сбои:** Файл > 3 МБ · **Запасной путь:** Убрать контекстные поля кроме нужных ограничениям

##### EARTH-05 · Сверка GEE с terrain.py (E2b) и проверки здравого смысла

P0 · HACK · M3 · разрешение: DEFER_UNTIL_EVENT (только с начала хакатона) · окно: Сб 15:15–16:00 · оценка 0,75 ч · не раньше 14.11.2026 09:00 (Астана) · соисполнители: MEMBER_E

**Цель.** Сверить атрибуты GEE с terrain_attributes на 3 квадратах (E2b); проверить известные значения: Badwater ≈ −86 ± 15 м, Карагие ≈ −132 ± 15 м (если в пуле), Атакама < 50 мм/год, лес — bare_frac < 0,1, Сухие долины — t_min < −40 °C.

**Зачем.** Ловит ошибки единиц, проекций и формул до того, как на данных построят кампании и их увидят судьи.

**Зависит от:** EARTH-04 (MEMBER_B), TERR-01 (MEMBER_D)

**Шаги:**

1. crosscheck.py: скачать DEM 30 м трёх квадратов (getDownloadURL), посчитать terrain_attributes, сравнить с GEE
2. sanity.py по PR_ и известным координатам
3. Таблицы — в PR и PROGRESS.md; результат E2b передать D для validation.json

**Создать:** `pipeline/earth/crosscheck.py`, `pipeline/earth/tests/test_crosscheck.py`, `pipeline/earth/sanity.py` · **Изменить:** `docs/planning/PROGRESS.md`

**Интерфейсы:** terrain_attributes() из pipeline/common/terrain.py · **Данные:** COPERNICUS/DEM/GLO30

**Ожидаемый результат:** Таблица сверки E2b; Отчёт проверок здравого смысла

**Критерии приёмки:**

- [ ] |Δ slope_f400_p50| ≤ 0,5° или ≤ 10 % на 3 квадратах
- [ ] Все проверки здравого смысла выполнены
- [ ] Провалы разобраны: исправлены или записаны в ограничения

**Автотесты:** `pytest pipeline/earth/tests/test_crosscheck.py -q`, `python -m pipeline.earth.sanity`

**Команды проверки:**

- `python -m pipeline.earth.crosscheck --n 3`
- `python -m pipeline.earth.sanity`

**Доказательство готовности:** Таблица сверки и таблица значений

**Типовые сбои:** Расхождение из-за разной проекции или масштаба; Badwater не в пуле · **Запасной путь:** Проверить UTM-зону и масштаб пикселя; добавить точку практики PR_DEATH_VALLEY

##### SUB-03 · Реестр источников и лицензий

P0 · HACK · M11 · разрешение: DEFER_UNTIL_EVENT (только с начала хакатона) · окно: Сб 16:00–16:45; сверка с кодом — Вс до 11:00 · оценка 0,75 ч · не раньше 14.11.2026 09:00 (Астана) · соисполнители: MEMBER_A, MEMBER_C, MEMBER_E, MEMBER_F

**Цель.** submission/references.md: наборы (ID, версия, лицензия, ссылка), библиотеки, статьи, шрифты, иконки, музыка.

**Зачем.** Без ссылок и лицензий могут снять награду (Terms & Conditions).

**Зависит от:** EARTH-04 (MEMBER_B), PLNT-03 (MEMBER_C), WEB-01 (MEMBER_A)

**Шаги:**

1. Собрать ID наборов из pipeline/ (grep)
2. Лицензии из requirements.txt и web/package.json
3. Атрибуции Copernicus, WorldCover, GIBS, PGDA (Barker et al. 2021)

**Создать:** `submission/references.md` · **Изменить:** —

**Ожидаемый результат:** references.md

**Критерии приёмки:**

- [ ] Все ID из кода есть в реестре
- [ ] У каждой библиотеки лицензия

**Ручная проверка:** Сверка grep

**Команды проверки:**

- `grep -rhoE "(COPERNICUS|NASA|MODIS|ESA|USDOS|CIESIN)/[A-Za-z0-9_/]+" pipeline | sort -u`

**Доказательство готовности:** Число записей

**Типовые сбои:** Неизвестна лицензия пакета · **Запасной путь:** Заменить пакет или указать «unknown — removed»

##### EARTH-08 · DEM 30 м для коротких списков

P1 · HACK · M6 · разрешение: DEFER_UNTIL_EVENT (только с начала хакатона) · окно: S2: Сб 16:45–17:45 · оценка 1 ч · не раньше 14.11.2026 09:00 (Астана)

**Цель.** Скачать окна Copernicus 30 м (20 км + 5 км) для топ-30 кандидатов по задачам Луны и площадок кампаний.

**Зачем.** Вход теней и «То же Солнце».

**Зависит от:** ENG-03 (MEMBER_D)

**Шаги:**

1. pipeline/earth/dem_windows.py: список из results.json
2. getDownloadURL в UTM, 30 м
3. Сохранить в data/raw/earth_dem30/

**Создать:** `pipeline/earth/dem_windows.py` · **Изменить:** —

**Интерфейсы:** — · **Данные:** COPERNICUS/DEM/GLO30

**Ожидаемый результат:** Окна DEM 30 м

**Критерии приёмки:**

- [ ] ≥ 25 окон
- [ ] Проекция и размер проверены

**Автотесты:** `pytest pipeline/earth -q`

**Команды проверки:**

- `ls data/raw/earth_dem30 | wc -l`

**Доказательство готовности:** Число окон

**Типовые сбои:** Лимит getDownloadURL · **Запасной путь:** Уменьшить окно до 15 км

##### EARTH-06 · Доля дней без снега по месяцам (MOD10A1)

P1 · HACK · M6 · разрешение: DEFER_UNTIL_EVENT (только с начала хакатона) · окно: S2: Сб 19:30–20:30 · оценка 1 ч · не раньше 14.11.2026 09:00 (Астана)

**Цель.** snow_free_frac[12] для всех кандидатов (minor 1.1 контракта).

**Зачем.** Делает окна освещения реалистичными.

**Зависит от:** EARTH-04 (MEMBER_B)

**Шаги:**

1. pipeline/earth/gee_snow.py
2. NDSI_Snow_Cover < 10 → без снега
3. Добавить поле в экспорт

**Создать:** `pipeline/earth/gee_snow.py` · **Изменить:** `pipeline/earth/export.py`

**Интерфейсы:** — · **Данные:** MODIS/061/MOD10A1

**Ожидаемый результат:** snow_free_frac

**Критерии приёмки:**

- [ ] Поле есть у ≥ 90 % кандидатов
- [ ] Значения в [0,1]

**Автотесты:** `pytest pipeline/earth -q`

**Команды проверки:**

- `python -m pipeline.contracts.validate data/processed/earth_candidates.json`

**Доказательство готовности:** Покрытие поля

**Типовые сбои:** Пропуски полярной ночью · **Запасной путь:** null — месяц не рассматривается

##### EARTH-07 · Режим «Казахстан»: квадраты KZ_

P1 · HACK · M6 · разрешение: DEFER_UNTIL_EVENT (только с начала хакатона) · окно: S2: Сб 20:30–21:30 · оценка 1 ч · не раньше 14.11.2026 09:00 (Астана)

**Цель.** Добавить квадраты Казахстана с долей голой поверхности ≥ 0,3 и теми же атрибутами (pool=kazakhstan).

**Зачем.** Локальная польза.

**Зависит от:** EARTH-04 (MEMBER_B)

**Шаги:**

1. pipeline/earth/kz.py: граница LSIB, решётка 20 км, фильтр
2. Ступени A и B, среда
3. Добавить в экспорт

**Создать:** `pipeline/earth/kz.py` · **Изменить:** `pipeline/earth/export.py`

**Интерфейсы:** — · **Данные:** USDOS/LSIB_SIMPLE/2017

**Ожидаемый результат:** KZ_ в earth_candidates.json

**Критерии приёмки:**

- [ ] KZ_ проходят схему
- [ ] Счётчик в PR

**Автотесты:** `pytest pipeline/earth -q`

**Команды проверки:**

- `python -m pipeline.contracts.validate data/processed/earth_candidates.json`

**Доказательство готовности:** Число KZ_

**Типовые сбои:** Файл растёт > 3 МБ · **Запасной путь:** Только KZ_ с bare ≥ 0,5

##### WEB-06 · Страница Evidence

P0 · HACK · M7 · разрешение: DEFER_UNTIL_EVENT (только с начала хакатона) · окно: Вс 09:00–09:45 (каркас на фикстурах — Сб 16:45–17:30) · оценка 0,75 ч · не раньше 14.11.2026 09:00 (Астана)

**Цель.** Экран S6: таблица E1–E10 из validation.json, график E3, ограничения, источники, раскрытие подготовки, ИИ.

**Зачем.** Главное доказательство для критерия Validity и Best Use of Science.

**Зависит от:** WEB-01 (MEMBER_A), VAL-02 (MEMBER_D)

**Шаги:**

1. web/src/pages/EvidencePage.tsx и web/src/components/evidence/
2. Таблица экспериментов со статусами
3. SVG-график pct с линиями 10 % и 50 %
4. Тексты: limitations.md, раскрытие (PRE_EVENT_AUTHORIZATION §3), ai_use.md
5. Vitest: статусы из данных

**Создать:** `web/src/pages/EvidencePage.tsx`, `web/src/components/evidence/` · **Изменить:** —

**Интерфейсы:** Validation · **Данные:** —

**Ожидаемый результат:** Экран Evidence

**Критерии приёмки:**

- [ ] Все числа из validation.json
- [ ] Отрицательные результаты видны
- [ ] Источники и раскрытие есть

**Автотесты:** `npm --prefix web test -- --run`

**Ручная проверка:** Проверка на прод-ссылке

**Команды проверки:**

- `npm --prefix web run build`

**Доказательство готовности:** Скриншот и вывод тестов

**Типовые сбои:** validation.json не готов · **Запасной путь:** Показать таблицу со статусом not_run

##### EARTH-09 · Перекрёстная проверка NASADEM

P2 · HACK · M8 · разрешение: DEFER_UNTIL_EVENT (только с начала хакатона) · окно: — · оценка 0,5 ч · не раньше 14.11.2026 09:00 (Астана) · флаги: OPTIONAL

**Цель.** slope_f400_p50 по NASADEM для ≥ 100 кандидатов; медиана и P90 |Δ|.

**Зачем.** Устойчивость к выбору DEM.

**Зависит от:** EARTH-05 (MEMBER_B)

**Шаги:**

1. crosscheck.py --dem nasadem --n 100
2. Передать D для validation.json

**Создать:** — · **Изменить:** `pipeline/earth/crosscheck.py`

**Интерфейсы:** — · **Данные:** NASA/NASADEM_HGT/001

**Ожидаемый результат:** Таблица сравнения

**Критерии приёмки:**

- [ ] Таблица ≥ 100
- [ ] Числа переданы

**Автотесты:** `python -m pipeline.earth.crosscheck --dem nasadem --n 100`

**Команды проверки:**

- `python -m pipeline.earth.crosscheck --dem nasadem --n 100`

**Доказательство готовности:** Медиана и P90

**Типовые сбои:** Квадраты вне покрытия NASADEM (севернее 60° с. ш.) · **Запасной путь:** Не публикуем; в ограничениях — только Copernicus
<!-- END GENERATED:member-tasks:MEMBER_B -->

## 10. Замена

Заместитель — MEMBER_C (в случае отказа GEE у B — запасной проект MEMBER_A). Протокол продолжения — [CLAUDE.md §8](../../CLAUDE.md).
