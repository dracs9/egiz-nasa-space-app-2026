// Written with AI assistance (Codex); human review pending.
// Rendering interpolation only. Integrator snapshots and discrete events remain authoritative.
import { frameAt } from "../engine";
import { sampleTerrain } from "../terrain";
import type {
  Frame,
  MissionTerrain,
  Point,
  RunResult,
  Scenario,
} from "../types";

export function replayFrame(run: RunResult, time: number): Frame {
  const t = Math.max(0, Math.min(time, run.metrics.duration));
  const a = frameAt(run, t);
  let lo = 0,
    hi = run.frames.length;
  while (lo < hi) {
    const m = (lo + hi) >>> 1;
    if (run.frames[m].t <= t) lo = m + 1;
    else hi = m;
  }
  const b = run.frames[lo];
  if (!b || b.t === a.t || t === a.t) return a;
  const f = (t - a.t) / (b.t - a.t);
  const out = { ...a, t };
  for (const key of [
    "x",
    "y",
    "elevation",
    "altitude",
    "speed",
    "verticalSpeed",
    "mass",
    "propellant",
    "distance",
    "energyWh",
    "slope",
    "dynamicPressure",
  ] as const)
    out[key] = a[key] + (b[key] - a[key]) * f;
  if (a.mobility && b.mobility) {
    out.mobility = { ...a.mobility };
    for (const key of Object.keys(a.mobility) as (keyof NonNullable<Frame["mobility"]>)[])
      out.mobility[key] = a.mobility[key] + (b.mobility[key] - a.mobility[key]) * f;
  }
  // Thrust, acceleration and phase are step-valued: never anticipate a controller/event change.
  return out;
}

export function headingAt(
  run: RunResult | null,
  time: number,
  start: Point,
  destination: Point,
): number {
  let a: Point = start,
    b: Point = destination;
  if (run && run.frames.length > 1) {
    a = replayFrame(run, Math.max(0, time - 2));
    b = replayFrame(run, Math.min(run.metrics.duration, time + 2));
    if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-6) {
      a = run.frames[Math.max(0, run.frames.length - 2)];
      b = run.frames.at(-1)!;
    }
  }
  // Model front is -Z; map east/north to X/-Z.
  return -Math.atan2(b.x - a.x, b.y - a.y);
}

export function surfacePose(terrain: MissionTerrain, p: Point, yaw: number) {
  const height = sampleTerrain(terrain, p) ?? 0;
  const d = 1.2;
  const front = { x: -Math.sin(yaw) * d, y: Math.cos(yaw) * d };
  const right = { x: Math.cos(yaw) * d, y: Math.sin(yaw) * d };
  const at = (x: number, y: number) =>
    sampleTerrain(terrain, { x: p.x + x, y: p.y + y }) ?? height;
  const pitch = Math.atan2(
    at(front.x, front.y) - at(-front.x, -front.y),
    2 * d,
  );
  const roll = Math.atan2(at(right.x, right.y) - at(-right.x, -right.y), 2 * d);
  return { height, pitch, roll };
}

export function propulsion(
  frame: Frame | null,
  scenario: Scenario,
  run: RunResult | null,
) {
  const contact =
    !!run &&
    !!frame &&
    frame.t >= run.metrics.duration &&
    run.metrics.touchdownSpeed !== null;
  return contact
    ? 0
    : Math.max(
        0,
        Math.min(
          1,
          (frame?.thrust ?? 0) / Math.max(1, scenario.vehicle.thrust),
        ),
      );
}

export function terminalState(
  run: RunResult | null,
  time: number,
): "pending" | "success" | "failure" | "incomplete" {
  if (!run || time < run.metrics.duration) return "pending";
  if (["soft_landing", "destination_reached"].includes(run.outcome))
    return "success";
  if (
    [
      "duration_complete",
      "model_limit",
      "terrain_boundary",
      "integration_limit",
    ].includes(run.outcome)
  )
    return "incomplete";
  return "failure";
}
