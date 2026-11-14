# EGIZ ASTRAL — simulation methods

Code: `web/src/astral/sim/`. Deterministic: the same specification and world produce a byte-identical record (tested).

## Terrain and obstacles

The simulator uses the L3 site field (2 m posts, area average of the 1 m DTM), bilinear between posts. Detected rocks whose diameter is at least twice the rover's climbable step become keep-out discs inflated by half the track width plus 0.5 m. Shadow-derived heights are not used; height ≈ half diameter follows Golombek et al. 2008.

## Wheel–soil model (`terramechanics.ts`)

- Sinkage (Bekker, rigid wheel): `z = [3W / ((3−n)(kc + b·kφ)√D)]^(2/(2n+1))`
- Compaction resistance: `Rc = (kc + b·kφ) z^(n+1) / (n+1)`
- Thrust (Janosi–Hanamoto): `H(i) = (b·ℓ·c + W·tanφ)[1 − (K/iℓ)(1 − e^(−iℓ/K))]`, contact length `ℓ = √(D·z)`
- Slip is solved per wheel by bisection so that `H(i) = Rc + grade share`; 100 % slip means immobilised.
- Six wheels with static load transfer in pitch and roll; a wheel load ≤ 0 is reported as tip-over margin exhausted.
- Ground speed = commanded rim speed × (1 − mean slip); mechanical power = Σ thrust × rim speed; electrical = mechanical ÷ efficiency + idle.
- Rigid surface: Coulomb limit and a rolling-resistance coefficient, no sinkage.

Worked reference (unit-tested): wheel load 635.7 N, b = 0.4 m, D = 0.525 m, LETE sand → z = 22.2 mm.

## Surface profiles (all `assumed`)

| ID | Parameters | Origin |
|---|---|---|
| `dry-sand` | n 1.1, kc 0.99 kN/m^(n+1), kφ 1528 kN/m^(n+2), c 1.04 kPa, φ 28°, K 2.5 cm | Wong, LETE sand; Earth analog |
| `mars-drift` | same pressure–sinkage; c 1.6 kPa, φ 18° | Viking drift material (Moore et al. 1987); composite |
| `lunar-regolith` | n 1, kc 1.4 kN/m², kφ 820 kN/m³, c 0.17 kPa, φ 35°, K 1.8 cm | Lunar Sourcebook nominal |
| `bedrock` | μ 0.6, Crr 0.05 | declared |
| `classified` | rough class → bedrock, aligned-texture class → mars-drift, else dry-sand | assumed mapping from model output |

None is a measurement at Jezero. The literature values were written from knowledge of the standard sources and must be checked against them before engineering use.

## Rover profiles

- **Mars 2020-class (reference):** mass 1025 kg, wheel diameter 52.5 cm, top speed 4.2 cm/s, 110 W MMRTG and tilt limit from public NASA/JPL material; battery capacity approximate; wheel width, wheelbase, track, CG height, torque limit, idle and science loads and efficiency are approximations or assumptions, tagged per field in code. Not a JPL engineering model.
- **EGIZ Scout (hypothetical):** 180 kg solar rover; every number is a design assumption.

## Planning (`traverse.ts`)

A 1025 × 1025 grid stores slope, roughness, block reason and surface per cell. A per-surface look-up over −40°…40° grade holds electrical power, slip and ground speed from the drive model. A* (8-connected, no corner cutting) runs three objectives: shortest surface distance; safest (distance + 6 × risk, risk = slope margin² + 2·slip² + roughness ÷ step); lowest energy (drive plus idle over drive time). All three are returned with metrics; the chosen one is simulated.

## Mission execution (`mission.ts`)

Fixed-distance steps along the route: 1 m with attitude from the surface gradient (fast), or 0.25 m with attitude from a least-squares plane through six wheel contacts (detailed). Each step runs the drive model, advances time and integrates the battery with generation: constant RTG, or solar = flux × declared transmission × area × efficiency × cos(incidence on the body-fixed panel), zero in terrain shadow. Sun vector and flux come from the CSPICE record at mission time. Science stops draw a declared load for a declared duration.

Outcomes: `completed`, `no-route`, `immobilized`, `reserve-violated`, `daylight-ended`, `ephemeris-ended`, `invalid`. Events: start, science, shadow entry/exit, high slip, reserve, immobilised, complete, data gap.

## Fidelity ladder

| Mode | Status |
|---|---|
| Fast | Implemented |
| Detailed | Implemented: per-wheel contact plane and finer step, same quasi-static physics |
| Reference | Formula-level check against the worked Bekker case only. No comparison with single-wheel test-bed data, MuJoCo or flight telemetry. |

## Not modelled

Inertia and dynamics, suspension kinematics, slip-sinkage, grousers, multipass, steering scrub, wheel wear, thermal limits, communication windows, dust on arrays, opacity variation, arm and drill mechanics. The existing MuJoCo path (`pipeline/dynamics`) is not connected to this world.
