"""EGIZ native experiment protocol. SI units; independent development 2026-10-20.

MuJoCo: six independent trailing-arm suspensions on declared synthetic rigid terrain.
Basilisk: central-body orbit, RK4, initial tangential impulse, no drag or harmonics.
No solver output is claimed to be calibrated soil physics or flight qualification.
"""
from __future__ import annotations

import hashlib
import importlib.metadata
import json
import math
from datetime import datetime, timezone

import numpy as np

BODIES = {"earth": (9.80665, 6378137., 3.986004418e14),
          "moon": (1.62, 1737400., 4.902800066e12),
          "mars": (3.71, 3396190., 4.28283758157561e13)}
ADAPTER = "egiz-native-dynamics-1.0.0"
LIMITS = {
    "mass": (20, 3000, 900), "wheelRadius": (.15, .8, .41),
    "wheelWidth": (.08, .6, .33), "trackWidth": (1, 4, 2.58),
    "wheelbase": (1, 5, 2.24), "cgHeight": (.3, 1.5, .65),
    "stallTorque": (1, 500, 120), "noLoadRpm": (5, 300, 60),
    "motorPower": (10, 2000, 250), "efficiency": (.1, 1, .75),
    "idlePower": (0, 2000, 120), "friction": (.05, 1.5, .65),
    "speed": (0, 2, .65), "stiffness": (100, 30000, 4000),
    "damping": (1, 3000, 200), "travel": (.05, .6, .25),
    "steerDeg": (-20, 20, 0), "altitudeKm": (100, 30000, 400),
    "inclinationDeg": (0, 180, 25), "deltaV": (-150, 500, 0),
}


def validate(request):
    if not isinstance(request, dict) or request.get("kind") not in {"rover", "orbit"}:
        raise ValueError("Select rover or orbit")
    is_rover = request['kind'] == 'rover'
    selected = set(LIMITS)-{'altitudeKm', 'inclinationDeg', 'deltaV'} if is_rover else {'mass', 'altitudeKm', 'inclinationDeg', 'deltaV'}
    allowed = selected | {'kind', 'body', 'duration'} | ({'course', 'step'} if is_rover else set())
    if set(request) - allowed:
        raise ValueError(f"Unknown or inapplicable inputs: {sorted(set(request)-allowed)}")
    p = {"kind": request["kind"], "body": request.get("body", "mars")}
    if p['body'] not in BODIES:
        raise ValueError('Invalid body')
    if is_rover:
        p['course'] = request.get('course', 'steps')
        if p['course'] not in {'flat', 'steps', 'cross-slope'}:
            raise ValueError('Invalid synthetic course')
    for key, (low, high, default) in LIMITS.items():
        if key not in selected:
            continue
        value = request.get(key, default)
        if isinstance(value, bool) or not isinstance(value, (float, int)) or not math.isfinite(value) or not low <= value <= high:
            raise ValueError(f"{key} must be {low}–{high}")
        p[key] = float(value)
    controls = [("duration", 2, 90 if is_rover else 21600, 30 if is_rover else 7200)]
    if is_rover:
        controls.append(("step", .001, .005, .002))
    for key, low, high, default in controls:
        value = request.get(key, default)
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not low <= value <= high:
            raise ValueError(f"{key} must be {low}–{high}")
        p[key] = float(value)
    if is_rover and (p["trackWidth"] < p["wheelWidth"] * 3 or p["wheelbase"] < p["wheelRadius"] * 4):
        raise ValueError("Wheel spacing must exceed wheel collision envelope")
    if p['kind'] == 'rover':
        chassis_offset = (p['cgHeight']-p['wheelRadius']+.0036)/.78
        if p['wheelRadius']+chassis_offset < .26:
            raise ValueError('CG/mass distribution places the chassis too close to the ground; raise CG height')
    return p


def envelope(p, engine, states, geometry, metrics, events, assumptions, extra=None):
    key = hashlib.sha256(json.dumps(p, sort_keys=True).encode()).hexdigest()
    identity = hashlib.sha256(f"{ADAPTER}|{engine}|{key}|{(extra or {}).get('modelSha256', 'point-mass')}".encode()).hexdigest()
    return {"schema": "egiz.dynamics_experiment", "version": "1.0.0", "adapter": ADAPTER, "id": identity[:20],
            "createdAt": datetime.now(timezone.utc).isoformat(), "request": p,
            "engine": engine, "fidelity": "RESEARCH", "inputSha256": key,
            "coordinates": "local right-handed X-forward Y-left Z-up" if p["kind"] == "rover" else "body-centered inertial Cartesian X/Y/Z; fixed central body",
            "geometry": geometry, "states": states, "metrics": metrics, "events": events,
            "assumptions": assumptions, **(extra or {})}


def course_lift(p):
    # Highest tilted-slab surface under the initial tire envelope. Clear the actual
    # inclined support, rather than initializing tires inside a rigid obstacle.
    if p['course'] == 'cross-slope':
        return max(0., .2/math.cos(.16)-.13+math.tan(.16)*(p['trackWidth']+p['wheelWidth'])/2)
    return 0.


def rover_xml(p):
    g = BODIES[p["body"]][0]
    r, w = p["wheelRadius"], p["wheelWidth"]
    # Mass fractions: chassis .75, arms .06, knuckles .03, wheels .16.
    # With zero joint angles, arm CM z = -(h+.12)/2 and hubs z=-h.
    # Therefore whole-vehicle COM above the contact plane = r + .78h - .0036.
    # Solve for h so the *same* cgHeight parameter retains its FAST-model meaning.
    h = (p["cgHeight"]-r+.0036)/.78
    m = p["mass"]
    angle = min(.65, p["travel"] / (2 * math.hypot(.3, h-.12)))
    parts = [f'''<mujoco model="EGIZ six trailing-arm rover"><compiler angle="radian"/>
    <option timestep="{p['step']}" gravity="0 0 {-g}" integrator="implicitfast" cone="elliptic" iterations="80" tolerance="1e-10"/>
    <default><geom friction="{p['friction']} .005 .0001" solref=".01 1" solimp=".95 .99 .001" condim="4"/><joint damping=".1"/><default class="robot"><geom contype="2" conaffinity="1"/></default></default>
    <worldbody><geom name="ground" type="plane" size="40 20 .1" rgba=".20 .19 .18 1"/>''']
    if p["course"] == "steps":
        parts += [f'<geom name="step{i}" type="box" pos="{x} {y} {z/2}" size="{length} {width} {z/2}" rgba=".43 .36 .28 1"/>'
                  for i, (x, y, z, length, width) in enumerate([(3, 0, .12, .5, 3), (6, .9, .22, .65, .7), (9, -.9, .18, .8, .7)])]
    if p["course"] == "cross-slope":
        # A long tilted rigid slab, not an inferred planetary surface.
        parts.append('<geom name="slope" type="box" pos="12 0 -.13" euler=".16 0 0" size="28 7 .2" rgba=".43 .36 .28 1"/>')
    parts.append(f'<body name="chassis" childclass="robot" pos="0 0 {r+h+.12+course_lift(p)}"><freejoint/><geom name="bus" type="box" size="{p["wheelbase"]*.44} {p["trackWidth"]*.32} .24" mass="{m*.75}" rgba=".64 .51 .27 1"/>')
    for i in range(6):
        x = [-p["wheelbase"]/2, 0, p["wheelbase"]/2][i % 3]
        y = (-1 if i < 3 else 1) * p["trackWidth"]/2
        anchor_x = float(np.clip(x+.3, -p['wheelbase']*.44, p['wheelbase']*.44))
        anchor_y = math.copysign(p['trackWidth']*.32, y)
        # Rigid chassis crossmember reaches the actual hinge. Mass/inertia are
        # included in the declared chassis lump, not duplicated per visual beam.
        parts.append(f'<geom name="support{i}" type="capsule" fromto="{anchor_x} {anchor_y} -.12 {x+.3} {y} -.12" size=".045" mass="0" contype="0" conaffinity="0" rgba=".55 .59 .62 1"/>')
        parts.append(f'''<body name="arm{i}" pos="{x+.3} {y} -.12">
        <joint name="suspension{i}" axis="0 1 0" range="{-angle} {angle}" limited="true" stiffness="{p['stiffness']}" damping="{p['damping']}"/>
        <geom type="capsule" fromto="0 0 0 -.3 0 {-(h-.12)}" size=".045" mass="{m*.01}" rgba=".55 .59 .62 1"/>
        <body name="knuckle{i}" pos="-.3 0 {-(h-.12)}"><joint name="steer{i}" axis="0 0 1" damping="10"/>
        <geom type="sphere" size=".065" mass="{m*.005}" contype="0" conaffinity="0"/>
        <body name="wheel{i}"><joint name="spin{i}" axis="0 1 0" damping=".015"/>
        <geom name="tire{i}" type="cylinder" size="{r} {w/2}" euler="1.5707963267948966 0 0" mass="{m*(.25/6-.015)}" rgba=".16 .18 .19 1"/>
        </body></body></body>''')
    parts.append('</body></worldbody><actuator>')
    for i in range(6):
        parts.append(f'<motor name="drive{i}" joint="spin{i}" ctrllimited="true" ctrlrange="{-p["stallTorque"]} {p["stallTorque"]}"/>')
        parts.append(f'<position name="steering{i}" joint="steer{i}" kp="1200" kv="100" ctrllimited="true" ctrlrange="-.35 .35"/>')
    parts.append('</actuator></mujoco>')
    return ''.join(parts)


def rover(p):
    import mujoco as mj
    xml = rover_xml(p)
    model = mj.MjModel.from_xml_string(xml)
    data = mj.MjData(model)
    mj.mj_forward(model, data)
    initial_com = float(data.subtree_com[1, 2])
    joints = {name: model.joint(name).id for i in range(6) for name in [f'spin{i}', f'suspension{i}', f'steer{i}']}
    names = [mj.mj_id2name(model, mj.mjtObj.mjOBJ_BODY, i) for i in range(1, model.nbody)]
    geometry = []
    for i in range(model.ngeom):
        geometry.append({"body": int(model.geom_bodyid[i])-1, "type": int(model.geom_type[i]),
                         "size": model.geom_size[i].tolist(), "position": model.geom_pos[i].tolist(),
                         "quaternion": model.geom_quat[i].tolist(), "rgba": model.geom_rgba[i].tolist()})
    states, events, energy = [], [], 0.
    stride = max(1, round(.05 / p["step"]))
    steps = math.ceil(p["duration"] / p["step"])
    up, peak_load = 1., 0.
    triggered = set()
    wheel_names = [model.geom(f'tire{i}').id for i in range(6)]
    force = np.zeros(6)
    def joint(name):
        j = joints[name]
        return float(data.qpos[model.jnt_qposadr[j]]), float(data.qvel[model.jnt_dofadr[j]])
    for n in range(steps+1):
        torque, watts = [], p['idlePower']
        for i in range(6):
            _, omega = joint(f'spin{i}')
            cap = min(p['stallTorque'] * max(0, 1-abs(omega)/(p['noLoadRpm']*math.pi/30)), p['motorPower']/max(abs(omega), .01))
            tau = float(np.clip(40*(p['speed']/p['wheelRadius']-omega), -cap, cap)) if data.time >= 1 else 0.
            data.ctrl[2*i] = tau
            data.ctrl[2*i+1] = math.radians(p['steerDeg']) * (-1 if i % 3 == 0 else 1 if i % 3 == 2 else 0)
            torque.append(tau)
            watts += max(0, tau*omega)/p['efficiency']
        if n % stride == 0 or n == steps:
            mj.mj_forward(model, data)
            loads = [0.]*6
            normal_vectors = np.zeros((6, 3))
            for k in range(data.ncon):
                contact = data.contact[k]
                mj.mj_contactForce(model, data, k, force)
                for i, wid in enumerate(wheel_names):
                    if wid in (contact.geom1, contact.geom2):
                        loads[i] += max(0., float(force[0]))
                        normal_vectors[i] += contact.frame.reshape(3, 3)[0]*float(force[0])*(1 if contact.geom2 == wid else -1)
            speed = float(np.linalg.norm(data.qvel[:3]))
            wheels = []
            for i in range(6):
                angle_i, omega = joint(f'spin{i}')
                # Kinematic tread-vs-hub slip, resolved along the wheel's actual forward direction.
                bid = model.body(f'wheel{i}').id
                velocity = np.zeros(6)
                mj.mj_objectVelocity(model, data, mj.mjtObj.mjOBJ_BODY, bid, velocity, 0)
                forward = data.xmat[model.body(f'knuckle{i}').id].reshape(3, 3)[:, 0]
                hub = float(velocity[3:] @ forward)
                tread = omega*p['wheelRadius']
                slip = (tread-hub)/max(abs(tread), abs(hub), .05)
                wheels.append({"spin": angle_i, "omega": omega, "suspension": joint(f'suspension{i}')[0],
                               "steering": joint(f'steer{i}')[0], "normalForce": loads[i], "normalVector": normal_vectors[i].tolist(), "slip": slip, "torque": torque[i]})
            peak_load = max(peak_load, *loads)
            up = float(data.xmat[1].reshape(3, 3)[2, 2])
            states.append({"t": float(data.time), "position": data.xpos[1].tolist(), "velocity": data.qvel[:3].tolist(),
                           "poses": [list(data.xpos[i])+list(data.xquat[i]) for i in range(1, model.nbody)],
                           "wheels": wheels, "speed": speed, "energyWh": energy, "powerW": watts,
                           "tiltDeg": math.degrees(math.acos(np.clip(up, -1, 1)))})
            if data.time > 1:
                diagnostics = {
                    "high_slip": (max(abs(w['slip']) for w in wheels) > .5, "At least one wheel exceeds 0.5 signed kinematic slip magnitude; inspect hub velocity, contact load and torque."),
                    "wheel_unloaded": (sum(w['normalForce'] < 1 for w in wheels) >= 2, "At least two wheels have less than 1 N recorded normal force; this is a contact diagnostic, not proof of rollover."),
                    "large_tilt": (math.degrees(math.acos(np.clip(up, -1, 1))) > 25, "Chassis tilt exceeded 25 degrees in the recorded rigid-contact experiment."),
                }
                for name, (active, detail) in diagnostics.items():
                    if active and name not in triggered:
                        triggered.add(name)
                        events.append({"t": float(data.time), "type": name, "detail": detail})
            if up < .2:
                events.append({"t": float(data.time), "type": "rollover", "detail": "Recorded chassis up axis exceeded 78.46 degrees from vertical"})
                break
        if n < steps:
            mj.mj_step(model, data)
            energy += watts*p['step']/3600
    distance = sum(float(np.linalg.norm(np.array(b['position'])[:2]-np.array(a['position'])[:2])) for a, b in zip(states, states[1:]))
    return envelope(p, f'MuJoCo {mj.__version__}', states, geometry,
                    {"duration": states[-1]['t'], "distance": distance, "energyWh": energy,
                     "peakSpeed": max(s['speed'] for s in states), "peakNormalForce": peak_load,
                     "maxTiltDeg": max(s['tiltDeg'] for s in states), "mass": float(model.body_mass.sum()),
                     "initialCenterOfMassZ": initial_com, "initialSurfaceLiftM": course_lift(p), "nominalCGHeight": p["cgHeight"],
                     "finalCenterOfMassZ": float(data.subtree_com[1, 2])},
                    events, ["Synthetic rigid flat/step/slab terrain in metres; no measured wheel-scale topography or calibrated regolith.",
                             "Configured CG height is the whole-vehicle nominal center of mass above a flat contact plane at zero arm angles; chassis height is solved from the declared component mass distribution. Initial settling clearance is 0.12 m above the highest course surface under the initial tire envelope. Rigid crossmembers attach all suspension pivots; their mass/inertia are included in the chassis lump. Loaded articulation changes actual COM. Six independent passive trailing arms, spring-damper hinges, driven wheels and counter-steered front/rear knuckles. This is not a rocker-bogie suspension.",
                             "Vehicle self-collisions are disabled; chassis and wheels contact the course. Coulomb contact coefficient is an experiment assumption; no deformable soil, sinkage, wear or calibrated tire compliance.",
                             "Linear DC torque-speed envelope plus per-wheel power limit, proportional wheel-speed control. Electrical energy excludes stall copper losses, regeneration and thermal limits.",
                             "Free chassis mass/inertia and all wheel/arm bodies integrated by native implicitfast contact solver; logged at approximately 20 Hz.",
                             "Slip is signed tread-minus-hub speed normalized by max speed or 0.05 m/s, not a soil parameter."],
                    {"bodyNames": names, "modelXml": xml, "modelSha256": hashlib.sha256(xml.encode()).hexdigest(),
                     "solver": {"dt": p['step'], "integrator": "implicitfast", "contact": "elliptic Coulomb", "iterations": 80}})


def orbit(p):
    from Basilisk.simulation import spacecraft
    from Basilisk.utilities import SimulationBaseClass, macros, simIncludeGravBody
    # All C++ owners remain strongly referenced for the duration of the simulation.
    sim = SimulationBaseClass.SimBaseClass()
    process = sim.CreateNewProcess('dynamics')
    process.addTask(sim.CreateNewTask('propagate', macros.sec2nano(2.)))
    sat = spacecraft.Spacecraft()
    sat.ModelTag = 'EGIZ-orbiter'
    sat.hub.mHub = p['mass']
    sat.hub.IHubPntBc_B = [[100., 0., 0.], [0., 120., 0.], [0., 0., 80.]]
    factory = simIncludeGravBody.gravBodyFactory()
    planet = {'earth': factory.createEarth, 'moon': factory.createMoon, 'mars': factory.createMarsBarycenter}[p['body']]()
    planet.isCentralBody = True
    factory.addBodiesTo(sat)
    sim.AddModelToTask('propagate', sat)
    radius = BODIES[p['body']][1]
    r = radius+p['altitudeKm']*1000
    circular_speed = math.sqrt(planet.mu/r)
    speed = circular_speed+p['deltaV']
    inc = math.radians(p['inclinationDeg'])
    sat.hub.r_CN_NInit = [r, 0., 0.]
    sat.hub.v_CN_NInit = [0., speed*math.cos(inc), speed*math.sin(inc)]
    recorder = sat.scStateOutMsg.recorder()
    sim.AddModelToTask('propagate', recorder)
    sim.InitializeSimulation()
    sim.ConfigureStopTime(macros.sec2nano(p['duration']))
    sim.ExecuteSimulation()
    states = []
    for t, pos, vel in zip(recorder.times(), recorder.r_BN_N, recorder.v_BN_N):
        length = float(np.linalg.norm(pos))
        states.append({"t": float(t)*1e-9, "position": pos.tolist(), "velocity": vel.tolist(),
                       "speed": float(np.linalg.norm(vel)), "altitude": length-radius,
                       "specificEnergy": float(vel@vel/2-planet.mu/length),
                       "angularMomentum": float(np.linalg.norm(np.cross(pos, vel)))})
        if length <= radius:
            break
    e0 = states[0]['specificEnergy']
    h0 = states[0]['angularMomentum']
    energy_scale = max(abs(e0), planet.mu/r*1e-12)
    drift = max(abs((s['specificEnergy']-e0)/energy_scale) for s in states)
    return envelope(p, f'Basilisk {importlib.metadata.version("bsk")}', states, [],
                    {"duration": states[-1]['t'], "peakSpeed": max(s['speed'] for s in states),
                     "minAltitude": min(s['altitude'] for s in states), "maxAltitude": max(s['altitude'] for s in states),
                     "energyRelativeDrift": drift,
                     "momentumRelativeDrift": max(abs((s['angularMomentum']-h0)/h0) for s in states),
                     "circularPeriod": 2*math.pi*math.sqrt(r**3/planet.mu), "mu": planet.mu,
                     "radius": radius, "circularSpeed": circular_speed, "energyDriftScale": energy_scale},
                    [{"t": 0, "type": "initial_impulse", "detail": f"Tangential delta-v {p['deltaV']} m/s relative to circular speed; applied as initial condition, no burn/propellant model"}],
                    ["Native Basilisk spacecraft/gravity modules; fixed point-mass central body and default RK4, 2 s integration.",
                     "Body-centered inertial axes are an explicitly selected mathematical frame, not SPICE geolocation or a rotating ground track.",
                     "Delta-v modifies initial tangential velocity; no finite burn, propellant use, attitude control, harmonics, atmosphere or third bodies.",
                     "Planet radius is a reference sphere; terminates logged trajectory at first inside-radius state, without impact localization."],
                    {"solver": {"dt": 2., "integrator": "Basilisk default RK4"}})


def execute(request):
    p = validate(request)
    return rover(p) if p['kind'] == 'rover' else orbit(p)
