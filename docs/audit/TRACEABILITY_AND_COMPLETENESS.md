# Трассировка и проверка полноты

Владелец: MEMBER_A (структура), MEMBER_E (научные утверждения). Обновляется 28.10 (RULE-01: требования полного условия) и при изменении плана. Автоматическая часть §2 генерируется `python3 tools/tasks.py render`.

## 1. Требование → утверждение → функция → модуль → задача → участник → тест → доказательство в демо

Требования — из краткого описания челленджа (OFFICIAL_RULES §2, пересказ от 17.09) и правил конкурса. Утверждения — [SCIENTIFIC_CLAIMS_REGISTER](../science/SCIENTIFIC_CLAIMS_REGISTER.md), экраны — [SCREEN_BY_SCREEN_SPEC](../product/SCREEN_BY_SCREEN_SPEC.md), эксперименты — [VALIDATION_PROTOCOL](../science/VALIDATION_PROTOCOL.md).

| # | Требование | Утверждение | Функция продукта | Модуль | Задачи | Участники | Тест | Доказательство в демо |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | Использовать данные NASA о Земле, Луне и Марсе | C1, C11 | `provenance` во всех JSON; источники в Evidence и подвале | `pipeline/earth`, `pipeline/planets`, `pipeline/contracts` | EARTH-02, EARTH-03, PLNT-01, PLNT-02, SUB-03 | B, C | Валидатор контрактов (`provenance` обязателен); сверка ID наборов в SUB-03 | Слайд 4; поле NASA Data; Evidence → Sources |
| R2 | Найти места на Земле, аналогичные районам баз на Луне и местам посадки на Марсе | C5, C4 | Campaign: фронт k = 1…3, карточка, карта | `pipeline/engine/campaign.py`, `web/src/components/campaign/`, `web/src/components/map/` | SCI-01, PLNT-03, ENG-02, ENG-03, WEB-03, WEB-04 | E, C, D, A | E4 (`test_campaign.py`), E10, Vitest панелей | Живое демо, шаги 1–8; слайд 5 |
| R3 | Описать аналоги: что совпадает и чего нет | C9, C6, C1 | Панель площадки; «What Earth cannot test»; окна низкого Солнца | `fidelity.py`, `gap_ledger`, `sun.py`, `web/src/components/site/` | ENG-01, ENG-02, LIGHT-01, LIGHT-02, WEB-05, SCI-02, SCI-06 | D, C, E | `test_fidelity.py`, E1 (`test_sun.py`), Vitest панели площадки | Панель площадки; блок разрывов; слайд 5 |
| R4 | Учитывать рельеф, геологию, освещение и среду | C1, C6, C7, (P1) C8 | Атрибуты на базах NASA; окна; (P1) «То же Солнце», геология | `terrain.py`, `gee_terrain.py`, `gee_env.py`, `sun.py`, (P1) `shadows.py` | TERR-01, EARTH-02, EARTH-03, PLNT-02, LIGHT-01, LIGHT-02, (P1) LIGHT-03, LIGHT-04, SCI-07 | D, B, C, E | E2 (`test_terrain.py`, сверка EARTH-05), E1, (P1) E8 | Атрибуты в панели площадки; (P1) экран Twin |
| R5 | Типы сред: пустыни, полярные, вулканические, засушливые районы, пещеры | — | Страты пула; ограничения про пещеры | `pipeline/earth/pool.py` | EARTH-01, SCI-06 | B, E | `test_pool.py` (счётчики по стратам) | Карта по задаче; текст ограничений |
| R6 | Научная обоснованность (критерии Validity, Best Use of Science) | C2, C3, C4, C12, (P1) C10 | Evidence: эксперименты, исключённые пары, ограничения | `validate_practice.py`, `controls.py`, (P1) `robustness.py` | KICK-01, SCI-03, VAL-01, VAL-02, SCI-09, WEB-06 | A, E, D, B | E3, E7, хэш пререгистрации в `validation.json` | Слайд 6; экран Evidence |
| R7 | Демо: ≤ 7 слайдов или видео ≤ 30 с | — | 7 слайдов (P0); видео (P1) | `submission/` | STORY-03, STORY-06, (P1) STORY-05 | F | Подсчёт слайдов; `ffprobe` ≤ 30,0 с | Официальное демо |
| R8 | Несовершеннолетние: без имён, лиц и голосов | — | Ники в git; титры без имён; видео без лиц и голосов | — | PREP-03, SUB-05, STORY-05 | A, F | Поиск имён по списку вне репозитория; `git log --format='%an <%ae>'` | Титульный слайд без имён |
| R9 | Раскрытие ИИ, ссылки на источники, открытая лицензия | — | README: AI use, References, MIT | `README.md`, `submission/` | INFRA-01, SUB-01, SUB-03, SUB-04 | A, C, B | Поиск пометок ИИ; сверка ID наборов | README и поле AI на странице |
| R10 | Работа над проектом только с 14.11 09:00 | — | Раскрытие подготовки; история коммитов | `tools/tasks.py` (категории разрешений) | Все задачи HACK; AUTH-01, AUTH-02 — только с разрешением | все | `tools/tasks.py` отказывает до старта и без разрешения | README → Timeline |
| R11 | Ссылки открываются без входа; рабочий продукт | — | Статический сайт; офлайн-сборка | `web/`, `vercel.json` | INFRA-05, QA-03, SUB-05 | A | Проверка в инкогнито; офлайн без Wi‑Fi | Ссылка на сайт; запасной офлайн-показ |

Требования полного условия (28.10) добавляются сюда в RULE-01; требование без задачи — ошибка плана.

## 2. Проверки полноты

### 2.1 Автоматические (генерируются из реестра)

<!-- BEGIN GENERATED:completeness -->
| Проверка | Как проверяется | Результат |
| --- | --- | --- |
| Задачи без владельца | owner ∈ MEMBER_A…F | OK |
| Циклы зависимостей | поиск цикла в графе | OK |
| Главное демо без необязательных модулей | P0 зависят только от P0 | OK |
| У каждой задачи проверяемое «готово» | критерии + (автотесты или ручная проверка) + доказательство | OK |
| У каждой задачи шаги выполнения | steps не пуст | OK |
| У задач хакатона сбои и запасной путь | failure_modes и fallback не пусты | OK |
| Пути файлов согласованы с планом файлов | каждый путь задачи хакатона есть в FILE_BY_FILE_BUILD_PLAN | OK |
| Файлы меняет их владелец | ownership в tasks.json | OK |
| Общие файлы меняются по порядку | правка только после задачи-создателя | OK |
| Категории разрешений | HACK ⇔ DEFER_UNTIL_EVENT; без разрешения не начинать | OK |
| Ссылки документов на задачи | все ID в docs существуют (кроме архива) | OK |
| Расписание S1 | модель `tools/tasks.py schedule` | помещается; запас 0,83 ч по часам |
| Расписание S1_STRICT | модель `tools/tasks.py schedule` | только при 100 %; при 75 % не хватает 2,17 ч |
| Расписание S2 | модель `tools/tasks.py schedule` | помещается; запас 5,33 ч по часам |
| Расписание S3 | модель `tools/tasks.py schedule` | только при 100 %; при 75 % не хватает 0,17 ч |

Задач всего: 94; хакатона: 73; P0 хакатона: 47 (40,75 ч).
<!-- END GENERATED:completeness -->

### 2.2 Ручные

| Проверка | Результат | Доказательство |
| --- | --- | --- |
| Конфликтующие интерфейсы | Не найдено: один источник — API_AND_SCHEMA_CONTRACTS и FUNCTION_SPECIFICATIONS; сигнатуры в документах участников сверены со спецификацией функций; ключи атрибутов одинаковы для Земли и целей; контракт `sun_windows` переведён на широтные полосы, ссылки обновлены | API_AND_SCHEMA_CONTRACTS §1–§4; MEMBER_C §5, MEMBER_D §5 |
| Нереалистичное расписание | S1 помещается с запасом < 1 ч при 75 % — тонко; S1-строгий — только при 100 %; аварийный S3 при 75 % не хватает 10 минут. **Открытый блокер:** ответ организаторов на вопросы 4–5 (PREP-01). Порядок сокращения записан заранее | CRITICAL_PATH_AND_DEPENDENCIES §3; CONTINGENCY_PLAN §3 |
| Непроверенные технологии | Не проверены до старта: квоты и условия Earth Engine для несовершеннолетних (PREP-04), скорость ступеней A и B (PREP-05), чтение окон PGDA по HTTP (PLNT-01; заранее — только с разрешением A2), шаблон GIBS в MapLibre (PREP-08), условия Vercel (PREP-04). Для каждой — запасной путь в карточке задачи | RISK_REGISTER R03, R04, R13 |
| Функции без научной ценности | WEB-12 (3D, P3) — без научной ценности, помечена OPTIONAL и режется первой; WEB-10 «Казахстан» — локальная польза, не наука, P1; WEB-08 матрица — объяснимость; остальные функции P0 и P1 опираются на атрибуты, эксперименты или утверждения | CONTINGENCY_PLAN §4 |
| Главное демо без необязательных модулей | Сценарий Brief → Campaign → площадка → Evidence использует только P0; в S3 — Campaign → слайды 5–6 | SIGNATURE_DEMO §3, §6; §2.1 выше |
| Отличие от похожих решений | Кампания под задачи миссии с потолками, базы критериев NASA, пререгистрированная проверка по практике, окна низкого Солнца по месяцам — ни у Planetary Analog Explorer, ни у работы NHSJS 2026, ни у видимых команд на странице челленджа | COMPETITIVE_LANDSCAPE; FINAL_CONCEPT_DECISION |
| Каждая функция P0 имеет проверяемое «готово» | Да: у всех 47 задач P0 хакатона есть критерии, тест или ручная проверка, доказательство, сбои и запасной путь | §2.1 выше |

### 2.3 Вывод

Система планирования готова к работе **с документированными блокерами**, которые нельзя снять до события:

1. Ответы организаторов на вопросы 1, 4, 5 и A1–A3 (PREP-01) — определяют сценарий (DEC-024), дедлайн и разрешения.
2. Полное условие челленджа 28.10 (RULE-01) — может добавить требования в §1.
3. Замеры технологий (PREP-04, PREP-05, PREP-06, PREP-08) — подтверждают оценки EARTH-02 и PLNT-01.

## 3. Где ответ на 32 вопроса задания

| # | Вопрос | Где ответ |
| --- | --- | --- |
| 1 | Что именно наш продукт? | [COMPLETE_PRODUCT_SPEC §1](../product/COMPLETE_PRODUCT_SPEC.md), [FINAL_CONCEPT_DECISION](../innovation/FINAL_CONCEPT_DECISION.md), README |
| 2 | Что делает его научно осмысленным? | [MATHEMATICAL_SPECIFICATION §3, §6–§9](../science/MATHEMATICAL_SPECIFICATION.md), [VALIDATION_PROTOCOL](../science/VALIDATION_PROTOCOL.md) |
| 3 | Почему концепция оригинальна? | [FINAL_CONCEPT_DECISION](../innovation/FINAL_CONCEPT_DECISION.md), [CONCEPT_EVALUATION](../innovation/CONCEPT_EVALUATION.md) |
| 4 | Чем отличается от существующих инструментов? | [COMPETITIVE_LANDSCAPE](../research/COMPETITIVE_LANDSCAPE.md), [SCIENTIFIC_PRIOR_ART](../research/SCIENTIFIC_PRIOR_ART.md) |
| 5 | Почему это важно судьям? | [JUDGING_READINESS §1, §3–§4](../competition/JUDGING_READINESS.md) |
| 6 | Какие наборы данных NASA? | [DATASET_SPECIFICATION §1–§3](../science/DATASET_SPECIFICATION.md) |
| 7 | Какие точно алгоритмы? | [ALGORITHMS_AND_PSEUDOCODE A1–A12](../science/ALGORITHMS_AND_PSEUDOCODE.md) |
| 8 | Какие вычисления выполняются? | [MATHEMATICAL_SPECIFICATION](../science/MATHEMATICAL_SPECIFICATION.md), [FINAL_ARCHITECTURE §2](../engineering/FINAL_ARCHITECTURE.md) |
| 9 | Как проверяем вычисления? | [VALIDATION_PROTOCOL E1–E10](../science/VALIDATION_PROTOCOL.md), [TESTING_STRATEGY](../engineering/TESTING_STRATEGY.md) |
| 10 | Как будет выглядеть интерфейс? | [DESIGN_SYSTEM](../product/DESIGN_SYSTEM.md), [SCREEN_BY_SCREEN_SPEC](../product/SCREEN_BY_SCREEN_SPEC.md) |
| 11 | Что на каждом экране? | [SCREEN_BY_SCREEN_SPEC S0–S7](../product/SCREEN_BY_SCREEN_SPEC.md) |
| 12 | Что делает каждая важная кнопка? | [SCREEN_BY_SCREEN_SPEC](../product/SCREEN_BY_SCREEN_SPEC.md) — колонки «Элементы и что они делают» |
| 13 | Какая итоговая архитектура? | [FINAL_ARCHITECTURE](../engineering/FINAL_ARCHITECTURE.md) |
| 14 | Какие файлы нужно создать? | [FILE_BY_FILE_BUILD_PLAN](../engineering/FILE_BY_FILE_BUILD_PLAN.md); поля `files_create` / `files_modify` в реестре |
| 15 | Какие функции и интерфейсы нужны? | [FUNCTION_SPECIFICATIONS](../engineering/FUNCTION_SPECIFICATIONS.md), [API_AND_SCHEMA_CONTRACTS](../engineering/API_AND_SCHEMA_CONTRACTS.md) |
| 16 | Кто реализует каждый модуль? | [FINAL_ARCHITECTURE §3](../engineering/FINAL_ARCHITECTURE.md), CLAUDE.md §9, `ownership` в реестре |
| 17 | В какой последовательности? | [ULTRA_DETAILED_ROADMAP §3–§4](../planning/ULTRA_DETAILED_ROADMAP.md), [HOUR_BY_HOUR_EXECUTION](../planning/HOUR_BY_HOUR_EXECUTION.md), [FILE_BY_FILE_BUILD_PLAN §10](../engineering/FILE_BY_FILE_BUILD_PLAN.md) |
| 18 | Какие точные зависимости? | [CRITICAL_PATH_AND_DEPENDENCIES](../planning/CRITICAL_PATH_AND_DEPENDENCIES.md), поле `dependencies` в реестре |
| 19 | Какие тесты должны пройти? | [TESTING_STRATEGY §2](../engineering/TESTING_STRATEGY.md), поля `automated_tests` в реестре |
| 20 | Чем демо запомнится? | [SIGNATURE_DEMO §1–§2](../product/SIGNATURE_DEMO.md) |
| 21 | Что будет, если откажет API? | [CONTINGENCY_PLAN §5](../planning/CONTINGENCY_PLAN.md), [API_AND_SCHEMA_CONTRACTS §4](../engineering/API_AND_SCHEMA_CONTRACTS.md), поле `fallback` |
| 22 | Что убираем, если не хватает времени? | [CONTINGENCY_PLAN §3–§4](../planning/CONTINGENCY_PLAN.md) |
| 23 | Как воспроизвести научный результат? | [VALIDATION_PROTOCOL](../science/VALIDATION_PROTOCOL.md) (строки «Воспроизведение»), E10, README → Reproduce |
| 24 | Что остаётся неопределённым? | §2.3 выше, [RISK_REGISTER](../planning/RISK_REGISTER.md), [JUDGING_READINESS §6](../competition/JUDGING_READINESS.md) |
| 25 | Что законно можно делать до хакатона? | [PRE_EVENT_AUTHORIZATION §2](../competition/PRE_EVENT_AUTHORIZATION.md) |
| 26 | Что ждёт официального разрешения? | [PRE_EVENT_AUTHORIZATION §2, §4, §6](../competition/PRE_EVENT_AUTHORIZATION.md) |
| 27–32 | Что первым делом делает MEMBER_A…MEMBER_F? | [MEMBER_A](../team/MEMBER_A.md) · [B](../team/MEMBER_B.md) · [C](../team/MEMBER_C.md) · [D](../team/MEMBER_D.md) · [E](../team/MEMBER_E.md) · [F](../team/MEMBER_F.md) — раздел 2 «Первые действия» |
