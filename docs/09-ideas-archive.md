# 09 · Архив идей

Всё, что обсуждали до выбора темы. Перенесено из гугл-дока и чата, ничего не потеряно.

## Челленджи, которые рассматривали

| # | Челлендж | Суть | Статус |
| --- | --- | --- | --- |
| 1 | [CLPS Lunar Mission Browser](https://www.spaceappschallenge.org/2026/challenges/clps-lunar-mission-browser/) | Инструмент для анализа мест посадки на Луну с учётом освещённости, рельефа и т. д. | Не выбран |
| 2 | [Be an Earth System Trend Detective](https://www.spaceappschallenge.org/2026/challenges/be-an-earth-system-trend-detective/) | Поиск и визуализация трендов в экосистеме Земли (изменение рельефа, таяние льдов и т. д.) по данным спутников NASA | Не выбран |
| 3 | [Abandoned but not Forgotten](https://www.spaceappschallenge.org/2026/challenges/abandoned-but-not-forgotten-storytelling-about-nasas-discarded-equipment-on-the-moon-and-mars/) | Интерактивная карта-история оборудования NASA на Марсе и Луне | Не выбран |
| 4 | [Build a Junior Astronaut Mission Trainer](https://www.spaceappschallenge.org/2026/challenges/build-a-junior-astronaut-mission-trainer/) | Игра-симулятор базы на Луне или Марсе с учётом ресурсов и внешней среды | Не выбран |
| 5 | Предложения Алима | Dancing with the SARs; Identify Earth Locations…; Be an Earth System Trend Detective | Выбран второй вариант |
| 6 | [Identify Earth Locations that Analog the Permanent Moon Base Locations and Mars](https://www.spaceappschallenge.org/2026/challenges/identify-earth-locations-that-analog-the-permanent-moon-base-locations-and-mars/) | Земные аналоги мест для баз на Луне и Марсе | **Выбран** |

Ещё предлагали в чате: [Field Shift: Adapting Farms with NASA Data](https://www.spaceappschallenge.org/2026/challenges/field-shift-adapting-farms-with-nasa-data/), [Harmonization of MODIS and VIIRS Hot Spots](https://www.spaceappschallenge.org/2026/challenges/harmonization-of-modis-and-viirs-hot-spots/), [The Earth Information Jukebox](https://www.spaceappschallenge.org/2026/challenges/the-earth-information-jukebox/).

**Идея jukebox:** данные превращаются в звук, например температура → тон музыки, химический состав минерала → аккорд. Это идея для челленджа The Earth Information Jukebox, в наш проект не берём.

## Брейншторм: что учитывать при сравнении

| Идея | Решение |
| --- | --- |
| Ландшафт: пески, болото, кратер, реголит, угол наклона | Берём: уклоны, рельеф, тип поверхности |
| Температуры: амплитуды, радикальность, стабильность | Берём: минимум, максимум, амплитуда по MODIS |
| Полярные области: радикальные температуры и отсутствие солнца | Берём: угол солнца по широте и сезону, важно для Луны |
| Скорость и постоянство ветров | Если останется время, по данным ERA5 |
| Доступность: логистика, отсутствие войн и т. п. | Берём как фильтр |
| Катаклизмы: извержения вулканов и т. п., их частота и серьёзность | Только как фильтр безопасности |
| Эвапориты в Мангистау похожи на хлоридные отложения на Марсе — подходят для теста проходимости по солёным коркам | **Главный сюжет проекта** |
| Добавить Венеру и спутники планет | Не берём: вне задания |
| Поиск мест для запусков: близость к экватору, логистика | Не берём: другая задача |
| Обучающие симуляции для школьников | Максимум режим «история» в конце, если останется время |
| Экстремальные условия под землёй: температура около 300 °C, давление около 100 атм | Не берём: это не аналоги поверхности |
| Тестить необычные месторождения | Обсудить с геологом |

## Ссылки из чата

- [Топография Марса по данным MOLA (Astronet)](https://www.astronet.ru/db/msg/1169655)
- [A Solar Tale](https://a-solar-tale.netlify.app/) — получили приз за сторителлинг
- [HerCode Space](https://www.spaceappschallenge.org/2025/find-a-team/hercode-space/?tab=project) — пример проекта 2025
