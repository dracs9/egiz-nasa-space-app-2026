"""Render cinematic orthographic planet plates for the EGIZ landing page.

Inputs are the CC BY 4.0 Solar System Scope global mosaics retained in
references/source-textures/ (see web/public/textures/ATTRIBUTION.md).
Each plate is centred on a real EGIZ target so the hero imagery shows the
actual place the software studies. Output is decorative visual context,
never solver input.

Usage: .venv/bin/python tools/render_hero_planets.py
"""
from __future__ import annotations

import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

Image.MAX_IMAGE_PIXELS = None
ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "references" / "source-textures"
OUT = ROOT / "web" / "public" / "hero"


def load(name: str) -> np.ndarray:
    return np.asarray(Image.open(SRC / name).convert("RGB"), dtype=np.float32) / 255.0


def srgb_to_lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def lin_to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def sample(tex: np.ndarray, lat: np.ndarray, lon: np.ndarray) -> np.ndarray:
    h, w, _ = tex.shape
    u = ((lon + 180.0) / 360.0 % 1.0) * w - 0.5
    v = (90.0 - lat) / 180.0 * h - 0.5
    x0 = np.floor(u).astype(np.int64); y0 = np.floor(v).astype(np.int64)
    fx = (u - x0)[..., None]; fy = (v - y0)[..., None]
    x0 %= w; x1 = (x0 + 1) % w
    y0 = np.clip(y0, 0, h - 1); y1 = np.clip(y0 + 1, 0, h - 1)
    a = tex[y0, x0] * (1 - fx) + tex[y0, x1] * fx
    b = tex[y1, x0] * (1 - fx) + tex[y1, x1] * fx
    return a * (1 - fy) + b * fy


def rot(lat0: float, lon0: float, roll: float = 0.0) -> np.ndarray:
    """Matrix taking view-frame vectors (x right, y up, z toward viewer) to body frame."""
    la, lo, r = map(math.radians, (lat0, lon0, roll))
    # Body frame: X toward (0,0), Y toward (0,90E), Z north.
    center = np.array([math.cos(la) * math.cos(lo), math.cos(la) * math.sin(lo), math.sin(la)])
    east = np.array([-math.sin(lo), math.cos(lo), 0.0])
    north = np.cross(center, east)
    right = math.cos(r) * east + math.sin(r) * north
    up = -math.sin(r) * east + math.cos(r) * north
    return np.stack([right, up, center], axis=1)


def render(tex, *, size, cx, cy, radius, lat0, lon0, roll, sun, atmosphere=None, clouds=None,
           exposure=1.0, lommel=0.0, night=0.0, ss=2):
    W, H = size[0] * ss, size[1] * ss
    cx, cy, radius = cx * ss, cy * ss, radius * ss
    ys, xs = np.mgrid[0:H, 0:W].astype(np.float32)
    nx = (xs + 0.5 - cx) / radius
    ny = -(ys + 0.5 - cy) / radius
    r2 = nx * nx + ny * ny
    inside = r2 < 1.0
    nz = np.sqrt(np.clip(1.0 - r2, 0, 1))
    sunv = np.array(sun, dtype=np.float32); sunv /= np.linalg.norm(sunv)
    img = np.zeros((H, W, 3), dtype=np.float32)

    vx, vy, vz = nx[inside], ny[inside], nz[inside]
    M = rot(lat0, lon0, roll)
    body = M @ np.stack([vx, vy, vz])
    lat = np.degrees(np.arcsin(np.clip(body[2], -1, 1)))
    lon = np.degrees(np.arctan2(body[1], body[0]))
    albedo = srgb_to_lin(sample(tex, lat, lon))
    mu0 = vx * sunv[0] + vy * sunv[1] + vz * sunv[2]
    lit = np.clip(mu0, 0, 1)
    if lommel:
        ls = 2 * lit / (lit + np.maximum(vz, 1e-3))
        shade = (1 - lommel) * lit + lommel * np.clip(ls, 0, 1.6) * 0.62
    else:
        shade = lit
    # soft terminator
    shade = shade * np.clip((mu0 + 0.03) / 0.09, 0, 1) ** 0.6 * np.clip(mu0 * 4 + 1, 0, 1)
    color = albedo * shade[:, None] * exposure
    if clouds is not None:
        c = srgb_to_lin(sample(clouds, lat, lon))[:, :1]
        color = color * (1 - c * 0.85) + c * shade[:, None] * exposure * 0.95
    if night:
        dark = np.clip(-mu0 * 5, 0, 1)[:, None]
        color += albedo * night * dark
    if atmosphere is not None:
        tint = np.array(atmosphere["color"], dtype=np.float32)
        limb = (1 - vz) ** atmosphere.get("power", 3.0)
        day = np.clip(mu0 * 1.6 + 0.25, 0, 1)
        color = color * (1 - limb[:, None] * atmosphere["veil"] * day[:, None]) + tint * limb[:, None] * atmosphere["strength"] * day[:, None]
    img[inside] = color

    if atmosphere is not None:
        # thin outer halo, lit side only
        d = np.sqrt(r2)
        halo_mask = (d >= 1.0) & (d < 1.0 + atmosphere["halo"])
        hx, hy = nx[halo_mask], ny[halo_mask]
        hd = d[halo_mask]
        dirlit = np.clip((hx * sunv[0] + hy * sunv[1]) / np.maximum(hd, 1e-6) * 1.2 + 0.25, 0, 1)
        fall = np.exp(-(hd - 1.0) / (atmosphere["halo"] * 0.28))
        tint = np.array(atmosphere["color"], dtype=np.float32)
        img[halo_mask] += tint * (fall * dirlit * atmosphere["strength"] * 0.9)[:, None]

    out = (lin_to_srgb(img) * 255 + 0.5).astype(np.uint8)
    im = Image.fromarray(out, "RGB")
    if ss > 1:
        im = im.resize(size, Image.Resampling.LANCZOS)
    return im


def grain(im: Image.Image, amount=3.0, seed=7) -> Image.Image:
    a = np.asarray(im, dtype=np.float32)
    rng = np.random.default_rng(seed)
    n = rng.normal(0, amount, a.shape[:2])[..., None]
    return Image.fromarray(np.clip(a + n, 0, 255).astype(np.uint8))


def save(im: Image.Image, stem: str, widths=(2560, 1440)):
    OUT.mkdir(parents=True, exist_ok=True)
    for w in widths:
        h = round(im.height * w / im.width)
        r = im if w == im.width else im.resize((w, h), Image.Resampling.LANCZOS)
        r = r.filter(ImageFilter.UnsharpMask(radius=1.2, percent=40, threshold=2))
        r.save(OUT / f"{stem}-{w}.jpg", quality=84, optimize=True, progressive=True)
        print(OUT / f"{stem}-{w}.jpg", r.size)


def main():
    moon = load("moon-8k.jpg")
    # Moon south pole: Mons Mouton (85.4 S, 31.7 E) sits near the upper limb, grazing sun from the right.
    wide = render(moon, size=(2560, 1440), cx=1900, cy=2050, radius=1750, lat0=-62, lon0=31.7, roll=180,
                  sun=(0.78, 0.42, 0.46), exposure=1.25, lommel=0.35)
    save(grain(wide, 2.2), "moon-south-pole")
    tall = render(moon, size=(1080, 1920), cx=900, cy=560, radius=980, lat0=-62, lon0=31.7, roll=180,
                  sun=(0.78, 0.42, 0.46), exposure=1.25, lommel=0.35)
    save(grain(tall, 2.2), "moon-south-pole-portrait", widths=(1080,))
    del moon

    mars = load("mars-8k.jpg")
    marsatm = {"color": (0.55, 0.30, 0.18), "strength": 0.18, "veil": 0.2, "halo": 0.012, "power": 4.0}
    wide = render(mars, size=(2560, 1440), cx=1980, cy=820, radius=900, lat0=18.4, lon0=77.5, roll=-18,
                  sun=(-0.62, 0.30, 0.42), exposure=1.0, lommel=0.25, atmosphere=marsatm)
    save(grain(wide, 2.0), "mars-jezero")
    del mars

    earth = load("earth-8k.jpg")
    clouds = np.asarray(Image.open(ROOT / "web" / "public" / "textures" / "earth-clouds.jpg").convert("RGB"), dtype=np.float32) / 255.0
    earthatm = {"color": (0.30, 0.55, 1.0), "strength": 0.32, "veil": 0.35, "halo": 0.012, "power": 4.0}
    wide = render(earth, size=(2560, 1440), cx=1280, cy=2240, radius=1500, lat0=12, lon0=66, roll=0,
                  sun=(0.80, 0.42, 0.42), exposure=1.1, atmosphere=earthatm, clouds=clouds, night=0.004)
    save(grain(wide, 1.8), "earth-limb")
    render_mouton_hillshade()



def render_mouton_hillshade():
    """Hillshade of the measured PGDA LOLA Mons Mouton pyramid (level 2, 10 m posts, 4 km square)."""
    import json
    base = ROOT / "data" / "terrain" / "moon-mouton"
    tiles = [json.loads((base / f"2-{c}-{r}.json").read_text()) for r in range(4) for c in range(4)]
    side = int(tiles[0]["side"])
    n = (side - 1) * 4 + 1
    z = np.zeros((n, n), dtype=np.float64)
    for t in tiles:
        _, c, r = (int(v) for v in t["key"].split("-"))
        e = np.asarray(t["elevations"], dtype=np.float64).reshape(side, side)
        z[r * (side - 1): r * (side - 1) + side, c * (side - 1): c * (side - 1) + side] = e
    post = 10.0
    im = Image.fromarray(z.astype(np.float32), mode="F").resize((1600, 1600), Image.Resampling.BICUBIC)
    z = np.asarray(im, dtype=np.float64)
    post *= (n - 1) / 1599
    gy, gx = np.gradient(z, post)
    az, el = math.radians(300), math.radians(9)
    lx, ly, lz = math.cos(el) * math.sin(az), math.cos(el) * math.cos(az), math.sin(el)
    nrm = np.sqrt(gx * gx + gy * gy + 1)
    shade = np.clip((-gx * lx + gy * ly + lz) / nrm, 0, 1)
    shade = shade / np.percentile(shade, 99.6)
    g = lin_to_srgb(np.clip(shade, 0, 1) ** 1.1 * 0.92)
    rgb = np.stack([g * 0.985, g * 0.975, g * 0.955], -1)
    out = Image.fromarray((rgb * 255).astype(np.uint8))
    out = grain(out, 2.0)
    OUT.mkdir(parents=True, exist_ok=True)
    out.save(OUT / "mons-mouton-hillshade-1600.jpg", quality=86, optimize=True, progressive=True)
    out.resize((800, 800), Image.Resampling.LANCZOS).save(OUT / "mons-mouton-hillshade-800.jpg", quality=84, optimize=True, progressive=True)
    print("hillshade", z.min(), z.max())



if __name__ == "__main__":
    main()
