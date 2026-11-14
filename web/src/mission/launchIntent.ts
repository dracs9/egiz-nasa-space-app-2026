import type { Mode } from './types';

/**
 * Short-lived hand-off from the landing page: which expedition the lab should open in.
 * Reads do not consume the intent (React StrictMode runs effects twice in development);
 * it simply expires a few seconds after the click.
 */
let pending: { mode: Mode; at: number } | null = null;
const TTL_MS = 6000;
export function setLaunchIntent(mode: Mode) { pending = { mode, at: Date.now() }; }
export function takeLaunchIntent(): Mode | null {
  if (!pending) return null;
  if (Date.now() - pending.at > TTL_MS) { pending = null; return null; }
  return pending.mode;
}
