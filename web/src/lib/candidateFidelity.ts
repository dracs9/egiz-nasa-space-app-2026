// Unknown eligibility is distinct from a measured fidelity of zero.
import type { Run } from '../types/contracts';

export function candidateFidelity(run: Run, tileId: string, objective: string | null): number | null {
  if (objective) return run.fidelity[objective]?.[tileId]?.F ?? null;
  const known = Object.values(run.fidelity).map(cells => cells[tileId]?.F).filter((value): value is number => value != null);
  return known.length ? Math.max(...known) : null;
}
