> **АРХИВ v1 (10.10.2026).** Документ заменён планом v2 и не является руководством к действию. Актуальные документы — см. [CLAUDE.md](../../../CLAUDE.md). Номера задач здесь относятся к старому реестру `tasks_v1.json` и в новом реестре не действуют.

# Данные: источники, доступ, лицензии

Владельцы: MEMBER_B (Земля), MEMBER_C (Луна и Марс), MEMBER_E (курируемые источники). Статус: инвентаризация для подготовки. Полный список ресурсов челленджа выйдет 28.10 — сверить в RULE-01. Скачивать и обрабатывать данные для проекта — только с 14.11 09:00.

## 1. Принципы

- Настоящие данные NASA важнее синтетики. Синтетика допустима только как фикстура с пометкой (`synthetic: true`, id `FAKE_`).
- Не скачиваем глобальные файлы: Земля считается в облаке GEE, Луна и Марс — окнами из удалённых GeoTIFF/COG. 11-гигабайтный DEM Марса по школьному Wi‑Fi не скачается.
- Для каждого набора фиксируем ID, версию, период и роль в `provenance` выходного JSON и в `submission/references.md`.
- Пропуски — `null`. Нет покрытия — честно пишем.
- Признаки и их определения — [SCIENTIFIC_METHODOLOGY §3](SCIENTIFIC_METHODOLOGY.md).

## 2. Земля (MEMBER_B, Google Earth Engine)

| Набор | Чей | ID в GEE | Покрытие, разрешение | Роль | Приоритет |
| --- | --- | --- | --- | --- | --- |
| Copernicus DEM GLO-30 | ESA (партнёр) | `COPERNICUS/DEM/GLO30` | весь мир, 30 м | Рельеф, основной (DEC-007) | P0 |
| NASADEM | NASA | `NASA/NASADEM_HGT/001` | 60° с. ш.…56° ю. ш., 30 м | Перекрёстная проверка рельефа | P1 |
| MODIS LST 8-day, Terra и Aqua | NASA | `MODIS/061/MOD11A2`, `MODIS/061/MYD11A2` | весь мир, 1 км, с 2000/2002 | `t_min_c`, `t_max_c` | P0 |
| GPM IMERG V07 monthly | NASA, JAXA | `NASA/GPM_L3/IMERG_MONTHLY_V07` | 0,1°; качество у полюсов ниже — проверить покрытие | `precip_mm` | P0 |
| ESA WorldCover v200 (2021) | ESA (партнёр) | `ESA/WorldCover/v200` | суша, 10 м; Антарктида — проверить | `bare_frac`, контекст | P0 |
| MODIS Land Cover | NASA | `MODIS/061/MCD12Q1` | весь мир, 500 м | `bare_frac` вне покрытия WorldCover | P0 |
| MODIS NDVI 16-day | NASA | `MODIS/061/MOD13Q1` | 250 м | `ndvi_max` | P1 |
| GPW v4.11 population density | NASA SEDAC (CIESIN) | `CIESIN/GPWv411/GPW_Population_Density` | 30″ | Справка об удалённости | P2 |
| VIIRS Black Marble | NASA | `NASA/VIIRS/002/VNP46A2` — проверить ID | 500 м | Справка об удалённости | P2 |
| ASTER Global Emissivity | NASA, METI | `NASA/ASTER_GED/AG100_003` | 100 м | Идея: состав пород по тепловому ИК | P3 |
| EMIT L2B минералы | NASA (на МКС) | нет в GEE; LP DAAC, NetCDF, 60 м, 52° с. ш.…52° ю. ш. | 10 минералов; идёт переход на версию 2 | Идея: минералогические аналоги | P3 |
| Landsat 8/9 | NASA, USGS | `LANDSAT/LC09/C02/T1_L2` и др. | 30 м, с 1980-х (серия) | Идея: история Арала для рассказа | P3 |

ID наборов в GEE проверяем по каталогу при EARTH-02/03 и записываем фактическую версию.

## 3. Луна (MEMBER_C)

| Набор | Чей | Доступ | Что даёт | Приоритет |
| --- | --- | --- | --- | --- |
| LOLA, полярные DEM | NASA LRO | [PDS Geosciences LOLA](https://pds-geosciences.wustl.edu/missions/lro/lola.htm), [PGDA](https://pgda.gsfc.nasa.gov/) | Рельеф целей у южного полюса; продукт и разрешение выбрать в PLNT-01 | P0 |
| LOLA, глобальный DEM | NASA LRO | [USGS Astropedia](https://astrogeology.usgs.gov/search) | Цели вне полюса (только для валидации, например Apollo 15) | P1 |
| Карты освещённости южного полюса | NASA (Mazarico et al., 2011) | PGDA | Справка для досье; наш признак освещённости считается моделью | P2 |
| Diviner, температуры поверхности | NASA LRO, UCLA | [Diviner](https://www.diviner.ucla.edu/), [PDS](https://pds-geosciences.wustl.edu/missions/lro/diviner.htm) | `t_min_c`, `t_max_c` целей (курирует MEMBER_E) | P0 |
| Районы базы и посадки у южного полюса | NASA | [9 районов (окт. 2024)](https://www.nasa.gov/news-release/nasa-provides-update-on-artemis-iii-moon-landing-regions/), [Moon Base FAQ](https://www.nasa.gov/moon-base-frequently-asked-questions/) | Список целей Луны | P0 |
| LROC WAC мозаика | NASA LRO | [Moon Trek](https://trek.nasa.gov/moon/) | Подложка и картинки для слайдов | P2 |
| ShadowCam (NASA на корейском KPLO) | NASA, KASA (партнёр 2026) | [ShadowCam](https://shadowcam.sese.asu.edu/) | Снимки затенённых областей для рассказа | P3 |
| Chandrayaan-2 OHRC и TMC | ISRO (партнёр) | [PRADAN](https://pradan.issdc.gov.in/) | Снимки южного полюса для рассказа | P3 |

## 4. Марс (MEMBER_C)

| Набор | Чей | Доступ | Что даёт | Приоритет |
| --- | --- | --- | --- | --- |
| MOLA/HRSC blended DEM 200 м, v2 | NASA MGS + ESA Mars Express, USGS | [Astropedia](https://astrogeology.usgs.gov/search/map/mars_mgs_mola_mex_hrsc_blended_dem_global_200m); GeoTIFF ≈ 11 ГБ, 106 694 × 53 347 px, простая цилиндрическая проекция | Рельеф целей Марса | P0 |
| MOLA MEGDR 128 ppd (~463 м) | NASA | [PDS Geosciences MGS](https://pds-geosciences.wustl.edu/missions/mgs/megdr.html) | Запасной рельеф (уровень 2 лестницы) | P0 (запас) |
| CTX DTM | NASA MRO, USGS | [USGS STAC](https://stac.astrogeology.usgs.gov/) (COG) | Запасной рельеф отдельных мест (уровень 3) | P2 |
| Mars SWIM, карты льда | NASA (PSI) | [swim.psi.edu](https://swim.psi.edu/) | Флаг льда для Arcadia Planitia | P1 |
| Карта хлоридов | Osterloo et al. (2008, 2010) | статьи | Цель Terra Sirenum, флаг солей | P0 |
| Mars Climate Database | LMD, ESA, CNES | [MCD](https://www-mars.lmd.jussieu.fr/) | Температура поверхности целей (курирует MEMBER_E) | P0 |
| Тепловая инерция (TES, THEMIS) | NASA | PDS | Идея: рыхлый грунт или скала | P3 |
| Emirates Mars Mission (EMIRS) | MBRSC, ОАЭ (партнёр) | [EMM SDC](https://sdc.emiratesmarsmission.ae/) | Идея: температуры поверхности | P3 |
| Места высадки людей (2015) | NASA | [Exploration Zones Workshop](https://www.hou.usra.edu/meetings/explorationzone2015/) | Обоснование целей Марса | P1 |
| Mars Trek | NASA JPL | [trek.nasa.gov/mars](https://trek.nasa.gov/mars/) | Картинки для слайдов | P2 |

## 5. Эталоны и справочники (MEMBER_E)

| Источник | Что берём |
| --- | --- |
| [NASA Planetary Analog Explorer](https://science.nasa.gov/solar-system/analog-explorer/) | 11 пар, из них 9 с Луной и Марсом: лавовые пещеры Калифорнии; Долина Смерти ↔ Utopia Planitia (Viking 2); Килауэа ↔ базальты Луны (Apollo 15); Турция (озеро Салда) ↔ Марс; Юта (Pilot Valley) ↔ Марс; Аризона ↔ Марс; Атакама ↔ Марс; Исландия ↔ лёд Луны; Исландия (Викурсандур) ↔ рябь Марса |
| Страницы аналоговых миссий NASA, тренировок Apollo и Artemis | Дополнительные пары для валидации (SCI-03) |
| Программа ESA PANGAEA (Лансароте и др.) | Пары от агентства-партнёра |
| [Earth Impact Database](http://www.passc.net/EarthImpactDatabase/) | Ударные кратеры Земли (Жаманшин, Рис, Хотон, Метеоритный кратер) |
| [Global Volcanism Program](https://volcano.si.edu/) | Вулканы: безопасность и вулканические аналоги |
| Геологические карты и статьи по Казахстану | Теги второго этапа и досье |

## 6. Подложки для сайта

| Подложка | Чей | Как |
| --- | --- | --- |
| NASA GIBS (Blue Marble, VIIRS или MODIS true color) | NASA | WMTS в EPSG:3857 для MapLibre; [документация](https://nasa-gibs.github.io/gibs-api-docs/) |
| Moon Trek, Mars Trek | NASA JPL | Картинки для слайдов; в MVP Луна и Марс показываются нашими картинками окон, не тайлами |

## 7. Данные агентств-партнёров 2026

Партнёры 2026 года: Ангола, Аргентина (CONAE), Бахрейн, Бразилия (AEB), Канада (CSA), ESA, Индия (ISRO), Италия (ASI), Япония (JAXA), Корея (KASA), Нигерия (NASRDA), Парагвай, Сенегал, Испания, Турция (TUA), ОАЭ (MBRSC), Великобритания (UKSA) — [список](https://www.spaceappschallenge.org/2026/space-agency-partners/). Казахстана среди них нет. В наших планах уже есть данные ESA (Copernicus DEM, WorldCover, HRSC в DEM Марса) и JAXA (вклад в GPM). Пары с аналогами в Турции (озеро Салда) и Испании (Рио-Тинто, Лансароте) связывают проект с партнёрами TUA и Испанского космического агентства — только если они проходят правила §6.2 методики.

## 8. Доступы (заводятся до 14.11 — PREP-04)

| Сервис | Зачем | Кто |
| --- | --- | --- |
| [NASA Earthdata Login](https://urs.earthdata.nasa.gov/) | Скачивание данных NASA (LP DAAC, PDS-зеркала) | A, B, C, D |
| [Google Earth Engine](https://earthengine.google.com/) | Расчёты по Земле в облаке; некоммерческий проект, Community tier | B, запасной — A |
| [USGS Astrogeology STAC](https://stac.astrogeology.usgs.gov/) | Поиск COG Луны и Марса | C, без регистрации |
| Запас без аккаунта | [Microsoft Planetary Computer](https://planetarycomputer.microsoft.com/) и [Copernicus DEM на AWS Open Data](https://registry.opendata.aws/copernicus-dem/) | B, если GEE недоступен |

## 9. Лицензии и атрибуция

| Набор | Условия | Как указываем |
| --- | --- | --- |
| Данные NASA (MODIS, GPM, NASADEM, LOLA, MOLA, Diviner, GIBS) | Открытые, без ограничений на использование | Название набора, «NASA», ссылка |
| Copernicus DEM | Бесплатно с обязательной атрибуцией | Формулировка из лицензии Copernicus DEM (проверить в SUB-03) |
| ESA WorldCover | CC BY 4.0 | «© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021)» — сверить с сайтом |
| GPW v4.11 | CC BY 4.0 | CIESIN, NASA SEDAC |
| Библиотеки | MIT, BSD, Apache-2.0 (проверить каждую) | `submission/references.md` |

Правила NASA требуют цитировать каждый источник, даже открытый, и указать лицензии сторонних материалов; иначе могут снять награду ([Terms & Conditions 2026](https://www.spaceappschallenge.org/legal/)).

## 10. Воспроизводимость

1. Скрипты конвейера идемпотентны и запускаются из Makefile (`make earth`, `make data`).
2. Каждый выходной JSON содержит `provenance` и `generated_at`; `results.json` — хэши входных файлов.
3. Обработанные маленькие JSON лежат в git (`data/processed/`), чтобы жюри могло проверить сайт без аккаунта GEE.
4. Окна DEM кэшируются в `data/raw/` (не в git) с именем, включающим продукт и цель.
