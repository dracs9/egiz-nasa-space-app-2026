# Команда

Шесть участников: четыре кодера (вайб-кодинг с Claude Code), геолог и маркетолог. В репозитории участники называются только MEMBER_A…MEMBER_F: имена несовершеннолетних не должны попасть в подачу (DEC-004). Кто какой MEMBER — договариваемся в Discord и закрепляем там (PREP-03).

## 1. Роли (v2)

| ID | Роль | Главное | Документ | Канал | Заместитель |
| --- | --- | --- | --- | --- | --- |
| MEMBER_A | Тех-лид | Контракты, каркас и карта сайта, экран Brief, деплой, интеграция IC-1…IC-3, публикация и подача; P1 — «То же Солнце», режим «Казахстан» | [MEMBER_A.md](MEMBER_A.md) | #web | MEMBER_D |
| MEMBER_B | Земля | Earth Engine: пул ~3 000 квадратов, рельеф на базах NASA, среда, экспорт, сверка E2b; страница Evidence; реестр источников | [MEMBER_B.md](MEMBER_B.md) | #earth | MEMBER_C |
| MEMBER_C | Луна, Марс и освещение | DEM целей (PGDA, MOLA/HRSC), Солнце и окна низкого Солнца, панели кампании, README для жюри, раскрытие ИИ; P1 — тени и кадры | [MEMBER_C.md](MEMBER_C.md) | #planets | MEMBER_B |
| MEMBER_D | Движок и проверки | `terrain.py`, соответствие, оптимизатор кампании, `results.json`, проверки E3 и E7, панель площадки; P1 — TS-движок, устойчивость | [MEMBER_D.md](MEMBER_D.md) | #engine | MEMBER_A |
| MEMBER_E | Геолог, научный руководитель | Цели, шаблоны задач и допуски, места практики NASA, разрывы, ограничения, научная проверка, подпись утверждений | [MEMBER_E.md](MEMBER_E.md) | #science | MEMBER_F (таблицы), MEMBER_D (подпись) |
| MEMBER_F | Продукт и питч | Название, слайды (официальное демо), страница проекта, видео (P1), питч, организаторы | [MEMBER_F.md](MEMBER_F.md) | #pitch | MEMBER_E (тексты), MEMBER_A (слайды) |

Нагрузка, зависимости между участниками и модель расписания — [CRITICAL_PATH_AND_DEPENDENCIES](../planning/CRITICAL_PATH_AND_DEPENDENCIES.md); почасовой план — [HOUR_BY_HOUR_EXECUTION](../planning/HOUR_BY_HOUR_EXECUTION.md). План v1 и его роли — в архиве [docs/archive/v1/](../archive/v1/).

## 2. Ники GitHub (заполнить в PREP-03)

| ID | GitHub-ник |
| --- | --- |
| MEMBER_A | |
| MEMBER_B | |
| MEMBER_C | |
| MEMBER_D | |
| MEMBER_E | |
| MEMBER_F | |

Ники можно указывать: это не имена. Настоящие имена — только в профилях spaceappschallenge.org (для сертификатов) и в Discord.

## 3. Как начать работу с Claude Code

1. Откройте папку репозитория в Claude Code (терминал `claude` или приложение).
2. Скажите: **«Выполни задачи MEMBER_X»** (или `/execute-member MEMBER_X`).
3. Claude прочитает CLAUDE.md и ваш документ, проверит время и правила, покажет доступные задачи и начнёт с самой важной.
4. Другие команды: «Продолжи MEMBER_X с последней точки», «Покажи заблокированные задачи» (`/blocked`), «Следующая задача» (`/next-task MEMBER_X`), «Проверка интеграции» (`/integration-check`), «Готовность к подаче» (`/submission-readiness`), «Статус» (`/project-status`).
5. Без Claude: `python3 tools/tasks.py next MEMBER_X`.

До 14.11 09:00 у всех доступны только задачи подготовки (PREP, RULE): учёба, аккаунты, окружение. Это правило NASA. Задачи AUTH открываются только после письменного разрешения организаторов ([PRE_EVENT_AUTHORIZATION](../competition/PRE_EVENT_AUTHORIZATION.md)).

## 4. Связь

| Где | Для чего |
| --- | --- |
| Этот репозиторий | Источник правды: план, задачи, статусы, потом код |
| Discord | Работа на хакатоне: #general, #blockers, #web, #earth, #planets, #engine, #science, #pitch |
| Google Meet | Созвоны (28–29.10, 13.11) |
| [Гугл-док](https://docs.google.com/document/d/1gxNd2MU0btmbEz6N4pfR1HdQ0by8VEPXf_jfSNsS3R0/edit) | Короткая версия для чтения; обновляется из `docs/` по [промту для Codex](../../prompts/codex-google-doc.md) |

## 5. Подготовка до хакатона

Бывшая «домашка» теперь — задачи PREP и RULE в реестре: регистрация и вопросы организаторам (MEMBER_F), GitHub, Discord и аккаунты (MEMBER_A), тренировки по ролям на посторонних примерах (все), окружение на ноутбуках, созвоны 28.10 и 13.11. Список по участнику — в его документе, раздел «Первые действия».
