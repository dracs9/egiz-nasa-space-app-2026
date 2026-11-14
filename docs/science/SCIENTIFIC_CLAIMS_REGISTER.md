# Реестр научных утверждений

Владелец: MEMBER_E (подпись), MEMBER_F (тексты подачи). Утверждение попадает в слайды, на страницу проекта, в видео или интерфейс только из этой таблицы и только со статусом «подтверждено». Статус меняется после эксперимента, с доказательством. Сейчас (10.10.2026) все утверждения — «запланировано»: ничего ещё не посчитано.

| ID | Точная формулировка (EN, для подачи) | Доказательство | Тест | Критерий | Альтернативные объяснения | Ограничения | Статус |
| --- | --- | --- | --- | --- | --- | --- | --- |
| C1 | “Terrain is compared on the same baselines NASA uses for Artemis landing (100 m) and EVA (2 km) slope criteria, with one function for Earth, Moon and Mars.” | Код `terrain.py`; параметры в `provenance` | E2 | E2 пройден | — | Марс — 400 м: тоньше глобальных данных нет | запланировано |
| C2 | “Our solar geometry matches a reference ephemeris to within 0.1°.” | `validation.json` → E1 | E1 | max\|Δh\| ≤ 0,1° | — | Для h > 1° | запланировано |
| C3 | “For objectives whose site-selection rationale is captured by our attributes, sites documented as NASA/agency analogs rank in the top X % of N candidates (median), beating an aridity-only baseline.” | `validation.json` → E3 | E3 | По H3 | Пул смещён к пустыням; документированные площадки известны благодаря доступности | Малая выборка; геология вне оценки | запланировано |
| C4 | “The campaign optimizer returns the exact optimum within a shortlist that includes every objective's top 20 candidates, verified against greedy search over all N candidates.” | E4; поле `method` в `campaigns` | E4 | 100 % совпадений с полным перебором | — | Не «глобальный оптимум» | запланировано |
| C5 | “No single Earth site covers all objectives for [target]; the best k-site campaign reaches coverage C.” | `results.json` → campaigns | расчёт | Число из файла | Зависит от допусков | Покрытие ≠ пригодность | запланировано |
| C6 | “Natural low-sun windows exist on Earth: at [site], the Sun stays between 0° and h_max for H hours/day in [months].” | `sun_windows` | E1 + LIGHT-02 | Расчёт проверен E1 | Атмосфера рассеивает свет | Без учёта снега в P0 | запланировано |
| C7 | “No ice-free land site reproduces the full lunar south-pole regime (low Sun circling 360°).” | Потолок атрибута освещения | §5.3, §9 спецификации | ceil < порога на суше | Модель без рельефа горизонта | Гипотеза H-L2 | запланировано |
| C8 | “Terrain shadow fractions at the same Sun elevation differ from [target] by Δ at [site].” | `shadows` (P1) | E8 | Аналитические тесты пройдены | Ближние преграды только в окне | P1 | запланировано |
| C9 | “Earth cannot reproduce: vacuum, 0.165 g, radiation, permanently shadowed cold (< −230 °C); these require [alternatives].” | `gap_alternatives.csv` с источниками | проверка ссылок | Ссылки проверены MEMBER_E | — | Список не исчерпывающий | запланировано |
| C10 | “Recommendations are stable: lead sites are selected in ≥ 60 % of 200 perturbed runs.” | E5 | E5 | По гипотезе E5 | — | P1 | запланировано |
| C11 | “All results are reproducible from public data with `make data`; outputs are byte-identical across runs.” | E10; README | E10 | Хэши совпали | — | Часть Земли требует аккаунт GEE | запланировано |
| C12 | “Negative controls behave as expected: none of [n] forest, cropland or glacier control tiles ranks in the top 5 % for any objective.” | `validation.json` → E7, `controls` | E7 (VAL-02) | Гипотеза E7 (a) | Контроли «лёгкие» — не доказывают, что метод различает похожие пустыни (это делает только E3) | Сравнение «оптимальная кампания против случайных» — проверка здравого смысла, выполняется по построению; утверждением не является | запланировано |

## Запрещённые формулировки

- «Площадка X эквивалентна Луне или Марсу», «пригодна для испытаний» без полевой проверки.
- «Точность N %», «модель предсказывает…» — у нас нет предсказательной модели с разметкой.
- «Впервые в мире». Допустимо: «we did not find a published method that…».
- Любые числа, которых нет в `results.json` или `validation.json`.
