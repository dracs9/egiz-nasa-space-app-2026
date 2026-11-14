"""DEM-based planetary perception models (deterministic, CPU, NumPy/SciPy only).

Three registered models run on the same measured grids the renderer and the
simulator use:

* ``egiz.units.kmeans-geomorph`` - unsupervised k-means on standardized
  geomorphometric features. Outputs *geomorphometric* units, not geologic units.
* ``egiz.craters.dem-log`` - multi-scale Laplacian-of-Gaussian depression
  detector with radial-profile rim fitting. A documented classical baseline,
  not a trained network; its score is a heuristic, not a calibrated probability.
* ``egiz.anomaly.mahalanobis`` - feature-space outlier regions (computational
  hypotheses for inspection, never discoveries).
"""
from __future__ import annotations

import math

import numpy as np
from scipy.ndimage import (
    gaussian_filter,
    label,
    laplace,
    map_coordinates,
    maximum_filter,
    uniform_filter,
)


def log_filter(z, sigma):
    """Laplacian of Gaussian with an exactly zero-sum stencil.

    scipy's gaussian_laplace kernel does not sum to zero after truncation, which
    biases the response by a multiple of absolute elevation (~5 km here).
    """
    return laplace(gaussian_filter(z - float(np.mean(z)), sigma=sigma, mode="nearest"),
                   mode="nearest")


FEATURES = ["slope_deg", "roughness_m", "tpi100_m", "tpi500_m", "curvature"]


def block_mean(a, f):
    h, w = (a.shape[0] // f) * f, (a.shape[1] // f) * f
    return a[:h, :w].reshape(h // f, f, w // f, f).mean(axis=(1, 3))


def geomorph_features(native, native_m, cell_m):
    """Per-cell features on a cell_m grid derived from the native DEM."""
    f = int(round(cell_m / native_m))
    z = block_mean(native, f)
    gy, gx = np.gradient(z, cell_m)
    slope = np.degrees(np.arctan(np.hypot(gx, gy)))
    detail = native - gaussian_filter(native, sigma=f / 2, mode="nearest")
    rough = np.sqrt(block_mean(detail ** 2, f))
    tpi100 = z - uniform_filter(z, size=max(3, int(round(200 / cell_m)) | 1), mode="nearest")
    tpi500 = z - uniform_filter(z, size=max(3, int(round(1000 / cell_m)) | 1), mode="nearest")
    curvature = log_filter(z, 2) / cell_m ** 2
    return z, np.stack([slope, rough, tpi100, tpi500, curvature], axis=-1)


def kmeans(x, k, seed, iterations=60, restarts=4):
    """Deterministic k-means++ with restarts; returns (centroids, labels, inertia)."""
    rng = np.random.default_rng(seed)
    best = None
    for _ in range(restarts):
        centers = [x[rng.integers(len(x))]]
        d2 = np.sum((x - centers[0]) ** 2, axis=1)
        for _ in range(1, k):
            centers.append(x[rng.choice(len(x), p=d2 / d2.sum())])
            d2 = np.minimum(d2, np.sum((x - centers[-1]) ** 2, axis=1))
        c = np.array(centers)
        for _ in range(iterations):
            dist = ((x[:, None, :] - c[None]) ** 2).sum(-1)
            lab = dist.argmin(1)
            new = np.array([x[lab == j].mean(0) if np.any(lab == j) else c[j] for j in range(k)])
            if np.allclose(new, c, atol=1e-7):
                break
            c = new
        inertia = float(((x - c[lab]) ** 2).sum())
        if best is None or inertia < best[2]:
            best = (c, lab, inertia)
    return best


def describe_unit(center):
    """Readable descriptor from a centroid in physical units (rule text is exported)."""
    slope, rough, tpi100, tpi500, curv = center
    if tpi100 < -1.5 and curv > 0:
        shape = "local depression / crater interior"
    elif tpi100 > 1.5 and curv < 0:
        shape = "local crest / rim"
    elif tpi500 > 8:
        shape = "elevated terrain"
    elif tpi500 < -8:
        shape = "low-lying terrain"
    else:
        shape = "intermediate relief"
    grade = "gentle" if slope < 8 else "moderate" if slope < 15 else "steep" if slope < 25 else "very steep"
    texture = "smooth" if rough < 0.25 else "textured" if rough < 0.6 else "rough"
    return f"{grade}, {texture} {shape}"


def terrain_units(native, native_m, cell_m=20.0, k=6, seed=2026, sample=120_000):
    z, feats = geomorph_features(native, native_m, cell_m)
    flat = feats.reshape(-1, feats.shape[-1])
    mu, sd = flat.mean(0), flat.std(0) + 1e-12
    xs = (flat - mu) / sd
    rng = np.random.default_rng(seed)
    pick = rng.choice(len(xs), size=min(sample, len(xs)), replace=False)
    centers, _, inertia = kmeans(xs[pick], k, seed)
    # Order clusters by mean slope so unit ids are stable across rebuilds.
    order = np.argsort(centers[:, 0])
    centers = centers[order]
    labels = ((xs[:, None, :] - centers[None]) ** 2).sum(-1).argmin(1).reshape(z.shape[:2])
    dist = np.sqrt(((xs - centers[labels.ravel()]) ** 2).sum(-1))
    second = np.sort(((xs[:, None, :] - centers[None]) ** 2).sum(-1), axis=1)[:, 1] ** 0.5
    margin = (second - dist) / (second + dist + 1e-12)       # 0 = boundary, 1 = at centroid
    physical = centers * sd + mu
    units = []
    for j in range(k):
        mask = labels == j
        units.append({
            "id": j, "label": f"U{j + 1}", "descriptor": describe_unit(physical[j]),
            "centroid": {name: round(float(v), 4) for name, v in zip(FEATURES, physical[j])},
            "areaFraction": round(float(mask.mean()), 4),
            "meanAssignmentMargin": round(float(margin.reshape(labels.shape)[mask].mean()), 3),
        })
    return labels.astype(np.uint8), units, {
        "featureMean": mu.round(6).tolist(), "featureStd": sd.round(6).tolist(),
        "inertiaPerSample": round(inertia / len(pick), 4), "trainingSamples": int(len(pick)),
        "meanAssignmentMargin": round(float(margin.mean()), 3),
    }, feats


ACCEPT = {"min_depth_m": 1.0, "min_depth_to_diameter": 0.04, "min_rim_completeness": 0.75}


def accept(fit):
    """Physical acceptance rules (documented in the registry and perception.json)."""
    return (fit["depth_m"] >= ACCEPT["min_depth_m"]
            and fit["depth_to_diameter"] >= ACCEPT["min_depth_to_diameter"]
            and fit["rim_completeness"] >= ACCEPT["min_rim_completeness"])


def detect_craters(z, cell_m, radii_m=(30, 45, 65, 95, 140, 200, 290, 420, 600),
                   min_score=0.35, max_peaks=1500):
    """Multi-scale LoG depression detection + radial profile rim fit on a regular grid.

    Returns candidates in grid pixel coordinates (row, col) with physical size.
    """
    candidates = []
    h, w = z.shape
    for radius in radii_m:
        sigma = radius / cell_m / math.sqrt(2)
        if sigma < 1.2:
            continue
        response = sigma ** 2 * log_filter(z, sigma)
        # Depressions have positive LoG of elevation.
        peaks = (response == maximum_filter(response, size=int(2 * sigma) | 1)) & (response > 0)
        rows, cols = np.nonzero(peaks)
        # Bound the cost: only the strongest depressions per scale are profiled.
        order = np.argsort(-response[rows, cols])[:max_peaks]
        for r, c in zip(rows[order], cols[order]):
            rpx = radius / cell_m
            if r < 2 * rpx or c < 2 * rpx or r >= h - 2 * rpx or c >= w - 2 * rpx:
                continue
            fit = fit_crater(z, r, c, rpx, cell_m)
            if fit and accept(fit) and fit["score"] >= min_score:
                candidates.append(fit)
    return suppress(candidates, cell_m)


def suppress(candidates, cell_m=1.0):
    """Greedy non-maximum suppression in metres (candidates carry x_m/y_m or row/col*cell)."""
    for c in candidates:
        c.setdefault("x_m", c["col"] * cell_m)
        c.setdefault("y_m", c["row"] * cell_m)
    candidates.sort(key=lambda d: -d["score"])
    kept = []
    for cand in candidates:
        if all(math.hypot(cand["x_m"] - k["x_m"], cand["y_m"] - k["y_m"])
               > 0.6 * max(cand["diameter_m"], k["diameter_m"]) / 2 for k in kept):
            kept.append(cand)
    return kept


def detect_multires(native, native_m=5.0, min_score=0.35):
    """Small radii on the native grid, larger radii on a 2x2 mean grid; merged by NMS.

    Output row/col are in native-pixel units.
    """
    fine = detect_craters(native, native_m, radii_m=(15, 22, 30, 45), min_score=min_score)
    coarse = detect_craters(block_mean(native, 2), 2 * native_m,
                            radii_m=(65, 95, 140, 200, 290, 420, 600), min_score=min_score)
    for c in coarse:
        c["row"], c["col"] = c["row"] * 2 + 0.5, c["col"] * 2 + 0.5
        c.pop("x_m", None)
        c.pop("y_m", None)
    for c in fine:
        c.pop("x_m", None)
        c.pop("y_m", None)
    return suppress(fine + coarse, native_m)


def fit_crater(z, r, c, rpx, cell_m, sectors=12):
    """Radial profile fit around a candidate centre (grid pixels)."""
    radii = np.linspace(0, 2.0 * rpx, 41)
    angles = np.linspace(0, 2 * math.pi, sectors, endpoint=False)
    rr = r - np.outer(np.sin(angles), radii)
    cc = c + np.outer(np.cos(angles), radii)
    prof = map_coordinates(z, [rr, cc], order=1, mode="nearest", prefilter=False)
    mean = prof.mean(0)
    search = (radii >= 0.5 * rpx) & (radii <= 1.6 * rpx)
    if not search.any():
        return None
    idx = np.flatnonzero(search)
    rim_i = idx[np.argmax(mean[search])]
    if rim_i in (idx[0], idx[-1]):
        return None                      # rim not bracketed: not a resolved circular depression
    rim_r = radii[rim_i]
    floor = float(mean[: max(2, rim_i // 4)].mean())
    rim = float(mean[rim_i])
    outside = float(mean[min(len(mean) - 1, int(rim_i * 1.6)):].mean())
    depth = rim - floor
    diameter = 2 * rim_r * cell_m
    if depth <= 0 or diameter <= 0:
        return None
    d_over_d = depth / diameter
    # Each sector must rise from floor to a local maximum near the fitted rim radius.
    sector_rim = prof[:, search].max(1) - prof[:, 0]
    completeness = float(np.mean(sector_rim > 0.25 * depth))
    rim_rise = rim - outside
    # Heuristic score in [0,1]: d/D vs fresh simple-crater range (~0.1-0.2), azimuthal closure, rim.
    shape = min(1.0, d_over_d / 0.08)
    score = 0.45 * shape + 0.4 * completeness + 0.15 * (1.0 if rim_rise > 0 else 0.0)
    return {"row": float(r), "col": float(c), "diameter_m": float(diameter), "depth_m": depth,
            "depth_to_diameter": d_over_d, "rim_completeness": completeness,
            "rim_rise_m": rim_rise, "score": float(score)}


def anomaly_regions(features, cell_m, quantile=0.998, min_cells=4, border_m=500.0):
    """Outlier regions; cells within border_m of the grid edge are excluded (filter support)."""
    b = int(round(border_m / cell_m))
    valid = np.zeros(features.shape[:2], dtype=bool)
    valid[b:-b, b:-b] = True
    flat = features[valid]
    mu = flat.mean(0)
    cov = np.cov(flat, rowvar=False) + np.eye(flat.shape[1]) * 1e-9
    inv = np.linalg.inv(cov)
    diff = flat - mu
    d2 = np.zeros(features.shape[:2])
    d2[valid] = np.einsum("ij,jk,ik->i", diff, inv, diff)
    threshold = float(np.quantile(d2[valid], quantile))
    mask = valid & (d2 >= threshold)
    labels, n = label(mask)
    sd = np.sqrt(np.diag(cov))
    regions = []
    for j in range(1, n + 1):
        cells = labels == j
        count = int(cells.sum())
        if count < min_cells:
            continue
        rows, cols = np.nonzero(cells)
        zscore = ((features[cells] - mu) / sd).mean(0)
        top = np.argsort(-np.abs(zscore))[:2]
        regions.append({
            "row": float(rows.mean()), "col": float(cols.mean()),
            "area_m2": count * cell_m ** 2, "meanMahalanobis": float(np.sqrt(d2[cells].mean())),
            "drivers": [{"feature": FEATURES[t], "zScore": round(float(zscore[t]), 2)} for t in top],
        })
    regions.sort(key=lambda d: -d["meanMahalanobis"])
    return regions, threshold
