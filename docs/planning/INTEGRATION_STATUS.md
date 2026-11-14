# Статус интеграции

Ведёт MEMBER_A. Обновляется на каждой контрольной точке и при каждом изменении контракта (протокол — DEVELOPMENT_WORKFLOW §7). Описание интерфейсов — [API_AND_SCHEMA_CONTRACTS](../engineering/API_AND_SCHEMA_CONTRACTS.md) и [FUNCTION_SPECIFICATIONS](../engineering/FUNCTION_SPECIFICATIONS.md).

## 1. Интерфейсы

Статусы: План → Черновик → v1 заморожен → Изменяется (с номером версии) → Стабилен.

| Интерфейс | Производитель | Потребители | Версия | Статус | Задачи |
| --- | --- | --- | --- | --- | --- |
| `contracts/earth_candidates.schema.json` → `data/processed/earth_candidates.json` | A (схема), B (данные) | D, A, B (Evidence) | — | План | INFRA-02, EARTH-04 |
| `contracts/targets.schema.json` → `targets.json` | A, C | D, A, C (панели) | — | План | INFRA-02, PLNT-03 |
| `contracts/mission_templates.schema.json` → `mission_templates.json` | A, D (из CSV E) | D, A, C | — | План | INFRA-02, ENG-01, SCI-02 |
| `contracts/sun_windows.schema.json` → `sun_windows.json` (по широтным полосам) | A, C | D, D (панель площадки) | — | План | INFRA-02, LIGHT-02 |
| `contracts/results.schema.json` → `results.json` | A, D | A (карта), C (панели), D (панель площадки), E, F | — | План | INFRA-02, ENG-03 |
| `contracts/validation.schema.json` → `validation.json` | A, D | B (Evidence), E (подпись), F (тексты), C (README) | — | План | INFRA-02, VAL-01, VAL-02 |
| P1: `shadows.json`, `robustness.json`, `img/twin/manifest.json` | C, D | A (Twin), B (Evidence) | — | План | LIGHT-03, LIGHT-04, VAL-03 |
| `pipeline/common/terrain.py` → `terrain_attributes(z, p, fine_offset, regional_baseline_m)` | D | B (сверка E2b), C (цели) | — | План | TERR-01 |
| `pipeline/common/sun.py` → `sun_position`, `lowsun_windows`, `h_max_moon` | C | C, D (через sun_windows) | — | План | LIGHT-01 |
| `pipeline/common/shadows.py`, `render.py` (P1) | C | C | — | План | LIGHT-03, LIGHT-04 |
| `web/src/types/contracts.ts` | A | A, B, C, D | — | План | INFRA-02 |
| Store `AppState` (`web/src/state/store.ts`) | A | B, C, D, F | — | План | WEB-01 |
| `web/src/lib/*.ts`, протокол воркера (P1) | D | A, C | — | План | ENG-05, WEB-09 |
| `data/curated/*.csv` (колонки — DATASET_SPECIFICATION §5) | E | B, C, D | — | План | SCI-01…SCI-04 |
| `web/src/content/copy.json` (P1) | F | A, B, C, D | — | План | STORY-02 |

## 2. Контрольные точки

### IC-0 · Готовность к старту (13.11, RULE-04)

- [ ] `python3 tools/tasks.py validate` без ошибок на 6 ноутбуках
- [ ] Аккаунты Earthdata, Earth Engine, Vercel работают; доступ к Vercel у C и D
- [ ] Ответы организаторов учтены (OFFICIAL_RULES §7, PRE_EVENT_AUTHORIZATION §4); сценарий записан (DEC-024)
- [ ] Все прочитали CLAUDE.md, свой MEMBER_X.md и HOUR_BY_HOUR_EXECUTION

### IC-1 · Сквозной срез (Сб 17:30)

- [ ] Контракты v1 заморожены (время и хэш: ___)
- [ ] Коммит пререгистрации раньше первого запуска VAL-01 (хэши: ___)
- [ ] `earth_candidates.json`, `targets.json`, `sun_windows.json`, `mission_templates.json` проходят валидатор, `synthetic: false`
- [ ] `results.json` хотя бы для Mons Mouton × MOON_BASE_OPS; кампания k = 1…3 и разрывы видны на прод-ссылке
- [ ] `make check` зелёный на `main`
- [ ] Решение по вечеру: S1 или S2 (ворота G-F) — ___
- [ ] Что не вошло и кто доделывает: ___

### IC-2 · Научное ядро (S1: Вс 09:30; S2: Сб 22:30)

- [ ] Обе P0-цели в `targets.json`; `results.json` для обеих целей
- [ ] `validation.json` с хэшем пререгистрации; E1, E2, E3, E4, E7 со статусами
- [ ] Научная проверка кандидатов (SCI-05) записана в PROGRESS.md
- [ ] План до IC-3 опубликован в #general

### IC-3 · Заморозка функций (Вс 11:00)

- [ ] Все ветки с функциями слиты; новые функции больше не принимаются
- [ ] `make check` зелёный на `main`; `sha256sum data/processed/*` записан ниже
- [ ] Сквозной сценарий на прод-ссылке: Brief → Campaign → площадка → Evidence (P1: Twin), без ошибок в консоли
- [ ] Chrome, Firefox, Safari и один телефон
- [ ] Нет `synthetic: true` и `FAKE_` в `data/processed/`
- [ ] Все P0, кроме подачи, в DONE или сняты решением в DECISIONS.md (ворота G-H)

### Релиз (Вс 13:00)

- [ ] Тег `v1.0` на `main`; прод-ссылка показывает тег; офлайн-комплект собран из тега

## 3. Журнал

| Время | Точка или событие | Результат | Кто |
| --- | --- | --- | --- |
| 10.10.2026 | План интеграции v1 | Интерфейсы определены в архивном SYSTEM_ARCHITECTURE | планирование |
| 10.10.2026 | План интеграции v2 | Интерфейсы переписаны под Egiz v2 (кампания, базы NASA, окна по широтам, E7) | планирование |
