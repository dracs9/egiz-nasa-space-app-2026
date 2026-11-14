# MEMBER_A — тех-лид: контракты, каркас сайта, карта, интеграция, деплой, подача

> **Как начать:** откройте репозиторий в Claude Code и скажите «Выполни задачи MEMBER_A» (или `/execute-member MEMBER_A`). Claude сначала прочитает [CLAUDE.md](../../CLAUDE.md). До 14.11 09:00 по Астане доступны только задачи PREP и RULE.

## 1. Что и зачем

**Что.** Вы превращаете работу шести человек в одну систему: к 11:00 субботы — каркас, контракты v1 и фикстуры, чтобы все работали параллельно; дальше — каркас сайта, экран Brief, карта Земли, деплой, три точки интеграции, публикация репозитория и нажатие Submit.

**Зачем.** Модель расписания показывает, что узкое место плана — ваша последовательная нагрузка: 12 задач P0 на 8,75 ч ([CRITICAL_PATH_AND_DEPENDENCIES §1](../planning/CRITICAL_PATH_AND_DEPENDENCIES.md)). Поэтому: вы не берёте ничего сверх реестра; ревью чужих PR делает ваш заместитель MEMBER_D; решения на воротах G-A, G-B, G-F, G-H, G-J ([CONTINGENCY_PLAN §2](../planning/CONTINGENCY_PLAN.md)) принимаете за 5 минут и записываете в DECISIONS.md.

**Отвечаю за:** контракты и их версии, зелёный `main`, прод-ссылку и офлайн-сборку, INTEGRATION_STATUS, DECISIONS, публикацию (SUB-05) и подачу (SUB-06, вместе с F).

## 2. Первые действия

**Сегодня (до 14.11):**

- [ ] PREP-03: пригласить участников, правило защиты `main`, у всех `git user.name` = ник и noreply-почта; таблица ников — docs/team/README.md §2.
- [ ] PREP-04: Vercel; запасной некоммерческий проект Earth Engine; доступ к Vercel для C и D.
- [ ] PREP-12: окружение 6/6, у всех `python3 tools/tasks.py validate` даёт OK.
- [ ] PREP-08: учебная карта MapLibre + GIBS + Web Worker в **отдельном** репозитории; замер перекраски 3 000 точек.
- [ ] Прочитать: [FINAL_ARCHITECTURE](../engineering/FINAL_ARCHITECTURE.md), [API_AND_SCHEMA_CONTRACTS](../engineering/API_AND_SCHEMA_CONTRACTS.md), [SCREEN_BY_SCREEN_SPEC](../product/SCREEN_BY_SCREEN_SPEC.md), [DESIGN_SYSTEM](../product/DESIGN_SYSTEM.md), [HOUR_BY_HOUR_EXECUTION](../planning/HOUR_BY_HOUR_EXECUTION.md).
- [ ] 28.10 — RULE-01 вместе с E и F; 13.11 — RULE-04 (IC-0). Если до 13.11 пришёл ответ на вопросы 4–5 (PREP-01) — записать сценарий в DEC-024.

**Суббота 09:00:**

- [ ] `git pull && python3 tools/tasks.py next MEMBER_A`.
- [ ] KICK-01 по повестке §6; коммит пререгистрации **до любого расчёта**; хэш — в DEC-010.
- [ ] INFRA-01 → INFRA-02 → INFRA-03 без пауз; в 11:00 сообщение «Contracts v1 frozen @ <hash>».

## 3. Мой день (S1)

| Время | Задача |
| --- | --- |
| Сб 09:00–09:30 | KICK-01 (ведёте) |
| 09:30–11:30 | INFRA-01 каркас → INFRA-02 контракты (заморозка 11:00) → INFRA-03 фикстуры |
| 11:30–14:00 (обед 12–13) | WEB-01 каркас сайта |
| 14:00–15:30 | WEB-02 Brief → WEB-03 карта |
| 15:30–16:45 | INFRA-05 деплой → INFRA-04 CI (P1) |
| 16:45–17:30 | Слияние PR по порядку контракты → данные → движок → сайт; подготовка IC-1 |
| 17:30–18:00 | IC-1 (INFRA-06) |
| Вс 09:00–11:00 | Сборка main, IC-2 в 09:30; WEB-11 (P1) или исправления по QA-02 |
| 11:00–12:15 | IC-3: заморозка функций и снимок данных; QA-03 офлайн-комплект; SUB-05 публикация |
| 12:15–13:30 | STORY-04 репетиция; 13:00 тег v1.0; SUB-06 подача вместе с F |

## 4. Мои файлы

`contracts/`, `pipeline/__init__.py`, `pipeline/common/__init__.py`, `pipeline/contracts/`, `data/fixtures/` (кроме `golden_*.json` — MEMBER_D), `web/` (кроме `src/components/campaign/` — C, `src/components/site/`, `src/components/matrix/`, `src/lib/`, `src/workers/` — D, `src/pages/EvidencePage.tsx` и `src/components/evidence/` — B, `src/content/copy.json` — F, `public/img/twin/` — C), `Makefile`, `pyproject.toml`, `requirements.txt`, `vercel.json`, `LICENSE`, `.gitignore`, `.github/`, `.claude/`, `tools/`, `prompts/`, `CLAUDE.md`, `README.md` (вместе с MEMBER_C на SUB-01). Проверка: `python3 tools/tasks.py owner PATH`.

## 5. Интерфейсы, которые я реализую

**Контракты v1** — JSON Schema Draft 2020-12 для `egiz.earth_candidates`, `egiz.targets`, `egiz.mission_templates`, `egiz.sun_windows`, `egiz.results`, `egiz.validation` (P1: `egiz.shadows`, `egiz.robustness`) по [API_AND_SCHEMA_CONTRACTS §2](../engineering/API_AND_SCHEMA_CONTRACTS.md). Валидатор выбирает схему по полю `schema`, проверяет major-версию и запрет синтетики в `data/processed/`:

```text
$ python -m pipeline.contracts.validate data/processed/results.json
OK  data/processed/results.json  (egiz.results 1.0.0)
$ python -m pipeline.contracts.validate data/processed/targets.json
FAIL data/processed/targets.json: $.targets[0].lat: 95 is greater than the maximum of 90   # код выхода 1
```

**Типы** `web/src/types/contracts.ts` — один в один со схемами. **Store** `web/src/state/store.ts` — интерфейс `AppState` из [API_AND_SCHEMA_CONTRACTS §3](../engineering/API_AND_SCHEMA_CONTRACTS.md); компоненты C, D и B читают данные только через него:

```ts
const run = useApp(s => s.data.results.runs.find(r => r.target === s.targetId && r.template === s.templateId));
const select = useApp(s => s.selectSite);   // смена цели сбрасывает selectedSite (тест Vitest)
```

**Загрузчик** `web/src/data/load.ts` — `DataLoadError{kind: "network" | "schema" | "version", file, …}` (§4 контрактов); плашка «SYNTHETIC DEMO DATA — not NASA observations», если хоть один файл `synthetic: true`. **Карта** `web/src/components/map/` — читает из store кандидатов, `fidelity[focusObjective]` и площадки кампании, пишет `selectSite`; переключатель Map/Table; без подложки — однотонный фон.

## 6. Что мне нужно от других и кто ждёт меня

| Направление | Что | Когда (план / последний срок) | Если нет |
| --- | --- | --- | --- |
| От D | Ревью моих PR (5 минут) | По запросу | Сливаю сам после `make check` |
| От B | `earth_candidates.json` | Сб 15:15 / 16:00 | Сайт на фикстурах до IC-1 |
| От C | `targets.json`, `sun_windows.json`; панели кампании (WEB-04) | Сб 15:00 / 16:30 | Карточки целей из фикстур |
| От D | `results.json`; панель площадки (WEB-05) | Сб 16:00 / Вс 10:00 | IC-1 на одной цели; S3 без панели |
| От B | Страница Evidence (WEB-06) | Вс 09:45 | Ссылка на `validation.json` из README |
| От F | Тексты интерфейса `copy.json` (P1) | Сб 16:30 | Тексты по SCREEN_BY_SCREEN_SPEC |
| Ждут меня все | Каркас, контракты, фикстуры | Сб 11:30 | Примеры из `contracts/examples/` |
| Ждут C, D, B | Каркас сайта WEB-01 | Сб 14:00 | Работают на компонентах вне маршрутов |

## 7. Как делать: подсказки

**KICK-01 (Сб 09:00, 20 минут).** (1) 2 минуты — правила: без имён и лиц несовершеннолетних, заморозки 11:00 и 13:00. (2) 5 минут — DEC-019…DEC-024 и DEC-007, DEC-009…DEC-011, DEC-014, DEC-015 перевести в ACCEPTED (или изменить с причиной), вписать время. (3) 5 минут — пререгистрация: [VALIDATION_PROTOCOL §0](../science/VALIDATION_PROTOCOL.md) и параметры [MATHEMATICAL_SPECIFICATION §12](../science/MATHEMATICAL_SPECIFICATION.md) — коммит `KICK-01: preregister validation plan`, хэш в DEC-010. (4) MEMBER_F — слушатель брифинга. (5) Каждый называет две первые задачи.

**INFRA-01.** Команды (версии — последние стабильные на день старта):

```bash
npm create vite@latest web -- --template react-ts
npm --prefix web install maplibre-gl zustand
npm --prefix web install -D vitest
```

`requirements.txt` — по [FILE_BY_FILE_BUILD_PLAN §1](../engineering/FILE_BY_FILE_BUILD_PLAN.md); цели Makefile: `check`, `test`, `fixtures`, `earth`, `data`, `web`, `offline`. Папки `pipeline/earth|planets|lighting|engine` создают их владельцы, не вы.

**INFRA-02.** Верхний уровень строгий (`additionalProperties: false`), атрибуты — перечисленные ключи со значениями `number | null`, `context` допускает новые поля. Спорное поле делайте необязательным, а не спорьте.

**INFRA-03.** `python -m pipeline.contracts.fixtures`, seed 42: ~500 кандидатов по всему миру (все четыре страты и несколько `FAKE_PR_`), 2 цели (`FAKE_MOON_A`, `FAKE_MARS_A`), шаблоны со стартовыми весами §7.3 спецификации, `results` и `validation` в правильной форме. Везде `synthetic: true` и префикс `FAKE_`.

**WEB-01 / WEB-02 / WEB-03.** Маршруты `#/brief`, `#/campaign?target=…&k=…&obj=…` (панель площадки S3 — выдвижная внутри Campaign, выбранная площадка в адресе как `site=`), `#/evidence` (P1: `#/twin`, `#/matrix`) — без библиотеки. Токены — из DESIGN_SYSTEM (`--bg #0B1017` и др.), шрифты Inter и IBM Plex Mono локально (OFL). Карта: подложка NASA GIBS (URL шаблона — по [документации GIBS](https://nasa-gibs.github.io/gibs-api-docs/), проверить в браузере), атрибуция «NASA GIBS»; точки кандидатов перекрашиваются через `feature-state` по шкале cividis; бюджет перекраски ≤ 200 мс.

**INFRA-05.** `vercel.json`: сборка `npm --prefix web ci && npm --prefix web run build`, каталог `web/dist`. `web/scripts/copy-data.mjs` (prebuild) копирует `data/processed/*.json` в `web/public/data/`, при их отсутствии — фикстуры (плашка покажется). `make offline` → `dist.zip`.

**INFRA-06.** На каждой точке: слить готовые PR в порядке контракты → данные → движок → сайт, `make check`, сценарий из INTEGRATION_STATUS §2 на прод-ссылке, запись результата и того, что не вошло. На IC-3 — `sha256sum data/processed/*` в INTEGRATION_STATUS; в 13:00 — тег `v1.0`.

**SUB-05.** (1) Список имён команды — в файле **вне** репозитория: `grep -rniF -f <файл> . --exclude-dir=.git --exclude-dir=node_modules`; (2) `git log --format='%an <%ae>' | sort -u` — только ники и noreply, иначе вариант из DEC-004; (3) поиск секретов; (4) Settings → Public; (5) все ссылки — в инкогнито.

**SUB-06.** Чек-лист [SUBMISSION §5](../competition/SUBMISSION.md) вместе с F (числа на странице = `submission/claims.md`), Submit for Judging, скриншот подтверждения — вне репозитория.

## 8. Готово, если

- `make check` зелёный на `main`; прод-ссылка открывается в инкогнито без ошибок в консоли (Chrome, Firefox, Safari, телефон).
- Записи IC-1, IC-2, IC-3 в INTEGRATION_STATUS с временем; хэши данных; тег `v1.0`.
- Репозиторий публичный, без имён и секретов; подтверждение Submit получено.

## 9. Задачи

<!-- BEGIN GENERATED:member-tasks:MEMBER_A -->
Задач: 25. До хакатона (PREP): 11,5 ч. На хакатоне P0+P1: 12,75 ч (P0 8,75 ч, P1 4 ч). Статусы смотрите командой `python3 tools/tasks.py next MEMBER_A`.

Порядок — по времени (сначала подготовка, затем хакатон; P2–P3 в конце).

| ID | Задача | P | Разрешение | Веха | Окно (Астана) | Ч | Зависит от | Флаги |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PREP-03 | GitHub, Discord, защита main, ники в git | P0 | PERMITTED | M0 | до 20.10 | 1 | — | — |
| PREP-04 | Аккаунты: Earthdata, Earth Engine, Vercel | P0 | PERMITTED | M0 | до 27.10 | 1 | — | — |
| RULE-01 | 28.10: разбор полного условия, обновление трассировки | P0 | PERMITTED | M0 | 28–29.10 | 1,5 | — | — |
| PREP-12 | Окружение на шести ноутбуках | P0 | PERMITTED | M0 | до 08.11 | 1,5 | — | — |
| PREP-08 | Тренировка: Vite + React + TS + MapLibre + Web Worker в учебном репозитории | P1 | PERMITTED | M0 | до 08.11 | 3 | PREP-04 | — |
| RULE-04 | 13.11 вечер: готовность к старту (IC-0) | P0 | PERMITTED | M0 | 13.11 вечер | 0,5 | RULE-01, RULE-03, PREP-02, PREP-04, PREP-12 | — |
| PREP-11 | Тренировка команды: Git и Claude Code | P2 | PERMITTED | M0 | до 08.11 | 1,5 | PREP-03 | OPTIONAL |
| AUTH-02 | Общий шаблон веб-приложения в отдельном репозитории (только с разрешением A3) | P2 | CLARIFICATION_REQUIRED | M0 | после ответа A3 | 1,5 | PREP-01, PREP-08 | OPTIONAL |
| KICK-01 | Старт 09:00: решения и пререгистрация | P0 | DEFER_UNTIL_EVENT | M1 | Сб 09:00–09:30 | 0,5 | RULE-04 | CRITICAL_PATH |
| INFRA-01 | Каркас репозитория | P0 | DEFER_UNTIL_EVENT | M2 | Сб 09:30–10:15 | 0,75 | KICK-01 | CRITICAL_PATH |
| INFRA-02 | Контракты v1: схемы, валидатор, типы | P0 | DEFER_UNTIL_EVENT | M2 | Сб 10:15–11:00 | 0,75 | INFRA-01 | CRITICAL_PATH |
| INFRA-03 | Синтетические фикстуры | P0 | DEFER_UNTIL_EVENT | M2 | Сб 11:00–11:30 | 0,5 | INFRA-02 | CRITICAL_PATH, PARALLELIZABLE |
| WEB-01 | Каркас приложения: маршруты, загрузка, store, токены | P0 | DEFER_UNTIL_EVENT | M4 | Сб 11:30–12:00 и 13:00–14:00 | 1,5 | INFRA-03 | CRITICAL_PATH |
| WEB-02 | Экран Mission Brief | P0 | DEFER_UNTIL_EVENT | M4 | Сб 14:00–14:30 | 0,5 | WEB-01 | — |
| WEB-03 | Карта Земли | P0 | DEFER_UNTIL_EVENT | M4 | Сб 14:30–15:30 | 1 | WEB-01 | — |
| INFRA-05 | Деплой и офлайн-сборка | P0 | DEFER_UNTIL_EVENT | M8 | Сб 15:30–16:15 | 0,75 | WEB-01 | — |
| INFRA-04 | CI в GitHub Actions | P1 | DEFER_UNTIL_EVENT | M9 | Сб 16:15–16:45 | 0,5 | INFRA-01 | — |
| INFRA-06 | Точки интеграции IC-1, IC-2, IC-3, снимок данных и релиз | P0 | DEFER_UNTIL_EVENT | M8 | Сб 17:30 · Вс 09:30 · Вс 11:00 · Вс 13:00 | 1 | INFRA-05, ENG-03 | — |
| WEB-10 | Переключатель «Казахстан» | P1 | DEFER_UNTIL_EVENT | M6 | S2: Сб 21:30–22:00 | 0,5 | EARTH-07, WEB-03 | — |
| WEB-07 | Экран «То же Солнце» | P1 | DEFER_UNTIL_EVENT | M6 | S2: Вс 08:00–10:00 (если LIGHT-04 готов) | 2 | WEB-03, LIGHT-04 | — |
| WEB-11 | Адаптивность, доступность, скорость | P1 | DEFER_UNTIL_EVENT | M7 | Вс 10:00–11:00 | 1 | WEB-04 | — |
| QA-03 | Офлайн-комплект для питча | P0 | DEFER_UNTIL_EVENT | M9 | Вс 11:15–11:45 | 0,5 | WEB-04, INFRA-05 | — |
| SUB-05 | Приватность и публикация репозитория | P0 | DEFER_UNTIL_EVENT | M11 | Вс 11:45–12:15 | 0,5 | SUB-01 | — |
| SUB-06 | Финальная подача | P0 | DEFER_UNTIL_EVENT | M11 | Вс 13:00–13:30 или до 21:00 (по ответу PREP-01) | 0,5 | SUB-07, SUB-03, SUB-04, SUB-05, STORY-06, SCI-09, INFRA-06 | CRITICAL_PATH |
| WEB-12 | 3D-рельеф (необязательно) | P3 | DEFER_UNTIL_EVENT | M6 | — | 2 | WEB-07 | OPTIONAL |

**Помогаю другим (соисполнитель):** PREP-02 (MEMBER_F, Регистрация команды и сопровождение несовершеннолетних), RULE-03 (MEMBER_F, 13.11: гайды подачи и судейства 2026), SUB-03 (MEMBER_B, Реестр источников и лицензий), WEB-09 (MEMBER_D, Живой пересчёт в интерфейсе), SUB-04 (MEMBER_C, Раскрытие использования ИИ), STORY-04 (MEMBER_F, Репетиция питча), STORY-05 (MEMBER_F, Видео 30 секунд)

**Входящие зависимости — что я жду от других:**

- RULE-04 ждёт **RULE-03** от MEMBER_F — 13.11: гайды подачи и судейства 2026
- RULE-04 ждёт **PREP-02** от MEMBER_F — Регистрация команды и сопровождение несовершеннолетних
- AUTH-02 ждёт **PREP-01** от MEMBER_F — Вопросы организаторам, включая разрешения A1–A3
- INFRA-06 ждёт **ENG-03** от MEMBER_D — run.py: results.json
- WEB-10 ждёт **EARTH-07** от MEMBER_B — Режим «Казахстан»: квадраты KZ_
- WEB-07 ждёт **LIGHT-04** от MEMBER_C — Картинки «То же Солнце»
- WEB-11 ждёт **WEB-04** от MEMBER_C — Панели кампании: задачи, фронт, карточка, разрывы
- QA-03 ждёт **WEB-04** от MEMBER_C — Панели кампании: задачи, фронт, карточка, разрывы
- SUB-05 ждёт **SUB-01** от MEMBER_C — README для жюри
- SUB-06 ждёт **SUB-07** от MEMBER_F — Страница проекта: числа и перенос на сайт
- SUB-06 ждёт **SUB-03** от MEMBER_B — Реестр источников и лицензий
- SUB-06 ждёт **SUB-04** от MEMBER_C — Раскрытие использования ИИ
- SUB-06 ждёт **STORY-06** от MEMBER_F — Слайды: числа и экспорт
- SUB-06 ждёт **SCI-09** от MEMBER_E — Подпись реестра утверждений

**Исходящие — кто ждёт мои результаты:**

- **INFRA-02** → EARTH-04 (MEMBER_B), ENG-03 (MEMBER_D), PLNT-03 (MEMBER_C), LIGHT-02 (MEMBER_C)
- **KICK-01** → EARTH-01 (MEMBER_B), TERR-01 (MEMBER_D), ENG-01 (MEMBER_D), PLNT-01 (MEMBER_C), LIGHT-01 (MEMBER_C), SCI-01 (MEMBER_E), SCI-03 (MEMBER_E), SCI-02 (MEMBER_E), STORY-01 (MEMBER_F)
- **PREP-04** → PREP-05 (MEMBER_B)
- **RULE-01** → RULE-02 (MEMBER_F)
- **WEB-01** → SUB-03 (MEMBER_B), WEB-06 (MEMBER_B), WEB-05 (MEMBER_D), ENG-05 (MEMBER_D), WEB-04 (MEMBER_C), STORY-02 (MEMBER_F)

#### Карточки задач

##### PREP-03 · GitHub, Discord, защита main, ники в git

P0 · PREP · M0 · разрешение: PERMITTED (можно сейчас) · окно: до 20.10 · оценка 1 ч

**Цель.** Доступ всем, защита main, у всех git user.name — ник и noreply-почта, каналы Discord.

**Зачем.** Безопасная параллельная работа и приватность несовершеннолетних в истории git.

**Шаги:**

1. Пригласить участников в репозиторий
2. Settings → Branches: правило для main (только PR, без force push)
3. Каждому выполнить `git config --global user.name <ник>` и `user.email <id>+<ник>@users.noreply.github.com`
4. Создать каналы Discord: #general, #blockers, #web, #earth, #planets, #engine, #science, #pitch
5. Таблицу «MEMBER → ник» заполнить в docs/team/README.md §2 (только ники)

**Создать:** — · **Изменить:** `docs/team/README.md`

**Ожидаемый результат:** Таблица ников; Правило защиты main

**Критерии приёмки:**

- [ ] 6/6 с доступом
- [ ] Правило для main включено
- [ ] У всех ник и noreply в git config
- [ ] Каналы созданы

**Ручная проверка:** Settings → Branches

**Команды проверки:**

- `git config user.name && git config user.email`

**Доказательство готовности:** Скриншот правила (вне репозитория), таблица ников

**Типовые сбои:** У участника нет аккаунта GitHub · **Запасной путь:** Создать аккаунт с ником без имени

##### PREP-04 · Аккаунты: Earthdata, Earth Engine, Vercel

P0 · PREP · M0 · разрешение: PERMITTED (можно сейчас) · окно: до 27.10 · оценка 1 ч · соисполнители: MEMBER_B, MEMBER_C, MEMBER_D

**Цель.** Рабочие учётные записи: Earthdata (A, B, C, D), некоммерческий проект GEE (B + запасной у A), Vercel (A).

**Зачем.** Без них конвейер Земли и деплой не стартуют в день хакатона.

**Шаги:**

1. Зарегистрировать Earthdata Login
2. Создать облачный проект и зарегистрировать его в GEE как noncommercial (Community tier); проверить условия для несовершеннолетних
3. Проверить `earthengine authenticate` и тестовый запрос на постороннем регионе
4. Создать аккаунт Vercel; если условия не позволяют — записать в DECISIONS.md (DEC-014)
5. Выдать доступ к Vercel MEMBER_C и MEMBER_D как заместителям

**Создать:** — · **Изменить:** `docs/planning/DECISIONS.md`

**Ожидаемый результат:** Рабочие аккаунты

**Критерии приёмки:**

- [ ] 4 входа в Earthdata
- [ ] GEE-проект работает у B и запасной у A
- [ ] Vercel создан или выбран запасной хостинг
- [ ] Ключей в репозитории нет

**Ручная проверка:** Вход на urs.earthdata.nasa.gov

**Команды проверки:**

- `python3 -c "import ee; ee.Initialize(project='<id>'); print(ee.Number(1).getInfo())"`

**Доказательство готовности:** Отметка «работает» с датой для каждого аккаунта

**Типовые сбои:** GEE не одобряет проект · **Запасной путь:** Запасной путь Земли: Copernicus DEM на AWS Open Data и Planetary Computer (R04)

##### RULE-01 · 28.10: разбор полного условия, обновление трассировки

P0 · PREP · M0 · разрешение: PERMITTED (можно сейчас) · окно: 28–29.10 · оценка 1,5 ч · не раньше 28.10.2026 00:00 (Астана) · соисполнители: MEMBER_E, MEMBER_F

**Цель.** За сутки перенести требования полного условия в OFFICIAL_RULES §2 и TRACEABILITY, пересмотреть цели и задачи.

**Зачем.** Решения могут измениться; требование без задачи — ошибка плана.

**Шаги:**

1. Прочитать условие вместе с E и F
2. Ключевые требования — короткими цитатами и пересказом в OFFICIAL_RULES §2
3. Каждое требование → строка в docs/audit/TRACEABILITY_AND_COMPLETENESS.md §1
4. При необходимости изменить задачи в project/tasks.json, затем render и validate
5. Созвон; решения в DECISIONS.md

**Создать:** — · **Изменить:** `docs/competition/OFFICIAL_RULES.md`, `docs/audit/TRACEABILITY_AND_COMPLETENESS.md`, `docs/planning/DECISIONS.md`, `project/tasks.json`

**Ожидаемый результат:** Обновлённые требования и трассировка

**Критерии приёмки:**

- [ ] Все требования связаны с задачами или отмечены «вне объёма»
- [ ] tools validate без ошибок
- [ ] Решения записаны

**Автотесты:** `python3 tools/tasks.py validate`

**Команды проверки:**

- `python3 tools/tasks.py validate`

**Доказательство готовности:** Коммит с обновлением

**Типовые сбои:** Условие сильно отличается · **Запасной путь:** Внеочередной пересмотр концепции на созвоне 29.10

##### PREP-12 · Окружение на шести ноутбуках

P0 · PREP · M0 · разрешение: PERMITTED (можно сейчас) · окно: до 08.11 · оценка 1,5 ч · соисполнители: MEMBER_B, MEMBER_C, MEMBER_D, MEMBER_E, MEMBER_F

**Цель.** Python 3.11+, Node LTS, Git, Claude Code; у кодеров — rasterio, numpy, pandas, pyproj, earthengine-api, astropy.

**Зачем.** Установка в день хакатона съедает час и больше.

**Шаги:**

1. Установить инструменты по списку
2. Проверить импорты
3. Проверить `python3 tools/tasks.py validate`
4. Записать проблемы в BLOCKERS.md

**Создать:** — · **Изменить:** `docs/planning/PROGRESS.md`

**Ожидаемый результат:** Отметка 6/6

**Критерии приёмки:**

- [ ] 6/6: tools validate проходит
- [ ] 4/4 кодера: импорты без ошибок
- [ ] A и D: node ≥ 20

**Автотесты:** `python3 tools/tasks.py validate`

**Команды проверки:**

- `python -c "import rasterio, numpy, pandas, pyproj, ee, astropy"`

**Доказательство готовности:** 6/6 с датой

**Типовые сбои:** Колёса rasterio не ставятся · **Запасной путь:** Conda или Docker с GDAL

##### PREP-08 · Тренировка: Vite + React + TS + MapLibre + Web Worker в учебном репозитории

P1 · PREP · M0 · разрешение: PERMITTED (можно сейчас) · окно: до 08.11 · оценка 3 ч

**Цель.** Собрать игрушечную карту с подложкой NASA GIBS, слоем точек с feature-state и воркером в отдельном репозитории.

**Зачем.** Каркас и карта — путь к IC-1.

**Зависит от:** PREP-04 (MEMBER_A)

**Шаги:**

1. Учебный репозиторий: карта MapLibre с WMTS GIBS
2. 3 000 случайных точек с перекраской по feature-state и замер
3. Web Worker с тяжёлым циклом и таймаутом
4. Деплой на Vercel

**Создать:** — · **Изменить:** `docs/planning/PROGRESS.md`

**Ожидаемый результат:** Заметка и ссылка

**Критерии приёмки:**

- [ ] Учебная карта открывается по ссылке
- [ ] Замер перекраски записан
- [ ] Код не в этом репозитории

**Ручная проверка:** Ссылка на учебный деплой

**Команды проверки:**

- manual: заметка

**Доказательство готовности:** Замер перекраски в мс

**Типовые сбои:** URL GIBS не работает · **Запасной путь:** Проверить шаблон по документации GIBS; запасная подложка — без тайлов

##### RULE-04 · 13.11 вечер: готовность к старту (IC-0)

P0 · PREP · M0 · разрешение: PERMITTED (можно сейчас) · окно: 13.11 вечер · оценка 0,5 ч · не раньше 13.11.2026 00:00 (Астана) · соисполнители: MEMBER_B, MEMBER_C, MEMBER_D, MEMBER_E, MEMBER_F

**Цель.** Короткий созвон: аккаунты, ноутбуки, прочитанные документы, план первого часа.

**Зачем.** Чистый старт в 09:00.

**Зависит от:** RULE-01 (MEMBER_A), RULE-03 (MEMBER_F), PREP-02 (MEMBER_F), PREP-04 (MEMBER_A), PREP-12 (MEMBER_A)

**Шаги:**

1. Пройти чек-лист IC-0 в INTEGRATION_STATUS
2. Записать отметку

**Создать:** — · **Изменить:** `docs/planning/INTEGRATION_STATUS.md`

**Ожидаемый результат:** IC-0

**Критерии приёмки:**

- [ ] 6/6 готовы
- [ ] tools validate без ошибок

**Автотесты:** `python3 tools/tasks.py validate`

**Команды проверки:**

- `python3 tools/tasks.py validate`

**Доказательство готовности:** Отметка IC-0

**Типовые сбои:** Кто-то не готов · **Запасной путь:** Пара заменяет участника (CONTINGENCY_PLAN)

##### PREP-11 · Тренировка команды: Git и Claude Code

P2 · PREP · M0 · разрешение: PERMITTED (можно сейчас) · окно: до 08.11 · оценка 1,5 ч · флаги: OPTIONAL · соисполнители: MEMBER_B, MEMBER_C, MEMBER_D, MEMBER_E, MEMBER_F

**Цель.** 60–90 минут практики PR-процесса и команд `/execute-member`, `tools/tasks.py next` на учебном репозитории.

**Зачем.** Меньше потерь времени на git в день хакатона.

**Зависит от:** PREP-03 (MEMBER_A)

**Шаги:**

1. Учебный репозиторий: ветка → PR → ревью → merge у каждого
2. Запуск `python3 tools/tasks.py next MEMBER_X` у каждого

**Создать:** — · **Изменить:** `docs/planning/PROGRESS.md`

**Ожидаемый результат:** Отметка

**Критерии приёмки:**

- [ ] У каждого по одному PR
- [ ] Каждый запускал next

**Ручная проверка:** Отметка

**Команды проверки:**

- manual: отметка

**Доказательство готовности:** Дата

**Типовые сбои:** — · **Запасной путь:** —

##### AUTH-02 · Общий шаблон веб-приложения в отдельном репозитории (только с разрешением A3)

P2 · PREP · M0 · разрешение: CLARIFICATION_REQUIRED (только после письменного разрешения организаторов) · окно: после ответа A3 · оценка 1,5 ч · флаги: OPTIONAL

**Цель.** Подготовить шаблон Vite + React + TS + MapLibre без логики Egiz в отдельном публичном репозитории.

**Зачем.** Экономит ~0,5 ч INFRA-01, если разрешено.

**Зависит от:** PREP-01 (MEMBER_F), PREP-08 (MEMBER_A)

**Шаги:**

1. Проверить authorization_evidence (A3)
2. Создать шаблон без логики проекта
3. Записать ссылку в DECISIONS.md

**Создать:** — · **Изменить:** `docs/planning/DECISIONS.md`

**Ожидаемый результат:** Ссылка на шаблон

**Критерии приёмки:**

- [ ] Есть разрешение
- [ ] В шаблоне нет ничего от Egiz

**Ручная проверка:** Проверка содержимого

**Команды проверки:**

- manual: ссылка

**Доказательство готовности:** Разрешение A3 и ссылка

**Типовые сбои:** Разрешения нет · **Запасной путь:** INFRA-01 с нуля

##### KICK-01 · Старт 09:00: решения и пререгистрация

P0 · HACK · M1 · разрешение: DEFER_UNTIL_EVENT (только с начала хакатона) · окно: Сб 09:00–09:30 · оценка 0,5 ч · не раньше 14.11.2026 09:00 (Астана) · флаги: CRITICAL_PATH · соисполнители: MEMBER_B, MEMBER_C, MEMBER_D, MEMBER_E, MEMBER_F

**Цель.** Перевести решения PROPOSED в ACCEPTED, закоммитить пререгистрацию проверок до любой обработки данных, раздать первые задачи.

**Зачем.** Пререгистрация — основа научной честности; без неё E3 бесполезен.

**Зависит от:** RULE-04 (MEMBER_A)

**Шаги:**

1. 2 мин: правила (несовершеннолетние, заморозки 11:00 и 13:00)
2. 5 мин: DEC-019…DEC-024 → ACCEPTED с временем
3. 5 мин: подтвердить VALIDATION_PROTOCOL §0 и параметры §12 MATHEMATICAL_SPECIFICATION; коммит `KICK-01: preregister`; хэш в DEC-010
4. Назначить слушателя брифинга (MEMBER_F)
5. Каждый называет первые две задачи

**Создать:** — · **Изменить:** `docs/planning/DECISIONS.md`, `docs/science/VALIDATION_PROTOCOL.md`

**Ожидаемый результат:** Коммит пререгистрации

**Критерии приёмки:**

- [ ] Решения ACCEPTED
- [ ] Коммит пререгистрации раньше первого запуска обработки
- [ ] Хэш в DEC-010

**Ручная проверка:** git log показывает порядок коммитов

**Команды проверки:**

- `git log --format='%h %ad %s' --date=iso | head`

**Доказательство готовности:** Хэш коммита пререгистрации

**Типовые сбои:** Кто-то опоздал · **Запасной путь:** Решения фиксирует A, отсутствующие читают DECISIONS

##### INFRA-01 · Каркас репозитория

P0 · HACK · M2 · разрешение: DEFER_UNTIL_EVENT (только с начала хакатона) · окно: Сб 09:30–10:15 · оценка 0,75 ч · не раньше 14.11.2026 09:00 (Астана) · флаги: CRITICAL_PATH

**Цель.** Создать структуру из FILE_BY_FILE_BUILD_PLAN §1 и §8: Makefile, pyproject, requirements, LICENSE, пакеты pipeline, Vite-приложение.

**Зачем.** Все остальные начинают с каркаса.

**Зависит от:** KICK-01 (MEMBER_A)

**Шаги:**

1. `npm create vite@latest web -- --template react-ts`; добавить maplibre-gl, zustand, vitest
2. pyproject (ruff, pytest testpaths=pipeline), requirements.txt по плану файлов
3. Makefile: check, test, fixtures, earth, data, web, offline
4. LICENSE MIT («<team> contributors»), .gitignore: web/public/data/, data/raw/, *.mp4
5. `make check` на чистом клоне

**Создать:** `Makefile`, `pyproject.toml`, `requirements.txt`, `LICENSE`, `pipeline/__init__.py`, `pipeline/common/__init__.py`, `web/package.json`, `web/vite.config.ts`, `web/tsconfig.json`, `web/index.html`, `web/src/main.tsx` · **Изменить:** `.gitignore`, `README.md`

**Ожидаемый результат:** Собирающийся каркас

**Критерии приёмки:**

- [ ] `make check` выполняется
- [ ] `npm --prefix web run build` собирает
- [ ] LICENSE на месте

**Автотесты:** `make check`, `npm --prefix web run build`

**Команды проверки:**

- `make check`

**Доказательство готовности:** Вывод make check

**Типовые сбои:** Версии пакетов конфликтуют · **Запасной путь:** Зафиксировать версии из учебного репозитория PREP-08

##### INFRA-02 · Контракты v1: схемы, валидатор, типы

P0 · HACK · M2 · разрешение: DEFER_UNTIL_EVENT (только с начала хакатона) · окно: Сб 10:15–11:00 · оценка 0,75 ч · не раньше 14.11.2026 09:00 (Астана) · флаги: CRITICAL_PATH · соисполнители: MEMBER_B, MEMBER_C, MEMBER_D

**Цель.** JSON Schema для 6 файлов (API_AND_SCHEMA_CONTRACTS §2), валидатор с проверкой версии и запретом синтетики, TS-типы.

**Зачем.** Контракт — граница между шестью участниками.

**Зависит от:** INFRA-01 (MEMBER_A)

**Шаги:**

1. Схемы earth_candidates, targets, mission_templates, sun_windows, results, validation
2. Примеры в contracts/examples/
3. pipeline/contracts/validate.py: выбор схемы по полю schema, major-версия, check_no_synthetic
4. web/src/types/contracts.ts
5. Ревью B, C, D по 5 минут; объявить заморозку v1 в #general; INTEGRATION_STATUS §1

**Создать:** `contracts/`, `pipeline/contracts/__init__.py`, `pipeline/contracts/validate.py`, `pipeline/contracts/models.py`, `pipeline/contracts/tests/test_validate.py`, `web/src/types/contracts.ts` · **Изменить:** `docs/planning/INTEGRATION_STATUS.md`

**Интерфейсы:** API_AND_SCHEMA_CONTRACTS §2–§4 · **Данные:** —

**Ожидаемый результат:** contracts v1

**Критерии приёмки:**

- [ ] Примеры проходят
- [ ] Файл версии 2.0.0 отклоняется
- [ ] TS-типы компилируются
- [ ] Заморозка объявлена

**Автотесты:** `pytest pipeline/contracts -q`, `npm --prefix web run typecheck`

**Команды проверки:**

- `python -m pipeline.contracts.validate contracts/examples/*.json`

**Доказательство готовности:** Вывод тестов и хэш заморозки

**Типовые сбои:** Разногласия о полях · **Запасной путь:** Решает A по API_AND_SCHEMA_CONTRACTS; спорные поля — необязательные

##### INFRA-03 · Синтетические фикстуры

P0 · HACK · M2 · разрешение: DEFER_UNTIL_EVENT (только с начала хакатона) · окно: Сб 11:00–11:30 · оценка 0,5 ч · не раньше 14.11.2026 09:00 (Астана) · флаги: CRITICAL_PATH, PARALLELIZABLE

**Цель.** `python -m pipeline.contracts.fixtures`: синтетика по всем схемам (FAKE_, synthetic=true), ~500 кандидатов всех пулов, включая FAKE_PR_ и FAKE_CT_, 2 цели.

**Зачем.** Сайт и движок начинают работать до реальных данных.

**Зависит от:** INFRA-02 (MEMBER_A)

**Шаги:**

1. Генератор с seed 42
2. Реалистичные диапазоны атрибутов
3. results/validation по формулам спецификации (упрощённо)
4. Валидация всех файлов

**Создать:** `pipeline/contracts/fixtures.py`, `data/fixtures/` · **Изменить:** —

**Ожидаемый результат:** data/fixtures/*.json

**Критерии приёмки:**

- [ ] Все фикстуры проходят схемы
- [ ] Везде FAKE_ и synthetic=true
- [ ] Детерминированно

**Автотесты:** `python -m pipeline.contracts.fixtures && python -m pipeline.contracts.validate data/fixtures/*.json`

**Команды проверки:**

- `make fixtures`

**Доказательство готовности:** Вывод валидатора

**Типовые сбои:** Фикстуры не похожи на реальность · **Запасной путь:** Достаточно, чтобы сайт рисовался; реальные данные с IC-1

##### WEB-01 · Каркас приложения: маршруты, загрузка, store, токены

P0 · HACK · M4 · разрешение: DEFER_UNTIL_EVENT (только с начала хакатона) · окно: Сб 11:30–12:00 и 13:00–14:00 · оценка 1,5 ч · не раньше 14.11.2026 09:00 (Астана) · флаги: CRITICAL_PATH

**Цель.** S0: маршруты #/…, load.ts с ошибками версии и схемы, store по контракту, токены дизайна, плашка synthetic, индикатор Offline.

**Зачем.** Основа всех экранов.

**Зависит от:** INFRA-03 (MEMBER_A)

**Шаги:**

1. routes.ts, App.tsx; маршрут по умолчанию `#/` → Campaign с Mons Mouton, шаблоном по умолчанию и k = 3
2. load.ts + DataLoadError
3. store.ts (Zustand)
4. tokens.css и шрифты; простые подписи по глобальным правилам SCREEN_BY_SCREEN_SPEC
5. Vitest: версия, синтетика, маршрут по умолчанию

**Создать:** `web/src/App.tsx`, `web/src/routes.ts`, `web/src/state/store.ts`, `web/src/data/load.ts`, `web/src/styles/tokens.css`, `web/src/styles/global.css`, `web/src/components/layout/`, `web/public/fonts/` · **Изменить:** —

**Интерфейсы:** AppState; DataLoadError · **Данные:** —

**Ожидаемый результат:** Каркас приложения

**Критерии приёмки:**

- [ ] Без ошибок в консоли
- [ ] Плашка на фикстурах
- [ ] Понятные ошибки данных

**Автотесты:** `npm --prefix web test -- --run`

**Команды проверки:**

- `npm --prefix web run typecheck && npm --prefix web run build`

**Доказательство готовности:** Вывод тестов

**Типовые сбои:** Шрифты не грузятся офлайн · **Запасной путь:** Системные шрифты

##### WEB-02 · Экран Mission Brief

P0 · HACK · M4 · разрешение: DEFER_UNTIL_EVENT (только с начала хакатона) · окно: Сб 14:00–14:30 · оценка 0,5 ч · не раньше 14.11.2026 09:00 (Астана)

**Цель.** S1: карточки целей, шаблон и задачи, k, кнопка Design campaign.

**Зачем.** Вход в продукт.

**Зависит от:** WEB-01 (MEMBER_A)

**Шаги:**

1. web/src/components/brief/
2. Синхронизация с адресом
3. Неактивная кнопка без задач

**Создать:** `web/src/components/brief/` · **Изменить:** —

**Ожидаемый результат:** Brief

**Критерии приёмки:**

- [ ] Поведение по спецификации

**Автотесты:** `npm --prefix web test -- --run`

**Команды проверки:**

- `npm --prefix web run build`

**Доказательство готовности:** Скриншот

**Типовые сбои:** Состояние Brief и адрес расходятся · **Запасной путь:** Без синхронизации с адресом: выбор только в store

##### WEB-03 · Карта Земли

P0 · HACK · M4 · разрешение: DEFER_UNTIL_EVENT (только с начала хакатона) · окно: Сб 14:30–15:30 · оценка 1 ч · не раньше 14.11.2026 09:00 (Астана)

**Цель.** S2-карта: подложка GIBS, точки кандидатов по F выбранной задачи, маркеры кампании, таблица-альтернатива, офлайн-фон.

**Зачем.** Ответ «где».

**Зависит от:** WEB-01 (MEMBER_A)

**Шаги:**

1. web/src/components/map/
2. feature-state для раскраски
3. Маркеры 1–3 и «Fit campaign»
4. Переключатель Map/Table
5. Обработка ошибок тайлов

**Создать:** `web/src/components/map/` · **Изменить:** —

**Ожидаемый результат:** Карта

**Критерии приёмки:**

- [ ] Перекраска ≤ 200 мс
- [ ] Атрибуция GIBS
- [ ] Работает без подложки

**Автотесты:** `npm --prefix web test -- --run`

**Ручная проверка:** Профилирование

**Команды проверки:**

- `npm --prefix web run build`

**Доказательство готовности:** Замер перекраски

**Типовые сбои:** URL GIBS · **Запасной путь:** Фон без подложки

##### INFRA-05 · Деплой и офлайн-сборка

P0 · HACK · M8 · разрешение: DEFER_UNTIL_EVENT (только с начала хакатона) · окно: Сб 15:30–16:15 · оценка 0,75 ч · не раньше 14.11.2026 09:00 (Астана)

**Цель.** Vercel (превью PR, прод из main) и `make offline` (сборка + архив dist).

**Зачем.** Ссылка для судей и запас для питча.

**Зависит от:** WEB-01 (MEMBER_A)

**Шаги:**

1. vercel.json по FINAL_ARCHITECTURE §8
2. web/scripts/copy-data.mjs: processed → public/data, иначе фикстуры
3. Подключить репозиторий в Vercel
4. Цель `make offline`
5. Проверить ссылку в инкогнито

**Создать:** `vercel.json`, `web/scripts/copy-data.mjs` · **Изменить:** `web/package.json`, `Makefile`

**Ожидаемый результат:** Прод-ссылка; dist.zip

**Критерии приёмки:**

- [ ] Ссылка открывается без входа
- [ ] Merge в main → обновление ≤ 5 мин
- [ ] Офлайн-сборка открывается при выключенном Wi‑Fi

**Ручная проверка:** Инкогнито; Офлайн

**Команды проверки:**

- `npm --prefix web run build && npx serve web/dist`

**Доказательство готовности:** URL и время деплоя

**Типовые сбои:** Vercel недоступен · **Запасной путь:** GitHub Pages после публикации; офлайн-сборка

##### INFRA-04 · CI в GitHub Actions

P1 · HACK · M9 · разрешение: DEFER_UNTIL_EVENT (только с начала хакатона) · окно: Сб 16:15–16:45 · оценка 0,5 ч · не раньше 14.11.2026 09:00 (Астана)

**Цель.** Workflow из TESTING_STRATEGY §4.

**Зачем.** Ловит сломанный main до демо.

**Зависит от:** INFRA-01 (MEMBER_A)

**Шаги:**

1. ci.yml с двумя заданиями
2. Поиск секретов
3. Сделать проверку обязательной

**Создать:** `.github/workflows/ci.yml` · **Изменить:** —

**Ожидаемый результат:** CI

**Критерии приёмки:**

- [ ] Зелёный прогон
- [ ] Падение блокирует merge
- [ ] < 5 мин

**Ручная проверка:** Тестовый PR

**Команды проверки:**

- manual: зелёный прогон

**Доказательство готовности:** Ссылка на прогон

**Типовые сбои:** rasterio долго ставится · **Запасной путь:** Кэш pip; иначе CI без конвейера, только web и tools

##### INFRA-06 · Точки интеграции IC-1, IC-2, IC-3, снимок данных и релиз

P0 · HACK · M8 · разрешение: DEFER_UNTIL_EVENT (только с начала хакатона) · окно: Сб 17:30 · Вс 09:30 · Вс 11:00 · Вс 13:00 · оценка 1 ч · не раньше 14.11.2026 09:00 (Астана) · соисполнители: MEMBER_B, MEMBER_C, MEMBER_D, MEMBER_E, MEMBER_F

**Цель.** Провести IC-1 (Сб 17:30), IC-2 (S1: Вс 09:30; S2: Сб 22:30), IC-3 (Вс 11:00); снимок data/processed с хэшами; тег v1.0; `make check` на main.

**Зачем.** Без этого параллельная работа не превращается в один продукт.

**Зависит от:** INFRA-05 (MEMBER_A), ENG-03 (MEMBER_D)

**Шаги:**

1. Слить готовые PR в порядке контракты → данные → движок → сайт
2. `make check` на main
3. Сквозной сценарий из INTEGRATION_STATUS
4. Записать результат и что не вошло
5. IC-3: заморозка функций; `sha256sum data/processed/*` в INTEGRATION_STATUS; тег v1.0 в 13:00

**Создать:** — · **Изменить:** `docs/planning/INTEGRATION_STATUS.md`

**Ожидаемый результат:** Записи IC; Тег v1.0

**Критерии приёмки:**

- [ ] Три записи IC с временем
- [ ] На IC-1 реальные данные (synthetic=false) на прод-ссылке
- [ ] Хэши данных и тег v1.0

**Автотесты:** `make check`

**Команды проверки:**

- `python3 tools/tasks.py status`

**Доказательство готовности:** Записи IC, хэши, тег

**Типовые сбои:** Конфликт при слиянии · **Запасной путь:** Откат к последней зелёной точке; владелец файла решает конфликт

##### WEB-10 · Переключатель «Казахстан»

P1 · HACK · M6 · разрешение: DEFER_UNTIL_EVENT (только с начала хакатона) · окно: S2: Сб 21:30–22:00 · оценка 0,5 ч · не раньше 14.11.2026 09:00 (Астана)

**Цель.** S7: кампания только по KZ_ и сравнение с глобальной.

**Зачем.** Локальная польза.

**Зависит от:** EARTH-07 (MEMBER_B), WEB-03 (MEMBER_A)

**Шаги:**

1. web/src/components/kz/
2. Фильтр пула в store

**Создать:** `web/src/components/kz/` · **Изменить:** —

**Ожидаемый результат:** Режим KZ

**Критерии приёмки:**

- [ ] Работает с KZ_ и без них

**Автотесты:** `npm --prefix web test -- --run`

**Команды проверки:**

- `npm --prefix web run build`

**Доказательство готовности:** Скриншот

**Типовые сбои:** Нет KZ_ · **Запасной путь:** Подпись «data not loaded»

##### WEB-07 · Экран «То же Солнце»

P1 · HACK · M6 · разрешение: DEFER_UNTIL_EVENT (только с начала хакатона) · окно: S2: Вс 08:00–10:00 (если LIGHT-04 готов) · оценка 2 ч · не раньше 14.11.2026 09:00 (Астана)

**Цель.** S5: две панели кадров, ползунок высоты, анимация азимута, график sf, подпись окна.

**Зачем.** WOW-момент.

**Зависит от:** WEB-03 (MEMBER_A), LIGHT-04 (MEMBER_C)

**Шаги:**

1. web/src/components/twin/ и pages/TwinPage.tsx
2. Манифест кадров
3. reduced-motion

**Создать:** `web/src/components/twin/`, `web/src/pages/TwinPage.tsx` · **Изменить:** —

**Ожидаемый результат:** Экран Twin

**Критерии приёмки:**

- [ ] Кадры одинаковых h и az
- [ ] Пауза по клику

**Автотесты:** `npm --prefix web test -- --run`

**Команды проверки:**

- `npm --prefix web run build`

**Доказательство готовности:** Запись экрана

**Типовые сбои:** Нет кадров · **Запасной путь:** Календарь окон в панели площадки

##### WEB-11 · Адаптивность, доступность, скорость

P1 · HACK · M7 · разрешение: DEFER_UNTIL_EVENT (только с начала хакатона) · окно: Вс 10:00–11:00 · оценка 1 ч · не раньше 14.11.2026 09:00 (Астана)

**Цель.** 375–1920 px, клавиатура, контраст, Lighthouse ≥ 90, данные ≤ 3 МБ gzip.

**Зачем.** UX и ворота G4, G7.

**Зависит от:** WEB-04 (MEMBER_C)

**Шаги:**

1. Брейкпоинты
2. Фокус и aria
3. Lighthouse

**Создать:** — · **Изменить:** `web/src/styles/global.css`

**Ожидаемый результат:** Отчёт Lighthouse

**Критерии приёмки:**

- [ ] Скриншоты 375 и 1440
- [ ] Lighthouse ≥ 90

**Ручная проверка:** Lighthouse

**Команды проверки:**

- manual: Lighthouse

**Доказательство готовности:** Оценки Lighthouse

**Типовые сбои:** Lighthouse < 90 из-за карты; Контраст на подложке · **Запасной путь:** Ленивая загрузка карты; таблица-альтернатива по умолчанию на телефоне

##### QA-03 · Офлайн-комплект для питча

P0 · HACK · M9 · разрешение: DEFER_UNTIL_EVENT (только с начала хакатона) · окно: Вс 11:15–11:45 · оценка 0,5 ч · не раньше 14.11.2026 09:00 (Астана)

**Цель.** dist.zip на 2 ноутбуках и флешке, 5 скриншотов, слайды PDF.

**Зачем.** Демо не зависит от интернета.

**Зависит от:** WEB-04 (MEMBER_C), INFRA-05 (MEMBER_A)

**Шаги:**

1. make offline
2. Проверка при выключенном Wi‑Fi
3. Скриншоты S1, S2, S3, S6, (S5)

**Создать:** — · **Изменить:** `docs/planning/INTEGRATION_STATUS.md`

**Ожидаемый результат:** Офлайн-комплект

**Критерии приёмки:**

- [ ] Открывается офлайн
- [ ] Копии на 2 устройствах

**Ручная проверка:** Проверка без Wi‑Fi

**Команды проверки:**

- manual: проверка

**Доказательство готовности:** Отметка

**Типовые сбои:** Шрифты или данные грузятся из сети; Нет флешки · **Запасной путь:** Скриншоты и PDF слайдов на двух ноутбуках

##### SUB-05 · Приватность и публикация репозитория

P0 · HACK · M11 · разрешение: DEFER_UNTIL_EVENT (только с начала хакатона) · окно: Вс 11:45–12:15 · оценка 0,5 ч · не раньше 14.11.2026 09:00 (Астана)

**Цель.** Нет имён несовершеннолетних, авторы коммитов — ники (DEC-004), нет секретов, LICENSE; репозиторий публичный; ссылки в инкогнито.

**Зачем.** Правила подачи и Terms & Conditions.

**Зависит от:** SUB-01 (MEMBER_C)

**Шаги:**

1. grep по списку имён вне репозитория
2. `git log --format='%an <%ae>' | sort -u`
3. Вариант DEC-004 при необходимости
4. Сделать публичным
5. Инкогнито

**Создать:** — · **Изменить:** `README.md`

**Ожидаемый результат:** Публичный репозиторий

**Критерии приёмки:**

- [ ] 0 совпадений имён
- [ ] Только ники и noreply
- [ ] Публичный

**Ручная проверка:** Инкогнито

**Команды проверки:**

- `git log --format='%an <%ae>' | sort -u`

**Доказательство готовности:** Вывод git log и ссылка

**Типовые сбои:** Имя в истории · **Запасной путь:** Новый публичный репозиторий после очистки истории (DEC-004)

##### SUB-06 · Финальная подача

P0 · HACK · M11 · разрешение: DEFER_UNTIL_EVENT (только с начала хакатона) · окно: Вс 13:00–13:30 или до 21:00 (по ответу PREP-01) · оценка 0,5 ч · не раньше 14.11.2026 09:00 (Астана) · флаги: CRITICAL_PATH · соисполнители: MEMBER_F

**Цель.** Чек-лист SUBMISSION §5, чекбоксы, Submit for Judging, скриншот подтверждения; MEMBER_F сверяет тексты рядом.

**Зачем.** Без нажатия Submit проекта нет; подаёт тот, кто отвечает за репозиторий и ссылки, — так «хвост» MEMBER_F после проверок короче на 0,5 ч.

**Зависит от:** SUB-07 (MEMBER_F), SUB-03 (MEMBER_B), SUB-04 (MEMBER_C), SUB-05 (MEMBER_A), STORY-06 (MEMBER_F), SCI-09 (MEMBER_E), INFRA-06 (MEMBER_A)

**Шаги:**

1. Пройти чек-лист SUBMISSION §5 вместе с F (числа на странице = submission/claims.md)
2. Submit for Judging
3. Скриншот подтверждения — вне репозитория
4. Отметка в PROGRESS.md

**Создать:** — · **Изменить:** `docs/planning/PROGRESS.md`

**Ожидаемый результат:** Подтверждение

**Критерии приёмки:**

- [ ] Подтверждение получено
- [ ] Не позже Вс 13:30 (или ≥ 3 ч до дедлайна, если локальный срок позже)

**Ручная проверка:** Баннер подтверждения

**Команды проверки:**

- manual: баннер

**Доказательство готовности:** Время подачи

**Типовые сбои:** Поле не заполнено · **Запасной путь:** Заполнить и подать немедленно

##### WEB-12 · 3D-рельеф (необязательно)

P3 · HACK · M6 · разрешение: DEFER_UNTIL_EVENT (только с начала хакатона) · окно: — · оценка 2 ч · не раньше 14.11.2026 09:00 (Астана) · флаги: OPTIONAL

**Цель.** 3D цели и площадки.

**Зачем.** Эффект, без научной пользы.

**Зависит от:** WEB-07 (MEMBER_A)

**Шаги:**

1. three.js по кадрам DEM

**Создать:** `web/src/components/twin3d/` · **Изменить:** —

**Ожидаемый результат:** 3D

**Критерии приёмки:**

- [ ] Не ломает сборку

**Автотесты:** `npm --prefix web run build`

**Команды проверки:**

- `npm --prefix web run build`

**Доказательство готовности:** Скриншот 3D-сцены и замер FPS

**Типовые сбои:** Тяжёлая сцена ломает телефон · **Запасной путь:** Не делаем
<!-- END GENERATED:member-tasks:MEMBER_A -->

## 10. Замена

Заместитель — MEMBER_D (доступ к Vercel и правам репозитория выдан в PREP-04). Всё, что нужно для продолжения, — в этом файле, реестре и INTEGRATION_STATUS; протокол продолжения — [CLAUDE.md §8](../../CLAUDE.md).
