---
name: "source-command-submission-readiness"
description: "Отчёт о готовности к подаче по воротам G1–G10"
---

# source-command-submission-readiness

Use this skill when the user asks to run the migrated source command `submission-readiness`.

## Command Template

Подготовь отчёт о готовности к подаче. Ничего не меняй без просьбы пользователя.

1. Прочитай AGENTS.md, docs/competition/JUDGING_READINESS.md (§5 «Ворота готовности»), docs/competition/SUBMISSION.md (§5 «Чек-лист»), docs/competition/OFFICIAL_RULES.md и docs/competition/PRE_EVENT_AUTHORIZATION.md (§3 — раскрытие подготовки).
2. Для каждого из ворот G1–G10: статус (пройдено / не пройдено / нельзя проверить), доказательство (файл, команда и её вывод, ссылка) и что сделать, кто владелец. Ворота без доказательства считаются непройденными.
3. Проверь то, что можно проверить из репозитория: `python3 tools/tasks.py status`, открытые P0, LICENSE, README для жюри, `submission/*` (claims.md подписан, references.md, ai_use.md, links.md), отсутствие `synthetic`/`FAKE_` в data/processed, раскрытие подготовки в README, авторы коммитов (`git log --format='%an <%ae>' | sort -u` — только ники и noreply). Для проверки имён несовершеннолетних попроси у пользователя список имён и не записывай его в репозиторий.
4. Отметь риски дисквалификации из OFFICIAL_RULES §4 отдельным списком.
5. До старта хакатона честно ответь, что подаваемых материалов ещё нет и не должно быть; оцени только готовность процесса (PREP-задачи, ответы организаторов, сценарий).
6. Итог одной строкой: можно подавать или нет, и три главных действия.
