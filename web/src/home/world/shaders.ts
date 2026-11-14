// GLSL for the landing world: one measured ground that can be four worlds at once.
// Measured heights (regional grids + high-resolution inserts) carry the landform; procedural craters,
// strata and erosion add relief below the measured posts; baked, mipmapped detail maps add the surface.
// AI-assisted implementation; human review pending.

/** Heights, worlds and procedural relief shared by every stage that needs to know where the ground is. */
export const COMMON = /* glsl */`
uniform sampler2D uRegional;   // RGBA = moon, mars, earth(moon analogue), earth(mars analogue); metres relative to centre
uniform sampler2D uHiMoon;     // 10 m measured insert, 4 km
uniform sampler2D uHiMars;     // 8 m measured insert, 2 km
uniform sampler2D uMarsAlbedo; // orthophoto over the Mars insert
uniform vec2 uHiSize;          // moon, mars insert sizes (m); 0 = absent
uniform float uHalf;           // regional half-extent (m)
uniform float uSide;           // regional posts per side
uniform vec4 uW;               // world weights
uniform vec4 uPW;              // probe world weights
uniform vec4 uProbe;           // x, z, radius, feather
uniform float uProbeOff;       // levels the probed world to the host ground at the probe centre
uniform vec3 uCam;
uniform float uTime;
uniform float uRadius;         // planetary radius for curvature (m)

float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3. - 2. * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y) * 2. - 1.; }
float fbm(vec2 p, int oct){ float a = .5, s = 0.; mat2 r = mat2(.8, -.6, .6, .8); for (int i = 0; i < 8; i++){ if (i >= oct) break; s += a * vnoise(p); p = r * p * 2.03 + 17.1; a *= .5; } return s; }
float ridged(vec2 p, int oct){ float a = .5, s = 0.; mat2 r = mat2(.8, -.6, .6, .8); for (int i = 0; i < 8; i++){ if (i >= oct) break; float n = 1. - abs(vnoise(p)); s += a * n * n; p = r * p * 2.11 + 3.7; a *= .5; } return s; }
vec2 rot2(vec2 p, float a){ float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }

vec4 cubicW(float v){ vec4 n = vec4(1., 2., 3., 4.) - v; vec4 s = n * n * n; float x = s.x, y = s.y - 4. * s.x, z = s.z - 4. * s.y + 6. * s.x; return vec4(x, y, z, 6. - x - y - z) * (1. / 6.); }
vec4 bicubic(sampler2D t, vec2 uv, float res){
  vec2 tc = uv * res - .5; vec2 f = fract(tc); tc -= f;
  vec4 xc = cubicW(f.x), yc = cubicW(f.y);
  vec4 c = tc.xxyy + vec2(-.5, 1.5).xyxy; vec4 s = vec4(xc.xz + xc.yw, yc.xz + yc.yw);
  vec4 o = (c + vec4(xc.yw, yc.yw) / s) / res;
  vec4 s0 = texture(t, o.xz), s1 = texture(t, o.yz), s2 = texture(t, o.xw), s3 = texture(t, o.yw);
  float sx = s.x / (s.x + s.y), sy = s.z / (s.z + s.w);
  return mix(mix(s3, s2, sx), mix(s1, s0, sx), sy);
}
vec2 gridUV(vec2 p, float hw, float side){ return (clamp(p, -hw, hw) + hw) / (2. * hw) * (side - 1.) / side + .5 / side; }

/** Impact craters, one candidate per Voronoi cell: irregular rim, flat floor and terraced walls on the
 *  larger ones, a central peak on large fresh ones, hummocky ejecta. y = freshness halo for albedo. */
vec2 craters(vec2 p, float cell, float density){
  vec2 q = p / cell, id = floor(q), f = fract(q); float h = 0., halo = 0.;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++){
    vec2 n = vec2(i, j), cid = id + n;
    if (hash12(cid + 11.7) > density) continue;
    vec2 o = hash22(cid) * .8 + .1;
    float sz = hash12(cid + 4.1); float r = .07 + .3 * sz * sz;
    float age = hash12(cid + 9.3);
    vec2 dv = f - n - o; float ang = atan(dv.y, dv.x);
    float wob = 1. + .07 * sin(3. * ang + cid.x * 1.7) + .04 * sin(5. * ang + cid.y * 2.3) + .025 * sin(9. * ang + cid.x);
    float d = length(dv) / (r * wob);
    if (d > 2.8) continue;
    float depth = r * mix(.38, .07, age);
    float big = smoothstep(.16, .26, r);
    float fl = mix(.25, .5, age) * big;
    float dd = max(d, fl);
    float bowl = d < 1. ? pow(dd, 2.1) - 1. : 0.;
    bowl += sin(d * 34.) * .022 * (1. - age) * big * smoothstep(fl, fl + .15, d) * step(d, .97);
    float rk = (d - 1.) * mix(4.6, 2., age); float rim = exp(-rk * rk) * mix(.33, .12, age);
    float apron = d > 1. ? exp(-(d - 1.) * 3.) * .08 * (1. - age) * (.6 + .8 * vnoise(dv * 7. / r)) : 0.;
    float peak = big * step(age, .55) * exp(-d * d * 55.) * .5;
    h += depth * (bowl + rim + apron + peak);
    halo += (1. - age) * (1. - age) * (1. - age) * exp(-max(d - .85, 0.) * 2.4) * step(d, 2.8);
  }
  return vec2(h * cell, halo);
}

/** Regional measured height for each world (rgba) plus the measured high-resolution inserts. */
vec4 measured(vec2 p){
  vec4 r = bicubic(uRegional, gridUV(p, uHalf, uSide), uSide);
  float out_ = max(abs(p.x), abs(p.y)) - uHalf;
  if (out_ > 0.) { float k = smoothstep(0., 9000., out_); r = mix(r, r * .35, k) + vec4(fbm(p * .00011, 5)) * 900. * k; }
  if (uHiSize.x > 0.) {
    float hs = uHiSize.x * .5; vec2 m = smoothstep(hs, hs - 260., abs(p));
    if (m.x * m.y > 0.) { vec2 uv = (p + hs) / uHiSize.x * (400. / 401.) + .5 / 401.; r.x = mix(r.x, texture(uHiMoon, uv).r, m.x * m.y); }
  }
  if (uHiSize.y > 0.) {
    float hs = uHiSize.y * .5; vec2 m = smoothstep(hs, hs - 180., abs(p));
    if (m.x * m.y > 0.) { vec2 uv = (p + hs) / uHiSize.y; r.y = mix(r.y, texture(uHiMars, uv).r, m.x * m.y); }
  }
  return r;
}

/** Sedimentary benches: height snaps toward bed tops, so slopes read as stacked layers. */
float strata(float h, vec2 p, float bed, float amt){
  float s = h / bed + fbm(p * .0012, 2) * .6;
  float t = floor(s) + smoothstep(.45, 1., fract(s));
  return (t - s) * bed * amt;
}

/** Procedural relief per world, below the measured posts (illustrative). Evaluated once, in the bake pass. */
vec4 detailProc(vec2 p, vec4 m, float fine){
  vec4 h = vec4(0.);
  { // Moon: impact craters across four scales over gentle undulation
    float d = craters(p, 1150., .16).x + craters(p + 37., 430., .3).x + craters(p + 71., 165., .42).x * .9 + fbm(p * .0035, 4) * 6.;
    // finest relief stays above the bake's texel size (~5 m); smaller craters alias into speckle, so the detail maps carry them
    d += (craters(p + 13., 62., .45).x * .8 + craters(p + 5., 140., .35).x * .35) * fine;
    h.x = d;
  }
  { // Mars: wind-carved ridges, a few old craters and sedimentary benches
    vec2 q = rot2(p, .55);
    float d = fbm(p * .0032, 4) * 8. + ridged(q * vec2(.0026, .0075) + fbm(p * .001, 2) * 1.5, 4) * 5. - 2.5 + craters(p + 91., 380., .22).x * .45;
    d += strata(m.y + d, p, 9., .75 * smoothstep(-.3, .2, fbm(p * .0004, 2)));
    d += (fbm(p * .04, 3) * 1.1 + ridged(q * vec2(.012, .05), 2) * 2. + craters(p + 3., 34., .35).x * .5) * fine;
    h.y = d;
  }
  { // Earth, desert basin: gullied ranges with banded beds, smooth floor
    float range = smoothstep(40., 380., m.z);
    float d = ridged(p * .0021, 5) * (4. + 38. * range) - 2. - 18. * range;
    d += strata(m.z + d, p, 22., .12 * range);
    d += fbm(p * .045, 3) * (.5 + 1.5 * range) * fine;
    h.z = d;
  }
  { // Earth, volcanic highland: rough lava-field relief
    float d = fbm(p * .006, 4) * 6. + ridged(p * .0035, 4) * 9.;
    d += (fbm(p * .05, 3) * 1.6 + ridged(p * .024, 3) * 2.2) * fine;
    h.w = d;
  }
  return h;
}

uniform sampler2D uDetailNear; // baked detailProc, one channel per world
uniform sampler2D uDetailFar;
uniform vec3 uNearRect;        // centre x, centre z, size (m)
uniform vec3 uFarRect;
vec4 detail4(vec2 p){
  vec2 un = (p - uNearRect.xy) / uNearRect.z + .5;
  vec2 uf = (p - uFarRect.xy) / uFarRect.z + .5;
  vec4 far = texture(uDetailFar, uf);
  vec2 e = smoothstep(vec2(0.), vec2(.04), un) * smoothstep(vec2(1.), vec2(.96), un);
  float k = e.x * e.y;
  return k > 0. ? mix(far, texture(uDetailNear, un), k) : far;
}

float probeMask(vec2 p){ if (uProbe.z <= 0.) return 0.; return 1. - smoothstep(uProbe.z - uProbe.w, uProbe.z, length(p - uProbe.xy)); }
vec4 worldsAt(vec2 p){ return mix(uW, uPW, probeMask(p)); }

float heightW(vec2 p, vec4 w, float lod){ return dot(measured(p), w) + dot(detail4(p), w) + uProbeOff * probeMask(p); }
float coarseH(vec2 p){ return dot(measured(p), worldsAt(p)) + uProbeOff * probeMask(p); }
float lodAt(float dist){ return smoothstep(500., 3200., dist); }
`;

/** Skies, sunlight and air, shared by the terrain, the boulders and the sky dome so they always agree. */
export const LIGHT = /* glsl */`
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec4 uAtmo;            // earth, mars, moon, space

vec3 skyEarth(vec3 v, vec3 L){
  float mu = dot(v, L); float up = clamp(v.y, 0., 1.);
  vec3 s = mix(vec3(.58, .69, .84), vec3(.13, .29, .62), pow(up, .5));
  float sunLow = 1. - smoothstep(.0, .35, L.y);
  s = mix(s, vec3(.98, .64, .4), sunLow * pow(max(mu, 0.), 3.) * .75 * (1. - up));
  s += uSunCol * (pow(max(mu, 0.), 10.) * .22 + pow(max(mu, 0.), 120.) * .5);
  s *= .2 + .8 * smoothstep(-.12, .2, L.y);
  return s;
}
/** Mars: butterscotch dust by day; the forward-scattering aureole around the Sun is pale and cool. */
vec3 skyMars(vec3 v, vec3 L){
  float mu = dot(v, L); float up = clamp(v.y, 0., 1.);
  vec3 s = mix(vec3(.74, .52, .34), vec3(.31, .19, .12), pow(up, .55));
  float horizonGlow = exp(-max(v.y, 0.) * 9.);
  s = mix(s, vec3(.86, .63, .42), horizonGlow * .45);
  s = mix(s, vec3(.72, .78, .86), pow(max(mu, 0.), 28.) * .7);
  s += uSunCol * (pow(max(mu, 0.), 6.) * .1 + pow(max(mu, 0.), 900.) * .55);
  s *= .18 + .82 * smoothstep(-.12, .22, L.y);
  return s;
}
vec3 skyColor(vec3 v, vec3 L, vec4 a){ return skyEarth(v, L) * a.x + skyMars(v, L) * a.y; }

/** Aerial perspective: extinction plus in-scattered sky light, thinner with altitude. */
vec3 applyAir(vec3 col, vec3 pos, float dist, vec3 viewDir, vec3 L, vec4 a){
  float avgY = max((pos.y + uCam.y) * .5, -2000.);
  float denE = exp(-max(avgY, 0.) / 8500.), denM = exp(-max(avgY, 0.) / 11000.);
  float fogE = 1. - exp(-dist / 52000. * denE);
  float fogM = 1. - exp(-dist / 24000. * denM);
  float fog = clamp(fogE * a.x + fogM * a.y, 0., 1.);
  vec3 sky = skyColor(viewDir, L, a);
  vec3 sunScatter = uSunCol * pow(max(dot(viewDir, L), 0.), 8.) * (.14 * a.x + .3 * a.y) * fog;
  return mix(col, sky, fog) + sunScatter;
}

`;

/** Long-range soft shadow against the measured ground. Needs COMMON. */
export const SHADOW = /* glsl */`
float softShadowCoarse(vec3 p, vec3 L, float t0){
  float res = 1., t = t0;
  for (int i = 0; i < 36; i++){
    vec3 q = p + L * t;
    if (q.y > 7000.) break;
    float d = q.y - coarseH(q.xz);
    res = min(res, 10. * d / t);
    if (res < -.2) break;
    t = t * 1.16 + 8.;
    if (t > 32000.) break;
  }
  return res;
}
`;

export const TERRAIN_VERT = /* glsl */`
${COMMON}
uniform float uExtent;
uniform vec2 uGridCenter;      // camera position snapped to the grid's finest spacing
varying vec3 vPos;
varying float vDrop;
void main(){
  vec2 g = vec2(position.x, -position.y);                 // [-1, 1] grid (flipped so triangles face up)
  vec2 a = abs(g);
  vec2 p = uGridCenter + sign(g) * (.028 * a + .972 * a * a * a * a) * uExtent;
  float dist = length(vec3(p.x, 0., p.y) - vec3(uCam.x, 0., uCam.z));
  vec4 w = worldsAt(p);
  float h = heightW(p, w, lodAt(dist));
  vec2 d = p - uCam.xz;
  float drop = dot(d, d) / (2. * uRadius);
  vPos = vec3(p.x, h, p.y);
  vDrop = drop;
  gl_Position = projectionMatrix * viewMatrix * vec4(p.x, h - drop, p.y, 1.);
}`;

export const TERRAIN_FRAG = /* glsl */`
precision highp float;
${COMMON}
${LIGHT}
${SHADOW}
uniform sampler2D uTexRegolith;
uniform sampler2D uTexRock;
uniform sampler2D uTexSand;
uniform float uContours;       // measured-contour overlay
uniform float uSurvey;         // measured-boundary overlay
uniform float uFidelity;       // fidelity field (method)
uniform float uScan;           // scan position (method), -1 = none
uniform vec4 uGapOpen0;        // fissure openings 0..3
uniform vec2 uGapOpen1;        // fissure openings 4..5
uniform float uGapFocus;       // highlighted fissure index, -1 = none
uniform float uSlopeLimit;     // degrees, 0 = off
uniform vec3 uRange;           // x, z, radius of a reachable range ring (0 = off)
uniform vec4 uMarker;          // x, z, radius, kind (1 landing ellipse, 2 launch pad)
uniform vec3 uReticle;         // x, z, alpha
uniform float uReveal;         // opening sequence 0..1
varying vec3 vPos;
varying float vDrop;

/** Detail map sample with anti-tiling: two scales/rotations blended by a slow noise. xyz = (height, nx, nz), w = cavity. */
vec4 detailMap(sampler2D t, vec2 p, float s){
  vec2 u1 = p / s, u2 = rot2(p, .93) / (s * 1.73) + .37;
  vec4 a = texture(t, u1), b = texture(t, u2);
  vec2 na = a.yz * 2. - 1., nb = rot2(b.yz * 2. - 1., -.93);
  float k = smoothstep(-.35, .35, vnoise(p / (s * 2.9) + 7.));
  return vec4(mix(a.x, b.x, k), mix(na, nb, k), mix(a.w, b.w, k));
}
/** Same, projected on the vertical plane facing the slope, so cliffs get rock texture instead of stretching. */
vec4 detailSide(sampler2D t, vec3 pos, vec3 N, float s){
  vec2 uv = abs(N.x) > abs(N.z) ? pos.zy : pos.xy;
  vec4 a = texture(t, uv / s);
  return vec4(a.x, a.yz * 2. - 1., a.w);
}

/** Shadows: a short march against the detailed ground (crater walls, ridges), then the long coarse march. */
float sunShadow(vec3 pos, vec3 L, vec4 w, float dist){
  if (L.y < -.03) return 0.;
  float res = 1., t = 1.5;
  if (dist < 7000.) {
    for (int i = 0; i < 14; i++){
      vec3 q = pos + L * t;
      float d = q.y - heightW(q.xz, w, 1.);
      res = min(res, 7. * d / t);
      if (res < -.2) break;
      t = t * 1.42 + 1.;
    }
  }
  res = min(res, softShadowCoarse(vec3(pos.x, coarseH(pos.xz) + 3., pos.z), L, max(t, 40.)));
  return smoothstep(-.15, 1., res);
}

/** Height-field obscurance: how much nearby ground rises above this point. */
float heightAO(vec2 p, float h0, vec4 w){
  float occ = 0.;
  for (int i = 0; i < 6; i++){
    float a = float(i) * 1.047 + .4; float r = i < 3 ? 22. : 110.;
    vec2 q = p + vec2(cos(a), sin(a)) * r;
    occ += max(heightW(q, w, 1.) - h0, 0.) / r;
  }
  return clamp(1. - occ * .42, .25, 1.);
}

/** Fissures for "what Earth cannot test": meandering voids that open across the ground. */
float fissure(vec2 p, int i, out float along){
  float a = float(i) * 1.047 + .35; vec2 dir = vec2(cos(a), sin(a)); vec2 nrm = vec2(-dir.y, dir.x);
  vec2 c = vec2(sin(float(i) * 2.3) * 1400., cos(float(i) * 1.7) * 1400.);
  vec2 q = p - c; float s = dot(q, dir); along = s;
  float meander = sin(s * .0021 + float(i)) * 140. + fbm(vec2(s * .006, float(i) * 9.), 3) * 70.;
  return abs(dot(q, nrm) + meander);
}

void main(){
  vec2 p = vPos.xz;
  float dist = length(vec3(p.x, vPos.y - vDrop, p.y) - uCam);
  float lod = lodAt(dist);
  vec4 w = worldsAt(p);
  vec4 m = measured(p);
  float relH = dot(m, w);
  float e = max(6., dist * .0014);                       // at least one baked texel: no bilinear facets in the shading
  float h0 = heightW(p, w, lod), hx = heightW(p + vec2(e, 0.), w, lod), hz = heightW(p + vec2(0., e), w, lod);
  vec3 Nm = normalize(vec3(h0 - hx, e, h0 - hz));
  // measured-scale slope (what a traverse planner sees), independent of procedural relief
  float ec = 20.;
  vec3 Nc = normalize(vec3(relH - dot(measured(p + vec2(ec, 0.)), w), ec, relH - dot(measured(p + vec2(0., ec)), w)));
  float slopeM = degrees(acos(clamp(Nc.y, 0., 1.)));
  float slope = degrees(acos(clamp(Nm.y, 0., 1.)));
  vec3 pos = vec3(p.x, h0, p.y);
  vec4 atmo = vec4(w.z + w.w, w.y, w.x, 0.) * (1. - uAtmo.w);
  vec3 V = normalize(uCam - vec3(p.x, vPos.y - vDrop, p.y));
  vec3 L = uSunDir;
  float steep = smoothstep(22., 40., slope);

  // ---------- Surface detail (mipmapped maps: no shimmer at distance) ----------
  vec4 dReg = detailMap(uTexRegolith, p, 38.);
  vec4 dRegL = detailMap(uTexRegolith, p + 311., 290.);
  vec4 dRock = detailMap(uTexRock, p, 46.);
  vec4 dRockS = detailSide(uTexRock, pos, Nm, 60.);
  vec4 dSand = detailMap(uTexSand, rot2(p, .55), 24.);
  float nearK = 1. - smoothstep(1500., 9000., dist);

  vec2 nMoon = mix(dReg.yz * .9 + dRegL.yz * .6, dRockS.yz * 1.1, steep);
  float cavMoon = mix(dReg.w * mix(1., dRegL.w, .6), dRockS.w, steep);
  float dusty = 1. - smoothstep(8., 22., slope);
  vec2 nMars = mix(mix(dRock.yz, dRockS.yz, steep) * 1.1, dSand.yz * .8, dusty * .8);
  float cavMars = mix(mix(dRock.w, dRockS.w, steep), dSand.w, dusty * .8);
  vec4 dSalt = detailMap(uTexRock, p + 71., 26.);
  vec2 nEA = mix(dSalt.yz * .6, mix(dRock.yz, dRockS.yz, steep), smoothstep(30., 140., m.z));
  float cavEA = mix(mix(1., dSalt.w, .5), dRock.w, smoothstep(30., 140., m.z));
  vec2 nEB = mix(dRock.yz, dSand.yz * .6, dusty * .5);
  float cavEB = dRock.w;
  vec2 tn = (nMoon * w.x + nMars * w.y + nEA * w.z + nEB * w.w) * nearK;
  float cav = mix(1., cavMoon * w.x + cavMars * w.y + cavEA * w.z + cavEB * w.w, nearK);
  vec3 N = normalize(Nm + vec3(tn.x, 0., tn.y) * .55);

  // ---------- Materials ----------
  float n1 = fbm(p * .0017, 4), n2 = fbm(p * .013, 3);
  // Moon: highland regolith; fresh craters wear bright ejecta, steep walls expose brighter, less weathered rock.
  float halo = 0.;
  if (w.x > .001 && dist < 12000.) halo = craters(p + 37., 430., .3).y * .7 + craters(p + 71., 165., .42).y;
  vec3 moonA = vec3(.132, .118, .1) * (1. + .2 * n1 + .08 * n2);                     // warm-beige highland regolith
  moonA = mix(moonA, vec3(.1, .106, .122), smoothstep(.05, .6, -n1) * .7);           // cooler, bluish mature soil in the lows
  moonA = mix(moonA, vec3(.145, .122, .096), smoothstep(.35, .8, n2) * .35);         // faint brownish patches of iron-rich soil
  moonA *= (1. + .3 * fbm(p * .00045 + 3., 3)) * (1. + .6 * clamp(halo, 0., 1.) + .3 * steep);
  // Mars: oxidised dust on the flats, dark basaltic sand in hollows, banded sediments on slopes.
  float hollow = smoothstep(.1, -.45, fbm(p * .0011, 3) + (m.y - dot(measured(p + vec2(300., 0.)), vec4(0., 1., 0., 0.))) * .004);
  vec3 dust = mix(vec3(.47, .25, .12), vec3(.56, .33, .17), n2 * .5 + .5);
  vec3 basaltSand = vec3(.16, .11, .085);
  float band = sin(h0 * .62 + fbm(p * .002, 3) * 4.) * .5 + .5;
  vec3 beds = mix(vec3(.38, .2, .1), mix(vec3(.62, .44, .28), vec3(.29, .17, .11), step(.5, fract(h0 * .041 + n1))), band * .55);
  vec3 marsA = mix(dust, basaltSand, hollow * .75);
  marsA = mix(marsA, beds, steep * .85 + smoothstep(9., 20., slope) * .3);
  if (uHiSize.y > 0.) {
    float hs = uHiSize.y * .5; vec2 mm = smoothstep(hs, hs - 160., abs(p));
    float ortho = texture(uMarsAlbedo, (p + hs) / uHiSize.y).r;
    marsA = mix(marsA, marsA * (ortho * 2.1 + .1), mm.x * mm.y * .75);
  }
  // Earth, Moon analogue (desert basin): salt-pan polygons, alluvial fans, varnished banded ranges.
  float elevA = m.z;
  vec3 salt = mix(vec3(.9, .87, .8), vec3(.7, .65, .57), smoothstep(.2, .8, n2 * .5 + .5 + .3 * fbm(p * .004, 3))) * (.78 + .22 * dSalt.w);
  vec3 fan = mix(vec3(.44, .36, .27), vec3(.57, .48, .36), n2 * .5 + .5);
  float bandsA = smoothstep(-.6, .6, sin(h0 * .031 + fbm(p * .0009, 4) * 5.)) * .55 + .2 * (n2 * .5 + .5);
  vec3 range = mix(vec3(.2, .155, .125), vec3(.4, .27, .19), smoothstep(-.4, .5, n1));
  range = mix(range, vec3(.47, .33, .22), bandsA * .3);
  range = mix(range, vec3(.36, .37, .28), smoothstep(.82, .97, bandsA) * .3);           // the greenish beds of the Black Mountains
  vec3 earthA = mix(salt, fan, smoothstep(10., 70., elevA + n1 * 25.));
  earthA = mix(earthA, range, smoothstep(8., 22., slope + n2 * 5.) * smoothstep(20., 140., elevA));
  // Earth, Mars analogue (volcanic highland): basalt, moss on gentle ground, late snow on the heights.
  vec3 basalt = vec3(.055, .054, .056) * (1. + .4 * n2);
  vec3 moss = mix(vec3(.12, .15, .065), vec3(.2, .23, .11), n2 * .5 + .5);
  vec3 earthB = mix(moss, basalt, smoothstep(6., 18., slope + n1 * 8.));
  earthB = mix(earthB, vec3(.82, .85, .9), smoothstep(380., 470., m.w + n1 * 70.) * smoothstep(25., 8., slope) * .9);
  vec3 albedo = moonA * w.x + marsA * w.y + earthA * w.z + earthB * w.w;
  albedo *= mix(1., .55 + .45 * cav, .85);

  // ---------- Lighting ----------
  float NL = max(dot(N, L), 0.);
  // shadow is decided by the landform, not the fine texture normal: no speckled terminator along crater rims
  float sh = dot(Nm, L) > -.2 ? sunShadow(pos + Nm * .4, L, w, dist) : 0.;
  sh *= smoothstep(-.2, .08, dot(Nm, L));
  float ao = (dist < 9000. ? heightAO(p, h0, w) : 1.) * mix(1., cav, .6);
  float mu = max(dot(N, V), .04);
  float phase = acos(clamp(dot(L, V), -1., 1.));
  float lommel = NL / (NL + mu) * (1. + .25 * exp(-phase * 9.)) * 1.7;                 // regolith: flat limb, opposition surge
  float brdf = mix(NL, mix(lommel, NL, .2), w.x + w.y * .3);
  vec3 key = uSunCol * brdf * sh;
  vec3 skyUp = skyColor(normalize(vec3(0., 1., 0.) + L * .3), L, atmo) * (.85 * atmo.x + 1.1 * atmo.y);
  vec3 sky = skyUp * (.55 + .45 * N.y) * ao;
  vec3 earthshine = vec3(.009, .014, .026) * atmo.z * ao;
  // light reflected from the sunlit ground around this point: what keeps lunar shadows from going dead black
  vec3 bounce = albedo * uSunCol * max(L.y, 0.) * (.36 * atmo.z + .4 * (atmo.x + atmo.y)) * (.55 - .45 * N.y) * ao;
  // regolith scatters light many times: a faint, even fill that keeps crater floors from reading as holes
  vec3 fill = uSunCol * max(L.y + .05, 0.) * .12 * atmo.z * ao;
  vec3 col = albedo * (key + sky + earthshine + fill) + albedo * bounce;
  // salt and wet sand catch a soft sheen at grazing angles
  vec3 H = normalize(L + V);
  col += uSunCol * pow(max(dot(N, H), 0.), 60.) * .04 * w.z * (1. - smoothstep(10., 70., elevA)) * sh;

  // ---------- Overlays (thin, instrument-like) ----------
  if (uContours > 0.) {
    float c10 = abs(fract(relH / 10. + .5) - .5) / max(fwidth(relH / 10.), 1e-4);
    float c50 = abs(fract(relH / 50. + .5) - .5) / max(fwidth(relH / 50.), 1e-4);
    float inside = 0.;
    if (uHiSize.x > 0.) { vec2 mm = step(abs(p), vec2(uHiSize.x * .5)); inside = max(inside, mm.x * mm.y * w.x); }
    if (uHiSize.y > 0.) { vec2 mm = step(abs(p), vec2(uHiSize.y * .5)); inside = max(inside, mm.x * mm.y * w.y); }
    float line = (1. - smoothstep(.0, 1.1, c10)) * .3 + (1. - smoothstep(.0, 1.3, c50)) * .8;
    col = mix(col, vec3(.92, .88, .8) * (.05 + .1 * NL), line * uContours * inside * .55 * (1. - lod));
  }
  if (uSurvey > 0.) {
    for (int k = 0; k < 2; k++){
      float s = (k == 0 ? uHiSize.x * w.x : uHiSize.y * w.y) * .5;
      if (s <= 0.) continue;
      vec2 d = abs(p) - s; float edge = abs(max(d.x, d.y));
      float pxw = max(fwidth(p.x), fwidth(p.y));
      float line = 1. - smoothstep(pxw * .5, pxw * 1.5, edge);
      float corner = step(max(abs(p.x), abs(p.y)), s + 1.) * step(s * .9, min(abs(p.x), abs(p.y)));
      col += vec3(1., .9, .72) * line * (.18 + .9 * corner) * uSurvey;
    }
  }
  if (uFidelity > 0.) {
    // Local likeness between the analogue and its target: matching slope reads warm, mismatch stays dark.
    vec4 wt = vec4(w.z, w.w, w.x, w.y);
    // central differences at two baselines: a smooth field, free of the regional grid's posts
    float diff = 0.;
    for (int k = 0; k < 2; k++){
      float ee = k == 0 ? 150. : 420.;
      vec4 mx0 = measured(p - vec2(ee, 0.)), mx1 = measured(p + vec2(ee, 0.)), mz0 = measured(p - vec2(0., ee)), mz1 = measured(p + vec2(0., ee));
      float st = degrees(atan(length(vec2(dot(mx1 - mx0, wt), dot(mz1 - mz0, wt))) / (2. * ee)));
      float sa = degrees(atan(length(vec2(dot(mx1 - mx0, w), dot(mz1 - mz0, w))) / (2. * ee)));
      diff += abs(st - sa) * (k == 0 ? .6 : .4);
    }
    float like = exp(-diff / 4.5);
    float bandL = abs(fract(like * 5.) - .5);
    vec3 heat = mix(vec3(.03, .085, .1), vec3(.16, .3, .3), smoothstep(.1, .45, like));       // mismatch: deep teal
    heat = mix(heat, vec3(1., .62, .27), smoothstep(.4, .95, like));                          // likeness: warm amber
    float lum = dot(col, vec3(.3, .5, .2));
    col = mix(col, lum * .35 + heat * heat * (.35 + .75 * NL * sh) * (.7 + .3 * ao), uFidelity * .88);
    col += vec3(1., .82, .55) * (1. - smoothstep(0., fwidth(like * 5.) * 1.2, bandL)) * .035 * uFidelity;
    if (uScan > -1.) {
      float sd = p.x - uScan;
      col += vec3(1., .78, .5) * exp(-sd * sd / 16000.) * .18 * uFidelity;
      col *= mix(1., .72 + .28 * smoothstep(400., -200., sd), uFidelity * .6);
    }
  }
  if (uSlopeLimit > 0.) {
    // terrain steeper than the limit, judged at the measured scale: a calm amber wash with a crisp boundary
    float over = smoothstep(uSlopeLimit - .4, uSlopeLimit + .4, slopeM);
    float edge = abs(slopeM - uSlopeLimit) / max(fwidth(slopeM), 1e-3);
    col = mix(col, col * .45 + vec3(.55, .2, .06) * (.08 + .25 * NL), over * .55);
    col += vec3(1., .6, .3) * (1. - smoothstep(.4, 1.3, edge)) * .16;
  }
  if (uRange.z > 0.) {
    float r = length(p - uRange.xy); float pxw = fwidth(r);
    col += vec3(1., .9, .72) * (1. - smoothstep(pxw * .6, pxw * 1.8, abs(r - uRange.z))) * .9;
    float ticks = step(.975, fract(atan(p.y - uRange.y, p.x - uRange.x) / 6.2832 * 72.)) * (1. - smoothstep(0., 30., abs(r - uRange.z + 24.)));
    col += vec3(1., .9, .72) * ticks * .5;
  }
  if (uMarker.w > 0.) {
    vec2 d = p - uMarker.xy;
    if (uMarker.w < 1.5) d *= vec2(1., 1.9);
    float r = length(d), pxw = fwidth(r);
    for (int k = 1; k <= 3; k++) col += vec3(1., .8, .5) * (1. - smoothstep(pxw * .6, pxw * 1.8, abs(r - uMarker.z * float(k) / 3.))) * (.9 - float(k) * .2);
    col += vec3(1., .82, .55) * (1. - smoothstep(0., pxw * 1.5, min(abs(d.x), abs(d.y)))) * step(r, uMarker.z * 1.12) * .35;
  }
  float pm = probeMask(p);
  if (uProbe.z > 0.) {
    float r = length(p - uProbe.xy); float pxw = fwidth(r);
    col += vec3(1., .95, .86) * (1. - smoothstep(pxw, pxw * 2.5, abs(r - uProbe.z))) * 1.3;
    float cl = abs(fract(relH / 6. + .5) - .5) / max(fwidth(relH / 6.), 1e-4);
    col += vec3(1., .9, .75) * (1. - smoothstep(0., 1., cl)) * pm * .05;
  }
  if (uReticle.z > 0.) {
    float r = length(p - uReticle.xy); float pxw = fwidth(r);
    float ring = 1. - smoothstep(pxw, pxw * 2.2, abs(r - 90.));
    float ang = atan(p.y - uReticle.y, p.x - uReticle.x);
    float gaps = step(.18, abs(fract(ang / 1.5708) - .5));
    col += vec3(1., .95, .86) * ring * gaps * uReticle.z * .9;
    col += vec3(1., .95, .86) * (1. - smoothstep(pxw, pxw * 2.2, r - 4.)) * uReticle.z;
  }

  // ---------- Fissures ----------
  float voidMask = 0., rim = 0., glowIn = 0.;
  for (int i = 0; i < 6; i++){
    float open = i < 4 ? uGapOpen0[i] : uGapOpen1[i - 4];
    if (open < .01) continue;
    float s; float d = fissure(p, i, s);
    float len = 3600. + float(i) * 400.;
    float taper = 1. - smoothstep(len * .55, len, abs(s));
    float width = open * taper * (70. + 40. * float(i % 3));
    float focus = uGapFocus == float(i) ? 1. : 0.;
    width *= 1. + focus * .7;
    float pxw = fwidth(d);
    float inside = 1. - smoothstep(width - pxw, width + pxw, d);
    voidMask = max(voidMask, inside);
    float live = taper * step(.01, width) * (1. + focus * 1.5);
    rim += ((1. - smoothstep(0., pxw * 2.2, abs(d - width))) * .9 + exp(-max(d - width, 0.) / 28.) * step(width, d) * .22) * live;
    // light spilling a short way down the walls before the dark takes over
    glowIn = max(glowIn, exp(-max(width - d, 0.) / 14.) * step(d, width) * live);
    col *= 1. - (1. - smoothstep(width, width + 40. + 30. * open, d)) * .45 * taper * open;
  }
  col = mix(col, vec3(1., .5, .2) * .05 * glowIn, voidMask);
  col += vec3(1., .62, .28) * min(rim, 1.6) * 1.6;

  // ---------- Air ----------
  col = applyAir(col, vec3(p.x, vPos.y - vDrop, p.y), dist, -V, L, atmo);
  col *= uReveal;
  gl_FragColor = vec4(col, 1.);
}`;

/** Boulders: real instanced geometry, seated on the same ground function the terrain uses. */
export const ROCK_VERT = /* glsl */`
${COMMON}
attribute vec4 aRock;          // x, z offset inside the repeating tile; scale; seed
uniform float uTile;
uniform float uRockScale;
varying vec3 vWorld;
varying vec3 vNormalW;
varying float vFade;
varying float vSeed;
varying vec3 vLocal;
void main(){
  vec2 off = aRock.xy;
  vec2 c = uCam.xz;
  vec2 xz = off + uTile * floor((c - off) / uTile + .5);
  float dist = length(xz - c);
  float field = smoothstep(-.15, .45, fbm(xz * .0011 + aRock.w, 3));   // rocks gather in fields, as ejecta does
  vec4 w = worldsAt(xz);
  // boulders thin out with distance well before they shrink to a pixel or two (which reads as dirt, not rock)
  float size = aRock.z * uRockScale * field * (1. - smoothstep(uTile * .16, uTile * .34, dist));
  size *= smoothstep(.0, .9, aRock.z / max(1., dist * .004));
  // fewer, smaller clasts on Earth's vegetated or salt-covered ground
  size *= w.x + w.y * .9 + w.z * .5 + w.w * .8;
  vFade = size;
  vSeed = aRock.w;
  float a = aRock.w * 6.2832;
  vec3 pl = position * vec3(1., .55 + .35 * fract(aRock.w * 7.3), .8 + .4 * fract(aRock.w * 3.1));
  pl.xz = rot2(pl.xz, a);
  vLocal = position;
  float g = heightW(xz, w, lodAt(dist));
  // seated a little proud of the exact ground: the rendered mesh interpolates between vertices metres apart
  vec3 wp = vec3(xz.x, g + .35 - size * .1, xz.y) + pl * size;
  vec3 nn = normal / vec3(1., .55 + .35 * fract(aRock.w * 7.3), .8 + .4 * fract(aRock.w * 3.1));
  nn.xz = rot2(nn.xz, a);
  vNormalW = normalize(nn);
  vWorld = wp;
  vec2 d = wp.xz - uCam.xz;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp.x, wp.y - dot(d, d) / (2. * uRadius), wp.z, 1.);
}`;

export const ROCK_FRAG = /* glsl */`
precision highp float;
${COMMON}
${LIGHT}
${SHADOW}
uniform sampler2D uTexRock;
uniform float uReveal;
varying vec3 vWorld;
varying vec3 vNormalW;
varying float vFade;
varying float vSeed;
varying vec3 vLocal;
void main(){
  if (vFade < .02) discard;
  vec3 N0 = normalize(vNormalW);
  // triplanar rock detail
  vec3 bw = pow(abs(N0), vec3(4.)); bw /= dot(bw, vec3(1.));
  float s = 3.2;
  vec4 tx = texture(uTexRock, vWorld.zy / s), ty = texture(uTexRock, vWorld.xz / s), tz = texture(uTexRock, vWorld.xy / s);
  vec3 nx = vec3(0., tx.y * 2. - 1., tx.z * 2. - 1.), ny = vec3(ty.y * 2. - 1., 0., ty.z * 2. - 1.), nz = vec3(tz.y * 2. - 1., tz.z * 2. - 1., 0.);
  vec3 N = normalize(N0 + (nx * bw.x + ny * bw.y + nz * bw.z) * .5);
  float cav = tx.w * bw.x + ty.w * bw.y + tz.w * bw.z;
  vec4 w = worldsAt(vWorld.xz);
  vec4 atmo = vec4(w.z + w.w, w.y, w.x, 0.) * (1. - uAtmo.w);
  float v = fract(vSeed * 13.7);
  vec3 moonR = mix(vec3(.12, .108, .092), vec3(.095, .1, .112), fract(vSeed * 5.3)) * (.85 + .45 * v);
  vec3 marsR = mix(vec3(.22, .13, .09), vec3(.46, .27, .14), smoothstep(.2, .9, N0.y) * .8);   // dust settles on top faces
  vec3 earthR = mix(vec3(.18, .12, .09), vec3(.3, .22, .16), v);
  vec3 iceR = vec3(.05, .05, .052);
  vec3 albedo = (moonR * w.x + marsR * w.y + earthR * w.z + iceR * w.w) * (.6 + .4 * cav);
  vec3 L = uSunDir;
  vec3 V = normalize(uCam - vWorld);
  float NL = max(dot(N, L), 0.);
  float sh = NL > 0. ? smoothstep(-.15, 1., softShadowCoarse(vec3(vWorld.x, coarseH(vWorld.xz) + 3., vWorld.z), L, 30.)) : 0.;
  float ground = clamp(vLocal.y * .5 + .6, 0., 1.);                   // contact darkening near the ground
  float ao = (.35 + .65 * ground) * (.6 + .4 * cav);
  vec3 skyUp = skyColor(normalize(vec3(0., 1., 0.) + L * .3), L, atmo) * (.9 * atmo.x + 1.15 * atmo.y);
  vec3 col = albedo * (uSunCol * NL * sh + skyUp * (.5 + .5 * N.y) * ao + vec3(.006, .008, .012) * atmo.z * ao);
  col += albedo * albedo * uSunCol * max(L.y, 0.) * (.3 + .45 * (atmo.x + atmo.y)) * (.5 - .5 * N.y) * ao;
  // dust and air scatter light around a backlit block: a thin warm rim
  float rimK = pow(1. - max(dot(N, V), 0.), 3.) * pow(max(dot(-V, L), 0.), 2.);
  col += uSunCol * rimK * (.05 * atmo.z + .35 * atmo.y + .2 * atmo.x) * mix(vec3(1.), vec3(1., .8, .6), atmo.y);
  float dist = length(vWorld - uCam);
  col += albedo * vec3(.009, .014, .026) * atmo.z * (1. - NL * sh);                    // earthshine fills the shaded faces
  col = applyAir(col, vWorld, dist, -V, L, atmo);
  gl_FragColor = vec4(col * uReveal, 1.);
}`;

/** Bake pass: writes detailProc for a square region into a float target. */
export const BAKE_VERT = /* glsl */`
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`;
export const BAKE_FRAG = /* glsl */`
precision highp float;
${COMMON}
uniform vec3 uRect;
uniform float uFine;
varying vec2 vUv;
void main(){
  vec2 p = uRect.xy + (vUv - .5) * uRect.z;
  gl_FragColor = detailProc(p, measured(p), uFine);
}`;

export const SKY_VERT = /* glsl */`
varying vec2 vNdc;
void main(){ vNdc = position.xy; gl_Position = vec4(position.xy, 1., 1.); }`;

export const SKY_FRAG = /* glsl */`
precision highp float;
uniform vec3 uCam;
${LIGHT}
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
uniform sampler2D uEarthTex;
uniform sampler2D uMoonTex;
uniform vec3 uEarthDir;       // direction of Earth in the lunar sky
uniform float uEarthSize;     // angular radius (rad)
uniform float uTime;
uniform float uReveal;
uniform vec3 uMoonDir;        // finale: the Moon above Earth's limb
uniform float uMoonSize;
uniform float uAlt;           // finale altitude (km)
varying vec2 vNdc;

float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec3 stars(vec3 d){
  vec3 c = vec3(0.);
  for (int k = 0; k < 3; k++){
    float sc = 200. + float(k) * 230.;
    vec2 uv = vec2(atan(d.z, d.x), asin(clamp(d.y, -1., 1.))) * sc / 3.14159;
    vec2 id = floor(uv), f = fract(uv) - .5;
    float h = hash12(id + float(k) * 31.);
    if (h > .968){
      vec2 o = vec2(hash12(id + 7.), hash12(id + 3.)) - .5;
      float dd = length(f - o * .7);
      float b = pow(hash12(id + 1.), 7.) * 2.2 + .08;
      vec3 tint = mix(vec3(1., .84, .7), vec3(.78, .86, 1.), hash12(id + 5.));
      c += tint * b * smoothstep(.07, .0, dd);
    }
  }
  return c;
}
vec2 sphereUV(vec3 n){ return vec2(.5 + atan(n.x, -n.z) / 6.28318, .5 + asin(clamp(n.y, -1., 1.)) / 3.14159); }

/** A textured body seen as a disc: n = local sphere normal from the disc offset. */
vec3 bodyDisc(vec3 v, vec3 dir, float size, sampler2D tex, vec3 L, float rot, out float a){
  vec3 up = abs(dir.y) > .99 ? vec3(1., 0., 0.) : vec3(0., 1., 0.);
  vec3 r = normalize(cross(up, dir)), u = cross(dir, r);
  vec2 q = vec2(dot(v, r), dot(v, u)) / size;
  float d2 = dot(q, q); a = smoothstep(1., .985, sqrt(d2));
  if (d2 > 1.) return vec3(0.);
  vec3 n = normalize(r * q.x + u * q.y - dir * sqrt(1. - d2));
  vec3 nl = vec3(n.x * cos(rot) - n.z * sin(rot), n.y, n.x * sin(rot) + n.z * cos(rot));
  vec3 alb = texture(tex, sphereUV(nl)).rgb;
  alb = pow(alb, vec3(2.2));
  float lit = max(dot(n, L), 0.);
  return alb * lit;
}

void main(){
  vec4 vp = uInvProj * vec4(vNdc, 1., 1.); vec3 v = normalize((uCamWorld * vec4(normalize(vp.xyz / vp.w), 0.)).xyz);
  vec3 L = uSunDir;
  vec3 col = vec3(0.);
  float vis = 1. - uAtmo.x * smoothstep(-.1, .3, L.y) - uAtmo.y * .92;
  col += stars(v) * max(vis, 0.) * .8;

  float mu = dot(v, L);
  // Sun: a hard disc in vacuum; a smaller, softened disc through Martian dust
  float discR = mix(.99998, .99999, uAtmo.y);
  float disc = smoothstep(discR - .00002, discR, mu);
  col += vec3(1., .97, .92) * disc * 9. * (uAtmo.z + uAtmo.x + uAtmo.y * .7);
  col += uSunCol * pow(max(mu, 0.), 1600.) * 2.5 * uAtmo.z;

  // Earth over the lunar horizon
  if (uAtmo.z > 0.) {
    float a;
    vec3 e = bodyDisc(v, uEarthDir, uEarthSize, uEarthTex, L, uTime * .004 + 2.1, a);
    vec3 up = vec3(0., 1., 0.); vec3 r = normalize(cross(up, uEarthDir)), u = cross(uEarthDir, r);
    vec2 q = vec2(dot(v, r), dot(v, u)) / uEarthSize; float d = length(q);
    vec2 l2 = normalize(vec2(dot(L, r), dot(L, u)) + 1e-4);
    float limb = exp(-((d - 1.) * 22.) * ((d - 1.) * 22.)) * smoothstep(-.3, .7, dot(normalize(q + 1e-4), l2));
    e = mix(vec3(dot(e, vec3(.3, .55, .15))), e, .62) * vec3(.92, .97, 1.08);
    col = mix(col, e * 1.8 + vec3(.004, .006, .01) * a, a * uAtmo.z);
    col += vec3(.3, .5, 1.) * limb * .5 * uAtmo.z;
  }

  col = mix(col, skyEarth(v, L), uAtmo.x * smoothstep(-.35, .0, v.y + .2));
  col = mix(col, skyMars(v, L), uAtmo.y * smoothstep(-.35, .0, v.y + .2));

  // ---------- Finale: Earth's limb from orbit with the Moon rising over it ----------
  if (uAtmo.w > 0.) {
    float Re = 6371.;
    vec3 o = vec3(0., Re + uAlt, 0.);
    vec3 sp = vec3(0.);
    float b = dot(o, v), c = dot(o, o) - Re * Re, disc2 = b * b - c;
    float tangentAlt = length(o - v * dot(o, v)) - Re;
    vec3 Ls = normalize(vec3(.95, -.06, -.3));
    float sunSide = smoothstep(-.6, .9, dot(v, Ls));
    vec3 space = stars(v) * .3;
    float ma; float lowness = smoothstep(55., 0., tangentAlt);
    vec3 moon = bodyDisc(v, uMoonDir, uMoonSize, uMoonTex, normalize(vec3(.35, .12, .93)), 0., ma);
    moon = moon * 1.6 * mix(vec3(1.), vec3(1., .55, .32), lowness);
    space = mix(space, moon, ma * (1. - smoothstep(25., 0., tangentAlt) * .9));
    bool hitG = disc2 > 0. && -b - sqrt(disc2) > 0.;
    if (hitG) {
      float t = -b - sqrt(disc2); vec3 hit = normalize(o + v * t);
      vec2 uv = vec2(.5 + atan(hit.x, hit.y) / 6.28318 + .37, .5 + asin(clamp(hit.z, -1., 1.)) / 3.14159);
      vec3 ground = texture(uEarthTex, uv).rgb;
      sp = pow(ground, vec3(2.2)) * vec3(.03, .045, .07) * (.4 + sunSide);
    } else sp = space;
    float th = max(tangentAlt, 0.);
    vec3 shell = vec3(0.);
    shell += vec3(1., .42, .12) * exp(-th / 6.) * 1.6;
    shell += vec3(.95, .75, .45) * exp(-th / 11.) * .55;
    shell += vec3(.18, .42, 1.) * exp(-th / 24.) * 1.2;
    shell += vec3(.05, .12, .5) * exp(-th / 55.) * .5;
    shell += vec3(.3, 1., .5) * exp(-((th - 97.) / 2.2) * ((th - 97.) / 2.2)) * .045;
    shell *= (.12 + .7 * sunSide) * exp(min(tangentAlt, 0.) / 3.);
    sp += shell * (hitG ? .6 : 1.);
    col = mix(col, sp, uAtmo.w);
  }
  gl_FragColor = vec4(col * uReveal, 1.);
}`;

/** Grade: exposure, ACES (fitted RRT+ODT), per-world split toning, a light vignette and dithering. */
export const POST_FRAG = /* glsl */`
precision highp float;
uniform sampler2D tDiffuse;
uniform float uExposure;
uniform float uTime;
uniform float uFlash;
uniform vec3 uFlashCol;
uniform vec2 uRes;
uniform vec3 uVeil;            // x: left strength, y: right strength, z: overall
uniform float uVeilB;          // bottom-up veil for portrait layouts
uniform vec3 uShadowTint;
uniform vec3 uHighTint;
uniform float uSat;
uniform float uContrast;
varying vec2 vUv;
const mat3 ACESIn = mat3(.59719, .07600, .02840, .35458, .90834, .13383, .04823, .01566, .83777);
const mat3 ACESOut = mat3(1.60475, -.10208, -.00327, -.53108, 1.10813, -.07276, -.07367, -.00605, 1.07602);
vec3 rrt(vec3 v){ vec3 a = v * (v + .0245786) - .000090537; vec3 b = v * (.983729 * v + .4329510) + .238081; return a / b; }
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec3 toSRGB(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1. / 2.4)) - .055, step(.0031308, c)); }
void main(){
  vec2 uv = vUv;
  vec3 col = texture2D(tDiffuse, uv).rgb * uExposure;
  float veil = uVeil.x * (1. - smoothstep(.0, .62, uv.x)) + uVeil.y * smoothstep(.38, 1., uv.x) + uVeil.z
    + uVeilB * (1. - smoothstep(.0, .6, uv.y));          // portrait screens: text sits low, so the floor of the frame darkens instead
  col *= 1. - clamp(veil, 0., .92);
  col = mix(col, uFlashCol, uFlash);
  col = col * col / (col + .004);                        // soft toe: a faint bloom haze settles back to black, shadows keep their detail
  col = clamp(ACESOut * rrt(ACESIn * col / .6), 0., 1.);
  float l = dot(col, vec3(.2126, .7152, .0722));
  col = mix(vec3(l), col, uSat);
  col *= mix(uShadowTint, uHighTint, smoothstep(.05, .7, l));
  // contrast as a power curve around mid-grey: it deepens shadows without ever clipping them to zero
  // (a linear pivot at .5 pushed every dark value negative: dead-black shadows and coloured edge pixels)
  col = clamp(.18 * pow(max(col, vec3(0.)) / .18, vec3(uContrast)), 0., 1.);
  vec2 c = uv - .5;
  col *= 1. - smoothstep(.25, 1.1, dot(c, c) * 2.2) * .32;
  col = toSRGB(col);
  col += (hash12(uv * uRes + fract(uTime * 7.) * 91.) - .5) / 255.;
  gl_FragColor = vec4(col, 1.);
}`;
