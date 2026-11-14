---
name: "source-command-integration-check"
description: "Проверка интеграции по чек-листу INTEGRATION_STATUS.md (IC-0…IC-3)"
---

# source-command-integration-check

Use this skill when the user asks to run the migrated source command `integration-check`.

## Command Template

Проведи проверку интеграции.

1. Прочитай AGENTS.md и docs/planning/INTEGRATION_STATUS.md; определи ближайшую контрольную точку (IC-0…IC-3) по времени (`python3 tools/tasks.py next` — первая строка) и статусам (`python3 tools/tasks.py status`).
2. Выполни доступные проверки и запиши фактический вывод команд:
   - `python3 tools/tasks.py validate` и `python3 tools/tasks.py render --check`;
   - после INFRA-01: `make check`;
   - после INFRA-02: `python -m pipeline.contracts.validate data/processed/*.json data/fixtures/*.json`;
   - нет ли `"synthetic": true` или `FAKE_` в data/processed/;
   - совпадают ли версии контрактов у производителей и потребителей (INTEGRATION_STATUS §1);
   - для IC-3: `sha256sum data/processed/*` и сквозной сценарий на прод-ссылке (попроси пользователя открыть ссылку, если нет браузера).
3. До старта хакатона — только IC-0 (готовность к старту) и проверка реестра; код и данные не создавай.
4. Отчёт: что прошло, что упало (с выводом команд), кто владелец исправления, сработали ли ворота CONTINGENCY_PLAN §2. Предложи обновить INTEGRATION_STATUS.md и сделай это, если пользователь согласен.
