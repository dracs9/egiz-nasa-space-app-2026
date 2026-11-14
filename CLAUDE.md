# CLAUDE.md — как работать в этом репозитории

Этот файл читает Claude Code в начале каждой сессии. Здесь всё, что нужно, чтобы по фразе «Выполни задачи MEMBER_B» сделать правильную работу без пересказа проекта. Подробности — в документах по ссылкам.

## 0. Проект за 30 секунд

- **Что:** Egiz v2 (рабочее название) — **проектировщик кампании аналоговых испытаний**. Пользователь выбирает цель (район базы у южного полюса Луны или место посадки на Марсе) и шаблон задач миссии (посадка, выходы, мобильность, низкое Солнце, холод). Сервис меряет цель и ~3 000 квадратов Земли на одних и тех же базах критериев NASA, считает соответствие каждой задаче и находит наименьший набор площадок Земли (k = 1…3), который лучше всего покрывает задачи, — с реестром того, чего Земля дать не может. Метод проверяется пререгистрированно: места, которые NASA использовала для конкретных задач, должны оказаться высоко именно для этих задач.
- **Челлендж:** [Identify Earth Locations that Analog the Permanent Moon Base Locations and Mars](https://www.spaceappschallenge.org/2026/challenges/identify-earth-locations-that-analog-the-permanent-moon-base-locations-and-mars/), NASA Space Apps Challenge 2026.
- **Хакатон:** 14–15.11.2026, площадка Astana (Miras International School). Работа над проектом — с **14.11 09:00** по Астане. Питч и судейство — **15.11 14:00**. Глобальный дедлайн — 15.11 23:59 по Астане.
- **Команда:** 6 человек, роли MEMBER_A…MEMBER_F (§9). Время в документах — по Астане (UTC+5).
- **Главные документы:** решение — [FINAL_CONCEPT_DECISION](docs/innovation/FINAL_CONCEPT_DECISION.md); продукт — [COMPLETE_PRODUCT_SPEC](docs/product/COMPLETE_PRODUCT_SPEC.md); наука — [MATHEMATICAL_SPECIFICATION](docs/science/MATHEMATICAL_SPECIFICATION.md); инженерия — [FINAL_ARCHITECTURE](docs/engineering/FINAL_ARCHITECTURE.md); план — [HOUR_BY_HOUR_EXECUTION](docs/planning/HOUR_BY_HOUR_EXECUTION.md). План v1 — в архиве `docs/archive/v1/` (не использовать для работы).

## 1. Правило № 1: до старта хакатона над проектом не работаем

Официально: «Teams are not allowed to begin working on the challenges prior to the hackathon» ([FAQ 2026](https://www.spaceappschallenge.org/resources/participant-faqs/)). [Team Formation Guide 2026](https://www.spaceappschallenge.org/resources/team-formation-guide/) уточняет: работу над проектом не начинаем до 14.11.2026 9:00 по местному времени. Приватный репозиторий не даёт права нарушать сроки.

**Перед любой задачей проверь время:** `python3 tools/tasks.py next` — первая строка скажет, закрыты ли задачи HACK. Старт: `2026-11-14T04:00:00Z`.

У каждой задачи есть поле `authorization` ([PRE_EVENT_AUTHORIZATION](docs/competition/PRE_EVENT_AUTHORIZATION.md)):

| Категория | Что значит | Как проверяется |
| --- | --- | --- |
| `PERMITTED` | Можно сейчас: регистрация, аккаунты, учёба на посторонних данных, документы планирования | — |
| `CLARIFICATION_REQUIRED` | Только после письменного разрешения организаторов и только в его рамках (`scope`) | `tools/tasks.py` не даёт начать задачу без `authorization_evidence`; записать разрешение: `python3 tools/tasks.py authorize ID --source … --scope …` |
| `DEFER_UNTIL_EVENT` | Только с 14.11 09:00 (все задачи `phase: HACK`) | `tools/tasks.py` отказывает до старта |

| До 14.11 09:00 по Астане **можно** | До 14.11 09:00 по Астане **нельзя** |
| --- | --- |
| PREP- и RULE-задачи; AUTH-задачи — только с записанным разрешением | Любая задача с `"phase": "HACK"` |
| Учиться на посторонних примерах вне этого репозитория | Код решения: `pipeline/`, `web/`, `contracts/`, `data/` |
| Заводить аккаунты, ставить инструменты, проверять вход в сервисы | Скачивать и обрабатывать данные челленджа (если нет разрешения A2), считать атрибуты |
| Поддерживать документы планирования в `docs/`, `project/`, `tools/` | Макеты, дизайн, логотип, тексты для подачи, видео, слайды |

Если пользователь до старта просит выполнить HACK-задачу: вежливо откажи, процитируй правило, предложи его PREP-задачи (`python3 tools/tasks.py next MEMBER_X`). Не обходи правило через «черновик», «пример» или «вне репозитория для проекта».

## 2. Источники правды

| Что | Где | Правило |
| --- | --- | --- |
| Задачи, статусы, разрешения | [`project/tasks.json`](project/tasks.json) | Единственный источник. Менять только через `python3 tools/tasks.py set` и `authorize` |
| Правила конкурса | [OFFICIAL_RULES](docs/competition/OFFICIAL_RULES.md), [PRE_EVENT_AUTHORIZATION](docs/competition/PRE_EVENT_AUTHORIZATION.md) | Официальные источники важнее этого файла |
| Роль и задачи участника | `docs/team/MEMBER_X.md` | Разделы между `BEGIN/END GENERATED` создаются из tasks.json — не править руками |
| Почасовой план, критический путь, отставание | [HOUR_BY_HOUR_EXECUTION](docs/planning/HOUR_BY_HOUR_EXECUTION.md), [CRITICAL_PATH_AND_DEPENDENCIES](docs/planning/CRITICAL_PATH_AND_DEPENDENCIES.md), [CONTINGENCY_PLAN](docs/planning/CONTINGENCY_PLAN.md), [ULTRA_DETAILED_ROADMAP](docs/planning/ULTRA_DETAILED_ROADMAP.md) | Модель расписания: `python3 tools/tasks.py schedule S1` |
| Наука | [MATHEMATICAL_SPECIFICATION](docs/science/MATHEMATICAL_SPECIFICATION.md), [ALGORITHMS_AND_PSEUDOCODE](docs/science/ALGORITHMS_AND_PSEUDOCODE.md), [DATASET_SPECIFICATION](docs/science/DATASET_SPECIFICATION.md), [VALIDATION_PROTOCOL](docs/science/VALIDATION_PROTOCOL.md), [SCIENTIFIC_CLAIMS_REGISTER](docs/science/SCIENTIFIC_CLAIMS_REGISTER.md) | Формулы и параметры — только отсюда |
| Инженерия | [FINAL_ARCHITECTURE](docs/engineering/FINAL_ARCHITECTURE.md), [API_AND_SCHEMA_CONTRACTS](docs/engineering/API_AND_SCHEMA_CONTRACTS.md), [FUNCTION_SPECIFICATIONS](docs/engineering/FUNCTION_SPECIFICATIONS.md), [FILE_BY_FILE_BUILD_PLAN](docs/engineering/FILE_BY_FILE_BUILD_PLAN.md), [TESTING_STRATEGY](docs/engineering/TESTING_STRATEGY.md), [DEVELOPMENT_WORKFLOW](docs/engineering/DEVELOPMENT_WORKFLOW.md) | |
| Продукт и демо | [COMPLETE_PRODUCT_SPEC](docs/product/COMPLETE_PRODUCT_SPEC.md), [SCREEN_BY_SCREEN_SPEC](docs/product/SCREEN_BY_SCREEN_SPEC.md), [DESIGN_SYSTEM](docs/product/DESIGN_SYSTEM.md), [SIGNATURE_DEMO](docs/product/SIGNATURE_DEMO.md) | |
| Подача и судейство | [SUBMISSION](docs/competition/SUBMISSION.md), [JUDGING_READINESS](docs/competition/JUDGING_READINESS.md) | |
| Решения, журнал, блокеры, интеграция, риски | [DECISIONS](docs/planning/DECISIONS.md), [PROGRESS](docs/planning/PROGRESS.md), [BLOCKERS](docs/planning/BLOCKERS.md), [INTEGRATION_STATUS](docs/planning/INTEGRATION_STATUS.md), [RISK_REGISTER](docs/planning/RISK_REGISTER.md) | В PROGRESS каждый пишет только в свой раздел |
| Аудит плана | [EXISTING_PLAN_CRITICAL_REVIEW](docs/audit/EXISTING_PLAN_CRITICAL_REVIEW.md), [RED_TEAM_REVIEW](docs/audit/RED_TEAM_REVIEW.md), [TRACEABILITY_AND_COMPLETENESS](docs/audit/TRACEABILITY_AND_COMPLETENESS.md) | |

При противоречии: официальные правила NASA → этот файл → `project/tasks.json` → остальные документы. Нашёл противоречие — исправь или запиши в BLOCKERS.md.

## 3. Как понимать просьбы

| Пользователь говорит | Что делать |
| --- | --- |
| «Выполни задачи MEMBER_B», «Execute MEMBER_B tasks», `/execute-member MEMBER_B` | Протокол §4 для этого участника, пока есть доступные задачи в рамках просьбы |
| «Продолжи MEMBER_D с последней точки», «Continue MEMBER_D» | Протокол продолжения §8 |
| «Покажи заблокированные задачи», `/blocked` | `python3 tools/tasks.py blocked` + BLOCKERS.md; кратко: что, кто блокирует, что сделать |
| «Следующая задача», `/next-task [MEMBER_X]` | `python3 tools/tasks.py next [MEMBER_X]`, взять верхнюю из «МОЖНО НАЧАТЬ», выполнить по §4 |
| «Проверка интеграции», `/integration-check` | Чек-лист INTEGRATION_STATUS.md для текущей точки: `make check`, контракты, сквозной прогон, отчёт |
| «Готовность к подаче», `/submission-readiness` | Отчёт по воротам G1–G10 из JUDGING_READINESS §5 с доказательствами и пробелами |
| «Статус», `/project-status` | `python3 tools/tasks.py status` + модель `schedule` + главное из PROGRESS и BLOCKERS |

Если участник не назвал свой ID — спроси, какой он MEMBER. Соответствие людей и ID хранится вне репозитория (DEC-004).

## 4. Протокол выполнения задач участника

1. Прочитай этот файл, затем `docs/team/MEMBER_X.md` целиком.
2. Запусти `python3 tools/tasks.py next MEMBER_X` — время, доступные задачи, ожидание, задачи, ждущие разрешения.
3. Если HACK-задачи закрыты по времени — работай только с PREP/RULE (§1). Задачи «ЖДЁТ РАЗРЕШЕНИЯ» не начинай.
4. Посмотри окно задачи в [HOUR_BY_HOUR_EXECUTION](docs/planning/HOUR_BY_HOUR_EXECUTION.md) и передачи в [CRITICAL_PATH_AND_DEPENDENCIES §6](docs/planning/CRITICAL_PATH_AND_DEPENDENCIES.md).
5. Возьми верхнюю задачу из «В РАБОТЕ», иначе из «МОЖНО НАЧАТЬ». Прочитай карточку: `python3 tools/tasks.py show ID` — цель, шаги, файлы, интерфейсы, данные, критерии, тесты, типовые сбои, запасной путь.
6. Проверь зависимости: все в DONE? Если нет — §6. Окно с пометкой «черновик» разрешает начать черновик заранее, но DONE ставим только после зависимостей.
7. Переведи задачу в работу: `python3 tools/tasks.py set ID IN_PROGRESS`. Создай ветку `x/ID-кратко` (§13).
8. Прочитай существующий код и контракты, которых касаешься. Меняй только файлы из `files_create` и `files_modify` карточки; владельца проверь: `python3 tools/tasks.py owner PATH`. Чужие файлы не правь — попроси владельца или MEMBER_A.
9. Реализуй задачу по шагам карточки, критериям приёмки и подсказкам в `docs/team/MEMBER_X.md`. Не меньше и не больше.
10. Запусти `automated_tests` и `verification_commands`, выполни `manual_verification`. Результаты не выдумывай: что не запускалось — так и пиши.
11. Проверь научную и функциональную корректность (§11): единицы, источники, нет ли синтетики под видом данных NASA.
12. Проверь совместимость с контрактами: `python -m pipeline.contracts.validate <файлы>` (после INFRA-02).
13. Обнови документы, которые меняет задача, и добавь строку в [журнал ИИ](docs/ai-log.md) о заметной помощи ИИ.
14. Запиши доказательства по полю `completion_evidence`: `python3 tools/tasks.py set ID DONE --evidence "команда → результат"` (или IN_REVIEW, если нужен ревьюер). Добавь запись в свой раздел PROGRESS.md.
15. Закоммить по §13, открой PR по шаблону. Сообщи в канал модуля, кого разблокировала задача (исходящие — в MEMBER_X.md).
16. Переходи к следующей доступной задаче этого участника, пока это входит в просьбу. В конце — короткий отчёт: сделано, проверено, осталось, блокеры, следующие задачи.

## 5. Никогда

- Не начинай HACK-задачи до 14.11 09:00 по Астане и CLARIFICATION_REQUIRED-задачи без записанного разрешения; не помогай обойти эти правила.
- Не пропускай критерии приёмки молча и не ставь DONE без доказательств.
- Не выдумывай результаты тестов, числа, ссылки, цитаты и научные источники.
- Не утверждай, что функция работает, если её нет или она не проверена.
- Не подменяй реальные данные NASA синтетикой без пометки. Фикстуры: `synthetic: true`, id с `FAKE_`, плашка в интерфейсе. В `data/processed/` фикстуры не попадают.
- Не меняй параметры и пары проверки после первого запуска VAL-01 (пререгистрация, DEC-010).
- Не меняй общие контракты (`contracts/`, `web/src/types/contracts.ts`) без протокола изменения (DEVELOPMENT_WORKFLOW §7).
- Не правь чужие модули и не переписывай репозиторий целиком. Не удаляй работающий код без причины в PR.
- Не коммить секреты (`.env`, ключи, токены, JSON сервисных аккаунтов) и большие файлы (GeoTIFF, архивы, видео).
- Не добавляй имена, фото, голоса и узнаваемые черты участников младше 18 лет ни в код, ни в документы, ни в демо.
- Не используй логотипы и символику NASA, в том числе в ИИ-картинках.
- Не вызывай генеративный ИИ внутри продукта для научных чисел или объяснений: объяснения строятся по шаблонам из данных.
- Не делай изменений в удалённом репозитории (push, PR, публикация) без просьбы пользователя.

## 6. Если задача заблокирована

1. `python3 tools/tasks.py set ID BLOCKED --blocker <ID или причина> --blocker-owner MEMBER_Y`.
2. Строка в [BLOCKERS.md](docs/planning/BLOCKERS.md): что именно нужно, от кого, с какого времени, что уже пробовали.
3. Сообщение владельцу блокера в #blockers.
4. Посмотри «последний допустимый срок» и запасной путь в CRITICAL_PATH_AND_DEPENDENCIES §6 и в поле `fallback` карточки. Возьми другую доступную задачу этого участника; фикстуры (INFRA-03) часто позволяют продолжить без реальных данных.
5. Не придумывай недостающие научные допущения и контракты сам: спроси MEMBER_E (наука) или MEMBER_A (контракты).

## 7. Отчётность между сессиями

Состояние проекта восстанавливается из репозитория:

- статусы, доказательства и разрешения — `project/tasks.json` (через `tools/tasks.py set` и `authorize`);
- что сделано и что дальше — свой раздел в [PROGRESS.md](docs/planning/PROGRESS.md) (дата, задачи, проверки, доказательства, следующий шаг);
- блокеры — BLOCKERS.md; решения — DECISIONS.md; интеграция — INTEGRATION_STATUS.md;
- история — `git log`. Коммиты маленькие, с ID задачи.

После правки `project/tasks.json` вне команд `set`/`authorize` или изменения плана: `python3 tools/tasks.py render && python3 tools/tasks.py validate`.

## 8. Продолжение прерванной работы и параллельные агенты

Сессия может оборваться (лимит, закрытый ноутбук), а над репозиторием одновременно работают до шести агентов. Поэтому:

1. **Сначала состояние, потом работа.** `git status`, `git log --oneline -10`, `git branch --show-current`, `python3 tools/tasks.py next MEMBER_X`, свой раздел PROGRESS.md. Задача в IN_PROGRESS — продолжай её, а не начинай заново.
2. **Незакоммиченные изменения** в рабочей копии принадлежат прерванной сессии: сначала прочитай `git diff`, реши — доделать или откатить свои же правки; чужие файлы не трогай.
3. **Ничего не переписывай с нуля**, если файл уже есть: прочитай и продолжи. Сгенерированные разделы документов — `python3 tools/tasks.py render`.
4. **Свои файлы — только свои.** Перед правкой: `python3 tools/tasks.py owner PATH`. `tools/tasks.py validate` запрещает задаче менять файл, созданный другой задачей, если между ними нет зависимости.
5. **Перед коммитом** — `git pull --rebase origin <ветка>` (или merge main), `make check` (после INFRA-01); при конфликте в чужом файле — зови владельца.
6. **Статус обновляй сразу** (`set ID IN_PROGRESS` в начале, `DONE --evidence` в конце): так другие агенты видят, что задача занята.
7. **Заместитель** продолжает работу отсутствующего участника тем же протоколом (CONTINGENCY_PLAN §7) и пишет в PROGRESS.md в раздел того участника с пометкой «вместо MEMBER_X».

## 9. Команда и владение

| ID | Роль | Владеет | Канал |
| --- | --- | --- | --- |
| MEMBER_A | Тех-лид: контракты, каркас и карта сайта, деплой, интеграция, публикация и подача | `contracts/`, `pipeline/contracts/`, `web/` (кроме отмеченного ниже), `data/fixtures/` (кроме golden), корневые конфиги, `tools/`, `.claude/`, `CLAUDE.md` | #web |
| MEMBER_B | Земля (Earth Engine), страница Evidence, источники | `pipeline/earth/`, `data/processed/earth_candidates.json`, `web/src/pages/EvidencePage.tsx`, `web/src/components/evidence/`, `submission/references.md` | #earth |
| MEMBER_C | Луна, Марс, освещение; панели кампании; README для жюри | `pipeline/planets/`, `pipeline/lighting/`, `pipeline/common/{sun,shadows,render}.py`, `data/processed/{targets,sun_windows,shadows}.json`, `web/src/components/campaign/`, `web/public/img/twin/` | #planets |
| MEMBER_D | Движок и проверки; панель площадки | `pipeline/common/terrain.py`, `pipeline/engine/`, `data/processed/{results,validation,mission_templates,robustness}.json`, `data/fixtures/golden_*.json`, `web/src/components/{site,matrix}/`, `web/src/lib/`, `web/src/workers/` | #engine |
| MEMBER_E | Геолог, научный руководитель | `data/curated/`, `submission/claims.md`, `submission/qa.md` | #science |
| MEMBER_F | Продукт и питч | `submission/` (кроме файлов B и E), `web/src/content/copy.json` | #pitch |

Точная карта — раздел `ownership` в `project/tasks.json`. Узнать владельца: `python3 tools/tasks.py owner PATH`. Документы в `docs/` общие, но план меняет MEMBER_A после обсуждения.

## 10. Архитектура и команды

Офлайн-конвейер на Python считает всё заранее → маленькие JSON по контрактам → статический сайт (Vite + React + TypeScript + MapLibre). Сервера нет, демо не падает. Схема — [FINAL_ARCHITECTURE](docs/engineering/FINAL_ARCHITECTURE.md).

```text
data/curated (E) ──────────────────────────────────────────────┐
GEE: Copernicus, MODIS, IMERG, WorldCover → pipeline/earth (B) → earth_candidates.json ─┐
PGDA (Луна), MOLA/HRSC (Марс) → pipeline/planets (C) → targets.json ────────────────────┼→ pipeline/engine (D) → results.json, validation.json → web/ (A, B, C, D)
NOAA-алгоритм Солнца → pipeline/lighting (C) → sun_windows.json (по широтам) ──────────┘
```

Команды появятся после INFRA-01 (до этого есть только `python3 tools/tasks.py …`):

| Команда | Что делает |
| --- | --- |
| `make check` | tasks validate, ruff, pytest, контракты, typecheck, vitest, build |
| `make fixtures` | синтетические данные по контракту |
| `make data` | конвейер без GEE: цели, окна, движок, проверки |
| `make earth` | конвейер Земли (нужна авторизация GEE) |
| `make web` / `make offline` | сайт локально / офлайн-сборка `dist.zip` |
| `python -m pipeline.contracts.validate FILE…` | проверка JSON по контракту |

## 11. Научные стандарты

- **Одна функция рельефа на базах NASA:** `terrain_attributes()` для Земли, Луны и Марса; базы 100 м и 2 км (Луна), 400 м и 2 км (Марс); локальные проекции с радиусом тела, квадратный пиксель. Свои формулы уклона запрещены.
- **Каждое число прослеживается:** данные (ID набора и версия в `provenance`) или курируемый источник (ключ в `data/curated/sources.csv`). Числа от ИИ без проверки по первоисточнику не используем.
- **Единицы в названии поля:** `_deg`, `_m`, `_c`, `_mm`, `_frac`.
- **Пропуски — `null`** и перечисление в `missing`; никогда не 0.
- **Пререгистрация:** параметры §12 спецификации, правила исключения и `practice_sites.csv` фиксируются коммитом до первого запуска VAL-01 и потом не меняются под результат.
- **Честность:** отрицательные результаты проверки и неустранимые разрывы (вакуум, гравитация, радиация, холод вечной тени) показываем. Соответствие — сходство условий для задачи, а не пригодность площадки.
- **Реестр утверждений:** любое научное утверждение для жюри попадает в `submission/claims.md` и подписывается MEMBER_E.

## 12. Код

- Python 3.11+, модули маленькие и чистые, type hints, docstring с формулой и ссылкой на спецификацию; `ruff`; тесты рядом с модулем в `tests/`.
- TypeScript в строгом режиме; компоненты в своих папках; состояние в одном store; числа только из данных.
- Код, комментарии, коммиты, README для жюри — на английском. Документы команды — на русском.
- В начале файла, написанного с заметной помощью ИИ: `# Written with AI assistance (Claude Code); reviewed by MEMBER_X.` (или `//` в TS) — правило NASA о раскрытии ИИ.
- Без новых тяжёлых зависимостей и сервисов без решения в DECISIONS.md.

## 13. Git

- Ветка: `<буква участника>/<ID>-кратко`, например `b/EARTH-02-terrain`. В `main` напрямую не пушим, force push запрещён.
- Коммит: `EARTH-02: add stage A terrain attributes` + трейлер `Co-Authored-By`, если помогал ИИ.
- PR маленький, по шаблону `.github/pull_request_template.md`, с доказательствами проверки. Сливает MEMBER_A (или MEMBER_D, если A занят).
- Перед PR: `git pull --rebase origin main` (или merge main) и `make check`.
- Конфликты в чужих файлах не разрешаем сами — зовём владельца.

## 14. Подача и правила NASA

- Демо: ≤ 7 слайдов на английском (наше официальное демо, P0) или видео ≤ 30 с с английскими субтитрами (P1). Больше — без глобального судейства.
- Нужны данные или ресурсы NASA (для глобальных наград); данные агентств-партнёров — плюс.
- ИИ разрешён с раскрытием: ИИ-картинки и видео — с видимой пометкой «AI-generated», код и данные — пометка в тексте и метаданных, никакой символики NASA.
- Все ссылки открываются без входа. Репозиторий публичный к подаче, с OSI-лицензией (MIT).
- Цитируем каждый источник: данные, код, картинки, инструменты (`submission/references.md`).
- В README и на странице проекта — раскрытие подготовки до старта (PRE_EVENT_AUTHORIZATION §3).
- Участники младше 18 лет: никаких имён, лиц, голосов и узнаваемых черт в подаче, видео, слайдах, README и коммитах.
- Без рекламы коммерческих продуктов.

## 15. Общие контракты

`contracts/*.schema.json` и `web/src/types/contracts.ts` — интерфейсы между участниками. Замораживаются в v1 на старте (INFRA-02, Сб 11:00). Изменения — только по протоколу DEVELOPMENT_WORKFLOW §7: предложение в #general → согласие потребителей → MEMBER_A меняет схему и версию → потребители обновляются → запись в INTEGRATION_STATUS.md.
