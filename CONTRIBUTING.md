# Как работаем

Коротко. Подробно — [DEVELOPMENT_WORKFLOW](docs/engineering/DEVELOPMENT_WORKFLOW.md) и [CLAUDE.md](CLAUDE.md).

## Главное правило NASA

До 14.11.2026 09:00 по Астане в репозитории только план, реестр задач и инструменты координации. Код решения, обработку данных, дизайн и тексты подачи начинаем на хакатоне. Тренироваться можно в отдельных учебных папках и репозиториях на посторонних примерах. Задачи с категорией CLARIFICATION_REQUIRED (AUTH-01, AUTH-02) — только после письменного разрешения организаторов, записанного командой `python3 tools/tasks.py authorize` ([PRE_EVENT_AUTHORIZATION](docs/competition/PRE_EVENT_AUTHORIZATION.md)).

## Что где лежит

- `README.md` — главная страница и навигация.
- `CLAUDE.md` — инструкции для Claude Code.
- `project/tasks.json` — все задачи, статусы и разрешения; `tools/tasks.py` — проверка, вывод, модель расписания.
- `docs/` — документы команды по разделам.
- `.claude/commands/` — команды Claude Code (`/execute-member` и др.).
- `prompts/` — промты для ИИ-инструментов.
- `.github/` — шаблон pull request.

С 14.11 добавятся папки с кодом: [FILE_BY_FILE_BUILD_PLAN](docs/engineering/FILE_BY_FILE_BUILD_PLAN.md). План v1 — в `docs/archive/v1/`, для работы не используется.

## Задачи

- Своя очередь: `python3 tools/tasks.py next MEMBER_X`.
- Смена статуса: `python3 tools/tasks.py set ID STATUS` (для DONE — `--evidence "команда → результат"`).
- Разрешение организаторов для задачи: `python3 tools/tasks.py authorize ID --source "кто, где, дата" --scope "что разрешено"`.
- Успеваем ли: `python3 tools/tasks.py schedule S1`.
- После правки плана: `python3 tools/tasks.py render && python3 tools/tasks.py validate`.

## Git

1. Перед началом: `git pull`.
2. Ветка на задачу: `git switch -c b/EARTH-02-terrain` (буква участника / ID / кратко).
3. Коммиты маленькие, на английском, с ID: `EARTH-02: add stage A terrain attributes`.
4. Pull request в `main` по шаблону. Сливает MEMBER_A.
5. В `main` напрямую не пушим, `force push` не делаем.
6. `git config user.name` — ваш GitHub-ник, `user.email` — noreply-адрес GitHub (приватность, DEC-004).

## Что не коммитим

- Ключи API, токены, пароли, `.env`, учётные данные GEE. Если ключ попал в коммит — сразу говорим MEMBER_A и перевыпускаем ключ.
- Большие файлы: GeoTIFF, архивы, сырые снимки, видео. Они лежат в `data/raw/` и не попадают в git. В репозиторий кладём только маленькие обработанные JSON и (P1) WebP-кадры «То же Солнце».
- Имена, фото и голоса участников младше 18 лет.

## ИИ

- Пользоваться можно и нужно.
- Каждое заметное использование — в [docs/ai-log.md](docs/ai-log.md): кто (MEMBER_X), каким инструментом, для чего.
- В файлах, написанных с помощью ИИ, — строка о помощи ИИ; в коммитах — трейлер `Co-Authored-By`.
- Картинки и видео от ИИ — с видимой пометкой «AI-generated». Без логотипов и символики NASA.
- Числа и научные утверждения от ИИ проверяем по первоисточникам. Всё научное подписывает MEMBER_E.

## Языки

- Документы для команды — на русском.
- Код, коммиты, интерфейс, README для жюри, видео и слайды — на английском.
