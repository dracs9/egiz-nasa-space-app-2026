# Спецификация наборов данных

Владельцы: MEMBER_B (Земля), MEMBER_C (Луна, Марс), MEMBER_E (курируемые таблицы). Проверено по каталогам и страницам продуктов 10.10.2026. Фактические версии фиксируются в `provenance` выходных JSON. Скачивание и обработка — только с 14.11 09:00, если организаторы не разрешили раньше (PRE_EVENT_AUTHORIZATION, AUTH-01). Сверка со списком ресурсов полного условия — RULE-01.

## 1. Луна (MEMBER_C)

| Набор | Поставщик | Доступ | Покрытие и разрешение | Ед. и формат | Роль | Приоритет | Запасной путь |
| --- | --- | --- | --- | --- | --- | --- | --- |
| High-Resolution LOLA Topography for Lunar South Pole Sites | NASA GSFC PGDA (Barker et al., 2021) | [product 78](https://pgda.gsfc.nasa.gov/products/78), каталог [LOLA_5mpp](https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/) | Участки 20×20 км: 01 Connecting ridge, 04 Shackleton rim, 07 Peak near Shackleton, 11 de Gerlache rim, 20 Leibnitz beta plateau (Mons Mouton), 23 Malapert massif; 5 м/пиксель | Высота, м; GeoTIFF, полярная стереографическая, MOON_ME/DE421; также уклон, неопределённость, 100 клонов | Рельеф целей Луны (P0: участок 20; P1: 23, 11, 01) | P0 | Мозаика 20 м/пиксель 80–90° ю. ш. (COG, [product 81](https://pgda.gsfc.nasa.gov/products/81)) |
| South Pole LOLA DEM Mosaic | NASA GSFC PGDA | product 81 | 87–90° ю. ш. 5 м/пиксель (~3,3 ГБ); 80–90° ю. ш. 20 м/пиксель (COG) | GeoTIFF | Запас и контекст | P1 | — |
| Lunar Polar Illumination | NASA GSFC PGDA (Mazarico et al., 2011) | [product 69](https://pgda.gsfc.nasa.gov/products/69) | Полярные карты освещённости | — | Сверка модуля теней (LIGHT-05) | P2 | Значения из статей и product 78 |
| Diviner (температура поверхности) | NASA LRO, UCLA | [Diviner](https://www.diviner.ucla.edu/), [PDS](https://pds-geosciences.wustl.edu/missions/lro/diviner.htm) | Глобально и полярные продукты | K → °C | Курируемые `t_min_c`, `t_max_c` целей (SCI-04) | P0 (значения из литературы) | Значения из статей (Paige et al., 2010; Williams et al., 2017) |
| Кандидатные районы и требования | NASA | [9 районов, 2024](https://www.nasa.gov/news-release/nasa-provides-update-on-artemis-iii-moon-landing-regions/); [NTRS 20250009323](https://ntrs.nasa.gov/citations/20250009323) | — | — | Список целей и пороги задач | P0 | — |

## 2. Марс (MEMBER_C)

| Набор | Поставщик | Доступ | Покрытие и разрешение | Роль | Приоритет | Запасной путь |
| --- | --- | --- | --- | --- | --- | --- |
| MOLA/HRSC blended DEM v2 | NASA MGS + ESA Mars Express, USGS (Fergason et al., 2018) | [Astropedia](https://astrogeology.usgs.gov/search/map/mars_mgs_mola_mex_hrsc_blended_dem_global_200m) | Глобально, 200 м/пиксель, ≈ 11 ГБ, простая цилиндрическая, 106 694 × 53 347 | Рельеф целей Марса (P0: Jezero; P1: Gale, Utopia VL2, Terra Sirenum) | P0 | MOLA MEGDR 128 ppd (~463 м, [PDS](https://pds-geosciences.wustl.edu/missions/mgs/megdr.html)); CTX DTM ([USGS STAC](https://stac.astrogeology.usgs.gov/)) |
| Mars Climate Database | LMD, ESA, CNES | [MCD](https://www-mars.lmd.jussieu.fr/) | Модель | Курируемые температуры поверхности целей | P0 (значения) | Измерения роверов из статей |
| SWIM (лёд), хлориды | NASA / PSI; Osterloo et al., 2008 | [swim.psi.edu](https://swim.psi.edu/); статьи | — | Флаги целей P1 | P1 | — |

## 3. Земля (MEMBER_B, Google Earth Engine)

| Набор | Поставщик | ID в GEE | Разрешение и период | Масштаб и единицы | Роль | Приоритет |
| --- | --- | --- | --- | --- | --- | --- |
| Copernicus DEM GLO-30 | ESA (партнёр) | `COPERNICUS/DEM/GLO30`, полоса `DEM` | 30 м, глобально | м | Рельеф, ступени A и B; окна 30 м для теней | P0 |
| NASADEM | NASA | `NASA/NASADEM_HGT/001`, `elevation` | 30 м, 60° с. ш.…56° ю. ш. | м | Перекрёстная проверка (EARTH-09) | P2 |
| MODIS LST 8-day Terra и Aqua | NASA | `MODIS/061/MOD11A2`, `MODIS/061/MYD11A2` | 1 км, 2015–2024 | × 0,02 → K; − 273,15 → °C | `t_min_c`, `t_max_c` | P0 |
| GPM IMERG V07 monthly | NASA, JAXA | `NASA/GPM_L3/IMERG_MONTHLY_V07`, `precipitation` | 0,1°, 2001–2024 | мм/ч × часы месяца | `precip_mm` | P0 |
| ESA WorldCover v200 | ESA (партнёр) | `ESA/WorldCover/v200` | 10 м, 2021 | классы 10, 40, 50, 60, 70, 80 | `bare_frac` и контекст | P0 |
| MODIS Land Cover | NASA | `MODIS/061/MCD12Q1`, `LC_Type1` | 500 м | класс 16 — barren | `bare_frac` вне WorldCover (полярные районы) | P0 |
| MODIS Snow Cover daily | NASA | `MODIS/061/MOD10A1`, `NDSI_Snow_Cover` | 500 м, 2001–2024 | NDSI 0–100 | `snow_free_frac[m]` | P1 |
| Граница суши и стран | US Dept of State | `USDOS/LSIB_SIMPLE/2017` | — | — | Пул и режим «Казахстан» | P0 |
| GPW v4.11 | NASA SEDAC (CIESIN) | `CIESIN/GPWv411/GPW_Population_Density` | 30″ | чел./км² | Справка об удалённости | P2 |

Кроме кандидатов, пул содержит 60 контрольных квадратов `CT_` (лес, пашня, постоянный снег — по 20, доля класса WorldCover > 0,7) для эксперимента E7: атрибуты считаются так же, в кампании они не входят. Все ID проверяет MEMBER_B в каталоге GEE при EARTH-02 и записывает фактическую версию. Запасной путь без GEE (RISK R04): Copernicus DEM на [AWS Open Data](https://registry.opendata.aws/copernicus-dem/) и [Microsoft Planetary Computer](https://planetarycomputer.microsoft.com/) для коротких списков и мест практики.

## 4. Положение Солнца

| Что | Источник | Роль |
| --- | --- | --- |
| Алгоритм NOAA Solar Calculator (по Meeus) | Описание алгоритма NOAA GML | Реализация в `pipeline/common/sun.py` |
| astropy (`get_sun`, `AltAz`) | astropy, BSD | Эталон для проверки E1 |

## 5. Курируемые таблицы (MEMBER_E, `data/curated/`)

| Файл | Содержимое | Задачи |
| --- | --- | --- |
| `targets.csv` | ID, тело, название, широта, долгота, вид, продукт DEM, температуры поверхности с диапазоном и источником | SCI-01, SCI-04 |
| `mission_templates.csv` | Шаблоны, задачи, атрибуты, функции, параметры, веса, обоснование | SCI-02 |
| `gap_alternatives.csv` | Физический разрыв → альтернативное средство испытаний → источник | SCI-02 |
| `practice_sites.csv` | Площадка, координаты, задача, контекст цели, источник, проверяемость, причина исключения | SCI-03 |
| `sources.csv` | Ключ источника, полная ссылка, URL или DOI, дата обращения | все |
| `geology_tags.csv` (P1) | Теги геологии для коротких списков и целей, источник | SCI-07 |

Колонки (первая строка файла — заголовок; разделитель — запятая; кодировка UTF-8; ключи источников — из `sources.csv`):

| Файл | Колонки |
| --- | --- |
| `targets.csv` | `id, body, name, lat, lon, kind, dem_product, fine_baseline_m, t_min_c, t_min_c_lo, t_min_c_hi, t_max_c, t_max_c_lo, t_max_c_hi, source_keys, templates` |
| `mission_templates.csv` | `template_id, body, objective_id, objective_name, description, weight_default, attr, fn, params, weight, needs_target, priority, rationale, source_key` — одна строка на атрибут задачи; `params` как `sigma=3` или `a=50;tau=25` (имена параметров — §6 MATHEMATICAL_SPECIFICATION) |
| `gap_alternatives.csv` | `gap, body, alternative, source_key` |
| `practice_sites.csv` | `site_id, name, lat, lon, coord_source_key, objective_id, target_context, source_key, testable, exclusion_reason` — `testable` = `true/false`, причина исключения — по правилам VALIDATION_PROTOCOL E3 |
| `sources.csv` | `key, citation, url_or_doi, accessed` |
| `geology_tags.csv` (P1) | `id, tag, source_key` |

Документированные случаи для `practice_sites.csv` (найти источники и проверить в PREP-15, оформить на SCI-03):

- **Выходы и геология Луны:** вулканическое поле Сан-Франциско (JETT3, JETT5), Метеоритный кратер, кратер Рис, Craters of the Moon, ущелье Рио-Гранде (тренировки Apollo), Лансароте (ESA PANGAEA).
- **Реголит и имитаторы:** кратер Merriam (JSC-1A), Pu'u Nene (JSC Mars-1), базальт Saddleback (MMS), Мауна-Кеа (испытания ISRU).
- **Мобильность и маршруты на Марсе:** Долина Смерти (обход препятствий Mars 2020), Атакама, остров Девон (роверы).
- **Холод и сухость:** Сухие долины Мак-Мердо, остров Девон, Шпицберген (AMASE).

## 6. Лицензии и атрибуция

| Набор | Условия | Как указываем |
| --- | --- | --- |
| Данные NASA (LOLA и PGDA, MOLA, MODIS, GPM, NASADEM, GIBS) | Открытые | Название, «NASA», ссылка; для PGDA — обязательная ссылка на Barker et al. 2021 |
| Copernicus DEM | Бесплатно, с обязательной атрибуцией | Формулировка лицензии Copernicus DEM (SUB-03) |
| ESA WorldCover | CC BY 4.0 | Атрибуция ESA WorldCover 2021 |
| HRSC в DEM Марса | ESA, DLR, FU Berlin | Как указано на странице USGS |
| GPW v4.11 | CC BY 4.0 | CIESIN, NASA SEDAC |

## 7. Бюджет объёмов (для интернета на площадке)

| Что | Объём | Где хранится |
| --- | --- | --- |
| DEM PGDA, участок 20 (5 м, 20×20 км) | ~64 МБ (4 000 × 4 000 × float32, оценка) | `data/raw/`, не в git |
| Окно MOLA/HRSC 30×30 км | < 1 МБ при чтении окна; до ~20 МБ, если файл разбит на полосы | `data/raw/` |
| Окна Copernicus 30 м для 30 кандидатов | ~30 × 4 МБ | `data/raw/` |
| `earth_candidates.json` | ≤ 3 МБ | `data/processed/` (в git) |
| Картинки «То же Солнце» | ~40 PNG или WebP × 100 КБ | `web/public/img/` (в git) |
