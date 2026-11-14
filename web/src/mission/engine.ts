import { calibrationError } from "./observations.ts";
import { ASSUMPTIONS, ENVIRONMENTS, G0, MODEL } from "./environment.ts";
import { planRoute } from "./routing.ts";
import { sampleTerrain, slopeAt } from "./terrain.ts";
import { drivetrain, tipAngle } from "./mobility.ts";
import { solarAt, validateGeometry } from "./solar.ts";
import type { Frame, MissionTerrain, RunResult, Scenario } from "./types.ts";

export function validateScenario(
  s: Scenario,
  terrain: MissionTerrain,
): string[] {
  const errors: string[] = [];
  const invalidCalibration = calibrationError(s);
  if (invalidCalibration) errors.push(invalidCalibration);
  if (
    s.version !== "1.0.0" ||
    !["launch", "descent", "rover", "eva"].includes(s.mode)
  )
    errors.push("Unsupported scenario version or mode.");
  if (s.terrainId !== terrain.id)
    errors.push("Scenario terrain does not match the loaded surface.");
  if (
    !["native", "earth-analog", "counterfactual"].includes(s.kind) ||
    !["earth", "moon", "mars"].includes(s.environment.planet)
  )
    errors.push("Unsupported experiment or environment.");
  if (
    s.kind === "native" &&
    (terrain.body === "earth" || s.environment.planet !== terrain.body)
  )
    errors.push(
      "Planet-native experiments require the matching planetary terrain and environment.",
    );
  if (
    s.kind === "earth-analog" &&
    (terrain.body !== "earth" || s.environment.planet !== "earth")
  )
    errors.push(
      "Physical Earth analog experiments require Earth terrain and Earth physics.",
    );
  if (s.kind === "counterfactual" && terrain.body !== "earth")
    errors.push(
      "Controlled counterfactual experiments require an Earth terrain.",
    );
  const range = (name: string, value: number, low: number, high: number) => {
    if (!Number.isFinite(value) || value < low || value > high)
      errors.push(`${name} must be between ${low} and ${high}.`);
  };
  const surface = s.mode === "rover" || s.mode === "eva";
  range("Duration (s)", s.duration, 1, surface ? 86400 : 1200);
  range("Timestep (s)", s.dt, surface ? 0.5 : 0.01, surface ? 30 : 0.5);
  if (s.duration / s.dt > 120000)
    errors.push("This experiment exceeds 120,000 integration steps.");
  range("Seed", s.seed, 0, 2147483647);
  const e = s.environment;
  if (s.solar) {
    try { validateGeometry(s.solar, terrain, s.duration); }
    catch (error) { errors.push((error as Error).message); }
    if (s.kind === "counterfactual") errors.push("Site-specific solar geometry cannot be substituted between bodies.");
  }
  range("Gravity (m/s²)", e.gravity, 0.01, 30);
  range("Surface density (kg/m³)", e.density, 0, 10);
  range("Scale height (m)", e.scaleHeight, 1, 100000);
  range("Reference pressure (kPa)", e.pressureKpa, 0, 1000);
  range("Reference temperature (K)", e.temperatureK, 1, 1000);
  if (s.kind !== "counterfactual") {
    const ref = ENVIRONMENTS[e.planet];
    if (ref && e.gravity !== ref.gravity)
      errors.push(
        "Gravity substitution requires a controlled counterfactual on Earth terrain.",
      );
    if (e.planet === "moon" && e.density !== 0)
      errors.push("The native lunar model requires vacuum.");
  }
  for (const [label, p] of [
    ["Start", s.start],
    ["Destination", s.destination],
  ] as const) {
    if (
      !p ||
      !Number.isFinite(p.x) ||
      !Number.isFinite(p.y) ||
      sampleTerrain(terrain, p) === null ||
      slopeAt(terrain, p) === null
    )
      errors.push(
        `${label} must be inside measured terrain with valid slope support.`,
      );
  }
  const v = s.vehicle,
    r = s.rover;
  if (surface) {
    range("Rover/EVA mass (kg)", r.mass, 1, 10000);
    range("Speed (m/s)", r.speed, 0.01, 5);
    range("Maximum slope (°)", r.maxSlope, 0, 45);
    range("Traction coefficient", r.traction, 0.01, 2);
    range("Rolling resistance", r.rollingResistance, 0, 1);
    range("Efficiency", r.efficiency, 0.01, 1);
    range("Idle power (W)", r.idlePower, 0, 10000);
    range("Energy budget (Wh)", r.batteryWh, 0.1, 1000000);
    if (!["direct", "astar", "astar-energy"].includes(r.route))
      errors.push("Unsupported route planner.");
    if (r.design) {
      const d = r.design;
      for (const [key, low, high] of [
        ["wheelRadius", 0.1, 1], ["wheelWidth", 0.1, 0.8],
        ["trackWidth", 0.6, 5], ["wheelbase", 0.6, 5],
        ["cgHeight", 0.2, 3], ["suspensionTravel", 0.02, 0.8],
        ["stallTorque", 0.1, 2000], ["noLoadRpm", 1, 500], ["motorPower", 1, 10000],
        ["solarArea", 0, 20], ["solarEfficiency", 0, 0.5], ["transmission", 0, 1],
      ] as const) range(key, d[key], low, high);
    } else if (r.route === "astar-energy") errors.push("Energy routing requires the rover engineering model.");
  } else {
    range("Dry mass (kg)", v.dryMass, 1, 1000000);
    range("Propellant (kg)", v.fuel, 0, 1000000);
    range("Thrust (N)", v.thrust, 0, 100000000);
    range("Specific impulse (s)", v.isp, 1, 1000);
    range("Reference area (m²)", v.area, 0, 10000);
    range("Drag coefficient", v.cd, 0, 5);
    range("Thrust angle from vertical (°)", v.angle, -70, 70);
    range("Initial altitude (m)", v.initialAltitude, 0, 50000);
    range("Initial vertical velocity (m/s)", v.initialVelocity, -1000, 1000);
    range("Ignition altitude (m)", v.ignitionAltitude, 0, 50000);
    range("Touchdown speed limit (m/s)", v.safeSpeed, 0, 100);
    range("Touchdown slope limit (°)", v.safeSlope, 0, 45);
    if (s.mode === "descent" && v.initialAltitude <= 0)
      errors.push("Descent must start above the ground.");
    if (
      s.mode === "launch" &&
      (v.initialAltitude !== 0 || v.initialVelocity !== 0)
    )
      errors.push("Launch begins at rest on the surface.");
    if (s.mode === "launch" && s.thrustProgram !== undefined) {
      const program = s.thrustProgram;
      if (!Array.isArray(program) || program.length < 1 || program.length > 16)
        errors.push("Launch throttle program requires 1–16 steps.");
      else {
        if (program[0]?.time !== 0)
          errors.push("Launch throttle program must start at 0 s.");
        program.forEach((step, i) => {
          range(`Throttle step ${i + 1} time (s)`, step?.time, 0, s.duration);
          range(`Throttle step ${i + 1} fraction`, step?.throttle, 0, 1);
          if (i > 0 && step?.time - program[i - 1]?.time < 1e-6)
            errors.push(
              "Throttle step times must increase by at least 0.000001 s.",
            );
        });
      }
    }
  }
  return errors;
}
type Flight = [number, number, number, number, number]; // east, datum height, east speed, vertical speed, fuel
function rk4(state: Flight, dt: number, f: (state: Flight) => Flight): Flight {
  const add = (a: Flight, b: Flight, scale: number) =>
    a.map((v, i) => v + b[i] * scale) as Flight;
  const a = f(state),
    b = f(add(state, a, dt / 2)),
    c = f(add(state, b, dt / 2)),
    d = f(add(state, c, dt));
  return state.map(
    (v, i) => v + (dt * (a[i] + 2 * b[i] + 2 * c[i] + d[i])) / 6,
  ) as Flight;
}
function flight(run: RunResult) {
  const s = run.scenario,
    v = s.vehicle,
    e = s.environment,
    terrain = run.terrain;
  const origin = sampleTerrain(terrain, s.start)!;
  let state: Flight = [
      s.start.x,
      origin + v.initialAltitude,
      0,
      v.initialVelocity,
      v.fuel,
    ],
    t = 0,
    airborne = s.mode === "descent",
    ignition = false,
    burnedOut = false,
    apogee = false;
  let previousThrust = 0;
  const program =
    s.mode === "launch" ? (s.thrustProgram ?? [{ time: 0, throttle: 1 }]) : [];
  let programIndex = 0;
  const ground = (a: Flight) =>
    sampleTerrain(terrain, { x: a[0], y: s.start.y });
  const density = (a: Flight) =>
    e.density *
    Math.exp(
      -Math.max(-500, e.planet === "earth" ? a[1] : a[1] - origin) /
        e.scaleHeight,
    );
  const control = (a: Flight): number => {
    if (a[4] <= 1e-8) return 0;
    if (s.mode === "launch") return v.thrust * program[programIndex].throttle;
    const agl = a[1] - (ground(a) ?? origin);
    if (agl > v.ignitionAltitude) return 0;
    const mass = v.dryMass + a[4],
      decel = Math.max(0.1, v.thrust / mass - e.gravity);
    // Conservative stopping-distance envelope plus a height-proportional
    // terminal approach. This is an explicit sampled controller, not guidance
    // fitted to a prerecorded trajectory. Saturation can still cause failure.
    const desired = -Math.max(
      0.8,
      Math.min(
        25,
        0.2 * Math.max(0, agl),
        0.35 * Math.sqrt(2 * decel * Math.max(0, agl)),
      ),
    );
    return Math.min(
      v.thrust,
      Math.max(0, mass * (e.gravity + (desired - a[3]) / 0.6)),
    );
  };
  const dynamics =
    (thrust: number) =>
    (a: Flight): Flight => {
      const mass = v.dryMass + Math.max(0, a[4]),
        speed = Math.hypot(a[2], a[3]),
        drag = 0.5 * density(a) * v.cd * v.area * speed;
      const angle = s.mode === "descent" ? 0 : (v.angle * Math.PI) / 180;
      return [
        a[2],
        a[3],
        (thrust * Math.sin(angle) - drag * a[2]) / mass,
        (thrust * Math.cos(angle) - drag * a[3]) / mass - e.gravity,
        -thrust / (v.isp * G0),
      ];
    };
  const record = (thrust: number, phase: string) => {
    const g = ground(state) ?? origin,
      deriv = dynamics(thrust)(state);
    run.frames.push({
      t,
      x: state[0],
      y: s.start.y,
      elevation: state[1],
      altitude: Math.max(0, state[1] - g),
      speed: Math.hypot(state[2], state[3]),
      verticalSpeed: state[3],
      acceleration: phase === "On pad" ? 0 : Math.hypot(deriv[2], deriv[3]),
      mass: v.dryMass + state[4],
      propellant: state[4],
      thrust,
      dynamicPressure: 0.5 * density(state) * (state[2] ** 2 + state[3] ** 2),
      distance: Math.abs(state[0] - s.start.x),
      energyWh: 0,
      slope: slopeAt(terrain, { x: state[0], y: s.start.y }) ?? 0,
      phase,
    });
  };
  record(control(state), airborne ? "Descent" : "On pad");
  while (t < s.duration - 1e-8) {
    if (run.frames.length >= 120000) {
      run.outcome = "integration_limit";
      run.explanation =
        "The maximum integration step count was reached. Increase the timestep or reduce the duration/vehicle acceleration.";
      break;
    }
    const thrust = control(state),
      flow = thrust / (v.isp * G0);
    // Prevent horizontal terrain tunneling: limit a step to a quarter cell,
    // using a conservative bound on the thrust-driven speed increase.
    const maxHorizontal =
      Math.abs(state[2]) +
      Math.abs((thrust * Math.sin((v.angle * Math.PI) / 180)) / v.dryMass) *
        s.dt;
    let dt = Math.min(
      s.dt,
      s.duration - t,
      flow > 0 ? state[4] / flow : Infinity,
      terrain.grid.cell_m / (4 * Math.max(1, maxHorizontal)),
      program[programIndex + 1] ? program[programIndex + 1].time - t : Infinity,
    );
    if (dt < 1e-9) {
      state[4] = 0;
      continue;
    }
    if (thrust > 0 && !ignition) {
      ignition = true;
      run.events.push({
        t,
        type: "Ignition",
        detail: `Calculated thrust ${thrust.toFixed(0)} N; propellant flow follows T/(Isp·g₀).`,
      });
    }
    previousThrust = thrust;
    const previous = state,
      oldT = t;
    const held = !airborne && dynamics(thrust)(state)[3] <= 0;
    if (held)
      state = [state[0], origin, 0, 0, Math.max(0, state[4] - flow * dt)];
    else {
      if (!airborne) {
        airborne = true;
        run.events.push({
          t,
          type: "Liftoff",
          detail: "Vertical thrust exceeds local weight.",
        });
      }
      state = rk4(state, dt, dynamics(thrust));
      state[4] = Math.max(0, state[4]);
    }
    t += dt;
    if (!state.every(Number.isFinite))
      throw new Error("Numerical integration produced a non-finite state.");
    const terrainHeight = ground(state);
    if (terrainHeight === null) {
      state = previous;
      t = oldT;
      run.outcome = "terrain_boundary";
      run.explanation =
        "The trajectory left the measured window. No terrain was extrapolated.";
      break;
    }
    if (state[1] - origin > 100000 || Math.hypot(state[2], state[3]) > 5000) {
      state = previous;
      t = oldT;
      run.outcome = "model_limit";
      run.explanation =
        "The local model reached its 100 km altitude or 5 km/s validity boundary. No orbital outcome is inferred.";
      break;
    }
    if (airborne && state[1] <= terrainHeight && t > 0) {
      // Locate the first ground intersection by bisection using the same RK4 step.
      let lo = 0,
        hi = dt;
      for (let j = 0; j < 30; j++) {
        const mid = (lo + hi) / 2,
          a = rk4(previous, mid, dynamics(thrust)),
          z = ground(a);
        if (z !== null && a[1] > z) lo = mid;
        else hi = mid;
      }
      dt = hi;
      state = rk4(previous, dt, dynamics(thrust));
      state[4] = Math.max(0, state[4]);
      t = oldT + dt;
      state[1] = ground(state)!;
      const slope = slopeAt(terrain, { x: state[0], y: s.start.y });
      record(thrust, "Touchdown");
      const speed = Math.hypot(state[2], state[3]);
      run.metrics.touchdownSpeed = speed;
      run.outcome =
        s.mode === "launch"
          ? "ground_impact"
          : speed > v.safeSpeed
            ? "hard_landing"
            : slope === null
              ? "unresolved_terrain"
              : slope > v.safeSlope
                ? "slope_exceeded"
                : "soft_landing";
      run.explanation =
        s.mode === "launch"
          ? "The calculated flight returned to the measured surface."
          : `Touchdown at ${speed.toFixed(2)} m/s (limit ${v.safeSpeed}) and ${slope === null ? "unresolved" : slope.toFixed(2) + "°"} regional slope (limit ${v.safeSlope}°). Sub-grid hazards remain unresolved.`;
      run.events.push({ t, type: "Surface contact", detail: run.explanation });
      break;
    }
    if (!apogee && previous[3] > 0 && state[3] <= 0) {
      apogee = true;
      run.events.push({
        t,
        type: "Apogee bracket",
        detail: `Vertical velocity changed sign during the preceding ${dt.toFixed(3)} s step.`,
      });
    }
    if (state[4] <= 1e-8 && !burnedOut && v.fuel > 0) {
      state[4] = 0;
      burnedOut = true;
      run.events.push({
        t,
        type: "Propellant depleted",
        detail: "Thrust is zero after this instant.",
      });
    }
    if (
      program[programIndex + 1] &&
      t >= program[programIndex + 1].time - 1e-10
    ) {
      t = program[++programIndex].time;
      run.events.push({
        t,
        type: "Throttle change",
        detail: `Command ${(program[programIndex].throttle * 100).toFixed(1)}% of maximum thrust. Actual thrust is zero if propellant is depleted.`,
      });
    }
    const nextThrust = control(state);
    const phase = !airborne
      ? "On pad"
      : s.mode === "descent"
        ? nextThrust > 0
          ? "Braking"
          : "Free descent"
        : nextThrust > 0
          ? "Powered ascent"
          : state[3] > 0
            ? "Coasting"
            : "Ballistic descent";
    record(nextThrust, phase);
    if (!airborne && state[4] === 0) {
      run.outcome = "no_liftoff";
      run.explanation =
        "Vertical thrust never exceeded local weight before propellant was exhausted.";
      break;
    }
  }
  if (!run.outcome) {
    run.outcome = airborne ? "duration_complete" : "no_liftoff";
    run.explanation = airborne
      ? "The requested time horizon ended before surface contact. This is an incomplete flight, not a landing or orbital success."
      : "The vehicle remained on the pad throughout the time horizon.";
  }
  if (!run.frames.length) record(previousThrust, "Stopped");
}
function surface(run: RunResult) {
  const s = run.scenario,
    r = s.rover,
    terrain = run.terrain;
  if (s.mode === "rover" && r.design) {
    engineeredSurface(run);
    return;
  }
  run.route = planRoute(terrain, s);
  const initial: Frame = {
    t: 0,
    ...s.start,
    elevation: sampleTerrain(terrain, s.start)!,
    altitude: 0,
    speed: 0,
    verticalSpeed: 0,
    acceleration: 0,
    mass: r.mass,
    propellant: 0,
    thrust: 0,
    dynamicPressure: 0,
    distance: 0,
    energyWh: 0,
    slope: slopeAt(terrain, s.start)!,
    phase: "Ready",
  };
  run.frames.push(initial);
  if (!run.route.length) {
    run.outcome = "route_blocked";
    run.explanation =
      "No route satisfies the measured slope, traction and valid-data constraints. Try A* instead of direct travel, move the endpoints or explicitly revise assumptions.";
    return;
  }
  run.events.push({
    t: 0,
    type: "Route planned",
    detail: `${r.route === "astar" ? "A* shortest admissible grid path" : "Direct path"}; ${run.route.length} waypoints on ${terrain.grid.cell_m} m terrain.`,
  });
  let f = initial;
  for (let i = 1; i < run.route.length; i++) {
    const a = run.route[i - 1],
      b = run.route[i],
      za = sampleTerrain(terrain, a)!,
      zb = sampleTerrain(terrain, b)!,
      horizontal = Math.hypot(b.x - a.x, b.y - a.y);
    const length = Math.hypot(horizontal, zb - za),
      grade = Math.atan2(Math.abs(zb - za), horizontal);
    const speed = r.speed / (1 + 3 * Math.tan(grade));
    const energyPerM =
      (r.mass *
        s.environment.gravity *
        (r.rollingResistance * Math.cos(grade) +
          Math.max(0, (zb - za) / length))) /
        r.efficiency /
        3600 +
      r.idlePower / speed / 3600;
    let travelled = 0;
    while (travelled < length - 1e-8) {
      const ds = Math.max(
        0,
        Math.min(
          length - travelled,
          speed * s.dt,
          speed * (s.duration - f.t),
          (r.batteryWh - f.energyWh) / Math.max(1e-12, energyPerM),
        ),
      );
      if (ds < 1e-9) break;
      travelled += ds;
      const fraction = travelled / length;
      const p = {
        x: a.x + (b.x - a.x) * fraction,
        y: a.y + (b.y - a.y) * fraction,
      };
      f = {
        ...f,
        ...p,
        t: f.t + ds / speed,
        elevation: sampleTerrain(terrain, p)!,
        speed,
        distance: f.distance + ds,
        energyWh: f.energyWh + ds * energyPerM,
        slope: slopeAt(terrain, p)!,
        phase: s.mode === "eva" ? "EVA traverse" : "Traversing",
      };
      run.frames.push(f);
      if (f.energyWh >= r.batteryWh - 1e-7 || f.t >= s.duration - 1e-7) break;
    }
    if (f.energyWh >= r.batteryWh - 1e-7) {
      run.outcome = "energy_limit";
      run.explanation =
        "The assumed energy budget was consumed before the destination. No battery thermal or terrain-contact model is included.";
      break;
    }
    if (f.t >= s.duration - 1e-7) {
      run.outcome = "duration_complete";
      run.explanation =
        "The operation time budget ended before the destination.";
      break;
    }
  }
  if (!run.outcome) {
    run.outcome = "destination_reached";
    run.explanation =
      s.mode === "eva"
        ? "The regional EVA route fits the configured slope, time and energy-proxy limits. Physiological and life-support safety were not evaluated."
        : "The regional route is traversable under the stated slope, traction and energy assumptions. Sub-grid hazards and wheel dynamics were not evaluated.";
  }
  f.phase = run.outcome === "destination_reached" ? "Arrived" : "Stopped";
  f.speed = 0;
}
/** Regional quasi-static drivetrain, exact time/energy boundaries; six driven wheels.
 * Forces use each planned segment's mean grade, not unobserved wheel-scale terrain.
 */
function engineeredSurface(run: RunResult) {
  const s = run.scenario, r = s.rover, d = r.design!, terrain = run.terrain;
  run.route = planRoute(terrain, s);
  let f: Frame = {
    ...s.start, t: 0, elevation: sampleTerrain(terrain, s.start)!, altitude: 0,
    speed: 0, verticalSpeed: 0, acceleration: 0, mass: r.mass, propellant: 0,
    thrust: 0, dynamicPressure: 0, distance: 0, energyWh: 0,
    slope: slopeAt(terrain, s.start)!, phase: "Ready",
    mobility: { motorRpm: 0, wheelTorqueNm: 0, motorUtilization: 0,
      tractionUtilization: 0, stabilityMarginDeg: tipAngle(d)-slopeAt(terrain,s.start)!, electricalPowerW: 0,
      solarPowerW: 0, generatedWh: 0, batteryRemainingWh: r.batteryWh },
  };
  run.frames.push(f);
  if (!run.route.length) {
    run.outcome = "route_blocked";
    run.explanation = "No route meets slope, traction, static stability and wheel-shaft motor limits on this measured grid.";
    return;
  }
  run.events.push({ t: 0, type: "Engineering route planned",
    detail: `${r.route}; six-wheel DC torque-speed curve, dissipative descent braking, conservative static tip screen. No wheel-contact or slip solver.` });
  let limited = false;
  outer: for (let i = 1; i < run.route.length; i++) {
    const a = run.route[i-1], b = run.route[i];
    const dz = sampleTerrain(terrain, b)! - sampleTerrain(terrain, a)!;
    const horizontal = Math.hypot(b.x-a.x, b.y-a.y), length = Math.hypot(horizontal, dz);
    const grade = Math.atan2(dz, horizontal);
    let travelled = 0;
    while (travelled < length - 1e-7) {
      const fraction = travelled / length;
      const p = { x: a.x + (b.x-a.x)*fraction, y: a.y + (b.y-a.y)*fraction };
      const drive = drivetrain(s, grade, slopeAt(terrain, p)!);
      if (!drive.admissible) {
        run.outcome = "engineering_limit";
        run.explanation = "The local static stability, motor or traction constraint stopped traversal.";
        break outer;
      }
      if (!limited && drive.speed < r.speed * 0.99) {
        limited = true;
        run.events.push({t: f.t, type: "Motor speed limited", detail: "Wheel-shaft torque-speed or mechanical power envelope reduces the commanded speed."});
      }
      let dt = Math.min(s.dt, (length-travelled)/drive.speed, s.duration-f.t);
      const sun = s.solar ? solarAt(s.solar, Math.min(s.solar.duration, f.t + dt/2)) : null;
      // Horizontal deck: explicitly independent of illustrated suspension tilt.
      const solarPowerW = sun ? sun.solarFluxWm2 * Math.max(0, sun.sunEnu[2]) *
        d.solarArea * d.solarEfficiency * d.transmission : 0;
      const net = drive.electricalPowerW - solarPowerW;
      if (net > 0) dt = Math.min(dt, f.mobility!.batteryRemainingWh * 3600/net);
      if (dt < 1e-10) break outer;
      const ds = drive.speed * dt;
      travelled += ds;
      const next = travelled/length;
      const at = { x: a.x+(b.x-a.x)*next, y: a.y+(b.y-a.y)*next };
      f = {...f, ...at, t: f.t+dt, elevation: sampleTerrain(terrain, at)!,
        speed: drive.speed, distance: f.distance+ds, energyWh: f.energyWh+drive.electricalPowerW*dt/3600,
        slope: slopeAt(terrain, at)!, phase: "Engineering traverse",
        mobility: { motorRpm: drive.motorRpm, wheelTorqueNm: drive.wheelTorqueNm,
          motorUtilization: drive.motorUtilization, tractionUtilization: drive.tractionUtilization,
          stabilityMarginDeg: drive.stabilityMarginDeg, electricalPowerW: drive.electricalPowerW,
          solarPowerW, generatedWh: f.mobility!.generatedWh+solarPowerW*dt/3600,
          batteryRemainingWh: Math.max(0, Math.min(r.batteryWh, f.mobility!.batteryRemainingWh-net*dt/3600)) }};
      run.frames.push(f);
      if (f.mobility!.batteryRemainingWh < 1e-7) {
        run.outcome = "energy_limit"; run.explanation = "The integrated electrical load exhausted the battery after optional SPICE-driven solar charging."; break outer;
      }
      if (f.t >= s.duration - 1e-7) {
        if (i < run.route.length-1 || travelled < length-1e-7) {
          run.outcome = "duration_complete"; run.explanation = "The operation time budget ended before the destination.";
        }
        break outer;
      }
    }
  }
  if (!run.outcome) {
    run.outcome = "destination_reached";
    run.explanation = "The configured rover completes the regional route within its motor, static stability, traction, time and battery screens. Wheel-scale contact and dynamic rollover remain unresolved.";
  }
  // Append a stopped sample rather than modifying a previously recorded moving state.
  run.frames.push({...f, phase: run.outcome === "destination_reached" ? "Arrived" : "Stopped", speed: 0,
    mobility: {...f.mobility!, motorRpm: 0, electricalPowerW: 0, solarPowerW: 0}});
}
export function simulate(
  scenario: Scenario,
  terrain: MissionTerrain,
  inputs: Record<string, string> = {},
): RunResult {
  const errors = validateScenario(scenario, terrain);
  if (errors.length) throw new Error(errors.join(" "));
  const run: RunResult = {
    schema: "egiz.experiment",
    version: "1.0.0",
    model: MODEL,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    scenario: structuredClone(scenario),
    terrain: structuredClone(terrain),
    inputs: { ...inputs },
    integrator:
      scenario.mode === "rover" || scenario.mode === "eva"
        ? scenario.rover.design && scenario.mode === "rover"
          ? "Regional quasi-static six-wheel drivetrain; linear DC torque-speed curve; exact time/battery boundary clipping"
          : "Piecewise kinematic traversal with energy/time boundary clipping"
        : "Classical RK4; exact fuel boundary; ground event bisection; fixed-step sampled descent controller",
    assumptions: [...ASSUMPTIONS],
    frames: [],
    events: [],
    route: [],
    outcome: "",
    explanation: "",
    metrics: {
      maxAltitude: 0,
      maxSpeed: 0,
      maxQ: 0,
      fuelUsed: 0,
      distance: 0,
      duration: 0,
      energyWh: 0,
      maxSlope: 0,
      touchdownSpeed: null,
    },
  };
  if (scenario.rover.design && scenario.mode === "rover") {
    run.assumptions = run.assumptions.filter(x => !x.startsWith("Surface traversal") && !x.startsWith("Pressure and temperature"));
    run.assumptions.push("Regional quasi-static six-wheel drivetrain with equal load sharing, wheel-shaft linear DC torque-speed and power limits. No acceleration transient, slip, regolith or dynamic suspension solver. Conservative static tip angle uses the smaller support span.",
      "Wheel width and suspension travel control illustrative geometry/articulation only. Solar area is a horizontal electrical collection aperture; rendered panel dimensions are illustrative. No dynamic rollover, obstacle clearance or contact prediction.");
  }
  if (scenario.calibration) run.assumptions.push(`${scenario.calibration.observations.synthetic ? "SYNTHETIC SOFTWARE CONTROL; physical validation unconfirmed" : "Imported Earth electrical observations; physical review remains required"}. Electrical efficiency and idle bus demand fitted from known mechanical power. Fit and held-out source series are embedded in scenario.calibration. Scope: Earth electrical bench only; no soil or planetary thermal transfer.`);
  if (scenario.solar) run.assumptions.push(...scenario.solar.limitations, `${scenario.solar.engine}; ${scenario.solar.frame}; UTC ${scenario.solar.epochUtc}; ${scenario.solar.step} s recorded samples, vector interpolation. Solar charging uses assumed horizontal panel efficiency and transmission.`);
  if (scenario.mode === "rover" || scenario.mode === "eva") surface(run);
  else flight(run);
  const end = run.frames.at(-1)!;
  for (const f of run.frames) {
    run.metrics.maxAltitude = Math.max(run.metrics.maxAltitude, f.altitude);
    run.metrics.maxSpeed = Math.max(run.metrics.maxSpeed, f.speed);
    run.metrics.maxQ = Math.max(run.metrics.maxQ, f.dynamicPressure);
    run.metrics.maxSlope = Math.max(run.metrics.maxSlope, f.slope);
  }
  Object.assign(run.metrics, {
    fuelUsed:
      scenario.mode === "launch" || scenario.mode === "descent"
        ? scenario.vehicle.fuel - end.propellant
        : 0,
    distance: end.distance,
    duration: end.t,
    energyWh: end.energyWh,
  });
  run.events.push({
    t: end.t,
    type: run.outcome.replaceAll("_", " "),
    detail: run.explanation,
  });
  return run;
}
export function frameAt(run: RunResult, t: number): Frame {
  let lo = 0,
    hi = run.frames.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (run.frames[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  return run.frames[lo];
}
