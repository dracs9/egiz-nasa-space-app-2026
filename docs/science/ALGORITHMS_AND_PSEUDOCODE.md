# Алгоритмы и псевдокод

Язык-независимый псевдокод к [MATHEMATICAL_SPECIFICATION](MATHEMATICAL_SPECIFICATION.md). Сигнатуры, проверки и тесты функций — [FUNCTION_SPECIFICATIONS](../engineering/FUNCTION_SPECIFICATIONS.md). Это проектный документ: исполняемый код пишется с 14.11 09:00.

## A1. Огрубление окна до сетки шага p

```text
function resample_window(src_raster, center_lonlat, body, half_size_m=10000, p):
    crs_local ← (body == earth) ? utm_zone(center) : aeqd(center, R_body)
    grid ← square grid, extent ±(half_size_m + margin_m), step p, in crs_local
    dst ← reproject(src_raster → grid, resampling = AVERAGE, nodata = NaN)
    mark pixel invalid if any source pixel in its footprint is nodata
    return dst (2-D float32, NaN = invalid), p
```

`margin_m` = 1 000 м для атрибутов рельефа (покрывает смещение базы 2 км) и 5 000 м для теней. Сложность O(N_src).

## A2. Уклон на базе и атрибуты рельефа

```text
function slope_at_offset(z, p, o):            # база L = 2·o·p
    gx ← (z[:, 2o:] − z[:, :−2o]) / (2·o·p)   # центр — колонки o … W−o−1
    gy ← (z[2o:, :] − z[:−2o, :]) / (2·o·p)
    crop gx, gy to the common interior (o-pixel frame removed)
    s ← degrees(atan(hypot(gx, gy)));  s[any NaN in stencil] ← NaN
    return s

function terrain_attributes(z, p, fine_offset=1, regional_baseline=2000):
    if valid_fraction(z_core) < 0.5: return all null
    s_f ← slope_at_offset(z, p, fine_offset)
    s_r ← slope_at_offset(z, p, round(regional_baseline / (2·p)))
    core   ← central 20×20 km window          # региональные атрибуты, перепад, минимум
    core10 ← central 10×10 km window          # атрибуты тонкой базы (s_f, tri_f)
    return {
      slope_f_p50: nanpercentile(s_f[core10], 50), slope_f_p90: nanpercentile(s_f[core10], 90),
      frac_lt10_f: mean(s_f[core10] < 10), frac_lt20_f: mean(s_f[core10] < 20),
      slope_r_p50, slope_r_p90, frac_lt20_r: mean(s_r[core] < 20),
      relief_m: nanpercentile(z[core],95) − nanpercentile(z[core],5),
      tri_f_m: nanmedian(mean_k |z_k − z| over 8 neighbours on the fine grid, core10),
      elev_min_m: nanmin(z[core]) }
```

Сложность O(N). Одна и та же функция для Земли (сверка с GEE), Луны и Марса.

## A3. Земля: двухступенчатый расчёт в Earth Engine

```text
STAGE 0 — пул кандидатов (EARTH-01)
    land ← USDOS/LSIB_SIMPLE/2017 (суша); исключить Антарктиду, кроме полигона свободных ото льда районов
    strata ← {горячие пустыни, холодные пустыни и полярная суша > 60°, вулканические поля (по GVP), прочая открытая суша}
    points ← randomPoints(each stratum, n_s, seed=2026); keep if WorldCover class 60 fraction(20 km) ≥ 0.5
             (полярные: MCD12Q1 barren ≥ 0.5 OR WorldCover 60 ≥ 0.5)
    add practice sites (PR_*) from data/curated/practice_sites.csv
    add 60 control tiles (CT_*): 20 each where forest / cropland / permanent snow fraction > 0.7; pool = control (E7 only, never in campaigns)
    tiles ← square 20 km in UTM(center) for each point;  N ≈ 3 000 + практика

STAGE A — все кандидаты (EARTH-02, EARTH-03), группами по UTM-зоне
    for zone in zones(tiles):
        dem200 ← COPERNICUS/DEM/GLO30.mosaic().setDefaultProjection(4326, 30 м)
                  .reduceResolution(mean).reproject(zone, 200 м)
        slope400 ← slope by central difference offset 1 (via neighborhoodToBands or translate)
        slope2km ← offset 5
        reduceRegions(tiles in zone, reducers = percentiles[50, 90], mean(slope<10), mean(slope<20),
                      percentiles[5, 95] of dem, TRI median, min) → _f400, _r, relief, tri_f400
        environment: LST P5/P95 → mean, IMERG annual mean, WorldCover fractions, MCD12Q1 fallback
    export (getInfo chunks ≤ 4 000 features, retry ×3)

STAGE B — тонкая база 100 м для всех кандидатов, только центральные 10×10 км (EARTH-02 B)
    for zone in zones(tiles):  dem50 ← … reproject(zone, 50 м) over core10 (+1 пиксель рамки)
        slope100 (offset 1) → _f100 attrs (p50, p90, <10°, <20°), tri_f100
    (P1, EARTH-08) for top-30 by Moon objectives: getDownloadURL(dem30, 20 km + 5 km margin) → data/raw/earth_dem30/{id}.tif
```

Почему так: на 50 м по всему окну 20 км для ~3 тыс. кандидатов вышло бы около 0,5 млрд пикселей. По центральным 10 км — около 0,12 млрд, а цель считается по тем же 10 км. Если ступень B не успевает (GEE, квоты), задачи O1 и O3 временно считаются на базе 400 м с пометкой «proxy baseline» (CONTINGENCY_PLAN, R04).

## A4. Цели: окна DEM

```text
function target_window(target):
    if target.body == moon:  src ← PGDA product 78 LDEM 5 m for the site (GeoTIFF/COG, polar stereographic)
    if target.body == mars:  src ← MOLA/HRSC blend 200 m (remote GeoTIFF; fallback MEGDR 463 м → DECISIONS)
    z_fine ← resample_window(src, target.center, body, p = (moon ? 50 : 200))
    attrs ← terrain_attributes(z_fine, p)
    (P1) z30 ← resample_window(src, …, p=30, margin 5 km)  # для теней и картинок (только Луна)
    cache rasters → data/raw/targets/{id}_{p}.tif (не в git)
    return attrs
```

## A5. Положение Солнца (Земля, NOAA)

```text
function sun_position(lat, lon, t_utc[]):                 # векторно по времени
    jd ← julian_day(t_utc);  T ← (jd − 2451545.0)/36525
    L0 ← (280.46646 + T·(36000.76983 + 0.0003032·T)) mod 360
    M  ← 357.52911 + T·(35999.05029 − 0.0001537·T)
    e  ← 0.016708634 − T·(0.000042037 + 0.0000001267·T)
    C  ← sin(M)·(1.914602 − T·(0.004817 + 0.000014·T)) + sin(2M)·(0.019993 − 0.000101·T) + sin(3M)·0.000289
    λ_app ← L0 + C − 0.00569 − 0.00478·sin(125.04 − 1934.136·T)
    ε  ← mean_obliquity(T) + 0.00256·cos(125.04 − 1934.136·T)
    δ  ← asin(sin ε · sin λ_app)
    EoT ← equation_of_time(L0, M, e, ε)                      # минуты
    tst ← minutes_of_day_utc + EoT + 4·lon                    # истинное солнечное время
    H  ← tst/4 − 180
    h  ← asin(sin lat·sin δ + cos lat·cos δ·cos H);  h ← h + refraction(h)
    az ← atan2(sin H, cos H·sin lat − tan δ·cos lat) + 180    # от севера по часовой
    return h, az
```

Формулы соответствуют NOAA Solar Calculator. Точность проверяем по astropy в VAL-01 (E1). Не утверждаем точность, пока она не измерена.

## A6. Окна низкого Солнца

```text
function lowsun_windows(lat, h_max, year=2025, step_min=10):
    for m in 1..12:
        for day in days(m):
            h, az ← sun_position(lat, lon=0, times(day, step))   # статистика не зависит от долготы
            low ← (h > 0) & (h ≤ h_max)
            hours[day] ← count(low)·step/60
            sweep[day] ← circular_range(az[low])                # 0, если low пуст
        H_low[m] ← mean(hours);  A_low[m] ← median(sweep)
    return H_low[12], A_low[12]

кэш по округлённой широте (шаг 0,05°): ~2 000 уникальных значений → секунды
```

## A7. Тени по DEM (P1)

```text
function cast_shadow(z30, p=30, h_deg, az_deg):
    R ← rotate(z30, angle = az_deg − 270°, order=1, reshape=True, NaN outside)   # Солнце «слева»
    x ← column_index · p
    W ← R + x·tan(h)
    run ← cumulative_max(W, along columns, from left)
    shadow_rot ← (shift_right(run) > W) OR (surface normal · sun_vector < 0)
    shadow ← rotate_back(shadow_rot, −angle) cropped to original grid
    return shadow   # bool

function shadow_fraction_curve(z30, analysis_mask, H={1,2,3,5,7}, AZ={0,45,…,315}):
    return sf[h, az] = mean(cast_shadow(z30, h, az)[analysis_mask])
```

Сложность O(N) на положение Солнца: 40 положений × окно 1 000×1 000 → секунды на кандидата. Ограничение: ближайшие преграды — внутри окна плюс 5 км запаса. Более далёкий горизонт (для Луны он важен) не учитывается — это оговорка; сверка с PGDA — P2.

## A8. Соответствие атрибута и задачи

```text
function attribute_fidelity(spec, x_e, x_T):
    if x_e is null or (spec.needs_target and x_T is null): return null
    switch spec.type: match | logmatch | at_most | at_least | colder | category  (формулы §6)

function objective_fidelity(objective, attrs_e, attrs_T):
    if violates(objective.constraints, attrs_e): return null, "constraint"
    parts ← {i: attribute_fidelity(spec_i, attrs_e[i], attrs_T[i])}
    missing_w ← Σ w_i [parts[i] is null];  if missing_w / Σ w_i > 0.3: return null, "missing"
    F ← exp( Σ_{i: not null} w_i·ln(max(parts[i], 1e-6)) / Σ_{i: not null} w_i )
    return F, parts, partial = (missing_w > 0)
```

## A9. Кампания

```text
function campaign(F[n_sites × n_obj] with null→0, W[n_obj], k_max=3):
    single ← (F · W) / ΣW                               # C({e})
    U ← ∪_o argtop20(F[:, o]) ∪ argtop20(single)
    for k in 1..k_max:
        best ← argmax over combinations(U, k) of Σ_o W_o · max_{e∈S} F[e,o] / ΣW   # векторно, блоками
        greedy ← greedy_max_coverage(F (весь пул), W, k)
        if C(greedy) > C(best) + 1e-9: U ← U ∪ greedy; recompute best
        roles[e] ← {o : e = argmax_{s∈best} F[s,o]}
        result[k] ← best, C(best), roles, per-objective max
    return result, pareto = [C(result[k]) for k]

function greedy_max_coverage(F, W, k):
    S ← ∅; cur ← zeros(n_obj)
    repeat k times: e* ← argmax_e Σ_o W_o·max(cur_o, F[e,o]); S ← S ∪ {e*}; cur ← max(cur, F[e*])
    return S
```

Число наборов: C(120, 3) = 280 840; оценка набора — O(|O|). Python (numpy, блоками по 50 000) и TypeScript в Web Worker — меньше 300 мс (бюджет проверяем в TESTING_STRATEGY).

## A10. Реестр разрывов

```text
for o, i: ceil[o,i] ← max_e attribute_fidelity(...); gap[o,i] ← ceil[o,i] < 0.1
for o: ceil_o ← max_e F[e,o]
physical ← curated list (gravity, vacuum, radiation, PSR cold, regolith) + alternatives from gap_alternatives.csv
```

## A11. Проверка по практике (VAL-01)

```text
practice ← data/curated/practice_sites.csv  (site, objective, source, testable, reason)
for each testable (site, o) with target T matching the source context:
    r ← rank of PR_site among eligible candidates by F_o(·,T);  n ← #eligible   # eligible excludes pool = control
    (secondary, pre-registered: the same rank with F_o built only from attributes that do not need the target)
    pct ← 100·r/n
    baselines: aridity_only(F = at_most(precip)·at_least(bare)), random (expected 50), v1_similarity (score v1)
summary: median pct, hit@10%, binomial(k, n, p0=0.10) per objective group; sites in several pairs → cluster bootstrap
report every pair, including failures and exclusions
```

## A12. Устойчивость и абляция (VAL-03, VAL-04)

```text
for r in 1..200 (seed 2026):
    perturb weights ×U(0.8, 1.2), tolerances ×U(0.7, 1.3), subsample 80 % of pool
    S_r ← campaign(...)[k=2 and 3]
selection_freq[site] ← share of runs where site ∈ S_r;  jaccard(S_r, S_base) median
ablation: drop each attribute family {terrain_fine, terrain_regional, environment, light} → ΔC, Δselection
alternative AND: F = min_i f_i → compare campaigns
```
