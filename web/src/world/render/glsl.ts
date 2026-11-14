// GLSL for the world renderer. The shadow march is generated from analysis/illumination.ts constants.
// Curvature transforms use cancellation-free forms so float32 keeps ~mm precision near the site.
import { MARCH, SUN_ANGULAR_RADIUS_RAD } from '../analysis/illumination';

const f = (v: number) => (Number.isInteger(v) ? `${v}.0` : `${v}`);

export const GEODESY_GLSL = /* glsl */`
uniform float uRadius;
// map (x, y, h) -> ENU, u = h - 2 (R + h) sin^2(theta / 2)
vec3 aeqdToEnu(vec3 m) {
  float r = length(m.xy);
  if (r < 1e-3) return vec3(0.0, 0.0, m.z);
  float th = r / uRadius; float s = sin(th * 0.5);
  float k = sin(th) / r * (uRadius + m.z);
  return vec3(m.xy * k, m.z - 2.0 * (uRadius + m.z) * s * s);
}
// ENU -> map (x, y, h), h = u + hz^2 / (sqrt(hz^2 + v^2) + v)
vec3 enuToAeqd(vec3 p) {
  float hz = length(p.xy); float v = uRadius + p.z;
  if (hz < 1e-3) return vec3(p.xy, p.z);
  float th = atan(hz, v);
  return vec3(p.xy * (uRadius * th / hz), p.z + hz * hz / (sqrt(hz * hz + v * v) + v));
}`;

export const SHADOW_MARCH_GLSL = /* glsl */`
uniform sampler2D uHorizon; uniform vec4 uHorizonGeo; uniform vec3 uSunEnu; uniform float uShadowSteps;
float horizonH(vec2 xy) {
  vec2 uv = vec2(xy.x - uHorizonGeo.x, uHorizonGeo.y - xy.y) / (uHorizonGeo.z * uHorizonGeo.w);
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return -1.0e9;
  return texture2D(uHorizon, uv).r;
}
float sunVisible(vec3 mapPos) {
  if (uSunEnu.z < -0.02) return 0.0;
  vec3 o = aeqdToEnu(vec3(mapPos.xy, mapPos.z + ${f(MARCH.biasM)}));
  float t = ${f(MARCH.startM)}; float stp = ${f(MARCH.firstStepM)}; float m = 1.0e9;
  for (int i = 0; i < ${MARCH.maxSteps}; i++) {
    if (float(i) >= uShadowSteps) break;
    vec3 q = enuToAeqd(o + uSunEnu * t);
    float H = horizonH(q.xy);
    if (H > -1.0e8) m = min(m, (q.z - H) / t);
    t += stp; stp *= ${f(MARCH.growth)};
  }
  float r = ${SUN_ANGULAR_RADIUS_RAD.toFixed(8)};
  if (m >= r) return 1.0;
  if (m <= -r) return 0.0;
  float a = m / r;
  return 1.0 - (acos(a) - a * sqrt(1.0 - a * a)) / 3.14159265;
}`;

export const BAKE_VERTEX = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

/** Bakes Sun visibility for every texel of a map-aligned target. Origin heights come from uHeights. */
export const BAKE_FRAGMENT = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D uHeights; uniform vec4 uTargetGeo; // west, north, size(m), useHorizonForHeight
${GEODESY_GLSL}
${SHADOW_MARCH_GLSL}
void main() {
  vec2 xy = vec2(uTargetGeo.x + vUv.x * uTargetGeo.z, uTargetGeo.y - (1.0 - vUv.y) * uTargetGeo.z);
  float h = uTargetGeo.w > 0.5 ? horizonH(xy) : texture2D(uHeights, vec2(vUv.x, 1.0 - vUv.y)).r;
  float v = h < -1.0e8 ? 1.0 : sunVisible(vec3(xy, h));
  gl_FragColor = vec4(v, v, v, 1.0);
}`;

export const TERRAIN_VERTEX = /* glsl */`
attribute vec3 aMap;
varying vec3 vMap; varying vec3 vNormalW; varying vec3 vPosW;
#include <common>
#include <logdepthbuf_pars_vertex>
void main() {
  vMap = aMap; vNormalW = normal; vPosW = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}`;

export const TERRAIN_FRAGMENT = /* glsl */`
precision highp float;
varying vec3 vMap; varying vec3 vNormalW; varying vec3 vPosW;
uniform float uRadius;
uniform vec3 uSun; uniform float uFluxScale; uniform float uExposure; uniform float uAlbedo; uniform float uAmbient;
uniform sampler2D uShadowFine; uniform vec4 uShadowFineGeo; uniform sampler2D uShadowCoarse; uniform vec4 uShadowCoarseGeo;
uniform int uOverlay; uniform float uOverlayOpacity; uniform sampler2D uUnits; uniform vec4 uUnitsGeo; uniform vec3 uUnitColors[8];
uniform sampler2D uTrav; uniform vec4 uTravGeo; uniform float uSlopeLimit; uniform float uContour;
uniform vec4 uOpBox; uniform float uShowBox; uniform vec3 uSelection; uniform float uIllustrative;
#include <common>
#include <logdepthbuf_pars_fragment>

vec2 geoUv(vec2 xy, vec4 g) { return vec2(xy.x - g.x, g.y - xy.y) / g.z; }
bool inside(vec2 uv) { return uv.x >= 0.0 && uv.y >= 0.0 && uv.x <= 1.0 && uv.y <= 1.0; }
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y); }

float shadowAt(vec2 xy) {
  vec2 uf = geoUv(xy, uShadowFineGeo);
  if (uShadowFineGeo.w > 0.5 && inside(uf)) return texture2D(uShadowFine, vec2(uf.x, 1.0 - uf.y)).r;
  vec2 uc = geoUv(xy, uShadowCoarseGeo);
  if (inside(uc)) return texture2D(uShadowCoarse, vec2(uc.x, 1.0 - uc.y)).r;
  return 1.0;
}
vec3 ramp(float t) { // restrained sequential ramp (teal -> amber -> red) for slope classes
  t = clamp(t, 0.0, 1.0);
  vec3 a = vec3(0.16, 0.42, 0.45), b = vec3(0.86, 0.68, 0.30), c = vec3(0.80, 0.22, 0.18);
  return t < 0.6 ? mix(a, b, t / 0.6) : mix(b, c, (t - 0.6) / 0.4);
}

void main() {
  #include <logdepthbuf_fragment>
  vec3 N = normalize(vNormalW);
  vec3 up = normalize(vPosW + vec3(0.0, uRadius, 0.0));
  float camDist = length(cameraPosition - vPosW);
  if (uIllustrative > 0.5 && camDist < 400.0) {
    // ILLUSTRATIVE micro-relief (visualization mode only): not measured, never used by analysis.
    vec2 p = vMap.xy;
    float fade = 1.0 - smoothstep(120.0, 400.0, camDist);
    float e = 0.35;
    vec2 g = vec2(vnoise(p * 1.7 + vec2(e, 0.0)) - vnoise(p * 1.7 - vec2(e, 0.0)), vnoise(p * 1.7 + vec2(0.0, e)) - vnoise(p * 1.7 - vec2(0.0, e)))
           + 0.5 * vec2(vnoise(p * 5.3 + vec2(e, 0.0)) - vnoise(p * 5.3 - vec2(e, 0.0)), vnoise(p * 5.3 + vec2(0.0, e)) - vnoise(p * 5.3 - vec2(0.0, e)));
    N = normalize(N + fade * 0.22 * vec3(g.x, 0.0, -g.y));
  }
  vec3 S = normalize(uSun);
  vec3 V = normalize(cameraPosition - vPosW);
  float mu0 = max(dot(N, S), 0.0), mu = max(dot(N, V), 0.0);
  float alpha = degrees(acos(clamp(dot(S, V), -1.0, 1.0)));
  // Lunar-Lambert photometric function (McEwen 1991): L(alpha) polynomial, uniform assumed albedo.
  float L = clamp(1.0 - 0.019 * alpha + 0.000242 * alpha * alpha - 0.00000146 * alpha * alpha * alpha, 0.0, 1.0);
  float refl = uAlbedo * (2.0 * L * mu0 / (mu0 + mu + 1e-4) + (1.0 - L) * mu0);
  float vis = shadowAt(vMap.xy);
  float radiance = refl * vis * uFluxScale * uExposure + uAmbient * uAlbedo;
  vec3 col = vec3(radiance) * vec3(1.0, 0.975, 0.95);

  float slope = degrees(acos(clamp(dot(N, up), -1.0, 1.0)));
  vec3 over = col; float oa = 0.0;
  if (uOverlay == 1) { over = ramp(slope / 30.0); oa = uOverlayOpacity; }
  else if (uOverlay == 2) {
    vec2 uu = geoUv(vMap.xy, uUnitsGeo);
    if (inside(uu)) { float id = texture2D(uUnits, uu).r * 255.0; int k = int(id + 0.5);
      for (int j = 0; j < 8; j++) if (j == k) over = uUnitColors[j]; oa = k < 8 ? uOverlayOpacity : 0.0; }
  } else if (uOverlay == 3) {
    float haz = step(uSlopeLimit, slope);
    over = vec3(0.85, 0.25, 0.18); oa = haz * uOverlayOpacity;
    if (vis < 0.5) { over = mix(over, vec3(0.25, 0.35, 0.75), 1.0 - haz); oa = max(oa, 0.45 * uOverlayOpacity); }
  } else if (uOverlay == 4) {
    vec2 ut = geoUv(vMap.xy, uTravGeo);
    if (inside(ut)) { vec4 tv = texture2D(uTrav, ut); over = tv.rgb; oa = tv.a * uOverlayOpacity; }
  } else if (uOverlay == 5) {
    over = mix(vec3(0.12, 0.2, 0.55), vec3(0.98, 0.84, 0.45), vis); oa = 0.55 * uOverlayOpacity;
  }
  col = mix(col, over * max(0.35, radiance * 2.0 + 0.25), oa);
  if (uContour > 0.0) {
    float h = vMap.z / uContour; float w = fwidth(h);
    float line = 1.0 - smoothstep(0.0, w * 1.2, abs(fract(h - 0.5) - 0.5));
    float major = 1.0 - step(0.5, abs(mod(floor(h + 0.5), 5.0)));
    col = mix(col, vec3(0.92, 0.88, 0.75), line * (0.22 + 0.33 * major) * smoothstep(9000.0, 1500.0, camDist));
  }
  if (uShowBox > 0.5) {
    vec2 d = min(abs(vMap.xy - uOpBox.xy), abs(vMap.xy - uOpBox.zw));
    bool inBox = vMap.x > uOpBox.x && vMap.x < uOpBox.z && vMap.y > uOpBox.y && vMap.y < uOpBox.w;
    float px = max(2.0, camDist * 0.0018);
    float edge = (inBox && min(d.x, d.y) < px) ? 1.0 : 0.0;
    col = mix(col, vec3(0.86, 0.74, 0.42), edge * 0.7);
  }
  if (uSelection.z > 0.0) {
    float dd = abs(length(vMap.xy - uSelection.xy) - uSelection.z);
    col = mix(col, vec3(1.0, 0.86, 0.4), (1.0 - smoothstep(0.0, max(1.5, camDist * 0.002), dd)) * 0.9);
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
