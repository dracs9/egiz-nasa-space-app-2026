---
name: "source-command-project-status"
description: "Краткий статус проекта"
---

# source-command-project-status

Use this skill when the user asks to run the migrated source command `project-status`.

## Command Template

Покажи краткий статус проекта. Ничего не меняй в файлах.

1. Запусти `python3 tools/tasks.py status`, `python3 tools/tasks.py blocked` и `python3 tools/tasks.py validate`.
2. До старта хакатона дополнительно: `python3 tools/tasks.py schedule S1 | head -20` (сводка сценариев: успеваем ли P0).
3. Прочитай последние записи docs/planning/PROGRESS.md и открытые строки docs/planning/BLOCKERS.md.
4. Ответь коротко: время до ключевых моментов, прогресс по участникам, открытые P0, задачи, ждущие разрешения организаторов, блокеры, вывод модели расписания, три следующих действия с ID задач и владельцами.
