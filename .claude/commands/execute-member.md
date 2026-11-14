---
description: Выполнить задачи участника MEMBER_X по протоколу CLAUDE.md §4
argument-hint: MEMBER_A | MEMBER_B | MEMBER_C | MEMBER_D | MEMBER_E | MEMBER_F
---
Выполни задачи участника $ARGUMENTS строго по протоколу CLAUDE.md §4.

1. Если аргумент пустой или это не MEMBER_A…MEMBER_F — спроси, какой ID у участника, и остановись.
2. Прочитай CLAUDE.md и docs/team/$ARGUMENTS.md целиком.
3. Восстанови состояние по CLAUDE.md §8: `git status`, `git log --oneline -10`, `python3 tools/tasks.py next $ARGUMENTS`, свой раздел docs/planning/PROGRESS.md. Коротко сообщи: время по Астане, что в работе, что можно начать, что ждёт зависимостей, что ждёт разрешения организаторов.
4. До 2026-11-14 09:00 по Астане (04:00 UTC) — только PREP- и RULE-задачи; AUTH-задачи — только если в карточке есть `authorization_evidence`. Задачи HACK не начинай ни в каком виде (CLAUDE.md §1).
5. Бери задачи по одной в порядке вывода `next`: `python3 tools/tasks.py show ID` → `set ID IN_PROGRESS` → шаги карточки (меняй только `files_create` и `files_modify`) → `automated_tests`, `verification_commands`, `manual_verification` → `set ID DONE --evidence "…"` (или IN_REVIEW) → запись в свой раздел PROGRESS.md → коммит по CLAUDE.md §13. Push и PR — только если пользователь просит.
6. Блокер — по CLAUDE.md §6 (с запасным путём из поля `fallback`), затем следующая доступная задача.
7. В конце — отчёт: сделано, чем проверено (команды и фактический вывод), что осталось, блокеры, следующие задачи.
