# Стратегия тестирования

Владельцы: каждый — тесты своих модулей; MEMBER_A — CI и сквозные проверки; MEMBER_D — научные эксперименты движка; MEMBER_C — освещение и рельеф целей. Тесты пишутся вместе с кодом, с 14.11 09:00.

## 1. Уровни

| Уровень | Что проверяет | Инструмент | Где | Когда запускается |
| --- | --- | --- | --- | --- |
| Модульные | Формулы и краевые случаи | pytest, Vitest | `pipeline/**/tests/`, `web/src/**/*.test.ts` | Каждый коммит (`make test`) |
| Аналитические научные | Функции на поверхностях с известным ответом | pytest | `test_terrain.py`, `test_shadows.py` | Каждый коммит |
| Эталонные | Солнце против astropy (E1) | pytest + astropy | `test_sun.py -k reference` | Каждый коммит (быстрый набор) |
| Контрактные | Каждый JSON в `data/processed/` и `data/fixtures/` проходит схему; нет синтетики в processed | `python -m pipeline.contracts.validate` | `make check` | Каждый PR |
| Golden (P1) | Python и TypeScript дают одинаковые F и кампании | Vitest на `data/fixtures/golden_*.json` | `web/src/lib/*.test.ts` | Каждый PR |
| Интеграционные | Движок от фикстур до `results.json` и `validation.json` | pytest | `pipeline/engine/tests/test_run.py` | Каждый PR |
| Воспроизводимость (E10) | Два запуска дают одинаковые байты | `make data && sha256sum` дважды | INFRA-06 | IC-2, IC-3 |
| Производительность | Бюджеты FINAL_ARCHITECTURE §4 | Vitest-бенчмарк, DevTools, Lighthouse | WEB-11, QA | IC-3 |
| Сквозные (ручные) | Сценарий S1 → S2 → S3 → S6 на прод-ссылке | Чек-лист | INTEGRATION_STATUS | IC-1, IC-2, IC-3 |
| Офлайн | Сборка без сети | `npx serve web/dist` при выключенном Wi‑Fi | QA-03 | Вс до 12:00 |
| Научные эксперименты | E1–E10 | Скрипты VAL-* | VALIDATION_PROTOCOL | По плану |

## 2. Минимальный набор P0 (должен быть зелёным к IC-3)

1. `test_terrain.py` — плоскость 10°, горизонтальная плоскость, NaN, доля уклонов, TRI.
2. `test_sun.py` — E1 на 7 широтах × 4 даты; H_low на экваторе; симметрия полушарий.
3. `test_fidelity.py` — все функции §6; геометрическое среднее; правила пропусков и ограничений.
4. `test_campaign.py` — E4: точный перебор против `itertools` на 100 задачах; жадный ≥ 63 % оптимума; правило совпадений; детерминированность.
5. `test_validate.py` — схемы, версии, запрет синтетики.
6. `test_pool.py`, `test_units.py`, `test_gee_terrain.py`, `test_crosscheck.py` — ID (включая `PR_` и `CT_`), размер квадрата, зоны UTM, пересчёт единиц, сверка E2b на сохранённом примере.
6a. `test_validate_practice.py`, `test_controls.py` — E3 на синтетике с известным рангом; E7: контроль не в топ-5 %, ограничения срабатывают, seed воспроизводит числа.
7. `test_access.py` — центр окна и квадратный пиксель на синтетическом GeoTIFF.
8. `test_run.py` — фикстуры → валидный `results.json`; повторный запуск идентичен.
9. Vitest: `load.ts` (ошибки версии, синтетика), store (смена цели сбрасывает выбор площадки), кнопка Brief.
10. `npm run typecheck`, `npm run build`, `ruff check pipeline`, `python3 tools/tasks.py validate`.

## 3. Что не тестируем автоматически и почему

| Что | Почему | Чем заменяем |
| --- | --- | --- |
| Вызовы Earth Engine | Нужны учётные данные и сеть | Сверка 3 квадратов с Python (E2b), отметка в PROGRESS |
| Реальное чтение PGDA и USGS | Сеть и объём | Синтетический GeoTIFF + ручная проверка спайка PLNT-01 |
| Визуальное качество | Субъективно | Тест на свежем пользователе (QA-02), скриншоты в PR |
| Браузерные E2E (Playwright) | Мало времени на настройку | Ручной чек-лист IC; Playwright — только при свободном времени |

## 4. CI (INFRA-04)

```text
on: pull_request, push to main
jobs: python (3.11): pip install -r requirements.txt → ruff → pytest -q → python3 tools/tasks.py validate
      → python -m pipeline.contracts.validate data/processed/*.json data/fixtures/*.json
      web (Node LTS): npm --prefix web ci → typecheck → vitest --run → build
      secrets: grep -rE "AIza|-----BEGIN|ghp_|\"private_key\"" (кроме docs/) → падение при совпадении
```

Падение любой проверки блокирует слияние. До INFRA-04 те же проверки запускаются локально командой `make check`.

## 5. Определение «тест пройден» для доказательств

В `actual_evidence` задачи пишем фактический вывод: «pytest pipeline/engine -q: 23 passed», хэш коммита, ссылку на прогон CI. Фраза «тесты проходят» без вывода доказательством не считается.
