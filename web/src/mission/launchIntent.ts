import type { Mode, Scenario } from './types';

/** Parameter overrides the landing page may set before opening the lab. */
export interface LaunchOverrides { rover?: Partial<Scenario['rover']>; vehicle?: Partial<Scenario['vehicle']> }
export interface LaunchIntent { mode: Mode; overrides?: LaunchOverrides; autorun?: boolean }

/**
 * Short-lived hand-off from the landing page: which expedition the lab should open in,
 * with which parameters, and whether to start the simulation immediately.
 * Reads do not consume the intent (React StrictMode runs effects twice in development);
 * it expires a few seconds after the click.
 */
let pending: (LaunchIntent & { at: number }) | null = null;
const TTL_MS = 6000;
export function setLaunchIntent(mode: Mode, overrides?: LaunchOverrides, autorun = false) { pending = { mode, overrides, autorun, at: Date.now() }; }
export function takeLaunchIntent(): LaunchIntent | null {
  if (!pending) return null;
  if (Date.now() - pending.at > TTL_MS) { pending = null; return null; }
  return pending;
}
/** Apply an intent's overrides to a default scenario. */
export function applyOverrides(scenario: Scenario, overrides?: LaunchOverrides): Scenario {
  if (!overrides) return scenario;
  return { ...scenario, rover: { ...scenario.rover, ...overrides.rover }, vehicle: { ...scenario.vehicle, ...overrides.vehicle } };
}
