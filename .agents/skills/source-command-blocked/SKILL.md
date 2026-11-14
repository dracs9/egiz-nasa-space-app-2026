---
name: "source-command-blocked"
description: "Показать заблокированные задачи и кто их блокирует"
---

# source-command-blocked

Use this skill when the user asks to run the migrated source command `blocked`.

## Command Template

Покажи заблокированные задачи. Ничего не меняй в файлах, если пользователь не попросил.

1. Запусти `python3 tools/tasks.py blocked`.
2. Прочитай docs/planning/BLOCKERS.md.
3. Ответь коротко: таблица «задача — чего ждёт — кто владелец блокера — с какого времени — запасной путь (поле `fallback` и CRITICAL_PATH_AND_DEPENDENCIES §6)». Отдельно — задачи, ждущие письменного разрешения организаторов, и задачи, закрытые по времени (до старта хакатона), — по одной строке.
