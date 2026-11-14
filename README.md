# Egiz: кампания земных испытаний для Луны и Марса

Командный репозиторий для **NASA Space Apps Challenge 2026**. Egiz — рабочее название (каз. «егіз», близнец); финальное выбираем на хакатоне (STORY-01).

| | |
| --- | --- |
| **Хакатон** | 14–15 ноября 2026, Астана, Miras International School, очно (формат площадки гибридный) |
| **Челлендж** | [Identify Earth Locations that Analog the Permanent Moon Base Locations and Mars](https://www.spaceappschallenge.org/2026/challenges/identify-earth-locations-that-analog-the-permanent-moon-base-locations-and-mars/) |
| **Команда** | 6 участников: MEMBER_A…MEMBER_F ([роли](docs/team/README.md)) |
| **Статус** | Подготовка. Полное условие — 28 октября. До 14.11 09:00 в репозитории только план и инструменты координации |

## Что делаем

Планировщик испытаний для базы у южного полюса Луны или посадки на Марсе спрашивает: **на каких площадках Земли и в каком минимальном наборе отрепетировать задачи миссии — и чего Земля не даст вообще?** Egiz меряет цель (Mons Mouton, Jezero) и ~3 000 квадратов суши Земли на одних и тех же базах критериев NASA (уклон на 100 м для посадки, на 2 км для выходов), считает соответствие каждой задаче — посадка, выходы и геология, мобильность, низкое Солнце, холод — и находит кампанию из 1–3 площадок с наибольшим покрытием задач. Отдельно показывает потолки: что на Земле недостижимо (вакуум, гравитация, вечная тень) и чем это заменяют. Метод проверяется пререгистрированно: места, которые NASA использовала для конкретных задач, должны оказаться высоко именно для этих задач.

Подробно: [решение и почему](docs/innovation/FINAL_CONCEPT_DECISION.md), [продукт](docs/product/COMPLETE_PRODUCT_SPEC.md), [математика](docs/science/MATHEMATICAL_SPECIFICATION.md), [архитектура](docs/engineering/FINAL_ARCHITECTURE.md). Как мы пришли от v1 к v2 — [критический разбор](docs/audit/EXISTING_PLAN_CRITICAL_REVIEW.md).

## Прочитать всем

1. **До 14.11 09:00 по Астане над проектом не работаем:** ни кода, ни обработки данных, ни дизайна, ни текстов подачи. Можно учиться, заводить аккаунты и готовить план. Что требует письменного разрешения организаторов — [PRE_EVENT_AUTHORIZATION](docs/competition/PRE_EVENT_AUTHORIZATION.md).
2. **Участники младше 18 лет:** в подаче, видео, слайдах, README и коммитах нет их имён, лиц и голосов; на площадке их сопровождает родитель или опекун. Поэтому в репозитории мы — MEMBER_A…MEMBER_F, а в git — ники.
3. **Питч на площадке — 15.11 в 14:00.** Работы на площадке 9–11,5 часа (зависит от ответа организаторов); подача — до 13:30. Почасовой план — [HOUR_BY_HOUR_EXECUTION](docs/planning/HOUR_BY_HOUR_EXECUTION.md).
4. **Демо — 7 слайдов** на английском (наше официальное демо); видео до 30 секунд — если успеем.
5. **Данные NASA обязательны** для глобальных наград; каждый источник цитируем; лицензия кода — MIT.
6. **ИИ можно**, но с раскрытием: [журнал ИИ](docs/ai-log.md), пометка «AI-generated» на ИИ-картинках, без символики NASA.
7. **Ссылки открываются без входа**; к подаче репозиторий публичный.

Все правила со ссылками и статусами — [OFFICIAL_RULES](docs/competition/OFFICIAL_RULES.md).

## Как работать с Claude Code

Откройте папку в Claude Code и скажите **«Выполни задачи MEMBER_X»** (или `/execute-member MEMBER_X`). Claude прочитает [CLAUDE.md](CLAUDE.md) и ваш документ, проверит время и правила и начнёт с самой важной доступной задачи. Другие команды: `/next-task MEMBER_X`, `/blocked`, `/integration-check`, `/submission-readiness`, `/project-status`.

Без Claude:

```bash
python3 tools/tasks.py next MEMBER_X
```

Модель выполнимости расписания по сценариям:

```bash
python3 tools/tasks.py schedule S1
```

## Документы

| Раздел | Документ | Что внутри |
| --- | --- | --- |
| Агентам | [CLAUDE.md](CLAUDE.md) | Протокол работы, правило № 1, разрешения, продолжение прерванной работы, владение файлами |
| Аудит | [EXISTING_PLAN_CRITICAL_REVIEW](docs/audit/EXISTING_PLAN_CRITICAL_REVIEW.md) · [RED_TEAM_REVIEW](docs/audit/RED_TEAM_REVIEW.md) · [TRACEABILITY_AND_COMPLETENESS](docs/audit/TRACEABILITY_AND_COMPLETENESS.md) | Разбор v1, красная команда, трассировка требований |
| Конкурс | [OFFICIAL_RULES](docs/competition/OFFICIAL_RULES.md) · [PRE_EVENT_AUTHORIZATION](docs/competition/PRE_EVENT_AUTHORIZATION.md) · [SUBMISSION](docs/competition/SUBMISSION.md) · [JUDGING_READINESS](docs/competition/JUDGING_READINESS.md) | Правила, что можно до старта, поля подачи, критерии и ворота |
| Исследование | [DEEP_RESEARCH_REPORT](docs/research/DEEP_RESEARCH_REPORT.md) · [SCIENTIFIC_PRIOR_ART](docs/research/SCIENTIFIC_PRIOR_ART.md) · [COMPETITIVE_LANDSCAPE](docs/research/COMPETITIVE_LANDSCAPE.md) · [WINNER_BENCHMARK](docs/research/WINNER_BENCHMARK.md) · [IDEAS_ARCHIVE](docs/research/IDEAS_ARCHIVE.md) | Что известно, кто что делает, победители прошлых лет |
| Инновация | [20_CONCEPTS](docs/innovation/20_CONCEPTS.md) · [CONCEPT_EVALUATION](docs/innovation/CONCEPT_EVALUATION.md) · [FINAL_CONCEPT_DECISION](docs/innovation/FINAL_CONCEPT_DECISION.md) | 20 концептов, взвешенная оценка, решение |
| Продукт | [COMPLETE_PRODUCT_SPEC](docs/product/COMPLETE_PRODUCT_SPEC.md) · [SCREEN_BY_SCREEN_SPEC](docs/product/SCREEN_BY_SCREEN_SPEC.md) · [DESIGN_SYSTEM](docs/product/DESIGN_SYSTEM.md) · [SIGNATURE_DEMO](docs/product/SIGNATURE_DEMO.md) | Продукт, экраны, дизайн, демо и питч |
| Наука | [MATHEMATICAL_SPECIFICATION](docs/science/MATHEMATICAL_SPECIFICATION.md) · [ALGORITHMS_AND_PSEUDOCODE](docs/science/ALGORITHMS_AND_PSEUDOCODE.md) · [DATASET_SPECIFICATION](docs/science/DATASET_SPECIFICATION.md) · [VALIDATION_PROTOCOL](docs/science/VALIDATION_PROTOCOL.md) · [SCIENTIFIC_CLAIMS_REGISTER](docs/science/SCIENTIFIC_CLAIMS_REGISTER.md) · [KAZAKHSTAN_CANDIDATES](docs/science/KAZAKHSTAN_CANDIDATES.md) | Формулы, алгоритмы, данные, проверки, утверждения |
| Инженерия | [FINAL_ARCHITECTURE](docs/engineering/FINAL_ARCHITECTURE.md) · [API_AND_SCHEMA_CONTRACTS](docs/engineering/API_AND_SCHEMA_CONTRACTS.md) · [FUNCTION_SPECIFICATIONS](docs/engineering/FUNCTION_SPECIFICATIONS.md) · [FILE_BY_FILE_BUILD_PLAN](docs/engineering/FILE_BY_FILE_BUILD_PLAN.md) · [TESTING_STRATEGY](docs/engineering/TESTING_STRATEGY.md) · [DEVELOPMENT_WORKFLOW](docs/engineering/DEVELOPMENT_WORKFLOW.md) | Архитектура, контракты, функции, файлы, тесты, процесс |
| План | [ULTRA_DETAILED_ROADMAP](docs/planning/ULTRA_DETAILED_ROADMAP.md) · [HOUR_BY_HOUR_EXECUTION](docs/planning/HOUR_BY_HOUR_EXECUTION.md) · [CRITICAL_PATH_AND_DEPENDENCIES](docs/planning/CRITICAL_PATH_AND_DEPENDENCIES.md) · [CONTINGENCY_PLAN](docs/planning/CONTINGENCY_PLAN.md) · [RISK_REGISTER](docs/planning/RISK_REGISTER.md) | Этапы, часы, зависимости, сценарии, сбои, риски |
| | [DECISIONS](docs/planning/DECISIONS.md) · [PROGRESS](docs/planning/PROGRESS.md) · [BLOCKERS](docs/planning/BLOCKERS.md) · [INTEGRATION_STATUS](docs/planning/INTEGRATION_STATUS.md) | Решения, журнал, блокеры, интеграция |
| Команда | [Роли](docs/team/README.md) · [MEMBER_A](docs/team/MEMBER_A.md) · [B](docs/team/MEMBER_B.md) · [C](docs/team/MEMBER_C.md) · [D](docs/team/MEMBER_D.md) · [E](docs/team/MEMBER_E.md) · [F](docs/team/MEMBER_F.md) | Задачи, интерфейсы и первые действия каждого |
| Задачи | [project/tasks.json](project/tasks.json) | 94 задачи: владельцы, разрешения, шаги, файлы, критерии, тесты, запасные пути |
| Архив | [docs/archive/v1/](docs/archive/v1/) | План v1 — только для истории |

Как работаем с репозиторием: [CONTRIBUTING.md](CONTRIBUTING.md). К подаче этот README станет английским README для жюри (SUB-01), а командная версия переедет в `docs/README.md`.

## Ближайшие даты

| Дата | Событие | Что делаем |
| --- | --- | --- |
| до 20 октября | — | Письмо организаторам: 8 вопросов и разрешения A1–A3 (PREP-01) |
| до 27 октября | — | Регистрация, аккаунты, окружение, учёба (PREP-задачи) |
| 28 октября | Полное условие челленджа | Разбор в течение суток (RULE-01), созвон |
| 2–3 ноября | Space Apps Connect | Вопросы экспертам (RULE-02) |
| 13 ноября | Гайды подачи и судейства 2026 | Сверка правил, готовность IC-0 (RULE-03, RULE-04) |
| 14 ноября, 09:00 | Старт | KICK-01 и почасовой план |
| 15 ноября, 13:30 | Подача | Код заморожен в 13:00 |
| 15 ноября, 14:00 | Питч на площадке | — |
| 15 ноября, 23:59 | Глобальный дедлайн по Астане | Подаём заранее, после питча — только исправления |

## Ссылки

- [Командный гугл-док](https://docs.google.com/document/d/1gxNd2MU0btmbEz6N4pfR1HdQ0by8VEPXf_jfSNsS3R0/edit) — короткая версия для чтения; обновляется из `docs/` ([промт для Codex](prompts/codex-google-doc.md))
- [Страница площадки Astana](https://www.spaceappschallenge.org/2026/local-events/astana/)
- [Participant FAQ 2026](https://www.spaceappschallenge.org/resources/participant-faqs/)
- [NASA Planetary Analog Explorer](https://science.nasa.gov/solar-system/analog-explorer/)

Источник правды — этот репозиторий.
