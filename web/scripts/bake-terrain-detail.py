"""Bake tileable surface-detail maps for the landing world (EGIZ).

Outputs RGBA PNGs: R = height, G/B = tangent-space normal (x, z), A = cavity/occlusion.
Everything is synthesised (spectral noise, impact craters, scattered clasts); nothing is
sampled from a photograph, so the maps are free of licensing questions. The measured
terrain stays the measured terrain: these maps only supply sub-metre surface texture.

Usage: python web/scripts/bake-terrain-detail.py [size]
AI-assisted implementation; human review pending.
"""
import sys, pathlib
import numpy as np
from PIL import Image

N = int(sys.argv[1]) if len(sys.argv) > 1 else 2048
OUT = pathlib.Path(__file__).resolve().parents[1] / 'public' / 'textures' / 'terrain'
OUT.mkdir(parents=True, exist_ok=True)
rng = np.random.default_rng(20261114)

ky = np.fft.fftfreq(N)[:, None]; kx = np.fft.rfftfreq(N)[None, :]
K = np.sqrt(kx * kx + ky * ky); K[0, 0] = 1


def spectral(beta, lo=1, hi=None, seed=None):
    """Periodic fractal noise with a power-law spectrum (perfectly tileable)."""
    r = np.random.default_rng(seed)
    amp = K ** (-beta / 2)
    f = K * N
    amp[f < lo] = 0
    if hi: amp *= np.exp(-(f / hi) ** 2)
    ph = r.uniform(0, 2 * np.pi, amp.shape)
    spec = amp * (r.normal(size=amp.shape) + 0) * np.exp(1j * ph)
    out = np.fft.irfft2(spec, s=(N, N))
    return (out - out.mean()) / (out.std() + 1e-9)


def stamp(h, cx, cy, rad, fn):
    """Adds fn(dx, dy) in a wrapped window around (cx, cy)."""
    R = int(np.ceil(rad))
    xs = (np.arange(int(cx) - R, int(cx) + R + 1)) % N
    ys = (np.arange(int(cy) - R, int(cy) + R + 1)) % N
    dx = (np.arange(int(cx) - R, int(cx) + R + 1) - cx)[None, :]
    dy = (np.arange(int(cy) - R, int(cy) + R + 1) - cy)[:, None]
    h[np.ix_(ys, xs)] += fn(dx, dy)


def crater(r, depth, age, rough):
    def f(dx, dy):
        ang = np.arctan2(dy, dx)
        wob = 1 + .06 * np.sin(3 * ang + rough * 7) + .04 * np.sin(5 * ang + rough * 3) + .03 * np.sin(8 * ang + rough)
        d = np.sqrt(dx * dx + dy * dy) / (r * wob)
        bowl = np.where(d < 1, (d ** 2.2 - 1), 0) * (1 - .45 * age)
        floor = np.where(d < .35 + .2 * age, -(1 - .45 * age) * (1 - (.35 + .2 * age) ** 2.2) - bowl, 0) * (r > 22)
        rim = np.exp(-((d - 1) * (5 - 2.5 * age)) ** 2) * (.28 - .14 * age)
        ej = np.exp(-np.maximum(d - 1, 0) * 3) * .06 * (1 - age) * (d > 1)
        return depth * (bowl + floor + rim + ej)
    return f


def clast(r, hgt, flat):
    def f(dx, dy):
        q = (dx / r) ** 2 + (dy / (r * flat)) ** 2
        return np.where(q < 1, hgt * np.sqrt(np.maximum(1 - q, 0)) ** .7, 0)
    return f


def normals(h, strength):
    gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * .5 * strength
    gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * .5 * strength
    n = np.stack([-gx, -gy, np.ones_like(h)], -1)
    return n / np.linalg.norm(n, axis=-1, keepdims=True)


def blur(h, sigma):
    g = np.exp(-2 * np.pi ** 2 * sigma ** 2 * K ** 2)
    g[0, 0] = 1
    return np.fft.irfft2(np.fft.rfft2(h) * g, s=(N, N))


def cavity(h):
    c = blur(h, 6) - h + (blur(h, 24) - h) * .5
    c = (c - np.percentile(c, 5)) / (np.percentile(c, 99.5) - np.percentile(c, 5))
    return np.clip(1 - c * .9, 0, 1)


def save(name, h, nstrength):
    h = (h - h.min()) / (h.max() - h.min())
    n = normals(h, nstrength)
    a = cavity(h)
    rgba = np.stack([h, n[..., 0] * .5 + .5, n[..., 1] * .5 + .5, a], -1)
    Image.fromarray((np.clip(rgba, 0, 1) * 255 + .5).astype(np.uint8), 'RGBA').save(OUT / f'{name}.webp', quality=90, method=6)
    print('wrote', OUT / f'{name}.webp')


# ---------- Regolith: micro-cratered fines with scattered clasts ----------
h = spectral(3.2, lo=2, seed=1) * .35 + spectral(2.2, lo=40, hi=900, seed=2) * .05
sizes = (rng.pareto(1.6, 2200) + 1) * 3.5
for r in sizes[sizes < N * .12]:
    stamp(h, rng.uniform(0, N), rng.uniform(0, N), r * 3, crater(r, r * .035, rng.uniform() ** .6, rng.uniform()))
for _ in range(9000):
    r = (rng.pareto(2.2) + 1) * 1.6
    if r > 26: continue
    stamp(h, rng.uniform(0, N), rng.uniform(0, N), r * 1.6, clast(r, r * .06, rng.uniform(.55, 1)))
save('regolith', h, N / 22)

# ---------- Rock: fractured, pitted outcrop surface with faint bedding ----------
warp = spectral(3.4, lo=2, seed=5)
y = np.arange(N)[:, None] / N * 2 * np.pi
bedding = np.sin(y * 24 + warp * 2.2) * .12 + np.sin(y * 61 + warp * 3.5) * .05
# Voronoi cracks (periodic): distance to the border between nearest seeds
pts = rng.uniform(0, N, (900, 2))
yy, xx = np.mgrid[0:N:4, 0:N:4].astype(np.float32)
d1 = np.full(xx.shape, 1e9, np.float32); d2 = d1.copy()
for px, py in pts:
    dx = np.abs(xx - px); dx = np.minimum(dx, N - dx); dy = np.abs(yy - py); dy = np.minimum(dy, N - dy)
    d = np.sqrt(dx * dx + dy * dy)
    m = d < d1; d2 = np.where(m, d1, np.minimum(d2, d)); d1 = np.where(m, d, d1)
edge = np.clip((d2 - d1) / 10, 0, 1)
edge = np.array(Image.fromarray((edge * 255).astype(np.uint8)).resize((N, N), Image.BICUBIC)) / 255
h = spectral(2.9, lo=2, seed=6) * .45 + spectral(2.0, lo=60, hi=1000, seed=7) * .06 + bedding - (1 - edge) ** 3 * .5
for _ in range(1800):
    r = (rng.pareto(1.8) + 1) * 2
    if r > 30: continue
    stamp(h, rng.uniform(0, N), rng.uniform(0, N), r * 1.5, lambda dx, dy, r=r: -np.exp(-(dx * dx + dy * dy) / (r * r)) * r * .04)
save('rock', h, N / 18)

# ---------- Sand: wind ripples and grain texture (Mars dust, desert fans) ----------
warp = spectral(3.6, lo=1, seed=9)
x = np.arange(N)[None, :] / N * 2 * np.pi
ripples = np.abs(np.sin(x * 48 + warp * 3 + spectral(3.0, lo=3, seed=10) * .6)) ** 1.6
h = ripples * .25 + spectral(3.0, lo=2, seed=11) * .3 + spectral(1.6, lo=200, seed=12) * .03
save('sand', h, N / 26)
